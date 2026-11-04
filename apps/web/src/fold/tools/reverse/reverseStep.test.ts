import { describe, expect, it } from 'vitest';
import type { FoldOpening, FoldReverseAnalysis, FoldReverseWay } from '../../engine/foldEngineReverseWire';
import {
  chosenAt,
  lockedFlaps,
  openingForKind,
  reverseKindToFold,
  reverseLandingWays,
  reverseOpenWays,
  type FoldReverseTip,
  type FoldReverseWays,
} from './reverseStep';

function analysis(counts: number[], truncated = false): FoldReverseAnalysis {
  return {
    line: { n: [0, 1], d: 0 }, side: 'positive',
    snap: { clusters: 0, angle: 0, max_shift: 0 }, tip: [],
    flaps: counts.map((count, index) => ({
      index, flap: { faces: [], witness: [index, 0] }, truncated,
      openings: Array.from({ length: count }, (_, k): FoldOpening => ({
        lower: [], upper: [k], spine: { n: [0, 1], d: 0 },
        across: [], lower_body: [], upper_body: [], stored: { upper: [[index, k]] },
      })),
    })),
  };
}

describe('reverse kind intent and opening reach', () => {
  it('keeps explicit intent even when only the other kind lands, or neither does', () => {
    expect(reverseKindToFold('outside', ['inside'])).toBe('outside');
    expect(reverseKindToFold('inside', ['outside'])).toBe('inside');
    expect(reverseKindToFold('outside', [])).toBe('outside');
    expect(reverseKindToFold(null, ['outside'])).toBe('outside');
    expect(reverseKindToFold(null, ['inside', 'outside'])).toBe('inside');
  });

  it('reaches every combination after the former 16-item cap without allocating the product', () => {
    const ways = reverseOpenWays(analysis([8, 8, 1]));
    expect(ways.length).toBe(64);
    expect(ways.truncated).toBe(false);
    expect(ways.at(17)?.stored).toEqual([{ upper: [[0, 2]] }, { upper: [[1, 1]] }]);
    expect(ways.at(63)?.stored).toEqual([{ upper: [[0, 7]] }, { upper: [[1, 7]] }]);
    expect(ways.at(64)).toBeUndefined();
    expect(ways.at(-1)).toBeUndefined();
    expect(chosenAt(ways, 64)).toEqual(ways.at(0));
    expect(chosenAt(['first', 'last'], -1)).toBe('first');
    expect(reverseOpenWays(analysis([1])).length).toBe(0);
  });

  it('reports engine truncation and bounded integer indexing explicitly', () => {
    expect(reverseOpenWays(analysis([2], true)).truncated).toBe(true);
    const ways = reverseOpenWays(analysis(new Array(10).fill(64)));
    expect(ways.length).toBe(Number.MAX_SAFE_INTEGER);
    expect(ways.truncated).toBe(true);
    expect(ways.at(ways.length - 1)?.stored).toHaveLength(10);
  });
});

/**
 * A tip of one flap per entry of `splits`, each opening `[lower, upper]`
 * faces: what evenness is measured by.
 */
function splitTip(splits: [number, number][][], ways: FoldReverseWay[] | null, extra: Partial<FoldReverseTip['landings']> = {}): FoldReverseTip {
  return {
    analysis: {
      line: { n: [0, 1], d: 0 }, side: 'positive',
      snap: { clusters: 0, angle: 0, max_shift: 0 }, tip: [],
      flaps: splits.map((openings, index) => ({
        index: index + 3, flap: { faces: [index], witness: [index, 0] }, truncated: false,
        openings: openings.map(([lower, upper], k): FoldOpening => ({
          lower: Array.from({ length: lower }, (_, f) => f), upper: Array.from({ length: upper }, (_, f) => 100 + f),
          spine: { n: [0, 1], d: 0 }, across: [], lower_body: [], upper_body: [], stored: { upper: [[index, k]] },
        })),
      })),
    },
    landings: ways ? { ways, more: false, locked: [], ...extra } : null,
  };
}

const way = (openings: number[], inside: boolean | null, outside: boolean | null): FoldReverseWay => ({ openings, inside, outside });

/** Each listed way's openings, by index into its flaps' openings. */
function listed(tip: FoldReverseTip, ways: FoldReverseWays): number[][] {
  const choosing = tip.analysis.flaps.filter((flap) => flap.openings.length > 1);
  return Array.from({ length: ways.length }, (_, k) =>
    (ways.at(k)?.openings ?? []).map((opening, f) => choosing[f]!.openings.indexOf(opening))
  );
}

describe('the openings the stepper lists (owner feedback, 2026-11-04)', () => {
  // A flap of four layers opening three ways, as real tutorial models' flaps often do: the middle,
  // even split lands inside, the two outer ones only outside.
  const THREE = [[[1, 3], [2, 2], [3, 1]]] as [number, number][][];
  const typical = splitTip(THREE, [way([0], false, true), way([1], true, false), way([2], false, true)]);

  it('lists the even split first on Automatic, then the rest that land either kind', () => {
    const ways = reverseLandingWays(typical, null);
    expect(listed(typical, ways)).toEqual([[1], [0], [2]]);
    expect(ways.truncated).toBe(false);
    expect(chosenAt(ways, 0)?.stored).toEqual([{ upper: [[0, 1]] }]);
  });

  it('lists only the ways the kind asked for lands', () => {
    expect(listed(typical, reverseLandingWays(typical, 'inside'))).toEqual([[1]]);
    expect(listed(typical, reverseLandingWays(typical, 'outside'))).toEqual([[0], [2]]);
  });

  it('never lists a way that lands as neither kind, and puts Inside first among splits as even', () => {
    const tip = splitTip([[[1, 3], [3, 1], [2, 2]]], [way([0], false, true), way([1], true, true), way([2], false, false)]);
    expect(listed(tip, reverseLandingWays(tip, null))).toEqual([[1], [0]]);
  });

  it('lists the undecided last, in the engine’s order, and says more may exist', () => {
    const tip = splitTip(THREE, [way([0], null, null), way([1], true, false), way([2], false, null)]);
    const either = reverseLandingWays(tip, null);
    expect(listed(tip, either)).toEqual([[1], [0], [2]]);
    expect(either.truncated).toBe(true);
    // Asked for Outside: no way is known to land it, but two may.
    expect(listed(tip, reverseLandingWays(tip, 'outside'))).toEqual([[0], [2]]);
  });

  it('counts the ways past those the engine decided as undecided, after every decided one', () => {
    const tip = splitTip([[[1, 3], [2, 2], [3, 1]], [[1, 1], [2, 0]]], [way([0, 0], false, false), way([0, 1], true, false), way([1, 0], true, true)], { more: true });
    const ways = reverseLandingWays(tip, null);
    // Two land (the most even first), then the three the engine did not decide, in its order.
    expect(listed(tip, ways)).toEqual([[1, 0], [0, 1], [1, 1], [2, 0], [2, 1]]);
    expect(ways.truncated).toBe(true);
  });

  it('lists the other kind’s ways when the kind asked for lands nowhere, so its refusal offers that kind', () => {
    const tip = splitTip(THREE, [way([0], false, true), way([1], false, true), way([2], false, false)]);
    expect(listed(tip, reverseLandingWays(tip, 'inside'))).toEqual([[1], [0]]);
  });

  it('keeps one way, the first, when none lands and none is undecided: the stepper hides', () => {
    const tip = splitTip(THREE, [way([0], false, false), way([1], false, false), way([2], false, false)]);
    const ways = reverseLandingWays(tip, null);
    expect(listed(tip, ways)).toEqual([[0]]);
    expect(ways.length).toBe(1);
  });

  it('is the engine’s own list without landings', () => {
    const tip = splitTip(THREE, null);
    expect(listed(tip, reverseLandingWays(tip, 'inside'))).toEqual([[0], [1], [2]]);
  });

  it('keeps the way on screen when a kind is chosen, and takes the first when it does not land as that kind', () => {
    const tip = splitTip(THREE, [way([0], false, true), way([1], true, true), way([2], false, true)]);
    const either = reverseLandingWays(tip, null);
    const shown = either.at(2)!;
    expect(listed(tip, reverseLandingWays(tip, 'outside'))[openingForKind(tip, shown, 'outside')]).toEqual([2]);
    expect(openingForKind(tip, shown, 'inside')).toBe(0);
  });

  it('names the flaps the tip cannot be folded without by the engine’s flap index', () => {
    const tip = splitTip([[[1, 1]], [[2, 2]]], [], { locked: [4] });
    expect(lockedFlaps(tip)).toEqual([{ faces: [1], witness: [1, 0] }]);
    expect(lockedFlaps(splitTip([[[1, 1]]], null))).toEqual([]);
  });
});
