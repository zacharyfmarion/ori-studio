import { describe, expect, it } from 'vitest';
import { boundaryKey, diagramJoins, foldMergeLayout, type FoldMergeKind } from './foldMergeLayout';
import type { FoldMergedRun, FoldStepGroup } from './foldStepMerge';

/** Four corners, each the mirror image of the first. */
const CORNERS: FoldStepGroup = {
  steps: ['c1', 'c2', 'c3', 'c4'],
  related: [[], ['mirror'], ['mirror', 'mirror'], ['mirror', 'mirror', 'mirror']],
};
/** A strip's two ends, the second the first turned half a turn. */
const ENDS: FoldStepGroup = { steps: ['e1', 'e2'], related: [[], ['turn']] };
/** Two precreases and a Repeat of them. */
const REPEAT: FoldMergedRun = { steps: ['p1', 'p2', 'r'], kind: 'repeat' };

/** Joined as Merge symmetric steps starts: mirror images and Repeats, never a turned copy. */
const starting = (_key: string, kind: FoldMergeKind) => kind !== 'turn';

describe('foldMergeLayout', () => {
  it('draws mirror images and a Repeat run as one card each, and offers a turned copy apart', () => {
    const layout = foldMergeLayout([CORNERS, ENDS], [REPEAT], starting);
    expect(layout.runs).toEqual([
      { steps: ['c1', 'c2', 'c3', 'c4'], kind: 'mirror' },
      { steps: ['p1', 'p2', 'r'], kind: 'repeat' },
    ]);
    expect([...layout.offers]).toEqual([['e1', { key: boundaryKey('e1', 'e2'), kind: 'turn' }]]);
  });

  it('parts a run where a place is split, and offers it back', () => {
    const split = boundaryKey('c2', 'c3');
    const layout = foldMergeLayout([CORNERS], [], (key, kind) => key !== split && starting(key, kind));
    expect(layout.runs).toEqual([
      { steps: ['c1', 'c2'], kind: 'mirror' },
      { steps: ['c3', 'c4'], kind: 'mirror' },
    ]);
    expect(layout.offers.get('c2')).toEqual({ key: split, kind: 'mirror' });
  });

  it('draws every step apart with nothing joined, each offering to join the next', () => {
    const layout = foldMergeLayout([CORNERS], [REPEAT], () => false);
    expect(layout.runs).toEqual([]);
    expect([...layout.offers.keys()]).toEqual(['c1', 'c2', 'c3', 'p2']);
    // A Repeat joins whole, at the place before the Repeat.
    expect(layout.offers.get('p2')).toEqual({ key: boundaryKey('p2', 'r'), kind: 'repeat' });
  });

  it('joins a turned copy once asked, as a turn', () => {
    const layout = foldMergeLayout([ENDS], [], () => true);
    expect(layout.runs).toEqual([{ steps: ['e1', 'e2'], kind: 'turn' }]);
    expect(layout.offers.size).toBe(0);
  });

  it('never joins a step that repeats none of its run, whatever is asked', () => {
    // c3 repeats only c1: with c1 apart, c2–c3 cannot be one step.
    const sparse: FoldStepGroup = { steps: ['c1', 'c2', 'c3'], related: [[], ['mirror'], ['mirror', null]] };
    const layout = foldMergeLayout([sparse], [], (key) => key !== boundaryKey('c1', 'c2'));
    expect(layout.runs).toEqual([]);
    // c2 and c3 would not be one step, so the place between them offers nothing; c1 and c2 would.
    expect(layout.offers.has('c2')).toBe(false);
    expect(layout.offers.get('c1')).toEqual({ key: boundaryKey('c1', 'c2'), kind: 'mirror' });
  });
});

describe('diagramJoins', () => {
  const path = ['s1', 's2', 's3', 's4', 's5'];

  it('joins every place inside a run the diagram drew as one, and splits two steps it drew apart', () => {
    const joins = diagramJoins(
      [
        { step: 's1', through: 's3', moment: 'before' },
        { step: 's4', moment: 'before' },
        { step: 's5', moment: 'before' },
        // Finished: the state after the last step, no place of it.
        { step: 's5', moment: 'after' },
      ],
      path
    );
    expect(Object.fromEntries(joins)).toEqual({
      [boundaryKey('s1', 's2')]: true,
      [boundaryKey('s2', 's3')]: true,
      [boundaryKey('s4', 's5')]: false,
    });
  });

  it('says nothing of steps the diagram has not drawn, or not on the path', () => {
    expect(diagramJoins([{ step: 'gone', through: 's2', moment: 'before' }, { step: 's2', moment: 'before' }], path).size).toBe(0);
  });
});
