import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { createDelayedProgress } from '../../lib/delayedProgress';
import { referencesRunSnapshot, requestReferencesStop, subscribeReferencesRun } from './referencesRun';

/**
 * When "Finding references…" stops being reassuring. A cold database build is
 * 2–6 s and a line query under a second, so a run past this is either a first
 * query on a slow machine or a worker that is not coming back — the runtime's
 * 10 s timeout will say which.
 */
export const REFERENCES_LONG_RUN_MS = 6_000;

/**
 * A run has to last this long before it is worth a toast: the panel's own
 * overlay says "Finding references…" from the first frame, so the toast is for
 * the query that outlives a glance — the exact-solve figure, for the same
 * reason (`GlobalToasts.tsx`).
 */
export const REFERENCES_TOAST_DELAY_MS = 3_000;
const REFERENCES_TOAST_MIN_VISIBLE_MS = 1_000;
const REFERENCES_TOAST_ID = 'oristudio-references-query';
const REFERENCES_STOPPED_TOAST_ID = 'oristudio-references-stopped';

/** What a surface needs to indicate a running query and offer a way out of it. */
export interface ReferencesRunIndicator {
  running: boolean;
  /** A live query can always be reached by a Stop (it kills the worker). */
  stoppable: boolean;
  /** The stop has been written and the query has not yet unwound. */
  stopping: boolean;
  /** The run has outlasted {@link REFERENCES_LONG_RUN_MS}. */
  longRun: boolean;
  /** Ask the run to end; `false` when nothing could be reached. */
  stop: () => boolean;
}

/**
 * The run state machine, once, away from whichever surface renders it — the
 * shape of `useCpExactSolveRunIndicator`, over the References run registry.
 */
export function useReferencesRun(): ReferencesRunIndicator {
  const run = useSyncExternalStore(subscribeReferencesRun, referencesRunSnapshot);
  const { running, startedAt, stopping } = run;
  const stoppable = running;

  const [longRun, setLongRun] = useState(false);
  useEffect(() => {
    if (!running || startedAt === null) {
      setLongRun(false);
      return;
    }
    const remaining = startedAt + REFERENCES_LONG_RUN_MS - Date.now();
    if (remaining <= 0) {
      setLongRun(true);
      return;
    }
    const timer = setTimeout(() => setLongRun(true), remaining);
    return () => clearTimeout(timer);
  }, [running, startedAt]);

  const stop = useCallback(() => requestReferencesStop(), []);

  return { running, stoppable, stopping: stoppable && stopping, longRun, stop };
}

/**
 * The long-run toast: `toast.loading` with a Cancel, on the exact-solve
 * pattern — shown only after {@link REFERENCES_TOAST_DELAY_MS}, kept up at least
 * a second once shown, undismissable while a Stop is on offer (an indicator you
 * cannot act on is better gone; one you can must not be swipeable), and the
 * Cancel dropped once the stop is written so a press cannot repeat.
 *
 * Mounted by the panel rather than by `GlobalToasts`: the References panel is
 * the only surface that can start this run and it is unmounted — its worker
 * released, its run killed — the moment the workspace is left, so there is no
 * run for a global surface to outlive.
 */
export function useReferencesRunToast(indicator: ReferencesRunIndicator): void {
  const { t } = useTranslation();
  const { running, stoppable, stopping, longRun, stop } = indicator;
  const [visible, setVisible] = useState(false);
  const progress = useMemo(
    () =>
      createDelayedProgress({
        delayMs: REFERENCES_TOAST_DELAY_MS,
        minVisibleMs: REFERENCES_TOAST_MIN_VISIBLE_MS,
        show: () => setVisible(true),
        hide: () => {
          setVisible(false);
          toast.dismiss(REFERENCES_TOAST_ID);
        },
      }),
    []
  );

  useEffect(() => {
    if (running) progress.start();
    else progress.stop();
  }, [progress, running]);

  useEffect(() => () => progress.dispose(), [progress]);

  useEffect(() => {
    if (!visible) return;
    const message = stopping
      ? t('toasts:references.stopping', 'Cancelling…')
      : longRun
        ? t('toasts:references.searchingLong', 'Still finding references — the first search builds a table')
        : t('toasts:references.searching', 'Finding references…');
    toast.loading(message, {
      id: REFERENCES_TOAST_ID,
      duration: Infinity,
      dismissible: !stoppable,
      action:
        stoppable && !stopping
          ? {
              label: t('toasts:references.stop', 'Cancel'),
              onClick: () => {
                stop();
              },
            }
          : undefined,
    });
  }, [longRun, stop, stoppable, stopping, t, visible]);

  // Say so when a stop lands, once the run has actually left — until the
  // worker's rejection arrives the query is still running and "cancelled"
  // would be a guess.
  const stopRequested = useRef(false);
  useEffect(() => {
    if (stopping) stopRequested.current = true;
    if (running || !stopRequested.current) return;
    stopRequested.current = false;
    toast.message(t('toasts:references.stopped', 'Search cancelled'), {
      id: REFERENCES_STOPPED_TOAST_ID,
    });
  }, [running, stopping, t]);
}
