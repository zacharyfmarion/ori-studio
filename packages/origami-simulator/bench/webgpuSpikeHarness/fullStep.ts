/// <reference types="@webgpu/types" />
// A complete Euler step on WebGPU, from the kernels in userPortKernels.ts, fed
// the exact bytes a fresh WebglSolver holds. Exists to answer one question: is
// a full WebGPU step faster than WebglSolver's on the same model and machine?
//
// Two ways to encode the same work:
//
//   - 'as-written' does what the port does: every dispatch opens its own
//     compute pass and creates a new bind group.
//   - 'cached' builds the bind groups once (one set per ping-pong parity) and
//     records a whole solve into a single compute pass.
//
// If the two differ much, encoding overhead, not the GPU, sets WebGPU's speed.
import type { GlCore } from '../../src/webgl/glCore.js';
import type { PackedModel, SolverMaterial } from '../../src/webgl/packing.js';
import type { WebglSolver } from '../../src/webgl/webglSolver.js';
import { GpuCore } from '../../src/webgpu/gpuCore.js';
import {
  NORMAL_CALC_WGSL,
  POSITION_CALC_WGSL,
  THETA_CALC_WGSL,
  UPDATE_CREASE_GEO_WGSL,
  VELOCITY_CALC_WGSL,
  WORKGROUP_SIZE,
} from './userPortKernels.js';

export type Encoding = 'as-written' | 'cached';

/** What the spike reads from inside WebglSolver. Harness-only. */
export interface SolverInternals {
  gl: GlCore;
  packed: PackedModel;
  dt: number;
  material: SolverMaterial;
  foldPercent: number;
}

/** staticData's arrays, in the order of the kernels' off0..off3 slots. */
const STATIC_TEXTURES = [
  'u_originalPosition',
  'u_externalForces',
  'u_mass',
  'u_meta',
  'u_meta2',
  'u_beamMeta',
  'u_creaseMeta',
  'u_creaseMeta2',
  'u_creaseVectors',
  'u_nodeCreaseMeta',
  'u_nodeFaceMeta',
  'u_faceVertexIndices',
  'u_nominalTriangles',
] as const;

interface Pipelines {
  normalCalc: GPUComputePipeline;
  thetaCalc: GPUComputePipeline;
  updateCreaseGeo: GPUComputePipeline;
  velocityCalc: GPUComputePipeline;
  positionCalc: GPUComputePipeline;
}

/** The buffers one step reads and writes, for one ping-pong parity. */
interface StepBuffers {
  lastPos: GPUBuffer;
  curPos: GPUBuffer;
  lastVel: GPUBuffer;
  curVel: GPUBuffer;
  lastTheta: GPUBuffer;
  curTheta: GPUBuffer;
}

export class FullStepSolver {
  private parity = 0;
  private readonly cachedGroups: GPUBindGroup[][];

  private constructor(
    private readonly core: GpuCore,
    private readonly pipe: Pipelines,
    private readonly staticData: GPUBuffer,
    private readonly params: GPUBuffer,
    private readonly normals: GPUBuffer,
    private readonly creaseGeo: GPUBuffer,
    private readonly sides: [StepBuffers, StepBuffers],
    private readonly counts: { nodes: number; faces: number; creases: number }
  ) {
    this.cachedGroups = sides.map((side) => this.groupsFor(side));
  }

  /** Mirror `solver`'s current state, which must be fresh (nothing stepped). */
  static async create(core: GpuCore, solver: WebglSolver): Promise<FullStepSolver> {
    const internals = solver as unknown as SolverInternals;
    const { gl, packed } = internals;
    const textures = STATIC_TEXTURES.map((name) => gl.readTexture(name));
    const offsets: number[] = [];
    let total = 0;
    for (const data of textures) {
      offsets.push(total / 4);
      total += data.length;
    }
    const staticData = new Float32Array(total);
    let at = 0;
    for (const data of textures) {
      staticData.set(data, at);
      at += data.length;
    }

    const dims = packed.dims;
    const p = new Float32Array(28);
    p.set([dims.nodes, dims.faces, dims.creases, dims.edges], 0);
    p.set([internals.foldPercent / 100, internals.dt, internals.material.axialStiffness, internals.material.faceStiffness], 4);
    p.set([0, 0, 0, 0], 8); // calcFaceStrain off: WebglSolver's default
    p.set(offsets.slice(0, 4), 12);
    p.set(offsets.slice(4, 8), 16);
    p.set(offsets.slice(8, 12), 20);
    p.set([offsets[12]!, 0, 0, 0], 24);

    const params = core.buffer({ label: 'params', size: p.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    core.device.queue.writeBuffer(params, 0, p);

    const lastPosition = gl.readTexture('u_lastPosition');
    const lastVelocity = gl.readTexture('u_lastVelocity');
    const lastTheta = gl.readTexture('u_lastTheta');
    const pos = [core.storageBuffer(lastPosition, 'posA'), core.storageBuffer(lastPosition, 'posB')] as const;
    const vel = [core.storageBuffer(lastVelocity, 'velA'), core.storageBuffer(lastVelocity, 'velB')] as const;
    const theta = [core.storageBuffer(lastTheta, 'thetaA'), core.storageBuffer(lastTheta, 'thetaB')] as const;
    const sides: [StepBuffers, StepBuffers] = [
      { lastPos: pos[0], curPos: pos[1], lastVel: vel[0], curVel: vel[1], lastTheta: theta[0], curTheta: theta[1] },
      { lastPos: pos[1], curPos: pos[0], lastVel: vel[1], curVel: vel[0], lastTheta: theta[1], curTheta: theta[0] },
    ];

    const pipe: Pipelines = {
      normalCalc: await core.computePipeline(NORMAL_CALC_WGSL, 'normalCalc'),
      thetaCalc: await core.computePipeline(THETA_CALC_WGSL, 'thetaCalc'),
      updateCreaseGeo: await core.computePipeline(UPDATE_CREASE_GEO_WGSL, 'updateCreaseGeo'),
      velocityCalc: await core.computePipeline(VELOCITY_CALC_WGSL, 'velocityCalc'),
      positionCalc: await core.computePipeline(POSITION_CALC_WGSL, 'positionCalc'),
    };
    return new FullStepSolver(
      core,
      pipe,
      core.storageBuffer(staticData, 'staticData'),
      params,
      core.storageBuffer(new Float32Array(Math.max(1, dims.faces) * 4), 'normals'),
      core.storageBuffer(new Float32Array(Math.max(1, dims.creases) * 4), 'creaseGeo'),
      sides,
      { nodes: dims.nodes, faces: dims.faces, creases: dims.creases }
    );
  }

  /** The five passes' bind groups for one parity, in dispatch order. Same bindings as the port's encodeStep. */
  private groupsFor(side: StepBuffers): GPUBindGroup[] {
    const { staticData: sd, params, normals, creaseGeo } = this;
    const group = (pipeline: GPUComputePipeline, buffers: GPUBuffer[]) =>
      this.core.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    return [
      group(this.pipe.normalCalc, [sd, side.lastPos, normals, params]),
      group(this.pipe.thetaCalc, [sd, side.lastPos, normals, side.lastTheta, side.curTheta, params]),
      group(this.pipe.updateCreaseGeo, [sd, side.lastPos, creaseGeo, params]),
      group(this.pipe.velocityCalc, [sd, side.lastPos, side.lastVel, normals, side.curTheta, creaseGeo, side.curVel, params]),
      group(this.pipe.positionCalc, [sd, side.curVel, side.lastPos, side.curPos, params]),
    ];
  }

  private get passes(): Array<[GPUComputePipeline, number]> {
    const { nodes, faces, creases } = this.counts;
    return [
      [this.pipe.normalCalc, faces],
      [this.pipe.thetaCalc, creases],
      [this.pipe.updateCreaseGeo, creases],
      [this.pipe.velocityCalc, nodes],
      [this.pipe.positionCalc, nodes],
    ];
  }

  /** Queue `steps` steps in one submit. Does not wait for them. */
  solve(steps: number, encoding: Encoding): void {
    this.core.assertLive();
    const encoder = this.core.device.createCommandEncoder();
    const passes = this.passes;
    if (encoding === 'cached') {
      const pass = encoder.beginComputePass();
      for (let s = 0; s < steps; s += 1) {
        const groups = this.cachedGroups[this.parity]!;
        passes.forEach(([pipeline, count], i) => {
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, groups[i]!);
          pass.dispatchWorkgroups(Math.ceil(Math.max(count, 1) / WORKGROUP_SIZE));
        });
        this.parity ^= 1;
      }
      pass.end();
    } else {
      for (let s = 0; s < steps; s += 1) {
        const groups = this.groupsFor(this.sides[this.parity]!);
        passes.forEach(([pipeline, count], i) => {
          const pass = encoder.beginComputePass();
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, groups[i]!);
          pass.dispatchWorkgroups(Math.ceil(Math.max(count, 1) / WORKGROUP_SIZE));
          pass.end();
        });
        this.parity ^= 1;
      }
    }
    this.core.device.queue.submit([encoder.finish()]);
  }

  finish(): Promise<void> {
    return this.core.device.queue.onSubmittedWorkDone();
  }

  /** Each node's displacement from the flat sheet, RGBA, as WebglSolver's u_lastPosition holds it. */
  readLastPosition(): Promise<Float32Array> {
    return this.core.readBuffer(this.sides[this.parity]!.lastPos);
  }
}
