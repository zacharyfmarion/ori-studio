import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { trackDiagramEnlargementChanged } from '../../analytics';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { activeAnchorPick } from '../../store/workspaceStore/diagramState';
import {
  isKnownAnnotation,
  isLockedStep,
  type DiagramAsset,
  type DiagramStep,
  type DiagramZoomEdge,
  type DiagramZoomShape,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { usePrintedZoom } from '../pages/printedFrames';
import { anchorPickable } from './zoomAnchor';
import {
  areaStepOf,
  areaSubtitle,
  buildAnchorActions,
  buildAreaActions,
  buildFrameActions,
  frameSubtitle,
  stepsEnlargedFrom,
  zoomReadout,
  type ZoomAction,
} from './zoomActions';
import { paperSilhouette } from './zoomEdge';
import { setFrameAnchor, setFrameEdge, setFrameScale, setFrameShape } from './zoomFrames';
import {
  withZoomAnchor,
  withZoomEdge,
  withZoomScale,
  withZoomShape,
  zoomEdgeOf,
  zoomShapeOf,
  ZOOM_FRAME_ID,
} from './zoomModel';

/** What an enlargement's controls are for: an enlarge area on its step, or an enlarged step's own frame. */
export type ZoomControlsTarget = { kind: 'area'; area: KnownDiagramAnnotation } | { kind: 'frame' };

const NO_ASSETS: Readonly<Record<string, DiagramAsset>> = {};

/**
 * An enlargement's controls (Revision 2, Controls), bound to the store: an
 * area's or a frame's Shape, Size and Edge, its Anchor row and its verbs,
 * each change one undo step — an area's through its step's marks, a frame's
 * through `zoomFrames.ts` — and what its row says of it. A change is counted
 * (`diagram enlargement changed`). The Layers pane binds an area or a frame
 * with it; Annotate's Step pane binds the step's frame with it too, for its
 * Size and Anchor (`DiagramStepEnlarged`), so the two panes cannot drift.
 */
export function useZoomControls(step: DiagramStep, target: ZoomControlsTarget) {
  const { t } = useTranslation();
  const diagram = useWorkspaceStore((state) => state.diagram);
  const assets = diagram?.assets ?? NO_ASSETS;
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const loadId = useWorkspaceStore((state) => state.diagramLoadId);
  const targetId = target.kind === 'area' ? target.area.id : ZOOM_FRAME_ID;
  const picking = useWorkspaceStore((state) => {
    const pick = activeAnchorPick(state);
    return pick?.stepId === step.id && pick.target === targetId;
  });
  const editable = !readOnly && !isLockedStep(step) && step.picture !== null;
  // A phone's Annotate shows no canvas (`DiagramStepDetail`), so there is nothing to Pick on.
  const canvas = !useIsPhoneLayout();
  const on = target.kind;
  const stepId = step.id;
  const area = target.kind === 'area' ? target.area : null;
  const zoom = step.zoom;

  const shape: DiagramZoomShape = area ? zoomShapeOf(area) : (zoom?.shape ?? 'circle');
  const chosenEdge = area ? area.edge : zoom?.edge;
  const scale = (area ? area.scale : zoom?.scale) ?? null;
  const picked = area ? area.anchor !== undefined : zoom?.imprint?.picked === true;
  // Update folds the faces older steps lack before it captures: it waits, visibly, until it has.
  const [updating, setUpdating] = useState(false);
  // What a frame prints at, as the pages lay its step out (Z4); an area's steps each print their own.
  const printed = usePrintedZoom(target.kind === 'frame' ? step.id : null);

  const verbs = useMemo(() => {
    const store = () => useWorkspaceStore.getState();
    /** The area as one undo step called `label`. */
    const changeArea = (label: string, edit: (area: KnownDiagramAnnotation) => KnownDiagramAnnotation) =>
      store().editDiagramAnnotations(
        stepId,
        label,
        (list) =>
          list.map((each) => (each.id === targetId && isKnownAnnotation(each) && each.kind === 'zoom' ? edit(each) : each)),
        { loadId }
      );
    /** The frame as one undo step called `label`. */
    const changeFrame = (label: string, edit: Parameters<ReturnType<typeof store>['editDiagramStepZoom']>[2]) =>
      store().editDiagramStepZoom(stepId, label, edit, { loadId });
    return {
      setShape: (next: DiagramZoomShape) => {
        const changed =
          on === 'area'
            ? changeArea('Change enlarge area', (each) => withZoomShape(each, next))
            : changeFrame('Change enlarged frame', (document) => setFrameShape(document, stepId, next, document.assets));
        if (changed) trackDiagramEnlargementChanged(on, 'shape', next);
      },
      setScale: (next: number | null) => {
        const changed =
          on === 'area'
            ? changeArea('Change enlarge area', (each) => withZoomScale(each, next))
            : changeFrame('Change enlarged frame', (document) => setFrameScale(document, stepId, next));
        if (changed) trackDiagramEnlargementChanged(on, 'size', next === null ? 'fill' : 'fixed', next ?? undefined);
      },
      setEdge: (next: DiagramZoomEdge | null) => {
        const changed =
          on === 'area'
            ? changeArea('Change enlarge area', (each) => withZoomEdge(each, next))
            : changeFrame('Change enlarged frame', (document) => setFrameEdge(document, stepId, next));
        if (changed && next !== null) trackDiagramEnlargementChanged(on, 'edge', next);
      },
      pick: () => {
        if (picking) {
          store().setDiagramAnchorPick(null);
          return;
        }
        // The canvas picks round the area or frame selected (`activeAnchorPick`): Layers' row is, and
        // Annotate's Step pane, which has the frame's Pick with no row, selects it here. Armed first, so
        // the selection arrives with its pick, which keeps it (`pickPutDown`) and keeps Layers back.
        store().setDiagramAnchorPick({ stepId, target: targetId });
        store().selectDiagramAnnotation(targetId);
      },
      resetAnchor: () => {
        store().setDiagramAnchorPick(null);
        const changed =
          on === 'area'
            ? changeArea('Reset anchor', (each) => withZoomAnchor(each, null))
            : changeFrame('Reset anchor', (document) => setFrameAnchor(document, stepId, null));
        if (changed) trackDiagramEnlargementChanged(on, 'anchor', 'auto');
      },
      update: () => {
        setUpdating(true);
        void store()
          .updateEnlargedDiagramSteps(targetId)
          .finally(() => setUpdating(false));
      },
      goTo: (id: string) => store().selectDiagramStep(id),
      goToArea: (id: string) => {
        store().selectDiagramStep(id);
        if (zoom) store().selectDiagramAnnotation(zoom.from);
      },
    };
  }, [on, stepId, targetId, loadId, picking, zoom]);

  const enlargedOn = useMemo(() => (diagram && area ? stepsEnlargedFrom(diagram, area.id) : []), [diagram, area]);
  const areaStep = useMemo(() => (diagram && on === 'frame' ? areaStepOf(diagram, stepId) : null), [diagram, on, stepId]);

  const actions: ZoomAction[] = useMemo(
    () =>
      on === 'area'
        ? buildAreaActions({ steps: enlargedOn, readOnly, updating }, { t, update: verbs.update, goTo: verbs.goTo })
        : buildFrameActions({ areaStep }, { t, goTo: verbs.goToArea }),
    [on, enlargedOn, areaStep, readOnly, updating, t, verbs]
  );
  const anchorActions = useMemo(
    () => buildAnchorActions({ picked, picking, readOnly: !editable, canvas }, { t, pick: verbs.pick, reset: verbs.resetAnchor }),
    [picked, picking, editable, canvas, t, verbs]
  );

  return {
    on,
    editable,
    shape,
    /** The Edge it draws: the one chosen, or its shape's own. */
    edge: zoomEdgeOf(shape, chosenEdge),
    /** A fixed Size, or null for Fill. */
    scale,
    /** What a frame prints at against its area, once the pages are laid out; null for an area. */
    readout: zoomReadout(printed),
    /** Cut needs the picture's paper outline: an upload or a fixed picture has none, and always draws whole. */
    cutAvailable: paperSilhouette(step, assets) !== null,
    /** The Anchor row: shown on a flat fold's step, whose faces can be picked; never on a crease pattern or a picture with none. */
    anchorShown: anchorPickable(step),
    picked,
    picking,
    anchorActions,
    actions,
    /** The row's subtitle: where an area was enlarged, or where a frame came from. */
    subtitle: on === 'area' ? areaSubtitle(t, enlargedOn) : frameSubtitle(t, areaStep),
    ...verbs,
  };
}

/** An enlargement's controls, bound: what the rows that draw them read (`DiagramZoomRows`). */
export type ZoomControls = ReturnType<typeof useZoomControls>;

/** The subtitle of an area's row in the list, from the diagram as it is. */
export function useAreaSubtitle(area: KnownDiagramAnnotation | null): string | null {
  const { t } = useTranslation();
  const diagram = useWorkspaceStore((state) => state.diagram);
  return useMemo(() => (diagram && area ? areaSubtitle(t, stepsEnlargedFrom(diagram, area.id)) : null), [diagram, area, t]);
}
