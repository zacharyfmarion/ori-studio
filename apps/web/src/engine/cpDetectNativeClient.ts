/**
 * The desktop's detect client: the worker for what stays in wasm
 * (rectification, the inspector's ablation runs), Tauri commands for what the machine
 * should do itself — the model's session on CoreML or all cores, and the
 * exact solve with a Stop. Same `CpDetectWorkerApi` surface, so the dialog
 * does not know which it holds. See `apps/tauri/src-tauri/src/cp_detect.rs`.
 *
 * Not every desktop build links ONNX Runtime: Intel macOS has no prebuilt, and
 * the Linux one needs a newer libstdc++ than the release image carries. Those
 * builds answer `cp_detect_native_inference_available` with false, and the four
 * methods that need a model — inference and the model store, which move as a
 * pair — fall through to the worker. The exact solver is pure Rust and stays
 * native on every target.
 */
import { invoke } from '@tauri-apps/api/core';
import {
  CP_DETECT_DEFAULT_JUNCTION_SOURCE,
  cpDetectCandidateSourceFromFold,
  cpDetectSolveInput,
  cpDetectSolveState,
  cpDetectTopologyDiagnostics,
  type CpDetectFoldResult,
  type CpDetectModelManifest,
  type CpDetectModelProgressListener,
  type CpDetectRecognizeResult,
  type CpDetectRuntimeInfo,
  type CpDetectWorkerRunOptions,
} from './cpDetectTypes';
import type {
  CpExactSolveFoldResult,
  CpExactSolveInputFromFold,
  CpExactSolvedGraph,
} from './cpExactSolveTypes';
import { CpExactSolveCancelledError, type CpExactSolveSession, type CpExactSolver } from './cpExactSolveSession';
import {
  detectedJunctionSource,
  recognizeContractError,
  resolveLineEvidenceSource,
  withLineEvidenceSource,
  type DecodedFold,
} from '../lib/cpDetectDecode';
import { DEFAULT_CP_DETECT_MODEL_MANIFEST_URL, fetchCpDetectModelManifest } from '../lib/cpDetectInference';
import {
  currentCpDetectModel,
  defaultCpDetectModelStore,
  ensureCpDetectModelOnDevice,
  registryFromManifest,
  type CpDetectModelStore,
  type CpDetectModelVersion,
} from '../lib/cpDetectModels';
import type { CpDetectClient } from '../store/workspaceStore/cpDetectRuntime';

export const DETECT_DECODER_BACKEND_DEFAULT = 'legacy_v2_decoder';

interface NativeRecognizeResponse extends DecodedFold {
  runtime: CpDetectRuntimeInfo & { model_id: string };
}

async function manifestFor(
  options: CpDetectWorkerRunOptions,
  fetchImpl: typeof fetch
): Promise<{ manifest: CpDetectModelManifest; version: CpDetectModelVersion }> {
  const manifestUrl = options.manifestUrl ?? DEFAULT_CP_DETECT_MODEL_MANIFEST_URL;
  const manifest = JSON.parse(await fetchCpDetectModelManifest(manifestUrl, fetchImpl)) as CpDetectModelManifest;
  const version =
    options.model ?? currentCpDetectModel(registryFromManifest(manifest, manifestUrl));
  if (!version) throw new Error('The CP detector manifest names no model');
  return { manifest, version };
}

function rgbaOf(image: ImageData): Uint8Array {
  return new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength);
}

export interface NativeCpDetectClientDeps {
  invokeImpl?: typeof invoke;
  store?: CpDetectModelStore;
  fetchImpl?: typeof fetch;
  /** Overrides the backend's own answer. Tests use it; nothing else should. */
  nativeInferenceAvailable?: () => Promise<boolean>;
}

/** Build the client. The worker and every dependency are injectable for tests. */
export function nativeCpDetectClient(
  worker: CpDetectClient,
  deps: NativeCpDetectClientDeps = {}
): CpDetectClient {
  const invokeImpl = deps.invokeImpl ?? invoke;
  const store = deps.store ?? defaultCpDetectModelStore();
  const fetchImpl = deps.fetchImpl ?? fetch;

  /**
   * Whether this desktop build linked ONNX Runtime.
   *
   * Intel macOS and Linux do not — there is no prebuilt for the first and the
   * Linux one wants a newer libstdc++ than the release image has, so `ort` is
   * not compiled in on either (see `apps/tauri/src-tauri/build.rs`). Those
   * builds keep the *native* model store and exact solver, which are pure Rust,
   * and send inference to the worker instead.
   *
   * Asked once and remembered: the answer is a compile-time constant on the
   * other side. A backend too old to know the command is treated as native, so
   * that a version skew during development fails loudly at `cp_detect_recognize`
   * rather than silently routing every desktop to the slower path.
   */
  let nativeInference: Promise<boolean> | null = null;
  const nativeInferenceAvailable =
    deps.nativeInferenceAvailable ??
    (() => {
      nativeInference ??= invokeImpl<boolean>('cp_detect_native_inference_available').then(
        (available) => available !== false,
        () => true
      );
      return nativeInference;
    });

  async function install(
    options: CpDetectWorkerRunOptions,
    onModelProgress?: CpDetectModelProgressListener
  ): Promise<{ manifest: CpDetectModelManifest; version: CpDetectModelVersion; source: 'installed' | 'downloaded' }> {
    const { manifest, version } = await manifestFor(options, fetchImpl);
    const source = await ensureCpDetectModelOnDevice(version, store, {
      fetchImpl,
      onProgress: onModelProgress ? (progress) => void onModelProgress(progress) : undefined,
    });
    return { manifest, version, source };
  }

  async function decode(
    image: ImageData,
    options: CpDetectWorkerRunOptions,
    recognizeOnly: boolean,
    onModelProgress?: CpDetectModelProgressListener
  ) {
    const { manifest, version, source } = await install(options, onModelProgress);
    const lineEvidenceSource = resolveLineEvidenceSource(options.lineEvidenceSource);
    const requestedJunctionSource = options.junctionSource ?? CP_DETECT_DEFAULT_JUNCTION_SOURCE;
    const junctionSource = requestedJunctionSource === 'line-arrangement' ? 'line-arrangement' : 'dense-model';
    const response = await invokeImpl<NativeRecognizeResponse>('cp_detect_recognize', rgbaOf(image), {
      headers: {
        'x-width': String(image.width),
        'x-height': String(image.height),
        'x-options': JSON.stringify({
          model_id: version.id,
          image_size: manifest.inference.image_size,
          threshold: options.threshold ?? manifest.inference.threshold,
          junction_offset_radius_px: manifest.inference.junction_offset_radius_px ?? null,
          decoder_backend: options.decoderBackend ?? DETECT_DECODER_BACKEND_DEFAULT,
          junction_source: junctionSource,
          recognize_only: recognizeOnly,
          exact_solve_timeout_seconds: options.exactSolveTimeoutSeconds ?? null,
        }),
      },
    });
    const decoded = withLineEvidenceSource(
      { fold_json: response.fold_json, report: response.report },
      lineEvidenceSource
    );
    return {
      ...decoded,
      manifest,
      junctionSource: detectedJunctionSource(decoded.report, junctionSource),
      lineEvidenceSource,
      runtime: { ...response.runtime, model_source: source },
    };
  }

  // The model store and inference move together. Where inference is the
  // worker's, the worker must also own acquiring the model — otherwise the
  // download lands in the native store, which nothing on that build reads, and
  // Settings ▸ Models reports a copy that is never used.
  const native = {
    async loadModel(options: CpDetectWorkerRunOptions = {}, onModelProgress?: CpDetectModelProgressListener) {
      if (!(await nativeInferenceAvailable())) return worker.loadModel(options, onModelProgress);
      return (await install(options, onModelProgress)).manifest;
    },
    async modelStatus(options: CpDetectWorkerRunOptions = {}) {
      if (!(await nativeInferenceAvailable())) return worker.modelStatus(options);
      const { manifest, version } = await manifestFor(options, fetchImpl);
      return { manifest, version, installed: await store.installed(version.id, version.sha256) };
    },
    async detectRectifiedFold(
      image: ImageData,
      options: CpDetectWorkerRunOptions = {},
      onModelProgress?: CpDetectModelProgressListener
    ): Promise<CpDetectFoldResult> {
      if (!(await nativeInferenceAvailable())) {
        return worker.detectRectifiedFold(image, options, onModelProgress);
      }
      const decoded = await decode(image, options, false, onModelProgress);
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
    },
    async recognizeRectifiedFold(
      image: ImageData,
      options: CpDetectWorkerRunOptions = {},
      onModelProgress?: CpDetectModelProgressListener
    ): Promise<CpDetectRecognizeResult> {
      if (!(await nativeInferenceAvailable())) {
        return worker.recognizeRectifiedFold(image, options, onModelProgress);
      }
      const decoded = await decode(image, options, true, onModelProgress);
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
    },
    async solveExact(inputJson: string, optionsJson = ''): Promise<CpExactSolvedGraph> {
      return invokeImpl<CpExactSolvedGraph>('cp_detect_solve_exact', {
        args: { inputJson, optionsJson, runId: 0 },
      });
    },
    async solveExactToFold(inputJson: string, optionsJson = ''): Promise<CpExactSolveFoldResult> {
      return invokeImpl<CpExactSolveFoldResult>('cp_detect_solve_exact_to_fold', {
        args: { inputJson, optionsJson, runId: 0 },
      });
    },
  };

  // Everything else — rectification, package info, dense inference and the
  // ablation the inspector uses — stays with the worker.
  return new Proxy(worker, {
    get(target, property, receiver) {
      if (property in native) return native[property as keyof typeof native];
      return Reflect.get(target, property, receiver);
    },
  }) as CpDetectClient;
}

let nextNativeRunId = 1;

function cancelled(solved: { movement_report?: unknown }): boolean {
  const report = solved.movement_report;
  return typeof report === 'object' && report !== null && (report as { cancelled?: unknown }).cancelled === true;
}

/**
 * An exact-solve session on the native solver. Stop raises the flag the
 * solver's deadline honours, so the run ends at its next checkpoint and comes
 * back marked cancelled — which is turned into the same cancelled error the
 * worker session's terminate produces, so every caller sees one thing.
 */
export function nativeCpExactSolveSession(invokeImpl: typeof invoke = invoke): CpExactSolveSession {
  const runId = nextNativeRunId++;
  let stopped = false;
  async function settle<T>(
    pending: Promise<T>,
    pick: (value: T) => { movement_report?: unknown }
  ): Promise<T> {
    const value = await pending;
    if (stopped || cancelled(pick(value))) throw new CpExactSolveCancelledError();
    return value;
  }
  const solver: CpExactSolver = {
    solveExact: (inputJson, optionsJson) =>
      settle(
        invokeImpl<CpExactSolvedGraph>('cp_detect_solve_exact', { args: { inputJson, optionsJson, runId } }),
        (solved) => solved
      ),
    solveExactToFold: (inputJson, optionsJson) =>
      settle(
        invokeImpl<CpExactSolveFoldResult>('cp_detect_solve_exact_to_fold', {
          args: { inputJson, optionsJson, runId },
        }),
        (result) => result.solved
      ),
    exactSolveInputFromFold: (foldJson) =>
      invokeImpl<CpExactSolveInputFromFold>('cp_detect_exact_solve_input_from_fold', { foldJson }),
  };
  return {
    solver: Promise.resolve(solver),
    stop: () => {
      stopped = true;
      void invokeImpl('cp_detect_solve_cancel', { runId });
    },
    dispose: () => {},
  };
}
