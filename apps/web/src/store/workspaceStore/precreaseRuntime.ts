import { wrap, type Remote } from 'comlink';
import type { PrecreaseWorkerApi } from '../../workers/precreaseWorker';
import type { WasmErrorEnvelope } from '../../engine/types';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';

export type PrecreaseClient = Remote<PrecreaseWorkerApi>;

export type PrecreaseClientLossReason = 'crashed' | 'released';

// Owns the precrease planner worker, following `simulatorRuntime.ts`: a
// reference-counted singleton that the References workspace retains on entry
// and releases on leaving, so the wasm module and — once Phase 4 lands — a
// planner's point store are not resident for the life of the tab.
//
// Not an `engineHost` engine: the bridge holds no document. It answers
// questions about the geometry it is handed and forgets it. On desktop it runs
// as wasm inside the webview like the ReferenceFinder worker, not natively like
// the CP kernel.
//
// A count rather than a single owner for the same reason the simulator's is:
// the panel retains it, and the Phase 5 CP-wide analysis will too.

let worker: Worker | null = null;
let client: PrecreaseClient | null = null;
let detachDiagnostics: (() => void) | null = null;
let refCount = 0;
const lossListeners = new Set<(reason: PrecreaseClientLossReason) => void>();

/** Called when the worker goes away, for whatever reason. */
export function onPrecreaseClientLost(
  listener: (reason: PrecreaseClientLossReason) => void
): () => void {
  lossListeners.add(listener);
  return () => {
    lossListeners.delete(listener);
  };
}

function lostError(reason: PrecreaseClientLossReason): WasmErrorEnvelope {
  return {
    code: 'precrease_client_lost',
    message:
      reason === 'crashed'
        ? 'The precrease planner stopped while it was running.'
        : 'The precrease planner was released while it was running.',
  };
}

/**
 * Settle with `pending`, or reject as soon as the worker behind it goes away.
 *
 * `terminate()` does not reject comlink's outstanding promises — they simply
 * never settle — so without this a crash (or a release) between a call and its
 * answer leaves the caller awaiting forever. That is not a hypothetical: the
 * References query awaits `rfToModelMany` *inside a begun run*, and an orphaned
 * promise there meant the run never ended, the panel kept its "Finding
 * references…" overlay across a workspace switch, and Stop had nothing left to
 * reject. Rejecting is the whole fix; a `finally` cannot help a promise that
 * never settles.
 */
export function whilePrecreaseClientAlive<T>(pending: Promise<T>): Promise<T> {
  let unsubscribe: (() => void) | null = null;
  const lost = new Promise<never>((_resolve, reject) => {
    unsubscribe = onPrecreaseClientLost((reason) => reject(lostError(reason)));
  });
  return Promise.race([pending, lost]).finally(() => unsubscribe?.());
}

function spawn(): PrecreaseClient {
  const spawned = new Worker(new URL('../../workers/precreaseWorker.ts', import.meta.url), {
    type: 'module',
  });
  worker = spawned;
  detachDiagnostics = attachWorkerDiagnostics(spawned, 'precrease', () => {
    // A dead worker must not be handed out again: drop it so the next
    // `getPrecreaseClient` spawns a replacement. Callers inside a run wrap
    // their call in `whilePrecreaseClientAlive` so the loss reaches them as a
    // rejection; everything else keys results on the document revision and
    // re-asks. Guarded on identity so a late event from a worker already
    // replaced cannot drop the replacement.
    if (worker === spawned) dropWorker('crashed');
  });
  client = wrap<PrecreaseWorkerApi>(spawned);
  return client;
}

/**
 * Take a reference to the precrease worker, starting it if needed. Every caller
 * must pair this with {@link releasePrecreaseClient}.
 */
export function retainPrecreaseClient(): PrecreaseClient {
  refCount += 1;
  return client ?? spawn();
}

/**
 * The live client, for a holder that has already retained one. Respawns the
 * worker after a crash, so a holder should call this per request rather than
 * keep the proxy `retainPrecreaseClient` returned.
 */
export function getPrecreaseClient(): PrecreaseClient {
  if (client) return client;
  if (refCount === 0) {
    throw new Error('getPrecreaseClient: retain the precrease client before using it');
  }
  return spawn();
}

/**
 * Drop a reference. When the last one goes the worker is terminated outright:
 * frames are cheap to recompute and there is no useful idle state.
 */
export function releasePrecreaseClient(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  dropWorker('released');
}

/**
 * The one place the worker goes away. Order matters, as in
 * `referenceFinderRuntime`'s `loseClient`: terminate, then announce, so a
 * listener that immediately re-asks gets a fresh worker rather than the corpse.
 */
function dropWorker(reason: PrecreaseClientLossReason): void {
  const had = worker !== null;
  detachDiagnostics?.();
  detachDiagnostics = null;
  client = null;
  worker?.terminate();
  worker = null;
  if (had) for (const listener of [...lossListeners]) listener(reason);
}

/** The running worker, or null when nothing holds a reference. */
export function peekPrecreaseClient(): PrecreaseClient | null {
  return client;
}

/** Live reference count, for tests and diagnostics. */
export function precreaseClientRefCount(): number {
  return refCount;
}
