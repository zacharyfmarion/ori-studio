import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useFoldRunIndicator } from '../cp-workspace/folded/useFoldRunIndicator';
import { useCpExactSolveRunIndicator } from '../cp-workspace/regions/useCpExactSolveRunIndicator';
import { formatUnknownError, humanizeError } from '../lib/toastMessages';
import { createDelayedProgress } from '../lib/delayedProgress';
import { useWorkspaceStore } from '../store/workspaceStore';

function errorKey(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const envelope = error as { code: unknown; message: unknown };
    return `${String(envelope.code)}:${String(envelope.message)}`;
  }
  return formatUnknownError(error);
}

/**
 * A fold has to run this long before it is worth a toast. Longer than an inline
 * spinner would wait, because a toast is heavier chrome to throw at someone.
 */
const FOLD_TOAST_DELAY_MS = 500;
/** And once shown it stays this long, so it cannot pop and vanish. */
const FOLD_TOAST_MIN_VISIBLE_MS = 1000;
const FOLD_TOAST_ID = 'oristudio-folding';
const FOLD_STOPPED_TOAST_ID = 'oristudio-folding-stopped';
/** One id, so saving repeatedly replaces the notice rather than stacking it. */
const SAVED_TOAST_ID = 'oristudio-saved';
/**
 * A solve has to run this long before it is worth a toast. Longer than a fold's
 * half second: the region chip and the detect dialog each show their own
 * spinner and Stop from the first moment, so the toast is for the solve that has
 * gone on long enough that the user may have panned or tabbed away from them.
 */
export const SOLVE_TOAST_DELAY_MS = 3000;
const SOLVE_TOAST_MIN_VISIBLE_MS = 1000;
const SOLVE_TOAST_ID = 'oristudio-solving';
const SOLVE_STOPPED_TOAST_ID = 'oristudio-solving-stopped';

export function GlobalToasts() {
  const { t } = useTranslation();
  const error = useWorkspaceStore((state) => state.error);
  const { folding, stoppable, stopping, longRun, stop: stopFolds } = useFoldRunIndicator();
  const solve = useCpExactSolveRunIndicator();
  const projectMessage = useWorkspaceStore((state) => state.projectMessage);
  const clearProjectMessage = useWorkspaceStore((state) => state.clearProjectMessage);
  const savedNotice = useWorkspaceStore((state) => state.savedNotice);
  const clearSavedNotice = useWorkspaceStore((state) => state.clearSavedNotice);
  const lastErrorKey = useRef<string | null>(null);

  useEffect(() => {
    if (!error) {
      lastErrorKey.current = null;
      return;
    }

    const key = errorKey(error);
    if (lastErrorKey.current === key) return;
    lastErrorKey.current = key;

    toast.error(t('toasts:global.error', 'Ori Studio error'), {
      id: `treemaker-error-${key}`,
      description: humanizeError(error, t),
      duration: 8000,
    });
  }, [error, t]);

  useEffect(() => {
    if (!projectMessage) return;
    clearProjectMessage();
  }, [clearProjectMessage, projectMessage]);

  // The one save that leaves no trace of itself: the browser's File System
  // Access path writes the file straight through its handle, with no download
  // for the browser to announce. Shown once and cleared, so a later save that
  // lands on the same filename still gets its own toast.
  useEffect(() => {
    if (!savedNotice) return;
    toast.success(t('toasts:global.saved', '{{name}} saved', { name: savedNotice }), {
      id: SAVED_TOAST_ID,
      duration: 3000,
    });
    clearSavedNotice();
  }, [clearSavedNotice, savedNotice, t]);

  // Folding runs in the CP worker, so the main thread is free to paint this and
  // to take the Stop — which is a synchronous write into memory the running
  // kernel already reads, not a message that would queue behind the fold.
  //
  // **The toast is the surface, deliberately, and not a modal.** A fold is
  // computation the user started and the app stays usable during: they can pan,
  // annotate, work in another pane. BP's optimizer gets a modal with an Abort
  // because the run is *launched from* that modal and its options live there;
  // throwing one up ten seconds into a fold would claim the app is blocked when
  // it is not, and steal focus from someone who may be perfectly happy to wait.
  // What the toast owes a run that can last an hour is persistence, so while a
  // Stop is on offer this one refuses to be dismissed: the only indicator of a
  // 60-minute run must not be swipeable. `dismissible: false` is the whole
  // mechanism — sonner never renders a close button on a `loading` toast, so
  // App.tsx's global `closeButton` is already inert here and passing it either
  // way would be a lie about what keeps this on screen. Without a Stop the toast
  // stays dismissable: an indicator you cannot act on is better gone.
  const [visible, setVisible] = useState(false);
  const foldProgress = useMemo(
    () =>
      createDelayedProgress({
        delayMs: FOLD_TOAST_DELAY_MS,
        minVisibleMs: FOLD_TOAST_MIN_VISIBLE_MS,
        show: () => setVisible(true),
        hide: () => {
          setVisible(false);
          toast.dismiss(FOLD_TOAST_ID);
        },
      }),
    []
  );

  useEffect(() => {
    if (folding) foldProgress.start();
    else foldProgress.stop();
  }, [foldProgress, folding]);

  useEffect(() => () => foldProgress.dispose(), [foldProgress]);

  useEffect(() => {
    if (!visible) return;
    const message = stopping
      ? t('toasts:global.foldStopping', 'Cancelling…')
      : longRun
        ? t('toasts:global.foldingLong', 'Still folding — this can take a while')
        : t('toasts:global.folding', 'Folding…');
    toast.loading(message, {
      id: FOLD_TOAST_ID,
      duration: Infinity,
      dismissible: !stoppable,
      // Dropped once the stop is written: pressing it again would name runs that
      // are already unwinding, and a button that repeats is a button that looks
      // like it did not work.
      action:
        stoppable && !stopping
          ? {
              label: t('toasts:global.foldStop', 'Cancel'),
              onClick: () => stopFolds(),
            }
          : undefined,
    });
  }, [longRun, stopFolds, stoppable, stopping, t, visible]);

  // Say so when a stop lands, once the run has actually left. Announced here
  // rather than at the press because until the kernel unwinds at its next
  // checkpoint the fold is still running, and "Fold cancelled" would be a
  // guess. Upstream says nothing at all on a halt (`FoldingEstimateTask` logs to
  // a file), so one quiet line is already more than parity.
  const stopRequested = useRef(false);
  useEffect(() => {
    if (stopping) stopRequested.current = true;
    if (folding || !stopRequested.current) return;
    stopRequested.current = false;
    toast.message(t('toasts:global.foldStopped', 'Fold cancelled'), {
      id: FOLD_STOPPED_TOAST_ID,
    });
  }, [folding, stopping, t]);

  // The exact solve, the same way. Since the 25 s cap went a solve ends only by
  // converging, giving up, or being stopped, and a toast that outlives the chip
  // the user started it from is what carries the Cancel for a long one.
  const [solveVisible, setSolveVisible] = useState(false);
  const solveProgress = useMemo(
    () =>
      createDelayedProgress({
        delayMs: SOLVE_TOAST_DELAY_MS,
        minVisibleMs: SOLVE_TOAST_MIN_VISIBLE_MS,
        show: () => setSolveVisible(true),
        hide: () => {
          setSolveVisible(false);
          toast.dismiss(SOLVE_TOAST_ID);
        },
      }),
    []
  );

  useEffect(() => {
    if (solve.solving) solveProgress.start();
    else solveProgress.stop();
  }, [solve.solving, solveProgress]);

  useEffect(() => () => solveProgress.dispose(), [solveProgress]);

  const stopSolves = solve.stop;
  useEffect(() => {
    if (!solveVisible) return;
    const message = solve.stopping
      ? t('toasts:global.solveStopping', 'Cancelling…')
      : solve.longRun
        ? t('toasts:global.solvingLong', 'Still solving — this can take a while')
        : t('toasts:global.solving', 'Solving…');
    toast.loading(message, {
      id: SOLVE_TOAST_ID,
      duration: Infinity,
      dismissible: !solve.stoppable,
      action:
        solve.stoppable && !solve.stopping
          ? {
              label: t('toasts:global.solveStop', 'Cancel'),
              onClick: () => stopSolves(),
            }
          : undefined,
    });
  }, [solve.longRun, solve.stoppable, solve.stopping, solveVisible, stopSolves, t]);

  const solveStopRequested = useRef(false);
  useEffect(() => {
    if (solve.stopping) solveStopRequested.current = true;
    if (solve.solving || !solveStopRequested.current) return;
    solveStopRequested.current = false;
    toast.message(t('toasts:global.solveStopped', 'Solve cancelled'), {
      id: SOLVE_STOPPED_TOAST_ID,
    });
  }, [solve.solving, solve.stopping, t]);

  return null;
}
