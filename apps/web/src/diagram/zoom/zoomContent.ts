/**
 * What of an enlarged step's window a page gives room to (Revision 2, "Page
 * layout and scale"): its content box.
 *
 * - A frame drawn **Whole** is all of its window: its outline prints, round
 *   whatever lies inside it.
 * - A **Cut** frame prints only the paper inside it and the pieces of its
 *   boundary where it crosses that paper, each run on by its overshoot — so
 *   the empty, off-paper part of a circle round a flap's tip takes no room,
 *   and the step fills its cell with what it shows. A cut frame that draws
 *   closed (it lies over paper) is its whole window again.
 *
 * The box is in the window's own units — its longer side one, from its
 * top-left corner — which is what the page lays an enlarged step out in.
 *
 * Pure: no DOM, no store; a memo per paper silhouette.
 */
import type { PicturePoint } from '../annotate/annotationModel';
import type { PictureCover } from '../annotate/pictureGeometry';
import { zoomBoundary } from './paintZoomed';
import type { StepZoomView } from './stepView';
import { zoomEdgeRing, type ZoomStretch } from './zoomEdge';
import { intoBox } from './zoomFrames';
import { zoomOutlinePoints, type PictureBox } from './zoomModel';

/** The points round a corner, or a circle's sides, the frame's inside is clipped to: finer than the edge needs. */
const CLIP_SIDES = 96;
const CLIP_PER_CORNER = 12;

const known = new WeakMap<readonly PictureCover[], Map<string, PictureBox>>();
const KEPT = 32;

/**
 * An enlarged step's content box, in its window's units, its window printed
 * `printedMm` across its longer side — what the overshoot of a cut frame's
 * pieces is measured at. `silhouette` is the step's paper (`paperSilhouette`),
 * null for a picture with none, which draws its frame whole.
 */
export function zoomContentBox(view: StepZoomView, silhouette: readonly PictureCover[] | null, printedMm: number): PictureBox {
  const whole = windowInUnits(view.window);
  if (!silhouette) return whole;
  let byFrame = known.get(silhouette);
  if (!byFrame) {
    byFrame = new Map();
    known.set(silhouette, byFrame);
  }
  const key = JSON.stringify([view.frame, view.zoom.shape, view.zoom.edge ?? null, Math.round(printedMm * 100) / 100]);
  const hit = byFrame.get(key);
  if (hit) return hit;
  const box = contentBox(view, silhouette, printedMm) ?? whole;
  byFrame.set(key, box);
  if (byFrame.size > KEPT) byFrame.delete(byFrame.keys().next().value!);
  return box;
}

function contentBox(view: StepZoomView, silhouette: readonly PictureCover[], printedMm: number): PictureBox | null {
  const drawn = zoomBoundary(view, silhouette, printedMm);
  if (drawn.kind === 'whole') return null;
  const points: PicturePoint[] = [...paperInside(view, silhouette)];
  if (drawn.kind === 'stretches') points.push(...stretchPoints(zoomEdgeRing(view.frame), drawn.stretches));
  // A frame over no paper draws nothing: it keeps its window, as the frame it is.
  if (points.length === 0) return null;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const point of points) {
    const [x, y] = intoBox(view.window, point);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  // Never past the window: what the frame clips cannot reach out of it.
  const window = windowInUnits(view.window);
  const [left, top] = [Math.max(minX, 0), Math.max(minY, 0)];
  const [right, bottom] = [Math.min(maxX, window.width), Math.min(maxY, window.height)];
  if (!(right > left) || !(bottom > top)) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** The window as a box in its own units: its longer side one. */
function windowInUnits(window: PictureBox): PictureBox {
  const longer = Math.max(window.width, window.height);
  return longer > 0 ? { x: 0, y: 0, width: window.width / longer, height: window.height / longer } : { x: 0, y: 0, width: 1, height: 1 };
}

/** The corners of the paper inside the frame, in picture units: each face near it clipped to the frame's outline. */
function paperInside(view: StepZoomView, silhouette: readonly PictureCover[]): PicturePoint[] {
  const clip = zoomOutlinePoints(view.frame, CLIP_SIDES, CLIP_PER_CORNER);
  const turn = Math.sign(signedArea(clip)) || 1;
  const { x, y, width, height } = view.window;
  const points: PicturePoint[] = [];
  for (const { ring, box } of silhouette) {
    if (box[0] > x + width || box[2] < x || box[1] > y + height || box[3] < y) continue;
    points.push(...clipToConvex(ring, clip, turn));
  }
  return points;
}

/** Twice a ring's signed area, its points' order on the page: the side its inside is on. */
function signedArea(ring: readonly PicturePoint[]): number {
  let sum = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [a, b] = [ring[index]!, ring[(index + 1) % ring.length]!];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return sum;
}

/**
 * A polygon cut to a convex one (Sutherland–Hodgman): what of `subject` lies
 * inside `clip`, whose inside is on the `turn` side of each of its edges.
 * Only its corners are wanted, for a box, so a concave subject's seams along
 * the clip's edges do no harm.
 */
function clipToConvex(subject: readonly PicturePoint[], clip: readonly PicturePoint[], turn: number): PicturePoint[] {
  let output: PicturePoint[] = [...subject];
  for (let index = 0; index < clip.length && output.length > 0; index += 1) {
    const [a, b] = [clip[index]!, clip[(index + 1) % clip.length]!];
    const side = (p: PicturePoint) => turn * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const input = output;
    output = [];
    for (let at = 0; at < input.length; at += 1) {
      const [p, q] = [input[at]!, input[(at + 1) % input.length]!];
      const [sp, sq] = [side(p), side(q)];
      if (sp >= 0) output.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return output;
}

/** The points of a closed ring along each stretch of it (shares of its length from its first point): its ends and its corners between. */
function stretchPoints(ring: readonly PicturePoint[], stretches: readonly ZoomStretch[]): PicturePoint[] {
  const at: number[] = [0];
  let total = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [a, b] = [ring[index]!, ring[(index + 1) % ring.length]!];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
    at.push(total);
  }
  if (!(total > 0)) return [];
  const shares = at.map((length) => length / total);
  const pointAt = (share: number): PicturePoint => {
    const wrapped = share - Math.floor(share);
    let side = 0;
    while (side + 1 < shares.length - 1 && shares[side + 1]! < wrapped) side += 1;
    const run = shares[side + 1]! - shares[side]!;
    const t = run > 0 ? (wrapped - shares[side]!) / run : 0;
    const [a, b] = [ring[side]!, ring[(side + 1) % ring.length]!];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const points: PicturePoint[] = [];
  for (const [from, to] of stretches) {
    points.push(pointAt(from), pointAt(to));
    ring.forEach((point, index) => {
      const share = shares[index]!;
      if ((share > from && share < to) || (share + 1 > from && share + 1 < to)) points.push(point);
    });
  }
  return points;
}
