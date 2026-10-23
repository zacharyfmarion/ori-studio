import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { loadFold, useLoadedFold, type Fold } from '../../workspaces/foldGateway';
import { SurfaceFailure } from '../ui/SurfaceFailure';
import { SurfaceLoading } from '../ui/SurfaceLoading';
import styles from './FoldGate.module.css';

/**
 * Where Fold's code meets the surfaces that mount it (`workspaces/foldGateway.ts`):
 * a surface that needs it asks for it as it mounts, shows the loading state
 * while it comes — or, if it could not come, says so with a retry, as a
 * surface whose engine did not load does — and renders itself once it has.
 * A load that has already happened renders at once: the second surface, and
 * every later visit, never sees the loading state.
 */

/** Fold's code for a surface that needs it, asked for as the surface mounts; whether the ask failed. */
function useFoldCode(onFailed: (() => void) | undefined): { fold: Fold | null; failed: boolean; retry: () => void } {
  const fold = useLoadedFold();
  const [attempt, setAttempt] = useState(0);
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null);
  const failedRef = useRef(onFailed);
  useEffect(() => {
    failedRef.current = onFailed;
  });
  useEffect(() => {
    if (fold) return;
    let live = true;
    loadFold().catch(() => {
      if (!live) return;
      setFailedAttempt(attempt);
      failedRef.current?.();
    });
    return () => {
      live = false;
    };
  }, [fold, attempt]);
  return { fold, failed: failedAttempt === attempt, retry: () => setAttempt((count) => count + 1) };
}

/**
 * Render `children` with Fold's code once it has loaded. `pending` is what
 * shows until then: a pane's loading and failure states, or nothing — for an
 * overlay, which has no frame of its own until its code is here, and says
 * what went wrong through `onFailed` instead.
 */
export function FoldGate({
  children,
  pending = 'pane',
  onFailed,
}: {
  children: (fold: Fold) => ReactNode;
  pending?: 'pane' | 'none';
  onFailed?: () => void;
}) {
  const { fold, failed, retry } = useFoldCode(onFailed);
  if (fold) return children(fold);
  if (pending === 'none') return null;
  return <div className={styles.pane}>{failed ? <FoldLoadFailure retry={retry} /> : <FoldLoading />}</div>;
}

function FoldLoading() {
  const { t } = useTranslation();
  return <SurfaceLoading label={t('panels:fold.load.loading', 'Loading Fold…')} />;
}

function FoldLoadFailure({ retry }: { retry: () => void }) {
  const { t } = useTranslation();
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <SurfaceFailure
      label={t('panels:fold.load.failed', 'Fold did not load')}
      detail={
        offline
          ? t(
              'panels:fold.load.offline',
              'Fold has not been downloaded yet, and you are offline. Connect once and it will work offline from then on.'
            )
          : null
      }
      retryLabel={t('panels:fold.load.retry', 'Try again')}
      onRetry={retry}
    />
  );
}

/** The Fold workspace's dock panel, its code loaded as it mounts. */
export function LazyFoldPanel() {
  return <FoldGate>{({ FoldPanel }) => <FoldPanel />}</FoldGate>;
}

/** The Fold workspace's Step pane, docked or a phone's drawer, its code loaded as it mounts. */
export function LazyFoldStepPanel() {
  return <FoldGate>{({ FoldStepPanel }) => <FoldStepPanel />}</FoldGate>;
}

/** The Fold workspace's Paper pane, docked or a phone's drawer, its code loaded as it mounts. */
export function LazyFoldPaperPanel() {
  return <FoldGate>{({ FoldPaperPanel }) => <FoldPaperPanel />}</FoldGate>;
}

/**
 * Fold's Import CP dialog. It opens only over Fold (`FoldImportModal`), whose
 * pane has loaded Fold's code by then, so this never asks for it.
 */
export function FoldImportOverlay() {
  const fold = useLoadedFold();
  return fold ? <fold.FoldImportModal /> : null;
}
