export type CpDetectStatus =
  | 'valid'
  | 'repaired'
  | 'ambiguous'
  | 'outside_supported_envelope'
  | 'outside_v1_envelope'
  | 'failed';

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
}

export interface CpDetectWorkerRunOptions {
  manifestUrl?: string;
  modelUrl?: string;
  threshold?: number;
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
