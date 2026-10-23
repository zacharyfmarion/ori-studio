import { wrap, type Remote } from 'comlink';
import type { FoldSequenceWorkerApi } from '../../workers/foldSequenceWorker';
import type { WasmErrorEnvelope } from '../../engine/types';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';
import { reportError } from '../../monitoring';
import type { FoldEngineSource } from '../../fold/engine/foldEnginePort';
import {
  FoldEngineCrash,
  isFoldEngineTrapped,
  type FoldEngineCrashCause,
  type FoldEngineCrashReport,
} from '../../fold/engine/foldEngineTrap';
import type {
  FoldEngineOutcome,
  FoldSheetLanded,
  FoldStepFingerprinted,
} from '../../fold/engine/foldEngineWire';

export type FoldSequenceClient = Remote<FoldSequenceWorkerApi>;

/**
 * Why the worker went away: it crashed, the last holder released it, or
 * {@link stopFoldSequenceWork} terminated it to stop what it was doing.
 */
export type FoldSequenceClientLossReason = 'crashed' | 'released' | 'stopped';

/** Hears the worker go away: why, and for a crash, what crashed it. */
export type FoldSequenceClientLossListener = (
  reason: FoldSequenceClientLossReason,
  cause?: FoldEngineCrashCause
) => void;

// Owns the Fold engine's worker, following `precreaseRuntime.ts`: a
// reference-counted singleton the Fold session retains while a surface holds
// it and releases once it has let go — after its linger, so a visit to another
// workspace does not cost a replay (`foldSession.ts`) — so the wasm module and
// every state it holds are not resident for the life of the tab.
//
// Not an `engineHost` engine: the document is TypeScript's (the Fold slice's),
// and the worker only lands states for it, by handle. On desktop it runs as
// wasm inside the webview like the precrease planner, not natively like the CP
// kernel.
//
// Two things this runtime adds to that shape:
//
// - **A generation.** The worker's states die with it, and the next one
//   numbers its states from 1 again, so every handle is stamped with the
//   generation that made it (`fold/engine/foldEnginePort.ts`). The generation
//   moves the moment a worker goes — not when the next one spawns — so no
//   handle of the old one is ever sent to the new one.
// - **Latest wins, for previews** ({@link createFoldPreviewChannel}): one
//   request in flight, the newest waiting behind it, everything between
//   superseded without reaching the worker.
// - **A trapped engine is a crash.** A call the engine failed halfway answers
//   `fold_engine_trapped` (`fold/engine/foldEngineTrap.ts`) and the worker
//   answers nothing more, so the first such answer drops the worker as its
//   `error` event would. Either way the crash is reported to Sentry, once.

let worker: Worker | null = null;
let client: FoldSequenceClient | null = null;
let detachDiagnostics: (() => void) | null = null;
let refCount = 0;
let generation = 0;
const lossListeners = new Set<FoldSequenceClientLossListener>();

/** Called when the worker goes away, for whatever reason. */
export function onFoldSequenceClientLost(listener: FoldSequenceClientLossListener): () => void {
  lossListeners.add(listener);
  return () => {
    lossListeners.delete(listener);
  };
}

function lostError(reason: FoldSequenceClientLossReason): WasmErrorEnvelope {
  const message = {
    crashed: 'The fold engine stopped while it was running.',
    released: 'The fold engine was released while it was running.',
    stopped: 'The fold engine was stopped while it was running.',
  }[reason];
  return { code: 'fold_sequence_client_lost', message };
}

/**
 * Settle with `pending`, or reject as soon as the worker behind it goes away.
 *
 * `terminate()` does not reject comlink's outstanding promises — they never
 * settle — so without this a stop, a crash or a release between a call and
 * its answer leaves the caller awaiting forever (see `precreaseRuntime.ts`,
 * where that latched the References run on "running").
 */
export function whileFoldSequenceClientAlive<T>(pending: Promise<T>): Promise<T> {
  let unsubscribe: (() => void) | null = null;
  const lost = new Promise<never>((_resolve, reject) => {
    unsubscribe = onFoldSequenceClientLost((reason) => reject(lostError(reason)));
  });
  return Promise.race([pending, lost]).finally(() => unsubscribe?.());
}

function spawn(): FoldSequenceClient {
  const spawned = new Worker(new URL('../../workers/foldSequenceWorker.ts', import.meta.url), {
    type: 'module',
  });
  worker = spawned;
  detachDiagnostics = attachWorkerDiagnostics(spawned, 'fold-sequence', (failure) => {
    // Guarded on identity so a late event from a worker already replaced
    // cannot drop the replacement.
    if (worker === spawned) dropWorker('crashed', { cause: 'worker_error', message: failure.message });
  });
  client = wrap<FoldSequenceWorkerApi>(spawned);
  return client;
}

/**
 * Take a reference to the Fold engine's worker, starting it if needed. Every
 * caller must pair this with {@link releaseFoldSequenceClient}.
 */
export function retainFoldSequenceClient(): FoldSequenceClient {
  refCount += 1;
  return client ?? spawn();
}

/**
 * The live client, for a holder that has already retained one. Spawns a
 * replacement after a crash or a stop, so call it per request rather than
 * keeping the proxy {@link retainFoldSequenceClient} returned.
 */
export function getFoldSequenceClient(): FoldSequenceClient {
  if (client) return client;
  if (refCount === 0) {
    throw new Error('getFoldSequenceClient: retain the fold engine client before using it');
  }
  return spawn();
}

/**
 * Drop a reference. When the last one goes the worker is terminated outright,
 * and every state it held with it: a replay rebuilds them on the next visit.
 */
export function releaseFoldSequenceClient(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  dropWorker('released');
}

/**
 * Stop whatever the worker is doing: terminate it, rejecting every guarded
 * call, and let the next {@link getFoldSequenceClient} spawn a fresh one.
 * The engine cannot be interrupted mid-call, so this is the only way to stop
 * a long replay. Every state goes with the worker. Whether there was one.
 */
export function stopFoldSequenceWork(): boolean {
  const had = worker !== null;
  dropWorker('stopped');
  return had;
}

/**
 * The one place the worker goes away. Order matters, as in
 * `precreaseRuntime`: terminate and move the generation, then announce, so a
 * listener that immediately re-asks gets a fresh worker and a fresh
 * generation rather than the corpse.
 */
function dropWorker(reason: FoldSequenceClientLossReason, crash?: FoldEngineCrashReport): void {
  const had = worker !== null;
  detachDiagnostics?.();
  detachDiagnostics = null;
  client = null;
  worker?.terminate();
  worker = null;
  if (!had) return;
  generation += 1;
  if (crash) reportError(new FoldEngineCrash(crash), { surface: 'fold:engine', tags: { reason: crash.cause } });
  for (const listener of [...lossListeners]) listener(reason, crash?.cause);
}

/** The running worker, or null when nothing holds a reference. */
export function peekFoldSequenceClient(): FoldSequenceClient | null {
  return client;
}

/** Live reference count, for tests and diagnostics. */
export function foldSequenceClientRefCount(): number {
  return refCount;
}

/**
 * Which worker handles belong to: it moves whenever a worker goes away, so a
 * handle stamped with an older one names a state nobody holds.
 */
export function foldSequenceClientGeneration(): number {
  return generation;
}

/**
 * Ask the live worker, guarded by {@link whileFoldSequenceClientAlive}. A
 * holder that has not retained the client gets a rejection, never a throw.
 * An engine that trapped under the call takes its worker with it: the call
 * rejects as the worker's loss, as every other call under way does.
 */
export function askFoldSequenceClient<T>(ask: (client: FoldSequenceClient) => Promise<T>): Promise<T> {
  try {
    const asked = getFoldSequenceClient();
    const owner = worker;
    return whileFoldSequenceClientAlive(
      ask(asked).catch((error: unknown) => {
        if (!isFoldEngineTrapped(error)) throw error;
        // Only the first answer from a dead worker drops it; any later one is from a corpse.
        if (worker === owner) {
          dropWorker('crashed', { cause: error.trap, message: error.message, stack: error.stack });
        }
        throw lostError('crashed');
      })
    );
  } catch (error) {
    return Promise.reject(error);
  }
}

/**
 * The worker as a document replay's engine source (`createFoldEnginePort`):
 * every call guarded, every handle stamped by the port with the generation
 * it was asked under. The caller retains the client while it uses this.
 */
export const foldSequenceEngineSource: FoldEngineSource = {
  generation: foldSequenceClientGeneration,
  // Named, because comlink's `Remote` answers a union with a union of
  // promises, from which inference would keep only the first member.
  sheet: (paper) =>
    askFoldSequenceClient<FoldEngineOutcome<FoldSheetLanded>>((engine) => engine.sheet(paper)),
  step: (state, op, choices) =>
    askFoldSequenceClient<FoldEngineOutcome<FoldStepFingerprinted>>((engine) =>
      engine.step(state, op, choices)
    ),
  returnTo: (current, target, history) =>
    askFoldSequenceClient<FoldEngineOutcome<FoldStepFingerprinted>>((engine) => engine.returnTo(current, target, history)),
  release: (states) => askFoldSequenceClient((engine) => engine.release([...states])),
};

// ---------------------------------------------------------------------------
// Latest wins

/** A preview's answer, or word that a newer request replaced it. */
export type FoldPreviewResult<T> = { status: 'answered'; value: T } | { status: 'superseded' };

export interface FoldPreviewChannel {
  /**
   * Ask the worker. Resolves with the answer, or `superseded` as soon as a
   * newer request (or {@link FoldPreviewChannel.cancel}) replaces this one.
   * An answer that arrives superseded is handed to `discard`, so a landed
   * preview's handle can be released. Rejects only while still the newest.
   */
  request<T>(
    ask: (client: FoldSequenceClient) => Promise<T>,
    discard?: (value: T) => void
  ): Promise<FoldPreviewResult<T>>;
  /** Supersede whatever is in flight or waiting, asking nothing new. */
  cancel(): void;
}

interface Waiting {
  ticket: number;
  run: () => void;
  supersede: () => void;
}

/**
 * Latest request wins (D14 tiers 2 and 3). The worker answers one call at a
 * time, so a preview per pointer move would queue behind every earlier one
 * and the answer on screen would trail the pointer further each frame.
 * Instead at most one request is in flight and one waits: a newer request
 * replaces the waiting one, which never reaches the worker, and makes the one
 * in flight superseded, its answer discarded when it comes.
 *
 * Stopping a request already in the worker is not this channel's job — that
 * is {@link stopFoldSequenceWork}, which costs every state the worker holds.
 * One channel per preview stream (the fold preview, the analysis), so two
 * streams never supersede each other.
 */
export function createFoldPreviewChannel(): FoldPreviewChannel {
  let latest = 0;
  let busy = false;
  let waiting: Waiting | null = null;

  const next = () => {
    busy = false;
    const queued = waiting;
    waiting = null;
    queued?.run();
  };

  return {
    request<T>(
      ask: (client: FoldSequenceClient) => Promise<T>,
      discard?: (value: T) => void
    ): Promise<FoldPreviewResult<T>> {
      const ticket = ++latest;
      return new Promise<FoldPreviewResult<T>>((resolve, reject) => {
        const run = () => {
          if (ticket !== latest) {
            resolve({ status: 'superseded' });
            next();
            return;
          }
          busy = true;
          askFoldSequenceClient(ask).then(
            (value) => {
              if (ticket === latest) resolve({ status: 'answered', value });
              else {
                discard?.(value);
                resolve({ status: 'superseded' });
              }
              next();
            },
            (error: unknown) => {
              if (ticket === latest) reject(error);
              else resolve({ status: 'superseded' });
              next();
            }
          );
        };
        waiting?.supersede();
        if (busy) {
          waiting = { ticket, run, supersede: () => resolve({ status: 'superseded' }) };
        } else {
          waiting = null;
          run();
        }
      });
    },

    cancel() {
      latest += 1;
      waiting?.supersede();
      waiting = null;
    },
  };
}
