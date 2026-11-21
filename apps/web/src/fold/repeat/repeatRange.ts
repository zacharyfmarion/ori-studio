/**
 * What the Repeat tool repeats, and across which axis (plans
 * `fold-sequence-tools`, `repeat-range-end`): the range — from a step the
 * folder chooses through another, by default the step on screen — the state
 * before it, which its symmetry axes are found on, and which of those axes is
 * taken. Wherever the range ends, the repeat is added after the step on
 * screen: a range repeated once can be repeated again, across another axis.
 * A drawn axis is `repeatDrawn`'s.
 *
 * Pure.
 */
import type { FoldModelLine } from '../document/foldSequenceDocument';
import type { FoldPathEntry } from '../sequence/foldSequencePath';
import { REPEAT_TOL, type RepeatSymmetry } from './repeatGeometry';

export interface RepeatRange {
  /**
   * The steps the range may start with, in path order: each step from the
   * first through the one on screen whose state, and whose parent's, have
   * landed — the only starts a repeat can be prepared from.
   */
  starts: readonly FoldPathEntry[];
  /**
   * The steps the range may end with, in path order: its first step, and each
   * after it through the step on screen while every step up to it has landed.
   */
  ends: readonly FoldPathEntry[];
  /** The range's first step. */
  first: FoldPathEntry;
  /** Its index in the path. */
  start: number;
  /** The range's last step: the step on screen, unless an earlier one was chosen. */
  last: FoldPathEntry;
  /** Its index in the path. */
  end: number;
  /** The state before the range — the flat sheet, or a step — on which its axes are found. */
  baseline: FoldPathEntry;
  /** How many operations the range holds, first through last. */
  count: number;
}

/**
 * The range from `chosenFirst` — while it is one of the starts — or else from
 * the step on screen, through `chosenLast` — while it is one of the ends — or
 * else through the step on screen; null at the flat sheet, and while the step
 * on screen has not landed, which the repeat is added after.
 */
export function repeatRange(
  entries: readonly FoldPathEntry[],
  cursor: number,
  chosenFirst: string | null,
  chosenLast: string | null
): RepeatRange | null {
  if (cursor < 1 || cursor >= entries.length) return null;
  const here = entries[cursor]!;
  if (here.session.state === null) return null;
  const starts = entries.slice(1, cursor + 1).filter((entry, k) => entry.session.state !== null && entries[k]!.session.state !== null);
  const first = starts.find((entry) => entry.id === chosenFirst) ?? (starts.includes(here) ? here : null);
  if (!first) return null;
  const start = entries.indexOf(first);
  const ends: FoldPathEntry[] = [];
  for (let at = start; at <= cursor && entries[at]!.session.state !== null; at++) ends.push(entries[at]!);
  // A last step before the first, or off the path, gives way to the step on screen.
  const last = ends.find((entry) => entry.id === chosenLast) ?? (ends.includes(here) ? here : null);
  if (!last) return null;
  const end = entries.indexOf(last);
  return { starts, ends, first, start, last, end, baseline: entries[start - 1]!, count: end - start + 1 };
}

/** Two lines alike, whichever way each is written: Repeat's tolerance on its normal and offset. */
export function sameRepeatLine(a: FoldModelLine, b: FoldModelLine): boolean {
  const sign = a.n[0] * b.n[0] + a.n[1] * b.n[1] >= 0 ? 1 : -1;
  return (
    Math.hypot(a.n[0] - sign * b.n[0], a.n[1] - sign * b.n[1]) < REPEAT_TOL &&
    Math.abs(a.d - sign * b.d) < REPEAT_TOL
  );
}

/**
 * The axis Repeat takes among the range's verified axes: the one the folder
 * last chose or drew (`remembered`, its sheet line) while the range has it,
 * else the first; -1 when there is none. A remembered axis the range lacks
 * is not forgotten: the next range that has it takes it again.
 */
export function repeatAxisIndex(axes: readonly RepeatSymmetry[], remembered: FoldModelLine | null): number {
  const known = remembered ? axes.findIndex((axis) => sameRepeatLine(axis.sheet, remembered)) : -1;
  return known >= 0 ? known : axes.length > 0 ? 0 : -1;
}
