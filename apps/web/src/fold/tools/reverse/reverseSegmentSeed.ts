import type { Point } from '../../../lib/geometry';
import type { FoldCrossSection } from '../../engine/foldEngineWire';
import { flapsAlong } from '../crossSection';
import { FOLD_EVERY_LAYER, flapSeed, type FoldResolvedSeed, type FoldToolState } from '../foldToolState';

/**
 * A reverse fold's line drawn between two picks (owner rule, 2026-10-21):
 * "the default should be every layer on the line segment that was drawn if
 * its a free line or axiom 1". The line folded is infinite, so every layer
 * on it took in flaps that lie along its extension far from where it was
 * drawn — a crane's tail and wings with its head — and nothing landed.
 * Another line mode constructs its line rather than drawing it, so has no
 * stretch of it to read: it keeps every layer on the line.
 *
 * The stretch is the two picks' points in the folded pane's scene frame,
 * where the section measures the line: a pick on the crease pattern is
 * there as the paper under it lies folded. Null for another tool or line
 * mode, a fix's line, and until both ends are in.
 */
export function reverseDrawnSegment(
  tools: Pick<FoldToolState, 'tool' | 'lineMode' | 'picks' | 'override'>
): readonly [Point, Point] | null {
  if (tools.tool !== 'inside-reverse' || tools.override) return null;
  if (tools.lineMode !== 'free' && tools.lineMode !== 'axiom-1') return null;
  const [a, b] = tools.picks.map((pick) => (pick.kind === 'segment' ? null : pick.scene));
  return a && b ? [a, b] : null;
}

/**
 * The flaps whose paper the drawn stretch of the line runs over, every
 * layer there (`flapsAlong`), as a seed: every layer when that is all of
 * them, or when it runs over none on the moving side — a stretch drawn off
 * the paper, which the folder can then narrow with the chips.
 */
export function reverseSegmentSeed(
  section: Pick<FoldCrossSection, 'from' | 'to' | 'rows' | 'flaps'>,
  [a, b]: readonly [Point, Point]
): FoldResolvedSeed {
  const crossed = flapsAlong(section, a, b).flatMap((index) => section.flaps[index] ?? []);
  return crossed.length > 0 ? flapSeed(crossed, section.flaps) : FOLD_EVERY_LAYER;
}
