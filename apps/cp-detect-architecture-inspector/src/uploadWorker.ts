import { expose } from 'comlink';
import * as ort from 'onnxruntime-web/webgpu';
import ortWasmMjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import init, {
  cp_detect_auto_rectify_rgba,
  cp_detect_build_inspector_stage_bundle,
  cp_detect_build_inspector_stage_bundle_with_source_image,
  cp_detect_manual_rectify_rgba,
  cp_detect_parse_model_manifest,
} from '../../web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';
import type {
  CpDetectExecutionProvider,
  CpDetectModelManifest,
  CpDetectPaperFrame,
  CpDetectQuad,
  CpDetectRectifiedImage,
  CpDetectRectificationReport,
  CpDetectRuntimeInfo,
  CpDetectWorkerRunOptions,
  CpVertexRefinerModelManifest,
} from '../../web/src/engine/cpDetectTypes';
import {
  CP_DETECT_OUTPUT_KEYS,
  DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  fetchCpDetectModelManifest,
  runCpDetectDenseInference,
  type CpDetectOnnxSession,
} from '../../web/src/lib/cpDetectInference';
import {
  DEFAULT_CP_VERTEX_REFINER_MANIFEST_URL,
  fetchVertexRefinerModelManifest,
  runVertexRefinerInference,
  type VertexRefinerOnnxSession,
} from '../../web/src/lib/vertexRefinerInference';
import { runVertexRefinerOnImage } from '../../web/src/lib/vertexRefinerPipeline';
import type { UploadedInspectorRunBundle } from './types';

let wasmReady: Promise<void> | null = null;
let manifestPromise: Promise<CpDetectModelManifest> | null = null;
let manifestKey: string | null = null;
let modelPresencePromise: Promise<void> | null = null;
let modelPresenceKey: string | null = null;
let sessionPromise: Promise<CpDetectSessionRuntime> | null = null;
let sessionKey: string | null = null;
let vertexRefinerManifestPromise: Promise<CpVertexRefinerModelManifest> | null = null;
let vertexRefinerManifestKey: string | null = null;
let vertexRefinerModelPresencePromise: Promise<void> | null = null;
let vertexRefinerModelPresenceKey: string | null = null;
let vertexRefinerSessionPromise: Promise<CpDetectSessionRuntime> | null = null;
let vertexRefinerSessionKey: string | null = null;
let ortRuntimeConfigured = false;
let ortWasmThreads = 1;

type ActiveExecutionProvider = 'webgpu' | 'wasm';

interface CpDetectSessionRuntime {
  session: ort.InferenceSession;
  runtime: CpDetectRuntimeInfo;
}

export interface UploadedInspectorRunOptions extends CpDetectWorkerRunOptions {
  filename?: string | null;
  inputImageUrl?: string | null;
  junctionSource?: 'dense-model' | 'vertex-refiner-v3';
  vertexRefinerManifestId?: string | null;
  candidateStrategy?: string;
  legacyLowThreshold?: number;
  legacySnapRadiusPx?: number;
  exactSolveTimeoutSeconds?: number;
  rectificationReport?: unknown;
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

async function ensureVertexRefinerManifest(
  manifestUrl: string,
): Promise<CpVertexRefinerModelManifest> {
  if (!vertexRefinerManifestPromise || vertexRefinerManifestKey !== manifestUrl) {
    vertexRefinerManifestKey = manifestUrl;
    vertexRefinerManifestPromise = fetchVertexRefinerModelManifest(manifestUrl).catch((error) => {
      if (vertexRefinerManifestKey === manifestUrl) {
        vertexRefinerManifestKey = null;
        vertexRefinerManifestPromise = null;
      }
      throw error;
    });
  }
  return vertexRefinerManifestPromise;
}

async function ensureSession(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  options: CpDetectWorkerRunOptions = {},
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

async function ensureVertexRefinerSession(
  manifest: CpVertexRefinerModelManifest,
  manifestUrl: string,
  options: CpDetectWorkerRunOptions = {},
): Promise<CpDetectSessionRuntime> {
  configureOrtRuntime();
  const modelUrl =
    options.vertexRefinerModelUrl ?? resolveModelUrl(manifest.model.url, manifestUrl);
  const requestedProvider = options.executionProvider ?? 'auto';
  const key = JSON.stringify({
    modelUrl,
    requestedProvider,
    wasmThreads: ortWasmThreads,
  });
  if (vertexRefinerSessionPromise && vertexRefinerSessionKey === key) {
    return vertexRefinerSessionPromise;
  }
  vertexRefinerSessionKey = key;
  vertexRefinerSessionPromise = createSessionRuntime(modelUrl, requestedProvider).catch(
    (error) => {
      if (vertexRefinerSessionKey === key) {
        vertexRefinerSessionKey = null;
        vertexRefinerSessionPromise = null;
      }
      throw error;
    },
  );
  return vertexRefinerSessionPromise;
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
  requestedProvider: CpDetectExecutionProvider,
): Promise<CpDetectSessionRuntime> {
  const webgpuAvailable = hasWebGpu();
  let fallbackReason: string | undefined;
  for (const provider of providerCandidates(requestedProvider, webgpuAvailable)) {
    const startedAt = performance.now();
    try {
      const session = await ort.InferenceSession.create(modelUrl, sessionOptions(provider));
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
      if (requestedProvider !== 'auto' || provider !== 'webgpu') throw error;
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
  webgpuAvailable: boolean,
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
  manifest: { model: { url: string } },
  manifestUrl: string,
  modelUrlOverride?: string,
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

async function ensureVertexRefinerModelPresent(
  manifest: CpVertexRefinerModelManifest,
  manifestUrl: string,
  modelUrlOverride?: string,
): Promise<void> {
  const modelUrl = modelUrlOverride ?? resolveModelUrl(manifest.model.url, manifestUrl);
  if (vertexRefinerModelPresencePromise && vertexRefinerModelPresenceKey === modelUrl) {
    return vertexRefinerModelPresencePromise;
  }
  vertexRefinerModelPresenceKey = modelUrl;
  vertexRefinerModelPresencePromise = fetchModelPresence(modelUrl).catch((error) => {
    if (vertexRefinerModelPresenceKey === modelUrl) {
      vertexRefinerModelPresenceKey = null;
      vertexRefinerModelPresencePromise = null;
    }
    throw error;
  });
  return vertexRefinerModelPresencePromise;
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

async function denseInferenceForImage(image: ImageData, options: CpDetectWorkerRunOptions) {
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
    manifest,
  );
  return {
    ...inference,
    runtime: {
      ...sessionRuntime.runtime,
      ...inference.runtime,
    },
  };
}

async function vertexRefinerForImage(image: ImageData, options: CpDetectWorkerRunOptions) {
  const manifestUrl =
    options.vertexRefinerManifestUrl ?? DEFAULT_CP_VERTEX_REFINER_MANIFEST_URL;
  const manifest = await ensureVertexRefinerManifest(manifestUrl);
  const sessionRuntime = await ensureVertexRefinerSession(manifest, manifestUrl, options);
  return runVertexRefinerOnImage(
    vertexRefinerSessionFromOrt(sessionRuntime.session),
    {
      float32(data, dims) {
        return new ort.Tensor('float32', data, Array.from(dims));
      },
    },
    image,
    manifest,
    { frame: options.vertexRefinerFrame, runtime: sessionRuntime.runtime },
  );
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

function vertexRefinerSessionFromOrt(session: ort.InferenceSession): VertexRefinerOnnxSession {
  return {
    inputNames: session.inputNames,
    async run(feeds) {
      return session.run(feeds as Parameters<ort.InferenceSession['run']>[0]) as Promise<
        Record<string, unknown>
      >;
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

const api = {
  async verifyModelAssets(options: CpDetectWorkerRunOptions = {}): Promise<CpDetectModelManifest> {
    await ensureWasmReady();
    const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
    const manifest = await ensureManifest(manifestUrl);
    await ensureModelPresent(manifest, manifestUrl, options.modelUrl);
    return manifest;
  },

  async verifyVertexRefinerAssets(
    options: CpDetectWorkerRunOptions = {},
  ): Promise<CpVertexRefinerModelManifest> {
    const manifestUrl =
      options.vertexRefinerManifestUrl ?? DEFAULT_CP_VERTEX_REFINER_MANIFEST_URL;
    const manifest = await ensureVertexRefinerManifest(manifestUrl);
    await ensureVertexRefinerModelPresent(
      manifest,
      manifestUrl,
      options.vertexRefinerModelUrl,
    );
    const sessionRuntime = await ensureVertexRefinerSession(manifest, manifestUrl, options);
    const cropSize = manifest.inference.crop_size;
    const inputChannels = manifest.inference.input_channels;
    await runVertexRefinerInference(
      vertexRefinerSessionFromOrt(sessionRuntime.session),
      {
        float32(data, dims) {
          return new ort.Tensor('float32', data, Array.from(dims));
        },
      },
      new Float32Array(inputChannels * cropSize * cropSize),
      manifest,
      sessionRuntime.runtime,
    );
    return manifest;
  },

  async autoRectifyImage(image: ImageData, imageSize = 1024): Promise<CpDetectRectifiedImage> {
    await ensureWasmReady();
    return rectifyFromWasm(cp_detect_auto_rectify_rgba(
      imageDataBytes(image),
      image.width,
      image.height,
      imageSize,
    ));
  },

  async manualRectifyImage(
    image: ImageData,
    quad: CpDetectQuad,
    imageSize = 1024,
  ): Promise<CpDetectRectifiedImage> {
    await ensureWasmReady();
    return rectifyFromWasm(cp_detect_manual_rectify_rgba(
      imageDataBytes(image),
      image.width,
      image.height,
      imageSize,
      JSON.stringify(quad),
    ));
  },

  async runUploadedInspector(
    image: ImageData,
    options: UploadedInspectorRunOptions = {},
  ): Promise<UploadedInspectorRunBundle> {
    await ensureWasmReady();
    const junctionSource = options.junctionSource ?? 'dense-model';
    const vertexRefinerFrame =
      options.vertexRefinerFrame ?? paperFrameFromRectificationReport(options.rectificationReport);
    const [inference, vertexRefiner] = await Promise.all([
      denseInferenceForImage(image, options),
      junctionSource === 'vertex-refiner-v3'
        ? vertexRefinerForImage(image, { ...options, vertexRefinerFrame })
        : null,
    ]);
    const outputBundle = Object.fromEntries(
      CP_DETECT_OUTPUT_KEYS
        .filter((key) => inference.outputs[key])
        .map((key) => [key, inference.outputs[key].data]),
    );
    const vertexRefinerDebug = vertexRefiner
      ? {
          model_manifest_id: vertexRefiner.manifest.id,
          frame: vertexRefiner.frame,
          proposal_count: vertexRefiner.proposals.length,
          raw_prediction_count: vertexRefiner.raw_vertices.length,
          merged_vertex_count: vertexRefiner.merged_vertices.length,
          proposals: vertexRefiner.proposals,
          raw_vertices: vertexRefiner.raw_vertices,
          merged_vertices: vertexRefiner.merged_vertices,
          runtime: vertexRefiner.runtime ?? null,
        }
      : null;
    return cp_detect_build_inspector_stage_bundle_with_source_image(
      outputBundle,
      JSON.stringify({
        id: `upload-${Date.now()}`,
        source_id: options.filename ?? 'uploaded image',
        filename: options.filename ?? null,
        image_size: inference.manifest.inference.image_size,
        threshold: inference.manifest.inference.threshold,
        map_size: 192,
        input_image_url: options.inputImageUrl ?? null,
        model_manifest_id: inference.manifest.id,
        rectification_report: options.rectificationReport ?? null,
        runtime: inference.runtime ?? null,
        junction_source: junctionSource,
        vertex_refiner_manifest_id:
          vertexRefiner?.manifest.id ?? options.vertexRefinerManifestId ?? null,
        vertex_refiner: vertexRefinerDebug,
        candidate_strategy: options.candidateStrategy ?? 'junction-first-v1',
        legacy_low_threshold: options.legacyLowThreshold ?? null,
        legacy_snap_radius_px: options.legacySnapRadiusPx ?? null,
        offset_cluster_radius_px: inference.manifest.inference.junction_offset_radius_px ?? null,
        exact_solve_timeout_seconds: options.exactSolveTimeoutSeconds ?? null,
      }),
      imageDataBytes(image),
      image.width,
      image.height,
    ) as UploadedInspectorRunBundle;
  },
};

export type InspectorUploadWorkerApi = typeof api;

expose(api);

function paperFrameFromRectificationReport(report: unknown): CpDetectPaperFrame | undefined {
  if (!report || typeof report !== 'object') return undefined;
  return paperFrameFromQuad((report as { target_quad?: unknown }).target_quad);
}

function paperFrameFromQuad(quad: unknown): CpDetectPaperFrame | undefined {
  if (!quad || typeof quad !== 'object') return undefined;
  const topLeft = pointFromUnknown((quad as { top_left?: unknown }).top_left);
  const topRight = pointFromUnknown((quad as { top_right?: unknown }).top_right);
  const bottomRight = pointFromUnknown((quad as { bottom_right?: unknown }).bottom_right);
  const bottomLeft = pointFromUnknown((quad as { bottom_left?: unknown }).bottom_left);
  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return undefined;
  const xs = [topLeft.x, topRight.x, bottomRight.x, bottomLeft.x];
  const ys = [topLeft.y, topRight.y, bottomRight.y, bottomLeft.y];
  return {
    x_min: Math.min(...xs),
    y_min: Math.min(...ys),
    x_max: Math.max(...xs),
    y_max: Math.max(...ys),
  };
}

function pointFromUnknown(value: unknown): { x: number; y: number } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const x = Number((value as { x?: unknown }).x);
  const y = Number((value as { y?: unknown }).y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x, y };
}
