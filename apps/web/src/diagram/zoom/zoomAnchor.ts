/**
 * An enlarge area's and an enlarged step's anchor as the screen shows and
 * picks it (Revision 2, Controls): the anchor face outlined while the area or
 * the frame is selected, the face drawn on top under the pointer in the pick
 * mode, the paper point a click there anchors to, and the notices the Step
 * pane gives when a frame and its paper part.
 *
 * Everything in and out is in the step's picture units: the canvas maps them
 * to its own, the window's on an enlarged step. The faces are the step's
 * (`paperFacesOf`), in scene px; nothing here reads a store.
 *
 * Pure but for `paperFacesOf`'s memo per picture.
 */
import type { PicturePoint } from '../annotate/annotationModel';
import type { DiagramStep, KnownDiagramAnnotation } from '../document/diagramDocument';
import { anchorOf } from './zoomCapture';
import {
  faceAt,
  holds,
  paperFacesOf,
  pickAnchor,
  pointToScene,
  toScene,
  type StepFaces,
} from './zoomImprint';
import { distanceOutside, zoomOutlineOf, zoomOutlinePoints } from './zoomModel';

/** What an anchor belongs to: an enlarge area on its step, or the step's own frame. */
export type ZoomAnchorTarget = { kind: 'area'; area: KnownDiagramAnnotation } | { kind: 'frame' };

/** A point in scene px, in the picture's units. */
function toPicturePoint(faces: Pick<StepFaces, 'bounds'>, [x, y]: PicturePoint): PicturePoint {
  const { minX, minY, maxX, maxY } = faces.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return [(x - minX) / unit, (y - minY) / unit];
}

/**
 * Whether the step has faces an anchor can be picked on: a flat fold's. A
 * crease pattern's one face is the paper, which nothing picks; any other
 * picture has none, and its frames are copied in picture units.
 */
export function anchorPickable(step: DiagramStep): boolean {
  return paperFacesOf(step)?.kind === 'flat';
}

/** The face an area or the step's frame is anchored to on its step; null where there is none to name. */
export function anchorFace(step: DiagramStep, target: ZoomAnchorTarget): number | null {
  const faces = paperFacesOf(step);
  if (!faces || faces.kind !== 'flat') return null;
  if (target.kind === 'frame') {
    const on = step.zoom?.imprint?.on;
    return on ? faceAt(faces, on) : null;
  }
  return anchorOf(faces, toScene(faces, zoomOutlineOf(target.area)), target.area.anchor)?.face ?? null;
}

/** The anchor face's ring as it is drawn, in picture units: what the canvas outlines in the selection's ink. */
export function anchorFaceRing(step: DiagramStep, target: ZoomAnchorTarget): PicturePoint[] | null {
  const faces = paperFacesOf(step);
  const face = anchorFace(step, target);
  const ring = faces && face !== null ? faces.drawn[face] : undefined;
  return faces && ring && ring.length >= 3 ? ring.map((point) => toPicturePoint(faces, point)) : null;
}

/**
 * The face drawn on top under a point of the step's picture (picture units),
 * as the pick mode highlights it: its piece's ring as the picture paints it,
 * in picture units. Null off the paper, or on a step with no faces to pick.
 */
export function faceUnder(step: DiagramStep, point: PicturePoint): { face: number; ring: PicturePoint[] } | null {
  const faces = paperFacesOf(step);
  if (!faces || faces.kind !== 'flat') return null;
  const at = pointToScene(faces, point);
  for (let index = faces.pieces.length - 1; index >= 0; index -= 1) {
    const piece = faces.pieces[index]!;
    if (holds(piece.ring, at, faces.epsilon)) {
      return { face: piece.face, ring: piece.ring.map((corner) => toPicturePoint(faces, corner)) };
    }
  }
  return null;
}

/**
 * The paper point a click at `point` (picture units) anchors to: on the face
 * drawn on top there, that face's spread undone, then its placement inverted
 * (`pickAnchor`). Null off the paper.
 */
export function pickedAnchor(step: DiagramStep, point: PicturePoint): PicturePoint | null {
  const faces = paperFacesOf(step);
  if (!faces || faces.kind !== 'flat') return null;
  return pickAnchor(faces, pointToScene(faces, point))?.on ?? null;
}

/**
 * Whether an enlarged step's frame takes in any of its paper, as drawn:
 * false when the anchor face moved against what was framed, which the Step
 * pane says. Null when the step has no faces to tell by.
 */
export function frameHoldsPaper(step: DiagramStep): boolean | null {
  const faces = paperFacesOf(step);
  const frame = step.zoom?.frame;
  if (!faces || !frame || !step.picture) return null;
  const drawn = toScene(faces, frame);
  const rim = zoomOutlinePoints(drawn, 48, 8);
  return faces.drawn.some(
    (ring) =>
      ring.length >= 3 &&
      (holds(ring, drawn.centre, 0) ||
        rim.some((point) => holds(ring, point, 0)) ||
        ring.some((corner) => distanceOutside(drawn, corner) === 0))
  );
}

/**
 * Whether the paper point an enlarged step's frame is anchored by lies on
 * the step's paper: false for another paper, or a sheet cut down, where the
 * frame stays where it was in picture units. Null with no imprint or faces.
 */
export function anchorOnPaper(step: DiagramStep): boolean | null {
  const faces = paperFacesOf(step);
  const on = step.zoom?.imprint?.on;
  if (!faces || !on || !step.picture) return null;
  return faceAt(faces, on) !== null;
}
