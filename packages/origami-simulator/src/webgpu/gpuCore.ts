/// <reference types="@webgpu/types" />
// Minimal WebGPU layer for the solver spike: one device, storage buffers, and
// compute pipelines. The WebGPU counterpart of webgl/glCore.ts; see
// implementation-plans/simulator-webgpu-backend.md for why it exists and what
// would have to be true for it to grow into a backend.
//
// Every packed array the WebGL2 solver uploads as an RGBA float texture is
// uploaded here unchanged as an `array<vec4f>`, indexed by the same 1D index the
// fragment shaders turn into a texel coordinate. So the layout in
// webgl/packing.ts, and the parity it carries, is shared rather than copied.

/** Why a WebGPU device could not be had. */
export type WebGpuUnavailableReason = 'no-api' | 'no-adapter' | 'device-failed';

export class WebGpuUnavailableError extends Error {
  constructor(readonly reason: WebGpuUnavailableReason, detail?: string) {
    super(`WebGPU is unavailable (${reason})${detail ? `: ${detail}` : ''}`);
    this.name = 'WebGpuUnavailableError';
  }
}

/**
 * Thrown once the device has gone away. WebGPU reports loss through a promise
 * rather than failing calls, so as with a lost GL context, a solver that did
 * not check would keep "running" on a dead device.
 */
export class WebGpuDeviceLostError extends Error {
  constructor(readonly detail: string) {
    super(`The WebGPU device was lost: ${detail}`);
    this.name = 'WebGpuDeviceLostError';
  }
}

export class GpuCore {
  readonly device: GPUDevice;
  readonly adapterInfo: GPUAdapterInfo;
  private lostDetail: string | null = null;
  private readonly buffers = new Set<GPUBuffer>();
  private readonly modules = new Map<string, GPUShaderModule>();
  /** One check per module: a second `getCompilationInfo` on a module can never resolve (Chromium 153). */
  private readonly validations = new Map<GPUShaderModule, Promise<void>>();

  private constructor(device: GPUDevice, adapterInfo: GPUAdapterInfo) {
    this.device = device;
    this.adapterInfo = adapterInfo;
    void device.lost.then((info) => {
      this.lostDetail = info.message || info.reason;
    });
  }

  /**
   * Acquire a device, or say why not. `gpu` defaults to `navigator.gpu`, which
   * exists in windows and workers alike.
   */
  static async create(gpu: GPU | undefined = globalThis.navigator?.gpu): Promise<GpuCore> {
    if (!gpu) throw new WebGpuUnavailableError('no-api');
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new WebGpuUnavailableError('no-adapter');
    let device: GPUDevice;
    try {
      device = await adapter.requestDevice();
    } catch (error) {
      throw new WebGpuUnavailableError('device-failed', error instanceof Error ? error.message : String(error));
    }
    return new GpuCore(device, adapter.info);
  }

  get lost(): boolean {
    return this.lostDetail !== null;
  }

  assertLive(): void {
    if (this.lostDetail !== null) throw new WebGpuDeviceLostError(this.lostDetail);
  }

  /** A storage buffer holding `data`, which a compute pass may read or write. */
  storageBuffer(data: Float32Array, label: string): GPUBuffer {
    this.assertLive();
    const buffer = this.device.createBuffer({
      label,
      // A zero-sized binding is invalid, so an empty array still gets one vec4.
      size: Math.max(16, data.byteLength),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    if (data.byteLength > 0) this.device.queue.writeBuffer(buffer, 0, uploadable(data));
    this.buffers.add(buffer);
    return buffer;
  }

  /** A uniform buffer of `words` u32s, padded to the 16-byte alignment uniforms need. */
  uniformBuffer(words: Uint32Array, label: string): GPUBuffer {
    this.assertLive();
    const size = Math.ceil(Math.max(16, words.byteLength) / 16) * 16;
    const buffer = this.device.createBuffer({
      label,
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, uploadable(words));
    this.buffers.add(buffer);
    return buffer;
  }

  /** Write `data` into `buffer` at `byteOffset`, ordered after everything already submitted. */
  write(buffer: GPUBuffer, byteOffset: number, data: Float32Array): void {
    this.assertLive();
    this.device.queue.writeBuffer(buffer, byteOffset, uploadable(data));
  }

  /** Copy `size` bytes from `source` to `target` on the GPU, in queue order: exact, and no readback. */
  copy(source: GPUBuffer, target: GPUBuffer, size: number): void {
    this.assertLive();
    const encoder = this.device.createCommandEncoder({ label: 'copy' });
    encoder.copyBufferToBuffer(source, 0, target, 0, size);
    this.device.queue.submit([encoder.finish()]);
  }

  /** Any other buffer this core should free on dispose. */
  buffer(descriptor: GPUBufferDescriptor): GPUBuffer {
    this.assertLive();
    const buffer = this.device.createBuffer(descriptor);
    this.buffers.add(buffer);
    return buffer;
  }

  release(buffer: GPUBuffer): void {
    if (this.buffers.delete(buffer)) buffer.destroy();
  }

  /**
   * Compile a compute pipeline, surfacing WGSL errors as a throw rather than as
   * the console warning and silently invalid pipeline WebGPU gives by default.
   */
  async computePipeline(
    code: string,
    label: string,
    /** Values for the module's `override` constants: a compile-time variant without a second source. */
    constants?: Record<string, number>
  ): Promise<GPUComputePipeline> {
    await this.validate(code, label);
    return this.computePipelineNow(code, label, constants);
  }

  /**
   * Compile `code` and throw on any WGSL error, rather than leave the console
   * warning and silently invalid pipeline WebGPU gives by default. A module is
   * compiled once per core, so validating up front makes building from it
   * later free.
   */
  validate(code: string, label: string): Promise<void> {
    const module = this.module(code, label);
    let validation = this.validations.get(module);
    if (!validation) {
      validation = module.getCompilationInfo().then((info) => {
        const errors = info.messages.filter((message) => message.type === 'error');
        if (errors.length) {
          const detail = errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n');
          throw new Error(`WGSL ${label} failed to compile:\n${detail}`);
        }
      });
      this.validations.set(module, validation);
    }
    return validation;
  }

  /**
   * A compute pipeline, built synchronously: for callers that cannot wait,
   * having {@link validate}d the code first so an error is not left to a
   * console warning.
   */
  computePipelineNow(code: string, label: string, constants?: Record<string, number>): GPUComputePipeline {
    const module = this.module(code, label);
    return this.device.createComputePipeline({
      label,
      layout: 'auto',
      compute: constants ? { module, entryPoint: 'main', constants } : { module, entryPoint: 'main' },
    });
  }

  /** One module per source, compiled once. */
  module(code: string, label: string): GPUShaderModule {
    this.assertLive();
    let module = this.modules.get(code);
    if (!module) {
      module = this.device.createShaderModule({ label, code });
      this.modules.set(code, module);
    }
    return module;
  }

  /** Read a whole storage buffer back. Slow and async; tests and exports only. */
  async readBuffer(source: GPUBuffer, byteLength = source.size): Promise<Float32Array> {
    this.assertLive();
    const staging = this.device.createBuffer({
      size: byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(source, 0, staging, 0, byteLength);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(staging.getMappedRange().slice(0));
    staging.unmap();
    staging.destroy();
    return out;
  }

  /**
   * Read several storage buffers back as of one moment: one submit copies them
   * all, so no work submitted later can land between them.
   */
  async readBuffers(sources: readonly GPUBuffer[]): Promise<Float32Array[]> {
    this.assertLive();
    const total = sources.reduce((sum, source) => sum + source.size, 0);
    const staging = this.device.createBuffer({ size: total, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = this.device.createCommandEncoder();
    let at = 0;
    for (const source of sources) {
      encoder.copyBufferToBuffer(source, 0, staging, at, source.size);
      at += source.size;
    }
    this.device.queue.submit([encoder.finish()]);
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const all = staging.getMappedRange().slice(0);
      at = 0;
      return sources.map((source) => {
        const out = new Float32Array(all, at, source.size / 4);
        at += source.size;
        return out;
      });
    } finally {
      staging.destroy();
    }
  }

  dispose(): void {
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers.clear();
    this.device.destroy();
  }
}

/**
 * `writeBuffer` takes shared memory as well (its IDL type is
 * `AllowSharedBufferSource`), but @webgpu/types narrows it to `ArrayBuffer`.
 */
function uploadable<T extends Float32Array | Uint32Array>(view: T): T & ArrayBufferView<ArrayBuffer> {
  return view as T & ArrayBufferView<ArrayBuffer>;
}

/** Workgroups needed to cover `count` invocations at `size` per group. */
export function workgroupsFor(count: number, size: number): number {
  return Math.max(1, Math.ceil(count / size));
}
