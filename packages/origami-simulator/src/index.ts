export { prepareFoldModel } from './prepare.js';
export { createOrigamiSimulator } from './simulator.js';
export { ReferenceSolver } from './referenceSolver.js';
export { SimulationClock } from './simulationClock.js';
export type { SimulationClockOptions, SimulationTick } from './simulationClock.js';
export type { SolverBackend, SolverBackendInfo } from './solverBackend.js';
export { WebglSolver } from './webgl/webglSolver.js';
export { GlCore, WebGlContextLostError } from './webgl/glCore.js';
export {
  MeshRenderer,
  meshTopologyFor,
  MAX_DASH_RUNS,
  packCreaseDash,
  type CreaseDash,
  type MeshTopology,
  type RenderSettings,
} from './webgl/meshRenderer.js';
export {
  renderMeshToSvg,
  type RenderMeshToSvgOptions,
  type SvgRenderResult,
} from './svgRenderer.js';
export {
  cameraUniforms,
  centroid,
  boundingRadius,
  fitExtent,
  projectVertices,
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
