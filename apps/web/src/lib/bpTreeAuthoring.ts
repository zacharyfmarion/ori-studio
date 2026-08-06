import { axisDirection, type SymmetryAxis } from './symmetryGeometry';
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
 * The shortest signed rotation about `pivot` that takes `from` onto `to`.
 *
 * Normalized to (-π, π]: the raw difference of two `atan2` results spans
 * (-2π, 2π), so a drag that crosses the branch cut reports a nearly-full turn in
 * the opposite direction. The rotation it describes is the same either way — but
 * anything that reasons about *how far* the drag has turned, such as
 * {@link clampRotationToMirror}, needs the short way round.
 */
export function rotationBetween(pivot: Point, from: Point, to: Point): number {
  const oldAngle = Math.atan2(from.y - pivot.y, from.x - pivot.x);
  const newAngle = Math.atan2(to.y - pivot.y, to.x - pivot.x);
  return normalizeSignedAngle(newAngle - oldAngle);
}

/** Rigidly rotate `points` about `pivot` by `delta` radians. */
export function rotatePointsBy(
  pivot: Point,
  delta: number,
  points: Iterable<readonly [number, Point]>
): Map<number, Point> {
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
  return rotatePointsBy(pivot, rotationBetween(pivot, from, to), points);
}

/** To (-π, π] — the short way round. */
function normalizeSignedAngle(angle: number): number {
  const wrapped = ((angle % TAU) + TAU) % TAU;
  return wrapped > Math.PI ? wrapped - TAU : wrapped;
}

/** To [0, 2π) — how far you travel going one way. */
function forwardAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

const TAU = Math.PI * 2;

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

export interface BpTreeDragMirror {
  /** The line the held vertices may not cross. */
  axis: SymmetryAxis;
  /**
   * How close a held vertex may come to the line, in tree units.
   *
   * Not zero: a vertex *on* the mirror is at the same point as its reflection,
   * so a pair that reached the line would be two nodes stacked on one spot —
   * and one that far in also reads as on-axis, which is how the pairing decides
   * a vertex is its own mirror. Stopping outside that band keeps a pair two
   * distinct nodes on two distinct sides.
   */
  clearance: number;
  /**
   * Vertices in the dragged subtree that must stay in their own half.
   *
   * A vertex whose partner is being mirrored across the axis cannot cross it:
   * the two would swap sides, which reads as the drawing turning inside out.
   * Vertices with no partner, and vertices whose partner is itself in the
   * dragged subtree (so the pair moves rigidly together), are not held.
   */
  heldIds: ReadonlySet<number>;
}

export interface BpTreeDragInput {
  /** The vertex under the cursor. */
  vertexId: number;
  /** Its parent, or null when it is the root. */
  parentId: number | null;
  /** Every vertex in the tree, by id. */
  vertices: ReadonlyMap<number, Point>;
  /** `vertexId` and everything hanging below it. */
  subtreeIds: readonly number[];
  /** Where the dragged vertex started, and where the cursor wants it. */
  start: Point;
  target: Point;
  /** Absent when nothing in the subtree is paired. */
  mirror?: BpTreeDragMirror | null;
}

/**
 * How far this point may rotate about `pivot` in `direction` before it reaches
 * the mirror, in radians. `Infinity` when its circle never meets the line.
 *
 * A rotating point traces a circle, so its signed distance from the axis is
 * `d(pivot) + r·cos(φ - ψ)` — where ψ is the axis normal's angle. That is zero
 * at two angles, and rotating from a valid start the first one reached is the
 * edge of the half the point is currently in.
 */
function rotationToMirror(
  pivot: Point,
  point: Point,
  axis: SymmetryAxis,
  direction: 1 | -1,
  clearance: number
): number {
  const radius = Math.hypot(point.x - pivot.x, point.y - pivot.y);
  if (radius < 1e-9) return Number.POSITIVE_INFINITY;
  const normal = axisDirection({ ...axis, angle: axis.angle + 90 });
  const distanceFromAxis = (p: Point) =>
    (p.x - axis.loc.x) * normal.x + (p.y - axis.loc.y) * normal.y;
  // The wall sits `clearance` short of the line, in the half the point is in.
  const side = distanceFromAxis(point) < 0 ? -1 : 1;
  const cosine = (side * clearance - distanceFromAxis(pivot)) / radius;
  // The circle stays wholly on one side, so no rotation can take it across.
  if (Math.abs(cosine) > 1) return Number.POSITIVE_INFINITY;
  const half = Math.acos(cosine);
  const normalAngle = Math.atan2(normal.y, normal.x);
  const current = Math.atan2(point.y - pivot.y, point.x - pivot.x);
  return Math.min(
    forwardAngle(direction * (normalAngle + half - current)),
    forwardAngle(direction * (normalAngle - half - current))
  );
}

/**
 * Narrow a rotation so no held vertex crosses the mirror.
 *
 * Clamped rather than solved: the rotation is swept from where it is now — which
 * is valid — toward what the cursor asked for, and stopped at the first vertex
 * that would reach the line. That is the "slide until it hits the wall"
 * behaviour a drag wants, and it sidesteps the fact that the set of angles
 * satisfying every held vertex at once can be disconnected.
 */
export function clampRotationToMirror(
  delta: number,
  pivot: Point,
  points: Iterable<readonly [number, Point]>,
  mirror: BpTreeDragMirror
): number {
  if (delta === 0) return delta;
  const direction = delta > 0 ? 1 : -1;
  let limit = Math.abs(delta);
  for (const [id, point] of points) {
    if (!mirror.heldIds.has(id)) continue;
    limit = Math.min(
      limit,
      rotationToMirror(pivot, point, mirror.axis, direction, mirror.clearance)
    );
  }
  return direction * limit;
}

/**
 * Every vertex a drag moves, and where to.
 *
 * The rule this encodes: **dragging a vertex rotates it and its subtree about
 * its parent**, so no edge ever changes length. It is a pure function so the
 * live preview and the committed move are the same computation rather than two
 * copies that can drift apart.
 *
 * The root has no parent to rotate about, so it does not move. Sliding it alone
 * would stretch every edge below it, and sliding the tree with it only shifts
 * a drawing the optimizer is free to place anywhere.
 *
 * Returns an empty map when the drag can't be resolved (the root, or an unknown
 * parent), which reads at the call site as "this drag moves nothing".
 */
export function bpTreeDragUpdates(input: BpTreeDragInput): Map<number, Point> {
  const { vertexId, parentId, vertices, subtreeIds, start, target } = input;

  if (parentId === null) return new Map();

  const pivot = vertices.get(parentId);
  if (!pivot) return new Map();

  const subtree = subtreeIds.flatMap((id) => {
    const loc = vertices.get(id);
    return loc ? [[id, loc] as const] : [];
  });
  // The dragged vertex must be in the set it rotates with, or the cursor would
  // pull the subtree while leaving the grabbed vertex behind.
  if (!subtree.some(([id]) => id === vertexId)) return new Map();

  const requested = rotationBetween(pivot, start, target);
  const delta = input.mirror
    ? clampRotationToMirror(requested, pivot, subtree, input.mirror)
    : requested;
  return rotatePointsBy(pivot, delta, subtree);
}
