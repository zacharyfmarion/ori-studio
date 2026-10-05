// Pulling the paper by hand, and keeping the shape it is pulled into.
//
// Our addition. Upstream Origami Simulator only drags a vertex and lets go of it
// again (third_party/origami-simulator/js/3dUI.js), so every crease springs back
// to `foldPercent × target`. Here a pull grips one point of the paper and draws
// it toward the cursor's ray; while it runs, fold creases yield, and letting go
// makes the shape on screen the paper's rest shape — a *pose* — until the fold
// target moves again. Both backends implement it against these definitions.
//
// The constants are measured: implementation-plans/simulator-pull-tool.md,
// tables A–D.
import type { Vec3 } from './bsp.js';

/**
 * How far a fold crease may be pushed past where the pull found it before its
 * rest angle follows. Small, because creased paper holds the angle it is pushed
 * to: an elastic crease can only be opened by a force that stretches the paper.
 */
export const PULL_YIELD_RADIANS = (0.25 * Math.PI) / 180;

/**
 * The grip's strongest pull, per unit of axial stiffness: enough to swing a flap
 * on yielding creases, too little to stretch the paper more than a few percent
 * where it cannot go.
 */
export const PULL_MAX_FORCE_PER_AXIAL_STIFFNESS = 0.06;

/**
 * The share of the grip's pull directed at the viewer. It breaks the tie a flat
 * flap faces when it has to leave its plane to reach the cursor — up toward the
 * eye, or down through the layers beneath — in favour of the side a finger is on.
 */
export const PULL_TOWARD_VIEWER_BIAS = 0.3;

/** How far an edge kept in a pose may differ from its length on the flat sheet. */
export const POSE_REST_LENGTH_TOLERANCE = 0.03;

/** How far a fold crease has to turn to count as moved by a pull. */
export const PULL_MOVED_CREASE_RADIANS = (2 * Math.PI) / 180;

/** A line through the scene: from the eye through the cursor, in world space. */
export interface CursorRay {
  origin: Vec3;
  /** Unit length, pointing away from the eye. */
  direction: Vec3;
}

/** The point a pull holds: a triangle, the press's weights in it, and the ray it is drawn to. */
export interface PullGrip {
  nodes: readonly [number, number, number];
  /** Barycentric weights of the press inside the triangle; they sum to 1. */
  weights: readonly [number, number, number];
  ray: CursorRay;
}

/** Letting go: keep the shape the pull made, or put the paper back. */
export type PullOutcome = 'keep' | 'cancel';

export interface PullSummary {
  /** Fold creases that turned past {@link PULL_MOVED_CREASE_RADIANS} during the pull. */
  movedCreases: number;
}

/** How the grip pulls; see {@link gripParameters}. */
export interface GripParameters {
  stiffness: number;
  damping: number;
  maxForce: number;
  bias: number;
}

/** A grip that does not describe a point of this model. A caller's bug. */
export class InvalidPullGripError extends Error {
  constructor(reason: string) {
    super(`Invalid pull grip: ${reason}`);
    this.name = 'InvalidPullGripError';
  }
}

/**
 * The grip for a material. As stiff as the stiffest edge, so it sits inside the
 * step the solver already takes; critically damped for the gripped point's mass
 * (nodes weigh 1, so the point weighs 1/Σw²); capped so it cannot stretch the
 * paper far.
 */
export function gripParameters(
  axialStiffness: number,
  shortestRestLength: number,
  weights: readonly [number, number, number]
): GripParameters {
  const stiffness = Math.max(0, axialStiffness) / Math.max(1e-6, shortestRestLength);
  const mass = 1 / (weights[0] * weights[0] + weights[1] * weights[1] + weights[2] * weights[2]);
  return {
    stiffness,
    damping: 2 * Math.sqrt(stiffness * mass),
    maxForce: PULL_MAX_FORCE_PER_AXIAL_STIFFNESS * Math.max(0, axialStiffness),
    bias: PULL_TOWARD_VIEWER_BIAS,
  };
}

/**
 * The force on the gripped point. It acts only across the ray, so the paper
 * finds its own depth under the cursor; adds the bias toward the eye in
 * proportion to how far off the ray the point is, so a point on the ray feels
 * none; and is capped at `maxForce`.
 *
 * The GPU's `gripForce` in `webgl/passes.ts` is this, in GLSL.
 */
export function gripForce(point: Vec3, velocity: Vec3, ray: CursorRay, parameters: GripParameters): Vec3 {
  const d = ray.direction;
  const along = (point[0] - ray.origin[0]) * d[0] + (point[1] - ray.origin[1]) * d[1] + (point[2] - ray.origin[2]) * d[2];
  const toRay: Vec3 = [
    ray.origin[0] + d[0] * along - point[0],
    ray.origin[1] + d[1] * along - point[1],
    ray.origin[2] + d[2] * along - point[2],
  ];
  const speedAlong = velocity[0] * d[0] + velocity[1] * d[1] + velocity[2] * d[2];
  const offRay = Math.hypot(toRay[0], toRay[1], toRay[2]);
  const towardEye = parameters.bias * parameters.stiffness * offRay;
  const force: Vec3 = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const across = velocity[axis]! - d[axis]! * speedAlong;
    force[axis] = parameters.stiffness * toRay[axis]! - parameters.damping * across - towardEye * d[axis]!;
  }
  const size = Math.hypot(force[0], force[1], force[2]);
  if (size > parameters.maxForce && size > 0) {
    const scale = parameters.maxForce / size;
    force[0] *= scale;
    force[1] *= scale;
    force[2] *= scale;
  }
  return force;
}

/**
 * A fold crease's rest angle during a pull: within `yieldAngle` of the angle its
 * deviation at the press (`baseline`) would put it at. A crease the pull does not
 * push keeps its rest angle exactly.
 */
export function yieldedRest(rest: number, theta: number, baseline: number, yieldAngle: number): number {
  const free = theta - baseline;
  return Math.min(free + yieldAngle, Math.max(free - yieldAngle, rest));
}

/** An edge's rest length in a pose: its length now, within tolerance of the sheet's. */
export function keptRestLength(current: number, sheet: number): number {
  return Math.min(sheet * (1 + POSE_REST_LENGTH_TOLERANCE), Math.max(sheet * (1 - POSE_REST_LENGTH_TOLERANCE), current));
}

/** Interior angles at a, b and c of a triangle; the face constraint's rest angles. */
export function triangleAngles(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const ab = unit(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const ac = unit(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
  const bc = unit(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
  return [
    Math.acos(clampUnit(dot(ab, ac))),
    Math.acos(clampUnit(-dot(ab, bc))),
    Math.acos(clampUnit(dot(ac, bc))),
  ];
}

/**
 * A grip with its ray normalised, or a typed error naming what is wrong with it.
 * Weights are renormalised to sum to 1, which a hit near an edge can miss by a
 * rounding error.
 */
export function validatedGrip(grip: PullGrip, nodeCount: number): PullGrip {
  for (const node of grip.nodes) {
    if (!Number.isInteger(node) || node < 0 || node >= nodeCount) {
      throw new InvalidPullGripError(`node ${node} is not one of the model's ${nodeCount}`);
    }
  }
  const sum = grip.weights[0] + grip.weights[1] + grip.weights[2];
  if (!grip.weights.every((weight) => Number.isFinite(weight) && weight >= 0) || !(sum > 0)) {
    throw new InvalidPullGripError('weights must be finite, non-negative and not all zero');
  }
  return {
    nodes: grip.nodes,
    weights: [grip.weights[0] / sum, grip.weights[1] / sum, grip.weights[2] / sum],
    ray: validatedRay(grip.ray),
  };
}

/** A ray with a unit direction, or a typed error. */
export function validatedRay(ray: CursorRay): CursorRay {
  const { origin, direction } = ray;
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (!origin.every(Number.isFinite) || !direction.every(Number.isFinite) || !(length > 0)) {
    throw new InvalidPullGripError('the ray must be finite with a non-zero direction');
  }
  return {
    origin: [origin[0], origin[1], origin[2]],
    direction: [direction[0] / length, direction[1] / length, direction[2] / length],
  };
}

function unit(x: number, y: number, z: number): Vec3 {
  const length = Math.hypot(x, y, z);
  if (length <= 1e-12) return [0, 0, 0];
  return [x / length, y / length, z / length];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}
