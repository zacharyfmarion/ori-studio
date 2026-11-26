import { describe, expect, it } from 'vitest';
import type { FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { foldStepGroups, isMergeableStep, runRelation, startingRuns, type FoldStepGroup } from './foldStepMerge';

/** A square's four corners: each mirrors the first. */
const CORNERS: FoldStepGroup = {
  steps: ['c1', 'c2', 'c3', 'c4'],
  related: [[], ['mirror'], ['mirror', 'mirror'], ['mirror', null, 'mirror']],
};
/** A strip's two ends: the second the first turned half a turn. */
const ENDS: FoldStepGroup = { steps: ['e1', 'e2'], related: [[], ['turn']] };
/** A fold, its turned copy, and a mirror image of the copy only. */
const MIXED: FoldStepGroup = { steps: ['a', 'b', 'c'], related: [[], ['turn'], [null, 'mirror']] };

describe('runRelation', () => {
  it('draws a run as one while each step repeats one before it in the run', () => {
    expect(runRelation(CORNERS, 0, 3)).toBe('mirror');
    expect(runRelation(CORNERS, 1, 2)).toBe('mirror');
    expect(runRelation(ENDS, 0, 1)).toBe('turn');
    expect(runRelation(MIXED, 0, 2)).toBe('turn');
    expect(runRelation(MIXED, 1, 2)).toBe('mirror');
  });

  it('refuses a run with a step that repeats none before it in the run, and a run of one', () => {
    // c4 mirrors c1 and c3, not c2.
    expect(runRelation(CORNERS, 1, 3)).toBe('mirror');
    expect(runRelation({ ...CORNERS, related: [[], ['mirror'], [null, null], []] }, 1, 2)).toBeNull();
    expect(runRelation(CORNERS, 2, 2)).toBeNull();
    expect(runRelation(CORNERS, 0, 4)).toBeNull();
  });
});

describe('startingRuns', () => {
  it('starts mirror images merged and turned copies apart', () => {
    expect(startingRuns(CORNERS, true)).toEqual([[0, 3]]);
    expect(startingRuns(ENDS, true)).toEqual([
      [0, 0],
      [1, 1],
    ]);
    expect(startingRuns(MIXED, true)).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });

  it('starts every step apart with mirror images not merged', () => {
    expect(startingRuns(CORNERS, false)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });
});

describe('isMergeableStep', () => {
  const step = (kind: string) => ({ id: 's', parent: null, op: { kind } }) as unknown as FoldStepNode;

  it('takes any move of paper; a turn, a rotation, a collapse, an unfold to a step or a Repeat ends a group', () => {
    for (const kind of ['valley', 'mountain', 'precrease', 'unfold', 'inside-reverse', 'squash', 'swivel']) {
      expect(isMergeableStep(step(kind))).toBe(true);
    }
    for (const kind of ['turn', 'rotate', 'cp-jump', 'unfold-to', 'repeat']) expect(isMergeableStep(step(kind))).toBe(false);
  });

  it('takes no step a newer build wrote, and nothing', () => {
    expect(isMergeableStep({ id: 'x', parent: null, unknown: { op: { kind: 'valley' } } })).toBe(false);
    expect(isMergeableStep(null)).toBe(false);
  });
});

describe('foldStepGroups', () => {
  it('groups nothing that has not landed or cannot be drawn with others', () => {
    const path = [
      { id: 's1', mergeable: true, before: null, after: null },
      { id: 'turn', mergeable: false, before: null, after: null },
      { id: 's2', mergeable: true, before: null, after: null },
    ];
    expect(foldStepGroups(path)).toEqual([]);
  });
});
