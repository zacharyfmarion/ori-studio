import {
  multiplyMat3,
  transposeMat3,
  viewRotation,
  viewRotationFor,
  type OrbitView,
} from '@treemaker/origami-simulator';

export type { OrbitView } from '@treemaker/origami-simulator';

export interface CameraDrag {
  x: number;
  y: number;
  yaw: number;
  pitch: number;
  roll: number;
  pan?: readonly [number, number];
}

/**
 * What a drag is doing to the camera.
 *
 * `orbit` moves the eye over the model; `roll` spins the picture about the line
 * of sight and leaves the eye exactly where it is. They are the same gesture
 * with a modifier held, so they are one mode rather than two gestures.
 */
export type CameraGestureMode = 'orbit' | 'roll' | 'pan';

export interface CameraPoint {
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
export interface CameraGesture {
  /**
   * A drag has started at this point. Cancels anything already moving.
   *
   * The mode is fixed here rather than read per move, so a modifier let go
   * halfway through does not turn a roll into an orbit mid-gesture.
   */
  begin: (point: CameraPoint, mode?: CameraGestureMode) => void;
  /** The pointer is here now. Ignored unless a drag is in flight. */
  move: (point: CameraPoint) => void;
  end: () => void;
}

export const ORBIT_SENSITIVITY = 0.01;

/**
 * How far in and out an orbit camera may be zoomed.
 *
 * Shared rather than repeated, because a 3D folded figure's window is meant to
 * zoom *exactly* as an inline simulation's does: same range, same curve. A
 * second pair of numbers held equal by intent is how "it behaves like the
 * simulator" quietly stops being true.
 */
export const MIN_CAMERA_ZOOM = 0.45;
export const MAX_CAMERA_ZOOM = 4;

export function clampCameraZoom(zoom: number): number {
  return Math.min(MAX_CAMERA_ZOOM, Math.max(MIN_CAMERA_ZOOM, zoom));
}

/**
 * Zoom multiplier for one wheel event.
 *
 * `deltaY` raw, exactly as the simulator viewport has always taken it —
 * deliberately not normalised for `deltaMode`, because normalising it here would
 * change how an inline simulation zooms on the browsers that report lines rather
 * than pixels. That is a fix for both surfaces at once, and its own change.
 */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.001);
}

export function nextOrbitView(view: OrbitView, drag: CameraDrag, point: CameraPoint): OrbitView {
  return {
    ...view,
    yaw: normalizeAngle(drag.yaw - (point.x - drag.x) * ORBIT_SENSITIVITY),
    pitch: normalizeAngle(drag.pitch + (point.y - drag.y) * ORBIT_SENSITIVITY),
  };
}

/**
 * Spin the picture about the line of sight, without moving the eye.
 *
 * Horizontal travel only, at the same sensitivity as a yaw: the gesture is a
 * sideways sweep, and letting vertical travel in as well would make a roll
 * impossible to do cleanly by hand. Rightward is clockwise, so the model follows
 * the hand.
 */
export function nextRollView(view: OrbitView, drag: CameraDrag, point: CameraPoint): OrbitView {
  return {
    ...view,
    roll: normalizeAngle(drag.roll + (point.x - drag.x) * ORBIT_SENSITIVITY),
  };
}

/** Translation is measured in fractions of the short edge, independent of DPR. */
export function panCamera(view: OrbitView, dx: number, dy: number, shortEdge: number): OrbitView {
  if (!(shortEdge > 0)) return view;
  return { ...view, pan: [(view.pan?.[0] ?? 0) + dx / shortEdge, (view.pan?.[1] ?? 0) + dy / shortEdge] };
}

/** Renderer-independent drag; the caller owns pointer capture and tool arbitration. */
export function createCameraGesture(options: {
  read: () => OrbitView;
  write: (view: OrbitView) => void;
  shortEdge: () => number;
  begin?: () => void;
  move?: () => void;
  end?: () => void;
}): CameraGesture {
  let origin: CameraDrag | null = null;
  let mode: CameraGestureMode = 'orbit';
  let edge = 1;
  return {
    begin(point, nextMode = 'orbit') {
      options.begin?.();
      const view = options.read();
      origin = { ...point, yaw: view.yaw, pitch: view.pitch, roll: view.roll ?? 0, pan: view.pan };
      edge = options.shortEdge();
      mode = nextMode;
    },
    move(point) {
      if (!origin) return;
      options.move?.();
      const view = options.read();
      options.write(
        mode === 'pan'
          ? panCamera({ ...view, pan: origin.pan }, point.x - origin.x, point.y - origin.y, edge)
          : mode === 'roll'
            ? nextRollView(view, origin, point)
            : nextOrbitView(view, origin, point)
      );
    },
    end() {
      if (!origin) return;
      origin = null;
      options.end?.();
    },
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
export function setUprightView(view: OrbitView): OrbitView {
  const total = viewRotationFor(view);
  return {
    ...view,
    yaw: 0,
    pitch: UPRIGHT_PITCH,
    // Any roll is absorbed into the orientation below rather than kept beside
    // it. `total` is the whole rotation including roll, so zeroing it here is
    // what keeps the promise that the picture does not move — leaving it set
    // would apply the same spin twice.
    roll: 0,
    // Transpose rather than a general inverse: a rotation's transpose *is* its
    // inverse, exactly, with no division to lose precision to.
    orient: multiplyMat3(transposeMat3(viewRotation(0, UPRIGHT_PITCH)), total),
  };
}

/**
 * The same picture with its roll folded into the orientation: yaw, pitch and
 * zoom kept, roll zero. For a surface that keeps a camera as yaw, pitch, zoom
 * and an orientation only (a folded figure's `FoldedFigureCamera`), so a roll
 * the viewport lets the user make is kept rather than dropped.
 *
 * Writing `C` for the yaw-and-pitch rotation, the view draws `Roll·C·R`;
 * `R' = Cᵀ·Roll·C·R` draws `C·R'`, the same rotation. The view itself, when
 * it has no roll.
 */
export function withRollAbsorbed<View extends OrbitView>(view: View): View {
  if (!view.roll) return view;
  const total = viewRotationFor(view);
  return {
    ...view,
    roll: 0,
    orient: multiplyMat3(transposeMat3(viewRotation(view.yaw, view.pitch)), total),
  };
}

/* --------------------------------------------------------------------------
 * Which way we are looking from
 * ----------------------------------------------------------------------- */

/**
 * A unit direction in the frame the camera's angles turn in.
 *
 * That is the renderer's world — Y the flat paper's normal — until an upright is
 * set, and the frame chosen by {@link setUprightView} afterwards. Naming it in
 * the *camera's* frame rather than the paper's is what keeps a view cube honest
 * across an upright: the cube shows the frame you are navigating, so its
 * vertical is the axis a drag actually spins about.
 */
export type ViewDirection = readonly [number, number, number];

/** Below this, a direction is on the yaw axis and yaw has nothing left to name. */
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
 * `orient` is carried through untouched and takes no part in the arithmetic:
 * `direction` is already in the frame those angles turn in, which is what
 * `orient` defines. So an upright changes which physical direction a given
 * argument names, and changes nothing about how it is solved.
 *
 * ## The sign of the hypotenuse is load-bearing
 *
 * `(−p, y + π)` names the *same* eye direction as `(p, y)` and negates the up
 * row: same viewpoint, model upside down. Taking the negative root picks
 * `p ∈ [−π, 0]`, which is the branch this app's camera already lives on —
 * `DEFAULT_SIMULATOR_VIEW` is at −0.955 and {@link UPRIGHT_PITCH} at −π/2 — and
 * it puts screen-up on world `+Y` for all four side-on views.
 *
 * ## On the poles the yaw is answered, not inherited
 *
 * Looking straight down the yaw axis, every yaw draws the same eye — so nothing
 * about the *direction* pins the in-plane angle, and this used to keep whatever
 * the camera already had. The reasoning was that a snap should not spin the
 * paper about the line of sight for no reason. It is wrong: keeping the yaw does
 * not avoid an arbitrary spin, it preserves one. Off the poles the yaw *is*
 * pinned by the direction, so the four side faces came up square while Top and
 * Bottom came up at whatever angle the last drag happened to end on — the same
 * verb behaving two different ways, which is what someone reported.
 *
 * Zero, then, and zero is not a fallback: at `(yaw 0, pitch 0)` the view
 * transform reduces to `screen_x = FOLD x`, `screen_y = −FOLD y`, so Top is the
 * fold laid out exactly as the crease-pattern canvas draws it. Bottom is that
 * seen through the sheet. Every one of the six is now one view rather than a
 * family of them.
 */
export function viewLookingFrom(view: OrbitView, direction: ViewDirection): OrbitView {
  const flat = Math.hypot(direction[0], direction[2]);
  return {
    ...view,
    yaw: flat < POLE_EPSILON ? 0 : Math.atan2(direction[0], -direction[2]),
    pitch: Math.atan2(-flat, direction[1]),
  };
}

/** File camera fields only; transient screen roll is absorbed into the orientation. */
export function persistedCameraView(view: OrbitView): Pick<OrbitView, 'yaw' | 'pitch' | 'zoom' | 'pan' | 'orient'> {
  const { yaw, pitch, zoom, pan, orient } = withRollAbsorbed(view);
  return { yaw, pitch, zoom, ...(pan ? { pan } : {}), ...(orient ? { orient } : {}) };
}
