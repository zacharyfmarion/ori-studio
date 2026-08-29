/**
 * The exact solver, alone in a worker that exists for one solve and is then
 * terminated.
 *
 * **Why this is not `cpDetectWorker`.** The two bridge calls below already live
 * there and work perfectly well; what does not work there is *stopping* one. A
 * solve is a single synchronous call into wasm, and the measurement in
 * `implementation-plans/staged-recognize-and-solve.md` says where the time
 * inside it goes: 94-97% of every gap between the solver's own cancellation
 * checkpoints is one `nalgebra-sparse` Cholesky factorization, which does no
 * fill-reducing ordering and is therefore effectively dense. A cooperative flag
 * — the fold path's mechanism — would be read at the next checkpoint, and on a
 * 2,321-span pattern that is **7.8 s** later. Terminating a worker has no such
 * bound, so this module is the transport for Stop.
 *
 * **And it costs almost nothing to spawn**, which is the other half of the
 * argument. `solve_exact` is a pure function of an `ExactSolveInput`: no dense
 * heads, no source image, no model. So this worker touches `init()` and nothing
 * else — never `loadOrt()`, never the 43 MiB detector model, never the 22.6 MiB
 * ONNX runtime. Discarding one of these on a cancel throws away a wasm
 * instantiation, not a compiled inference session, and that is precisely why the
 * detect worker must never be the thing terminated.
 *
 * The API is deliberately two methods wide. Anything else added here would be a
 * reason not to terminate it.
 */
import { expose } from 'comlink';
import init, {
  cp_detect_solve_exact,
  cp_detect_solve_exact_to_fold,
} from '../generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm';
import type { CpExactSolveFoldResult, CpExactSolvedGraph } from '../engine/cpExactSolveTypes';
import type { WasmErrorEnvelope } from '../engine/types';

let wasmReady: Promise<void> | null = null;

async function ensureWasmReady(): Promise<void> {
  wasmReady ??= init().then(() => undefined);
  await wasmReady;
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
    code: 'cp_exact_solve',
    message: error instanceof Error ? error.message : String(error),
  };
}

async function call<T>(fn: () => T): Promise<T> {
  await ensureWasmReady();
  try {
    return fn();
  } catch (error) {
    throw normalizeError(error);
  }
}

const api = {
  /**
   * Stage 1: solve and report, without exporting a document.
   *
   * `optionsJson` is a partial `ExactSolveOptions`; omitted fields keep their
   * Rust defaults and an unrecognised name is a hard error rather than a silent
   * no-op. Strings rather than objects because both sides already round-trip
   * through JSON, and comlink would otherwise structured-clone a quarter-megabyte
   * graph into an object the wasm boundary immediately re-serializes.
   */
  async solveExact(inputJson: string, optionsJson = ''): Promise<CpExactSolvedGraph> {
    return call(() => cp_detect_solve_exact(inputJson, optionsJson) as CpExactSolvedGraph);
  },
  /** Stage 2: solve, and export the result as FOLD at the solved coordinates. */
  async solveExactToFold(inputJson: string, optionsJson = ''): Promise<CpExactSolveFoldResult> {
    return call(
      () => cp_detect_solve_exact_to_fold(inputJson, optionsJson) as CpExactSolveFoldResult
    );
  },
};

export type CpExactSolveWorkerApi = typeof api;

expose(api);
