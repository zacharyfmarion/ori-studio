import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * When "Folding…" stops being reassuring and starts looking stuck. A guess, and
 * the `elapsed_ms_bucket` on `fold completed` is what will replace it with data.
 */
export const FOLD_LONG_RUN_MS = 10_000;

/** What a surface needs to indicate a running fold and offer a way out of it. */
export interface FoldRunIndicator {
  /** Any fold is running, stoppable or not. */
  folding: boolean;
  /** At least one live run can actually be reached by a Stop. */
  stoppable: boolean;
  /** Every *stoppable* run has had its stop written. */
  stopping: boolean;
  /** The oldest live run has outlasted {@link FOLD_LONG_RUN_MS}. */
  longRun: boolean;
  /** Ask for every stoppable run to end; `false` when none could be reached. */
  stop: () => boolean;
}

/**
 * The fold-run state machine, once, away from whichever surface renders it.
 *
 * It lives here rather than inside the toast host because "is a fold running,
 * can it be stopped, has it been asked to" is state about folding, not about
 * toasts — and the second consumer (a toolbar Stop, or the persistent element
 * for a long run) must not have to re-derive it or reach into the toast host to
 * read it.
 */
export function useFoldRunIndicator(): FoldRunIndicator {
  const foldRuns = useWorkspaceStore((state) => state.oristudioCpFoldRuns);
  const stopFolds = useWorkspaceStore((state) => state.stopOristudioCpFolds);

  const runs = useMemo(() => Object.values(foldRuns), [foldRuns]);
  const folding = runs.length > 0;
  const stoppable = runs.some((run) => run.cancellable);
  // Gated on `stoppable`, not on `folding`. Asking "have all the runs that can
  // be stopped been stopped" of a set containing none is vacuously *yes*, which
  // is exactly the un-isolated browser: every fold there would read "Stopping…"
  // from the moment its indicator appeared and then announce "Folding stopped"
  // when it succeeded.
  const stopping = stoppable && runs.every((run) => !run.cancellable || run.stopping);
  const oldestStartedAt = folding ? Math.min(...runs.map((run) => run.startedAt)) : null;

  // Timed from the *oldest* live run, so overlapping folds do not reset the
  // clock on the one the user is actually waiting for.
  const [longRun, setLongRun] = useState(false);
  useEffect(() => {
    if (oldestStartedAt === null) {
      setLongRun(false);
      return;
    }
    const remaining = oldestStartedAt + FOLD_LONG_RUN_MS - Date.now();
    if (remaining <= 0) {
      setLongRun(true);
      return;
    }
    const timer = setTimeout(() => setLongRun(true), remaining);
    return () => clearTimeout(timer);
  }, [oldestStartedAt]);

  return { folding, stoppable, stopping, longRun, stop: stopFolds };
}
