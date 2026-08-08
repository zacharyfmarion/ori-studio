import {
  axisDirection,
  projectOntoSymmetryAxis,
  type SymmetryAxis,
} from '../lib/symmetryGeometry';
import type { Point } from '../lib/geometry';
import {
  subtreeIds,
  type EditableTree,
  type TreeTopology,
  type TreeVertexUpdate,
} from './model';

/**
 * Geometry for a length-faithful tree editor.
 *
 * The rule everything here serves: **dragging a vertex sets both the direction
 * and the length of its edge to the parent**, with its subtree carried rigidly,
 * and the length quantized by whatever the surface says an admissible length is.
 */

/**
 * The moves that keep the drawing faithful when an edge is *typed* to a length
 * rather than dragged to one: re-place the child at `length` units from its
 * parent along the direction it already points, and carry its whole subtree by
 * the same translation so nothing detaches.
 *
 * The same computation whether the edge ends at a leaf or deep inside the tree —
 * a leaf's subtree is just the leaf — so every surface that sets a length by
 * number goes through here, and none of them has to know which case it has.
 *
 * Empty when the edge or either endpoint is missing, which the caller should
 * treat as "set the length and move nothing".
 */
export function edgeLengthRepositions(
  tree: EditableTree,
  topology: TreeTopology,
  edgeId: number,
  length: number
): TreeVertexUpdate[] {
  const edge = tree.edges.find((candidate) => candidate.id === edgeId);
  if (!edge) return [];
  const [a, b] = edge.vertices;
  const childId = topology.parent.get(a) === b ? a : b;
  const parentId = childId === a ? b : a;
  const child = tree.vertices.find((vertex) => vertex.id === childId);
  const parent = tree.vertices.find((vertex) => vertex.id === parentId);
  if (!child || !parent) return [];
  const target = leafLocationAt(parent.loc, child.loc, length);
  const subtree = subtreeIds(topology, childId).flatMap((id) => {
    const vertex = tree.vertices.find((candidate) => candidate.id === id);
    return vertex ? [[id, vertex.loc] as const] : [];
  });
  return [...translatePoints(child.loc, target, subtree)].map(([id, loc]) => ({ id, loc }));
}

/** Location for a new leaf on `parent`, `length` units toward `toward`. */
export function leafLocationAt(parent: Point, toward: Point, length = 1): Point {
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
 * the sweep reasons about *how far* the gesture has turned, and needs the short
 * way round.
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

export interface TreeDragMirror {
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

export interface TreeDragInput {
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
  /** How the dragged edge's length follows the cursor. */
  length: TreeDragLengthRule;
  /** Absent when nothing in the subtree is paired. */
  mirror?: TreeDragMirror | null;
  /**
   * Where the gesture is allowed to put a vertex — box-pleat passes its sheet.
   *
   * A predicate on the *gesture* rather than a clamp on each point, which is
   * what keeps the subtree rigid: clamping points individually silently changed
   * the internal edge lengths of any subtree swung against the sheet edge.
   */
  bounds?: (point: Point) => boolean;
  /**
   * Holds the dragged vertex *on* this line, letting it slide rather than swing.
   *
   * A vertex on the mirror is its own reflection, and a rotate-and-extend drag
   * would take it off the line and break that silently — which is why such a
   * vertex used to be refused a drag outright. Refusing is too strong: every
   * point along the line keeps the invariant, so the gesture becomes a slide.
   *
   * Null for every vertex that is not on the mirror, which is nearly all of
   * them.
   */
  pinToAxis?: SymmetryAxis | null;
}

/** How the dragged edge's length follows the cursor. */
export interface TreeDragLengthRule {
  /** The edge's committed length, which the gesture starts from. */
  current: number;
  min: number;
  max: number | null;
  /** Gap between admissible lengths, or null when any length will do. */
  step: number | null;
  /** Cursor distance from the pivot → an admissible length. */
  quantize: (distance: number) => number;
}

export interface TreeDragResult {
  /** Every vertex the drag moves, and where to. */
  updates: Map<number, Point>;
  /** The length the dragged edge takes. Unchanged when the drag only rotates. */
  length: number;
}

const EMPTY_RESULT = (length: number): TreeDragResult => ({ updates: new Map(), length });

/** Rotate about `pivot` by `angle`, then push out along the rotated direction. */
function rotateAndExtend(
  pivot: Point,
  angle: number,
  extension: number,
  direction: Point,
  points: Iterable<readonly [number, Point]>
): Map<number, Point> {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = extension * direction.x;
  const dy = extension * direction.y;
  const out = new Map<number, Point>();
  for (const [id, point] of points) {
    const ox = point.x - pivot.x;
    const oy = point.y - pivot.y;
    out.set(id, {
      x: pivot.x + ox * cos - oy * sin + dx,
      y: pivot.y + ox * sin + oy * cos + dy,
    });
  }
  return out;
}

/**
 * The largest `t` in [0, 1] the gesture may reach.
 *
 * `t = 0` is the committed state and so is valid by construction; the sweep runs
 * from there toward what the cursor asked for and stops at the first violation.
 * Coarse steps find the interval, then a bisection narrows it.
 *
 * A sweep rather than a solve, because the set of valid (angle, length) pairs is
 * not convex and can be disconnected — the old rule had one degree of freedom
 * and an `acos` for the answer; two degrees of freedom do not.
 */
function largestValidT(isValid: (t: number) => boolean): number {
  if (isValid(1)) return 1;
  const COARSE_STEPS = 16;
  const BISECTIONS = 10;
  let low = 0;
  let high = 1;
  for (let step = 1; step <= COARSE_STEPS; step += 1) {
    const t = step / COARSE_STEPS;
    if (!isValid(t)) {
      high = t;
      low = (step - 1) / COARSE_STEPS;
      break;
    }
    low = t;
  }
  for (let i = 0; i < BISECTIONS; i += 1) {
    const mid = (low + high) / 2;
    if (isValid(mid)) low = mid;
    else high = mid;
  }
  return low;
}

/**
 * Every vertex a drag moves, where to, and what it does to the dragged edge.
 *
 * The rule this encodes: **dragging a vertex sets both the direction and the
 * length of its edge to the parent**, and its whole subtree comes along rigidly.
 * The length is whatever the surface's quantizer makes of the cursor distance —
 * whole grid cells for box-pleat, the distance itself for a surface with no
 * grid. So a flap dragged out past the midpoint becomes longer; one swung around
 * at the same radius just turns.
 *
 * Every edge *inside* the subtree keeps its length (a rotation composed with a
 * translation is an isometry, applied uniformly), and exactly one edge changes:
 * the one being dragged. With the length held fixed it reduces exactly to the
 * rotation-only rule this replaces.
 *
 * A pure function, so the live preview and the committed move are the same
 * computation rather than two copies that can drift apart.
 *
 * The root has no parent to rotate about, so it does not move. Sliding it alone
 * would stretch every edge below it, and sliding the tree with it only shifts a
 * drawing the optimizer is free to place anywhere.
 */
export function treeDragUpdates(input: TreeDragInput): TreeDragResult {
  const { vertexId, parentId, vertices, subtreeIds, start, target, length, bounds } = input;

  if (parentId === null) return EMPTY_RESULT(length.current);

  const pivot = vertices.get(parentId);
  if (!pivot) return EMPTY_RESULT(length.current);

  const subtree = subtreeIds.flatMap((id) => {
    const loc = vertices.get(id);
    return loc ? [[id, loc] as const] : [];
  });
  // The dragged vertex must be in the set it moves with, or the cursor would
  // pull the subtree while leaving the grabbed vertex behind.
  if (!subtree.some(([id]) => id === vertexId)) return EMPTY_RESULT(length.current);

  const startRadius = Math.hypot(start.x - pivot.x, start.y - pivot.y);
  const startAngle = Math.atan2(start.y - pivot.y, start.x - pivot.x);
  const cursorRadius = Math.hypot(target.x - pivot.x, target.y - pivot.y);

  // With the cursor on the pivot the direction is noise, so hold the one the
  // gesture already has rather than snapping somewhere arbitrary.
  const requestedAngle =
    cursorRadius < 1e-9
      ? 0
      : normalizeSignedAngle(Math.atan2(target.y - pivot.y, target.x - pivot.x) - startAngle);
  // Quantized **once**, here. Snapping carries hysteresis, and calling it again
  // from inside the sweep would let a search step move the boundary it is
  // searching against.
  const requested = clampToRule(length.quantize(cursorRadius), length);
  const requestedExtension = requested - startRadius;

  const at = (angle: number, extension: number) => {
    const direction = { x: Math.cos(startAngle + angle), y: Math.sin(startAngle + angle) };
    return rotateAndExtend(pivot, angle, extension, direction, subtree);
  };
  // Bounds are enforced only on vertices that start inside them. A vertex that
  // is already outside — a file drawn against a larger sheet, a tree whose
  // sheet was shrunk under it — was not put there by this gesture, and refusing
  // to move it would leave it stuck there forever.
  const bounded = bounds
    ? subtree.filter(([, point]) => bounds(point)).map(([id]) => id)
    : [];
  const isValid = (moved: Map<number, Point>, enforceMirror = true) => {
    // Finiteness first, and not as paranoia: every other check here is a `<`,
    // and `NaN < anything` is false — so a degenerate state would sail through
    // all of them and be committed as valid.
    for (const point of moved.values()) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
    }
    if (bounds) {
      for (const id of bounded) {
        const point = moved.get(id);
        if (point && !bounds(point)) return false;
      }
    }
    if (!input.mirror || !enforceMirror) return true;
    return heldStaysInPlace(moved, subtree, input.mirror);
  };

  /**
   * The mirror rule is dropped when the committed state already breaks it.
   *
   * `largestValidT` sweeps from `t = 0` assuming that point is valid. If a held
   * vertex starts *inside* the clearance band it is not, so every step of the
   * sweep failed and the answer was `t = 0` — the gesture refused, and refused
   * again next time, with no way for the user to drag out of the state. A rule
   * the current drawing already violates cannot be the thing that decides
   * whether it may be changed. Bounds and finiteness still apply.
   */
  const startsLegal = isValid(at(0, 0));
  const admissible = (moved: Map<number, Point>) => isValid(moved, startsLegal);

  // Pinned to the mirror: a slide, swept like any other gesture.
  //
  // It used to validate the single radius the cursor asked for and give up if
  // that failed, on the reasoning that a slide has no "partway". That was wrong,
  // and wrong in the direction that hurts: a slide is one-dimensional *along the
  // line*, so every shorter radius is a partway and is still on the line. And
  // because both frames clamp the cursor to their bounds, a drag toward the edge
  // of the canvas lands there every time — so a node with anything hanging below
  // it snapped back to where it started rather than stopping at the edge.
  if (input.pinToAxis) {
    const axis = input.pinToAxis;
    const pinned = axisPinnedTip(pivot, target, axis, length);
    if (!pinned) return EMPTY_RESULT(length.current);

    const slideTo = (radius: number) => {
      const tip = axisPointAtRadius(pivot, pinned.tip, axis, radius);
      if (!tip) return null;
      const angle = normalizeSignedAngle(
        Math.atan2(tip.y - pivot.y, tip.x - pivot.x) - startAngle
      );
      return at(angle, radius - startRadius);
    };
    const admissibleAt = (radius: number) => {
      const moved = slideTo(radius);
      return moved !== null && admissible(moved) ? moved : null;
    };

    // Sweep the radius rather than the angle, so every step stays on the line.
    const span = pinned.radius - startRadius;
    const reachedT = largestValidT((step) => admissibleAt(startRadius + span * step) !== null);
    const reachedRadius = startRadius + span * reachedT;
    for (const candidate of lengthCandidates(pinned.radius, reachedRadius, length)) {
      const moved = admissibleAt(candidate);
      if (moved) return { updates: moved, length: candidate };
    }
    return EMPTY_RESULT(length.current);
  }

  const t = largestValidT((step) => admissible(at(requestedAngle * step, requestedExtension * step)));
  const angle = requestedAngle * t;
  const reached = startRadius + requestedExtension * t;

  // The sweep is continuous but the committed length must be admissible, so the
  // achieved radius is snapped back onto the rule — and re-checked, because
  // snapping can push it over the wall the sweep just stopped at. Candidates run
  // from what the user asked for back toward no change at all; every one of them
  // is validated, and the last resort is moving nothing, which always is.
  for (const candidate of lengthCandidates(requested, reached, length)) {
    const moved = at(angle, candidate - startRadius);
    if (admissible(moved)) return { updates: moved, length: candidate };
  }
  return EMPTY_RESULT(length.current);
}

function clampToRule(value: number, rule: TreeDragLengthRule): number {
  return Math.min(rule.max ?? Number.POSITIVE_INFINITY, Math.max(rule.min, value));
}

/**
 * Where a vertex pinned to the axis goes: on the line, at a radius the length
 * rule admits, as near the cursor as both of those allow.
 *
 * One description that covers both surfaces. With continuous lengths every point
 * on the line is admissible, so the vertex tracks the cursor's projection. With
 * whole-number lengths only the radii on the step are, so it steps between them
 * and the packing engine still gets integers.
 *
 * Null when the rule admits no radius that reaches the line at all — a ceiling
 * lower than the pivot's own distance from it. There is no nearby answer to give
 * there, and inventing one would move the vertex off the mirror.
 */
/**
 * The point on `axis` at `radius` from `pivot`, on the same side as `toward`.
 *
 * The slide's parametrization: {@link axisPinnedTip} picks the radius the cursor
 * asked for, and this walks back along the line when that one is out of bounds.
 * Null when the circle of that radius does not reach the line at all.
 */
function axisPointAtRadius(
  pivot: Point,
  toward: Point,
  axis: SymmetryAxis,
  radius: number
): Point | null {
  const foot = projectOntoSymmetryAxis(pivot, axis);
  const offset = Math.hypot(foot.x - pivot.x, foot.y - pivot.y);
  if (radius < offset - 1e-12) return null;
  const along = Math.sqrt(Math.max(0, radius * radius - offset * offset));
  const direction = axisDirection(axis);
  const side =
    (toward.x - foot.x) * direction.x + (toward.y - foot.y) * direction.y >= 0 ? 1 : -1;
  return {
    x: foot.x + side * along * direction.x,
    y: foot.y + side * along * direction.y,
  };
}

export function axisPinnedTip(
  pivot: Point,
  target: Point,
  axis: SymmetryAxis,
  rule: TreeDragLengthRule
): { tip: Point; radius: number } | null {
  // The nearest the vertex can ever come to the pivot while staying on the line.
  const foot = projectOntoSymmetryAxis(pivot, axis);
  const offset = Math.hypot(foot.x - pivot.x, foot.y - pivot.y);

  const wanted = projectOntoSymmetryAxis(target, axis);
  let radius = clampToRule(
    rule.quantize(Math.hypot(wanted.x - pivot.x, wanted.y - pivot.y)),
    rule
  );
  // A radius shorter than that reaches nothing, so walk up to the first
  // admissible one that does — by whole steps where the rule has them.
  if (radius < offset) {
    radius = rule.step === null ? offset : radius + Math.ceil((offset - radius) / rule.step) * rule.step;
    if (radius > (rule.max ?? Number.POSITIVE_INFINITY)) return null;
  }

  const along = Math.sqrt(Math.max(0, radius * radius - offset * offset));
  const direction = axisDirection(axis);
  // Two intersections, mirrored about the foot; take the one the cursor is on.
  const side =
    (wanted.x - foot.x) * direction.x + (wanted.y - foot.y) * direction.y >= 0 ? 1 : -1;
  return {
    tip: { x: foot.x + side * along * direction.x, y: foot.y + side * along * direction.y },
    radius,
  };
}

/**
 * Admissible lengths to try, nearest what the cursor asked for first.
 *
 * Arithmetic rather than another `quantize` call, so the snap hysteresis is
 * touched exactly once per pointer sample — by the cursor, which is the only
 * thing entitled to move it.
 */
function lengthCandidates(
  requested: number,
  reached: number,
  rule: TreeDragLengthRule
): number[] {
  const candidates: number[] = [];
  const push = (value: number) => {
    const clamped = clampToRule(value, rule);
    if (!candidates.includes(clamped)) candidates.push(clamped);
  };
  push(requested);
  // Where the sweep actually reached is the best second guess on any rule — it
  // is the furthest the gesture was allowed to go. On a stepless rule it is
  // admissible as-is; on a stepped one it has to be quantized first.
  //
  // Offering only `requested ± step` and `± 2·step` was not enough: a gesture
  // cut short by more than two steps found no admissible candidate at all and
  // fell through to `rule.current`, i.e. the identity — so dragging *further*
  // moved the flap *less*, and eventually not at all.
  push(rule.step === null ? reached : Math.round(reached / rule.step) * rule.step);
  if (rule.step !== null) {
    const toward = requested > reached ? -rule.step : rule.step;
    for (let i = 1; i <= 2; i += 1) push(requested + toward * i);
  }
  push(rule.current);
  return candidates;
}

/** Whether every held vertex is still clear of the mirror, on its own side. */
function heldStaysInPlace(
  moved: ReadonlyMap<number, Point>,
  subtree: readonly (readonly [number, Point])[],
  mirror: TreeDragMirror
): boolean {
  const normal = axisDirection({ ...mirror.axis, angle: mirror.axis.angle + 90 });
  const signedDistance = (point: Point) =>
    (point.x - mirror.axis.loc.x) * normal.x + (point.y - mirror.axis.loc.y) * normal.y;
  for (const [id, origin] of subtree) {
    if (!mirror.heldIds.has(id)) continue;
    const next = moved.get(id);
    if (!next) continue;
    const side = signedDistance(origin) < 0 ? -1 : 1;
    if (side * signedDistance(next) < mirror.clearance - 1e-9) return false;
  }
  return true;
}
