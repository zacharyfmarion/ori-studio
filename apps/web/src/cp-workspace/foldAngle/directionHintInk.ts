import type { Rgba } from '../renderer/types';

/**
 * The hint code the compact transport carries per segment, in `seg_attr`'s
 * fifth slot. Mirrors `fold_direction_hint_code` in
 * `crates/oristudio-cp/src/geometry_transport.rs`.
 */
export const HINT_NONE = 0;
export const HINT_MOUNTAIN = 1;
export const HINT_VALLEY = 2;

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
 * **Ink rather than a dash**, and that is forced rather than preferred: there
 * are two dash slots and both are already spent on mountain and valley in the
 * `color-and-shape`, `black-one-dot` and `black-two-dot` styles, so a
 * dash-based hint would need a renderer change. Ink costs nothing, works in all
 * five line styles, and degrades in the monochrome ones to a lighter grey —
 * which still reads as "not decided" even where it cannot read as "mountain".
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
