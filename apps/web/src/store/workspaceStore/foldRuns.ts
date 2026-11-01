/**
 * The fold-run registry (`oristudioCpFoldRuns`): every fold the user can see
 * and stop, from any workspace — the Edit canvas's folds and the Diagram's
 * captures — so one "Folding…" toast and one Stop cover them all (D4).
 *
 * Functions over the store rather than closures inside a slice, so every slice
 * that starts a fold registers it the same way.
 */
import { beginFoldRun, cancelFoldRun, foldCancellationAvailable } from '../../lib/foldCancellation';
import type { OristudioCpFoldRun, OristudioCpFoldRunKind } from './types';

type FoldRuns = Record<number, OristudioCpFoldRun>;

/** The part of the store the registry lives in. */
export interface FoldRunStore {
  get: () => { oristudioCpFoldRuns: FoldRuns };
  set: (partial: { oristudioCpFoldRuns: FoldRuns }) => void;
}

/** The run map without `runId`, for the `finally` that ends every fold. */
function foldRunsWithout(runs: FoldRuns, runId: number): FoldRuns {
  const remaining: FoldRuns = {};
  for (const run of Object.values(runs)) {
    if (run.runId !== runId) remaining[run.runId] = run;
  }
  return remaining;
}

/**
 * Each live run's stop signal, by id: what a run's work outside the CP kernel
 * listens to, since the cancel slot reaches only the kernel. The Layer order
 * host engine is that work (`layer-order/host/`): its worker has no cancel
 * channel, so a Stop terminates it. Kept here rather than in the store,
 * because nothing draws a signal.
 */
const stopSignals = new Map<number, AbortController>();

/**
 * Live stoppable runs, **oldest first** — which is executing order.
 *
 * One CP worker on web and one engine mutex on desktop, so folds run strictly
 * serially in the order they were dispatched, and run ids are minted at
 * dispatch. `startedAt` leads because it is what "oldest" means; the id breaks
 * its millisecond ties.
 */
export function stoppableFoldRuns(runs: FoldRuns): OristudioCpFoldRun[] {
  return Object.values(runs)
    .filter((run) => run.cancellable)
    .sort((a, b) => a.startedAt - b.startedAt || a.runId - b.runId);
}

/**
 * Point the cancel slot at the oldest run still waiting to be stopped.
 *
 * The transport names **one** run: a single `SharedArrayBuffer` slot on web, a
 * single `AtomicU32` on desktop, matched exactly. So a Stop over several live
 * runs cannot be a loop of writes — the last write would win, and since ids
 * ascend that is the *newest* run while the engine is busy with the oldest.
 * Instead the stop intent is recorded on every run (`stopping`) and the slot is
 * re-aimed here, as each run leaves and the next becomes the one executing.
 * Re-writing an id already in the slot is harmless.
 *
 * Every Stop passes through here, so this is also where each run marked
 * stopping has its stop signal aborted ({@link withFoldInFlight}). A signal
 * names one run, so all of them are told at once; aborting one twice is
 * harmless.
 */
export function aimFoldStopAtOldestPending(runs: FoldRuns): void {
  const stoppable = stoppableFoldRuns(runs);
  const pending = stoppable.find((run) => run.stopping);
  if (pending) cancelFoldRun(pending.runId);
  for (const run of stoppable) if (run.stopping) stopSignals.get(run.runId)?.abort();
}

/**
 * Stop one run, leaving the others going: the Diagram's Stop on a card whose
 * capture is folding. Marked like a Stop of all of them, and aimed the same
 * way, so a run still queued behind another is stopped as it starts. False
 * for a run that is gone or that the transport cannot reach.
 */
export function stopFoldRun(store: FoldRunStore, runId: number): boolean {
  const runs = store.get().oristudioCpFoldRuns;
  const run = runs[runId];
  if (!run || !run.cancellable) return false;
  const marked = { ...runs, [runId]: { ...run, stopping: true } };
  store.set({ oristudioCpFoldRuns: marked });
  aimFoldStopAtOldestPending(marked);
  return true;
}

/** How a run may be stopped. */
export interface FoldRunOptions {
  /**
   * Whether a Stop can reach the run as it starts. By default, whether the
   * kernel's cancel transport can (`foldCancellationAvailable`). A run whose
   * work starts in a Layer order engine passes true: terminating that
   * engine's worker stops it on any page.
   */
  readonly stoppable?: boolean;
}

/** What a run can say about itself while it runs. */
export interface FoldRunControls {
  /**
   * Whether a Stop can reach the run from now on: a run that moves from a
   * Layer order engine's work to the kernel's says what the kernel's
   * transport allows.
   */
  stoppable(on: boolean): void;
}

/**
 * Record a fold as live for as long as `run` takes, under an id a Stop can
 * name, so the UI can both show progress for a slow one and offer a way out of
 * it. Folding happens in the CP worker, so the main thread stays free to paint
 * that indicator and to write the stop.
 *
 * The id is minted here rather than by the caller: a run is live exactly while
 * it is in the map, and the two must not be able to disagree. The `finally`
 * clears it on **every** exit — including a cancel, which a cooperative stop
 * makes an ordinary rejection rather than a promise that never settles (the
 * stuck-flag failure recorded in `bp-optimizer-cancellation.md`).
 *
 * `run` also gets the run's stop signal, aborted when a Stop reaches this run:
 * the way to stop work in the run that the kernel's cancel slot cannot reach,
 * such as a Layer order resolve (`layer-order/host/hostEngineGateway.ts`).
 */
export async function withFoldInFlight<T>(
  store: FoldRunStore,
  kind: OristudioCpFoldRunKind,
  run: (runId: number, stop: AbortSignal, controls: FoldRunControls) => Promise<T>,
  options: FoldRunOptions = {}
): Promise<T> {
  const runId = beginFoldRun();
  const stop = new AbortController();
  stopSignals.set(runId, stop);
  store.set({
    oristudioCpFoldRuns: {
      ...store.get().oristudioCpFoldRuns,
      [runId]: {
        runId,
        kind,
        startedAt: Date.now(),
        // Asked once, at dispatch, because that is when the binding is made:
        // a run started in a browser that cannot share memory stays
        // un-stoppable for its whole life, however the page changes later.
        cancellable: options.stoppable ?? foldCancellationAvailable(),
        stopping: false,
      },
    },
  });
  const controls: FoldRunControls = {
    stoppable: (on) => {
      const runs = store.get().oristudioCpFoldRuns;
      const current = runs[runId];
      if (!current || current.cancellable === on) return;
      store.set({ oristudioCpFoldRuns: { ...runs, [runId]: { ...current, cancellable: on } } });
    },
  };
  try {
    return await run(runId, stop.signal, controls);
  } finally {
    stopSignals.delete(runId);
    const remaining = foldRunsWithout(store.get().oristudioCpFoldRuns, runId);
    store.set({ oristudioCpFoldRuns: remaining });
    aimFoldStopAtOldestPending(remaining);
  }
}
