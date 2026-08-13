import { SIMULATOR_ORBIT_SENSITIVITY, normalizeAngle } from '../../lib/simulatorOrbit';

/**
 * How the start screen's 3D figure turns.
 *
 * Pure: no React, no GL, no DOM, no clock of its own. Every transition is a
 * function of the state and an elapsed time, which is what lets the whole
 * behaviour — the turn, the drag, the resume, reduced motion — be tested
 * without a canvas. `StartFigure` owns the `requestAnimationFrame` loop and
 * feeds this; it holds no rotation logic itself.
 *
 * # One axis, and pitch is not part of the state
 *
 * The figure is a turntable and nothing else: yaw is the only thing that ever
 * moves. The camera's pitch comes from the asset and is never touched here —
 * not clamped to a band, not eased back, not stored — because there is no path
 * by which it could change. That is deliberate. A little vertical give reads as
 * slop rather than as freedom, and it is the kind of thing that quietly drifts
 * back once it is representable.
 *
 * # Why the pitch has to be what it is
 *
 * Yaw rotates the model about **its own Y axis** (`webgl/camera.ts`). The figure
 * only reads as "standing still while turning" if its upright axis *is* that
 * axis — and screen-up equals model Y at exactly one pitch, −π/2. So the asset
 * is baked with the design's up on model Y and shipped at that pitch;
 * `apps/web/start-figure-tuner.html` is what produces such an orientation.
 *
 * Get that wrong and the figure swings instead of turning, which is not
 * something this module can correct for: at any other alignment the up axis is
 * carried around the rotation and no camera can hold it still.
 */

export type StartFigureMode = 'auto' | 'dragging' | 'resuming';

export interface StartFigureOrbitState {
  yaw: number;
  mode: StartFigureMode;
  /** Milliseconds left to hold before the turn resumes. */
  holdMs: number;
}

export interface StartFigureOrbitConfig {
  /** Where the turn starts, from the asset. */
  yaw: number;
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

export function initialStartFigureOrbit(
  config: StartFigureOrbitConfig
): StartFigureOrbitState {
  return { yaw: config.yaw, mode: 'auto', holdMs: 0 };
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
  // asked for. A drag is a request, so a released one still hands the figure
  // back rather than leaving it stuck in `resuming` forever.
  if (config.reducedMotion && state.mode === 'auto') return state;

  if (state.mode === 'resuming') {
    const holdMs = Math.max(0, state.holdMs - elapsedMs);
    // The hold is the whole of the resume. Nothing eases anywhere: the yaw the
    // user left is a legitimate view of a turntable, so there is nothing to
    // return to, and travelling back to some canonical angle would undo their
    // drag in front of them.
    return holdMs > 0 ? { ...state, holdMs } : { ...state, mode: 'auto', holdMs: 0 };
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
 * Horizontal only — there is no vertical parameter to pass, so there is nothing
 * to accidentally wire up. The sensitivity is the simulator's own, imported
 * rather than re-declared, so a drag here has the weight of a drag on an inline
 * simulation. A second constant held equal by intent is how "it behaves like the
 * simulator" quietly stops being true.
 */
export function dragStartFigureOrbit(
  state: StartFigureOrbitState,
  deltaX: number
): StartFigureOrbitState {
  return {
    ...state,
    mode: 'dragging',
    yaw: normalizeAngle(state.yaw - deltaX * SIMULATOR_ORBIT_SENSITIVITY),
  };
}

export function endStartFigureDrag(
  state: StartFigureOrbitState
): StartFigureOrbitState {
  return { ...state, mode: 'resuming', holdMs: START_FIGURE_HOLD_MS };
}
