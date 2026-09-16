import { ANALYTICS_EVENTS, bucketCount, SYMMETRY_PAIR_COUNT_BUCKETS } from './events';
import { track } from './runtime';

/** The three verbs that change the pairing by hand. */
export type SymmetryPairAction = 'pair' | 'pair_all' | 'unpair';

/**
 * A mirror pairing was made or broken by hand.
 *
 * One helper for the box-pleat and ExplOri stores rather than two hand-rolled
 * `track` calls, so both report the same property shape and the two trees can
 * be compared. Nothing about *which* vertices: ids and positions are the user's
 * design, and the count is bucketed.
 */
export function trackSymmetryPairChanged(input: {
  designKind: 'box-pleat' | 'explori';
  action: SymmetryPairAction;
  /** How many pairs the verb made or removed — always 1 except for Pair all. */
  pairCount: number;
}): void {
  track(ANALYTICS_EVENTS.symmetryPairChanged, {
    design_kind: input.designKind,
    action: input.action,
    pair_count_bucket: bucketCount(input.pairCount, SYMMETRY_PAIR_COUNT_BUCKETS),
  });
}
