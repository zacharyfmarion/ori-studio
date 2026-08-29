/**
 * The CP-detect worker's client, and its lifetime.
 *
 * Everything here is the pattern `engines/engineHost.ts` established, applied to
 * the one worker that never adopted it. Until now this module memoized a client
 * and nothing ever dropped it: `attachWorkerDiagnostics` was called without the
 * `observe` callback, and `releaseCpDetectClient` was called by nothing at all.
 * So a worker that died — a wasm trap, an OOM, a module that failed to load —
 * stayed in the module variable forever, `getCpDetectClient()` kept handing back
 * the corpse, and every call on it hung rather than throwing, because a comlink
 * proxy only settles when the worker answers.
 *
 * Two halves fix that, and both are needed:
 *
 * - **Drop the dead client**, so the *next* call spawns a replacement.
 * - **Announce the loss**, so calls already in flight can stop waiting. That is
 *   what {@link onCpDetectClientLost} is for, and {@link whileCpDetectClientAlive}
 *   is how a caller consumes it: a promise that will never settle becomes a
 *   rejection the UI can report.
 */
import { wrap, type Remote } from 'comlink';
import type { WasmErrorEnvelope } from '../../engine/types';
import type { CpDetectWorkerApi } from '../../workers/cpDetectWorker';
import { attachWorkerDiagnostics, type WorkerFailure } from '../../lib/workerDiagnostics';

export type CpDetectClient = Remote<CpDetectWorkerApi>;

interface LiveCpDetectClient {
  worker: Worker;
  client: CpDetectClient;
  detachDiagnostics: () => void;
}

let live: LiveCpDetectClient | null = null;

/** Absent when the client was released deliberately rather than lost. */
export type CpDetectClientLoss = { failure?: WorkerFailure };

type LossListener = (loss: CpDetectClientLoss) => void;

const lossListeners = new Set<LossListener>();

/**
 * Observe the detect worker going away — crashed, or released deliberately.
 *
 * Callers with a request in flight should stop waiting on it: comlink cannot,
 * because its proxy has no way to know the other end is gone. Listeners must not
 * throw; one that does is isolated so the rest still hear about the loss.
 */
export function onCpDetectClientLost(listener: LossListener): () => void {
  lossListeners.add(listener);
  return () => {
    lossListeners.delete(listener);
  };
}

/**
 * Settle with `pending`, or reject as soon as the detect worker behind it goes
 * away.
 *
 * comlink's proxy settles only when the worker answers, so a worker that traps
 * mid-inference leaves the promise pending forever and the import dialog on
 * "Running model" with nothing ever ending it. Racing the loss signal turns that
 * into an error the surface can show.
 *
 * Both branches of the race have handlers attached by `Promise.race` itself, so
 * a `pending` that rejects after the loss has already won does not surface as an
 * unhandled rejection.
 */
export function whileCpDetectClientAlive<T>(pending: Promise<T>): Promise<T> {
  let unsubscribe: (() => void) | null = null;
  const lost = new Promise<never>((_resolve, reject) => {
    unsubscribe = onCpDetectClientLost((loss) => {
      reject({
        code: 'cp_detect',
        message:
          loss.failure?.message ??
          'The crease-pattern detection worker stopped while it was running.',
      } satisfies WasmErrorEnvelope);
    });
  });
  return Promise.race([pending, lost]).finally(() => unsubscribe?.());
}

function announceLoss(loss: CpDetectClientLoss): void {
  for (const listener of [...lossListeners]) {
    try {
      listener(loss);
    } catch (error) {
      console.error('[ori-studio] cp-detect loss listener failed', error);
    }
  }
}

/**
 * Forget the live client, terminate its worker, and tell everyone waiting.
 *
 * The one place a client goes away, so a crash and a deliberate release cannot
 * behave differently. Terminating on a crash too is a departure from
 * `engineHost`, and specific to this worker: an `error` event does not prove the
 * worker is gone — an uncaught exception in a handler fires one on a worker that
 * is still running — and this worker holds a compiled ONNX session over a 43 MiB
 * model. Leaving it alive beside its replacement would put two of those in
 * memory, which is the one engine where that matters.
 */
function loseClient(failure?: WorkerFailure): void {
  const current = live;
  if (!current) return;
  live = null;
  current.detachDiagnostics();
  current.worker.terminate();
  announceLoss(failure ? { failure } : {});
}

export function cpDetectError(error: unknown): WasmErrorEnvelope {
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

export async function getCpDetectClient(): Promise<CpDetectClient> {
  if (live) return live.client;
  const worker = new Worker(new URL('../../workers/cpDetectWorker.ts', import.meta.url), {
    type: 'module',
  });
  const detachDiagnostics = attachWorkerDiagnostics(worker, 'cp-detect', (failure) => {
    // Guarded on identity: a failure event from a worker that has already been
    // replaced must not drop the replacement.
    if (live?.worker !== worker) return;
    loseClient(failure);
  });
  live = { worker, client: wrap<CpDetectWorkerApi>(worker), detachDiagnostics };
  return live.client;
}

/**
 * Terminate the detect worker and forget its client. The next
 * {@link getCpDetectClient} spawns a fresh one.
 *
 * Announces a loss exactly as a crash does: a caller waiting on a request should
 * not have to distinguish "the worker died" from "we killed it" to know its
 * answer is never coming.
 *
 * Not something a surface should call on the way out. Detection's cost is
 * dominated by compiling the ONNX session over a 43 MiB model, and this throws
 * that away — closing the import dialog must not make the next detection pay for
 * it again. It is for a deliberate reset, and for the crash path above.
 */
export function releaseCpDetectClient(): void {
  loseClient();
}

/** Whether a client is currently live. Diagnostics and tests. */
export function isCpDetectClientConnected(): boolean {
  return live !== null;
}
