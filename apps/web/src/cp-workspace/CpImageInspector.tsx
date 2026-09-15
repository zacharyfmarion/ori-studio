import { useTranslation } from 'react-i18next';
import { FloatingToolbar } from '../components/ui/FloatingToolbar';
import { resolveCpViewportCanvas } from './cpViewportCanvas';
import { useCanvasObjectAnchor } from './canvasObjects/useCanvasObjectAnchor';
import { AnnotationActions } from './AnnotationActions';
import type { CpImage } from './images/cpImage';

/**
 * Floating controls for the selected reference image: z-order and delete —
 * the verbs. Its adjectives (opacity, rotation) are the Properties pane's.
 * Hovers above the selected image via {@link FloatingToolbar}.
 *
 * (Hide/lock live on the model for forward-compat but are intentionally not
 * surfaced here — those belong to the future general layer model.)
 */
export function CpImageInspector({
  image,
  container,
  onBringToFront,
  onSendToBack,
  onDelete,
}: {
  image: CpImage;
  /** Element the canvas is positioned against — see {@link useCanvasObjectAnchor}. */
  container: HTMLElement | null;
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
        onBringToFront={onBringToFront}
        onSendToBack={onSendToBack}
        onDelete={onDelete}
      />
    </FloatingToolbar>
  );
}
