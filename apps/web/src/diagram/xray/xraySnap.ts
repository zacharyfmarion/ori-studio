/**
 * What snaps inside an x-ray's window (Revision 3, R3-22 B): the picture as
 * the window shows it. The faces it takes away stop being snap targets there —
 * their corners and the lines they draw — and the corners and edges of the
 * faces it shows, the layers beneath among them, become targets, read from the
 * same inside as the window is drawn from (`xrayScene.ts`): a corner is a
 * vertex, and an edge crosses the lines drawn over it (review of 18e). A
 * crease the window does not draw (R3-16b A) is drawn by hand with a Line,
 * which lands on them.
 *
 * In the marks' units: an enlarged step's window's, else the picture's.
 *
 * Pure but for one memo per x-ray mark.
 */
import type { IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import type { PicturePoint } from '../annotate/annotationModel';
import { xrayDepthOf } from '../annotate/annotationModel';
import type { DiagramStep, KnownDiagramAnnotation } from '../document/diagramDocument';
import { viewOfStep } from '../zoom/stepView';
import { fromBox, intoBox } from '../zoom/zoomFrames';
import { xrayFacesOf, xrayInside, type XRayFaces } from './xrayScene';

/** The windows a step's x-rays cut, and the corners and edges of the faces they show, in the marks' units. */
export interface XRaySnap {
  windows: readonly { centre: PicturePoint; radius: number }[];
  corners: readonly PicturePoint[];
  /** The edges of the faces shown, each held to the window it shows in: what a line drawn over them crosses. */
  edges: readonly IndexedSegment[];
}

type Shown = { corners: readonly PicturePoint[]; edges: readonly (readonly [PicturePoint, PicturePoint])[] };

const memo = new WeakMap<KnownDiagramAnnotation, { faces: XRayFaces; window: string; shown: Shown }>();

/** Whether a point lies inside any of the windows. */
export function insideXRay(snap: XRaySnap, [x, y]: PicturePoint): boolean {
  return snap.windows.some(({ centre, radius }) => Math.hypot(x - centre[0], y - centre[1]) < radius);
}

/**
 * The windows `annotations` cut into the step's picture and the corners they
 * show; null when there are none, or the picture has no layers to x-ray.
 */
export function xraySnap(step: DiagramStep, annotations: readonly KnownDiagramAnnotation[]): XRaySnap | null {
  const marks = annotations.filter((annotation) => annotation.kind === 'x-ray' && annotation.radius !== undefined);
  if (marks.length === 0) return null;
  const faces = xrayFacesOf(step);
  if (!faces) return null;
  const { window } = viewOfStep(step);
  const unit = window ? Math.max(window.width, window.height) : 1;
  const key = JSON.stringify(window);
  const { minX, minY, maxX, maxY } = faces.frame.bounds;
  const sceneUnit = Math.max(maxX - minX, maxY - minY);
  const windows: { centre: PicturePoint; radius: number }[] = [];
  const corners: PicturePoint[] = [];
  const edges: IndexedSegment[] = [];
  for (const mark of marks) {
    const radius = mark.radius!;
    windows.push({ centre: mark.from, radius });
    const cached = memo.get(mark);
    let shown = cached && cached.faces === faces && cached.window === key ? cached.shown : null;
    if (!shown) {
      const centre = window ? fromBox(window, mark.from) : mark.from;
      const inside = xrayInside(faces, { centre, radius: radius * unit, depth: xrayDepthOf(mark), anchor: mark.anchor });
      const inMarks = ([x, y]: readonly [number, number]): PicturePoint => {
        const picture: PicturePoint = [(x - minX) / sceneUnit, (y - minY) / sceneUnit];
        return window ? intoBox(window, picture) : picture;
      };
      const seen: { corners: PicturePoint[]; edges: (readonly [PicturePoint, PicturePoint])[] } = { corners: [], edges: [] };
      for (const item of inside.scene.items) {
        if (item.kind !== 'face') continue;
        for (const ring of item.rings) {
          const points = ring.map(inMarks);
          points.forEach((at, index) => {
            if (Math.hypot(at[0] - mark.from[0], at[1] - mark.from[1]) < radius) seen.corners.push(at);
            const held = withinCircle(at, points[(index + 1) % points.length]!, mark.from, radius);
            if (held) seen.edges.push(held);
          });
        }
      }
      shown = seen;
      memo.set(mark, { faces, window: key, shown });
    }
    corners.push(...shown.corners);
    for (const [a, b] of shown.edges) edges.push({ id: edges.length, a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } });
  }
  return { windows, corners, edges };
}

/** The part of the segment from `a` to `b` inside the circle round `centre`; null where none of it is. */
export function withinCircle(a: PicturePoint, b: PicturePoint, centre: PicturePoint, radius: number): readonly [PicturePoint, PicturePoint] | null {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const [fx, fy] = [a[0] - centre[0], a[1] - centre[1]];
  const qa = dx * dx + dy * dy;
  if (!(qa > 0)) return null;
  // |a + t (b − a) − centre|² = radius²: t² qa + 2 t qb + qc = 0.
  const qb = fx * dx + fy * dy;
  const qc = fx * fx + fy * fy - radius * radius;
  const disc = qb * qb - qa * qc;
  if (!(disc > 0)) return null;
  const root = Math.sqrt(disc);
  const [from, to] = [Math.max(0, (-qb - root) / qa), Math.min(1, (-qb + root) / qa)];
  if (!(to > from)) return null;
  const at = (t: number): PicturePoint => [a[0] + t * dx, a[1] + t * dy];
  return [at(from), at(to)];
}
