import { wrap, type Remote } from 'comlink';
import type { PrecreaseWorkerApi } from '../../workers/precreaseWorker';
import { attachWorkerDiagnostics } from '../../lib/workerDiagnostics';

export type PrecreaseClient = Remote<PrecreaseWorkerApi>;

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

function spawn(): PrecreaseClient {
  const spawned = new Worker(new URL('../../workers/precreaseWorker.ts', import.meta.url), {
    type: 'module',
  });
  worker = spawned;
  detachDiagnostics = attachWorkerDiagnostics(spawned, 'precrease', () => {
    // A dead worker must not be handed out again: drop it so the next
    // `getPrecreaseClient` spawns a replacement. Holders learn of the loss
    // through the app's failure sink (the error toast); their in-flight calls
    // never settle, which is why callers key results on the document revision
    // and re-ask rather than wait. Guarded on identity so a late event from a
    // worker already replaced cannot drop the replacement.
    if (worker === spawned) dropWorker();
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
  dropWorker();
}

function dropWorker(): void {
  detachDiagnostics?.();
  detachDiagnostics = null;
  client = null;
  worker?.terminate();
  worker = null;
}

/** The running worker, or null when nothing holds a reference. */
export function peekPrecreaseClient(): PrecreaseClient | null {
  return client;
}

/** Live reference count, for tests and diagnostics. */
export function precreaseClientRefCount(): number {
  return refCount;
}
