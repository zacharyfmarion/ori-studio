/**
 * Where a step's fold is, and where it is going.
 *
 * A step arrives flat. Play takes it to folded and pressed; Play again brings
 * it back. Pressed while it moves, it pauses; pressed again, it carries on the
 * way it was going. Pure and clock-free: the hook that owns the animation
 * frame feeds `tickFoldPlayback` the time that passed, and everything else
 * here is arithmetic on the result.
 *
 * Progress runs linearly with time from 0 to 1 and the easing lives in
 * {@link poseAt}, so a pause and a resume cannot change the shape of the
 * motion — only where along it the paper stopped.
 */

export interface FoldPose {
  /** The swing, in radians: 0 flat, π folded over onto the paper. */
  angle: number;
  /** How far the creased stretches have been pressed sharp, 0 to 1. */
  press: number;
}

export type FoldHeading = 'fold' | 'unfold';

export interface FoldPlayback {
  /** Progress along the fold, 0 flat, 1 folded and pressed. */
  at: number;
  /** The way it is going, or last went. */
  heading: FoldHeading;
  playing: boolean;
}

export const FOLD_AT_REST: FoldPlayback = { at: 0, heading: 'fold', playing: false };

/** The whole motion, one way. */
export const FOLD_DURATION_MS = 1150;
/** The swing's share of the progress; the rest is the press. */
export const FOLD_SWING_SHARE = 0.8;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Cubic ease-in-out: slow off the paper, slow onto it. */
export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Cubic ease-out: the press lands and settles. */
export function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

/** The paper's pose at a progress: the swing first, then the press. */
export function poseAt(progress: number): FoldPose {
  const at = clamp01(progress);
  if (at <= FOLD_SWING_SHARE) {
    return { angle: Math.PI * easeInOut(at / FOLD_SWING_SHARE), press: 0 };
  }
  return {
    angle: Math.PI,
    press: easeOut((at - FOLD_SWING_SHARE) / (1 - FOLD_SWING_SHARE)),
  };
}

/** Flat, folded, or somewhere between: whether a pose draws anything. */
export function isFlat(state: FoldPlayback): boolean {
  return state.at <= 0;
}

export function isFolded(state: FoldPlayback): boolean {
  return state.at >= 1;
}

/**
 * The Play button's one rule. Moving: pause. Paused: carry on. At rest: head
 * for the far end — folded from flat, flat from folded.
 */
export function toggleFoldPlayback(state: FoldPlayback): FoldPlayback {
  if (state.playing) return { ...state, playing: false };
  const heading: FoldHeading = isFolded(state) ? 'unfold' : isFlat(state) ? 'fold' : state.heading;
  return { at: state.at, heading, playing: true };
}

/** The motion `elapsedMs` later, coming to rest at either end. */
export function tickFoldPlayback(state: FoldPlayback, elapsedMs: number): FoldPlayback {
  if (!state.playing) return state;
  const step = Math.max(0, elapsedMs) / FOLD_DURATION_MS;
  const at = clamp01(state.heading === 'fold' ? state.at + step : state.at - step);
  const done = state.heading === 'fold' ? at >= 1 : at <= 0;
  return { at, heading: state.heading, playing: !done };
}

/**
 * What Play does when motion is unwelcome (`prefers-reduced-motion`): straight
 * to the far end, no frames between.
 */
export function snapFoldPlayback(state: FoldPlayback): FoldPlayback {
  const heading: FoldHeading = isFolded(state) ? 'unfold' : isFlat(state) ? 'fold' : state.heading;
  return { at: heading === 'fold' ? 1 : 0, heading, playing: false };
}
