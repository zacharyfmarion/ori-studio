import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import type { ExtractedStep } from './referenceFinder/extractor';
import type { RawSolution } from './referenceFinder/solution';
import type { ReferencesSheetAux } from './referencesAuxCreases';
import { flatPlanSteps } from './referencesBreakdown';
import { candidateViewSteps, type FreeDiagonal } from './referencesCandidateSteps';
import {
  candidateExportSteps,
  planExportSteps,
  referencesExportSteps,
} from './referencesExportSteps';
import { planFilmstrip } from './referencesFilmstrip';
import { decodePlanModel, planModelPoints, planStepScene } from './referencesPlanGeometry';
import type {
  ReferencesCandidateResult,
  ReferencesPlanVariant,
  ReferencesResults,
} from './referencesResults';
import { referencesViewSteps, type ReferencesViewStep } from './referencesSequenceView';
import { referencesSequenceSubject } from './referencesStepExport';
import { candidateStepDiagram, planHighlights } from './useReferencesView';

/** The planner's unit frame scaled and flipped, as `rfToModelMany` maps it. */
function mapToModel(points: Float64Array): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i]! * 400 - 200;
    out[i + 1] = 200 - points[i + 1]! * 400;
  }
  return out;
}

function variantOf(sequence: PrecreaseSequence): ReferencesPlanVariant {
  return { sequence, model: decodePlanModel(sequence, mapToModel(planModelPoints(sequence))) };
}

function readingOf(sequence: PrecreaseSequence): {
  variants: ReferencesPlanVariant[];
  viewSteps: ReferencesViewStep[];
} {
  const variants = [variantOf(sequence)];
  return { variants, viewSteps: referencesViewSteps(variants, flatPlanSteps([sequence])) };
}

/** The grid plan with its last fold made from the back: a turn-over before it and one after. */
function sequenceWithBackFold(): PrecreaseSequence {
  const sequence = plannerSequenceWithGridFixture();
  const steps = sequence.steps.map((step, index) =>
    index === 2 ? { ...step, side: 'back' as const } : step
  );
  return { ...sequence, steps };
}

/**
 * The grid plan with its fold's mirror image made at once with it, as the
 * planner pairs them when symmetric steps are merged: the right edge onto
 * y = ½ along the bisector from (1, ½) to (½, 1).
 */
function sequenceWithTwin(): PrecreaseSequence {
  const sequence = plannerSequenceWithGridFixture();
  const fold = sequence.steps[2]!;
  const mirror: PrecreaseStep = {
    ...fold,
    id: 4,
    line_id: 11,
    card: 4,
    line: { n: [Math.SQRT1_2, Math.SQRT1_2], d: 0.75 * Math.SQRT2 },
    segment: [
      [1, 0.5],
      [0.5, 1],
    ],
    witnesses: [
      {
        ...fold.witnesses[0]!,
        inputs: [
          { kind: 'edge', id: 1, side: 'right' },
          { kind: 'line', id: 8 },
        ],
      },
    ],
    cp_line_ids: [6],
    cp_spans: [
      [
        [1, 0.5],
        [0.5, 1],
      ],
    ],
    twin: fold.id,
  };
  return {
    ...sequence,
    steps: [...sequence.steps.slice(0, 2), { ...fold, twin: mirror.id }, mirror],
    lines: [...sequence.lines, { id: 11, tag: 'cp', step: 4 }],
  };
}

const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

/** One aux line across the middle of sheet `component`. */
function aux(component: number): ReferencesSheetAux {
  const segment = [
    { x: -200, y: 0 },
    { x: 200, y: 0 },
  ] as const;
  return { component, ids: new Set(), unit: [], model: [segment] };
}

describe('planExportSteps', () => {
  it('takes every card with a picture, turn-overs in and the finished card out', () => {
    const { variants, viewSteps } = readingOf(sequenceWithBackFold());
    expect(viewSteps.map((step) => step.kind)).toEqual([
      'fold',
      'fold',
      'turn-over',
      'fold',
      'turn-over',
      'done',
    ]);
    const steps = planExportSteps(variants, viewSteps, null);
    expect(steps.map((step) => step.card)).toEqual([0, 1, 2, 3, 4]);
    // A turn-over is read on the face being left; the fold after it on the back.
    expect(steps.map((step) => step.mirrored)).toEqual([false, false, false, true, true]);
    expect(steps.map((step) => step.subject)).toEqual([
      { kind: 'step', step: 0 },
      { kind: 'step', step: 1 },
      { kind: 'turn-over', after: 2 },
      { kind: 'step', step: 2 },
      { kind: 'turn-over', after: 3 },
    ]);
  });

  it('reads each card as the big view does, and names it as the strip does', () => {
    const { variants, viewSteps } = readingOf(sequenceWithBackFold());
    const steps = planExportSteps(variants, viewSteps, null);
    for (const step of steps) {
      expect(step.diagram).toEqual(planHighlights(variants, viewSteps, step.card, null, null).pageDiagram);
      expect(step.subject).toEqual(referencesSequenceSubject(viewSteps, step.card));
    }
    const cards = planFilmstrip(t, variants, viewSteps, ['complete']).filter(
      (card) => card.kind !== 'done'
    );
    expect(steps.map((step) => step.mirrored)).toEqual(cards.map((card) => card.mirrored));
    expect(
      steps.map((step) => (step.subject.kind === 'step' ? step.subject.step + 1 : null))
    ).toEqual(cards.map((card) => card.number));
  });

  it('exports a merged symmetric pair once, both folds on its one page', () => {
    const sequence = sequenceWithTwin();
    const { variants, viewSteps } = readingOf(sequence);
    expect(viewSteps).toContainEqual({ kind: 'fold', side: 'front', component: 0, step: 2, twin: 3 });
    const steps = planExportSteps(variants, viewSteps, null);
    expect(steps.map((step) => step.subject)).toEqual([
      { kind: 'step', step: 0 },
      { kind: 'step', step: 1 },
      { kind: 'step', step: 2 },
    ]);
    const model = variants[0]!.model;
    const pair = steps[2]!.diagram;
    expect(pair).toEqual(planStepScene(sequence, model, 2, 3).pageDiagram);
    expect(pair).not.toEqual(planStepScene(sequence, model, 2).pageDiagram);
  });

  it('carries the sheet’s aux lines on every page, and none of another sheet’s', () => {
    const { variants, viewSteps } = readingOf(sequenceWithBackFold());
    const plain = planExportSteps(variants, viewSteps, null);
    const auxCount = (diagram: (typeof plain)[number]['diagram']) =>
      diagram.primitives.filter((primitive) => primitive.kind === 'line' && primitive.style === 'aux')
        .length;
    const onSheet = planExportSteps(variants, viewSteps, aux(0));
    onSheet.forEach((step, index) => {
      expect(auxCount(step.diagram)).toBe(auxCount(plain[index]!.diagram) + 1);
    });
    expect(planExportSteps(variants, viewSteps, aux(1))).toEqual(plain);
  });

  it('has no pages for a plan with no cards', () => {
    expect(planExportSteps([], [], null)).toEqual([]);
  });
});

function rfStep(diagramIndex: number, label: string): ExtractedStep {
  return { axiom: 1, inputs: [], label, pinch: false, diagramIndex };
}

/** ReferenceFinder's picture of a fold: the sheet and a horizontal line at `y`. */
function foldDiagram(y: number): unknown[] {
  return [
    { type: 3, width: 1, height: 1 },
    { type: 1, from: [0, y], to: [1, y], style: 3 },
  ];
}

function candidateOf(
  steps: ExtractedStep[],
  diagrams: unknown[][],
  freeDiagonals: FreeDiagonal[] = []
): ReferencesCandidateResult {
  return {
    solution: {
      exact: true,
      err: 0,
      rank: 2,
      foldCount: steps.length + freeDiagonals.length,
      steps,
      freeDiagonals,
      target: { kind: 'line', line: { a: [0, 0], b: [0, 1] } },
    },
    raw: { diagrams } as unknown as RawSolution,
    modelSteps: steps.map(() => ({})),
  };
}

/** A diagonal, then two folds of ReferenceFinder's own. */
const LEANING = candidateOf(
  [rfStep(0, 'A'), rfStep(1, 'B')],
  [foldDiagram(0.5), foldDiagram(0.25)],
  ['sw_ne']
);
/** Three folds, the middle one with no diagram the core printed. */
const GAPPED = candidateOf(
  [rfStep(0, 'A'), rfStep(9, 'B'), rfStep(1, 'C')],
  [foldDiagram(0.5), foldDiagram(0.75)]
);

const RESULTS: ReferencesResults = {
  revision: 'r1',
  target: {
    kind: 'crease',
    component: 0,
    lineId: 1,
    a: { x: 0, y: 0 },
    b: { x: 0, y: 100 },
    cpLineIds: [1],
    rf: [
      [0, 0],
      [0, 1],
    ],
  },
  frame: { origin: [0, 100], x_axis: [1, 0], y_axis: [0, -1], width: 100, height: 100 },
  originals: { lines: {}, marks: {} },
  candidates: [LEANING, GAPPED],
  durationMs: 1,
};

describe('candidateExportSteps', () => {
  it('takes every step of the candidate in the strip’s order, the diagonal first', () => {
    const steps = candidateExportSteps(RESULTS, 0);
    const read = candidateViewSteps(LEANING.solution);
    expect(read.map((step) => step.kind)).toEqual(['diagonal', 'rf', 'rf']);
    expect(steps.map((step) => step.subject)).toEqual([
      { kind: 'reference', candidate: 0, step: 0 },
      { kind: 'reference', candidate: 0, step: 1 },
      { kind: 'reference', candidate: 0, step: 2 },
    ]);
    expect(steps.map((step) => step.card)).toEqual([0, 1, 2]);
    expect(steps.every((step) => !step.mirrored)).toBe(true);
    steps.forEach((step, index) => {
      expect(step.diagram).toEqual(candidateStepDiagram(LEANING, RESULTS, read[index]!));
    });
    expect(steps[0]!.diagram.primitives).toContainEqual(
      expect.objectContaining({ kind: 'line', style: 'valley', from: [0, 100], to: [100, 0] })
    );
  });

  it('leaves out a step with no picture, keeping the others’ places in the strip', () => {
    const steps = candidateExportSteps(RESULTS, 1);
    expect(steps.map((step) => step.card)).toEqual([0, 2]);
    expect(steps.map((step) => step.subject)).toEqual([
      { kind: 'reference', candidate: 1, step: 0 },
      { kind: 'reference', candidate: 1, step: 2 },
    ]);
  });

  it('has no pages for a candidate that is not there', () => {
    expect(candidateExportSteps(RESULTS, 5)).toEqual([]);
  });
});

describe('referencesExportSteps', () => {
  const find = (candidate: number, activeStep: number, results: ReferencesResults | null = RESULTS) =>
    referencesExportSteps({ kind: 'find', results, candidate, activeStep });

  it('reads the shown candidate’s steps in Find', () => {
    expect(find(1, 0).steps).toEqual(candidateExportSteps(RESULTS, 1));
  });

  it('falls back to the first candidate for an index out of range, as the view does', () => {
    expect(find(7, 1)).toEqual(find(0, 1));
    expect(find(7, 1).steps[0]!.subject).toEqual({ kind: 'reference', candidate: 0, step: 0 });
  });

  it('has no pages without a current answer, or with nothing shown', () => {
    expect(find(0, 0, null)).toEqual({ steps: [], current: 0 });
    expect(find(0, 0, { ...RESULTS, candidates: [] })).toEqual({ steps: [], current: 0 });
    expect(referencesExportSteps({ kind: 'none' })).toEqual({ steps: [], current: 0 });
  });

  it('reads the precreasing sequence as planExportSteps does, with the sheet’s aux lines', () => {
    const { variants, viewSteps } = readingOf(sequenceWithBackFold());
    const { steps } = referencesExportSteps({
      kind: 'sequence',
      variants,
      viewSteps,
      sheetAux: aux(0),
      activeStep: 0,
    });
    expect(steps).toEqual(planExportSteps(variants, viewSteps, aux(0)));
    expect(steps).not.toEqual(planExportSteps(variants, viewSteps, null));
  });

  describe('current', () => {
    const { variants, viewSteps } = readingOf(sequenceWithBackFold());
    const sequenceAt = (activeStep: number) =>
      referencesExportSteps({ kind: 'sequence', variants, viewSteps, sheetAux: null, activeStep })
        .current;

    it('is the card on show', () => {
      expect(sequenceAt(0)).toBe(0);
      expect(sequenceAt(2)).toBe(2);
      expect(sequenceAt(3)).toBe(3);
      expect(find(0, 1).current).toBe(1);
    });

    it('is the last page on the finished card, which has none of its own', () => {
      expect(viewSteps[5]!.kind).toBe('done');
      expect(sequenceAt(5)).toBe(4);
    });

    it('is the nearest earlier page on a step with no picture', () => {
      expect(find(1, 1).current).toBe(0);
      expect(find(1, 2).current).toBe(1);
    });

    it('clamps a step past the candidate’s last, as the view does', () => {
      expect(find(0, 99).current).toBe(2);
    });
  });
});
