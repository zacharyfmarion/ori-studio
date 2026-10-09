import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramMarkStyled } from '../../analytics';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { activeAnchorPick } from '../../store/workspaceStore/diagramState';
import { xrayDepthOf, withXRayDepth } from '../annotate/annotationModel';
import { xrayDepthBucket } from '../annotate/annotationEventKind';
import {
  isKnownAnnotation,
  isLockedStep,
  stepNumber,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { buildAnchorActions } from '../zoom/zoomActions';
import { anchorPickable } from '../zoom/zoomAnchor';
import { withZoomAnchor } from '../zoom/zoomModel';
import { xrayDepthMax, xrayStepsIn } from './xrayLayers';
import { useXRayStanding } from './useXRayStanding';

/**
 * An x-ray's rows in the Layers pane (Revision 3), bound to the store: its
 * Depth — from one to the steps its window peels (18g), with a notice when it
 * asks for more, as a Refresh, a refold or a moved window can leave it — and
 * its Point row, where peeling starts, each change one undo step, "Change
 * X-ray", counted as the mark's own option (`diagram mark styled`), never an
 * enlargement's. On a picture with no layers the rows are held, saying why
 * (R3-18b A).
 */
export function useXRayControls(step: DiagramStep, xray: KnownDiagramAnnotation) {
  const { t } = useTranslation();
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const number = useWorkspaceStore((state) => (state.diagram ? stepNumber(state.diagram, step.id) : null)) ?? 0;
  const picking = useWorkspaceStore((state) => {
    const pick = activeAnchorPick(state);
    return pick?.stepId === step.id && pick.target === xray.id;
  });
  const standing = useXRayStanding(step);
  // Its step's faces being fetched, as it was laid or pasted there: it waits for them, saying nothing meanwhile.
  const fetching = useWorkspaceStore((state) => Object.hasOwn(state.diagramPaperFacesFetching, step.id));
  const { id } = xray;
  const stepId = step.id;
  // The steps its window peels as it draws them: none to count on a picture without layers.
  const steps = useMemo(() => xrayStepsIn(step, xray), [step, xray]);
  const ready = standing.kind === 'ready' && steps !== null;
  const editable = !readOnly && !isLockedStep(step) && step.picture !== null;
  const depth = xrayDepthOf(xray);
  const picked = xray.anchor !== undefined;

  const verbs = useMemo(() => {
    const store = () => useWorkspaceStore.getState();
    const change = (edit: (each: KnownDiagramAnnotation) => KnownDiagramAnnotation) =>
      store().editDiagramAnnotations(
        stepId,
        'Change X-ray',
        (list) => list.map((each) => (each.id === id && isKnownAnnotation(each) && each.kind === 'x-ray' ? edit(each) : each)),
        { loadId }
      );
    return {
      setDepth: (next: number) => {
        const changed = change((each) => withXRayDepth(each, next));
        if (changed) trackDiagramMarkStyled('x_ray', 'depth', xrayDepthBucket(withXRayDepth(xray, next).depth!));
      },
      pick: () => store().setDiagramAnchorPick(picking ? null : { stepId, target: id }),
      resetAnchor: () => {
        store().setDiagramAnchorPick(null);
        if (change((each) => withZoomAnchor(each, null))) trackDiagramMarkStyled('x_ray', 'anchor', 'auto');
      },
    };
  }, [stepId, id, loadId, picking, xray]);

  // A phone's Annotate shows no canvas, so there is no point to Pick there, as for an enlargement (`useZoomControls`).
  const canvas = !useIsPhoneLayout();
  const anchorActions = useMemo(
    () =>
      buildAnchorActions(
        { picked, picking, readOnly: !editable || !ready, canvas, on: 'x-ray' },
        { t, pick: verbs.pick, reset: verbs.resetAnchor }
      ),
    [picked, picking, editable, ready, canvas, t, verbs]
  );

  // Why its rows are held: a picture with no layers, or one that needs a Refresh for its faces (R3-18b A) — never while
  // they are being fetched, which ends with them, or with a Refresh to say when the fold no longer draws its picture.
  const held =
    ready || (standing.kind === 'fetch' && fetching)
      ? null
      : standing.kind === 'none'
        ? t('panels:diagram.annotations.xRayNoLayers', 'This picture has no layers to x-ray')
        : t('panels:diagram.annotate.xRayRefresh', 'Refresh step {{number}} to x-ray it', { number });

  return {
    editable: editable && ready,
    depth,
    /**
     * The deepest the stepper goes: the steps its window peels — or the depth asked for, where that is deeper, kept as
     * it was asked (it draws at the deepest, and takes more again where the window moves to more layers), so the field
     * left as it stands never rewrites it.
     */
    max: ready && steps !== null ? Math.max(xrayDepthMax(steps), depth) : Math.max(1, depth),
    /** Its window has nothing to take away — one layer in it, or no paper: what its notice says (review of 18e, 18g). */
    empty: ready && steps === 0,
    /** The steps its window peels when it asks for more: what its notice says; null when it does not. */
    fewer: ready && steps !== null && steps > 0 && depth > steps ? steps : null,
    held,
    /** The Anchor row: on a flat fold with its faces, whose points can be picked. */
    anchorShown: anchorPickable(step),
    picked,
    anchorActions,
    ...verbs,
  };
}
