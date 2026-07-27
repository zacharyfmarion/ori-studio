import { useEffect, useMemo, useRef } from 'react';
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
const FOLD_TOAST_ID = 'oristudio-folding';

export function GlobalToasts() {
  const { t } = useTranslation();
  const error = useWorkspaceStore((state) => state.error);
  const foldsInFlight = useWorkspaceStore((state) => state.oristudioCpFoldsInFlight);
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

  // Folding runs in the CP worker, so the main thread is free to paint this.
  // No cancel affordance: the toast reports, it does not offer a way out.
  const foldProgress = useMemo(
    () =>
      createDelayedProgress({
        delayMs: FOLD_TOAST_DELAY_MS,
        minVisibleMs: FOLD_TOAST_MIN_VISIBLE_MS,
        show: () =>
          toast.loading(t('toasts:global.folding', 'Folding…'), {
            id: FOLD_TOAST_ID,
            duration: Infinity,
          }),
        hide: () => toast.dismiss(FOLD_TOAST_ID),
      }),
    [t]
  );

  useEffect(() => {
    if (foldsInFlight > 0) foldProgress.start();
    else foldProgress.stop();
  }, [foldProgress, foldsInFlight]);

  useEffect(() => () => foldProgress.dispose(), [foldProgress]);

  return null;
}
