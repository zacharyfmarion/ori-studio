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
  CpDetectDenseOutputs,
  CpDetectExecutionProvider,
  CpDetectModelManifest,
  CpDetectPaperFrame,
  CpDetectQuad,
  CpDetectRectifiedImage,
  CpDetectRectificationReport,
  CpDetectRuntimeInfo,
  CpDetectTensorData,
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
  CP_VERTEX_REFINER_OUTPUT_KEYS,
  fetchVertexRefinerModelManifest,
  runVertexRefinerInference,
  type VertexRefinerOnnxSession,
} from '../../web/src/lib/vertexRefinerInference';
import {
  runVertexRefinerOnImage,
  vertexRefinerCropOriginForCenter,
  type VertexRefinerImageResult,
  type VertexRefinerMergedVertex,
} from '../../web/src/lib/vertexRefinerPipeline';
import type {
  MapPayload,
  UploadedInspectorRunBundle,
  VertexRefinerCropDebugResponse,
  VertexRefinerRawMergeAssignment,
} from './types';

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
// ORT WebGPU is not reliable when sessions compile or dispatch concurrently in one worker.
let ortOperationQueue: Promise<void> = Promise.resolve();
const vertexRefinerDebugRuns = new Map<string, VertexRefinerImageResult>();

type ActiveExecutionProvider = 'webgpu' | 'wasm';

interface CpDetectSessionRuntime {
  session: ort.InferenceSession;
  runtime: CpDetectRuntimeInfo;
}

const VERTEX_REFINER_INPUT_CHANNEL_NAMES = [
  'image_gray',
  'source_ink_probability',
  'source_distance_to_ink',
  'source_orientation_cos2',
  'source_orientation_sin2',
  'signed_distance_to_frame',
  'frame_edge_mask',
  'inside_paper_mask',
  'boundary_contact_prior',
  'crop_x_normalized',
  'crop_y_normalized',
] as const;

const VERTEX_KIND_NAMES = [
  'background',
  'interior_junction',
  'boundary_contact',
  'corner',
  'endpoint_or_dangling',
] as const;
const BOUNDARY_SIDE_NAMES = ['top', 'right', 'bottom', 'left'] as const;

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
      const session = await enqueueOrtOperation(() =>
        ort.InferenceSession.create(modelUrl, sessionOptions(provider)),
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

async function vertexRefinerForImage(
  image: ImageData,
  options: CpDetectWorkerRunOptions,
  denseOutputs?: CpDetectDenseOutputs,
) {
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
    {
      frame: options.vertexRefinerFrame,
      proposalMode: options.vertexRefinerProposalMode,
      proposalCap: options.vertexRefinerProposalCap,
      denseJunctionLogits: denseOutputs?.junction_logits,
      denseRegionJunctionThreshold: options.vertexRefinerDenseRegionJunctionThreshold,
      denseRegionMinPeaks: options.vertexRefinerDenseRegionMinPeaks,
      denseRegionMaxOverlapFraction: options.vertexRefinerDenseRegionMaxOverlapFraction,
      gridStridePx: options.vertexRefinerGridStridePx,
      heatmapThreshold: options.vertexRefinerHeatmapThreshold,
      boundaryHeatmapThreshold: options.vertexRefinerBoundaryHeatmapThreshold,
      nmsRadiusPx: options.vertexRefinerNmsRadiusPx,
      mergeRadiusPx: options.vertexRefinerMergeRadiusPx,
      boundaryMergeRadiusPx: options.vertexRefinerBoundaryMergeRadiusPx,
      minSupport: options.vertexRefinerMinSupport,
      minSupportFraction: options.vertexRefinerMinSupportFraction,
      splitSameCropConflicts: options.vertexRefinerSplitSameCropConflicts,
      splitMinSupportFraction: options.vertexRefinerSplitMinSupportFraction,
      batchSize: options.vertexRefinerBatchSize,
      debug: true,
      runtime: sessionRuntime.runtime,
    },
  );
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

function vertexRefinerSessionFromOrt(session: ort.InferenceSession): VertexRefinerOnnxSession {
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
    const runId = `upload-${Date.now()}`;
    vertexRefinerDebugRuns.clear();
    const junctionSource = options.junctionSource ?? 'dense-model';
    const vertexRefinerFrame =
      options.vertexRefinerFrame ?? paperFrameFromRectificationReport(options.rectificationReport);
    const needsDenseForVertexRefiner =
      junctionSource === 'vertex-refiner-v3' &&
      options.vertexRefinerProposalMode === 'dense-junction-regions';
    const [inference, vertexRefiner] = needsDenseForVertexRefiner
      ? await (async () => {
          const dense = await denseInferenceForImage(image, options);
          const refined = await vertexRefinerForImage(
            image,
            { ...options, vertexRefinerFrame },
            dense.outputs,
          );
          return [dense, refined] as const;
        })()
      : await Promise.all([
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
          debug_run_id: runId,
          model_manifest_id: vertexRefiner.manifest.id,
          frame: vertexRefiner.frame,
          crop_size: vertexRefiner.inference.input.crop_size,
          input_channel_names: vertexRefinerInputChannelNames(vertexRefiner.manifest),
          output_head_names: Array.from(CP_VERTEX_REFINER_OUTPUT_KEYS),
          proposal_count: vertexRefiner.proposals.length,
          proposal_mode: options.vertexRefinerProposalMode ?? 'full-coverage',
          refinement_regions: vertexRefiner.refinement_regions ?? null,
          raw_prediction_count: vertexRefiner.raw_vertices.length,
          merged_vertex_count: vertexRefiner.merged_vertices.length,
          proposals: vertexRefiner.proposals,
          raw_vertices: vertexRefiner.raw_vertices.map((vertex, rawVertexId) =>
            decorateRawVertex(vertex, rawVertexId, vertexRefiner.merge_debug.raw_to_merged),
          ),
          merged_vertices: vertexRefiner.merged_vertices.map((vertex, mergedVertexId) =>
            decorateMergedVertex(vertex, mergedVertexId, vertexRefiner.merge_debug.raw_to_merged),
          ),
          raw_to_merged: vertexRefiner.merge_debug.raw_to_merged,
          merge_clusters: vertexRefiner.merge_debug.clusters,
          runtime: vertexRefiner.runtime ? { ...vertexRefiner.runtime } : null,
        }
      : null;
    if (vertexRefiner) {
      vertexRefinerDebugRuns.set(runId, vertexRefiner);
    }
    const bundle = cp_detect_build_inspector_stage_bundle_with_source_image(
      outputBundle,
      JSON.stringify({
        id: runId,
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
    if (vertexRefinerDebug) {
      bundle.stages.stage0.vertex_refiner = vertexRefinerDebug;
      bundle.stages.stage0.vertex_refiner_manifest_id = vertexRefinerDebug.model_manifest_id;
      bundle.stages.stage0b = {
        ...bundle.stages.stage0,
        schema: 'oristudio/cp-detect-inspector-stage0b/v1',
        crop_debug_run_id: runId,
        vertex_refiner: vertexRefinerDebug,
      };
      bundle.stage_order = [
        'stage0',
        'stage0b',
        ...bundle.stage_order.filter((stageId) => stageId !== 'stage0' && stageId !== 'stage0b'),
      ];
    }
    return bundle;
  },

  async getVertexRefinerCropDebug(
    runId: string,
    cropIndex: number,
  ): Promise<VertexRefinerCropDebugResponse> {
    const result = vertexRefinerDebugRuns.get(runId);
    if (!result?.debug) {
      throw new Error(`No V3 crop debug run is available for ${runId}`);
    }
    if (!Number.isInteger(cropIndex) || cropIndex < 0 || cropIndex >= result.proposals.length) {
      throw new Error(`V3 crop index ${cropIndex} is out of range`);
    }
    return buildVertexRefinerCropDebug(runId, result, cropIndex);
  },
};

export type InspectorUploadWorkerApi = typeof api;

expose(api);

function decorateRawVertex(
  vertex: VertexRefinerImageResult['raw_vertices'][number],
  rawVertexId: number,
  assignments: readonly VertexRefinerRawMergeAssignment[],
) {
  const assignment = assignments.find((entry) => entry.raw_vertex_id === rawVertexId);
  return {
    ...vertex,
    raw_vertex_id: rawVertexId,
    merged_vertex_id: assignment?.merged_vertex_id ?? null,
    cluster_id: assignment?.cluster_id ?? null,
    merge_status: assignment?.status ?? null,
    merge_reason: assignment?.reason ?? null,
  };
}

function decorateMergedVertex(
  vertex: VertexRefinerMergedVertex,
  mergedVertexId: number,
  assignments: readonly VertexRefinerRawMergeAssignment[],
) {
  return {
    ...vertex,
    merged_vertex_id: mergedVertexId,
    raw_vertex_ids: assignments
      .filter((entry) => entry.merged_vertex_id === mergedVertexId)
      .map((entry) => entry.raw_vertex_id),
  };
}

function buildVertexRefinerCropDebug(
  runId: string,
  result: VertexRefinerImageResult,
  cropIndex: number,
): VertexRefinerCropDebugResponse {
  const cropSize = result.inference.input.crop_size;
  const proposal = result.proposals[cropIndex];
  if (!proposal || !result.debug) {
    throw new Error(`V3 crop index ${cropIndex} is unavailable`);
  }
  const [originX, originY] = vertexRefinerCropOriginForCenter(proposal, cropSize);
  const cropBox = {
    x_min: originX,
    y_min: originY,
    x_max: originX + cropSize,
    y_max: originY + cropSize,
  };
  const assignmentsByRawId = new Map(
    result.merge_debug.raw_to_merged.map((assignment) => [assignment.raw_vertex_id, assignment]),
  );
  const rawVertices = result.raw_vertices
    .map((vertex, rawVertexId) => ({ vertex, rawVertexId }))
    .filter(({ vertex }) => vertex.crop_index === cropIndex)
    .map(({ vertex, rawVertexId }) => {
      const assignment = assignmentsByRawId.get(rawVertexId);
      return {
        ...vertex,
        raw_vertex_id: rawVertexId,
        merged_vertex_id: assignment?.merged_vertex_id ?? null,
        cluster_id: assignment?.cluster_id ?? null,
        merge_status: assignment?.status ?? null,
        merge_reason: assignment?.reason ?? null,
        local_x: vertex.x - originX,
        local_y: vertex.y - originY,
      };
    });
  const supportedMergedIds = new Set(
    rawVertices
      .map((vertex) => vertex.merged_vertex_id)
      .filter((mergedVertexId): mergedVertexId is number => typeof mergedVertexId === 'number'),
  );
  const mergedVertices = result.merged_vertices
    .map((vertex, mergedVertexId) => ({ vertex, mergedVertexId }))
    .filter(({ mergedVertexId }) => supportedMergedIds.has(mergedVertexId))
    .map(({ vertex, mergedVertexId }) => {
      const rawVertexIds = result.merge_debug.raw_to_merged
        .filter((assignment) => assignment.merged_vertex_id === mergedVertexId)
        .map((assignment) => assignment.raw_vertex_id);
      return {
        ...vertex,
        merged_vertex_id: mergedVertexId,
        raw_vertex_ids: rawVertexIds,
        local_x: vertex.x - originX,
        local_y: vertex.y - originY,
      };
    });
  const clusterIds = new Set(rawVertices.map((vertex) => vertex.cluster_id).filter((clusterId): clusterId is number => typeof clusterId === 'number'));
  const mergeClusters = result.merge_debug.clusters.filter((cluster) => clusterIds.has(cluster.cluster_id));
  return {
    schema: 'oristudio/cp-detect-v3-crop-debug/v1',
    run_id: runId,
    crop_index: cropIndex,
    crop_size: cropSize,
    crop_box: cropBox,
    proposal,
    input_maps: vertexRefinerInputMaps(result, cropIndex),
    output_maps: vertexRefinerOutputMaps(result, cropIndex),
    raw_vertices: rawVertices,
    merged_vertices: mergedVertices,
    raw_to_merged: result.merge_debug.raw_to_merged.filter((assignment) =>
      rawVertices.some((vertex) => vertex.raw_vertex_id === assignment.raw_vertex_id),
    ),
    merge_clusters: mergeClusters,
  };
}

function vertexRefinerInputMaps(
  result: VertexRefinerImageResult,
  cropIndex: number,
): MapPayload[] {
  if (!result.debug) return [];
  const cropSize = result.inference.input.crop_size;
  const inputChannels = result.manifest.inference.input_channels;
  const cropArea = cropSize * cropSize;
  const cropOffset = cropIndex * inputChannels * cropArea;
  const names = vertexRefinerInputChannelNames(result.manifest);
  return names.map((name, channel) =>
    mapPayloadFromValues(
      `input:${name}`,
      name.replaceAll('_', ' '),
      cropSize,
      cropSize,
      result.debug?.crop_tensor.subarray(cropOffset + channel * cropArea, cropOffset + (channel + 1) * cropArea) ?? new Float32Array(cropArea),
    ),
  );
}

function vertexRefinerInputChannelNames(manifest: CpVertexRefinerModelManifest): string[] {
  const names = Array.from(manifest.inference.input_channel_names ?? VERTEX_REFINER_INPUT_CHANNEL_NAMES);
  while (names.length < manifest.inference.input_channels) {
    names.push(`input_channel_${names.length}`);
  }
  return names.slice(0, manifest.inference.input_channels);
}

function vertexRefinerOutputMaps(
  result: VertexRefinerImageResult,
  cropIndex: number,
): MapPayload[] {
  const cropSize = result.inference.input.crop_size;
  const maps: MapPayload[] = [];
  maps.push(
    tensorChannelMap('output:vertex_heatmap', 'vertex heatmap', result.inference.outputs.vertex_heatmap, cropIndex, 0, cropSize, sigmoid),
    tensorChannelMap(
      'output:boundary_contact_heatmap',
      'boundary contact heatmap',
      result.inference.outputs.boundary_contact_heatmap,
      cropIndex,
      0,
      cropSize,
      sigmoid,
    ),
    tensorChannelMap('output:offset_dx', 'offset dx', result.inference.outputs.vertex_offset, cropIndex, 0, cropSize),
    tensorChannelMap('output:offset_dy', 'offset dy', result.inference.outputs.vertex_offset, cropIndex, 1, cropSize),
    offsetMagnitudeMap(result.inference.outputs.vertex_offset, cropIndex, cropSize),
  );
  VERTEX_KIND_NAMES.forEach((name, channel) => {
    maps.push(softmaxChannelMap(`output:vertex_kind:${name}`, `kind ${name}`, result.inference.outputs.vertex_kind, cropIndex, channel, cropSize));
  });
  for (let channel = 0; channel < (result.inference.outputs.degree.dims[1] ?? 0); channel += 1) {
    maps.push(softmaxChannelMap(`output:degree:${channel}`, `degree ${channel}`, result.inference.outputs.degree, cropIndex, channel, cropSize));
  }
  BOUNDARY_SIDE_NAMES.forEach((name, channel) => {
    maps.push(softmaxChannelMap(`output:boundary_side:${name}`, `side ${name}`, result.inference.outputs.boundary_side, cropIndex, channel, cropSize));
  });
  for (let channel = 0; channel < (result.inference.outputs.incident_rays.dims[1] ?? 0); channel += 1) {
    maps.push(tensorChannelMap(`output:incident_ray:${channel}`, `ray bin ${channel}`, result.inference.outputs.incident_rays, cropIndex, channel, cropSize, sigmoid));
  }
  return maps;
}

function tensorChannelMap(
  id: string,
  label: string,
  tensor: CpDetectTensorData,
  cropIndex: number,
  channel: number,
  cropSize: number,
  transform: (value: number) => number = (value) => value,
): MapPayload {
  const area = cropSize * cropSize;
  const values = new Float32Array(area);
  const channels = tensor.dims[1] ?? 1;
  const offset = cropIndex * channels * area + channel * area;
  for (let index = 0; index < area; index += 1) {
    values[index] = transform(tensor.data[offset + index] ?? 0);
  }
  return mapPayloadFromValues(id, label, cropSize, cropSize, values);
}

function softmaxChannelMap(
  id: string,
  label: string,
  tensor: CpDetectTensorData,
  cropIndex: number,
  channel: number,
  cropSize: number,
): MapPayload {
  const area = cropSize * cropSize;
  const channels = tensor.dims[1] ?? 1;
  const values = new Float32Array(area);
  for (let index = 0; index < area; index += 1) {
    let maxLogit = -Infinity;
    for (let nextChannel = 0; nextChannel < channels; nextChannel += 1) {
      maxLogit = Math.max(maxLogit, tensor.data[cropIndex * channels * area + nextChannel * area + index] ?? 0);
    }
    let sum = 0;
    for (let nextChannel = 0; nextChannel < channels; nextChannel += 1) {
      sum += Math.exp((tensor.data[cropIndex * channels * area + nextChannel * area + index] ?? 0) - maxLogit);
    }
    values[index] = Math.exp((tensor.data[cropIndex * channels * area + channel * area + index] ?? 0) - maxLogit) / Math.max(sum, 1e-9);
  }
  return mapPayloadFromValues(id, label, cropSize, cropSize, values);
}

function offsetMagnitudeMap(
  tensor: CpDetectTensorData,
  cropIndex: number,
  cropSize: number,
): MapPayload {
  const area = cropSize * cropSize;
  const channels = tensor.dims[1] ?? 2;
  const offset = cropIndex * channels * area;
  const values = new Float32Array(area);
  for (let index = 0; index < area; index += 1) {
    const dx = tensor.data[offset + index] ?? 0;
    const dy = tensor.data[offset + area + index] ?? 0;
    values[index] = Math.hypot(dx, dy);
  }
  return mapPayloadFromValues('output:offset_magnitude', 'offset magnitude', cropSize, cropSize, values);
}

function mapPayloadFromValues(
  id: string,
  label: string,
  width: number,
  height: number,
  values: Float32Array,
): MapPayload {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (Number.isFinite(value)) {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = 0;
    max = 0;
  }
  const span = Math.max(max - min, 1e-9);
  const scaled = Array.from(values, (value) => Math.round(255 * ((Number.isFinite(value) ? value : min) - min) / span));
  return {
    id,
    label,
    width,
    height,
    min,
    max,
    values: scaled,
  };
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

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
