import type { Point } from './geometry';

/**
 * Geometry for the length-faithful BP tree editor: leaves are added at a fixed
 * length from their parent, and dragging rotates a vertex (and its subtree)
 * rigidly around its parent so every edge keeps its length.
 */

/** Location for a new unit-length leaf on `parent`, pointing toward `toward`. */
export function unitLeafLocation(parent: Point, toward: Point, length = 1): Point {
  const dx = toward.x - parent.x;
  const dy = toward.y - parent.y;
  const dist = Math.hypot(dx, dy);
  const dir = dist < 1e-6 ? { x: 0, y: -1 } : { x: dx / dist, y: dy / dist };
  return { x: parent.x + dir.x * length, y: parent.y + dir.y * length };
}

/**
 * Rigidly rotate `points` around `pivot` by the angle that takes `from` to `to`
 * (both measured relative to `pivot`). Distances to the pivot are preserved.
 */
export function rotatePointsAround(
  pivot: Point,
  from: Point,
  to: Point,
  points: Iterable<readonly [number, Point]>
): Map<number, Point> {
  const oldAngle = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const newAngle = Math.atan2(to.y - pivot.y, to.x - pivot.x);
  const delta = newAngle - oldAngle;
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const out = new Map<number, Point>();
  for (const [id, point] of points) {
    const ox = point.x - pivot.x;
    const oy = point.y - pivot.y;
    out.set(id, { x: pivot.x + ox * cos - oy * sin, y: pivot.y + ox * sin + oy * cos });
  }
  return out;
}

/** Rigidly translate `points` by `to - from`. */
export function translatePoints(
  from: Point,
  to: Point,
  points: Iterable<readonly [number, Point]>
): Map<number, Point> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const out = new Map<number, Point>();
  for (const [id, point] of points) out.set(id, { x: point.x + dx, y: point.y + dy });
  return out;
}
