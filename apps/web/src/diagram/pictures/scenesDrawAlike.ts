/**
 * Whether two stored scenes draw the same picture, to within what no one could
 * see: every point of each — a corner of a piece, an end of a line — lies
 * within {@link DRAWN_ALIKE_WITHIN} of the picture's longer side of the other's
 * drawing (its pieces' edges and its lines).
 *
 * Compared by what is drawn, not item by item: a spread picture is clipped,
 * and the least change of its heights gains or loses a sliver piece, so two
 * drawings of one picture seldom have the same items. A sliver lies along
 * edges the other drawing has, which this reads as the same.
 *
 * Pure: no DOM, no store.
 */
import { distanceToSegment } from '../../lib/geometry';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { storedSceneStep } from '../capture/captureGeometry';

/**
 * How far apart two drawings of one picture may lie, as a share of its longer
 * side. Measured on 14 models (`implementation-plans/spread-equal-opening.md`):
 * an Update that keeps a Perspective 3D picture moves it at most 5.7e-5, while
 * the same step drawn without the no-stretch shift, as 0.9 drew it, lies
 * 1.4e-3 to 9.8e-3 off at 25% and up.
 */
export const DRAWN_ALIKE_WITHIN = 2e-4;

type Segment = readonly [ScenePoint, ScenePoint];

function drawingOf(scene: PaperScene): { points: ScenePoint[]; segments: Segment[] } {
  const points: ScenePoint[] = [];
  const segments: Segment[] = [];
  for (const item of scene.items) {
    if (item.kind === 'face') {
      for (const ring of item.rings) {
        ring.forEach((point, k) => {
          points.push(point);
          segments.push([point, ring[(k + 1) % ring.length]!]);
        });
      }
    } else if (item.kind === 'line') {
      points.push(item.a, item.b);
      segments.push([item.a, item.b]);
    }
  }
  return { points, segments };
}

/** Whether each of `points` lies within `within` of one of `segments`, looked up in squares of `cell`, no smaller than `within`. */
function allNear(points: readonly ScenePoint[], segments: readonly Segment[], within: number, cell: number): boolean {
  const grid = new Map<string, Segment[]>();
  for (const segment of segments) {
    const [[ax, ay], [bx, by]] = segment;
    for (let i = Math.floor(Math.min(ax, bx) / cell); i <= Math.floor(Math.max(ax, bx) / cell); i += 1) {
      for (let j = Math.floor(Math.min(ay, by) / cell); j <= Math.floor(Math.max(ay, by) / cell); j += 1) {
        const key = `${i},${j}`;
        const near = grid.get(key);
        if (near) near.push(segment);
        else grid.set(key, [segment]);
      }
    }
  }
  return points.every((point) => {
    const [i, j] = [Math.floor(point[0] / cell), Math.floor(point[1] / cell)];
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        for (const [a, b] of grid.get(`${i + di},${j + dj}`) ?? []) if (distanceToSegment(point, a, b) <= within) return true;
      }
    }
    return false;
  });
}

export function scenesDrawAlike(a: PaperScene, b: PaperScene): boolean {
  const longer = Math.max(a.bounds.maxX - a.bounds.minX, a.bounds.maxY - a.bounds.minY, 0);
  // Never under a few of the stored grid's steps: each drawing's points are rounded to it.
  const within = Math.max(DRAWN_ALIKE_WITHIN * longer, 4 * storedSceneStep(a.sheet));
  const cell = Math.max(within, longer / 128);
  const [first, second] = [drawingOf(a), drawingOf(b)];
  return allNear(first.points, second.segments, within, cell) && allNear(second.points, first.segments, within, cell);
}
