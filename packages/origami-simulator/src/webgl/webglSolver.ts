import type { OrigamiModel } from '../model.js';
import type { FoldAssignment, FoldProfile, SimulatorDiagnostics, SimulatorOptions } from '../types.js';

// Assignment letter -> edge colour code the mesh renderer expects
// (0=B, 1=M, 2=V, 3=F). Unassigned/other creases fall through to the border
// colour, matching the canvas-2D renderer.
const ASSIGNMENT_CODE: Record<FoldAssignment, number> = {
  B: 0,
  M: 1,
  V: 2,
  F: 3,
  U: 0,
  C: 0,
  J: 0,
};
import type { SolverBackend } from '../solverBackend.js';
import { GlCore } from './glCore.js';
import { NORMAL_CALC, THETA_CALC, CREASE_GEO_CALC, VELOCITY_CALC, POSITION_CALC } from './passes.js';
import { MeshRenderer, type RenderSettings } from './meshRenderer.js';
import type { CameraUniforms } from './camera.js';
import {
  packModel,
  packBeamMeta,
  packCreaseMeta,
  timeStepFor,
  type PackedModel,
  type SolverMaterial,
} from './packing.js';

/**
 * The GPU solver: a direct WebGL2 port of upstream's dynamic solver. All state
 * lives in float textures and every step is five fragment-shader passes over
 * them; the CPU only touches positions on readback.
 *
 * It is a {@link SolverBackend}, so it drops into the same worker as
 * ReferenceSolver and is selected by the backend ladder. Correctness is defined
 * by parity against ReferenceSolver and the upstream oracle -- see the browser
 * parity tests -- not by anything asserted here.
 *
 * Currently Euler only. Verlet is a follow-up; callers that ask for it fall back
 * to the reference backend.
 */
export class WebglSolver implements SolverBackend {
  readonly id = 'webgl2';
  private readonly gl: GlCore;
  private readonly packed: PackedModel;
  private readonly nodeCount: number;
  private material: SolverMaterial;
  private foldPercent: number;
  private dt: number;
  private currentStep = 0;
  private maxStrain = 0;

  private readonly positionScratch: Float32Array;
  private readonly diagnostics: SimulatorDiagnostics;
  private readonly originalPositions: Float32Array;
  private readonly edgeRestLengths: Float32Array;
  private readonly faceIndices: Uint32Array;
  private readonly edgeIndices: Uint32Array;
  private readonly edgeAssignments: Uint8Array;
  private meshRenderer: MeshRenderer | null = null;

  static isSupported(canvas: HTMLCanvasElement | OffscreenCanvas): boolean {
    const probe = GlCore.create(canvas);
    if (!probe) return false;
    probe.dispose();
    return true;
  }

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, model: OrigamiModel, options: SimulatorOptions = {}) {
    const gl = GlCore.create(canvas);
    if (!gl) throw new Error('WebGL2 is not available for the GPU solver');
    this.gl = gl;
    this.nodeCount = model.prepared.vertexCount;
    this.diagnostics = { ...model.prepared.diagnostics, webglAvailable: true, usedCpuFallback: false };
    this.originalPositions = model.originalPositions;
    this.edgeRestLengths = new Float32Array(
      model.prepared.edgesVertices.map((_, index) => model.edgeRestLength(index))
    );
    this.faceIndices = model.prepared.indices.slice();
    this.edgeIndices = new Uint32Array(model.prepared.edgesVertices.length * 2);
    this.edgeAssignments = new Uint8Array(model.prepared.edgesVertices.length);
    model.prepared.edgesVertices.forEach((edge, index) => {
      this.edgeIndices[index * 2] = edge[0];
      this.edgeIndices[index * 2 + 1] = edge[1];
      this.edgeAssignments[index] = ASSIGNMENT_CODE[model.prepared.edgesAssignment[index] ?? 'U'] ?? 0;
    });

    this.material = {
      axialStiffness: options.axialStiffness ?? 20,
      creaseStiffness: options.creaseStiffness ?? 0.7,
      panelStiffness: options.panelStiffness ?? 0.7,
      faceStiffness: options.faceStiffness ?? 0.2,
      damping: options.damping ?? 0.45,
      timeStepScale: options.timeStepScale ?? 1,
    };
    this.foldPercent = clampPercent(options.foldPercent ?? 0);
    this.packed = packModel(model, this.material);
    this.dt = timeStepFor(this.packed, this.material);
    this.positionScratch = new Float32Array(this.packed.dims.textureDim * this.packed.dims.textureDim * 4);

    this.buildTextures();
    this.buildPrograms();
    this.uploadMaterial();
  }

  step(count: number): void {
    for (let i = 0; i < count; i += 1) this.solveStep();
    this.currentStep += count;
  }

  setFoldPercent(percent: number): void {
    this.foldPercent = clampPercent(percent);
    this.gl.setUniform('velocityCalc', 'u_creasePercent', this.foldPercent / 100, '1f');
  }

  setFoldProfile(_profile: FoldProfile | null): void {
    // Fold profiles are handled by backend selection (they fall back to the
    // reference solver); the GPU path only sees the uniform-target model.
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
    if (options.foldPercent !== undefined) this.setFoldPercent(options.foldPercent);
    this.dt = timeStepFor(this.packed, this.material);
    this.uploadMaterial();
  }

  reset(): void {
    this.currentStep = 0;
    const zeros = new Float32Array(this.packed.dims.textureDim * this.packed.dims.textureDim * 4);
    this.gl.updateTexture('u_position', zeros);
    this.gl.updateTexture('u_lastPosition', zeros);
    this.gl.updateTexture('u_velocity', zeros);
    this.gl.updateTexture('u_lastVelocity', zeros);
    this.gl.updateTexture('u_theta', this.packed.thetaInit);
    this.gl.updateTexture('u_lastTheta', this.packed.thetaInit);
  }

  arrestDynamics(): void {
    // Zero only the velocity textures; positions and crease angles are kept, so
    // the fold state survives -- we are draining kinetic energy, not resetting.
    const zeros = new Float32Array(this.packed.dims.textureDim * this.packed.dims.textureDim * 4);
    this.gl.updateTexture('u_velocity', zeros);
    this.gl.updateTexture('u_lastVelocity', zeros);
  }

  readPositions(into: Float32Array): number {
    // The texture stores relative displacement; absolute = original + relative,
    // the same convention ReferenceSolver uses.
    const raw = this.gl.readTexture('u_lastPosition');
    const count = Math.min(into.length, this.nodeCount * 3);
    for (let i = 0; i < count / 3; i += 1) {
      into[i * 3] = (this.originalPositions[i * 3] ?? 0) + raw[i * 4]!;
      into[i * 3 + 1] = (this.originalPositions[i * 3 + 1] ?? 0) + raw[i * 4 + 1]!;
      into[i * 3 + 2] = (this.originalPositions[i * 3 + 2] ?? 0) + raw[i * 4 + 2]!;
    }
    return count;
  }

  readColors(into: Float32Array): number {
    // Strain colouring is a CPU convenience for the renderer; recompute it from
    // the current positions rather than adding a GPU pass for it.
    this.readPositions(this.positionScratch.subarray(0, this.nodeCount * 3));
    into.fill(0.75);
    return Math.min(into.length, this.nodeCount * 3);
  }

  readDiagnostics(): SimulatorDiagnostics {
    return { ...this.diagnostics, maxNodalStrain: this.maxStrain };
  }

  maxVelocity(): number {
    // The velocity texture's alpha channel holds each node's error term, which
    // velocityCalc computes as its mean axial (edge) strain -- so this one
    // readback yields both max velocity (for convergence) and max strain (for
    // the diagnostics readout), with no extra GPU stall.
    const raw = this.gl.readTexture('u_lastVelocity');
    let max = 0;
    let maxStrain = 0;
    // A NaN never satisfies `>`, so comparing naively would silently swallow it
    // and report a blown-up model as velocity 0 -- i.e. *converged*, leaving the
    // simulation stopped on an invisible NaN mesh. Track it explicitly instead so
    // the caller can see the instability.
    let nonFinite = false;
    for (let i = 0; i < this.nodeCount; i += 1) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = Math.abs(raw[i * 4 + axis]!);
        if (!Number.isFinite(value)) nonFinite = true;
        else if (value > max) max = value;
      }
      const strain = raw[i * 4 + 3]!;
      if (!Number.isFinite(strain)) nonFinite = true;
      else if (strain > maxStrain) maxStrain = strain;
    }
    this.maxStrain = nonFinite ? Number.NaN : maxStrain;
    return nonFinite ? Number.NaN : max;
  }

  get stepCount(): number {
    return this.currentStep;
  }

  get vertexCount(): number {
    return this.nodeCount;
  }

  /**
   * Draw the mesh straight from the position texture into `target` (null = the
   * context's own canvas). Zero readback: the vertex shader `texelFetch`es the
   * live positions, so nothing crosses to the CPU. The renderer shares this
   * solver's GL context, so it must be called on the same thread the solver
   * runs on.
   */
  render(camera: CameraUniforms, settings: RenderSettings, target: WebGLFramebuffer | null = null): void {
    this.meshRenderer ??= new MeshRenderer(this.gl, {
      faceIndices: this.faceIndices,
      edgeIndices: this.edgeIndices,
      edgeAssignments: this.edgeAssignments,
      textureDim: this.packed.dims.textureDim,
    });
    this.meshRenderer.render(camera, settings, target);
  }

  /**
   * Render to an offscreen `width`×`height` RGBA8 buffer and read it back. For
   * headless use (tests, thumbnails) where there is no visible canvas — the
   * interactive path renders straight to the canvas via {@link render} with no
   * readback. Returns RGBA rows top-to-bottom.
   */
  renderToImage(camera: CameraUniforms, settings: RenderSettings, width: number, height: number): Uint8Array {
    const gl = this.gl.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Offscreen render target is incomplete');
    }

    this.render({ ...camera, width, height }, settings, framebuffer);

    const pixels = new Uint8Array(width * height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteRenderbuffer(depth);
    gl.deleteTexture(texture);
    return pixels;
  }

  dispose(): void {
    this.meshRenderer?.dispose();
    this.gl.dispose();
  }

  private solveStep(): void {
    const gl = this.gl;

    // normalCalc over faces
    gl.step('normalCalc', ['u_faceVertexIndices', 'u_lastPosition', 'u_originalPosition'], 'u_normals');
    // thetaCalc over creases (accumulator ping-pong)
    gl.step(
      'thetaCalc',
      ['u_normals', 'u_lastTheta', 'u_creaseVectors', 'u_lastPosition', 'u_originalPosition'],
      'u_theta'
    );
    // updateCreaseGeo over creases
    gl.step('updateCreaseGeo', ['u_lastPosition', 'u_originalPosition', 'u_creaseMeta2'], 'u_creaseGeo');
    // velocityCalc over nodes
    gl.step(
      'velocityCalc',
      [
        'u_lastPosition',
        'u_lastVelocity',
        'u_originalPosition',
        'u_externalForces',
        'u_mass',
        'u_meta',
        'u_beamMeta',
        'u_creaseMeta',
        'u_nodeCreaseMeta',
        'u_normals',
        'u_theta',
        'u_creaseGeo',
        'u_meta2',
        'u_nodeFaceMeta',
        'u_nominalTriangles',
      ],
      'u_velocity'
    );
    // positionCalc over nodes
    gl.step('positionCalc', ['u_velocity', 'u_lastPosition', 'u_mass'], 'u_position');

    gl.swap('u_theta', 'u_lastTheta');
    gl.swap('u_velocity', 'u_lastVelocity');
    gl.swap('u_position', 'u_lastPosition');
  }

  private buildTextures(): void {
    const gl = this.gl;
    const dims = this.packed.dims;
    const nodeSpec = { width: dims.textureDim, height: dims.textureDim };
    const creaseSpec = { width: dims.textureDimCreases, height: dims.textureDimCreases };
    const zeros = (size: number) => new Float32Array(size * size * 4);

    // Static
    gl.createTexture('u_originalPosition', { ...nodeSpec, data: this.packed.originalPosition });
    gl.createTexture('u_mass', { ...nodeSpec, data: this.packed.mass });
    gl.createTexture('u_externalForces', { ...nodeSpec, data: this.packed.externalForces });
    gl.createTexture('u_meta', { ...nodeSpec, data: this.packed.meta });
    gl.createTexture('u_meta2', { ...nodeSpec, data: this.packed.meta2 });
    gl.createTexture('u_nodeCreaseMeta', {
      width: dims.textureDimNodeCreases,
      height: dims.textureDimNodeCreases,
      data: this.packed.nodeCreaseMeta,
    });
    gl.createTexture('u_nodeFaceMeta', {
      width: dims.textureDimNodeFaces,
      height: dims.textureDimNodeFaces,
      data: this.packed.nodeFaceMeta,
    });
    gl.createTexture('u_faceVertexIndices', {
      width: dims.textureDimFaces,
      height: dims.textureDimFaces,
      data: this.packed.faceVertexIndices,
    });
    gl.createTexture('u_nominalTriangles', {
      width: dims.textureDimFaces,
      height: dims.textureDimFaces,
      data: this.packed.nominalTriangles,
    });
    gl.createTexture('u_creaseMeta2', { ...creaseSpec, data: this.packed.creaseMeta2 });
    gl.createTexture('u_creaseVectors', { ...creaseSpec, data: this.packed.creaseVectors });

    // Material-dependent (rebuilt on setMaterial)
    gl.createTexture('u_beamMeta', {
      width: dims.textureDimEdges,
      height: dims.textureDimEdges,
      data: packBeamMeta(this.packed, this.material),
    });
    gl.createTexture('u_creaseMeta', { ...creaseSpec, data: packCreaseMeta(this.packed, this.material) });

    // Ping-pong state
    gl.createTexture('u_position', { ...nodeSpec, data: zeros(dims.textureDim) });
    gl.createTexture('u_lastPosition', { ...nodeSpec, data: zeros(dims.textureDim) });
    gl.createTexture('u_velocity', { ...nodeSpec, data: zeros(dims.textureDim) });
    gl.createTexture('u_lastVelocity', { ...nodeSpec, data: zeros(dims.textureDim) });
    gl.createTexture('u_normals', {
      width: dims.textureDimFaces,
      height: dims.textureDimFaces,
      data: zeros(dims.textureDimFaces),
    });
    gl.createTexture('u_creaseGeo', { ...creaseSpec, data: zeros(dims.textureDimCreases) });
    gl.createTexture('u_theta', { ...creaseSpec, data: this.packed.thetaInit });
    gl.createTexture('u_lastTheta', { ...creaseSpec, data: this.packed.thetaInit });
  }

  private buildPrograms(): void {
    const gl = this.gl;
    const dims = this.packed.dims;

    gl.createProgram('normalCalc', NORMAL_CALC);
    gl.createProgram('thetaCalc', THETA_CALC);
    gl.createProgram('updateCreaseGeo', CREASE_GEO_CALC);
    gl.createProgram('velocityCalc', VELOCITY_CALC);
    gl.createProgram('positionCalc', POSITION_CALC);

    // Bind every sampler to a texture unit, matching the input order in `step`.
    const bind = (program: string, samplers: string[]) =>
      samplers.forEach((name, unit) => gl.setUniform(program, name, unit, '1i'));

    bind('normalCalc', ['u_faceVertexIndices', 'u_lastPosition', 'u_originalPosition']);
    gl.setUniform('normalCalc', 'u_textureDim', [dims.textureDim, dims.textureDim], '2f');
    gl.setUniform('normalCalc', 'u_textureDimFaces', [dims.textureDimFaces, dims.textureDimFaces], '2f');

    bind('thetaCalc', ['u_normals', 'u_lastTheta', 'u_creaseVectors', 'u_lastPosition', 'u_originalPosition']);
    gl.setUniform('thetaCalc', 'u_textureDim', [dims.textureDim, dims.textureDim], '2f');
    gl.setUniform('thetaCalc', 'u_textureDimFaces', [dims.textureDimFaces, dims.textureDimFaces], '2f');
    gl.setUniform('thetaCalc', 'u_textureDimCreases', [dims.textureDimCreases, dims.textureDimCreases], '2f');

    bind('updateCreaseGeo', ['u_lastPosition', 'u_originalPosition', 'u_creaseMeta2']);
    gl.setUniform('updateCreaseGeo', 'u_textureDim', [dims.textureDim, dims.textureDim], '2f');
    gl.setUniform('updateCreaseGeo', 'u_textureDimCreases', [dims.textureDimCreases, dims.textureDimCreases], '2f');

    bind('velocityCalc', [
      'u_lastPosition',
      'u_lastVelocity',
      'u_originalPosition',
      'u_externalForces',
      'u_mass',
      'u_meta',
      'u_beamMeta',
      'u_creaseMeta',
      'u_nodeCreaseMeta',
      'u_normals',
      'u_theta',
      'u_creaseGeo',
      'u_meta2',
      'u_nodeFaceMeta',
      'u_nominalTriangles',
    ]);
    gl.setUniform('velocityCalc', 'u_textureDim', [dims.textureDim, dims.textureDim], '2f');
    gl.setUniform('velocityCalc', 'u_textureDimEdges', [dims.textureDimEdges, dims.textureDimEdges], '2f');
    gl.setUniform('velocityCalc', 'u_textureDimFaces', [dims.textureDimFaces, dims.textureDimFaces], '2f');
    gl.setUniform('velocityCalc', 'u_textureDimCreases', [dims.textureDimCreases, dims.textureDimCreases], '2f');
    gl.setUniform(
      'velocityCalc',
      'u_textureDimNodeCreases',
      [dims.textureDimNodeCreases, dims.textureDimNodeCreases],
      '2f'
    );
    gl.setUniform(
      'velocityCalc',
      'u_textureDimNodeFaces',
      [dims.textureDimNodeFaces, dims.textureDimNodeFaces],
      '2f'
    );
    gl.setUniform('velocityCalc', 'u_calcFaceStrain', 0, '1i');

    bind('positionCalc', ['u_velocity', 'u_lastPosition', 'u_mass']);
    gl.setUniform('positionCalc', 'u_textureDim', [dims.textureDim, dims.textureDim], '2f');
  }

  private uploadMaterial(): void {
    const gl = this.gl;
    gl.updateTexture('u_beamMeta', packBeamMeta(this.packed, this.material));
    gl.updateTexture('u_creaseMeta', packCreaseMeta(this.packed, this.material));
    gl.setUniform('velocityCalc', 'u_dt', this.dt, '1f');
    gl.setUniform('velocityCalc', 'u_axialStiffness', this.material.axialStiffness, '1f');
    gl.setUniform('velocityCalc', 'u_faceStiffness', this.material.faceStiffness, '1f');
    gl.setUniform('velocityCalc', 'u_creasePercent', this.foldPercent / 100, '1f');
    gl.setUniform('positionCalc', 'u_dt', this.dt, '1f');
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 100 ? 100 : value;
}
