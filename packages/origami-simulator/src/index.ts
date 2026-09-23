export { prepareFoldModel, EDGES_FACET_KEY } from './prepare.js';
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
  DASH_KINDS,
  MAX_DASH_RUNS,
  packCreaseDash,
  creaseFrameScale,
  erodePx,
  rasterCreaseInk,
  type CreaseDash,
  type MeshDrawOptions,
  type MeshRendererOptions,
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
export { type SvgMeshTopology } from './projectedMesh.js';
export {
  meshToPaperScene,
  type MeshToPaperSceneOptions,
  type PaperFaceItem,
  type PaperItem,
  type PaperLineItem,
  type PaperLineRole,
  type PaperLineWhole,
  type PaperMarkupItem,
  type PaperScene,
  type PaperSide,
  type SceneBounds,
  type ScenePoint,
} from './paperScene.js';
export { EDGE_CODE, type EdgeCode } from './edgeCodes.js';
export {
  faceAdjacency,
  type FaceAdjacency,
  type FaceAdjacencyTopology,
} from './faceAdjacency.js';
export {
  AUX_END_ON_OUTLINE_RELATIVE,
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  auxEndsOnOutline,
  edgeBoundaryFlags,
  endpointOnBoundary,
  outlineVertexCounts,
  type EdgeBoundaryTopology,
} from './edgeBoundary.js';
export {
  SHADE_AMBIENT,
  SHADE_DIFFUSE,
  SHADE_FACING,
  SHADE_GLSL,
  SHADE_MAX,
  SHADE_MIN,
  shadeColor,
  shadeFor,
  type Vec3Like,
} from './shading.js';
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
  sheetExtent,
  fitExtent,
  projectVertices,
  projectViewPoint,
  toViewSpace,
  viewRotation,
  viewRotationFor,
  rollRotation,
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
// The 2D lift, exported because the app both undoes it (`flatPlaneReader`) and
// builds fixtures that must agree with it. Two transcriptions of a sign is one
// too many.
export { normalizePoint } from './geometry.js';
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
