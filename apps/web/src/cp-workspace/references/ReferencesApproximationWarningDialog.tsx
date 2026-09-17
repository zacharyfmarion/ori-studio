import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, X } from 'lucide-react';
import { useReferencesApproximationWarningEvent } from '../../analytics/useReferencesApproximationWarningEvent';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import type { ReferencesApproximationWarning } from './useReferencesApproximationWarning';

/**
 * The modal that says a precreasing sequence contains approximated folds.
 *
 * Presentation only: `useReferencesApproximationWarning` decides when it is
 * up. The `simple-modal` shell, as every other confirm-sized dialog; Escape,
 * the backdrop, the close button and the one action all dismiss — there is
 * nothing to choose, only something to have read.
 */
export function ReferencesApproximationWarningDialog({
  open,
  inexactSteps,
  exactnessClass,
  dismiss,
}: ReferencesApproximationWarning) {
  const { t } = useTranslation();
  useReferencesApproximationWarningEvent({ open, inexactSteps, exactnessClass });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [dismiss, open]);

  if (!open) return null;

  const title = t('dialogs:referencesApproximationWarning.title', 'Approximated folds');
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={title}
      className="simple-modal"
      onMouseDown={dismiss}
    >
      <div role="document" className="simple-modal__document" onMouseDown={(event) => event.stopPropagation()}>
        <header className="simple-modal__header">
          <span>
            <TriangleAlert size={15} aria-hidden="true" />
            {title}
          </span>
          <IconButton
            size="sm"
            aria-label={t('dialogs:referencesApproximationWarning.close', 'Close the approximated folds warning')}
            onClick={dismiss}
          >
            <X size={15} />
          </IconButton>
        </header>
        <div className="simple-modal__body">
          <p className="simple-modal__message">
            {t(
              'dialogs:referencesApproximationWarning.message',
              'This sequence contains approximated folds. If this crease pattern came from Detect CP from Image, the detection may have converged on an inaccurate solution. Please verify that any reference points are correct.'
            )}
          </p>
        </div>
        <footer className="simple-modal__footer">
          <Button size="sm" variant="primary" onClick={dismiss} autoFocus>
            {t('dialogs:referencesApproximationWarning.dismiss', 'Got it')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
