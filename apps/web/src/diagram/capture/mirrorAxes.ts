/**
 * A flat fold's mirror axes, and the turn that stands it upright on one
 * (Zach, 2026-10-05: "I basically want the axis of symmetry to be upright").
 *
 * Measured on the fold — the kernel's folded faces before any turn or spread
 * — never on its drawing: a spread is not symmetric (an affine one pulls the
 * layers toward where they lie on the sheet), so on the drawing the crane's
 * axis is 0.4° off; on the fold it is exact.
 *
 * Angles are degrees from +x on the page, y down, as `turnClockwise` turns
 * them: a turn of r carries a direction at α to α + r.
 *
 * Pure: no DOM, no store.
 */
import type { Point } from '../../lib/geometry';
import type { FoldedPicture } from '../../lib/creaseExportFold';

/** How far apart two points may be and still be one, as a share of the outline's extent. */
const SAME_POINT = 1e-6;

/** How near a turn must be to an upright one to stand on it: a press there takes the other way up. */
const ON_UPRIGHT_DEG = 0.05;

const norm180 = (degrees: number) => ((degrees % 180) + 180) % 180;
const norm360 = (degrees: number) => ((degrees % 360) + 360) % 360;
/** How far apart two turns are, the short way round. */
const apart = (a: number, b: number) => Math.abs(norm360(a - b + 180) - 180);

/**
 * The lines `points` are symmetric about, as directions in [0°, 180°): each
 * passes through their centroid and maps every point onto one of them. Any
 * mirror maps the points farthest from the centroid among themselves, so the
 * candidates are the lines that take the first of them onto each of the
 * others (or through it), each then checked against every point. None for
 * fewer than two distinct points.
 */
export function mirrorAxes(points: readonly Point[]): number[] {
  if (points.length < 2) return [];
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
  const extent = Math.max(maxX - minX, maxY - minY);
  if (!(extent > 0)) return [];
  const tolerance = extent * SAME_POINT;
  const grid = pointGrid(points, tolerance);
  const distinct = grid.points;
  if (distinct.length < 2) return [];
  const cx = distinct.reduce((sum, p) => sum + p.x, 0) / distinct.length;
  const cy = distinct.reduce((sum, p) => sum + p.y, 0) / distinct.length;
  const reach = (p: Point) => Math.hypot(p.x - cx, p.y - cy);
  const farthest = Math.max(...distinct.map(reach));
  if (!(farthest > tolerance)) return [];
  const rim = distinct.filter((p) => reach(p) > farthest - tolerance * 4);
  const first = rim[0]!;
  const candidates: number[] = [];
  for (const q of rim) {
    const dx = q.x - first.x;
    const dy = q.y - first.y;
    // Onto another rim point: the line between them, turned a quarter; onto itself: the line through it.
    const along = Math.hypot(dx, dy) > tolerance ? Math.atan2(dy, dx) + Math.PI / 2 : Math.atan2(first.y - cy, first.x - cx);
    candidates.push(norm180((along * 180) / Math.PI));
  }
  const axes: number[] = [];
  for (const axis of candidates.sort((a, b) => a - b)) {
    if (axes.some((kept) => apart(kept * 2, axis * 2) < 1e-6)) continue;
    if (mapsOntoItself(distinct, grid, cx, cy, axis, tolerance)) axes.push(axis);
  }
  return axes;
}

/** Whether the mirror in the line through (cx, cy) at `axis` maps every point onto one of them. */
function mapsOntoItself(
  points: readonly Point[],
  grid: PointGrid,
  cx: number,
  cy: number,
  axis: number,
  tolerance: number
): boolean {
  const radians = (axis * Math.PI) / 180;
  const ux = Math.cos(radians);
  const uy = Math.sin(radians);
  return points.every(({ x, y }) => {
    const dx = x - cx;
    const dy = y - cy;
    const along = dx * ux + dy * uy;
    return grid.has(cx + 2 * along * ux - dx, cy + 2 * along * uy - dy, tolerance * 8);
  });
}

interface PointGrid {
  /** One of each point, those within the tolerance of another taken as it. */
  points: Point[];
  /** Whether a point lies within `within` of (x, y). */
  has: (x: number, y: number, within: number) => boolean;
}

/** `points` bucketed by a cell the size of the tolerance's search, for nearest checks in constant time. */
function pointGrid(points: readonly Point[], tolerance: number): PointGrid {
  const cell = tolerance * 16;
  const buckets = new Map<string, Point[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  const near = (x: number, y: number, within: number) => {
    const i = Math.floor(x / cell);
    const j = Math.floor(y / cell);
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        for (const p of buckets.get(key(i + di, j + dj)) ?? []) {
          if (Math.hypot(p.x - x, p.y - y) <= within) return p;
        }
      }
    }
    return null;
  };
  const distinct: Point[] = [];
  for (const point of points) {
    if (near(point.x, point.y, tolerance)) continue;
    distinct.push(point);
    const bucket = key(Math.floor(point.x / cell), Math.floor(point.y / cell));
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), point]);
  }
  return { points: distinct, has: (x, y, within) => near(x, y, within) !== null };
}

/**
 * The turn that stands a fold upright: one of its mirror axes vertical. Each
 * axis stands two ways, half a turn apart; a press takes the one nearest the
 * turn the step has, and a press on an upright turn takes the same axis the
 * other way up. Kept to a thousandth of a degree. Null for a fold with no
 * mirror axis.
 */
export function uprightTurn(axes: readonly number[], current: number): number | null {
  if (axes.length === 0) return null;
  const turns = axes.flatMap((axis) => {
    const up = norm360(90 - axis);
    return [up, norm360(up + 180)];
  });
  const on = turns.find((turn) => apart(turn, current) < ON_UPRIGHT_DEG);
  const chosen =
    on !== undefined
      ? norm360(on + 180)
      : turns.reduce((best, turn) => (apart(turn, current) < apart(best, current) ? turn : best));
  return norm360(Math.round(chosen * 1000) / 1000);
}

const folds = new WeakMap<FoldedPicture, number[]>();

/**
 * A folded figure's mirror axes, unturned: measured on its faces' corners and
 * the points a third of the way along their edges from either end, so a fold
 * whose corners alone would match — a square with one diagonal crease, whose
 * mirror would need the other — is not taken for symmetric. Read once per
 * figure read. None for a figure the kernel drew only as its development
 * (`scene` null).
 */
export function foldedMirrorAxes(read: FoldedPicture): number[] {
  const known = folds.get(read);
  if (known) return known;
  const points: Point[] = [];
  for (const face of read.scene?.faces ?? []) {
    const ring = face.outline;
    ring.forEach((point, index) => {
      const next = ring[(index + 1) % ring.length]!;
      const along = (t: number): Point => ({ x: point.x + (next.x - point.x) * t, y: point.y + (next.y - point.y) * t });
      points.push(point, along(1 / 3), along(2 / 3));
    });
  }
  const axes = mirrorAxes(points);
  folds.set(read, axes);
  return axes;
}
