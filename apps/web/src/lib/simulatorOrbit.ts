import {
  multiplyMat3,
  transposeMat3,
  viewRotation,
  type Mat3,
} from '@treemaker/origami-simulator';

export interface SimulatorOrbitView {
  yaw: number;
  pitch: number;
  zoom: number;
  /**
   * Model rotation applied before the camera, so yaw spins about the model's own
   * up rather than about the paper's normal. Absent means identity — the
   * turntable both surfaces have always been.
   */
  orient?: Mat3;
}

export interface SimulatorOrbitDrag {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

export interface SimulatorOrbitPoint {
  x: number;
  y: number;
}

/**
 * Turning the model by dragging, as three verbs.
 *
 * A surface that offers the gesture supplies pointer positions and nothing else:
 * where the drag started from, how sensitive it is, and where the resulting view
 * goes all belong to whoever owns the camera. Two surfaces drive one of these —
 * the simulator canvas and the view cube floating over it — and they are not the
 * same gesture in DOM terms, which is exactly why the part they *do* share is
 * passed across rather than written twice.
 */
export interface SimulatorOrbitGesture {
  /** A drag has started at this point. Cancels anything already moving. */
  begin: (point: SimulatorOrbitPoint) => void;
  /** The pointer is here now. Ignored unless a drag is in flight. */
  move: (point: SimulatorOrbitPoint) => void;
  end: () => void;
}

export const SIMULATOR_ORBIT_SENSITIVITY = 0.01;

/**
 * How far in and out an orbit camera may be zoomed.
 *
 * Shared rather than repeated, because a 3D folded figure's window is meant to
 * zoom *exactly* as an inline simulation's does: same range, same curve. A
 * second pair of numbers held equal by intent is how "it behaves like the
 * simulator" quietly stops being true.
 */
export const SIMULATOR_MIN_ZOOM = 0.45;
export const SIMULATOR_MAX_ZOOM = 4;

export function clampSimulatorZoom(zoom: number): number {
  return Math.min(SIMULATOR_MAX_ZOOM, Math.max(SIMULATOR_MIN_ZOOM, zoom));
}

/**
 * Zoom multiplier for one wheel event.
 *
 * `deltaY` raw, exactly as the simulator viewport has always taken it —
 * deliberately not normalised for `deltaMode`, because normalising it here would
 * change how an inline simulation zooms on the browsers that report lines rather
 * than pixels. That is a fix for both surfaces at once, and its own change.
 */
export function simulatorWheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.001);
}

export function nextSimulatorOrbitView(
  view: SimulatorOrbitView,
  drag: SimulatorOrbitDrag,
  point: SimulatorOrbitPoint
): SimulatorOrbitView {
  return {
    ...view,
    yaw: normalizeAngle(drag.yaw - (point.x - drag.x) * SIMULATOR_ORBIT_SENSITIVITY),
    pitch: normalizeAngle(drag.pitch + (point.y - drag.y) * SIMULATOR_ORBIT_SENSITIVITY),
  };
}

export function normalizeAngle(value: number): number {
  const fullTurn = Math.PI * 2;
  return ((((value + Math.PI) % fullTurn) + fullTurn) % fullTurn) - Math.PI;
}

/* --------------------------------------------------------------------------
 * Which way is up
 * ----------------------------------------------------------------------- */

/**
 * The pitch at which the model's up axis stands exactly vertical on screen.
 *
 * Not an extreme, despite how it reads. Pitch here is measured from looking
 * straight *down* the up axis — `camera.test.ts` pins pitch 0 as exactly that —
 * so `−π/2` is the eye at the **horizon**, the ordinary side-on view of a
 * standing model. Dragging toward 0 rises to look down on it, toward `−π` drops
 * to look up at it.
 *
 * It is also forced rather than chosen. `toViewSpace` sends world Y to
 * `(0, −sin p, cos p)`, so `(0,1,0)` — screen up — requires `sin p = −1`.
 */
export const UPRIGHT_PITCH = -Math.PI / 2;

/**
 * Take the direction currently pointing up on screen as the model's up.
 *
 * Both surfaces orbit as a turntable about the **paper's normal**: a simulation
 * lifts FOLD `(x, y)` to `(x, 0, y)` and a folded figure maps the kernel's
 * `(x, y, z)` to `(x, z, −y)`, either way putting the normal on the axis yaw
 * spins about. For a flat sheet that is right — the normal *is* up. For a model
 * that stands, its own up lies *in* the paper plane at an angle nothing in the
 * pipeline knows, so yaw spins it about an axis through its front and it tumbles
 * rather than turning.
 *
 * Dragging cannot fix that: yaw and pitch only move the eye on a sphere whose
 * pole is fixed. This picks the pole.
 *
 * The picture does not move. Writing `T` for the current total rotation, the
 * model direction drawn straight up is `v = T⁻¹·(0,1,0)`; requiring both that
 * `v` become the yaw axis and that `Pitch(p')·Yaw(y')·R' = T` forces
 * `p' = UPRIGHT_PITCH` with `y'` free, leaving `R' = Pitch(p')⁻¹·T`.
 */
export function setUprightView(view: SimulatorOrbitView): SimulatorOrbitView {
  const total = viewRotation(view.yaw, view.pitch, view.orient);
  return {
    ...view,
    yaw: 0,
    pitch: UPRIGHT_PITCH,
    // Transpose rather than a general inverse: a rotation's transpose *is* its
    // inverse, exactly, with no division to lose precision to.
    orient: multiplyMat3(transposeMat3(viewRotation(0, UPRIGHT_PITCH)), total),
  };
}

/* --------------------------------------------------------------------------
 * Which way we are looking from
 * ----------------------------------------------------------------------- */

/** A unit direction in the renderer's world: Y is the flat paper's normal. */
export type SimulatorViewDirection = readonly [number, number, number];

/** Row-major `m · v`. */
function transformVec3(m: Mat3, v: SimulatorViewDirection): SimulatorViewDirection {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/**
 * Below this, a direction is on the yaw axis and yaw has nothing left to name.
 * Squared distance from the pole, so no root is taken to compare it.
 */
const POLE_EPSILON = 1e-9;

/**
 * The view that looks at the model from `direction`, keeping everything else.
 *
 * The inverse of {@link setUprightView}'s question: that one is handed an up and
 * solves for the pole, this one is handed an eye direction and solves for the
 * angles. It is what a view cube's faces are wired to, and it works for any unit
 * direction, not only the six axes — the corner `(1, 1, −1)/√3` reproduces
 * `DEFAULT_SIMULATOR_VIEW` exactly.
 *
 * `viewRotation`'s row 2 *is* the eye direction (see `viewDepthAxis`), so this
 * is an inversion of that row rather than a fresh construction:
 *
 * ```
 * row 2 = (−sin p · sin y,  cos p,  sin p · cos y)
 * ```
 *
 * with `orient` folded in first — the stored rotation multiplies on the right of
 * the camera, so requiring `row2(C · O) = n` gives `row2(C)ᵀ = O · n`.
 *
 * ## The sign of the hypotenuse is load-bearing
 *
 * `(−p, y + π)` names the *same* eye direction as `(p, y)` and negates the up
 * row: same viewpoint, model upside down. Taking the negative root picks
 * `p ∈ [−π, 0]`, which is the branch this app's camera already lives on —
 * `DEFAULT_SIMULATOR_VIEW` is at −0.955 and {@link UPRIGHT_PITCH} at −π/2 — and
 * it puts screen-up on world `+Y` for all four side-on views.
 *
 * On the yaw axis itself the yaw is free, so the current one is kept: a snap to
 * Top or Bottom must not also spin the paper about the direction you are
 * looking down.
 */
export function simulatorViewLookingFrom(
  view: SimulatorOrbitView,
  direction: SimulatorViewDirection
): SimulatorOrbitView {
  const target = view.orient ? transformVec3(view.orient, direction) : direction;
  const flat = Math.hypot(target[0], target[2]);
  return {
    ...view,
    yaw: flat < POLE_EPSILON ? view.yaw : Math.atan2(target[0], -target[2]),
    pitch: Math.atan2(-flat, target[1]),
  };
}


