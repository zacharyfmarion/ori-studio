export type CpDetectStatus =
  | 'valid'
  | 'repaired'
  | 'ambiguous'
  | 'outside_supported_envelope'
  | 'outside_v1_envelope'
  | 'failed';

export type CpDetectExecutionProvider = 'auto' | 'webgpu' | 'wasm';
export type CpDetectJunctionSource = 'dense-model' | 'line-arrangement' | 'vertex-refiner-v3';

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
  vertexRefinerFallback?: 'dense-model' | 'error';
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

export interface CpDetectFoldResult {
  status: CpDetectStatus;
  foldJson: string;
  detectorReport: CpDetectDecodeReport;
  manifest: CpDetectModelManifest;
  junctionSource?: CpDetectJunctionSource;
  vertexRefiner?: CpDetectVertexRefinerRunSummary | null;
  runtime?: CpDetectRuntimeInfo;
}

export interface CpDetectVertexRefinerRunSummary {
  manifestId?: string;
  frame?: CpDetectPaperFrame;
  proposalCount?: number;
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
