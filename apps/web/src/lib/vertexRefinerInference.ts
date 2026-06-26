import type {
  CpDetectRuntimeInfo,
  CpDetectTensorData,
  CpVertexRefinerInferenceResult,
  CpVertexRefinerModelManifest,
  CpVertexRefinerOutputKey,
  CpVertexRefinerOutputs,
  CpVertexRefinerOutputTensorNames,
} from '../engine/cpDetectTypes';

export const DEFAULT_CP_VERTEX_REFINER_MANIFEST_URL =
  '/models/cp-vertex-refiner-v3/manifest.json';

export const CP_VERTEX_REFINER_OUTPUT_KEYS = [
  'vertex_heatmap',
  'vertex_offset',
  'vertex_kind',
  'degree',
  'incident_rays',
  'boundary_contact_heatmap',
  'boundary_side',
] as const satisfies readonly CpVertexRefinerOutputKey[];

export interface VertexRefinerOnnxSession {
  inputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface VertexRefinerTensorFactory {
  float32(data: Float32Array, dims: readonly number[]): unknown;
}

export async function fetchVertexRefinerModelManifest(
  manifestUrl = DEFAULT_CP_VERTEX_REFINER_MANIFEST_URL,
  fetchImpl: typeof fetch = fetch
): Promise<CpVertexRefinerModelManifest> {
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to load CP vertex refiner manifest: ${response.status} ${response.statusText}`
    );
  }
  return parseVertexRefinerModelManifest(await response.text());
}

export function parseVertexRefinerModelManifest(text: string): CpVertexRefinerModelManifest {
  const manifest = JSON.parse(text) as CpVertexRefinerModelManifest;
  validateVertexRefinerModelManifest(manifest);
  return manifest;
}

export function validateVertexRefinerModelManifest(
  manifest: CpVertexRefinerModelManifest
): void {
  if (manifest.schema !== 'oristudio/cp-vertex-refiner-model-manifest/v1') {
    throw new Error(`Unsupported CP vertex refiner manifest schema: ${manifest.schema}`);
  }
  if (!manifest.id) {
    throw new Error('CP vertex refiner manifest must include id');
  }
  if (!manifest.model?.url) {
    throw new Error('CP vertex refiner manifest must include model.url');
  }
  if (manifest.inference.model_version !== 'v3') {
    throw new Error(
      `Unsupported CP vertex refiner model_version: ${manifest.inference.model_version}`
    );
  }
  if (manifest.inference.crop_size !== 96) {
    throw new Error(`Unsupported CP vertex refiner crop_size: ${manifest.inference.crop_size}`);
  }
  if (manifest.inference.input_channels !== 11) {
    throw new Error(
      `Unsupported CP vertex refiner input_channels: ${manifest.inference.input_channels}`
    );
  }
  for (const key of CP_VERTEX_REFINER_OUTPUT_KEYS) {
    if (!manifest.outputs?.[key]) {
      throw new Error(`CP vertex refiner manifest missing output name: ${key}`);
    }
  }
}

export async function runVertexRefinerInference(
  session: VertexRefinerOnnxSession,
  tensorFactory: VertexRefinerTensorFactory,
  cropTensor: Float32Array,
  manifest: CpVertexRefinerModelManifest,
  runtime?: CpDetectRuntimeInfo
): Promise<CpVertexRefinerInferenceResult> {
  validateVertexRefinerModelManifest(manifest);
  const startedAt = performance.now();
  const cropSize = manifest.inference.crop_size;
  const inputChannels = manifest.inference.input_channels;
  const cropValues = inputChannels * cropSize * cropSize;
  if (cropTensor.length % cropValues !== 0) {
    throw new Error(
      `Vertex refiner crop tensor length ${cropTensor.length} is not divisible by ${cropValues}`
    );
  }
  const cropCount = cropTensor.length / cropValues;
  const inputName = manifest.inference.onnx_input_name ?? session.inputNames[0];
  if (!inputName) {
    throw new Error('CP vertex refiner ONNX session has no input names');
  }
  const preprocessStartedAt = performance.now();
  const inputTensor = tensorFactory.float32(cropTensor, [
    cropCount,
    inputChannels,
    cropSize,
    cropSize,
  ]);
  const runStartedAt = performance.now();
  const rawOutputs = await session.run({ [inputName]: inputTensor });
  const collectStartedAt = performance.now();
  const outputs = collectVertexRefinerOutputs(rawOutputs, manifest.outputs);
  const finishedAt = performance.now();
  return {
    manifest,
    input: {
      crop_size: cropSize,
      crop_count: cropCount,
      input_name: inputName,
    },
    outputs,
    runtime: {
      ...runtime,
      preprocess_ms: runStartedAt - preprocessStartedAt,
      model_run_ms: collectStartedAt - runStartedAt,
      output_collect_ms: finishedAt - collectStartedAt,
      total_inference_ms: finishedAt - startedAt,
    },
  };
}

export function vertexRefinerOutputNames(outputs: CpVertexRefinerOutputTensorNames): string[] {
  return CP_VERTEX_REFINER_OUTPUT_KEYS.map((key) => outputs[key]);
}

export function collectVertexRefinerOutputs(
  rawOutputs: Record<string, unknown>,
  outputNames: CpVertexRefinerOutputTensorNames
): CpVertexRefinerOutputs {
  const entries = CP_VERTEX_REFINER_OUTPUT_KEYS.map((key) => {
    const tensorName = outputNames[key];
    const tensor = rawOutputs[tensorName];
    if (!tensor) {
      throw new Error(`CP vertex refiner ONNX output missing: ${tensorName}`);
    }
    return [key, normalizeTensorData(tensorName, tensor)] as const;
  });
  return Object.fromEntries(entries) as CpVertexRefinerOutputs;
}

function normalizeTensorData(tensorName: string, tensor: unknown): CpDetectTensorData {
  if (!tensor || typeof tensor !== 'object') {
    throw new Error(`CP vertex refiner ONNX output ${tensorName} is not a tensor object`);
  }
  const maybeTensor = tensor as { data?: unknown; dims?: unknown };
  if (!(maybeTensor.data instanceof Float32Array)) {
    throw new Error(`CP vertex refiner ONNX output ${tensorName} is not float32 data`);
  }
  if (
    !Array.isArray(maybeTensor.dims) ||
    !maybeTensor.dims.every((value) => typeof value === 'number')
  ) {
    throw new Error(`CP vertex refiner ONNX output ${tensorName} is missing numeric dims`);
  }
  return {
    data: maybeTensor.data,
    dims: maybeTensor.dims,
  };
}
