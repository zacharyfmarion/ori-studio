import { describe, expect, it } from 'vitest';
import { flatSquareLandmarks, flatSquareScene } from '../../canvas/foldCanvas.fixtures';
import { foldPickIndex, resolveFoldPick, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldTuckAnalysis, FoldTuckTarget } from '../../engine/foldEngineCrimpTuckWire';
import {
  buildTuckStep,
  steppedTuckTarget,
  TUCK_TARGET_UNASKED,
  tuckTargetChosen,
  tuckTargetsOf,
  type FoldTuckIntent,
} from './tuckStep';

const RADII = { point: 0.03, line: 0.03 };
const FREE = { snap: 'free', edges: false, free: false } as const;

function free(index: FoldPickIndex, x: number, y: number): FoldPick {
  const pick = resolveFoldPick(index, 'folded', { x, y }, RADII, FREE);
  if (!pick) throw new Error(`nothing at ${x}, ${y}`);
  return pick;
}

const target = (face: number, feasible: boolean | null): FoldTuckTarget => ({ face, at: [face / 10, 0.5], feasible });

function analysis(targets: FoldTuckTarget[]): FoldTuckAnalysis {
  return {
    line: { n: [0, 1], d: 0.5 },
    side: 'positive',
    snap: { clusters: 0, angle: 0, max_shift: 0 },
    direction: 'valley',
    placement: 'under',
    moving: [1],
    targets,
  };
}

describe('the tuck’s step', () => {
  it('folds along its line against the target taken, or the one its targets are asked with', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const intent: FoldTuckIntent = {
      lineMode: 'free',
      picks: [free(index, 0.2, 0.7), free(index, 0.8, 0.7)],
      candidate: null,
      swapped: false,
      seed: { scope: 'all' },
      direction: 'mountain',
      target: null,
      completion: null,
    };
    const unaimed = buildTuckStep(intent, index);
    if (unaimed.status !== 'built') throw new Error(unaimed.status);
    expect(unaimed.op).toMatchObject({ kind: 'tuck', direction: 'mountain', target: TUCK_TARGET_UNASKED, line: { via: 'free' } });
    expect(unaimed.choices).toBeUndefined();
    const order = { faces: [[0.1, 0.1] as [number, number]], orders: [] };
    const aimed = buildTuckStep({ ...intent, target: [0.3, 0.2], completion: order }, index);
    if (aimed.status !== 'built') throw new Error(aimed.status);
    expect(aimed.op).toMatchObject({ kind: 'tuck', target: [0.3, 0.2] });
    expect(aimed.choices).toEqual({ completion: order });
    // Unlocated until both clicks are in.
    expect(buildTuckStep({ ...intent, picks: intent.picks.slice(0, 1) }, index)).toEqual({ status: 'unlocated' });
  });

  it('offers only the layers that take the tuck — those found to, then those left undecided — never the rest', () => {
    const listed = analysis([target(4, null), target(2, true), target(3, false), target(1, true)]);
    expect(tuckTargetsOf(listed).map((each) => each.face)).toEqual([2, 1, 4]);
    expect(tuckTargetsOf(analysis([target(3, false)]))).toEqual([]);
    expect(tuckTargetsOf(null)).toEqual([]);
  });

  it('takes the folder’s target while it is offered, else the first, and steps round the list', () => {
    const offered = tuckTargetsOf(analysis([target(2, true), target(5, true), target(7, null)]));
    expect(tuckTargetChosen(offered, null)?.face).toBe(2);
    expect(tuckTargetChosen(offered, 5)?.face).toBe(5);
    // A face no longer offered (another seed, another side) falls back to the first.
    expect(tuckTargetChosen(offered, 9)?.face).toBe(2);
    expect(tuckTargetChosen([], 5)).toBeNull();
    expect(steppedTuckTarget(offered, 2, 1)).toBe(5);
    expect(steppedTuckTarget(offered, 7, 1)).toBe(2);
    expect(steppedTuckTarget(offered, 2, -1)).toBe(7);
    // From the first, while none is chosen.
    expect(steppedTuckTarget(offered, null, 1)).toBe(5);
    expect(steppedTuckTarget([], 2, 1)).toBeNull();
  });
});
