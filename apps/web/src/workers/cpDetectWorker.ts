import { expose } from 'comlink';
import * as ort from 'onnxruntime-web/wasm';
import ortWasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import init, {
  cp_detect_ablate_dense_outputs,
  cp_detect_auto_rectify_rgba,
  cp_detect_decode_dense_outputs,
  cp_detect_decode_dense_outputs_with_backend,
  cp_detect_manual_rectify_rgba,
  cp_detect_package_info,
  cp_detect_parse_model_manifest,
} from '../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';
import type {
  CpDetectDenseOutputs,
  CpDetectAblationResult,
  CpDetectFoldResult,
  CpDetectInferenceResult,
  CpDetectModelManifest,
  CpDetectQuad,
  CpDetectRectifiedImage,
  CpDetectRectificationReport,
  CpDetectWorkerRunOptions,
} from '../engine/cpDetectTypes';
import type { WasmErrorEnvelope } from '../engine/types';
import {
  DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  fetchCpDetectModelManifest,
  runCpDetectDenseInference,
  type CpDetectOnnxSession,
} from '../lib/cpDetectInference';

let wasmReady: Promise<void> | null = null;
let sessionPromise: Promise<ort.InferenceSession> | null = null;
let manifestPromise: Promise<CpDetectModelManifest> | null = null;
let manifestKey: string | null = null;
let modelPresencePromise: Promise<void> | null = null;
let modelPresenceKey: string | null = null;
let sessionKey: string | null = null;
let ortRuntimeConfigured = false;

async function ensureWasmReady() {
  wasmReady ??= init().then(() => undefined);
  await wasmReady;
}

async function loadManifest(manifestUrl: string): Promise<CpDetectModelManifest> {
  await ensureWasmReady();
  const text = await fetchCpDetectModelManifest(manifestUrl);
  return cp_detect_parse_model_manifest(text) as CpDetectModelManifest;
}

async function ensureManifest(manifestUrl: string): Promise<CpDetectModelManifest> {
  if (!manifestPromise || manifestKey !== manifestUrl) {
    manifestKey = manifestUrl;
    manifestPromise = loadManifest(manifestUrl).catch((error) => {
      if (manifestKey === manifestUrl) {
        manifestKey = null;
        manifestPromise = null;
      }
      throw error;
    });
  }
  return manifestPromise;
}

async function ensureSession(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  modelUrlOverride?: string
): Promise<ort.InferenceSession> {
  configureOrtRuntime();
  const modelUrl = modelUrlOverride ?? resolveModelUrl(manifest.model.url, manifestUrl);
  if (sessionPromise && sessionKey === modelUrl) return sessionPromise;
  sessionKey = modelUrl;
  sessionPromise = ort.InferenceSession.create(modelUrl, sessionOptions()).catch((error) => {
    if (sessionKey === modelUrl) {
      sessionKey = null;
      sessionPromise = null;
    }
    throw error;
  });
  return sessionPromise;
}

function configureOrtRuntime(): void {
  if (ortRuntimeConfigured) return;
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = {
    mjs: ortWasmMjsUrl,
    wasm: ortWasmUrl,
  };
  ortRuntimeConfigured = true;
}

function resolveModelUrl(modelUrl: string, manifestUrl: string): string {
  const manifestAbsoluteUrl = new URL(manifestUrl, self.location.href);
  return new URL(modelUrl, manifestAbsoluteUrl).toString();
}

async function ensureModelPresent(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  modelUrlOverride?: string
): Promise<void> {
  const modelUrl = modelUrlOverride ?? resolveModelUrl(manifest.model.url, manifestUrl);
  if (modelPresencePromise && modelPresenceKey === modelUrl) return modelPresencePromise;
  modelPresenceKey = modelUrl;
  modelPresencePromise = fetchModelPresence(modelUrl).catch((error) => {
    if (modelPresenceKey === modelUrl) {
      modelPresenceKey = null;
      modelPresencePromise = null;
    }
    throw error;
  });
  return modelPresencePromise;
}

async function fetchModelPresence(modelUrl: string): Promise<void> {
  let response = await fetch(modelUrl, { method: 'HEAD' });
  if (response.ok) return;
  if (response.status === 405) {
    response = await fetch(modelUrl, { headers: { Range: 'bytes=0-0' } });
    if (response.ok || response.status === 206) return;
  }
  throw new Error(`Failed to load CP detector model: ${response.status} ${response.statusText}`);
}

function sessionOptions(): ort.InferenceSession.SessionOptions {
  return { executionProviders: ['wasm'] };
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'cp_detect',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(fn: () => Promise<T> | T): Promise<T> {
  await ensureWasmReady();
  try {
    return await fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
  async packageInfo(): Promise<unknown> {
    return call(() => cp_detect_package_info());
  },
  async loadModel(options: CpDetectWorkerRunOptions = {}): Promise<CpDetectModelManifest> {
    return call(async () => {
      const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
      const manifest = await ensureManifest(manifestUrl);
      await ensureSession(manifest, manifestUrl, options.modelUrl);
      return manifest;
    });
  },
  async verifyModelAssets(options: CpDetectWorkerRunOptions = {}): Promise<CpDetectModelManifest> {
    return call(async () => {
      const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
      const manifest = await ensureManifest(manifestUrl);
      await ensureModelPresent(manifest, manifestUrl, options.modelUrl);
      return manifest;
    });
  },
  async autoRectifyImage(image: ImageData, imageSize = 1024): Promise<CpDetectRectifiedImage> {
    return call(() => rectifyFromWasm(cp_detect_auto_rectify_rgba(
      imageDataBytes(image),
      image.width,
      image.height,
      imageSize
    )));
  },
  async manualRectifyImage(
    image: ImageData,
    quad: CpDetectQuad,
    imageSize = 1024
  ): Promise<CpDetectRectifiedImage> {
    return call(() => rectifyFromWasm(cp_detect_manual_rectify_rgba(
      imageDataBytes(image),
      image.width,
      image.height,
      imageSize,
      JSON.stringify(quad)
    )));
  },
  async runDenseInference(
    image: ImageData,
    options: CpDetectWorkerRunOptions = {}
  ): Promise<CpDetectInferenceResult> {
    return call(() => denseInferenceForImage(image, options));
  },
  async detectRectifiedFold(
    image: ImageData,
    options: CpDetectWorkerRunOptions = {}
  ): Promise<CpDetectFoldResult> {
    return call(async () => {
      const inference = await denseInferenceForImage(image, options);
      const decoded = decodeFoldFromDenseOutputs(inference.outputs, inference.manifest, options);
      return {
        status: decoded.report.status,
        foldJson: decoded.fold_json,
        detectorReport: decoded.report,
        manifest: inference.manifest,
      };
    });
  },
  async ablateRectifiedFold(
    image: ImageData,
    options: CpDetectWorkerRunOptions = {}
  ): Promise<CpDetectAblationResult> {
    return call(async () => {
      const inference = await denseInferenceForImage(image, options);
      const ablation = cp_detect_ablate_dense_outputs(
        inference.outputs.line_logits.data,
        inference.outputs.junction_logits.data,
        inference.outputs.assignment_logits.data,
        inference.outputs.non_crease_logits.data,
        inference.outputs.line_style_logits.data,
        inference.outputs.boundary_contact_logits.data,
        inference.manifest.inference.image_size,
        inference.manifest.inference.threshold
      ) as Omit<CpDetectAblationResult, 'manifest'>;
      return {
        ...ablation,
        manifest: inference.manifest,
      };
    });
  },
};

async function denseInferenceForImage(
  image: ImageData,
  options: CpDetectWorkerRunOptions
): Promise<CpDetectInferenceResult> {
  const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
  const baseManifest = await ensureManifest(manifestUrl);
  const manifest = {
    ...baseManifest,
    inference: {
      ...baseManifest.inference,
      threshold: options.threshold ?? baseManifest.inference.threshold,
    },
  };
  const session = await ensureSession(manifest, manifestUrl, options.modelUrl);
  return runCpDetectDenseInference(
    cpDetectSessionFromOrt(session),
    {
      float32(data, dims) {
        return new ort.Tensor('float32', data, Array.from(dims));
      },
    },
    image,
    manifest
  );
}

type WasmDecodedFold = {
  fold_json: string;
  report: CpDetectFoldResult['detectorReport'];
};

function decodeFoldFromDenseOutputs(
  outputs: CpDetectDenseOutputs,
  manifest: CpDetectModelManifest,
  options: CpDetectWorkerRunOptions = {}
): WasmDecodedFold {
  const decoderBackend = options.decoderBackend ?? 'legacy_v2_decoder';
  if (decoderBackend === 'legacy_v2_decoder') {
    return cp_detect_decode_dense_outputs(
      outputs.line_logits.data,
      outputs.junction_logits.data,
      outputs.assignment_logits.data,
      outputs.non_crease_logits.data,
      outputs.line_style_logits.data,
      outputs.boundary_contact_logits.data,
      manifest.inference.image_size,
      manifest.inference.threshold
    ) as WasmDecodedFold;
  }
  return cp_detect_decode_dense_outputs_with_backend(
    outputs.line_logits.data,
    outputs.junction_logits.data,
    outputs.assignment_logits.data,
    outputs.non_crease_logits.data,
    outputs.line_style_logits.data,
    outputs.boundary_contact_logits.data,
    manifest.inference.image_size,
    manifest.inference.threshold,
    decoderBackend
  ) as WasmDecodedFold;
}

type WasmRectifiedImage = {
  readonly width: number;
  readonly height: number;
  reportJson(): string;
  rgba(): Uint8Array;
  free?(): void;
};

function rectifyFromWasm(result: WasmRectifiedImage): CpDetectRectifiedImage {
  try {
    const report = JSON.parse(result.reportJson()) as CpDetectRectificationReport;
    const rgba = result.rgba();
    return {
      image: new ImageData(new Uint8ClampedArray(rgba), result.width, result.height),
      report,
    };
  } finally {
    result.free?.();
  }
}

function imageDataBytes(image: ImageData): Uint8Array {
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

function cpDetectSessionFromOrt(session: ort.InferenceSession): CpDetectOnnxSession {
  return {
    inputNames: session.inputNames,
    async run(feeds) {
      return session.run(feeds as Parameters<ort.InferenceSession['run']>[0]) as Promise<
        Record<string, unknown>
      >;
    },
  };
}

export type CpDetectWorkerApi = typeof api;

expose(api);
