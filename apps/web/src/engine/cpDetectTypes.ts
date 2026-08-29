import {
  CP_DETECT_DEFAULT_JUNCTION_SOURCE as GENERATED_DEFAULT_JUNCTION_SOURCE,
  CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE as GENERATED_DEFAULT_LINE_EVIDENCE_SOURCE,
} from '../generated/cpDetectDefaults.generated';

export type CpDetectStatus =
  | 'valid'
  | 'repaired'
  | 'ambiguous'
  | 'outside_supported_envelope'
  | 'outside_v1_envelope'
  | 'failed'
  /**
   * The decode stopped before the exact solve, at the caller's request.
   *
   * Deliberately its own word rather than one of the five above: every one of
   * those describes a solve that reached a verdict, and this one never started.
   * The Rust side is `RECOGNIZED_STATUS` (`decode.rs`), and the same reasoning
   * is written out there.
   */
  | 'recognized';

export type CpDetectExecutionProvider = 'auto' | 'webgpu' | 'wasm';
export type CpDetectJunctionSource = 'dense-model' | 'line-arrangement' | 'vertex-refiner-v3';
export type CpDetectLineEvidenceSource = 'source-image' | 'dense-model';
export type CpDetectVertexRefinerProposalMode = 'full-coverage' | 'dense-junction-regions';

// The V3 vertex refiner is deprecated: benchmarking showed it never improves exact
// recovery over the dense head and is worse at close pairs, while adding a model
// download + forward pass. Default to the dense head everywhere.
// See research/2026-06-30-native-cp-junction-and-exact-solve-bottlenecks.md.
//
// These defaults are the SINGLE SOURCE OF TRUTH in Rust
// (crates/oristudio-cp-detect/src/defaults.rs) and are code-generated into
// src/generated/cpDetectDefaults.generated.ts on every `build:wasm`
// (gitignored, so never stale). The typed assignment below also fails
// typecheck if Rust ever emits a value outside these unions — and the
// wasm-parity test (cpDetectDefaults.test.ts) asserts the generated values
// match what the product wasm reports.
export const CP_DETECT_DEFAULT_JUNCTION_SOURCE: CpDetectJunctionSource =
  GENERATED_DEFAULT_JUNCTION_SOURCE;
export const CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE: CpDetectLineEvidenceSource =
  GENERATED_DEFAULT_LINE_EVIDENCE_SOURCE;
export const CP_DETECT_DEFAULT_VERTEX_REFINER_PROPOSAL_MODE: CpDetectVertexRefinerProposalMode =
  'dense-junction-regions';
export const CP_DETECT_DEFAULT_VERTEX_REFINER_DENSE_REGION_JUNCTION_THRESHOLD = 0.35;
export const CP_DETECT_DEFAULT_VERTEX_REFINER_DENSE_REGION_MIN_PEAKS = 3;
export const CP_DETECT_DEFAULT_VERTEX_REFINER_DENSE_REGION_MAX_OVERLAP_FRACTION = 0;

export interface CpDetectPaperFrame {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

export interface CpDetectRuntimeInfo {
  requested_execution_provider?: CpDetectExecutionProvider;
  active_execution_provider?: 'webgpu' | 'wasm';
  webgpu_available?: boolean;
  wasm_threads?: number;
  session_create_ms?: number;
  fallback_reason?: string;
  preprocess_ms?: number;
  model_run_ms?: number;
  output_collect_ms?: number;
  total_inference_ms?: number;
}

export interface CpDetectModelManifest {
  schema: 'oristudio/cp-detect-model-manifest/v1';
  id: string;
  created_at?: string;
  model: {
    url: string;
    sha256?: string;
    size_bytes?: number;
    format?: 'onnx' | string;
  };
  inference: {
    image_size: number;
    threshold: number;
    preprocessing?: 'rgb_chw_float32_0_1' | string;
    /**
     * Offset normalization radius (px) of the model's junction_offset head.
     * Radius-trained models (close-pair recipe) decode junctions via
     * offset-vote clustering; absent/0 means legacy sub-pixel offsets.
     */
    junction_offset_radius_px?: number;
  };
  outputs: CpDetectOutputTensorNames;
}

export interface CpDetectOutputTensorNames {
  line_logits: string;
  angle: string;
  junction_logits: string;
  junction_offset: string;
  assignment_logits: string;
  non_crease_logits: string;
  line_style_logits: string;
  boundary_contact_logits: string;
  vertex_type_logits: string;
  boundary_side_logits: string;
  boundary_offset: string;
  boundary_coord: string;
}

export interface CpDetectTensorData {
  data: Float32Array;
  dims: readonly number[];
}

export type CpDetectDenseOutputKey = keyof CpDetectOutputTensorNames;

export type CpDetectDenseOutputs = Record<CpDetectDenseOutputKey, CpDetectTensorData>;

export interface CpDetectInferenceResult {
  manifest: CpDetectModelManifest;
  input: {
    image_size: number;
    input_name: string;
  };
  outputs: CpDetectDenseOutputs;
  runtime?: CpDetectRuntimeInfo;
}

export interface CpVertexRefinerModelManifest {
  schema: 'oristudio/cp-vertex-refiner-model-manifest/v1';
  id: string;
  created_at?: string;
  model: {
    url: string;
    sha256?: string;
    size_bytes?: number;
    format?: 'onnx' | string;
  };
  architecture?: {
    class?: 'VertexRefinerV3' | string;
    model_version?: 'v3' | string;
    base_channels?: number;
    crop_size?: number;
    input_channels?: readonly string[];
    output_names?: readonly string[];
    ray_bins?: number;
    vertex_kind_names?: readonly string[];
    boundary_side_names?: readonly string[];
  };
  inference: {
    model_version: 'v3' | string;
    input_version?: 'v3' | string;
    onnx_input_name?: string;
    onnx_output_names?: readonly string[];
    crop_size: number;
    input_channels: number;
    input_channel_names?: readonly string[];
    preprocessing?: 'v3_source_frame_channels_chw_float32' | string;
    heatmap_threshold: number;
    boundary_heatmap_threshold?: number;
    nms_radius_px?: number;
    merge_radius_px?: number;
    boundary_merge_radius_px?: number;
    min_support_fraction?: number;
    split_same_crop_conflicts?: boolean;
    split_min_support_fraction?: number;
    proposal_cap?: number;
    batch_size?: number;
  };
  outputs: CpVertexRefinerOutputTensorNames;
}

export interface CpVertexRefinerOutputTensorNames {
  vertex_heatmap: string;
  vertex_offset: string;
  vertex_kind: string;
  degree: string;
  incident_rays: string;
  boundary_contact_heatmap: string;
  boundary_side: string;
}

export type CpVertexRefinerOutputKey = keyof CpVertexRefinerOutputTensorNames;

export type CpVertexRefinerOutputs = Record<CpVertexRefinerOutputKey, CpDetectTensorData>;

export interface CpVertexRefinerInferenceResult {
  manifest: CpVertexRefinerModelManifest;
  input: {
    crop_size: number;
    crop_count: number;
    input_name: string;
  };
  outputs: CpVertexRefinerOutputs;
  runtime?: CpDetectRuntimeInfo;
}

export interface CpDetectWorkerRunOptions {
  manifestUrl?: string;
  modelUrl?: string;
  vertexRefinerManifestUrl?: string;
  vertexRefinerModelUrl?: string;
  vertexRefinerFrame?: CpDetectPaperFrame;
  junctionSource?: CpDetectJunctionSource;
  lineEvidenceSource?: CpDetectLineEvidenceSource;
  vertexRefinerProposalMode?: CpDetectVertexRefinerProposalMode;
  vertexRefinerFallback?: 'dense-model' | 'error';
  vertexRefinerProposalCap?: number;
  vertexRefinerDenseRegionJunctionThreshold?: number;
  vertexRefinerDenseRegionMinPeaks?: number;
  vertexRefinerDenseRegionMaxOverlapFraction?: number;
  vertexRefinerGridStridePx?: number;
  vertexRefinerHeatmapThreshold?: number;
  vertexRefinerBoundaryHeatmapThreshold?: number;
  vertexRefinerNmsRadiusPx?: number;
  vertexRefinerMergeRadiusPx?: number;
  vertexRefinerBoundaryMergeRadiusPx?: number;
  vertexRefinerMinSupport?: number;
  vertexRefinerMinSupportFraction?: number;
  vertexRefinerSplitSameCropConflicts?: boolean;
  vertexRefinerSplitMinSupportFraction?: number;
  vertexRefinerBatchSize?: number;
  threshold?: number;
  executionProvider?: CpDetectExecutionProvider;
  decoderBackend?: 'legacy_v2_decoder' | 'constraint_compiler_v1' | 'legacy_candidate_exact_solve_v1';
  exactSolveTimeoutSeconds?: number;
}

export interface CpDetectPoint {
  x: number;
  y: number;
}

export interface CpDetectQuad {
  top_left: CpDetectPoint;
  top_right: CpDetectPoint;
  bottom_right: CpDetectPoint;
  bottom_left: CpDetectPoint;
}

export interface CpDetectRectificationWarning {
  code: string;
  message: string;
  severity: string;
  details?: unknown;
}

export interface CpDetectRectificationReport {
  original_width: number;
  original_height: number;
  image_size: number;
  mode: string;
  confidence: number;
  source_quad: CpDetectQuad;
  detected_source_quad?: CpDetectQuad;
  target_quad?: CpDetectQuad;
  padding_rgb: [number, number, number];
  warnings: CpDetectRectificationWarning[];
  metrics: unknown;
}

export interface CpDetectRectifiedImage {
  image: ImageData;
  report: CpDetectRectificationReport;
}

export interface CpDetectDecodeWarning {
  code: string;
  message: string;
  severity: string;
  details?: unknown;
}

export interface CpDetectDecodeReport {
  status: CpDetectStatus;
  decoder_backend: string;
  image_size: number;
  threshold: number;
  line_count: number;
  carrier_count: number;
  vertex_count: number;
  edge_count: number;
  border_edge_count: number;
  interior_edge_count: number;
  warnings: CpDetectDecodeWarning[];
  repair_actions?: unknown[];
  quality_report?: {
    /** Candidate generation strategy id, e.g. junction-first-v1. */
    candidate_strategy?: string;
  } & Record<string, unknown>;
}

/**
 * `cp_detector.source` on an exported FOLD: **which coordinates it carries**.
 *
 * This is the discriminator, and it is written by the exporter that produced the
 * document (`fold_export.rs`) rather than inferred from what the report does or
 * does not contain. `"exact_solve"` is a solved pattern; `"exact_solve_candidate"`
 * is the recognized candidate at its pre-solve coordinates, which look plausible
 * and are up to several degrees out at every interior vertex.
 */
export type CpDetectCandidateSource = 'exact_solve' | 'exact_solve_candidate';

/**
 * The wall-clock budget for solving this candidate, published by the recognize
 * path because Rust cannot enforce it.
 *
 * `solve_exact` builds its deadline from the `timeout_seconds` of the call it is
 * in, so two `cp_detect_solve_exact` calls are two independent deadlines. The
 * caller therefore owes the rule: **spend `totalSeconds` across every solve call
 * for one candidate**, not per call. `runCpExactSolve` implements it.
 *
 * A negative `totalSeconds` disables the timeout and must be passed through
 * unchanged rather than clamped — `0` means "time out immediately", so clamping
 * would turn "no limit" into "no time at all".
 */
export interface CpDetectSolveBudget {
  totalSeconds: number;
  spentSeconds: number;
  /** `"shared_total_across_staged_solve_calls"`. Carried so a change is visible. */
  policy: string;
}

/** A decode that ran the exact solve, said so by the report itself. */
export interface CpDetectSolveAttempted {
  attempted: true;
}

/** A decode that stopped before the solve, said so by the report itself. */
export interface CpDetectSolveNotAttempted {
  attempted: false;
  /** `compiler_report.solve.reason` — `"recognize_only"` today. */
  reason: string;
  /** Null only if the report omits the budget block, which current Rust never does. */
  budget: CpDetectSolveBudget | null;
}

/**
 * Whether the exact solve ran, as a positive statement in both directions.
 *
 * The distinction this exists to draw is **"never attempted" versus "attempted
 * and failed"**, and neither is expressed by the absence of a key: the
 * recognize path writes `compiler_report.solve.attempted: false`, and the fused
 * path writes a whole `compiler_report.exact_solve` block. A reader that tested
 * for a missing `exact_solve` would report an older decoder backend, a
 * serialization change, or a stale wasm bridge as "not solved yet".
 */
export type CpDetectSolveState = CpDetectSolveAttempted | CpDetectSolveNotAttempted;

/**
 * `TopologyDiagnostics` (`oristudio-cp-compiler`), verbatim.
 *
 * Snake_case because it is the wire shape and not a re-derivation of it, the
 * same convention `CpExactSolvedGraph` follows.
 *
 * The split is the point of the type. `combinatorial` findings are properties of
 * the *graph* and survive moving the drawing around, so they make a repair
 * worklist; `angle_dependent` findings are properties of the current
 * *coordinates*, and on an unsolved candidate they are large by construction —
 * that is what the solve is for — so they say nothing about whether the topology
 * is right.
 */
export interface CpDetectTopologyDiagnostics {
  schema: string;
  /** Non-empty when the input was malformed enough that no analysis ran. */
  blockers: string[];
  combinatorial: {
    odd_degree_vertices: number[];
    degree_two_vertices: number[];
    maekawa_failures: number[];
    /** Vertex id pairs. */
    degenerate_edges: [number, number][];
    /** Span id pairs — not vertex ids, unlike `degenerate_edges`. */
    unmodeled_crossings: [number, number][];
    boundary_failures: number[];
  };
  angle_dependent: {
    max_kawasaki_residual_degrees: number;
    max_carrier_residual: number;
  };
  vertices: CpDetectTopologyVertexDiagnostic[];
}

export interface CpDetectTopologyVertexDiagnostic {
  vertex_id: number;
  degree: number;
  mountain_count: number;
  valley_count: number;
  unknown_count: number;
  /** Null unless the fan has an even degree of at least four. */
  kawasaki_residual_degrees: number | null;
  /** Null while any incident crease is unassigned. */
  maekawa_residual: number | null;
}

export interface CpDetectFoldResult {
  status: CpDetectStatus;
  foldJson: string;
  detectorReport: CpDetectDecodeReport;
  manifest: CpDetectModelManifest;
  junctionSource?: CpDetectJunctionSource;
  lineEvidenceSource?: CpDetectLineEvidenceSource;
  vertexRefiner?: CpDetectVertexRefinerRunSummary | null;
  runtime?: CpDetectRuntimeInfo;
  /**
   * Always `{ attempted: true }` on this path — the fused decode solves.
   *
   * Optional so every existing construction of this type still typechecks, and
   * narrowed to the attempted arm so that a {@link CpDetectRecognizeResult} is
   * **not** structurally assignable to a `CpDetectFoldResult`. That is the whole
   * reason the field is here: the two results carry the same fields with
   * different meanings, and without a conflicting property a recognized
   * candidate could be handed to any consumer expecting solved geometry.
   */
  solve?: CpDetectSolveAttempted;
}

/**
 * A decode that stopped after recognition, with the seam a later solve needs.
 *
 * Not an extension of {@link CpDetectFoldResult}, on purpose. `foldJson` here is
 * the *candidate* crease pattern — real topology at approximate coordinates —
 * and every consumer of a detection result has to know which of the two it
 * holds, so the type system is where that is settled rather than a comment.
 */
export interface CpDetectRecognizeResult {
  status: 'recognized';
  /** The candidate crease pattern, at pre-solve coordinates. */
  foldJson: string;
  detectorReport: CpDetectDecodeReport;
  manifest: CpDetectModelManifest;
  junctionSource?: CpDetectJunctionSource;
  lineEvidenceSource?: CpDetectLineEvidenceSource;
  runtime?: CpDetectRuntimeInfo;
  /** Read from the FOLD's own `cp_detector.source`; always the candidate value here. */
  candidateSource: CpDetectCandidateSource;
  solve: CpDetectSolveNotAttempted;
  /**
   * `compiler_report.exact_solve_input` — the **one** copy of the seam that
   * crosses the bridge, and a whole `ExactSolveInput` by value.
   *
   * `unknown` rather than a mirrored struct: nothing on this side reads its
   * fields, it round-trips back to `cp_detect_solve_exact` verbatim, and a typed
   * copy would be a second definition of a large Rust struct with nothing
   * checking that it still matches.
   */
  solveInput: unknown;
  /** `compiler_report.topology_diagnostics`; null if the report omits it. */
  topologyDiagnostics: CpDetectTopologyDiagnostics | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The compiler's report inside a decode report, or null on another backend. */
export function cpDetectCompilerReport(
  report: CpDetectDecodeReport | null | undefined
): Record<string, unknown> | null {
  return asRecord(report?.quality_report?.compiler_report);
}

/**
 * What the decode did about the solve, or null when the report does not say.
 *
 * Null is a real answer and not a stand-in for "no": a decoder backend that
 * writes neither statement has told us nothing, and the caller decides whether
 * that is tolerable. The worker's `recognizeRectifiedFold` treats it as a
 * contract violation.
 */
export function cpDetectSolveState(
  report: CpDetectDecodeReport | null | undefined
): CpDetectSolveState | null {
  const compilerReport = cpDetectCompilerReport(report);
  if (!compilerReport) return null;
  const solve = asRecord(compilerReport.solve);
  if (solve?.attempted === false) {
    const budget = asRecord(solve.budget);
    return {
      attempted: false,
      reason: typeof solve.reason === 'string' ? solve.reason : 'unspecified',
      budget: budget ? cpDetectSolveBudget(budget) : null,
    };
  }
  if (solve?.attempted === true) return { attempted: true };
  // The fused path writes no `solve` block; the whole `exact_solve` result *is*
  // its positive statement that a solve ran.
  if (compilerReport.exact_solve !== undefined) return { attempted: true };
  return null;
}

function cpDetectSolveBudget(budget: Record<string, unknown>): CpDetectSolveBudget {
  return {
    totalSeconds: typeof budget.total_seconds === 'number' ? budget.total_seconds : 0,
    spentSeconds: typeof budget.spent_seconds === 'number' ? budget.spent_seconds : 0,
    policy: typeof budget.policy === 'string' ? budget.policy : '',
  };
}

/** The pre-solve `ExactSolveInput`, or null when the report carries none. */
export function cpDetectSolveInput(report: CpDetectDecodeReport | null | undefined): unknown {
  return cpDetectCompilerReport(report)?.exact_solve_input ?? null;
}

/** The repair worklist, or null when the report carries none. */
export function cpDetectTopologyDiagnostics(
  report: CpDetectDecodeReport | null | undefined
): CpDetectTopologyDiagnostics | null {
  const diagnostics = asRecord(cpDetectCompilerReport(report)?.topology_diagnostics);
  return diagnostics ? (diagnostics as unknown as CpDetectTopologyDiagnostics) : null;
}

/**
 * `cp_detector.source` from an exported FOLD, or null when it says nothing.
 *
 * Costs a parse of the whole document — up to ~250 KB on a hard pattern — to
 * read one string. Worth it: this is the exporter's own statement of which
 * coordinates it wrote, and the alternative (reading the report's shape) is the
 * inference the recognize/solve split exists to remove. It is also paid once per
 * detection, against a pipeline whose other stages are an ONNX forward pass and
 * a solve of up to 25 s.
 */
export function cpDetectCandidateSourceFromFold(foldJson: string): CpDetectCandidateSource | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(foldJson);
  } catch {
    return null;
  }
  const source = asRecord(asRecord(parsed)?.cp_detector)?.source;
  return source === 'exact_solve' || source === 'exact_solve_candidate' ? source : null;
}

export interface CpDetectVertexRefinerRunSummary {
  manifestId?: string;
  frame?: CpDetectPaperFrame;
  proposalCount?: number;
  proposalMode?: CpDetectVertexRefinerProposalMode;
  rawPredictionCount?: number;
  mergedVertexCount?: number;
  runtime?: CpDetectRuntimeInfo;
  error?: string;
}

export interface CpDetectAblationStage {
  id: string;
  fold_json: string;
  report: CpDetectDecodeReport;
}

export interface CpDetectAblationResult {
  schema: 'oristudio/cp-detect-compiler-ablation/v1';
  stages: CpDetectAblationStage[];
  manifest: CpDetectModelManifest;
}
