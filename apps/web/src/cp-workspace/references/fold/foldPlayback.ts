/**
 * Where a card's animation is, and where it is going.
 *
 * A card plays a **run** of legs. A fold card is one leg — fold — and rests
 * folded; Play again unfolds it. A twin card is two folds shown one after
 * the other: fold the first, hold a moment so the landing can be read,
 * unfold it, then fold the second and rest there, so the second landing can
 * be read the way a single fold's is; Play again unfolds it. A turn-over is
 * one leg too: the whole sheet turning over, and back on the next Play.
 *
 * Pressed while it moves, a run pauses; pressed again, it carries on the way
 * it was going. Pure and clock-free: the transport feeds `tickFoldRun` the
 * time that passed, and everything else here is arithmetic on the result.
 *
 * Progress within a leg runs linearly with time from flat to folded and the
 * easing lives in {@link poseAt}, so a pause and a resume cannot change the
 * shape of the motion — only where along it the paper stopped.
 */

import type { FoldSceneKind } from './foldScene';

export interface FoldPose {
  /** Which of the card's flaps is moving; the others lie flat. */
  flap: number;
  /** The swing, in radians: 0 flat, π folded over onto the paper. */
  angle: number;
  /** How far the creased stretches have been pressed sharp, 0 to 1. */
  press: number;
}

export type FoldHeading = 'fold' | 'unfold';

export interface FoldLeg {
  flap: number;
  heading: FoldHeading;
  /** Rest at the end of this leg for this long before the next begins. */
  holdMs: number;
  /** How long this leg takes, one way, in ms. */
  durationMs: number;
}

export interface FoldRun {
  /** What the card plays forwards; a run may be this or its reverse. */
  programme: readonly FoldLeg[];
  legs: readonly FoldLeg[];
  /** Index of the leg in progress. */
  leg: number;
  /** Progress of that leg's flap, 0 flat, 1 folded and pressed. */
  at: number;
  /** Hold time left at the end of the current leg, in ms. */
  holdLeft: number;
  playing: boolean;
}

/** One leg, one way. */
export const FOLD_DURATION_MS = 1150;
/**
 * A turn-over's leg. The whole sheet is on the move and the eye has to
 * follow the far edge all the way across the table, so it goes half as long
 * again as a flap's swing.
 */
export const TURN_OVER_DURATION_MS = 1725;
/** The swing's share of a leg's progress; the rest is the press. */
export const FOLD_SWING_SHARE = 0.8;
/** How long a twin's first fold rests folded before it comes back up. */
export const TWIN_HOLD_MS = 450;

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
export function poseAt(progress: number): Omit<FoldPose, 'flap'> {
  const at = clamp01(progress);
  if (at <= FOLD_SWING_SHARE) {
    return { angle: Math.PI * easeInOut(at / FOLD_SWING_SHARE), press: 0 };
  }
  return {
    angle: Math.PI,
    press: easeOut((at - FOLD_SWING_SHARE) / (1 - FOLD_SWING_SHARE)),
  };
}

/** How long a card of this kind takes over each leg. */
export function legDurationMs(kind: FoldSceneKind): number {
  return kind === 'turn-over' ? TURN_OVER_DURATION_MS : FOLD_DURATION_MS;
}

/**
 * What a card plays: one fold for one flap; for a pair, the first folded,
 * held and unfolded, then the second folded — and left folded.
 */
export function foldLegs(flapCount: number, durationMs = FOLD_DURATION_MS): FoldLeg[] {
  if (flapCount <= 1) return [{ flap: 0, heading: 'fold', holdMs: 0, durationMs }];
  const legs: FoldLeg[] = [];
  for (let flap = 0; flap < flapCount; flap += 1) {
    legs.push({ flap, heading: 'fold', holdMs: TWIN_HOLD_MS, durationMs });
    if (flap + 1 < flapCount) legs.push({ flap, heading: 'unfold', holdMs: 0, durationMs });
  }
  return legs;
}

/** The way back from a run that rests folded: the folded flap unfolding. */
export function unfoldingLegs(legs: readonly FoldLeg[]): FoldLeg[] {
  const last = legs[legs.length - 1];
  return last
    ? [{ flap: last.flap, heading: 'unfold', holdMs: 0, durationMs: last.durationMs }]
    : [];
}

const startOf = (leg: FoldLeg): number => (leg.heading === 'fold' ? 0 : 1);
const endOf = (leg: FoldLeg): number => (leg.heading === 'fold' ? 1 : 0);

/** A run before it has been played. */
export function runAtRest(legs: readonly FoldLeg[]): FoldRun {
  const first = legs[0];
  return { programme: legs, legs, leg: 0, at: first ? startOf(first) : 0, holdLeft: 0, playing: false };
}

/** Nothing on the paper is moved: the pose is null. */
export function isFlat(run: FoldRun): boolean {
  return run.at <= 0;
}

/** Every leg has been played, and nothing is left to hold. */
export function isComplete(run: FoldRun): boolean {
  const last = run.legs[run.legs.length - 1];
  if (!last) return true;
  return run.leg === run.legs.length - 1 && run.at === endOf(last) && run.holdLeft <= 0;
}

/** Played through and resting folded: Play would unfold. */
export function isFolded(run: FoldRun): boolean {
  const last = run.legs[run.legs.length - 1];
  return !!last && isComplete(run) && endOf(last) === 1;
}

/** The pose the run holds now, or null with the paper flat. */
export function runPose(run: FoldRun): FoldPose | null {
  const leg = run.legs[run.leg];
  if (!leg || isFlat(run)) return null;
  return { flap: leg.flap, ...poseAt(run.at) };
}

/** The way the run is going, for the record. */
export function runHeading(run: FoldRun): FoldHeading {
  return run.legs[run.leg]?.heading ?? 'fold';
}

/**
 * The Play button's one rule. Moving: pause. Paused: carry on. Played
 * through: the folded flap comes back up if it rests folded; the card's
 * programme runs again if it rests flat.
 */
export function toggleFoldRun(run: FoldRun): FoldRun {
  if (run.playing) return { ...run, playing: false };
  if (isComplete(run)) {
    const legs = isFolded(run) ? unfoldingLegs(run.programme) : run.programme;
    const first = legs[0];
    return { ...run, legs, leg: 0, at: first ? startOf(first) : 0, holdLeft: 0, playing: true };
  }
  return { ...run, playing: true };
}

function nextLeg(run: FoldRun): FoldRun {
  const next = run.legs[run.leg + 1];
  if (!next) return { ...run, holdLeft: 0, playing: false };
  return { ...run, leg: run.leg + 1, at: startOf(next), holdLeft: 0, playing: true };
}

/** The run `elapsedMs` later. */
export function tickFoldRun(run: FoldRun, elapsedMs: number): FoldRun {
  if (!run.playing) return run;
  const leg = run.legs[run.leg];
  if (!leg) return { ...run, playing: false };
  const elapsed = Math.max(0, elapsedMs);
  if (run.holdLeft > 0) {
    const holdLeft = run.holdLeft - elapsed;
    return holdLeft > 0 ? { ...run, holdLeft } : nextLeg({ ...run, holdLeft: 0 });
  }
  const step = elapsed / leg.durationMs;
  const at = clamp01(leg.heading === 'fold' ? run.at + step : run.at - step);
  const done = leg.heading === 'fold' ? at >= 1 : at <= 0;
  if (!done) return { ...run, at };
  const hasNext = run.leg + 1 < run.legs.length;
  if (hasNext && leg.holdMs > 0) return { ...run, at, holdLeft: leg.holdMs };
  return nextLeg({ ...run, at });
}

/**
 * What Play does when motion is unwelcome (`prefers-reduced-motion`): the
 * run's end, no frames between — and, played through, the next run's end.
 */
export function snapFoldRun(run: FoldRun): FoldRun {
  const started = isComplete(run) ? toggleFoldRun(run) : run;
  const last = started.legs[started.legs.length - 1];
  return {
    ...started,
    leg: Math.max(0, started.legs.length - 1),
    at: last ? endOf(last) : 0,
    holdLeft: 0,
    playing: false,
  };
}
