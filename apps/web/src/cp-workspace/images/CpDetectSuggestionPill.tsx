import { useTranslation } from 'react-i18next';
import { ScanLine, X } from 'lucide-react';
import { FloatingToolbar } from '../../components/ui/FloatingToolbar';
import { Button } from '../../components/ui/Button';
import { IconButton } from '../../components/ui/IconButton';
import { resolveCpViewportCanvas } from '../cpViewportCanvas';
import { useCanvasObjectAnchor } from '../canvasObjects/useCanvasObjectAnchor';
import type { CpImage } from './cpImage';

/**
 * "Looks like a crease pattern — Detect creases?" on a reference image.
 *
 * Wears the floating-toolbar chrome so it reads as one of the canvas's own
 * controls rather than a notification, and anchors **below** the image: the
 * image inspector pill owns the top edge of a *selected* image, and a dropped
 * image is one click from being selected. Distinct edges, both visible, no
 * special-casing — `@floating-ui` still flips this one up when the pane has no
 * room below, the one case in which the two can overlap.
 *
 * Takes no focus. The user who just dropped an image keeps the keyboard where
 * it was; the body is a polite live region, so a screen reader hears the offer
 * once, and the two controls are ordinary buttons after that.
 */
export function CpDetectSuggestionPill({
  image,
  container,
  onDetect,
  onDismiss,
}: {
  image: CpImage;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
  onDetect: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  // Subscribed here, not in the panel: the pill re-renders per camera frame so
  // it stays glued to the image, while the (huge) panel does not.
  const anchorRect = useCanvasObjectAnchor(image, 'model', container);
  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      placement="bottom-start"
      boundary={container}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-detect-suggestion"
      ariaLabel={t('panels:cpDetectSuggestion.ariaLabel', 'Crease pattern detected in image')}
    >
      <div className="cp-detect-suggestion__body" role="status" aria-live="polite">
        <ScanLine size={14} aria-hidden="true" className="cp-detect-suggestion__icon" />
        <span className="cp-detect-suggestion__label">
          {t('panels:cpDetectSuggestion.label', 'Looks like a crease pattern')}
        </span>
        <Button size="sm" variant="primary" onClick={onDetect}>
          {t('panels:cpDetectSuggestion.detect', 'Detect creases')}
        </Button>
      </div>
      <IconButton
        size="sm"
        variant="toolbar"
        title={t('panels:cpDetectSuggestion.notNow', 'Not now')}
        aria-label={t('panels:cpDetectSuggestion.notNow', 'Not now')}
        onClick={onDismiss}
      >
        <X size={14} />
      </IconButton>
    </FloatingToolbar>
  );
}
