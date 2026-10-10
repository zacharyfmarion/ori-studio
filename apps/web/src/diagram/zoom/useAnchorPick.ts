import { useCallback, useState } from 'react';
import { trackDiagramEnlargementChanged, trackDiagramMarkStyled } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { activeAnchorPick } from '../../store/workspaceStore/diagramState';
import type { PicturePoint } from '../annotate/annotationModel';
import { isKnownAnnotation, type DiagramStep, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { faceUnder, pickedAnchor } from './zoomAnchor';
import { fromBox, intoBox, setFrameAnchor } from './zoomFrames';
import { withZoomAnchor, ZOOM_FRAME_ID, type PictureBox } from './zoomModel';

/** The marks an Anchor row is for: an enlarge area (Revision 2), and an x-ray (Revision 3). */
export function anchorsBy(annotation: KnownDiagramAnnotation): boolean {
  return annotation.kind === 'zoom' || annotation.kind === 'x-ray';
}

/**
 * The anchor's pick mode on the Annotate canvas (Revision 2, Controls): armed
 * by the Anchor row's Pick, for the area, the frame or the x-ray selected.
 * While it is, the face drawn on top under the pointer is shown, and a click
 * anchors to it at the point clicked — one undo step, which never moves the
 * frame on its own step — and leaves the mode. Escape leaves it through the
 * shortcut runtime (`runDiagramCancel`), never a listener here. An x-ray's
 * pick is an x-ray's change ("Change X-ray"), counted as its option, never an
 * enlargement's (Revision 3).
 *
 * Points come and go in the canvas's units: an enlarged step's window's
 * (`window`), else the picture's.
 */
export function useAnchorPick({ step, window }: { step: DiagramStep; window: PictureBox | null }) {
  const pick = useWorkspaceStore((state) => {
    const active = activeAnchorPick(state);
    return active?.stepId === step.id ? active.target : null;
  });
  const [hovered, setHovered] = useState<{ face: number; ring: PicturePoint[] } | null>(null);

  const toPicture = useCallback((at: PicturePoint) => (window ? fromBox(window, at) : at), [window]);
  const toCanvas = useCallback((at: PicturePoint) => (window ? intoBox(window, at) : at), [window]);

  /** The pointer over the canvas at `at` — or gone, null — while picking: the face it would anchor to, shown. */
  const hover = useCallback(
    (at: PicturePoint | null) => {
      const under = pick !== null && at ? faceUnder(step, toPicture(at)) : null;
      setHovered((current) => (current?.face === under?.face && current?.ring.length === under?.ring.length ? current : under));
    },
    [pick, step, toPicture]
  );

  /** A press at `at` while picking: anchored there, and the mode left. Whether it was the pick's. */
  const press = useCallback(
    (at: PicturePoint): boolean => {
      if (pick === null) return false;
      const store = useWorkspaceStore.getState();
      const on = pickedAnchor(step, toPicture(at));
      // Off the paper: nothing to anchor to, and the mode stays for another try.
      if (!on) return true;
      const loadId = store.diagramLoadId;
      const target = step.annotations.find((annotation) => annotation.id === pick);
      const xray = target !== undefined && isKnownAnnotation(target) && target.kind === 'x-ray';
      const changed =
        pick === ZOOM_FRAME_ID
          ? store.editDiagramStepZoom(step.id, 'Pick anchor', (document) => setFrameAnchor(document, step.id, on), { loadId })
          : store.editDiagramAnnotations(
              step.id,
              xray ? 'Change X-ray' : 'Pick anchor',
              (list) =>
                list.map((annotation) =>
                  annotation.id === pick && isKnownAnnotation(annotation) && anchorsBy(annotation)
                    ? withZoomAnchor(annotation, on)
                    : annotation
                ),
              { loadId }
            );
      store.setDiagramAnchorPick(null);
      setHovered(null);
      if (changed && xray) trackDiagramMarkStyled('x_ray', 'anchor', 'picked');
      else if (changed) trackDiagramEnlargementChanged(pick === ZOOM_FRAME_ID ? 'frame' : 'area', 'anchor', 'picked');
      return true;
    },
    [pick, step, toPicture]
  );

  return {
    /** What is being picked for: an area's id, or `ZOOM_FRAME_ID`; null when not picking. */
    picking: pick,
    hover,
    press,
    /** The face a click would anchor to, its ring as drawn, in the canvas's units. */
    highlight: pick !== null && hovered ? hovered.ring.map(toCanvas) : null,
  };
}
