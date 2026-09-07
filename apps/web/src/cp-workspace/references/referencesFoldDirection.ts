/**
 * Which way each of a plan's creases folds, recovered from the crease pattern.
 *
 * The crate reads Oriedita's colour codes once, to split border from
 * non-border, and keeps the assignment only on `MergedLine.kinds`.
 * `Planner::new` builds its `Target` from a merged line and never reads them, so
 * from `Target` onward — `FoldedLine`, `Placed`, `Step`, `Sequence` — mountain
 * and valley are gone; `LineTag` is provenance (`edge`/`cp`/`aux`/`rf_aux`), not
 * direction.
 *
 * It comes back in one hop: `Step.cp_line_ids` are 1-based indices into the same
 * `segEndpoints` / `segAttr` arrays the sheet thumbnails already colour from. So
 * this is a presentation module, not a crate change (plan D16).
 *
 * **Most steps are mixed.** Measured on the planner's own fixtures, 57 of
 * iguana-c0's 91 steps make a chord that is mountain along some spans and valley
 * along others — step 1 alone is both, over 20 crease ids. One fold along that
 * chord cannot produce both directions, which is what D17's sequencing is for.
 */
import { SEG_ATTR_STRIDE, type CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';

/** `Red1` and `Blue2` from `LINE_COLOR_BY_NUMBER` — Oriedita's own codes. */
const CP_MOUNTAIN = 1;
const CP_VALLEY = 2;

/**
 * What a step's creases are, taken together.
 *
 * `none` is a step that puts no crease in the pattern at all — an auxiliary
 * landmark, which has no direction to get right.
 */
export type PrecreaseFoldDirection = 'mountain' | 'valley' | 'mixed' | 'none';

/**
 * Which way a crease of this Oriedita colour folds, or null for anything else.
 *
 * Numeric rather than through `lineColorName`, which throws on a code outside
 * its table: a thumbnail that cannot read a colour should draw a plain line, not
 * take the sidebar down.
 */
export function directionOfColor(color: number): 'mountain' | 'valley' | null {
  if (color === CP_MOUNTAIN) return 'mountain';
  if (color === CP_VALLEY) return 'valley';
  return null;
}

/** The Oriedita colour of a 1-based crease id, or null when it names nothing. */
function colorOf(geometry: CpGeometryTransport, lineId: number): number | null {
  const index = lineId - 1;
  if (index < 0 || index * 4 + 3 >= geometry.segEndpoints.length) return null;
  return geometry.segAttr[index * SEG_ATTR_STRIDE] ?? null;
}

/** Which way one crease folds, or null when it is neither mountain nor valley. */
export function creaseDirection(
  geometry: CpGeometryTransport,
  lineId: number
): 'mountain' | 'valley' | null {
  const color = colorOf(geometry, lineId);
  return color === null ? null : directionOfColor(color);
}

/** What one step's creases are, taken together. */
export function stepDirection(
  geometry: CpGeometryTransport,
  step: PrecreaseStep
): PrecreaseFoldDirection {
  let mountain = false;
  let valley = false;
  for (const id of step.cp_line_ids) {
    const direction = creaseDirection(geometry, id);
    if (direction === 'mountain') mountain = true;
    else if (direction === 'valley') valley = true;
  }
  if (mountain && valley) return 'mixed';
  if (mountain) return 'mountain';
  if (valley) return 'valley';
  return 'none';
}

/** Every step's direction, parallel to `sequence.steps`. */
export function sequenceDirections(
  geometry: CpGeometryTransport,
  sequence: PrecreaseSequence
): PrecreaseFoldDirection[] {
  return sequence.steps.map((step) => stepDirection(geometry, step));
}

/**
 * The 1-based crease ids a sequence leaves as mountains, in step order.
 *
 * These are the creases the reverse pass turns over. Auxiliary creases are not
 * here: they are not in the pattern, so the pattern says nothing about which way
 * they should end up.
 */
export function mountainLineIds(
  geometry: CpGeometryTransport,
  sequence: PrecreaseSequence
): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const step of sequence.steps) {
    for (const id of step.cp_line_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (creaseDirection(geometry, id) === 'mountain') ids.push(id);
    }
  }
  return ids;
}
