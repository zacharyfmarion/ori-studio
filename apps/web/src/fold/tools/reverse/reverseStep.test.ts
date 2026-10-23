import { describe, expect, it } from 'vitest';
import type { FoldOpening, FoldReverseAnalysis } from '../../engine/foldEngineReverseWire';
import { chosenAt, reverseKindToFold, reverseOpenWays } from './reverseStep';

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
