/// <reference types="@webgpu/types" />
// `normalCalc` as a compute shader: the first of the five solver passes, ported
// from webgl/passes.ts NORMAL_CALC (itself upstream's normalCalc block).
//
// The fragment shader turns a 1D index into a texel coordinate and samples; here
// the same index reads the buffer directly. Nothing else changes, so the two
// must agree to within float32 rounding on the same input.
import { GpuCore, workgroupsFor } from './gpuCore.js';

const WORKGROUP_SIZE = 64;

export const NORMAL_CALC_WGSL = /* wgsl */ `
struct Counts { faces: u32 }

@group(0) @binding(0) var<uniform> counts: Counts;
@group(0) @binding(1) var<storage, read> faceVertexIndices: array<vec4f>;
@group(0) @binding(2) var<storage, read> lastPosition: array<vec4f>;
@group(0) @binding(3) var<storage, read> originalPosition: array<vec4f>;
@group(0) @binding(4) var<storage, read_write> normals: array<vec4f>;

// See SAFE_NORMALIZE in webgl/passes.ts: a collapsed triangle must not put a
// NaN into the solve.
fn safeNormalize(v: vec3f) -> vec3f {
  let len = length(v);
  if (len <= 0.000001) { return vec3f(0.0, 1.0, 0.0); }
  return v / len;
}

fn position(index: f32) -> vec3f {
  let i = u32(index);
  return lastPosition[i].xyz + originalPosition[i].xyz;
}

@compute @workgroup_size(${WORKGROUP_SIZE})
fn main(@builtin(global_invocation_id) id: vec3u) {
  let face = id.x;
  if (face >= counts.faces) { return; }
  let indices = faceVertexIndices[face].xyz;
  let a = position(indices.x);
  let b = position(indices.y);
  let c = position(indices.z);
  normals[face] = vec4f(safeNormalize(cross(b - a, c - a)), 0.0);
}
`;

export interface NormalsInputs {
  faceCount: number;
  faceVertexIndices: GPUBuffer;
  lastPosition: GPUBuffer;
  originalPosition: GPUBuffer;
  normals: GPUBuffer;
}

export class NormalsPass {
  private constructor(
    private readonly core: GpuCore,
    private readonly pipeline: GPUComputePipeline,
    private readonly bindGroup: GPUBindGroup,
    private readonly faceCount: number
  ) {}

  static async create(core: GpuCore, inputs: NormalsInputs): Promise<NormalsPass> {
    const pipeline = await core.computePipeline(NORMAL_CALC_WGSL, 'normalCalc');
    const counts = core.uniformBuffer(new Uint32Array([inputs.faceCount]), 'normalCalc counts');
    const bindGroup = core.device.createBindGroup({
      label: 'normalCalc',
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: counts } },
        { binding: 1, resource: { buffer: inputs.faceVertexIndices } },
        { binding: 2, resource: { buffer: inputs.lastPosition } },
        { binding: 3, resource: { buffer: inputs.originalPosition } },
        { binding: 4, resource: { buffer: inputs.normals } },
      ],
    });
    return new NormalsPass(core, pipeline, bindGroup, inputs.faceCount);
  }

  /** Record the pass into an open compute pass. Many steps can share one submit. */
  encode(pass: GPUComputePassEncoder): void {
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(workgroupsFor(this.faceCount, WORKGROUP_SIZE));
  }

  /** Run the pass `times` times in a single submit. */
  run(times = 1): void {
    this.core.assertLive();
    const encoder = this.core.device.createCommandEncoder({ label: 'normalCalc' });
    const pass = encoder.beginComputePass();
    for (let i = 0; i < times; i += 1) this.encode(pass);
    pass.end();
    this.core.device.queue.submit([encoder.finish()]);
  }
}
