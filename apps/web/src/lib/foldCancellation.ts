import { invoke } from '@tauri-apps/api/core';
import { surfaceSupports } from '../platform/capabilities';
import type { OristudioCpWorkerApi } from '../workers/oristudioCpWorker';

/**
 * Stopping a running fold, on both transports.
 *
 * A fold is one synchronous call into the kernel. On web it occupies the CP
 * worker's only thread, so a Comlink message asking it to stop would sit unread
 * in the queue behind the very fold it is meant to stop; on desktop it holds the
 * engine mutex, so a command that touched the session would block on it. Neither
 * platform can be stopped by *asking* — both are stopped by writing a run id
 * somewhere the running code already looks, which is what this module owns:
 *
 * - **web** — a `SharedArrayBuffer` slot the main thread writes with
 *   `Atomics.store` and the kernel reads at every checkpoint. Synchronous, no
 *   `await`, no worker hop. That is the entire point.
 * - **native** — `cp_fold_cancel`, a synchronous Tauri command that stores into
 *   an `AtomicU32` managed beside (never inside) the engine. Every surface with
 *   the `nativeCpEngine` capability, which is desktop and iOS.
 *
 * Ids are matched **exactly**, never as a watermark, so stopping the fold on
 * screen cannot collaterally kill a background one, and an unbound fold (id 0)
 * matches nothing.
 */

/** Slot 0 holds the run the user asked to stop; 1-3 are spare. */
const SLOT_CANCELLED_RUN = 0;
const SLOT_COUNT = 4;

/**
 * `RunId::BACKGROUND` — reserved for work the user cannot address.
 *
 * Nothing binds it. The two callers it was written for — the 3D rehydrate on
 * load and the export-dialog fold — pass {@link FOLD_RUN_NONE} instead: neither
 * can be stopped either way, and an id the kernel treats as bound costs them the
 * rollback snapshot on every step, per replay, on the platform with the recorded
 * large-CP OOM. It stays here as the id `beginFoldRun` must never mint and
 * {@link cancelFoldRun} must never write.
 */
export const FOLD_RUN_BACKGROUND = 0xffff_ffff;

/** A fold with no run id. Inert in the kernel: it matches no stop request. */
export const FOLD_RUN_NONE = 0;

let buffer: SharedArrayBuffer | null = null;
let view: Int32Array | null = null;
let nextRunId = 1;

/**
 * Whether this page can share memory with the worker at all.
 *
 * A page without cross-origin isolation has no `SharedArrayBuffer`, and the CP
 * engine boots there perfectly well — its wasm memory is unshared, so isolation
 * is this feature's dependency and not the engine's. Cancellation must therefore
 * *degrade*: unavailable, and honestly reported as such, rather than a Stop
 * button that writes into nothing.
 */
function sharedMemoryAvailable(): boolean {
  return typeof SharedArrayBuffer === 'function' && globalThis.crossOriginIsolated === true;
}

/**
 * The shared cancel buffer, allocated on first use, or null when this page
 * cannot share memory.
 */
export function foldCancellationBuffer(): SharedArrayBuffer | null {
  if (buffer) return buffer;
  if (!sharedMemoryAvailable()) return null;
  buffer = new SharedArrayBuffer(SLOT_COUNT * Int32Array.BYTES_PER_ELEMENT);
  view = new Int32Array(buffer);
  return buffer;
}

/**
 * Whether a fold started now could be stopped.
 *
 * **A property of the resolved engine client, not of the page.** The native
 * client needs no shared memory at all; a packaged Tauri build serves over a
 * custom protocol with no COOP/COEP, so a `SharedArrayBuffer &&
 * crossOriginIsolated` predicate would ship Stop permanently disabled on the
 * platforms where it works best. (`npm run dev:desktop` hides that: its devUrl is
 * vite, which does set the headers.)
 */
export function foldCancellationAvailable(): boolean {
  if (surfaceSupports('nativeCpEngine')) return true;
  return foldCancellationBuffer() !== null;
}

/**
 * Mint the id for a fold about to start.
 *
 * Never 0 (inert in the kernel) and never {@link FOLD_RUN_BACKGROUND}, so a user
 * Stop always names something addressable. Ids are never reused, which is what
 * makes a stale cancel harmless: it names a run that has already ended.
 */
export function beginFoldRun(): number {
  const runId = nextRunId;
  nextRunId = runId + 1 >= FOLD_RUN_BACKGROUND ? 1 : runId + 1;
  return runId;
}

/**
 * Stop the named fold. Synchronous, and on web deliberately not a client method.
 *
 * A no-op when cancellation is unavailable — callers should be asking
 * {@link foldCancellationAvailable} before offering the affordance, and a Stop
 * that reaches here anyway must do nothing rather than throw.
 */
export function cancelFoldRun(runId: number): void {
  if (runId === FOLD_RUN_NONE || runId === FOLD_RUN_BACKGROUND) return;
  if (surfaceSupports('nativeCpEngine')) {
    // Fire-and-forget: the command is synchronous on the Rust side and answers
    // without touching the engine mutex, so there is nothing to await and
    // nothing a failure here could usefully tell the user.
    void invoke('cp_fold_cancel', { runId }).catch(() => undefined);
    return;
  }
  // Allocates on first use, so a Stop pressed before any fold still writes into
  // the same buffer the worker was handed.
  foldCancellationBuffer();
  if (view) Atomics.store(view, SLOT_CANCELLED_RUN, runId | 0);
}

/** The one method of the CP client this module needs; keeps tests free of Comlink. */
type FoldCancellationClient = Pick<OristudioCpWorkerApi, 'setCancelBuffer'>;

/**
 * Hand a freshly connected CP worker the shared buffer.
 *
 * Called from the `oristudio-cp` connector rather than from a fold call site,
 * because the connector is the only place that runs exactly once per live client
 * — including after a crash, where `connectEngine` spawns a replacement with no
 * memory of the old one. Installed anywhere else, a worker that died mid-session
 * would come back with cancellation dead and the Stop button still enabled.
 *
 * Fire-and-forget: Comlink preserves message order, so the buffer lands before
 * any fold the client is later asked for.
 */
export function installFoldCancellation(client: FoldCancellationClient): void {
  if (surfaceSupports('nativeCpEngine')) {
    // The native path carries the run id on the fold command itself, so there is
    // no buffer to install — but there *is* a flag to reset. It lives in the Tauri
    // process and nothing clears it; `nextRunId` lives in this webview's module
    // state and restarts at 1 on every reload, which the error boundaries offer
    // as a recovery path. Stop run 3, reload, fold three times, and the third
    // fold binds an id the flag already names: cancelled from birth and
    // completely silent, because no part of the UI asked for it. Clearing where
    // the counter begins gives the two halves one lifetime.
    void invoke('cp_fold_cancel', { runId: FOLD_RUN_NONE }).catch(() => undefined);
    return;
  }
  const shared = foldCancellationBuffer();
  if (!shared) return;
  void Promise.resolve(client.setCancelBuffer(shared)).catch(() => undefined);
}
