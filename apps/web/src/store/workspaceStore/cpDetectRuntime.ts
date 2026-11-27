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
 *
 * And who tells the user is **whoever was waiting**. A loss rejects every call
 * in flight, and each caller says what it means where the user acted: the
 * import dialog shows it, background work keeps quiet. The app's error toast
 * speaks only when a call the user started was waiting
 * ({@link CpDetectCallOptions.background} marks the ones they did not).
 */
import { isDesktopRuntime } from '../../platform/runtime';
import { nativeCpDetectClient } from '../../engine/cpDetectNativeClient';
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

/** What a call in flight rejects with when the worker goes away. */
export interface CpDetectClientLostError extends WasmErrorEnvelope {
  code: 'cp_detect_client_lost';
  /**
   * The worker never ran: its script, or a module it imports, did not load
   * (`WorkerFailure.loadFailed`), because the browser was offline or the
   * connection dropped. The browser failing to fetch the detector, not the
   * detector failing.
   */
  loadFailed?: true;
}

/** Whether `error` is a call's rejection because the worker never loaded. */
export function isCpDetectClientUnloaded(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'cp_detect_client_lost' &&
    (error as { loadFailed?: unknown }).loadFailed === true
  );
}

export interface CpDetectCallOptions {
  /**
   * Work the user did not ask for: the likelihood gate on an image added to
   * the canvas. A loss under it still rejects the call; it is just not the
   * app's error toast's to announce.
   */
  background?: boolean;
}

/**
 * Calls in flight that the user started: every {@link whileCpDetectClientAlive}
 * without `background`. Read when the worker goes away, to decide whether the
 * app's error toast says so.
 */
let foregroundCalls = 0;

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
export function whileCpDetectClientAlive<T>(
  pending: Promise<T>,
  options: CpDetectCallOptions = {}
): Promise<T> {
  const foreground = !options.background;
  if (foreground) foregroundCalls += 1;
  let unsubscribe: (() => void) | null = null;
  const lost = new Promise<never>((_resolve, reject) => {
    unsubscribe = onCpDetectClientLost((loss) => reject(clientLostError(loss)));
  });
  return Promise.race([pending, lost]).finally(() => {
    unsubscribe?.();
    if (foreground) foregroundCalls -= 1;
  });
}

function clientLostError(loss: CpDetectClientLoss): CpDetectClientLostError {
  return {
    // Its own code, so a surface can tell a runtime that died from a model
    // that failed: the funnel's `worker_lost` reason reads it.
    code: 'cp_detect_client_lost',
    message:
      loss.failure?.message ?? 'The crease-pattern detection worker stopped while it was running.',
    ...(loss.failure?.loadFailed ? { loadFailed: true } : {}),
  };
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
    // Read before the loss is announced, which is what settles those calls.
    const userWaiting = foregroundCalls > 0;
    loseClient(failure);
    // The app's error toast is for a call the user started, whose own surface
    // says it too. Nothing else needs telling, and the next call spawns a fresh
    // worker either way: an idle worker, the warm-up on a drag, the gate on an
    // added image (ORI-STUDIO-1E: a worker that never loaded raised the toast
    // while the user was placing a reference image).
    return userWaiting ? undefined : 'handled';
  });
  const client = wrap<CpDetectWorkerApi>(worker);
  // Desktop keeps the worker for rectification and runs the model and the
  // solve natively; the client's surface is the same either way.
  live = {
    worker,
    client: isDesktopRuntime() ? nativeCpDetectClient(client) : client,
    detachDiagnostics,
  };
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
