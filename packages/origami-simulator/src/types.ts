export type FoldAssignment = 'B' | 'M' | 'V' | 'F' | 'U' | 'C' | 'J';

export interface FoldDocument {
  file_spec?: number;
  file_creator?: string;
  file_author?: string;
  frame_title?: string;
  frame_classes?: string[];
  vertices_coords: number[][];
  edges_vertices: [number, number][];
  edges_assignment?: FoldAssignment[];
  edges_foldAngle?: Array<number | null>;
  edges_faces?: number[][];
  faces_vertices: number[][];
  faces_edges?: number[][];
  faceOrders?: Array<[number, number, number]>;
  [key: string]: unknown;
}

export interface CreaseParameter {
  face1: number;
  vertex1: number;
  face2: number;
  vertex2: number;
  edge: number;
  targetAngle: number;
}

export interface CreaseFoldRange {
  edge: number;
  fromAngle: number;
  toAngle: number;
}

export interface FoldProfile {
  ranges: CreaseFoldRange[];
}

export interface PreparedOrigamiModel {
  fold: FoldDocument;
  vertexCount: number;
  edgeCount: number;
  faceCount: number;
  positions: Float32Array;
  originalPositions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  edgesVertices: [number, number][];
  edgesAssignment: FoldAssignment[];
  edgesFoldAngle: Array<number | null>;
  facesVertices: number[][];
  facesEdges: number[][];
  edgesFaces: number[][];
  creaseParams: CreaseParameter[];
  diagnostics: SimulatorDiagnostics;
}

export interface PrepareFoldOptions {
  triangulate?: boolean;
  foldUseAngles?: boolean;
}

export interface SimulatorOptions {
  foldPercent?: number;
  foldProfile?: FoldProfile | null;
  axialStiffness?: number;
  creaseStiffness?: number;
  panelStiffness?: number;
  faceStiffness?: number;
  damping?: number;
  timeStep?: number;
  timeStepScale?: number;
  stepsPerFrame?: number;
  autoRender?: boolean;
  integrationType?: 'euler' | 'verlet';
}

export interface SimulatorDiagnostics {
  warnings: string[];
  errors: string[];
  webglAvailable?: boolean;
  usedCpuFallback?: boolean;
  maxEdgeStrain?: number;
  averageEdgeStrain?: number;
  /**
   * Largest per-node mean axial strain, as a fraction (0.01 = 1%).
   *
   * The quantity the interactive readout and the solver clock's blow-up guard
   * use, because both backends can produce it identically and cheaply -- the GPU
   * already has it in the velocity texture's alpha channel, which is also what
   * upstream reads for its strain visualization. `maxEdgeStrain` is a different
   * measure (max over *edges*, computed from positions) and is not available on
   * the GPU without an extra readback, so the two must not be conflated.
   */
  maxNodalStrain?: number;
}

export interface SimulationFrame {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
  diagnostics: SimulatorDiagnostics;
  step: number;
  foldPercent: number;
}

export interface CreateSimulatorConfig {
  model: PreparedOrigamiModel;
  canvas?: HTMLCanvasElement | OffscreenCanvas;
  gl?: WebGL2RenderingContext | WebGLRenderingContext;
  options?: SimulatorOptions;
}

export interface OrigamiSimulatorController {
  setFoldPercent(percent: number): void;
  setFoldProfile(profile: FoldProfile | null): void;
  setMaterial(options: Partial<SimulatorOptions>): void;
  step(numSteps?: number): SimulationFrame;
  start(): void;
  pause(): void;
  reset(): void;
  readFrame(): SimulationFrame;
  dispose(): void;
}
