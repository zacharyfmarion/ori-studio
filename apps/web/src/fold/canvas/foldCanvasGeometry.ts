/**
 * The geometry the Fold canvas works in (plan D12, D13): the frames a scene
 * is written in, the map onto the renderer's user space, and the few convex
 * polygon and line operations the picking and the tools need.
 *
 * Three frames, all y-up and in units of the sheet's longer side:
 *
 * - **sheet**: the flat sheet, where every anchor a step stores lives;
 * - **model**: the folded form as the engine folds it, before the view;
 * - **scene**: the model seen through the view (turned over, rotated),
 *   which is what the folded pane draws and picks in. The scene's
 *   `view_transform` is model → scene; each face's `face_transforms` entry is
 *   sheet → scene.
 *
 * Both panes draw into the renderer's user space through
 * {@link foldUnitToUser}: one unit is the width Edit's canvas gives its paper
 * (`CP_PAPER_RECT`), and y flips, so 100% zoom shows a Fold sheet at the size
 * an Edit sheet is shown, and the user's snap radius — measured on Edit's
 * 400-unit paper — is the same share of the sheet here
 * ({@link FOLD_UNITS_PER_CP_UNIT}).
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../lib/geometry';
import { CP_PAPER_RECT, ORIEDITA_PAPER_SIZE } from '../../lib/creasePatternViewport';
import type { ScenePoint } from '../../lib/paper/paperScene';
import type { FoldModelLine } from '../document/foldSequenceDocument';
import type { FoldIsometry } from '../engine/foldEngineWire';

/** User-space units per sheet unit: the width Edit's canvas draws its paper at. */
export const FOLD_USER_PER_UNIT = CP_PAPER_RECT.width;

/**
 * Sheet units per Edit model unit. A hit radius `cpHitRadiusModel` answers in
 * Edit's units, which measure a 400-unit paper; times this, it is the same
 * share of a Fold sheet, so a click is as forgiving on both canvases.
 */
export const FOLD_UNITS_PER_CP_UNIT = 1 / ORIEDITA_PAPER_SIZE;

/** A pane's frame (scene or sheet) → the renderer's user space: scaled, y down. */
export function foldUnitToUser(point: Point): Point {
  return { x: point.x * FOLD_USER_PER_UNIT, y: -point.y * FOLD_USER_PER_UNIT };
}

/** The same map, for a point a paper scene is built from. */
export function foldUnitToScenePx(point: Point): ScenePoint {
  return [point.x * FOLD_USER_PER_UNIT, -point.y * FOLD_USER_PER_UNIT];
}

export function toPoint([x, y]: readonly [number, number]): Point {
  return { x, y };
}

export function toPair({ x, y }: Point): [number, number] {
  return [x, y];
}

// ---------------------------------------------------------------------------
// Isometries

export function applyIsometry([a, b, c, d, e, f]: FoldIsometry, { x, y }: Point): Point {
  return { x: a * x + b * y + c, y: d * x + e * y + f };
}

/** The inverse of an isometry: its linear part is orthogonal, so the inverse is its transpose. */
export function invertIsometry([a, b, c, d, e, f]: FoldIsometry): FoldIsometry {
  // For an orthogonal matrix the inverse is the transpose; a reflection's
  // determinant is −1, and the transpose is still its inverse.
  return [a, d, -(a * c + d * f), b, e, -(b * c + e * f)];
}

/** A line's image under an isometry: `n` turns with the linear part, `d` follows a point on the line. */
export function transformLine(iso: FoldIsometry, line: FoldModelLine): FoldModelLine {
  const [a, b, , d, e] = iso;
  const n = { x: a * line.n[0] + b * line.n[1], y: d * line.n[0] + e * line.n[1] };
  const on = applyIsometry(iso, { x: line.n[0] * line.d, y: line.n[1] * line.d });
  return { n: [n.x, n.y], d: n.x * on.x + n.y * on.y };
}

/** A model-frame line — the engine's — as the scene shows it: `view_transform` is model → scene. */
export function sceneLineOf(viewTransform: FoldIsometry, modelLine: FoldModelLine): FoldModelLine {
  return transformLine(viewTransform, modelLine);
}

/** A scene line in the model frame, where the engine takes lines (a cross-section's, an analysis's). */
export function modelLineOf(viewTransform: FoldIsometry, sceneLine: FoldModelLine): FoldModelLine {
  return transformLine(invertIsometry(viewTransform), sceneLine);
}

// ---------------------------------------------------------------------------
// Lines

/** The line through two points with a unit normal, or null when they coincide. */
export function lineThrough(p: Point, q: Point): FoldModelLine | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-12)) return null;
  // The normal points to the left of p → q.
  const n: [number, number] = [-dy / length, dx / length];
  return { n, d: n[0] * p.x + n[1] * p.y };
}

/** Signed distance from the line: positive on its normal's side. */
export function sideOf(line: FoldModelLine, { x, y }: Point): number {
  return line.n[0] * x + line.n[1] * y - line.d;
}

/** The line with its normal turned round: the same points, the other side positive. */
export function flipLine(line: FoldModelLine): FoldModelLine {
  return { n: [-line.n[0], -line.n[1]], d: -line.d };
}

/** The line's direction, a quarter turn clockwise from its normal. */
export function lineDirection(line: FoldModelLine): Point {
  return { x: line.n[1], y: -line.n[0] };
}

/** Where along the line's direction a point lies, from the line's foot of the origin. */
export function alongLine(line: FoldModelLine, point: Point): number {
  const u = lineDirection(line);
  return u.x * point.x + u.y * point.y;
}

/** The point at parameter `t` along the line. */
export function pointOnLine(line: FoldModelLine, t: number): Point {
  const u = lineDirection(line);
  return { x: line.n[0] * line.d + u.x * t, y: line.n[1] * line.d + u.y * t };
}

/** The nearest point of the segment a–b to `p`. */
export function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  if (length2 <= 0) return a;
  const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2));
  return { x: a.x + dx * t, y: a.y + dy * t };
}

// ---------------------------------------------------------------------------
// Convex polygons (counter-clockwise, as the engine writes them)

export function polygonArea(polygon: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

export function polygonCentroid(polygon: readonly Point[]): Point {
  let cx = 0;
  let cy = 0;
  let twice = 0;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const cross = a.x * b.y - b.x * a.y;
    twice += cross;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  if (Math.abs(twice) < 1e-18) {
    // A degenerate ring: the mean of its corners.
    const n = Math.max(1, polygon.length);
    return {
      x: polygon.reduce((sum, p) => sum + p.x, 0) / n,
      y: polygon.reduce((sum, p) => sum + p.y, 0) / n,
    };
  }
  return { x: cx / (3 * twice), y: cy / (3 * twice) };
}

/** The convex point test, shared with the stack hit index Fold's picking reads. */
export { insideConvex } from '../../cp-workspace/picking/polygonContains';

/** The part of a convex polygon on the side of `line` where `sideOf` has sign `keep`. */
export function clipConvex(polygon: readonly Point[], line: FoldModelLine, keep: 1 | -1): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const sa = keep * sideOf(line, a);
    const sb = keep * sideOf(line, b);
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/**
 * Where a line crosses a convex polygon, as parameters along it
 * ({@link alongLine}); null when it misses or only touches a corner.
 */
export function chordOfConvex(polygon: readonly Point[], line: FoldModelLine): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const sa = sideOf(line, a);
    const sb = sideOf(line, b);
    const take = (p: Point) => {
      const t = alongLine(line, p);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    };
    if (sa === 0) take(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      take({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return hi - lo > 1e-12 ? [lo, hi] : null;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box round some points; null when there are none. */
export function boundsOf(points: Iterable<Point>): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** A pane's bounds in user space, which flips y. */
export function boundsToUser(bounds: Bounds): Bounds {
  const a = foldUnitToUser({ x: bounds.minX, y: bounds.minY });
  const b = foldUnitToUser({ x: bounds.maxX, y: bounds.maxY });
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}
