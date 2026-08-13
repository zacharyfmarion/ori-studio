import { SIMULATOR_ORBIT_SENSITIVITY, normalizeAngle } from '../../lib/simulatorOrbit';

/**
 * How the start screen's 3D figure turns.
 *
 * Pure: no React, no GL, no DOM, no clock of its own. Every transition is a
 * function of the state and an elapsed time, which is what lets the whole
 * behaviour — the turn, the clamp, the resume, reduced motion — be tested
 * without a canvas. `StartFigure` owns the `requestAnimationFrame` loop and
 * feeds this; it holds no rotation logic itself.
 *
 * # It is a turntable, and that is a fact about the geometry
 *
 * Yaw always rotates the model about **its own Y axis** (`webgl/camera.ts`). The
 * figure only reads as "standing still while turning" if its upright axis *is*
 * that axis — and screen-up equals model Y at exactly one pitch, −π/2. So the
 * asset is baked with the design's up on model Y and shipped at that pitch;
 * `apps/web/start-figure-tuner.html` is what produces such an orientation.
 *
 * Get that wrong and the figure swings instead of turning, which is not
 * something this module can correct for: at any other alignment the up axis is
 * carried around the rotation and no camera can hold it still.
 */

export type StartFigureMode = 'auto' | 'dragging' | 'resuming';

export interface StartFigureOrbitState {
  yaw: number;
  pitch: number;
  mode: StartFigureMode;
  /** Milliseconds left to hold before the turn resumes. */
  holdMs: number;
}

export interface StartFigureOrbitConfig {
  /** The resting pose, baked into the asset by `generate-start-figure.mjs`. */
  yaw: number;
  pitch: number;
  /** Freeze the turn. Drag still works — see {@link advanceStartFigureOrbit}. */
  reducedMotion: boolean;
}

/**
 * One full revolution, in milliseconds.
 *
 * Slow on purpose. This is ambient motion beside text somebody is reading, and
 * anything brisk enough to look deliberate is fast enough to pull the eye off
 * the three buttons that are the point of the screen. At 24 seconds a glance
 * lands on a still figure and a second glance finds it somewhere else.
 */
export const START_FIGURE_TURN_PERIOD_MS = 24_000;

/** How long a released drag rests before the turn reclaims the figure. */
export const START_FIGURE_HOLD_MS = 2_500;

/** How fast a released drag eases its pitch back, in radians per second. */
const RESUME_RADIANS_PER_SECOND = 0.35;

/**
 * How far the pitch may leave its resting value, in radians.
 *
 * This is the whole of "rotate around the sides of it, not in all directions".
 * The figure is a turntable: yaw is free — a drag can carry it right around to
 * the back — and vertical movement tilts the camera just enough that the drag
 * feels like it grabbed a real object rather than a control that ignores half
 * its input. Unclamped, the view can be dragged onto the model's own axis, where
 * a folded form becomes an unreadable sliver.
 */
export const START_FIGURE_PITCH_BAND = 0.25;

export function initialStartFigureOrbit(
  config: StartFigureOrbitConfig
): StartFigureOrbitState {
  return { yaw: config.yaw, pitch: config.pitch, mode: 'auto', holdMs: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Advance one frame.
 *
 * `dragging` is deliberately inert here: while a pointer is down the figure is
 * the user's, and a turn running underneath would fight them.
 */
export function advanceStartFigureOrbit(
  state: StartFigureOrbitState,
  elapsedMs: number,
  config: StartFigureOrbitConfig
): StartFigureOrbitState {
  if (state.mode === 'dragging') return state;

  // Reduced motion stops the *ambient* movement, which is the thing nobody
  // asked for. A drag is a request, so a released one still settles rather than
  // freezing wherever it was let go.
  if (config.reducedMotion && state.mode === 'auto') return state;

  if (state.mode === 'resuming') {
    const holdMs = Math.max(0, state.holdMs - elapsedMs);
    if (holdMs > 0) return { ...state, holdMs };

    // Only the pitch eases back. The yaw does not: every yaw is a legitimate
    // view of a turntable, so there is nothing to return to, and travelling
    // back to some canonical angle would undo the user's drag in front of them.
    const step = (RESUME_RADIANS_PER_SECOND * elapsedMs) / 1000;
    const toPitch = config.pitch - state.pitch;
    if (Math.abs(toPitch) <= step) {
      return { ...state, pitch: config.pitch, mode: 'auto', holdMs: 0 };
    }
    return { ...state, pitch: state.pitch + clamp(toPitch, -step, step), holdMs: 0 };
  }

  return {
    ...state,
    yaw: normalizeAngle(
      state.yaw + (elapsedMs / START_FIGURE_TURN_PERIOD_MS) * Math.PI * 2
    ),
    holdMs: 0,
  };
}

export function beginStartFigureDrag(
  state: StartFigureOrbitState
): StartFigureOrbitState {
  return { ...state, mode: 'dragging' };
}

/**
 * Apply one pointer movement, in CSS pixels.
 *
 * The sensitivity is the simulator's own, imported rather than re-declared, so a
 * drag here has the weight of a drag on an inline simulation. A second constant
 * held equal by intent is how "it behaves like the simulator" quietly stops
 * being true.
 */
export function dragStartFigureOrbit(
  state: StartFigureOrbitState,
  deltaX: number,
  deltaY: number,
  config: StartFigureOrbitConfig
): StartFigureOrbitState {
  return {
    ...state,
    mode: 'dragging',
    yaw: normalizeAngle(state.yaw - deltaX * SIMULATOR_ORBIT_SENSITIVITY),
    pitch: clamp(
      state.pitch + deltaY * SIMULATOR_ORBIT_SENSITIVITY,
      config.pitch - START_FIGURE_PITCH_BAND,
      config.pitch + START_FIGURE_PITCH_BAND
    ),
  };
}

export function endStartFigureDrag(
  state: StartFigureOrbitState
): StartFigureOrbitState {
  return { ...state, mode: 'resuming', holdMs: START_FIGURE_HOLD_MS };
}
