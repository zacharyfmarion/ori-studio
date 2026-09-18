/**
 * The References workspace's run registry: is a ReferenceFinder query in
 * flight, since when, and has a stop been asked for.
 *
 * The shape of `engine/cpExactSolveRuns.ts`, reduced to the one run this
 * workspace can have at a time. Kept outside React so the hook that renders it
 * (`useReferencesRun`) and the hook that starts it (`useReferencesTarget`) do
 * not have to share a component, and outside the store because a run's clock
 * is not document state.
 *
 * Each run says how it is stopped when it begins, and a Stop press calls that.
 * The two kinds differ: a Find query cannot be interrupted cooperatively (plan
 * decision D7: the core polls `checkCancel` only in the statistics command), so
 * its stop is `releaseReferenceFinderClient('window')` — terminate the worker,
 * which rejects the query's promise through the runtime — while the
 * whole-pattern plan and the CP-wide analysis run on the planner instance and
 * end through their `AbortController`. The registry used to kill the window
 * worker for every run, which stopped a Find query and did nothing to a plan:
 * "Cancelling…" then held until the plan ended on its own, and once a plan had
 * no time ceiling that was never. `stopping` holds from the press until the
 * run actually ends.
 */
import { releaseReferenceFinderClient } from '../../store/workspaceStore/referenceFinderRuntime';

export interface ReferencesRunState {
  running: boolean;
  /** `performance.now()`-free wall clock, for the long-run escalation. */
  startedAt: number | null;
  stopping: boolean;
  /** Monotonic id of the run, so a late completion cannot end a newer one. */
  runId: number;
}

const IDLE: ReferencesRunState = { running: false, startedAt: null, stopping: false, runId: 0 };

let state: ReferencesRunState = IDLE;
let nextRunId = 1;
/** How the running run is stopped; null when nothing runs. */
let stopCurrent: (() => void) | null = null;
const listeners = new Set<() => void>();

/** The Find query's stop: the only cancel the core allows is losing the worker. */
export function stopWindowQuery(): void {
  releaseReferenceFinderClient('window');
}

function set(next: ReferencesRunState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export function subscribeReferencesRun(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function referencesRunSnapshot(): ReferencesRunState {
  return state;
}

/**
 * Start a run; returns its id, which {@link endReferencesRun} needs back.
 * `stop` is what a Stop press does to this run: abort its controller, or, for
 * a Find query, {@link stopWindowQuery}. The run still ends itself — the stop
 * only asks — so `stopping` shows until {@link endReferencesRun}.
 */
export function beginReferencesRun(stop: () => void, now = Date.now()): number {
  const runId = nextRunId++;
  stopCurrent = stop;
  set({ running: true, startedAt: now, stopping: false, runId });
  return runId;
}

/** End the run with this id. A stale id (a run already superseded) is ignored. */
export function endReferencesRun(runId: number): void {
  if (!state.running || state.runId !== runId) return;
  stopCurrent = null;
  set({ ...IDLE, runId });
}

/**
 * Ask the running run to end, the way it said it is ended. Returns false when
 * nothing was running or a stop was already written.
 */
export function requestReferencesStop(): boolean {
  if (!state.running || state.stopping) return false;
  set({ ...state, stopping: true });
  stopCurrent?.();
  return true;
}

/**
 * Monotonic id of the *pick*, which is not the same thing as the run.
 *
 * A run only begins once the frames and the resolve are done — hundreds of ms
 * on a large pattern, all of it before `beginReferencesRun`. Dismissing a pick
 * in that window (clicking empty canvas) leaves the original `query()` sitting
 * on its awaits, and nothing in the run registry can express "abandoned":
 * `runId` is kept by `endReferencesRun`, so a guard on it passes for a run that
 * was cleared. This is what the async flows compare instead, the way they
 * compare `revisionRef` — captured before the first await, checked after each.
 */
let pickGeneration = 0;

/** A new pick, a Recompute, or a dismissal. Returns the generation it starts. */
export function beginReferencesPick(): number {
  pickGeneration += 1;
  return pickGeneration;
}

export function referencesPickGeneration(): number {
  return pickGeneration;
}

/** Tests only. */
export function resetReferencesRun(): void {
  state = IDLE;
  stopCurrent = null;
  nextRunId = 1;
  pickGeneration = 0;
}
