/**
 * Whether a point lies in a polygon: the two tests a hit test over folded
 * paper needs, and the check that picks between them.
 *
 * - {@link insideConvex} is the fast one, for a convex polygon. It is Fold's
 *   own test, unchanged: Fold's overlay cells are convex by construction.
 * - {@link insideEvenOdd} takes any ring. Oriedita's subfaces need not be
 *   convex: a sheet with a notch or a window in it folds to cells that bend
 *   round it.
 * - {@link isConvexPolygon} says which of the two a ring may take.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../lib/geometry';
import { distanceToSegment } from './lineHitIndex';

/**
 * Whether `p` is inside a convex polygon, or within `epsilon` of it. Either
 * winding: a point is inside when it is on one side of every edge.
 */
export function insideConvex(polygon: readonly Point[], p: Point, epsilon = 0): boolean {
  let sign = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const cross = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length;
    if (Math.abs(cross) <= epsilon) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Whether `p` is inside a polygon by the even-odd rule, or within `epsilon` of
 * its outline (a point on the outline is inside, as {@link insideConvex} has
 * it). Any ring, convex or not; one that crosses itself holds what it winds
 * round an odd number of times.
 */
export function insideEvenOdd(polygon: readonly Point[], p: Point, epsilon = 0): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  if (inside) return true;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    if (distanceToSegment(p.x, p.y, polygon[j]!, polygon[i]!) <= epsilon) return true;
  }
  return false;
}

/** How small a turn, or a step along an axis, counts as none: a share of the polygon's extent. */
const STRAIGHT = 1e-12;

/**
 * Whether {@link insideConvex} is right for a polygon: every corner turns the
 * same way, and the outline goes round once. Corners along a side, repeated
 * corners and a polygon with no area (no turn at all) pass; so does one of
 * fewer than three corners, which holds no area to test.
 *
 * Going round once is checked by the edges' directions: a convex outline's
 * edges change their x direction twice and their y direction twice. A star
 * whose corners all turn one way goes round twice, and fails.
 */
export function isConvexPolygon(polygon: readonly Point[]): boolean {
  const n = polygon.length;
  if (n < 3) return true;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  const step = STRAIGHT * span;
  const flat = STRAIGHT * span * span;
  let turn = 0;
  const flips = { x: 0, y: 0 };
  const first = { x: 0, y: 0 };
  const last = { x: 0, y: 0 };
  const along = (axis: 'x' | 'y', delta: number) => {
    if (Math.abs(delta) <= step) return;
    const sign = Math.sign(delta);
    if (first[axis] === 0) first[axis] = sign;
    else if (sign !== last[axis]) flips[axis] += 1;
    last[axis] = sign;
  };
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    const c = polygon[(i + 2) % n]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > flat) {
      const sign = Math.sign(cross);
      if (turn === 0) turn = sign;
      else if (sign !== turn) return false;
    }
    along('x', b.x - a.x);
    along('y', b.y - a.y);
  }
  // Round the corner from the last edge back to the first.
  for (const axis of ['x', 'y'] as const) {
    if (first[axis] !== 0 && first[axis] !== last[axis]) flips[axis] += 1;
  }
  return flips.x <= 2 && flips.y <= 2;
}
