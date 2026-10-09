/**
 * An oval's and a rectangle's outline (Diagram Revision 3, "4. Shapes"): an
 * ellipse, or a rectangle with square corners, `size` across about its
 * centre and turned `angle` degrees clockwise — what the drawing, the hit,
 * an enlarged step's window and the reach each measure against. An enlarge
 * area's circle and rounded rectangle stay in `zoom/zoomModel.ts`.
 *
 * Everything is in whatever units the outline is in: a step's picture units,
 * or a drawing's px.
 *
 * Pure: no DOM, no store, no React.
 */
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { ZOOM_CLICK, type PicturePoint } from './annotationModel';
import type { PictureBox } from '../zoom/zoomModel';

/** A shape's outline: an ellipse or a square-cornered rectangle, `size` across about `centre`, turned `angle` degrees clockwise. */
export interface AreaOutline {
  kind: 'oval' | 'rectangle';
  centre: PicturePoint;
  /** Its width along its own turn and its height across it. */
  size: readonly [number, number];
  /** Its turn, in degrees clockwise on the y-down page. */
  angle: number;
}

/** An oval's or a rectangle's outline, in its picture units; a click's square where it has no size. */
export function areaOutlineOf(area: Pick<KnownDiagramAnnotation, 'kind' | 'from' | 'size' | 'angle'>): AreaOutline {
  return {
    kind: area.kind === 'rectangle' ? 'rectangle' : 'oval',
    centre: [area.from[0], area.from[1]],
    size: area.size ? [area.size[0], area.size[1]] : [ZOOM_CLICK.size[0], ZOOM_CLICK.size[1]],
    angle: area.angle ?? 0,
  };
}

/** `point` along the outline's own axes, its centre at the origin: the outline's turn undone. */
function local({ centre, angle }: AreaOutline, [x, y]: PicturePoint): PicturePoint {
  const radians = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(radians), Math.sin(radians)];
  const [dx, dy] = [x - centre[0], y - centre[1]];
  return [dx * c + dy * s, -dx * s + dy * c];
}

/** A point given along the outline's own axes, about its centre, turned with it onto its units. */
function turned({ centre, angle }: AreaOutline, [x, y]: PicturePoint): PicturePoint {
  const radians = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(radians), Math.sin(radians)];
  return [centre[0] + x * c - y * s, centre[1] + x * s + y * c];
}

/**
 * The point of the ellipse with semi-axes `a` and `b` nearest `point`, both
 * in the first quadrant of its own axes. There is no closed form: from the
 * middle of the quarter, each step takes the arc's centre of curvature at the
 * point it has (on the evolute) and moves the point along the ellipse as far
 * as the press is turned from it about that centre — a few steps converge to
 * well under a millionth of the axes, where Newton's on the angle can wander
 * off near the middle.
 */
function nearestOnEllipse(a: number, b: number, [px, py]: PicturePoint): PicturePoint {
  let [tx, ty] = [Math.SQRT1_2, Math.SQRT1_2];
  for (let step = 0; step < 6; step += 1) {
    const [x, y] = [a * tx, b * ty];
    const ex = ((a * a - b * b) * tx ** 3) / a;
    const ey = ((b * b - a * a) * ty ** 3) / b;
    const [rx, ry] = [x - ex, y - ey];
    const [qx, qy] = [px - ex, py - ey];
    const r = Math.hypot(rx, ry);
    const q = Math.hypot(qx, qy);
    if (!(q > 0)) break;
    tx = Math.min(1, Math.max(0, ((qx * r) / q + ex) / a));
    ty = Math.min(1, Math.max(0, ((qy * r) / q + ey) / b));
    const t = Math.hypot(tx, ty);
    [tx, ty] = [tx / t, ty / t];
  }
  return [a * tx, b * ty];
}

/** How far `point` is from the outline's rim, either side of it: what a press on a shape is taken by. */
export function areaRimDistance(outline: AreaOutline, point: PicturePoint): number {
  const [x, y] = local(outline, point);
  const [a, b] = [outline.size[0] / 2, outline.size[1] / 2];
  const [px, py] = [Math.abs(x), Math.abs(y)];
  if (outline.kind === 'rectangle') {
    const [dx, dy] = [px - a, py - b];
    // Outside: to the nearest side or corner; inside: to the nearest side.
    return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.min(-dx, -dy);
  }
  if (!(a > 0) || !(b > 0)) return Math.hypot(px, py);
  const [nx, ny] = nearestOnEllipse(a, b, [px, py]);
  return Math.hypot(px - nx, py - ny);
}

/** Whether `point` is inside the outline, or on it. */
export function insideArea(outline: AreaOutline, point: PicturePoint): boolean {
  const [x, y] = local(outline, point);
  const [a, b] = [outline.size[0] / 2, outline.size[1] / 2];
  if (outline.kind === 'rectangle') return Math.abs(x) <= a && Math.abs(y) <= b;
  return a > 0 && b > 0 && (x / a) ** 2 + (y / b) ** 2 <= 1;
}

/**
 * The outline as a closed ring of points, turned with it: a rectangle's four
 * corners, clockwise on the page from its top left; an ellipse at `sides`
 * points from the end of its width.
 */
export function areaOutlinePoints(outline: AreaOutline, sides = 96): PicturePoint[] {
  const [a, b] = [outline.size[0] / 2, outline.size[1] / 2];
  if (outline.kind === 'rectangle') {
    const corners: PicturePoint[] = [
      [-a, -b],
      [a, -b],
      [a, b],
      [-a, b],
    ];
    return corners.map((corner) => turned(outline, corner));
  }
  return Array.from({ length: sides }, (_, index) => {
    const t = (2 * Math.PI * index) / sides;
    return turned(outline, [a * Math.cos(t), b * Math.sin(t)]);
  });
}

/**
 * The outline's upright box, `pad` out from it all round — exactly, turned:
 * an ellipse's extents along the page's axes (`√(a²cos² + b²sin²)`), or a
 * rectangle's corners'. With `pad` half a pen it is as far as the stroke
 * reaches: an ellipse's stroke is its outline offset by the half pen either
 * side, a rectangle's, mitred, a rectangle a pen larger.
 */
export function areaBox(outline: AreaOutline, pad = 0): PictureBox {
  const radians = (outline.angle * Math.PI) / 180;
  const [c, s] = [Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians))];
  const [a, b] = [outline.size[0] / 2, outline.size[1] / 2];
  const [hx, hy] =
    outline.kind === 'rectangle'
      ? [(a + pad) * c + (b + pad) * s, (a + pad) * s + (b + pad) * c]
      : [Math.hypot(a * c, b * s) + pad, Math.hypot(a * s, b * c) + pad];
  return { x: outline.centre[0] - hx, y: outline.centre[1] - hy, width: 2 * hx, height: 2 * hy };
}
