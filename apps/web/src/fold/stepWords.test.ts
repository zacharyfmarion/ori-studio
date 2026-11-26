import { describe, expect, it } from 'vitest';
import i18n from '../i18n';
import type { FoldSentenceStep } from './stepSentence';
import {
  cpOriginLabel,
  creaseDiffLines,
  extentLabel,
  lineLabel,
  operationBadge,
  operationLabel,
  secondLineLabel,
  type FoldCreaseDiff,
} from './stepWords';

const t = i18n.t.bind(i18n);

const ALL = { kind: 'all' } as const;
const fold = (direction: 'valley' | 'mountain'): FoldSentenceStep => ({
  op: 'fold',
  direction,
  line: { via: 'axiom', axiom: 2, inputs: [] },
  scope: ALL,
});
const NO_CHANGE: FoldCreaseDiff = {
  added: { mountain: 0, valley: 0, flat: 0 },
  refolded: 0,
  reversed: 0,
  unfolded: 0,
};

describe('operationLabel and operationBadge', () => {
  it('name each operation, a turn in its card’s words', () => {
    const steps: FoldSentenceStep[] = [
      fold('valley'),
      fold('mountain'),
      { op: 'precrease', direction: 'valley', line: { via: 'free' }, scope: ALL },
      { op: 'precrease', direction: 'mountain', line: { via: 'free' }, scope: ALL },
      { op: 'unfold', direction: 'valley', scope: ALL },
      { op: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } },
      { op: 'turn', turn: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'ccw' } } },
      { op: 'cp-jump' },
      { op: 'crimp', crimp: 'inside', line: { via: 'free' }, second: 'free', scope: ALL },
      { op: 'crimp', crimp: 'outside', line: { via: 'free' }, second: 'crease', scope: ALL },
      { op: 'tuck', direction: 'valley', line: { via: 'free' } },
      { op: 'tuck', direction: 'mountain', line: { via: 'free' } },
      { op: 'unknown' },
    ];
    expect(steps.map((step) => operationLabel(t, step))).toEqual([
      'Valley fold',
      'Mountain fold',
      'Valley fold and unfold',
      'Mountain fold and unfold',
      'Unfold',
      'Turn over, side to side',
      'Rotate 1/4 turn counterclockwise',
      'Import crease pattern',
      'Inside crimp',
      'Outside crimp',
      'Valley fold and tuck',
      'Mountain fold and tuck',
      'From a newer Ori Studio',
    ]);
    expect(steps.map((step) => operationBadge(t, step))).toEqual([
      'Valley',
      'Mountain',
      'Precrease',
      'Precrease',
      'Unfold',
      'Turn over',
      'Rotate',
      'Imported',
      'Crimp',
      'Crimp',
      'Tuck',
      'Tuck',
      'Newer',
    ]);
  });
});

describe('lineLabel', () => {
  it('says how the line was found, and nothing for a step without one', () => {
    expect(lineLabel(t, fold('valley'))).toBe('Axiom 2 · point onto point');
    expect(lineLabel(t, { op: 'precrease', direction: 'valley', line: { via: 'free' }, scope: ALL })).toBe(
      'Free line'
    );
    expect(lineLabel(t, { op: 'fold', direction: 'valley', line: { via: 'crease' }, scope: ALL })).toBe(
      'Existing crease'
    );
    // An unfold is always along a bend.
    expect(lineLabel(t, { op: 'unfold', direction: 'valley', scope: ALL })).toBe('Existing crease');
    expect(lineLabel(t, { op: 'turn', turn: { kind: 'turn-over', axis: 'vertical' } })).toBeNull();
    expect(lineLabel(t, { op: 'cp-jump' })).toBeNull();
    // A sink's line is found as a fold's; an unsink's is the ring's crease.
    expect(lineLabel(t, { op: 'sink', kind: 'open', line: { via: 'free' } })).toBe('Free line');
    expect(lineLabel(t, { op: 'sink', kind: 'unsink', line: { via: 'crease' } })).toBe('Existing crease');
    // A tuck's line is found as a fold's.
    expect(lineLabel(t, { op: 'tuck', direction: 'valley', line: { via: 'free' } })).toBe('Free line');
  });

  it('names both a crimp’s lines, its second only by secondLineLabel', () => {
    const crimp: FoldSentenceStep = {
      op: 'crimp',
      crimp: 'inside',
      line: { via: 'axiom', axiom: 1, inputs: [] },
      second: 'crease',
      scope: { kind: 'all' },
    };
    expect(lineLabel(t, crimp)).toBe('Axiom 1 · through two points');
    expect(secondLineLabel(t, crimp)).toBe('Existing crease');
    expect(secondLineLabel(t, { ...crimp, second: 'free' })).toBe('Free line');
    expect(secondLineLabel(t, fold('valley'))).toBeNull();
  });
});

describe('a sink’s words', () => {
  it('names each sink, label and badge alike', () => {
    const steps: FoldSentenceStep[] = (['open', 'closed', 'unsink'] as const).map((kind) => ({
      op: 'sink',
      kind,
      line: { via: 'free' },
    }));
    const names = ['Open sink', 'Closed sink', 'Unsink'];
    expect(steps.map((step) => operationLabel(t, step))).toEqual(names);
    expect(steps.map((step) => operationBadge(t, step))).toEqual(names);
  });
});

describe('creaseDiffLines', () => {
  it('says a fold’s new creases with their letters, as the design does', () => {
    expect(creaseDiffLines(t, { ...NO_CHANGE, added: { mountain: 2, valley: 2, flat: 0 } })).toEqual([
      'Adds 4 creases (2 M, 2 V)',
    ]);
    expect(creaseDiffLines(t, { ...NO_CHANGE, added: { mountain: 0, valley: 1, flat: 0 } })).toEqual([
      'Adds 1 crease (0 M, 1 V)',
    ]);
  });

  it('gives each kind of change a line of its own, in order', () => {
    expect(
      creaseDiffLines(t, {
        added: { mountain: 1, valley: 0, flat: 3 },
        refolded: 2,
        reversed: 1,
        unfolded: 4,
      })
    ).toEqual([
      'Adds 1 crease (1 M, 0 V)',
      'Adds 3 precreases',
      'Refolds 2 precreases',
      'Refolds 1 precrease the other way',
      'Unfolds 4 creases',
    ]);
  });

  it('says a step that changes nothing does so', () => {
    expect(creaseDiffLines(t, NO_CHANGE)).toEqual(['Changes no creases']);
  });

  it('counts a partial precrease’s marks, a pinch’s by that name', () => {
    const pinch: FoldSentenceStep = {
      op: 'precrease',
      direction: 'valley',
      line: { via: 'free' },
      scope: ALL,
      extent: { kind: 'pinch', at: { kind: 'point' } },
    };
    const segment: FoldSentenceStep = { ...pinch, extent: { kind: 'segment', from: { kind: 'point' }, to: { kind: 'point' } } };
    expect(creaseDiffLines(t, { ...NO_CHANGE, marks: 2 }, pinch)).toEqual(['Adds 2 pinch marks']);
    expect(creaseDiffLines(t, { ...NO_CHANGE, marks: 1 }, segment)).toEqual(['Adds 1 crease mark']);
    expect(creaseDiffLines(t, { ...NO_CHANGE, marks: 0 }, pinch)).toEqual(['Changes no creases']);
  });
});

describe('extentLabel', () => {
  it('says how much of its line a precrease creased, and nothing for any other step', () => {
    const precrease: FoldSentenceStep = { op: 'precrease', direction: 'valley', line: { via: 'free' }, scope: ALL };
    expect(extentLabel(t, precrease)).toBe('Whole line');
    expect(extentLabel(t, { ...precrease, extent: { kind: 'pinch', at: { kind: 'point' } } })).toBe('Pinch');
    expect(
      extentLabel(t, { ...precrease, extent: { kind: 'segment', from: { kind: 'point' }, to: { kind: 'point' } } })
    ).toBe('Segment');
    expect(extentLabel(t, fold('valley'))).toBeNull();
  });
});

describe('cpOriginLabel', () => {
  it('names every origin Import CP records', () => {
    expect(
      (['cp', 'fold', 'ori', 'orh', 'sample', 'edit_folded_figure'] as const).map((origin) =>
        cpOriginLabel(t, origin)
      )
    ).toEqual(['CP file', 'FOLD file', 'ORI file', 'ORH file', 'Sample', 'Edit’s folded figure']);
  });
});
