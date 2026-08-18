import { useTranslation } from 'react-i18next';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import { AnnotationActions } from './AnnotationActions';
import type { CpImage, CpImageUpdate } from './images/cpImage';

/**
 * Floating controls for the selected reference image: opacity, z-order, and
 * delete. Hovers above the selected image via {@link FloatingToolbar}, sharing
 * its action group ({@link AnnotationActions}) with the text toolbar.
 *
 * (Hide/lock live on the model for forward-compat but are intentionally not
 * surfaced here — those belong to the future general layer model.)
 */
export function CpImageInspector({
  image,
  container,
  onUpdate,
  onGestureStart,
  onGestureCommit,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  image: CpImage;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
  onUpdate: (patch: CpImageUpdate) => void;
  onGestureStart: () => void;
  onGestureCommit: (label: string) => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  // Subscribed here, not in the panel: the toolbar re-renders per camera frame
  // so it stays glued to the image, while the (huge) panel does not.
  const anchorRect = useCanvasObjectAnchor(image, 'model', container);
  return (
    <FloatingToolbar
      anchorRect={anchorRect}
      boundary={container}
      wheelTarget={resolveCpViewportCanvas}
      className="cp-image-inspector"
      ariaLabel={t('panels:imageInspector.imageControls', 'Image controls')}
    >
      <AnnotationActions
        opacity={image.opacity}
        onOpacity={(opacity) => onUpdate({ opacity })}
        onGestureStart={onGestureStart}
        onGestureCommit={onGestureCommit}
        onBringToFront={onBringToFront}
        onSendToBack={onSendToBack}
        onDelete={onDelete}
      />
    </FloatingToolbar>
  );
}
