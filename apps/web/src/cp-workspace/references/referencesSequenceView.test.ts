import { describe, expect, it } from 'vitest';
import type { ReferencesFlatStep } from './referencesBreakdown';
import type { PrecreaseSequence, PrecreaseSide, PrecreaseStep } from './precreaseSequence';
import type { ReferencesPlanVariant } from './referencesResults';
import {
  planStepOf,
  referencesViewSteps,
  sideAt,
  turnOverCount,
} from './referencesSequenceView';

function step(id: number, side: PrecreaseSide): PrecreaseStep {
  return {
    id,
    kind: 'cp',
    tag: 'cp',
    line: { n: [1, 0], d: 0 },
    line_id: id,
    segment: [
      [0, 0],
      [1, 0],
    ],
    extent: { kind: 'full' },
    witnesses: [],
    chosen: null,
    ease: 0,
    hard: false,
    err: 0,
    direction: side === 'back' ? 'mountain' : 'valley',
    direction_share: 1,
    side,
    unlocks: [],
    cp_line_ids: [id],
    cp_spans: [],
    visible: true,
    witnesses_complete: true,
    marks_exist: true,
    missing_marks: [],
    exact: true,
    pressed_on: [],
    made: [],
    impractical: false,
    hoisted: false,
    card: id,
  };
}

/** A plan whose steps run through the given sides: `'FFBF'`. */
function planOf(sides: string): {
  variants: ReferencesPlanVariant[];
  flat: ReferencesFlatStep[];
} {
  const steps = [...sides].map((c, i) => step(i + 1, c === 'B' ? 'back' : 'front'));
  const variants = [
    {
      sequence: { steps, sheet: { width: 1, height: 1 } } as unknown as PrecreaseSequence,
      model: { steps: [], points: [], edges: {}, findings: [] } as unknown as
        ReferencesPlanVariant['model'],
    },
  ];
  return { variants, flat: steps.map((_, index) => ({ component: 0, step: index })) };
}

const view = (sides: string) => {
  const { variants, flat } = planOf(sides);
  return referencesViewSteps(variants, flat);
};

describe('a twin pair in the view steps', () => {
  // The crate places a fold's mirror image right after it and names each in
  // the other's `twin`; the reader passes the two as one card.
  it('folds the second of a pair into the first\'s view step', () => {
    const { variants, flat } = planOf('FFFF');
    const steps = variants[0]!.sequence.steps;
    steps[1] = { ...steps[1]!, twin: steps[2]!.id };
    steps[2] = { ...steps[2]!, twin: steps[1]!.id };
    const view = referencesViewSteps(variants, flat);
    const folds = view.filter((v) => v.kind === 'fold');
    expect(folds).toHaveLength(3);
    expect(folds[1]).toEqual({ kind: 'fold', side: 'front', component: 0, step: 1, twin: 2 });
    expect(folds[2]).toEqual({ kind: 'fold', side: 'front', component: 0, step: 3 });
  });

  it('keeps a pair apart when the twin is not the next step on the same side', () => {
    const { variants, flat } = planOf('FFBF');
    const steps = variants[0]!.sequence.steps;
    steps[1] = { ...steps[1]!, twin: steps[2]!.id };
    steps[2] = { ...steps[2]!, twin: steps[1]!.id };
    const folds = referencesViewSteps(variants, flat).filter((v) => v.kind === 'fold');
    expect(folds).toHaveLength(4);
    expect(folds.every((f) => !('twin' in f))).toBe(true);
  });
});

describe('referencesViewSteps', () => {
  it('is empty without a planned sheet', () => {
    expect(referencesViewSteps([], [])).toEqual([]);
  });

  it('ends a planned sheet with no folds on its ending card', () => {
    // A plan that stopped before its first fold has nothing to show but why.
    const { variants } = planOf('');
    expect(referencesViewSteps(variants, [])).toEqual([
      { kind: 'done', side: 'front', component: 0 },
    ]);
  });

  it('adds no turn-over to a plan folded entirely from the front', () => {
    expect(view('FFF').map((s) => s.kind)).toEqual(['fold', 'fold', 'fold', 'done']);
    expect(turnOverCount(view('FFF'))).toBe(0);
  });

  // The sheet starts front side up, so a plan that opens with a mountain opens
  // by turning the paper over.
  it('opens with a turn-over when the first fold is on the back', () => {
    const steps = view('BB');
    expect(steps.map((s) => s.kind)).toEqual(['turn-over', 'fold', 'fold', 'turn-over', 'done']);
    expect(steps.map((s) => s.side)).toEqual(['front', 'back', 'back', 'back', 'front']);
  });

  it('turns over between blocks, not once at the end', () => {
    const steps = view('FFBBFF');
    expect(steps.map((s) => s.kind)).toEqual([
      'fold',
      'fold',
      'turn-over',
      'fold',
      'fold',
      'turn-over',
      'fold',
      'fold',
      'done',
    ]);
    expect(turnOverCount(steps)).toBe(2);
  });

  // The pattern's assignment is stated from the front, so that is the side it
  // is read from however the folding ended.
  it('closes on the front when the last block is on the back', () => {
    const steps = view('FFB');
    expect(steps.map((s) => s.kind)).toEqual(['fold', 'fold', 'turn-over', 'fold', 'turn-over', 'done']);
    expect(steps[steps.length - 1]?.side).toBe('front');
  });

  it('shows a turn-over on the face it is leaving', () => {
    const steps = view('FB');
    const turn = steps.find((s) => s.kind === 'turn-over');
    expect(turn?.side).toBe('front');
    expect(sideAt(steps, steps.indexOf(turn!) + 1)).toBe('back');
  });

  // The card draws the build-up so far, so it has to know where "so far" ends.
  it('says which planner step the build-up has reached', () => {
    const steps = view('FFB');
    const turns = steps.filter((s) => s.kind === 'turn-over');
    expect(turns.map((s) => (s.kind === 'turn-over' ? s.after : null))).toEqual([1, 2]);
  });

  it('opens with a turn-over that has nothing folded behind it', () => {
    const first = view('B')[0];
    expect(first?.kind).toBe('turn-over');
    expect(first?.kind === 'turn-over' && first.after).toBeNull();
  });
});

describe('planStepOf', () => {
  it('addresses the planner only for a fold', () => {
    const steps = view('FB');
    expect(planStepOf(steps[0]!)).toEqual({ component: 0, step: 0 });
    // A turn-over and the finished card name no planner step: they are not
    // folds, and a caller that indexed `sequence.steps` with them would read
    // the wrong one.
    for (const s of steps.filter((s) => s.kind !== 'fold')) {
      expect(planStepOf(s)).toBeNull();
    }
  });
});
