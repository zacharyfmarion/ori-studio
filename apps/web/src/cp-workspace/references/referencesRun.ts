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
 * A query cannot be interrupted cooperatively (plan decision D7: the core
 * polls `checkCancel` only in the statistics command), so Stop is
 * `releaseReferenceFinderClient('window')` — terminate the worker, which
 * rejects the query's promise through the runtime — and `stopping` holds from
 * the press until that rejection lands and the run ends.
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
const listeners = new Set<() => void>();

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

/** Start a run; returns its id, which {@link endReferencesRun} needs back. */
export function beginReferencesRun(now = Date.now()): number {
  const runId = nextRunId++;
  set({ running: true, startedAt: now, stopping: false, runId });
  return runId;
}

/** End the run with this id. A stale id (a run already superseded) is ignored. */
export function endReferencesRun(runId: number): void {
  if (!state.running || state.runId !== runId) return;
  set({ ...IDLE, runId });
}

/**
 * Ask the running query to end. Kills the window instance's worker — the only
 * cancel the core allows — so the query rejects and its caller ends the run.
 * Returns false when nothing was running or a stop was already written.
 */
export function requestReferencesStop(): boolean {
  if (!state.running || state.stopping) return false;
  set({ ...state, stopping: true });
  releaseReferenceFinderClient('window');
  return true;
}

/** Tests only. */
export function resetReferencesRun(): void {
  state = IDLE;
  nextRunId = 1;
}
