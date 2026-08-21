import type { Rgba } from '../renderer/types';
import { HINT_MOUNTAIN, HINT_NONE, HINT_VALLEY } from '../../lib/foldAngle';

/**
 * The transport's hint codes, re-exported so render code has one import for
 * "everything about drawing a hint". They are *defined* in `lib/foldAngle`
 * beside the rest of the fold-state mirror, because the engine decoder needs
 * them too and cannot import from `cp-workspace/`.
 */
export { HINT_NONE, HINT_MOUNTAIN, HINT_VALLEY };

/** The line-colour name a hint's direction would paint with. */
export function hintColorName(code: number): string | null {
  if (code === HINT_MOUNTAIN) return 'Red1';
  if (code === HINT_VALLEY) return 'Blue2';
  return null;
}

/**
 * How far a hinted crease is pulled toward the unassigned grey.
 *
 * Chosen so the *direction* still reads at a glance — a hinted mountain must be
 * recognisably red — while the crease is plainly not decided. Nearer 1 and it
 * becomes indistinguishable from a plain unassigned crease; nearer 0 and it
 * passes for a real fold, which is the more dangerous of the two mistakes.
 */
const WASH = 0.55;

/**
 * A hinted crease's ink: its direction's colour, washed toward neutral.
 *
 * **Ink rather than a dash**, and now by choice rather than by constraint. It
 * was written when there were two dash slots and both were spent on mountain and
 * valley; there is a third one since, and it is spent on the undecided crease
 * itself. That is the right owner: the dash answers "is this settled?" and the
 * ink answers "which way did it lean?", so a hinted crease wears both and each
 * one still means one thing. Ink also works in all five line styles, and
 * degrades in the monochrome ones to a lighter grey — which still reads as "not
 * decided" even where it cannot read as "mountain".
 *
 * Applied per segment *after* the colour-keyed appearance cache, for the same
 * reason `foldAngleInk` is: direction is what the cache keys on, and whether a
 * particular crease is hinted is not.
 */
export function directionHintInk(direction: Rgba, neutral: Rgba): Rgba {
  return [
    direction[0] + (neutral[0] - direction[0]) * WASH,
    direction[1] + (neutral[1] - direction[1]) * WASH,
    direction[2] + (neutral[2] - direction[2]) * WASH,
    direction[3],
  ];
}
