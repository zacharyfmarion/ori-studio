/**
 * References cards to split (17d): real cards as the planner and
 * ReferenceFinder draw them, one for each thing a pull lifts or leaves in the
 * picture — the equivalence and page tests run every one.
 *
 * Test-only: nothing outside `*.test.ts` imports this.
 */
import {
  plannerSequenceFixture,
  plannerSequenceWithGridFixture,
} from '../../cp-workspace/references/__fixtures__/plannerSequence';
import { unitFrame } from '../../cp-workspace/references/diagram/diagramFrames';
import { plannerFinishedDiagram, plannerStepDiagram } from '../../cp-workspace/references/diagram/plannerDiagram';
import type {
  PrecreaseDirection,
  PrecreaseGridBound,
  PrecreaseGridStepLine,
  PrecreaseSequence,
} from '../../cp-workspace/references/precreaseSequence';
import markFixture from '../../cp-workspace/references/referenceFinder/__fixtures__/mark.json';
import type { ReferenceFinderReplayFixture } from '../../cp-workspace/references/referenceFinder/replayClient';
import {
  referenceFinderDiagramToPrimitives,
  type StepDiagramModel,
} from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';

/** The fixture plan with each step folded in a direction, as a real plan's are. */
function directed(sequence: PrecreaseSequence, direction: PrecreaseDirection = 'valley'): PrecreaseSequence {
  return {
    ...sequence,
    steps: sequence.steps.map((step) => ({ ...step, direction, direction_share: 1 })),
  };
}

function card(sequence: PrecreaseSequence, index: number, options?: Parameters<typeof plannerStepDiagram>[3]): StepDiagramModel {
  const model = plannerStepDiagram(sequence, unitFrame(sequence), index, options);
  if (!model) throw new Error(`no card ${index}`);
  return model;
}

/**
 * Zach's screenshot's kind of step: a corner and its mirror folded onto one
 * mark — P, Q and R ringed and lettered, an arrow for each, the step's valley
 * fold, and the creases made before it.
 */
export function pointsCard(): StepDiagramModel {
  const sequence = directed(plannerSequenceFixture());
  const also = {
    ...sequence.steps[1]!.witnesses[0]!,
    inputs: [
      { kind: 'corner' as const, id: 1, corner: 'se' as const },
      { kind: 'point' as const, id: 4 },
    ],
  };
  return card({ ...sequence, steps: sequence.steps.map((step, i) => (i === 1 ? { ...step, also } : step)) }, 1);
}

/** A fold made against two lines: their reference lines, lettered A and B, the fold, its arrow. */
export function linesCard(): StepDiagramModel {
  return card(directed(plannerSequenceFixture()), 4);
}

/** A landmark pinched where later steps need it: two valley pinches, the rings and letters they are made by, the arrow. */
export function pinchCard(): StepDiagramModel {
  return card(directed(plannerSequenceFixture()), 0);
}

/** A pleat of the grid: the family's lines, every one the step's own, in its directions; nothing lettered. */
export function pleatCard(): StepDiagramModel {
  return card(plannerSequenceWithGridFixture(), 1);
}

/** A step made in a band: the band washed, its bounds picked out as reference lines, its own lines. */
export function bandCard(): StepDiagramModel {
  const sequence = plannerSequenceWithGridFixture();
  const [vertical] = sequence.steps;
  const family = vertical!.grid!;
  const band = (d: number, index: number, direction: PrecreaseDirection): PrecreaseGridStepLine => ({
    line_id: 20 + index,
    line: { n: [1, 0], d },
    segment: [
      [d, 0],
      [d, 1],
    ],
    spans: [],
    index,
    direction,
    pattern_direction: direction,
    pattern_share: 1,
    cp_line_ids: [20 + index],
    cp_spans: [
      [
        [d, 0.25],
        [d, 0.75],
      ],
    ],
  });
  const lines8 = [band(0.375, 3, 'valley'), band(0.625, 5, 'valley')];
  const step = {
    ...vertical!,
    id: 3,
    line_id: lines8[0]!.line_id,
    line: lines8[0]!.line,
    segment: lines8[0]!.segment,
    cp_line_ids: lines8.flatMap((l) => l.cp_line_ids),
    cp_spans: lines8.flatMap((l) => l.cp_spans),
    grid: {
      ...family,
      cells: 8,
      level: 8,
      pleat: false,
      regions: [
        {
          bounds: [
            { index: 2, fraction: 0.25, edge: null, line_id: 4 },
            { index: 6, fraction: 0.75, edge: null, line_id: 6 },
          ] as [PrecreaseGridBound, PrecreaseGridBound],
          lines: 2,
        },
      ],
      lines: lines8,
      in_pattern: 2,
      reversed: 0,
    },
  };
  const banded: PrecreaseSequence = {
    ...sequence,
    steps: [sequence.steps[0]!, sequence.steps[1]!, step],
    lines: [...sequence.lines, ...lines8.map((l) => ({ id: l.line_id, tag: 'cp' as const, step: 3 }))],
  };
  return card(banded, 2);
}

/** The finished card: the pattern, in the fold pens, and nothing to lift. */
export function finishedCard(): StepDiagramModel {
  const sequence = directed(plannerSequenceFixture());
  return plannerFinishedDiagram(sequence, unitFrame(sequence));
}

/** A ReferenceFinder answer's step, as Find draws it: a valley pinch and its dotted rest, rings in three styles, letters, the arc. */
export function findCard(): StepDiagramModel {
  const mark = markFixture as unknown as ReferenceFinderReplayFixture;
  return referenceFinderDiagramToPrimitives(mark.solutions[0]!.diagrams[0]!);
}

/**
 * One fold drawn in pieces end to end (RM10), and two pinches apart: a card
 * as the planner draws a crease split at the creases it crosses.
 */
export function piecesCard(): StepDiagramModel {
  return {
    sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.5], to: [0.25, 0.5], style: 'valley', dashPhase: 0 },
      { kind: 'line', from: [0.25, 0.5], to: [0.6, 0.5], style: 'valley', dashPhase: 0.25 },
      { kind: 'line', from: [0.6, 0.5], to: [1, 0.5], style: 'valley', dashPhase: 0.6 },
      { kind: 'line', from: [0.5, 0], to: [0.5, 0.1], style: 'pinch-mountain' },
      { kind: 'line', from: [0.5, 0.9], to: [0.5, 1], style: 'pinch-mountain' },
    ],
  };
}

/**
 * A card for a step enlarged round the sheet's middle (a circle of radius
 * 0.2 there, its window 0.3 to 0.7 on the picture): a fold across the frame;
 * a ring, its letter and a short arrow in it; a reference line, a ring and a
 * long arrow outside it, as crane's head steps hold.
 */
export function framedCard(): StepDiagramModel {
  return {
    sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
    primitives: [
      { kind: 'sheet', width: 1, height: 1 },
      { kind: 'line', from: [0, 0.5], to: [1, 0.5], style: 'valley' },
      { kind: 'line', from: [0, 0.1], to: [1, 0.1], style: 'highlight' },
      { kind: 'point', at: [0.5, 0.55], style: 'highlight' },
      { kind: 'label', at: [0.5, 0.55], text: 'P', style: 'highlight' },
      { kind: 'point', at: [0.05, 0.05], style: 'highlight' },
      { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.1, from: 0.3, to: 1.2, ccw: true } },
      { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.5, from: Math.PI / 2 + 0.6, to: Math.PI / 2 - 0.4, ccw: false } },
    ],
  };
}

/** Every card the equivalence runs, by name. */
export function liftFixtures(): { name: string; model: StepDiagramModel }[] {
  return [
    { name: 'points', model: pointsCard() },
    { name: 'lines', model: linesCard() },
    { name: 'pinch', model: pinchCard() },
    { name: 'find', model: findCard() },
    { name: 'band', model: bandCard() },
    { name: 'pleat', model: pleatCard() },
    { name: 'finished', model: finishedCard() },
  ];
}
