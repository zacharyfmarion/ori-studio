import { expose } from 'comlink';
import type * as ort from 'onnxruntime-web/webgpu';
import init, {
  cp_detect_ablate_dense_outputs,
  cp_detect_auto_rectify_rgba,
  cp_detect_decode_dense_output_bundle,
  cp_detect_decode_dense_output_bundle_with_source_image_line_evidence,
  cp_detect_decode_dense_output_bundle_with_junction_source,
  cp_detect_manual_rectify_rgba,
  cp_detect_package_info,
  cp_detect_parse_model_manifest,
  cp_detect_solve_exact,
  cp_detect_solve_exact_to_fold,
} from '../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';
import type {
  CpDetectDenseOutputs,
  CpDetectAblationResult,
  CpDetectExecutionProvider,
  CpDetectFoldResult,
  CpDetectInferenceResult,
  CpDetectJunctionSource,
  CpDetectLineEvidenceSource,
  CpDetectRecognizeResult,
  CpDetectRuntimeInfo,
  CpDetectModelManifest,
  CpDetectQuad,
  CpDetectRectifiedImage,
  CpDetectRectificationReport,
  CpDetectWorkerRunOptions,
} from '../engine/cpDetectTypes';
import {
  CP_DETECT_DEFAULT_JUNCTION_SOURCE,
  cpDetectCandidateSourceFromFold,
  cpDetectSolveInput,
  cpDetectSolveState,
  cpDetectTopologyDiagnostics,
} from '../engine/cpDetectTypes';
import type {
  CpExactSolveFoldResult,
  CpExactSolvedGraph,
} from '../engine/cpExactSolveTypes';
import type { WasmErrorEnvelope } from '../engine/types';
import type { CpDetectModelProgressListener } from '../engine/cpDetectTypes';
import {
  DEFAULT_CP_DETECT_MODEL_MANIFEST_URL,
  CP_DETECT_OUTPUT_KEYS,
  fetchCpDetectModelManifest,
  runCpDetectDenseInference,
  type CpDetectOnnxSession,
} from '../lib/cpDetectInference';
import {
  currentCpDetectModel,
  defaultCpDetectModelStore,
  ensureCpDetectModelInstalled,
  registryFromManifest,
  type CpDetectModelStore,
  type CpDetectModelVersion,
} from '../lib/cpDetectModels';
import { isCpDetectBuildEnabled } from '../platform/features';
import {
  detectedJunctionSource,
  recognizeContractError,
  resolveLineEvidenceSource,
  withLineEvidenceSource,
  type DecodedFold,
} from '../lib/cpDetectDecode';

let wasmReady: Promise<void> | null = null;
let sessionPromise: Promise<CpDetectSessionRuntime> | null = null;
let manifestPromise: Promise<CpDetectModelManifest> | null = null;
let manifestKey: string | null = null;
let sessionKey: string | null = null;
/** Where installed models live on the web: the Cache API, shared with the page. */
let modelStore: CpDetectModelStore | null = null;
let ortPromise: Promise<OrtModule> | null = null;
let ortWasmThreads = 1;
// ORT WebGPU is not reliable when sessions compile or dispatch concurrently in one worker.
let ortOperationQueue: Promise<void> = Promise.resolve();

type ActiveExecutionProvider = 'webgpu' | 'wasm';

type OrtModule = typeof import('onnxruntime-web/webgpu');

/**
 * The same gate the "Detect CP from Image..." menu entry uses
 * (`menus/menuDefinition.ts`): the detector is experimental and dev-only, and
 * the model assets it needs are gitignored, so no deployed build can reach it.
 *
 * Its cost, though, is paid by every deployed build: ONNX Runtime's WebGPU
 * entry point drags a 22.6 MiB `.wasm` runtime behind it, which is more than
 * half of `dist`. Constant-folding this to `false` takes the `import()` below
 * out of the production module graph, so the runtime is neither bundled nor
 * emitted. Un-gating the menu means un-gating this too.
 */
const CP_DETECT_RUNTIME_AVAILABLE = isCpDetectBuildEnabled();

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

/**
 * The model version a run is for: the registry's, as the caller resolved it,
 * or else the manifest read as a one-version registry — a dev checkout, or a
 * test handing over its own manifest URL.
 */
function resolveModelVersion(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  options: CpDetectWorkerRunOptions
): CpDetectModelVersion {
  if (options.model) return options.model;
  const local = currentCpDetectModel(registryFromManifest(manifest, manifestUrl));
  if (!local) throw new Error('The CP detector manifest names no model');
  return options.modelUrl ? { ...local, model_url: options.modelUrl } : local;
}

function store(): CpDetectModelStore {
  modelStore ??= defaultCpDetectModelStore();
  return modelStore;
}

async function ensureSession(
  manifest: CpDetectModelManifest,
  manifestUrl: string,
  options: CpDetectWorkerRunOptions = {},
  onModelProgress?: CpDetectModelProgressListener
): Promise<CpDetectSessionRuntime> {
  // Awaited before the cache key is built — the key covers `ortWasmThreads`,
  // which is not settled until the runtime has loaded.
  const ortModule = await loadOrt();
  const version = resolveModelVersion(manifest, manifestUrl, options);
  const requestedProvider = options.executionProvider ?? 'auto';
  const key = JSON.stringify({
    modelId: version.id,
    modelUrl: version.model_url,
    requestedProvider,
    wasmThreads: ortWasmThreads,
  });
  if (sessionPromise && sessionKey === key) return sessionPromise;
  sessionKey = key;
  sessionPromise = (async () => {
    // Installed once and verified every time; the bytes go to the runtime,
    // which copies them, and are dropped here.
    const installed = await ensureCpDetectModelInstalled(version, store(), {
      onProgress: onModelProgress,
    });
    const runtime = await createSessionRuntime(ortModule, installed.bytes, requestedProvider);
    runtime.runtime.model_id = version.id;
    runtime.runtime.model_source = installed.source;
    return runtime;
  })().catch((error) => {
    if (sessionKey === key) {
      sessionKey = null;
      sessionPromise = null;
    }
    throw error;
  });
  return sessionPromise;
}

/**
 * ONNX Runtime, fetched and configured on first use.
 *
 * Dynamic so the runtime lands in its own chunk rather than this worker's entry
 * chunk — constructing the worker (which the import dialog does on open, before
 * the user has picked an image) should not pull ORT down with it.
 *
 * The `.mjs` glue and `.wasm` binary are `?url` imports rather than ORT's
 * built-in defaults so that they are content-hashed emitted assets; ORT would
 * otherwise resolve them relative to the worker chunk, where nothing of that
 * name exists.
 */
async function loadOrt(): Promise<OrtModule> {
  ortPromise ??= importOrt();
  return ortPromise;
}

async function importOrt(): Promise<OrtModule> {
  if (!CP_DETECT_RUNTIME_AVAILABLE) {
    throw new Error('CP detection is not available in this build');
  }
  const [ortModule, wasmMjsUrl, wasmUrl] = await Promise.all([
    import('onnxruntime-web/webgpu'),
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url'),
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'),
  ]);
  ortWasmThreads = chooseWasmThreadCount();
  ortModule.env.wasm.numThreads = ortWasmThreads;
  ortModule.env.wasm.wasmPaths = {
    mjs: wasmMjsUrl.default,
    wasm: wasmUrl.default,
  };
  ortModule.env.webgpu.powerPreference = 'high-performance';
  return ortModule;
}

async function createSessionRuntime(
  ortModule: OrtModule,
  modelBytes: Uint8Array,
  requestedProvider: CpDetectExecutionProvider
): Promise<CpDetectSessionRuntime> {
  const webgpuAvailable = hasWebGpu();
  let fallbackReason: string | undefined;
  for (const provider of providerCandidates(requestedProvider, webgpuAvailable)) {
    const startedAt = performance.now();
    try {
      const session = await enqueueOrtOperation(() =>
        ortModule.InferenceSession.create(modelBytes, sessionOptions(provider))
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
  async loadModel(
    options: CpDetectWorkerRunOptions = {},
    onModelProgress?: CpDetectModelProgressListener
  ): Promise<CpDetectModelManifest> {
    return call(async () => {
      const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
      const manifest = await ensureManifest(manifestUrl);
      await ensureSession(manifest, manifestUrl, options, onModelProgress);
      return manifest;
    });
  },
  /**
   * The manifest of the model a run would use, and whether its bytes are
   * already installed — what the dialog needs to say "45 MB, once" before
   * the first Detect, without downloading anything.
   */
  async modelStatus(
    options: CpDetectWorkerRunOptions = {}
  ): Promise<{ manifest: CpDetectModelManifest; version: CpDetectModelVersion; installed: boolean }> {
    return call(async () => {
      const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
      const manifest = await ensureManifest(manifestUrl);
      const version = resolveModelVersion(manifest, manifestUrl, options);
      const installed = (await store().list()).some((model) => model.id === version.id);
      return { manifest, version, installed };
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
    options: CpDetectWorkerRunOptions = {},
    onModelProgress?: CpDetectModelProgressListener
  ): Promise<CpDetectInferenceResult> {
    return call(() => denseInferenceForImage(image, options, onModelProgress));
  },
  /**
   * Recognize **and** solve, in one call — the original fused decode.
   *
   * Kept because it is still the right shape wherever the caller has nothing to
   * do between the two halves and no interest in the candidate: the stage
   * inspector, an ablation run, any batch consumer. What it must not be used for
   * is a user-facing flow that wants to show the recognized creases while the
   * solve runs, or to let the user repair the topology first — that is
   * `recognizeRectifiedFold` below, followed by `runCpExactSolve`.
   */
  async detectRectifiedFold(
    image: ImageData,
    options: CpDetectWorkerRunOptions = {},
    onModelProgress?: CpDetectModelProgressListener
  ): Promise<CpDetectFoldResult> {
    return call(async () => {
      const decoded = await decodeRectifiedImage(image, options, false, onModelProgress);
      return {
        status: decoded.report.status,
        foldJson: decoded.fold_json,
        detectorReport: decoded.report,
        manifest: decoded.manifest,
        junctionSource: decoded.junctionSource,
        lineEvidenceSource: decoded.lineEvidenceSource,
        runtime: decoded.runtime,
        solve: { attempted: true },
      };
    });
  },
  /**
   * Recognize only: generate, select, and export the candidate crease pattern
   * **without** solving it.
   *
   * The half of detection that is fast and always worth having. The solve behind
   * it is 0.36 s at the easy median but hits the 25 s cap on essentially every
   * hard pattern, and on a candidate whose topology is visibly broken every one
   * of those seconds is spent on geometry the user is about to change. So this
   * returns in inference time plus a few hundred microseconds of analysis, and
   * hands back three things the caller needs to decide what happens next: the
   * candidate FOLD, the `ExactSolveInput` a later solve runs on, and the
   * combinatorial topology findings that say whether it is worth solving at all.
   *
   * The result is checked against its own contract before it is returned, rather
   * than trusted. `recognize_only` is a trailing optional argument on one wasm
   * export, and `apps/web/src/generated/` is a build output that no test and no
   * typecheck can catch as stale — so a bridge built before Phase A would ignore
   * the flag, silently solve, and return a *solved* pattern that this function
   * promises is a candidate. That is exactly the failure that must not be quiet.
   */
  async recognizeRectifiedFold(
    image: ImageData,
    options: CpDetectWorkerRunOptions = {},
    onModelProgress?: CpDetectModelProgressListener
  ): Promise<CpDetectRecognizeResult> {
    return call(async () => {
      const decoded = await decodeRectifiedImage(image, options, true, onModelProgress);
      const solve = cpDetectSolveState(decoded.report);
      const candidateSource = cpDetectCandidateSourceFromFold(decoded.fold_json);
      if (decoded.report.status !== 'recognized' || !solve || solve.attempted) {
        throw recognizeContractError(
          `the decoder reported status "${decoded.report.status}" with solve ${
            solve ? `attempted=${String(solve.attempted)}` : 'unstated'
          }`
        );
      }
      if (candidateSource !== 'exact_solve_candidate') {
        throw recognizeContractError(
          `the exported FOLD identifies as "${candidateSource ?? 'unknown'}" rather than "exact_solve_candidate"`
        );
      }
      return {
        status: 'recognized',
        foldJson: decoded.fold_json,
        detectorReport: decoded.report,
        manifest: decoded.manifest,
        junctionSource: decoded.junctionSource,
        lineEvidenceSource: decoded.lineEvidenceSource,
        runtime: decoded.runtime,
        candidateSource,
        solve,
        solveInput: cpDetectSolveInput(decoded.report),
        topologyDiagnostics: cpDetectTopologyDiagnostics(decoded.report),
      };
    });
  },
  /**
   * Run the exact solver on an `ExactSolveInput`.
   *
   * In this worker rather than on the main thread because a solve is 0.36 s at
   * the easy median and up to the 25 s cap on the hard bucket — synchronous
   * inside wasm the whole time, so on the main thread it would freeze the canvas
   * for the duration.
   *
   * It costs nothing to host here: the solver is a pure function of its input
   * and reads no dense heads, no source image and no model, so this touches only
   * `ensureWasmReady()` and never `loadOrt()` — the 22.6 MiB ONNX runtime that
   * `CP_DETECT_RUNTIME_AVAILABLE` gates out of production builds stays out. Which
   * matters, because unlike detection this path is meant to ship.
   *
   * `optionsJson` is a partial `ExactSolveOptions` object; omitted fields keep
   * their defaults and an unrecognised name is an error rather than a silent
   * no-op. Strings rather than objects because both sides already round-trip
   * through JSON and comlink would otherwise structured-clone a large graph into
   * an object the wasm boundary immediately re-serializes.
   */
  async solveExact(inputJson: string, optionsJson = ''): Promise<CpExactSolvedGraph> {
    return call(() => cp_detect_solve_exact(inputJson, optionsJson) as CpExactSolvedGraph);
  },
  /**
   * Solve, and export the result as a FOLD document at the solved coordinates.
   *
   * One solve serves both the geometry the document takes and the movement
   * report the UI reports on. Separate from {@link solveExact} rather than
   * folded into it because the stage-1 probe wants only the verdict, and paying
   * for a FOLD export of a result that is about to be thrown away is the one
   * cost the two-call split was supposed to avoid.
   */
  async solveExactToFold(inputJson: string, optionsJson = ''): Promise<CpExactSolveFoldResult> {
    return call(
      () => cp_detect_solve_exact_to_fold(inputJson, optionsJson) as CpExactSolveFoldResult
    );
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
  options: CpDetectWorkerRunOptions,
  onModelProgress?: CpDetectModelProgressListener
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
  const sessionRuntime = await ensureSession(manifest, manifestUrl, options, onModelProgress);
  const ortModule = await loadOrt();
  const inference = await runCpDetectDenseInference(
    cpDetectSessionFromOrt(sessionRuntime.session),
    {
      float32(data, dims) {
        return new ortModule.Tensor('float32', data, Array.from(dims));
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

type WasmDecodedFold = DecodedFold;

interface DecodedRectifiedImage extends WasmDecodedFold {
  manifest: CpDetectModelManifest;
  junctionSource: CpDetectJunctionSource;
  lineEvidenceSource: CpDetectLineEvidenceSource;
  runtime?: CpDetectRuntimeInfo;
}

/**
 * Inference plus decode, shared by the fused and recognize-only entry points.
 *
 * One function rather than two, for the same reason `recognize_from_generation`
 * is one function on the Rust side: recognize-only is *the fused path minus the
 * solve*, and the only construction under which the two cannot drift is the one
 * where the second is literally the first plus a flag.
 */
async function decodeRectifiedImage(
  image: ImageData,
  options: CpDetectWorkerRunOptions,
  recognizeOnly: boolean,
  onModelProgress?: CpDetectModelProgressListener
): Promise<DecodedRectifiedImage> {
  const requestedJunctionSource = options.junctionSource ?? CP_DETECT_DEFAULT_JUNCTION_SOURCE;
  const lineEvidenceSource = resolveLineEvidenceSource(options.lineEvidenceSource);
  const inference = await denseInferenceForImage(image, options, onModelProgress);
  const requestedDecodeJunctionSource: CpDetectJunctionSource =
    requestedJunctionSource === 'line-arrangement' ? 'line-arrangement' : 'dense-model';
  const decoded = decodeFoldFromDenseOutputs(
    image,
    inference.outputs,
    inference.manifest,
    options,
    requestedDecodeJunctionSource,
    lineEvidenceSource,
    recognizeOnly
  );
  return {
    ...decoded,
    manifest: inference.manifest,
    junctionSource: detectedJunctionSource(decoded.report, requestedDecodeJunctionSource),
    lineEvidenceSource,
    runtime: inference.runtime,
  };
}

/**
 * The recognize path got something other than a recognized candidate back.
 *
 * A hard error rather than a downgrade to the fused result, because the caller
 * asked for a candidate to repair and would otherwise be handed solved geometry
 * under a type that says it is unsolved.
 */

function decodeFoldFromDenseOutputs(
  image: ImageData,
  outputs: CpDetectDenseOutputs,
  manifest: CpDetectModelManifest,
  options: CpDetectWorkerRunOptions = {},
  junctionSource: CpDetectJunctionSource = 'dense-model',
  lineEvidenceSource: CpDetectLineEvidenceSource = 'source-image',
  recognizeOnly = false
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
        image.height,
        recognizeOnly
      ) as WasmDecodedFold,
      lineEvidenceSource
    );
  }
  // Only the product export takes `recognize_only`; the other two would ignore
  // it and solve. Refusing is the whole point — a silent solve here would return
  // a solved pattern under the recognize result's type.
  if (recognizeOnly) {
    throw new Error(
      `Recognize-only is available on the source-image line-evidence path only, not "${lineEvidenceSource}"`
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


export type CpDetectWorkerApi = typeof api;

expose(api);
