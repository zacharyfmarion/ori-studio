import { describe, expect, it } from 'vitest';

import { step, valleyAt } from '../../fold/document/foldSequence.fixtures';
import type { FoldOp, FoldPrecreaseOp, FoldRepeatOp, FoldStepNode } from '../../fold/document/foldSequenceDocument';
import type { FoldPullTarget } from './foldPull';
import { isRepeatRun, mergedPullTargets, precreaseRepeatRuns } from './foldPrecreaseMerge';

/** A precrease of the vertical line at `x`, the part left of it moving. */
const precreaseAt = (x: number, extent?: FoldPrecreaseOp['extent']): FoldPrecreaseOp => ({
  kind: 'precrease',
  direction: 'valley',
  line: { via: 'free', through: [[x, 0], [x, 1]] },
  moving: [x / 2, 0.5],
  seed: { scope: 'all' },
  ...(extent ? { extent } : {}),
});

/** A Repeat of `first`..`last` across the sheet's vertical middle, its steps `entries`. */
const repeatOf = (first: string, last: string, entries: FoldOp[] = [precreaseAt(0.8)]): FoldRepeatOp => ({
  kind: 'repeat',
  source: { first, last, revision: 'fh1:range' },
  parentState: 'fs1:parent',
  axis: { n: [1, 0], d: 0.5 },
  steps: entries.map((op) => ({ op, expect: 'fs1:entry', sourceStep: first })),
});

/** A path of nodes, each folding from the one before it. */
function path(...ops: FoldOp[]): FoldStepNode[] {
  return ops.map((op, index) => step(`s${index + 1}`, index === 0 ? null : `s${index}`, op));
}

describe('what can merge along a path', () => {
  it('takes a precrease and the Repeat of it straight after as one run, from the document alone', () => {
    const steps = path(valleyAt(0.5), precreaseAt(0.2), repeatOf('s2', 's2'));
    expect(precreaseRepeatRuns(steps)).toEqual([{ steps: ['s2', 's3'], kind: 'repeat' }]);
  });

  it('takes a run of precreases and the Repeat of the whole run, a pinch and a segment among them', () => {
    const pinch = precreaseAt(0.3, { kind: 'pinch', at: { kind: 'point', at: [0.3, 0.5] }, length: 0.06 });
    const steps = path(precreaseAt(0.1), pinch, repeatOf('s1', 's2', [precreaseAt(0.9), precreaseAt(0.7)]));
    expect(precreaseRepeatRuns(steps)).toEqual([{ steps: ['s1', 's2', 's3'], kind: 'repeat' }]);
  });

  it.each([
    ['its range holds a fold that moves paper', path(valleyAt(0.5), precreaseAt(0.2), repeatOf('s1', 's2'))],
    ['its range is not the steps just before it', path(precreaseAt(0.2), precreaseAt(0.3), repeatOf('s1', 's1'))],
    ['it repeats a fold, not a precrease', path(precreaseAt(0.2), repeatOf('s1', 's1', [valleyAt(0.5)]))],
    ['its range is not on the path', path(precreaseAt(0.2), repeatOf('gone', 'gone'))],
  ])('takes no Repeat when %s', (_label, steps) => {
    expect(precreaseRepeatRuns(steps)).toEqual([]);
  });

  it('tells a Repeat run from the document alone: precreases, then a Repeat of precreases', () => {
    const [p1, p2, r] = path(precreaseAt(0.2), precreaseAt(0.8), repeatOf('s1', 's2'));
    expect(isRepeatRun([p1!, p2!, r!])).toBe(true);
    expect(isRepeatRun([p2!, r!])).toBe(true);
    // Two precreases alone are the scenes' to tell (`foldStepMerge.ts`), and so is any fold.
    expect(isRepeatRun([p1!, p2!])).toBe(false);
    expect(isRepeatRun([p1!])).toBe(false);
    const [q1, fold] = path(precreaseAt(0.2), valleyAt(0.5));
    expect(isRepeatRun([q1!, fold!])).toBe(false);
    expect(isRepeatRun([r!, p1!])).toBe(false);
  });
});

describe('a merge as Send steps to Diagram sends it', () => {
  const before = (id: string): FoldPullTarget => ({ kind: 'step', step: id, moment: 'before' });

  it('makes each merge’s steps, sent one after another, one target naming the run', () => {
    const targets: FoldPullTarget[] = [before('s1'), before('s2'), { kind: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } }, before('s3'), { kind: 'step', step: 's3', moment: 'after' }];
    expect(mergedPullTargets(targets, [{ steps: ['s1', 's2'], kind: 'mirror' }])).toEqual([
      { kind: 'step', step: 's1', through: 's2', moment: 'before' },
      targets[2],
      targets[3],
      targets[4],
    ]);
  });

  it('sends a merge only some of whose steps are sent as its steps', () => {
    const targets = [before('s1')];
    expect(mergedPullTargets(targets, [{ steps: ['s1', 's2'], kind: 'mirror' }])).toEqual(targets);
    expect(mergedPullTargets([before('s2')], [{ steps: ['s1', 's2'], kind: 'mirror' }])).toEqual([before('s2')]);
  });
});
