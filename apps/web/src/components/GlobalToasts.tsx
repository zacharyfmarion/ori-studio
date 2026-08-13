import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
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
/**
 * When "Folding…" stops being reassuring and starts looking stuck. A guess, and
 * the `elapsed_ms_bucket` on `fold completed` is what will replace it with data.
 */
const FOLD_LONG_RUN_MS = 10_000;
const FOLD_TOAST_ID = 'oristudio-folding';
const FOLD_STOPPED_TOAST_ID = 'oristudio-folding-stopped';

export function GlobalToasts() {
  const { t } = useTranslation();
  const error = useWorkspaceStore((state) => state.error);
  const foldRuns = useWorkspaceStore((state) => state.oristudioCpFoldRuns);
  const stopFolds = useWorkspaceStore((state) => state.stopOristudioCpFolds);
  const projectMessage = useWorkspaceStore((state) => state.projectMessage);
  const clearProjectMessage = useWorkspaceStore((state) => state.clearProjectMessage);
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

  const runs = useMemo(() => Object.values(foldRuns), [foldRuns]);
  const folding = runs.length > 0;
  const stoppable = runs.some((run) => run.cancellable);
  const stopping = folding && runs.every((run) => !run.cancellable || run.stopping);
  const oldestStartedAt = folding ? Math.min(...runs.map((run) => run.startedAt)) : null;

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
  // Stop is on offer this one refuses to be dismissed: `closeButton` is set
  // globally in `App.tsx`, and the only indicator of a 60-minute run must not be
  // swipeable. Without a Stop it stays dismissable — an indicator you cannot act
  // on is better gone.
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

  // Escalated wording for a run that has outlasted the point where "Folding…"
  // reassures. Timed from the *oldest* live run, so overlapping folds do not
  // reset the clock on the one the user is actually waiting for.
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

  useEffect(() => {
    if (!visible) return;
    const message = stopping
      ? t('toasts:global.foldStopping', 'Stopping…')
      : longRun
        ? t('toasts:global.foldingLong', 'Still folding — this can take a while')
        : t('toasts:global.folding', 'Folding…');
    toast.loading(message, {
      id: FOLD_TOAST_ID,
      duration: Infinity,
      dismissible: !stoppable,
      closeButton: !stoppable,
      // Dropped once the stop is written: pressing it again would name runs that
      // are already unwinding, and a button that repeats is a button that looks
      // like it did not work.
      action:
        stoppable && !stopping
          ? {
              label: t('toasts:global.foldStop', 'Stop'),
              onClick: () => stopFolds(),
            }
          : undefined,
    });
  }, [longRun, stopFolds, stoppable, stopping, t, visible]);

  // Say so when a stop lands, once the run has actually left. Announced here
  // rather than at the press because until the kernel unwinds at its next
  // checkpoint the fold is still running, and "Folding stopped" would be a
  // guess. Upstream says nothing at all on a halt (`FoldingEstimateTask` logs to
  // a file), so one quiet line is already more than parity.
  const stopRequested = useRef(false);
  useEffect(() => {
    if (stopping) stopRequested.current = true;
    if (folding || !stopRequested.current) return;
    stopRequested.current = false;
    toast.message(t('toasts:global.foldStopped', 'Folding stopped'), {
      id: FOLD_STOPPED_TOAST_ID,
    });
  }, [folding, stopping, t]);

  return null;
}
