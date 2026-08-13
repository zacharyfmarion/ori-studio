import { SIMULATOR_ORBIT_SENSITIVITY, normalizeAngle } from '../../lib/simulatorOrbit';

/**
 * How the start screen's 3D figure turns.
 *
 * Pure: no React, no GL, no DOM, no clock of its own. Every transition is a
 * function of the state and an elapsed time, which is what lets the whole
 * behaviour — the sweep, the clamp, the resume, reduced motion — be tested
 * without a canvas. `StartFigure` owns the `requestAnimationFrame` loop and
 * feeds this; it holds no rotation logic itself.
 */

export type StartFigureMode = 'auto' | 'dragging' | 'resuming';

export interface StartFigureOrbitState {
  yaw: number;
  pitch: number;
  mode: StartFigureMode;
  /**
   * Position along the sweep, in radians of phase. Held rather than derived from
   * the yaw because the sweep is a sine: a given yaw occurs twice per cycle, so
   * yaw alone cannot say which way the figure is currently travelling.
   */
  phase: number;
  /** Milliseconds left to hold before easing back to the sweep. */
  holdMs: number;
}

export interface StartFigureOrbitConfig {
  /** The resting pose, baked into the asset by `generate-start-figure.mjs`. */
  yaw: number;
  pitch: number;
  /** Half-width of the auto sweep, in radians. */
  sweep: number;
  /** Freeze the sweep. Drag still works — see {@link advanceStartFigureOrbit}. */
  reducedMotion: boolean;
}

/**
 * A full there-and-back sweep, in milliseconds.
 *
 * Slow on purpose. This is ambient motion beside text somebody is reading, and
 * anything brisk enough to look deliberate is fast enough to pull the eye off
 * the three buttons that are the point of the screen.
 */
export const START_FIGURE_SWEEP_PERIOD_MS = 14_000;

/** How long a released drag rests before the sweep reclaims the figure. */
export const START_FIGURE_HOLD_MS = 2_500;

/** How fast a released drag eases back, in radians per second. */
const RESUME_RADIANS_PER_SECOND = 0.35;

/**
 * How far the pitch may leave its resting value, in radians.
 *
 * This is the whole of "rotate around the sides of it, not in all directions".
 * The figure is a turntable: yaw is free, and vertical movement tilts it just
 * enough that a drag feels like it grabbed a real object rather than a control
 * that ignores half its input. Unclamped, a folded form can be dragged onto its
 * own axis and become an unreadable sliver, which no amount of dragging back
 * quite undoes.
 */
export const START_FIGURE_PITCH_BAND = 0.25;

export function initialStartFigureOrbit(
  config: StartFigureOrbitConfig
): StartFigureOrbitState {
  return { yaw: config.yaw, pitch: config.pitch, mode: 'auto', phase: 0, holdMs: 0 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Where the sweep is at a given phase. */
function sweptYaw(config: StartFigureOrbitConfig, phase: number): number {
  return config.yaw + Math.sin(phase) * config.sweep;
}

/**
 * The phase whose swept yaw is closest to where a drag left the figure, so the
 * resume rejoins the sweep at the nearest point of its travel rather than
 * snapping back to the middle.
 *
 * `asin` is only defined on the sweep's own range, so a yaw dragged outside it
 * clamps to the nearer end. Both branches of `asin` are candidates — the sweep
 * passes through each yaw once travelling each way — and the one nearer the
 * current phase wins, which is what stops the resume from reversing direction at
 * the moment it takes over.
 *
 * The offset is the **normalized** difference, not `yaw - config.yaw`. A drag
 * normalizes its yaw into (−π, π], so a resting pose near ±π — which is exactly
 * where the shipped figure sits — puts the two on opposite sides of the wrap and
 * a raw subtraction reads a few degrees of travel as a half-turn. Clamped, that
 * lands on the wrong end of the sweep, and the figure eases the long way round.
 */
function nearestPhase(
  config: StartFigureOrbitConfig,
  yaw: number,
  phase: number
): number {
  if (config.sweep <= 1e-6) return phase;
  const offset = clamp(normalizeAngle(yaw - config.yaw) / config.sweep, -1, 1);
  const rising = Math.asin(offset);
  const falling = Math.PI - rising;
  const cycle = Math.PI * 2;
  const wrap = (value: number) => {
    const turns = Math.round((phase - value) / cycle);
    return value + turns * cycle;
  };
  const candidates = [wrap(rising), wrap(falling)];
  return candidates.reduce((best, candidate) =>
    Math.abs(candidate - phase) < Math.abs(best - phase) ? candidate : best
  );
}

/**
 * Advance one frame.
 *
 * `dragging` is deliberately inert here: while a pointer is down the figure is
 * the user's, and a sweep running underneath would fight them.
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

    const phase = nearestPhase(config, state.yaw, state.phase);
    const targetYaw = sweptYaw(config, phase);
    const step = (RESUME_RADIANS_PER_SECOND * elapsedMs) / 1000;
    const toYaw = normalizeAngle(targetYaw - state.yaw);
    const toPitch = config.pitch - state.pitch;
    const arrived = Math.abs(toYaw) <= step && Math.abs(toPitch) <= step;
    if (arrived) {
      return { yaw: targetYaw, pitch: config.pitch, mode: 'auto', phase, holdMs: 0 };
    }
    return {
      ...state,
      yaw: state.yaw + clamp(toYaw, -step, step),
      pitch: state.pitch + clamp(toPitch, -step, step),
      phase,
      holdMs: 0,
    };
  }

  const phase = state.phase + (elapsedMs / START_FIGURE_SWEEP_PERIOD_MS) * Math.PI * 2;
  return { ...state, yaw: sweptYaw(config, phase), phase, holdMs: 0 };
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
