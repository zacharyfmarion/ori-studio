import { expose } from 'comlink';
import * as ort from 'onnxruntime-web/webgpu';
import ortWasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import init, {
  cp_detect_ablate_dense_outputs,
  cp_detect_auto_rectify_rgba,
  cp_detect_decode_dense_output_bundle,
  cp_detect_decode_dense_output_bundle_with_source_image_line_evidence,
  cp_detect_decode_dense_output_bundle_with_junction_source,
  cp_detect_manual_rectify_rgba,
  cp_detect_package_info,
  cp_detect_parse_model_manifest,
} from '../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';
import type {
  CpDetectDenseOutputs,
  CpDetectAblationResult,
  CpDetectExecutionProvider,
  CpDetectFoldResult,
  CpDetectInferenceResult,
  CpDetectJunctionSource,
  CpDetectLineEvidenceSource,
  CpDetectRuntimeInfo,
  CpDetectModelManifest,
  CpDetectQuad,
  CpDetectRectifiedImage,
  CpDetectRectificationReport,
  CpDetectWorkerRunOptions,
} from '../engine/cpDetectTypes';
import {
  CP_DETECT_DEFAULT_JUNCTION_SOURCE,
  CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE,
} from '../engine/cpDetectTypes';
import type { WasmErrorEnvelope } from '../engine/types';
import {
  DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  CP_DETECT_OUTPUT_KEYS,
  fetchCpDetectModelManifest,
  runCpDetectDenseInference,
  type CpDetectOnnxSession,
} from '../lib/cpDetectInference';

let wasmReady: Promise<void> | null = null;
let sessionPromise: Promise<CpDetectSessionRuntime> | null = null;
let manifestPromise: Promise<CpDetectModelManifest> | null = null;
let manifestKey: string | null = null;
let modelPresencePromise: Promise<void> | null = null;
let modelPresenceKey: string | null = null;
let sessionKey: string | null = null;
let ortRuntimeConfigured = false;
let ortWasmThreads = 1;
// ORT WebGPU is not reliable when sessions compile or dispatch concurrently in one worker.
let ortOperationQueue: Promise<void> = Promise.resolve();

type ActiveExecutionProvider = 'webgpu' | 'wasm';

interface CpDetectSessionRuntime {
  session: ort.InferenceSession;
  runtime: CpDetectRuntimeInfo;
}

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
  options: CpDetectWorkerRunOptions = {}
): Promise<CpDetectSessionRuntime> {
  configureOrtRuntime();
  const modelUrl = options.modelUrl ?? resolveModelUrl(manifest.model.url, manifestUrl);
  const requestedProvider = options.executionProvider ?? 'auto';
  const key = JSON.stringify({
    modelUrl,
    requestedProvider,
    wasmThreads: ortWasmThreads,
  });
  if (sessionPromise && sessionKey === key) return sessionPromise;
  sessionKey = key;
  sessionPromise = createSessionRuntime(modelUrl, requestedProvider).catch((error) => {
    if (sessionKey === key) {
      sessionKey = null;
      sessionPromise = null;
    }
    throw error;
  });
  return sessionPromise;
}

function configureOrtRuntime(): void {
  if (ortRuntimeConfigured) return;
  ortWasmThreads = chooseWasmThreadCount();
  ort.env.wasm.numThreads = ortWasmThreads;
  ort.env.wasm.wasmPaths = {
    mjs: ortWasmMjsUrl,
    wasm: ortWasmUrl,
  };
  ort.env.webgpu.powerPreference = 'high-performance';
  ortRuntimeConfigured = true;
}

async function createSessionRuntime(
  modelUrl: string,
  requestedProvider: CpDetectExecutionProvider
): Promise<CpDetectSessionRuntime> {
  const webgpuAvailable = hasWebGpu();
  let fallbackReason: string | undefined;
  for (const provider of providerCandidates(requestedProvider, webgpuAvailable)) {
    const startedAt = performance.now();
    try {
      const session = await enqueueOrtOperation(() =>
        ort.InferenceSession.create(modelUrl, sessionOptions(provider))
      );
      return {
        session,
        runtime: {
          requested_execution_provider: requestedProvider,
          active_execution_provider: provider,
          webgpu_available: webgpuAvailable,
          wasm_threads: ortWasmThreads,
          session_create_ms: performance.now() - startedAt,
          fallback_reason: fallbackReason,
        },
      };
    } catch (error) {
      if (requestedProvider !== 'auto' || provider !== 'webgpu') {
        throw error;
      }
      fallbackReason = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error('No CP detector execution provider is available');
}

function chooseWasmThreadCount(): number {
  if (!self.crossOriginIsolated) return 1;
  const hardwareConcurrency = navigator.hardwareConcurrency || 1;
  return Math.max(1, Math.min(4, Math.ceil(hardwareConcurrency / 2)));
}

function hasWebGpu(): boolean {
  return !!(navigator as Navigator & { gpu?: unknown }).gpu;
}

function providerCandidates(
  requestedProvider: CpDetectExecutionProvider,
  webgpuAvailable: boolean
): ActiveExecutionProvider[] {
  if (requestedProvider === 'wasm') return ['wasm'];
  if (requestedProvider === 'webgpu') return ['webgpu'];
  return webgpuAvailable ? ['webgpu', 'wasm'] : ['wasm'];
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

function sessionOptions(provider: ActiveExecutionProvider): ort.InferenceSession.SessionOptions {
  return {
    executionProviders: provider === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
    graphOptimizationLevel: 'all',
  };
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
      await ensureSession(manifest, manifestUrl, options);
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
      const requestedJunctionSource = options.junctionSource ?? CP_DETECT_DEFAULT_JUNCTION_SOURCE;
      const lineEvidenceSource = resolveLineEvidenceSource(options.lineEvidenceSource);
      const inference = await denseInferenceForImage(image, options);
      const requestedDecodeJunctionSource: CpDetectJunctionSource =
        requestedJunctionSource === 'line-arrangement'
          ? 'line-arrangement'
          : 'dense-model';
      const decoded = decodeFoldFromDenseOutputs(
        image,
        inference.outputs,
        inference.manifest,
        options,
        requestedDecodeJunctionSource,
        lineEvidenceSource
      );
      const junctionSource = detectedJunctionSource(decoded.report, requestedDecodeJunctionSource);
      return {
        status: decoded.report.status,
        foldJson: decoded.fold_json,
        detectorReport: decoded.report,
        manifest: inference.manifest,
        junctionSource,
        lineEvidenceSource,
        runtime: inference.runtime,
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
  const sessionRuntime = await ensureSession(manifest, manifestUrl, options);
  const inference = await runCpDetectDenseInference(
    cpDetectSessionFromOrt(sessionRuntime.session),
    {
      float32(data, dims) {
        return new ort.Tensor('float32', data, Array.from(dims));
      },
    },
    image,
    manifest
  );
  return {
    ...inference,
    runtime: {
      ...sessionRuntime.runtime,
      ...inference.runtime,
    },
  };
}

type WasmDecodedFold = {
  fold_json: string;
  report: CpDetectFoldResult['detectorReport'];
};

function decodeFoldFromDenseOutputs(
  image: ImageData,
  outputs: CpDetectDenseOutputs,
  manifest: CpDetectModelManifest,
  options: CpDetectWorkerRunOptions = {},
  junctionSource: CpDetectJunctionSource = 'dense-model',
  lineEvidenceSource: CpDetectLineEvidenceSource = 'source-image'
): WasmDecodedFold {
  const decoderBackend = options.decoderBackend ?? 'legacy_v2_decoder';
  const outputBundle = Object.fromEntries(
    CP_DETECT_OUTPUT_KEYS
      .filter((key) => outputs[key])
      .map((key) => [key, outputs[key].data])
  );
  if (lineEvidenceSource === 'source-image') {
    return withLineEvidenceSource(
      cp_detect_decode_dense_output_bundle_with_source_image_line_evidence(
        outputBundle,
        manifest.inference.image_size,
        manifest.inference.threshold,
        decoderBackend,
        manifest.inference.junction_offset_radius_px,
        options.exactSolveTimeoutSeconds ?? null,
        junctionSource,
        'null',
        imageDataBytes(image),
        image.width,
        image.height
      ) as WasmDecodedFold,
      lineEvidenceSource
    );
  }
  if (junctionSource === 'line-arrangement') {
    return withLineEvidenceSource(
      cp_detect_decode_dense_output_bundle_with_junction_source(
        outputBundle,
        manifest.inference.image_size,
        manifest.inference.threshold,
        decoderBackend,
        manifest.inference.junction_offset_radius_px,
        options.exactSolveTimeoutSeconds ?? null,
        junctionSource,
        'null'
      ) as WasmDecodedFold,
      lineEvidenceSource
    );
  }
  return withLineEvidenceSource(
    cp_detect_decode_dense_output_bundle(
      outputBundle,
      manifest.inference.image_size,
      manifest.inference.threshold,
      decoderBackend,
      manifest.inference.junction_offset_radius_px,
      options.exactSolveTimeoutSeconds ?? null
    ) as WasmDecodedFold,
    lineEvidenceSource
  );
}

function resolveLineEvidenceSource(
  value: CpDetectWorkerRunOptions['lineEvidenceSource']
): CpDetectLineEvidenceSource {
  if (value === undefined || value === null || value === CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE) {
    return CP_DETECT_DEFAULT_LINE_EVIDENCE_SOURCE;
  }
  if (value === 'dense-model') {
    return 'dense-model';
  }
  throw new Error(`Unsupported CP detector line evidence source: ${String(value)}`);
}

function withLineEvidenceSource(
  decoded: WasmDecodedFold,
  lineEvidenceSource: CpDetectLineEvidenceSource
): WasmDecodedFold {
  return {
    ...decoded,
    report: {
      ...decoded.report,
      quality_report: {
        ...(decoded.report.quality_report ?? {}),
        line_evidence_source: lineEvidenceSource,
      },
    },
  };
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
      return enqueueOrtOperation(() =>
        session.run(feeds as Parameters<ort.InferenceSession['run']>[0]) as Promise<
          Record<string, unknown>
        >,
      );
    },
  };
}


function enqueueOrtOperation<T>(operation: () => Promise<T>): Promise<T> {
  const run = ortOperationQueue.then(operation, operation);
  ortOperationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detectedJunctionSource(
  report: CpDetectFoldResult['detectorReport'],
  fallback: CpDetectJunctionSource
): CpDetectJunctionSource {
  const source = report.quality_report?.junction_source;
  return source === 'dense-model' || source === 'line-arrangement' || source === 'vertex-refiner-v3'
    ? source
    : fallback;
}

export type CpDetectWorkerApi = typeof api;

expose(api);
