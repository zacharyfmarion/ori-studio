import { describe, expect, it } from 'vitest';
import type { FoldSceneCrease, FoldStepSummary } from '../engine/foldEngineWire';
import { foldCreaseDiff } from './foldStepDiff';

const crease = (id: number, kind: FoldSceneCrease['kind'], letter: FoldSceneCrease['letter']): FoldSceneCrease => ({
  id,
  vertices: [0, 1],
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  kind,
  letter,
  made_at: 1,
});

const creases = new Map(
  [
    crease(1, 'fold', 'mountain'),
    crease(2, 'fold', 'valley'),
    crease(3, 'fold', 'valley'),
    crease(4, 'flat', 'valley'),
    crease(5, 'border', null),
  ].map((each) => [each.id, each])
);

const summary = (diff: Partial<FoldStepSummary['diff']>): FoldStepSummary => ({
  counts: { mountain: 1, valley: 2, flat: 1 },
  diff: { added: [], reversed: [], unfolded: [], refolded: [], ...diff },
  layers: 2,
});

describe('foldCreaseDiff', () => {
  it('counts the creases a step added by their letters in the landed state, a precrease’s as flat', () => {
    expect(foldCreaseDiff(summary({ added: [1, 2, 3, 4, 5] }), creases)).toEqual({
      added: { mountain: 1, valley: 2, flat: 1 },
      refolded: 0,
      reversed: 0,
      unfolded: 0,
    });
  });

  it('splits the refolds by the way they went, and counts a crease reversed while folded the other way', () => {
    const diff = foldCreaseDiff(
      summary({
        refolded: [
          { edge: 2, remembered: 'valley', letter: 'valley' },
          { edge: 1, remembered: 'valley', letter: 'mountain' },
        ],
        reversed: [3],
        unfolded: [4],
      }),
      creases
    );
    expect(diff).toEqual({ added: { mountain: 0, valley: 0, flat: 0 }, refolded: 1, reversed: 2, unfolded: 1 });
  });

  it('is unknown until the landed state’s creases are', () => {
    expect(foldCreaseDiff(summary({ added: [1] }), null)).toBeNull();
  });
});
