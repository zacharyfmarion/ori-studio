import { useTranslation } from 'react-i18next';
import { isKnownAnnotation, type DiagramStep } from '../../diagram/document/diagramDocument';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { activeAnchorPick } from '../../store/workspaceStore/diagramState';
import { Button } from '../ui/Button';
import { CanvasContextBar, CanvasContextBarLabel } from '../ui/CanvasContextBar';

/**
 * On a touch screen, while the anchor's pick is armed on `step` — an enlarge
 * area's or frame's face (Revision 2), an x-ray's point (Revision 3): what the
 * canvas waits for, and a way to stop it with no keyboard. The Settings sheet
 * that armed it steps aside while it is made (18f), taking Pick's hint and the
 * only button that put it down with it, and a touch screen shows no hover or
 * crosshair to say a pick is armed (review of 18f). Cancel puts it down as
 * Escape does, and the sheet comes back.
 *
 * Mounted over the canvas, off its stage: a press on it is not a pick.
 */
export function DiagramAnchorPickBar({ step }: { step: DiagramStep }) {
  const { t } = useTranslation();
  const coarse = useIsCoarsePointerSurface();
  const pick = useWorkspaceStore(activeAnchorPick);
  const setAnchorPick = useWorkspaceStore((state) => state.setDiagramAnchorPick);
  if (!coarse || !pick || pick.stepId !== step.id) return null;
  const target = step.annotations.find((annotation) => annotation.id === pick.target);
  const xray = target !== undefined && isKnownAnnotation(target) && target.kind === 'x-ray';
  return (
    <CanvasContextBar aria-label={t('panels:diagram.annotations.anchorPickBar', 'Anchor pick')} data-anchor-pick-bar="">
      <CanvasContextBarLabel>
        {xray
          ? t('panels:diagram.annotations.xRayAnchorTap', 'Tap the point where the layers are counted')
          : t('panels:diagram.annotations.anchorTap', 'Tap a face to anchor to it')}
      </CanvasContextBarLabel>
      <Button size="sm" onClick={() => setAnchorPick(null)}>
        {t('common:cancel', 'Cancel')}
      </Button>
    </CanvasContextBar>
  );
}
