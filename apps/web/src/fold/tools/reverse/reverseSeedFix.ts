/**
 * A reverse fold refused because no opening, or no stacking of the layers,
 * lets its tip turn, with more flaps than its drawn line crosses: the fix is
 * the same fold with only the flaps the line crosses (`reverseSegmentSeed`),
 * offered only when the engine says it lands. The engine's own diagnosis
 * never offers fewer flaps; this does, from what the folder drew.
 *
 * React-free and store-free.
 */
import type { Point } from '../../../lib/geometry';
import type { FoldChoices, FoldOp, FoldReverseKind } from '../../document/foldSequenceDocument';
import type { FoldReverseAsked } from '../../engine/foldEngineReverseWire';
import type { FoldCrossSection, FoldFlap } from '../../engine/foldEngineWire';
import { flapsAlong, sameFlap } from '../crossSection';
import type { FoldResolvedSeed } from '../foldToolState';
import type { FoldRefused } from '../refusalNotice';
import { reverseOpenWays } from './reverseStep';

/** The refusals a narrower seed may answer: no opening lets the tip turn, or no way of stacking the layers does. */
const NARROWED = new Set<string>(['reverse_no_opening', 'reverse_kind_infeasible']);

/** The most ways of opening asked of the engine for one fix: the first listed. */
export const SEED_FIX_WAYS = 8;

/**
 * The flaps the drawn stretch of the line crosses, when the fold took more
 * than those and was refused for its tip; null otherwise — another refusal,
 * no stretch drawn, a seed by depth, or no fewer flaps to try.
 */
export function narrowerReverseFlaps(
  refused: FoldRefused | null,
  seed: FoldResolvedSeed | null,
  section: Pick<FoldCrossSection, 'from' | 'to' | 'rows' | 'flaps'> | null,
  drawn: readonly [Point, Point] | null
): readonly FoldFlap[] | null {
  if (!refused || !NARROWED.has(refused.refusal.code) || !seed || !section || !drawn) return null;
  const folded = seed.scope === 'all' ? section.flaps : seed.scope === 'flaps' ? seed.flaps : null;
  if (!folded) return null;
  const crossed = flapsAlong(section, drawn[0], drawn[1]).flatMap((index) => section.flaps[index] ?? []);
  const within = crossed.every((flap) => folded.some((each) => sameFlap(each, flap)));
  return crossed.length > 0 && within && crossed.length < folded.length ? crossed : null;
}

/** The narrower seed that lands: its flaps, and the way of opening that does, of how many listed. */
export interface FoldReverseSeedFix {
  flaps: readonly FoldFlap[];
  /** By index into the ways the engine lists for the narrower tip; 0 when it opens one way. */
  opening: number;
  ways: number;
}

/**
 * Whether the reverse fold `op` lands, as the tools ask it (`useFoldReverseStep`):
 * the engine describes its tip, then — when a flap opens more than one way —
 * each way of the first {@link SEED_FIX_WAYS}, until one lands with the kind
 * wanted (any kind while the tools take the one that fits). The first that
 * lands is the fix; null when none does.
 */
export async function findReverseSeedFix(
  flaps: readonly FoldFlap[],
  step: { op: FoldOp; choices?: FoldChoices },
  ask: (op: FoldOp, choices: FoldChoices | undefined) => Promise<FoldReverseAsked | null>,
  wanted: FoldReverseKind | null
): Promise<FoldReverseSeedFix | null> {
  const lands = (kinds: readonly FoldReverseKind[]) => (wanted === null ? kinds.length > 0 : kinds.includes(wanted));
  const first = await ask(step.op, step.choices);
  if (!first) return null;
  const ways = reverseOpenWays(first.analysis);
  if (ways.length === 0) return lands(first.kinds) ? { flaps, opening: 0, ways: 0 } : null;
  for (let way = 0; way < Math.min(ways.length, SEED_FIX_WAYS); way += 1) {
    const opening = ways.at(way);
    if (!opening) break;
    const answer = await ask(step.op, { ...step.choices, opening: opening.stored });
    if (answer && lands(answer.kinds)) return { flaps, opening: way, ways: ways.length };
  }
  return null;
}
