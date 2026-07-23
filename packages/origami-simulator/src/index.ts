export { prepareFoldModel } from './prepare.js';
export { createOrigamiSimulator } from './simulator.js';
export { ReferenceSolver } from './referenceSolver.js';
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
