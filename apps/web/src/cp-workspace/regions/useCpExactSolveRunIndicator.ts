import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  cpExactSolveRunsSnapshot,
  requestCpExactSolveStop,
  subscribeCpExactSolveRuns,
} from '../../engine/cpExactSolveRuns';

/**
 * When "Solving…" stops being reassuring and starts looking stuck. Longer than
 * a fold's ten seconds: a solve with no deadline is *expected* to take a while
 * on a complex pattern, and the toast escalating too early would be nagging.
 */
export const CP_EXACT_SOLVE_LONG_RUN_MS = 30_000;

/** What a surface needs to indicate a running solve and offer a way out of it. */
export interface CpExactSolveRunIndicator {
  /** Any exact solve is running — a region's, the detect dialog's, a command's. */
  solving: boolean;
  /** At least one live run can actually be reached by a Stop. */
  stoppable: boolean;
  /** Every *stoppable* run has had its stop written. */
  stopping: boolean;
  /** The oldest live run has outlasted {@link CP_EXACT_SOLVE_LONG_RUN_MS}. */
  longRun: boolean;
  /** Ask for every stoppable run to end; `false` when none could be reached. */
  stop: () => boolean;
}

/**
 * The solve-run state machine, once, away from whichever surface renders it —
 * the same shape as `useFoldRunIndicator`, over the exact-solve run registry
 * instead of the store's fold runs. The region chip and the detect dialog each
 * read their own run by target; this is the view across all of them, for the
 * one surface that stands in for a chip the user has panned away from.
 */
export function useCpExactSolveRunIndicator(): CpExactSolveRunIndicator {
  const runs = useSyncExternalStore(subscribeCpExactSolveRuns, cpExactSolveRunsSnapshot);
  const solving = runs.length > 0;
  const stoppable = runs.some((run) => run.cancellable);
  // Gated on `stoppable`, not on `solving`: "have all the runs that can be
  // stopped been stopped" of a set containing none is vacuously yes.
  const stopping = stoppable && runs.every((run) => !run.cancellable || run.stopping);
  const oldestStartedAt = solving ? Math.min(...runs.map((run) => run.startedAt)) : null;

  // Timed from the *oldest* live run, so a second solve does not reset the
  // clock on the one the user is actually waiting for.
  const [longRun, setLongRun] = useState(false);
  useEffect(() => {
    if (oldestStartedAt === null) {
      setLongRun(false);
      return;
    }
    const remaining = oldestStartedAt + CP_EXACT_SOLVE_LONG_RUN_MS - Date.now();
    if (remaining <= 0) {
      setLongRun(true);
      return;
    }
    const timer = setTimeout(() => setLongRun(true), remaining);
    return () => clearTimeout(timer);
  }, [oldestStartedAt]);

  const stop = useCallback(
    () =>
      runs
        .filter((run) => run.cancellable && !run.stopping)
        .map((run) => requestCpExactSolveStop(run.runId))
        .some(Boolean),
    [runs]
  );

  return { solving, stoppable, stopping, longRun, stop };
}
