import { describe, expect, it } from 'vitest';
import { bookScene, flatSquareLandmarks, flatSquareScene } from '../../canvas/foldCanvas.fixtures';
import { foldPickIndex, resolveFoldPick, type FoldPick, type FoldPickIndex } from '../../canvas/foldPicking';
import type { FoldCompletionChoice, FoldOpeningChoice } from '../../document/foldSequenceDocument';
import { crimpInput } from '../foldToolRegistry';
import { buildCrimpStep, crimpLines, crimpPicks, type FoldCrimpIntent } from './crimpStep';

const RADII = { point: 0.03, line: 0.03 };
const FREE = { snap: 'free', edges: false, free: false } as const;

/** A free click on the folded pane at a scene point. */
function free(index: FoldPickIndex, x: number, y: number): FoldPick {
  const pick = resolveFoldPick(index, 'folded', { x, y }, RADII, FREE);
  if (!pick) throw new Error(`nothing at ${x}, ${y}`);
  return pick;
}

function intent(picks: readonly FoldPick[], extra: Partial<FoldCrimpIntent> = {}): FoldCrimpIntent {
  return {
    lineMode: 'free',
    secondLineMode: 'free',
    picks,
    candidate: null,
    swapped: false,
    seed: { scope: 'all' },
    kind: 'inside',
    openings: [],
    completion: null,
    ...extra,
  };
}

describe('the crimp’s step', () => {
  it('takes its first line’s clicks, then its second line’s', () => {
    expect(crimpPicks({ lineMode: 'free', picks: ['a', 'b', 'c', 'd'] })).toEqual({ first: ['a', 'b'], second: ['c', 'd'] });
    // An axiom's clicks, then the second line's.
    expect(crimpPicks({ lineMode: 'axiom-5', picks: ['a', 'b', 'c', 'd'] })).toEqual({ first: ['a', 'b', 'c'], second: ['d'] });
    expect(crimpInput('axiom-2', 'crease').steps.map((step) => step.snap)).toEqual(['point', 'point', 'crease-required']);
    // One model per pair: what the click counter is kept for.
    expect(crimpInput('free', 'free')).toBe(crimpInput('free', 'free'));
  });

  it('is located only once both lines are, and stores both with its kind and choices', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const first = [free(index, 0.2, 0.6), free(index, 0.8, 0.6)];
    const second = [free(index, 0.2, 0.8), free(index, 0.8, 0.8)];
    expect(buildCrimpStep(intent(first), index)).toEqual({ status: 'unlocated' });
    expect(buildCrimpStep(intent([...first, second[0]!]), index)).toEqual({ status: 'unlocated' });

    const opening: FoldOpeningChoice = { upper: [[0.5, 0.9]] };
    const order: FoldCompletionChoice = { faces: [[0.1, 0.1]], orders: [] };
    const built = buildCrimpStep(intent([...first, ...second], { kind: 'outside', openings: [opening], completion: order }), index);
    if (built.status !== 'built') throw new Error(built.status);
    expect(built.op).toMatchObject({
      kind: 'crimp',
      crimp: 'outside',
      line: { via: 'free' },
      second: { via: 'free' },
      seed: { scope: 'all' },
    });
    // The tip is the smaller side of the first line, above it: a sheet point there says so.
    expect(built.op.kind === 'crimp' && built.op.moving?.[1]).toBeGreaterThan(0.6);
    expect(built.choices).toEqual({ opening: [opening], completion: order });
    expect(built.via).toBe('free');
  });

  it('names its second line by a crease, in that mode', () => {
    const index = foldPickIndex(bookScene(), null, []);
    // The book's bend is the line x = ½: the first line across the folded
    // form, the second along the bend, by a sheet point inside it.
    const first = [free(index, 0.1, 0.6), free(index, 0.4, 0.3)];
    const bend: FoldPick = {
      kind: 'segment',
      edge: 6,
      segment: 'bend',
      sheet: [
        [0.5, 0],
        [0.5, 1],
      ],
      scene: [
        { x: 0.5, y: 0 },
        { x: 0.5, y: 1 },
      ],
    };
    const built = buildCrimpStep(intent([...first, bend], { secondLineMode: 'crease' }), index);
    if (built.status !== 'built' || built.op.kind !== 'crimp') throw new Error(built.status);
    expect(built.op.second).toEqual({ via: 'crease', at: [0.5, 0.5] });
    expect(built.op.line.via).toBe('free');
  });

  it('refuses a second line drawn off the paper, which misses the tip', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const first = [free(index, 0.2, 0.6), free(index, 0.8, 0.6)];
    const off = [free(index, 1.5, 1.5), free(index, 1.6, 1.8)];
    const built = buildCrimpStep(intent([...first, ...off]), index);
    expect(built).toMatchObject({ status: 'refused', refused: { refusal: { code: 'crimp_misses_tip' } } });
  });

  it('draws each line across the paper once it is located', () => {
    const index = foldPickIndex(flatSquareScene(), flatSquareLandmarks(), []);
    const first = [free(index, 0.2, 0.6), free(index, 0.8, 0.6)];
    const located = crimpLines(intent(first), index);
    expect(located.second).toBeNull();
    // From edge to edge of the sheet, along y = 0.6.
    expect(located.first?.map((point) => Math.round(point.y * 1e6) / 1e6)).toEqual([0.6, 0.6]);
    expect(Math.abs((located.first?.[0]?.x ?? 0) - (located.first?.[1]?.x ?? 0))).toBeCloseTo(1, 6);
    const both = crimpLines(intent([...first, free(index, 0.2, 0.8), free(index, 0.8, 0.8)]), index);
    expect(both.second?.map((point) => Math.round(point.y * 1e6) / 1e6)).toEqual([0.8, 0.8]);
  });
});
