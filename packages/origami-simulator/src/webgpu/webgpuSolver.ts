/// <reference types="@webgpu/types" />
import type { OrigamiModel } from '../model.js';
import {
  gripParameters,
  PULL_MOVED_CREASE_RADIANS,
  PULL_YIELD_RADIANS,
  validatedGrip,
  validatedRay,
  type CursorRay,
  type GripParameters,
  type PullGrip,
  type PullOutcome,
  type PullSummary,
} from '../pull.js';
import {
  assertSolverShape,
  copyFixedNodeMask,
  type MotionSample,
  type SolverBackend,
  type SolverShape,
} from '../solverBackend.js';
import type { FoldProfile, SimulatorDiagnostics, SimulatorOptions } from '../types.js';
import { packBeamMeta, packModel, timeStepFor, type PackedModel, type SolverMaterial } from '../webgl/packing.js';
import { sheetExtent, type CameraUniforms } from '../webgl/camera.js';
import { meshTopologyFor, type MeshDrawOptions, type RenderSettings } from '../webgl/meshRenderer.js';
import { WebgpuCanvasTarget } from './canvasTarget.js';
import { EDGE_SHADER, FACE_SHADER, WebgpuMeshRenderer, type WebgpuRenderTarget } from './meshRenderer.js';
import { GpuCore, workgroupsFor } from './gpuCore.js';
import { MOTION_REDUCTION_WGSL, MotionReduction } from './motionReduction.js';
import {
  APPLY_LENGTHS,
  CREASE_GEO_CALC,
  KEEP_ANGLES,
  KEEP_LENGTHS,
  NORMAL_CALC,
  PARAMS_VEC4S,
  POSITION_CALC,
  POSITION_CALC_VERLET,
  REST_ANGLES,
  THETA_CALC,
  VELOCITY_CALC,
  VELOCITY_CALC_VERLET,
  WORKGROUP_SIZE,
} from './passes.js';
import { materialArrays, packParams, packStaticData, type StaticArray, type StaticLayout } from './packing.js';

interface Pipelines {
  normalCalc: GPUComputePipeline;
  thetaCalc: GPUComputePipeline;
  updateCreaseGeo: GPUComputePipeline;
  velocityCalc: GPUComputePipeline;
  velocityCalcPosed: GPUComputePipeline;
  positionCalc: GPUComputePipeline;
  positionCalcVerlet: GPUComputePipeline;
  positionCalcVerletPosed: GPUComputePipeline;
  velocityCalcVerlet: GPUComputePipeline;
  restAngles: GPUComputePipeline;
  keepLengths: GPUComputePipeline;
  applyLengths: GPUComputePipeline;
  keepAngles: GPUComputePipeline;
}

/**
 * Which buffer holds which role. Positions rotate through three buffers (Verlet
 * keeps the step before last too); velocities and crease angles ping-pong
 * between two. Each index is into the matching buffer list.
 */
interface Roles {
  lastPos: number;
  curPos: number;
  lastLastPos: number;
  lastVel: number;
  curVel: number;
  lastTheta: number;
  curTheta: number;
}

/** One arrangement's bind groups: the five passes, unposed and posed. */
interface StepGroups {
  plain: GPUBindGroup[];
  posed: GPUBindGroup[];
}

/** A pull in progress; see `pull.ts`. */
interface GpuPull {
  grip: PullGrip;
  parameters: GripParameters;
  /** Each crease's angle at the press, from the latest sample: what "moved" is measured from. */
  pressTheta: Float32Array;
  /** The paper was posed at the press, so cancel restores those rest angles rather than dropping the pose. */
  hadPose: boolean;
}

/**
 * The paper's state as of the latest sample that has landed, for the reads the
 * interface makes synchronous. Within a tick of the solve while it moves, and
 * exact once it is still: nothing steps between the last sample and a read.
 */
interface Mirror {
  /** Displacement from the flat sheet, RGBA per node, as the position buffer holds it. */
  offsets: Float32Array;
  /** Velocity RGBA per node; alpha is the node's strain. */
  velocity: Float32Array;
  /** (theta, rest, face1, face2) per crease. */
  theta: Float32Array;
}

/** The rest-angle kernel's edits; see REST_ANGLES in passes.ts. */
const REST_PRESS = 0;
const REST_KEEP = 1;
const REST_RESTORE = 2;

/**
 * The GPU solver on WebGPU: both integrators, fixed nodes, the pull and the
 * pose, as compute passes over storage buffers, fed the same packed model as
 * {@link WebglSolver}. Its correctness is parity with WebglSolver and
 * ReferenceSolver (bench/webgpuSpike.bench.ts), not anything asserted here.
 *
 * Bind groups are built once per arrangement of the rotating buffers, and a
 * whole `step(count)` is one compute pass in one submit: encoding per dispatch
 * halves the speed in Safari.
 *
 * Reads. {@link sampleMotion} is asynchronous, so {@link SimulationClock} acts
 * on each sample when it lands. Each sample also refreshes a copy of the
 * positions, velocities and crease angles, which the synchronous reads
 * (`readPositions`, `readShape`, `readStrain`) answer from: within a tick of
 * the solve while it moves, and exact at rest. Edits that WebglSolver makes by
 * reading a texture back and writing it again — a pull's rest angles, Verlet's
 * history — are a compute pass or a buffer copy here, so they act on the state
 * as it is rather than as it was a tick ago.
 */
export class WebgpuSolver implements SolverBackend {
  readonly id = 'webgpu';

  private material: SolverMaterial;
  private foldPercent: number;
  private dt: number;
  private integrationType: 'euler' | 'verlet';
  private roles: Roles = { lastPos: 0, curPos: 1, lastLastPos: 2, lastVel: 0, curVel: 1, lastTheta: 0, curTheta: 1 };
  private currentStep = 0;
  private maxStrain = 0;
  private disposed = false;
  private poseActive = false;
  /** A kept shape's edge lengths and face angles are the rest state (in keptLengths and staticData). */
  private shapeKept = false;
  private pull: GpuPull | null = null;
  /** Bumped by anything that makes a readback in flight describe a state that is gone. */
  private generation = 0;
  private mirror: Mirror;
  private mirrorPending = false;
  /** Each mirror read's place in submission order; an older one landing late never replaces a newer one. */
  private mirrorRequested = 0;
  private mirrorApplied = 0;
  private readonly groupCache = new Map<string, StepGroups>();
  private meshRenderer: WebgpuMeshRenderer | null = null;
  /** Held until the renderer exists; see {@link setHighlightTriangles}. */
  private highlightTriangles: ArrayLike<number> | null = null;
  private canvasTarget: WebgpuCanvasTarget | null = null;
  private readonly nodeCount: number;
  private readonly originalPositions: Float32Array;
  private readonly shortestRestLength: number;

  private constructor(
    private readonly core: GpuCore,
    private ownsCore: boolean,
    private readonly model: OrigamiModel,
    private readonly packed: PackedModel,
    private readonly layout: StaticLayout,
    private readonly buffers: {
      staticData: GPUBuffer;
      params: GPUBuffer;
      restMode: GPUBuffer;
      normals: GPUBuffer;
      creaseGeo: GPUBuffer;
      creasePull: GPUBuffer;
      pressRest: GPUBuffer;
      edges: GPUBuffer;
      incidenceEdges: GPUBuffer;
      keptLengths: GPUBuffer;
      pos: readonly [GPUBuffer, GPUBuffer, GPUBuffer];
      vel: readonly [GPUBuffer, GPUBuffer];
      theta: readonly [GPUBuffer, GPUBuffer];
    },
    private readonly pipe: Pipelines,
    private readonly motion: MotionReduction,
    options: { material: SolverMaterial; foldPercent: number; integrationType: 'euler' | 'verlet' }
  ) {
    this.material = options.material;
    this.foldPercent = options.foldPercent;
    this.integrationType = options.integrationType;
    this.dt = timeStepFor(packed, this.material);
    this.nodeCount = packed.dims.nodes;
    this.originalPositions = model.originalPositions;
    this.shortestRestLength = packed.beamRestLength.reduce((shortest, rest) => Math.min(shortest, rest), Infinity);
    this.mirror = this.flatMirror();
    this.writeParams();
  }

  /**
   * Build a solver for `model`. Pass `core` to share a device, as a renderer
   * drawing from the solver's buffers must; without one the solver acquires
   * and owns its own.
   *
   * @throws {WebGpuUnavailableError} when no device can be had.
   */
  static async create(model: OrigamiModel, options: SimulatorOptions = {}, core?: GpuCore): Promise<WebgpuSolver> {
    const device = core ?? (await GpuCore.create());
    try {
      await WebgpuSolver.validateShaders(device);
      const solver = WebgpuSolver.createNow(model, options, device);
      if (core === undefined) solver.ownsCore = true;
      return solver;
    } catch (error) {
      if (core === undefined) device.dispose();
      throw error;
    }
  }

  /**
   * Compile and check every shader the solver and its renderer use, on `core`,
   * so that {@link createNow} can build from them synchronously and a WGSL
   * error is a throw here rather than a console warning later.
   *
   * @throws {Error} naming the shader and the error.
   */
  static async validateShaders(core: GpuCore): Promise<void> {
    const sources: Array<[string, string]> = [
      [NORMAL_CALC, 'normalCalc'],
      [THETA_CALC, 'thetaCalc'],
      [CREASE_GEO_CALC, 'updateCreaseGeo'],
      [VELOCITY_CALC, 'velocityCalc'],
      [POSITION_CALC, 'positionCalc'],
      [POSITION_CALC_VERLET, 'positionCalcVerlet'],
      [VELOCITY_CALC_VERLET, 'velocityCalcVerlet'],
      [REST_ANGLES, 'restAngles'],
      [KEEP_LENGTHS, 'keepLengths'],
      [APPLY_LENGTHS, 'applyLengths'],
      [KEEP_ANGLES, 'keepAngles'],
      [MOTION_REDUCTION_WGSL, 'motionReduction'],
      [FACE_SHADER, 'faces'],
      [EDGE_SHADER, 'creases'],
    ];
    for (const [code, label] of sources) await core.validate(code, label);
  }

  /**
   * {@link create}, synchronously, on a core that has run
   * {@link validateShaders}: for a caller that cannot wait, such as a worker
   * loading a model inside a synchronous call. The core stays the caller's.
   */
  static createNow(model: OrigamiModel, options: SimulatorOptions, device: GpuCore): WebgpuSolver {
    const material: SolverMaterial = {
      axialStiffness: options.axialStiffness ?? 20,
      creaseStiffness: options.creaseStiffness ?? 0.7,
      panelStiffness: options.panelStiffness ?? 0.7,
      faceStiffness: options.faceStiffness ?? 0.2,
      damping: options.damping ?? 0.45,
      timeStepScale: options.timeStepScale ?? 1,
    };
    const packed = packModel(model, material);
    const layout = packStaticData(packed, material);
    const dims = packed.dims;
    const zeros = () => new Float32Array(dims.textureDim * dims.textureDim * 4);
    const perCrease = () => new Float32Array(Math.max(1, dims.creases) * 4);
    // The pull's baseline buffer: .y says whether a crease is a fold, which never changes.
    const creasePull = perCrease();
    for (let crease = 0; crease < dims.creases; crease += 1) {
      creasePull[crease * 4 + 1] = packed.creaseIsFlat[crease] ? 0 : 1;
    }
    // The kept-shape kernels' inputs: each edge's ends and sheet length, and
    // the edge each beam incidence belongs to.
    const edgesVertices = model.prepared.edgesVertices;
    const edges = new Float32Array(Math.max(1, edgesVertices.length) * 4);
    edgesVertices.forEach(([a, b], edge) => edges.set([a, b, model.edgeRestLength(edge), 0], edge * 4));
    const incidenceEdges = new Float32Array(Math.max(1, dims.edges) * 4);
    for (let i = 0; i < dims.edges; i += 1) incidenceEdges[i * 4] = packed.beamEdge[i]!;
    const uniform = (label: string, size: number) =>
      device.buffer({ label, size, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const buffers = {
      staticData: device.storageBuffer(layout.data, 'staticData'),
      params: uniform('params', PARAMS_VEC4S * 16),
      restMode: uniform('restMode', 16),
      normals: device.storageBuffer(new Float32Array(Math.max(1, dims.faces) * 4), 'normals'),
      creaseGeo: device.storageBuffer(perCrease(), 'creaseGeo'),
      creasePull: device.storageBuffer(creasePull, 'creasePull'),
      pressRest: device.storageBuffer(perCrease(), 'pressRest'),
      edges: device.storageBuffer(edges, 'edges'),
      incidenceEdges: device.storageBuffer(incidenceEdges, 'incidenceEdges'),
      keptLengths: device.storageBuffer(new Float32Array(Math.max(4, edgesVertices.length)), 'keptLengths'),
      pos: [
        device.storageBuffer(zeros(), 'posA'),
        device.storageBuffer(zeros(), 'posB'),
        device.storageBuffer(zeros(), 'posC'),
      ] as const,
      vel: [device.storageBuffer(zeros(), 'velA'), device.storageBuffer(zeros(), 'velB')] as const,
      theta: [device.storageBuffer(packed.thetaInit, 'thetaA'), device.storageBuffer(packed.thetaInit, 'thetaB')] as const,
    };
    const posed = { POSED: 1 };
    const pipe: Pipelines = {
      normalCalc: device.computePipelineNow(NORMAL_CALC, 'normalCalc'),
      thetaCalc: device.computePipelineNow(THETA_CALC, 'thetaCalc'),
      updateCreaseGeo: device.computePipelineNow(CREASE_GEO_CALC, 'updateCreaseGeo'),
      velocityCalc: device.computePipelineNow(VELOCITY_CALC, 'velocityCalc'),
      velocityCalcPosed: device.computePipelineNow(VELOCITY_CALC, 'velocityCalcPosed', posed),
      positionCalc: device.computePipelineNow(POSITION_CALC, 'positionCalc'),
      positionCalcVerlet: device.computePipelineNow(POSITION_CALC_VERLET, 'positionCalcVerlet'),
      positionCalcVerletPosed: device.computePipelineNow(POSITION_CALC_VERLET, 'positionCalcVerletPosed', posed),
      velocityCalcVerlet: device.computePipelineNow(VELOCITY_CALC_VERLET, 'velocityCalcVerlet'),
      restAngles: device.computePipelineNow(REST_ANGLES, 'restAngles'),
      keepLengths: device.computePipelineNow(KEEP_LENGTHS, 'keepLengths'),
      applyLengths: device.computePipelineNow(APPLY_LENGTHS, 'applyLengths'),
      keepAngles: device.computePipelineNow(KEEP_ANGLES, 'keepAngles'),
    };
    const motion = MotionReduction.createNow(device, buffers.vel, dims.nodes);
    return new WebgpuSolver(device, false, model, packed, layout, buffers, pipe, motion, {
      material,
      foldPercent: clampPercent(options.foldPercent ?? 0),
      integrationType: options.integrationType === 'verlet' ? 'verlet' : 'euler',
    });
  }

  get stepCount(): number {
    return this.currentStep;
  }

  get vertexCount(): number {
    return this.nodeCount;
  }

  get posed(): boolean {
    return this.poseActive;
  }

  get pulling(): boolean {
    return this.pull !== null;
  }

  /** True once the device has gone away; every result is stale. */
  get deviceLost(): boolean {
    return this.core.lost;
  }

  /** The device this solver runs on, for a renderer drawing from its buffers. */
  get gpu(): GpuCore {
    return this.core;
  }

  /** Each node's displacement from the flat sheet, RGBA: what a renderer draws from. */
  get positionBuffer(): GPUBuffer {
    return this.buffers.pos[this.roles.lastPos];
  }

  /** Each node's velocity, RGBA, with its strain in alpha: what a strain colouring draws from. */
  get velocityBuffer(): GPUBuffer {
    return this.buffers.vel[this.roles.lastVel];
  }

  /**
   * Draw to `canvas` when `render` is given no target. Takes a canvas, which
   * this solver then configures for its device, or a target already
   * configured, which several solvers sharing a canvas and a device share.
   *
   * @throws {Error} when the canvas holds a context of another kind.
   */
  attachCanvas(canvas: HTMLCanvasElement | OffscreenCanvas | WebgpuCanvasTarget): void {
    const target = canvas instanceof WebgpuCanvasTarget ? canvas : WebgpuCanvasTarget.create(canvas, this.core);
    if (!target) throw new Error('The canvas already holds a context that is not WebGPU');
    this.canvasTarget = target;
  }

  /** The canvas frames are drawn at, clamped to what the device can back; 0x0 with no canvas. */
  get drawingBufferSize(): { width: number; height: number } {
    return this.canvasTarget ? this.canvasTarget.drawingBufferSize(this.core) : { width: 0, height: 0 };
  }

  /**
   * Draw the mesh straight from the position buffer into `target`, or the
   * attached canvas when it is null: WebglSolver.render's counterpart, on the
   * same settings and options.
   */
  render(
    camera: CameraUniforms,
    settings: RenderSettings,
    target: WebgpuRenderTarget | null = null,
    options: MeshDrawOptions = {}
  ): void {
    const drawTo = target ?? this.canvasTarget?.current();
    if (!drawTo) throw new Error('WebgpuSolver.render needs a target or an attached canvas');
    this.renderer().render(camera, settings, drawTo, options);
  }

  /** Render offscreen and read the pixels back, rows top to bottom. For tests, thumbnails and checks. */
  renderToPixels(camera: CameraUniforms, settings: RenderSettings, options: MeshDrawOptions = {}): Promise<Uint8Array> {
    return this.renderer().renderToPixels(camera, settings, options);
  }

  /** The triangles a frame drawn with `highlight` tints — the pinned faces. */
  setHighlightTriangles(triangles: ArrayLike<number> | null): void {
    this.highlightTriangles = triangles;
    this.meshRenderer?.setHighlightTriangles(triangles);
  }

  private renderer(): WebgpuMeshRenderer {
    if (!this.meshRenderer) {
      const topology = meshTopologyFor(this.model.prepared, this.packed.dims.textureDim);
      this.meshRenderer = new WebgpuMeshRenderer(
        this.core,
        topology,
        this.packed.originalPosition,
        { positions: () => this.positionBuffer, velocities: () => this.velocityBuffer },
        { sheet: sheetExtent(this.originalPositions) }
      );
      this.meshRenderer.setHighlightTriangles(this.highlightTriangles);
    }
    return this.meshRenderer;
  }

  step(count: number): void {
    if (count <= 0) return;
    this.core.assertLive();
    const { faces, creases, nodes } = this.packed.dims;
    const verlet = this.integrationType === 'verlet';
    const sizes = [faces, creases, creases, nodes, nodes];
    const pipelines = this.stepPipelines();
    const encoder = this.core.device.createCommandEncoder({ label: 'solver step' });
    const pass = encoder.beginComputePass();
    for (let s = 0; s < count; s += 1) {
      const sets = this.groupsFor(this.roles, verlet);
      const groups = this.poseActive ? sets.posed : sets.plain;
      pipelines.forEach((pipeline, i) => {
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, groups[i]!);
        pass.dispatchWorkgroups(workgroupsFor(sizes[i]!, WORKGROUP_SIZE));
      });
      this.roles = verlet ? rotateVerlet(this.roles) : rotateEuler(this.roles);
    }
    pass.end();
    this.core.device.queue.submit([encoder.finish()]);
    this.currentStep += count;
  }

  /**
   * The motion as of every step submitted so far, read back asynchronously.
   * The velocity buffer's alpha holds each node's strain, so one reduction
   * answers both, as `WebglSolver.maxVelocity` does from its texture. Also
   * refreshes the copy the synchronous reads answer from.
   */
  async sampleMotion(): Promise<MotionSample> {
    void this.refreshMirror();
    const sample = await this.motion.sample(this.roles.lastVel);
    this.maxStrain = sample.maxStrain;
    return sample;
  }

  setFoldPercent(percent: number): void {
    this.foldPercent = clampPercent(percent);
    this.writeParams();
  }

  setFoldProfile(_profile: FoldProfile | null): void {
    // As WebglSolver: fold profiles are handled by backend selection, which
    // gives them the reference solver.
  }

  setMaterial(options: Partial<SimulatorOptions>): void {
    this.material = {
      axialStiffness: options.axialStiffness ?? this.material.axialStiffness,
      creaseStiffness: options.creaseStiffness ?? this.material.creaseStiffness,
      panelStiffness: options.panelStiffness ?? this.material.panelStiffness,
      faceStiffness: options.faceStiffness ?? this.material.faceStiffness,
      damping: options.damping ?? this.material.damping,
      timeStepScale: options.timeStepScale ?? this.material.timeStepScale,
    };
    if (options.integrationType !== undefined) {
      const next = options.integrationType === 'verlet' ? 'verlet' : 'euler';
      // As WebglSolver: starting Verlet mid-solve would read a stale step
      // before last as history; seeding it from now starts Verlet at rest.
      if (next !== this.integrationType && next === 'verlet') this.seedVerletHistory();
      this.integrationType = next;
    }
    if (options.foldPercent !== undefined) this.foldPercent = clampPercent(options.foldPercent);
    this.dt = timeStepFor(this.packed, this.material);
    const arrays = materialArrays(this.packed, this.material);
    this.writeStatic('beamMeta', arrays.beamMeta);
    this.writeStatic('creaseMeta', arrays.creaseMeta);
    // A kept shape's rest lengths survive a material change, as WebglSolver keeps them.
    if (this.shapeKept) this.runKeep(['applyLengths']);
    if (this.pull) this.pull.parameters = this.gripParametersFor(this.pull.grip);
    this.writeParams();
  }

  /** Back to the flat sheet at rest, as WebglSolver.reset does. */
  reset(): void {
    const zeros = this.zeros();
    for (const buffer of [...this.buffers.pos, ...this.buffers.vel]) this.core.write(buffer, 0, zeros);
    for (const buffer of this.buffers.theta) this.core.write(buffer, 0, this.packed.thetaInit);
    this.currentStep = 0;
    this.maxStrain = 0;
    this.releasePose();
    this.forgetReadbacks();
    this.mirror = this.flatMirror();
  }

  /** Zero the velocities and keep the fold, as WebglSolver.arrestDynamics does. */
  arrestDynamics(): void {
    const zeros = this.zeros();
    for (const buffer of this.buffers.vel) this.core.write(buffer, 0, zeros);
    // Verlet carries its velocity as the gap between the last two positions.
    if (this.integrationType === 'verlet') this.seedVerletHistory();
  }

  setFixedNodes(mask: Uint8Array | null): void {
    const fixed = copyFixedNodeMask(mask, this.nodeCount);
    // As WebglSolver: the flag rides in mass.y, which every integrating pass reads.
    for (let i = 0; i < this.nodeCount; i += 1) this.packed.mass[i * 4 + 1] = fixed?.[i] ? 1 : 0;
    this.writeStatic('mass', this.packed.mass);
  }

  beginPull(grip: PullGrip): void {
    const valid = validatedGrip(grip, this.nodeCount);
    if (this.pull) this.endPull('cancel');
    const creases = this.packed.dims.creases;
    const pressTheta = new Float32Array(creases);
    for (let crease = 0; crease < creases; crease += 1) pressTheta[crease] = this.mirror.theta[crease * 4]!;
    // Rest angles from the pose, or the fold target as velocityCalc forms it,
    // so taking a pose from it changes no crease's aim; and each crease's
    // baseline for the yield. On the GPU, where the angles are.
    this.runRestAngles(REST_PRESS);
    this.pull = { grip: valid, parameters: this.gripParametersFor(valid), pressTheta, hadPose: this.poseActive };
    this.poseActive = true;
    this.writeParams();
  }

  movePull(ray: CursorRay): void {
    if (!this.pull) return;
    this.pull.grip = { ...this.pull.grip, ray: validatedRay(ray) };
    this.writeParams();
  }

  endPull(outcome: PullOutcome): PullSummary {
    const pull = this.pull;
    if (!pull) return { movedCreases: 0 };
    this.pull = null;
    if (outcome === 'cancel') {
      if (pull.hadPose) this.runRestAngles(REST_RESTORE);
      else this.poseActive = false;
      this.writeParams();
      return { movedCreases: 0 };
    }
    // Counted on the latest sample, which is what the pull's frames show.
    let movedCreases = 0;
    for (let crease = 0; crease < this.packed.dims.creases; crease += 1) {
      const turned = Math.abs(this.mirror.theta[crease * 4]! - pull.pressTheta[crease]!);
      if (!this.packed.creaseIsFlat[crease] && turned > PULL_MOVED_CREASE_RADIANS) movedCreases += 1;
    }
    this.runRestAngles(REST_KEEP);
    this.keepInPlaneShape();
    this.writeParams();
    return { movedCreases };
  }

  releasePose(): void {
    this.pull = null;
    this.poseActive = false;
    if (this.shapeKept) {
      this.shapeKept = false;
      this.writeStatic('beamMeta', packBeamMeta(this.packed, this.material));
      this.writeStatic('nominalTriangles', this.packed.nominalTriangles);
    }
    this.writeParams();
  }

  readDiagnostics(): SimulatorDiagnostics {
    return { ...this.model.prepared.diagnostics, usedCpuFallback: false, maxNodalStrain: this.maxStrain };
  }

  /** Absolute positions as of the latest sample. See the class comment on reads. */
  readPositions(into: Float32Array): number {
    const offsets = this.mirror.offsets;
    const count = Math.min(into.length, this.nodeCount * 3);
    for (let i = 0; i < count / 3; i += 1) {
      into[i * 3] = (this.originalPositions[i * 3] ?? 0) + offsets[i * 4]!;
      into[i * 3 + 1] = (this.originalPositions[i * 3 + 1] ?? 0) + offsets[i * 4 + 1]!;
      into[i * 3 + 2] = (this.originalPositions[i * 3 + 2] ?? 0) + offsets[i * 4 + 2]!;
    }
    return count;
  }

  /** Absolute positions as of every step submitted so far, read back for this call. */
  async readPositionsAsync(into: Float32Array): Promise<number> {
    await this.refreshMirror(true);
    return this.readPositions(into);
  }

  /** Wait until the synchronous reads describe every step submitted so far. */
  async syncReads(): Promise<void> {
    await this.refreshMirror(true);
  }

  readShape(into: SolverShape): void {
    assertSolverShape(into, this.nodeCount, this.packed.dims.creases);
    for (let node = 0; node < this.nodeCount; node += 1) {
      into.offsets[node * 3] = this.mirror.offsets[node * 4]!;
      into.offsets[node * 3 + 1] = this.mirror.offsets[node * 4 + 1]!;
      into.offsets[node * 3 + 2] = this.mirror.offsets[node * 4 + 2]!;
    }
    for (let crease = 0; crease < this.packed.dims.creases; crease += 1) into.theta[crease] = this.mirror.theta[crease * 4]!;
  }

  writeShape(shape: SolverShape, keep: boolean): void {
    assertSolverShape(shape, this.nodeCount, this.packed.dims.creases);
    this.releasePose();
    // Every step of history at the shape, as the reference does: equal history
    // is a node at rest, under either integrator.
    const offsets = this.zeros();
    for (let node = 0; node < this.nodeCount; node += 1) {
      for (let axis = 0; axis < 3; axis += 1) offsets[node * 4 + axis] = shape.offsets[node * 3 + axis]!;
    }
    for (const buffer of this.buffers.pos) this.core.write(buffer, 0, offsets);
    const still = this.zeros();
    for (const buffer of this.buffers.vel) this.core.write(buffer, 0, still);
    const thetas = this.packed.thetaInit.slice();
    for (let crease = 0; crease < this.packed.dims.creases; crease += 1) {
      thetas[crease * 4] = shape.theta[crease]!;
      thetas[crease * 4 + 1] = keep ? shape.theta[crease]! : 0;
    }
    for (const buffer of this.buffers.theta) this.core.write(buffer, 0, thetas);
    this.forgetReadbacks();
    this.mirror = { offsets, velocity: still, theta: thetas };
    if (!keep) return;
    this.keepInPlaneShape();
    this.poseActive = true;
    this.writeParams();
  }

  readColors(into: Float32Array): number {
    // As WebglSolver: strain colouring is drawn on the GPU; this is the flat grey.
    into.fill(0.75);
    return Math.min(into.length, this.nodeCount * 3);
  }

  /** Per-node strain as of the latest sample. */
  readStrain(into: Float32Array): number {
    const count = Math.min(into.length, this.nodeCount);
    for (let i = 0; i < count; i += 1) into[i] = this.mirror.velocity[i * 4 + 3]!;
    return count;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.forgetReadbacks();
    this.meshRenderer?.dispose();
    this.motion.dispose();
    const { pos, vel, theta, ...singles } = this.buffers;
    for (const buffer of [...Object.values(singles), ...pos, ...vel, ...theta]) this.core.release(buffer);
    if (this.ownsCore) this.core.dispose();
  }

  private stepPipelines(): GPUComputePipeline[] {
    const p = this.pipe;
    const posed = this.poseActive;
    if (this.integrationType === 'verlet') {
      const force = posed ? p.positionCalcVerletPosed : p.positionCalcVerlet;
      return [p.normalCalc, p.thetaCalc, p.updateCreaseGeo, force, p.velocityCalcVerlet];
    }
    return [p.normalCalc, p.thetaCalc, p.updateCreaseGeo, posed ? p.velocityCalcPosed : p.velocityCalc, p.positionCalc];
  }

  /**
   * The five passes' bind groups for one arrangement of the rotating buffers,
   * built the first time it is seen. Euler cycles through 2 arrangements and
   * Verlet through 6, so the cache stays small. The posed and unposed force
   * pipelines are separate objects, so each gets its own group.
   */
  private groupsFor(r: Roles, verlet: boolean): StepGroups {
    const key = `${verlet ? 'verlet' : 'euler'}:${r.lastPos}${r.curPos}${r.lastLastPos}${r.lastVel}${r.curVel}${r.lastTheta}`;
    const cached = this.groupCache.get(key);
    if (cached) return cached;
    const { staticData: sd, params, normals, creaseGeo, creasePull, pos, vel, theta } = this.buffers;
    const p = this.pipe;
    const group = (pipeline: GPUComputePipeline, buffers: GPUBuffer[]) =>
      this.core.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    const first = [
      group(p.normalCalc, [sd, pos[r.lastPos], normals, params]),
      group(p.thetaCalc, [sd, pos[r.lastPos], normals, theta[r.lastTheta], theta[r.curTheta], creasePull, params]),
      group(p.updateCreaseGeo, [sd, pos[r.lastPos], creaseGeo, params]),
    ];
    let sets: StepGroups;
    if (verlet) {
      const force = [sd, pos[r.lastPos], vel[r.lastVel], pos[r.lastLastPos], normals, theta[r.curTheta], creaseGeo, pos[r.curPos], params];
      const last = group(p.velocityCalcVerlet, [sd, pos[r.curPos], pos[r.lastPos], vel[r.curVel], params]);
      sets = {
        plain: [...first, group(p.positionCalcVerlet, force), last],
        posed: [...first, group(p.positionCalcVerletPosed, force), last],
      };
    } else {
      const force = [sd, pos[r.lastPos], vel[r.lastVel], normals, theta[r.curTheta], creaseGeo, vel[r.curVel], params];
      const last = group(p.positionCalc, [sd, vel[r.curVel], pos[r.lastPos], pos[r.curPos], params]);
      sets = {
        plain: [...first, group(p.velocityCalc, force), last],
        posed: [...first, group(p.velocityCalcPosed, force), last],
      };
    }
    this.groupCache.set(key, sets);
    return sets;
  }

  /** Run the rest-angle kernel (passes.ts REST_ANGLES) on the last theta buffer. */
  private runRestAngles(mode: number): void {
    this.writeParams();
    this.core.write(this.buffers.restMode, 0, new Float32Array([mode, this.roles.lastTheta, 0, 0]));
    const { staticData, theta, creasePull, pressRest, params, restMode } = this.buffers;
    const group = this.core.device.createBindGroup({
      layout: this.pipe.restAngles.getBindGroupLayout(0),
      entries: [staticData, theta[0], theta[1], creasePull, pressRest, params, restMode].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
    const encoder = this.core.device.createCommandEncoder({ label: 'rest angles' });
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipe.restAngles);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(workgroupsFor(this.packed.dims.creases, WORKGROUP_SIZE));
    pass.end();
    this.core.device.queue.submit([encoder.finish()]);
  }

  /** The step before last becomes the last step: zero implied Verlet velocity. A copy on the GPU, exact. */
  private seedVerletHistory(): void {
    const { pos } = this.buffers;
    this.core.copy(pos[this.roles.lastPos], pos[this.roles.lastLastPos], pos[this.roles.lastPos].size);
  }

  /**
   * The shape as it is becomes the paper's rest state: edge lengths and face
   * angles (passes.ts KEEP_*), as WebglSolver's keepInPlaneShape does. On the
   * GPU, in queue order, so the next step already sees it.
   */
  private keepInPlaneShape(): void {
    this.runKeep(['keepLengths', 'applyLengths', 'keepAngles']);
    this.shapeKept = true;
  }

  /** Encode the named kept-shape passes, in order, in one submit. */
  private runKeep(passes: ReadonlyArray<'keepLengths' | 'applyLengths' | 'keepAngles'>): void {
    this.writeParams();
    const { staticData, edges, incidenceEdges, keptLengths, params } = this.buffers;
    const lastPos = this.buffers.pos[this.roles.lastPos];
    const bindings = {
      keepLengths: [staticData, lastPos, edges, keptLengths, params],
      applyLengths: [staticData, incidenceEdges, keptLengths, params],
      keepAngles: [staticData, lastPos, params],
    };
    const sizes = {
      keepLengths: Math.max(1, this.model.prepared.edgesVertices.length),
      applyLengths: Math.max(1, this.packed.dims.edges),
      keepAngles: this.packed.dims.faces,
    };
    const encoder = this.core.device.createCommandEncoder({ label: 'keep shape' });
    const pass = encoder.beginComputePass();
    for (const name of passes) {
      const pipeline = this.pipe[name];
      pass.setPipeline(pipeline);
      pass.setBindGroup(
        0,
        this.core.device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: bindings[name].map((buffer, binding) => ({ binding, resource: { buffer } })),
        })
      );
      pass.dispatchWorkgroups(workgroupsFor(sizes[name], WORKGROUP_SIZE));
    }
    pass.end();
    this.core.device.queue.submit([encoder.finish()]);
  }

  /**
   * Copy positions, velocities and crease angles back for the synchronous
   * reads, in one submit so they describe one moment. One read in flight at a
   * time unless `force`, which a caller that needs the state as of now uses.
   */
  private refreshMirror(force = false): Promise<void> {
    if (this.mirrorPending && !force) return Promise.resolve();
    this.mirrorPending = true;
    const generation = this.generation;
    this.mirrorRequested += 1;
    const sequence = this.mirrorRequested;
    const { pos, vel, theta } = this.buffers;
    return this.core
      .readBuffers([pos[this.roles.lastPos], vel[this.roles.lastVel], theta[this.roles.lastTheta]])
      .then(([offsets, velocity, thetas]) => {
        if (generation !== this.generation) return;
        if (sequence === this.mirrorRequested) this.mirrorPending = false;
        if (sequence < this.mirrorApplied) return;
        this.mirrorApplied = sequence;
        this.mirror = { offsets: offsets!, velocity: velocity!, theta: thetas! };
      })
      .catch(() => {
        if (generation === this.generation) this.mirrorPending = false;
      });
  }

  /** Readbacks in flight describe a state that is gone: drop them when they land. */
  private forgetReadbacks(): void {
    this.generation += 1;
    this.mirrorPending = false;
  }

  private flatMirror(): Mirror {
    return { offsets: this.zeros(), velocity: this.zeros(), theta: this.packed.thetaInit.slice() };
  }

  private zeros(): Float32Array {
    return new Float32Array(this.packed.dims.textureDim * this.packed.dims.textureDim * 4);
  }

  private writeStatic(name: StaticArray, data: Float32Array): void {
    this.core.write(this.buffers.staticData, this.layout.offsets[name] * 16, data);
  }

  private gripParametersFor(grip: PullGrip): GripParameters {
    return gripParameters(this.material.axialStiffness, this.shortestRestLength, grip.weights);
  }

  private writeParams(): void {
    const dims = this.packed.dims;
    const pull = this.pull;
    const params = packParams(
      {
        nodes: dims.nodes,
        faces: dims.faces,
        creases: dims.creases,
        creasePercent: this.foldPercent / 100,
        dt: this.dt,
        axialStiffness: this.material.axialStiffness,
        faceStiffness: this.material.faceStiffness,
        posed: this.poseActive,
        yieldRadians: PULL_YIELD_RADIANS,
        grip: pull
          ? {
              nodes: pull.grip.nodes,
              weights: pull.grip.weights,
              rayOrigin: pull.grip.ray.origin,
              rayDirection: pull.grip.ray.direction,
              ...pull.parameters,
            }
          : null,
      },
      this.layout.offsets
    );
    this.core.write(this.buffers.params, 0, params);
  }
}

/** After an Euler step: this step's outputs become the last ones. */
function rotateEuler(r: Roles): Roles {
  return {
    ...r,
    lastPos: r.curPos,
    curPos: r.lastPos,
    lastVel: r.curVel,
    curVel: r.lastVel,
    lastTheta: r.curTheta,
    curTheta: r.lastTheta,
  };
}

/**
 * After a Verlet step, in WebglSolver's swap order: the last position becomes
 * the one before last, this step's becomes the last, and the old one before
 * last is the next step's scratch.
 */
function rotateVerlet(r: Roles): Roles {
  return {
    lastLastPos: r.lastPos,
    lastPos: r.curPos,
    curPos: r.lastLastPos,
    lastVel: r.curVel,
    curVel: r.lastVel,
    lastTheta: r.curTheta,
    curTheta: r.lastTheta,
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 100 ? 100 : value;
}
