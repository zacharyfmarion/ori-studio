export { prepareFoldModel } from './prepare.js';
export { createOrigamiSimulator } from './simulator.js';
export { ReferenceSolver } from './referenceSolver.js';
export { SimulationClock } from './simulationClock.js';
export type { SimulationClockOptions, SimulationTick } from './simulationClock.js';
export type { SolverBackend, SolverBackendInfo } from './solverBackend.js';
export { WebglSolver } from './webgl/webglSolver.js';
export {
  GlCore,
  WebGlContextLostError,
  glContextAttributeOverrides,
  setGlContextAttributeOverrides,
  textureSizeFor,
} from './webgl/glCore.js';
export type { GlContextAttributeOverrides } from './webgl/glCore.js';
export {
  MeshRenderer,
  meshTopologyFor,
  DEFAULT_CREASE_DEPTH_BIAS,
  MAX_DASH_RUNS,
  packCreaseDash,
  creaseFrameScale,
  rasterCreaseInk,
  type CreaseDash,
  type MeshDrawOptions,
  type MeshTopology,
  type RenderSettings,
} from './webgl/meshRenderer.js';
export {
  buildBsp,
  traverseBsp,
  type BspItem,
  type BuildBspOptions,
  type Vec3,
} from './bsp.js';
export {
  renderMeshToSvg,
  type RenderMeshToSvgOptions,
  type SvgRenderResult,
} from './svgRenderer.js';
export {
  findVisiblePieces,
  type DrawnPiece,
  type VisibilityOptions,
} from './hiddenPieces.js';
export {
  coplanarRuns,
  outlineOf,
  sourceFaceGroups,
  type Point,
  type RunPiece,
} from './coplanarRuns.js';
export {
  cameraUniforms,
  centroid,
  boundingRadius,
  fitExtent,
  projectVertices,
  projectViewPoint,
  toViewSpace,
  viewRotation,
  viewDepthAxis,
  multiplyMat3,
  transposeMat3,
  IDENTITY_MAT3,
  type Mat3,
  type OrbitView,
  type CameraUniforms,
  type ProjectedVertices,
  type ProjectVerticesOptions,
} from './webgl/camera.js';
export { GpuMath, detectWebGlSupport } from './gpuMath.js';
export { OrigamiModel } from './model.js';
export { ORIGAMI_SIMULATOR_UPSTREAM } from './provenance.js';
export type {
  CreateSimulatorConfig,
  CreaseFoldRange,
  CreaseParameter,
  FoldProfile,
  FoldAssignment,
  FoldDocument,
  OrigamiSimulatorController,
  PreparedOrigamiModel,
  PrepareFoldOptions,
  SimulationFrame,
  SimulatorDiagnostics,
  SimulatorOptions,
} from './types.js';
