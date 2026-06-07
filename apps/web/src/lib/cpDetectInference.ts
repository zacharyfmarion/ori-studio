import type {
  CpDetectDenseOutputKey,
  CpDetectDenseOutputs,
  CpDetectInferenceResult,
  CpDetectModelManifest,
  CpDetectOutputTensorNames,
  CpDetectTensorData,
} from '../engine/cpDetectTypes';

export const DEFAULT_CP_DETECT_MODEL_MANIFEST_URL = '/models/cp-detector-v2/manifest.json';

export const CP_DETECT_OUTPUT_KEYS = [
  'line_logits',
  'angle',
  'junction_logits',
  'junction_offset',
  'assignment_logits',
  'non_crease_logits',
  'line_style_logits',
  'boundary_contact_logits',
  'vertex_type_logits',
  'boundary_side_logits',
  'boundary_offset',
  'boundary_coord',
] as const satisfies readonly CpDetectDenseOutputKey[];

export interface CpDetectOnnxSession {
  inputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface CpDetectTensorFactory {
  float32(data: Float32Array, dims: readonly number[]): unknown;
}

export async function fetchCpDetectModelManifest(
  manifestUrl = DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  const response = await fetchImpl(manifestUrl);
  if (!response.ok) {
    throw new Error(`Failed to load CP detector manifest: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function preprocessCpDetectImage(image: ImageData, imageSize: number): Float32Array {
  if (image.width !== imageSize || image.height !== imageSize) {
    throw new Error(
      `CP detector input must be ${imageSize}x${imageSize}; got ${image.width}x${image.height}`
    );
  }
  const pixelCount = imageSize * imageSize;
  const tensor = new Float32Array(3 * pixelCount);
  const redOffset = 0;
  const greenOffset = pixelCount;
  const blueOffset = pixelCount * 2;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgba = pixel * 4;
    tensor[redOffset + pixel] = image.data[rgba] / 255;
    tensor[greenOffset + pixel] = image.data[rgba + 1] / 255;
    tensor[blueOffset + pixel] = image.data[rgba + 2] / 255;
  }
  return tensor;
}

export async function runCpDetectDenseInference(
  session: CpDetectOnnxSession,
  tensorFactory: CpDetectTensorFactory,
  image: ImageData,
  manifest: CpDetectModelManifest
): Promise<CpDetectInferenceResult> {
  const startedAt = performance.now();
  const imageSize = manifest.inference.image_size;
  const inputName = session.inputNames[0];
  if (!inputName) {
    throw new Error('CP detector ONNX session has no input names');
  }
  const preprocessStartedAt = performance.now();
  const inputTensor = tensorFactory.float32(
    preprocessCpDetectImage(image, imageSize),
    [1, 3, imageSize, imageSize]
  );
  const runStartedAt = performance.now();
  const rawOutputs = await session.run({ [inputName]: inputTensor });
  const collectStartedAt = performance.now();
  const outputs = collectCpDetectOutputs(rawOutputs, manifest.outputs);
  const finishedAt = performance.now();
  return {
    manifest,
    input: {
      image_size: imageSize,
      input_name: inputName,
    },
    outputs,
    runtime: {
      preprocess_ms: runStartedAt - preprocessStartedAt,
      model_run_ms: collectStartedAt - runStartedAt,
      output_collect_ms: finishedAt - collectStartedAt,
      total_inference_ms: finishedAt - startedAt,
    },
  };
}

export function cpDetectOutputNames(outputs: CpDetectOutputTensorNames): string[] {
  return CP_DETECT_OUTPUT_KEYS.map((key) => outputs[key]);
}

export function collectCpDetectOutputs(
  rawOutputs: Record<string, unknown>,
  outputNames: CpDetectOutputTensorNames
): CpDetectDenseOutputs {
  const entries = CP_DETECT_OUTPUT_KEYS.map((key) => {
    const tensorName = outputNames[key];
    const tensor = rawOutputs[tensorName];
    if (!tensor) {
      throw new Error(`CP detector ONNX output missing: ${tensorName}`);
    }
    return [key, normalizeTensorData(tensorName, tensor)] as const;
  });
  return Object.fromEntries(entries) as CpDetectDenseOutputs;
}

function normalizeTensorData(tensorName: string, tensor: unknown): CpDetectTensorData {
  if (!tensor || typeof tensor !== 'object') {
    throw new Error(`CP detector ONNX output ${tensorName} is not a tensor object`);
  }
  const maybeTensor = tensor as { data?: unknown; dims?: unknown };
  if (!(maybeTensor.data instanceof Float32Array)) {
    throw new Error(`CP detector ONNX output ${tensorName} is not float32 data`);
  }
  if (
    !Array.isArray(maybeTensor.dims) ||
    !maybeTensor.dims.every((value) => typeof value === 'number')
  ) {
    throw new Error(`CP detector ONNX output ${tensorName} is missing numeric dims`);
  }
  return {
    data: maybeTensor.data,
    dims: maybeTensor.dims,
  };
}
