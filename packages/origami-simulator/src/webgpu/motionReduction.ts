/// <reference types="@webgpu/types" />
// `maxVelocity()` and max strain as a GPU reduction with a 12-byte async read.
//
// The WebGL2 solver answers `maxVelocity()` by reading the whole velocity
// texture back with `readPixels` and scanning it on the CPU, every tick. That
// read is synchronous, so it stalls until every queued step has run. WebGPU has
// no synchronous read at all, which is the largest change a port forces on
// `SolverBackend` (see implementation-plans/simulator-webgpu-backend.md). This
// is the shape that change would take: reduce on the GPU, read three words, and
// let the caller act on the last sample that has landed.
//
// The reduction works on bit patterns, not float compares. For a non-negative
// IEEE float, ordering the bits as a u32 orders the values, so `atomicMax` on
// u32 is a float max with no float atomics. Working in integers also keeps it
// exact where WGSL float maths is not: WGSL lets an implementation assume no NaN
// or infinity, so `abs`, `max` and `isNan` are no basis for the non-finite check
// that `WebglSolver.maxVelocity` makes. Masking the sign bit is.
import { GpuCore, workgroupsFor } from './gpuCore.js';
import type { MotionSample } from '../solverBackend.js';

const WORKGROUP_SIZE = 256;
/** Staging buffers in flight at once; a request beyond this waits for one to land. */
const STAGING_RING = 3;

export const MOTION_REDUCTION_WGSL = /* wgsl */ `
struct Counts { nodes: u32 }
struct Result {
  velocityBits: atomic<u32>,
  strainBits: atomic<u32>,
  nonFinite: atomic<u32>,
}

@group(0) @binding(0) var<uniform> counts: Counts;
@group(0) @binding(1) var<storage, read> velocity: array<vec4f>;
@group(0) @binding(2) var<storage, read_write> result: Result;

var<workgroup> groupVelocity: atomic<u32>;
var<workgroup> groupStrain: atomic<u32>;
var<workgroup> groupNonFinite: atomic<u32>;

const MAGNITUDE = 0x7fffffffu;
const INFINITY_BITS = 0x7f800000u;

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) local: u32) {
  // Workgroup variables start zeroed, which is the identity for both max and or.
  if (id.x < counts.nodes) {
    let bits = bitcast<vec4u>(velocity[id.x]);
    // |v| per axis, as bits. Anything at or past the infinity pattern is inf or NaN.
    let speed = bits.xyz & vec3u(MAGNITUDE);
    var nonFinite = any(speed >= vec3u(INFINITY_BITS));
    let finite = select(speed, vec3u(0u), speed >= vec3u(INFINITY_BITS));
    atomicMax(&groupVelocity, max(finite.x, max(finite.y, finite.z)));

    // Strain is a mean of magnitudes, so never negative; a negative one would
    // lose to the CPU scan's starting 0, and does here too.
    let strainMagnitude = bits.w & MAGNITUDE;
    if (strainMagnitude >= INFINITY_BITS) {
      nonFinite = true;
    } else if ((bits.w >> 31u) == 0u) {
      atomicMax(&groupStrain, bits.w);
    }
    if (nonFinite) { atomicOr(&groupNonFinite, 1u); }
  }
  workgroupBarrier();

  if (local == 0u) {
    atomicMax(&result.velocityBits, atomicLoad(&groupVelocity));
    atomicMax(&result.strainBits, atomicLoad(&groupStrain));
    atomicOr(&result.nonFinite, atomicLoad(&groupNonFinite));
  }
}
`;

/** One reduction's answer is a backend's motion sample, NaN convention included. */
export type { MotionSample };

const RESULT_BYTES = 12;

export class MotionReduction {
  private readonly idle: GPUBuffer[] = [];
  private readonly waiting: Array<(buffer: GPUBuffer) => void> = [];
  private readonly scratch = new DataView(new ArrayBuffer(4));

  private constructor(
    private readonly core: GpuCore,
    private readonly pipeline: GPUComputePipeline,
    /** One per velocity buffer the reduction can read. */
    private readonly bindGroups: GPUBindGroup[],
    private readonly result: GPUBuffer,
    private readonly counts: GPUBuffer,
    private readonly nodeCount: number
  ) {
    for (let i = 0; i < STAGING_RING; i += 1) {
      this.idle.push(
        core.buffer({ label: `motion staging ${i}`, size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
      );
    }
  }

  /**
   * `velocities` are the buffers a sample may read: a solver that ping-pongs
   * velocity passes both, and names the current one on each {@link sample}.
   */
  static async create(
    core: GpuCore,
    velocities: GPUBuffer | readonly GPUBuffer[],
    nodeCount: number
  ): Promise<MotionReduction> {
    await core.validate(MOTION_REDUCTION_WGSL, 'motionReduction');
    return MotionReduction.createNow(core, velocities, nodeCount);
  }

  /** {@link create}, synchronously, for a core that has validated MOTION_REDUCTION_WGSL. */
  static createNow(core: GpuCore, velocities: GPUBuffer | readonly GPUBuffer[], nodeCount: number): MotionReduction {
    const pipeline = core.computePipelineNow(MOTION_REDUCTION_WGSL, 'motionReduction');
    const counts = core.uniformBuffer(new Uint32Array([nodeCount]), 'motionReduction counts');
    const result = core.buffer({
      label: 'motion result',
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    const bindGroups = (Array.isArray(velocities) ? velocities : [velocities]).map((velocity) =>
      core.device.createBindGroup({
        label: 'motionReduction',
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: counts } },
          { binding: 1, resource: { buffer: velocity } },
          { binding: 2, resource: { buffer: result } },
        ],
      })
    );
    return new MotionReduction(core, pipeline, bindGroups, result, counts, nodeCount);
  }

  /**
   * Queue a reduction of the velocity buffer as it will be once everything
   * already submitted has run, and resolve when its three words land. Does not
   * block the queue: steps submitted after this run on while it is in flight.
   *
   * `which` picks the velocity buffer, by its place in the list `create` took.
   */
  async sample(which = 0): Promise<MotionSample> {
    this.core.assertLive();
    const bindGroup = this.bindGroups[which];
    if (!bindGroup) throw new RangeError(`No velocity buffer ${which}; the reduction reads ${this.bindGroups.length}`);
    // Encode now when a staging buffer is free, so the reduction sees exactly
    // the steps submitted before this call; only a full ring waits.
    const staging = this.idle.pop() ?? (await new Promise<GPUBuffer>((resolve) => this.waiting.push(resolve)));
    const encoder = this.core.device.createCommandEncoder({ label: 'motionReduction' });
    encoder.clearBuffer(this.result);
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(workgroupsFor(this.nodeCount, WORKGROUP_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(this.result, 0, staging, 0, 16);
    this.core.device.queue.submit([encoder.finish()]);

    try {
      await staging.mapAsync(GPUMapMode.READ, 0, 16);
      const words = new Uint32Array(staging.getMappedRange(0, 16).slice(0, RESULT_BYTES));
      staging.unmap();
      if (words[2] !== 0) return { maxVelocity: Number.NaN, maxStrain: Number.NaN };
      return { maxVelocity: this.floatOf(words[0]!), maxStrain: this.floatOf(words[1]!) };
    } finally {
      this.giveStaging(staging);
    }
  }

  private floatOf(bits: number): number {
    this.scratch.setUint32(0, bits, true);
    return this.scratch.getFloat32(0, true);
  }

  /** Free the reduction's own buffers; the velocity buffers belong to the caller. */
  dispose(): void {
    for (const buffer of [this.result, this.counts, ...this.idle]) this.core.release(buffer);
    this.idle.length = 0;
  }

  private giveStaging(buffer: GPUBuffer): void {
    const next = this.waiting.shift();
    if (next) next(buffer);
    else this.idle.push(buffer);
  }
}
