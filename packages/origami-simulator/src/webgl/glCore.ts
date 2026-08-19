// Minimal WebGL2 GPGPU layer: named float textures, ping-pong framebuffers, and
// full-screen-quad passes. This is the modern port of upstream's GPUMath.js
// (third_party/origami-simulator/js/dynamic/GPUMath.js).
//
// Two deliberate choices:
//
//   - WebGL2 for the context, so float render targets come from the core
//     `EXT_color_buffer_float` extension rather than WebGL1's flakier
//     `WEBGL_color_buffer_float`.
//   - GLSL ES 1.00 for the shaders (`texture2D`, `gl_FragColor`). WebGL2 accepts
//     them, and it lets the solver passes stay line-for-line faithful to
//     upstream, which is what makes them checkable against the oracle. The one
//     thing GLSL 1.00 lacks that we want -- `texelFetch` in the vertex shader
//     for rendering straight from the position texture -- is available anyway as
//     vertex texture fetch via `texture2D`.

const QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

export interface FloatTextureData {
  width: number;
  height: number;
  /** RGBA, length width*height*4. Null allocates an uninitialised texture. */
  data: Float32Array | null;
}

interface TextureRecord {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer | null;
  width: number;
  height: number;
}

interface ProgramRecord {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

/**
 * Thrown once the GL context has gone away.
 *
 * A lost context does not fail loudly on its own: every GL call becomes a no-op
 * and every read returns zeros, so a solver would keep "running" and quietly
 * produce a flat, motionless mesh. Turning the first touch after loss into a
 * typed throw is what lets the caller report it instead of rendering nonsense.
 */
export class WebGlContextLostError extends Error {
  constructor() {
    super('The WebGL context was lost');
    this.name = 'WebGlContextLostError';
  }
}

export class GlCore {
  readonly gl: WebGL2RenderingContext;
  private readonly programs = new Map<string, ProgramRecord>();
  private readonly textures = new Map<string, TextureRecord>();
  private readonly quadBuffer: WebGLBuffer;
  private disposed = false;
  private lost = false;
  private readonly lostHandlers = new Set<() => void>();

  private constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('WebGL2 float render targets (EXT_color_buffer_float) are not supported');
    }
    // Nearest filtering only -- these are data textures, and linear filtering
    // between texels would corrupt every indexed lookup.
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Unable to allocate the full-screen quad buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    this.quadBuffer = buffer;
  }

  static create(canvas: HTMLCanvasElement | OffscreenCanvas): GlCore | null {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      // The default framebuffer (the visible canvas) needs a depth buffer so the
      // mesh render pass can occlude far faces with near ones -- without it the
      // paper renders see-through. The solver's compute passes render to their
      // own depthless FBOs and are unaffected.
      depth: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    let core: GlCore;
    try {
      core = new GlCore(gl as WebGL2RenderingContext);
    } catch {
      return null;
    }
    // Browsers evict contexts to stay under a per-thread budget -- four per
    // worker in Chromium 148 -- and the eviction is silent: the victim gets an
    // event, not an exception. Without a listener the solver keeps stepping a
    // dead context forever. preventDefault() additionally keeps the context
    // eligible for restoration rather than gone for good.
    //
    // Both spellings are registered because the two canvas types disagree:
    // HTMLCanvasElement fires the legacy `webglcontextlost`, OffscreenCanvas the
    // unprefixed `contextlost`. The worker path -- the one that actually runs
    // into the per-worker cap -- is the OffscreenCanvas one, so listening for
    // only the familiar name would miss exactly the case this exists for.
    const onLost = (event: Event) => {
      event.preventDefault();
      core.markLost();
    };
    const target = canvas as unknown as EventTarget;
    target.addEventListener('webglcontextlost', onLost);
    target.addEventListener('contextlost', onLost);
    return core;
  }

  /** True once the context has gone away, from either the event or the driver. */
  get contextLost(): boolean {
    return this.lost || this.gl.isContextLost();
  }

  /**
   * Register a listener for context loss. Returns an unsubscribe. Owners use this
   * to tear the session down and surface an error, rather than discovering the
   * loss as a mesh that stopped moving.
   */
  onContextLost(handler: () => void): () => void {
    this.lostHandlers.add(handler);
    return () => this.lostHandlers.delete(handler);
  }

  private markLost(): void {
    if (this.lost) return;
    this.lost = true;
    for (const handler of this.lostHandlers) handler();
  }

  /**
   * Every entry point that touches GL calls this first. Checking the driver as
   * well as the flag covers a loss that has not yet dispatched its event.
   */
  private assertLive(): void {
    if (this.contextLost) {
      this.markLost();
      throw new WebGlContextLostError();
    }
  }

  createProgram(name: string, fragmentSource: string, vertexSource = DEFAULT_VERTEX_SHADER): void {
    this.assertLive();
    const gl = this.gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error(`Unable to create program ${name}`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Program ${name} failed to link: ${info}`);
    }
    this.programs.set(name, { program, uniforms: new Map() });
  }

  /** Create a named float texture (and its framebuffer, so it can be rendered to). */
  createTexture(name: string, spec: FloatTextureData): void {
    this.assertLive();
    const gl = this.gl;
    this.deleteTexture(name);

    const texture = gl.createTexture();
    if (!texture) throw new Error(`Unable to create texture ${name}`);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      spec.width,
      spec.height,
      0,
      gl.RGBA,
      gl.FLOAT,
      spec.data,
    );

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error(`Unable to create framebuffer for ${name}`);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Framebuffer for ${name} is incomplete`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.textures.set(name, { texture, framebuffer, width: spec.width, height: spec.height });
  }

  /** Overwrite the contents of an existing texture, keeping its framebuffer. */
  updateTexture(name: string, data: Float32Array): void {
    this.assertLive();
    const record = this.requireTexture(name);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, record.texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      record.width,
      record.height,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
  }

  setUniform(
    programName: string,
    name: string,
    value: number | number[],
    type: '1f' | '2f' | '3f' | '1i',
  ): void {
    this.assertLive();
    const gl = this.gl;
    const record = this.requireProgram(programName);
    gl.useProgram(record.program);
    let location = record.uniforms.get(name);
    if (location === undefined) {
      location = gl.getUniformLocation(record.program, name);
      record.uniforms.set(name, location);
    }
    if (location === null) return; // optimised out; harmless
    if (type === '1f') gl.uniform1f(location, value as number);
    else if (type === '1i') gl.uniform1i(location, value as number);
    else if (type === '2f')
      gl.uniform2f(location, (value as number[])[0]!, (value as number[])[1]!);
    else
      gl.uniform3f(
        location,
        (value as number[])[0]!,
        (value as number[])[1]!,
        (value as number[])[2]!,
      );
  }

  /**
   * Run `program` over every texel of `output`, binding `inputs` to texture
   * units 0..n. Sampler uniforms must have been set to those unit indices.
   */
  step(programName: string, inputs: string[], output: string): void {
    this.assertLive();
    const gl = this.gl;
    const record = this.requireProgram(programName);
    const target = this.requireTexture(output);

    gl.useProgram(record.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);

    for (let unit = 0; unit < inputs.length; unit += 1) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.requireTexture(inputs[unit]!).texture);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Swap the identities of two textures. Used for ping-pong: a pass reads
   * `u_lastPosition` and writes `u_position`, then swaps so the result becomes
   * the input to the next step -- with no copy.
   */
  swap(a: string, b: string): void {
    const recordA = this.requireTexture(a);
    const recordB = this.requireTexture(b);
    this.textures.set(a, recordB);
    this.textures.set(b, recordA);
  }

  /** Read an RGBA float texture back to the CPU. Slow; use sparingly. */
  readTexture(name: string): Float32Array {
    this.assertLive();
    const gl = this.gl;
    const record = this.requireTexture(name);
    const out = new Float32Array(record.width * record.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, record.framebuffer);
    gl.readPixels(0, 0, record.width, record.height, gl.RGBA, gl.FLOAT, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }

  hasTexture(name: string): boolean {
    return this.textures.has(name);
  }

  getTexture(name: string): WebGLTexture {
    return this.requireTexture(name).texture;
  }

  dispose(): void {
    if (this.disposed) return;
    const gl = this.gl;
    for (const record of this.programs.values()) gl.deleteProgram(record.program);
    for (const name of [...this.textures.keys()]) this.deleteTexture(name);
    gl.deleteBuffer(this.quadBuffer);
    this.programs.clear();
    this.disposed = true;
  }

  private deleteTexture(name: string): void {
    const existing = this.textures.get(name);
    if (!existing) return;
    this.gl.deleteTexture(existing.texture);
    if (existing.framebuffer) this.gl.deleteFramebuffer(existing.framebuffer);
    this.textures.delete(name);
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Unable to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
      gl.deleteShader(shader);
      throw new Error(`Shader failed to compile: ${info}`);
    }
    return shader;
  }

  private requireProgram(name: string): ProgramRecord {
    const record = this.programs.get(name);
    if (!record) throw new Error(`Unknown program ${name}`);
    return record;
  }

  private requireTexture(name: string): TextureRecord {
    const record = this.textures.get(name);
    if (!record) throw new Error(`Unknown texture ${name}`);
    return record;
  }
}

// The GPGPU vertex shader: a full-screen quad. Every solver pass is a fragment
// shader keyed off gl_FragCoord, exactly as upstream does it.
export const DEFAULT_VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/** Square texture edge length that holds at least `count` texels. Matches upstream's calcTextureSize. */
export function textureSizeFor(count: number): number {
  if (count <= 1) return 2;
  let size = 2;
  while (size * size < count) size *= 2;
  return size;
}
