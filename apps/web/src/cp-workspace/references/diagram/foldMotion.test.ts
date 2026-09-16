import { describe, expect, it } from 'vitest';
import { arcSamplePoints } from '../stepDiagramGeometry';
import { modelFrame, unitFrame, type DiagramFrame } from './diagramFrames';
import { decodePlanModel, planModelPoints } from '../referencesPlanGeometry';
import {
  plannerSequenceFixture,
  plannerSequenceWithGridFixture,
} from '../__fixtures__/plannerSequence';
import { plannerStepDiagram, sideOf } from './plannerDiagram';
import { flapCentroid, stepFoldMotion } from './foldMotion';
import type {
  PrecreaseSequence,
  PrecreaseStep,
  PrecreaseWitness,
} from '../precreaseSequence';

const fixture = plannerSequenceFixture();

function witness(
  axiom: number,
  inputs: PrecreaseWitness['inputs'],
  who_moves: number[]
): PrecreaseWitness {
  return {
    axiom,
    inputs,
    root: 0,
    who_moves,
    hard: false,
    visible: true,
    skinny: false,
    ease: 0,
    err: 0,
  };
}

/** The fixture with more of the axioms on it: a crease through two marks, a perpendicular, a press. */
function widened(): PrecreaseSequence {
  const base = fixture.steps[1]!;
  const extra: PrecreaseStep[] = [
    // O1 through the south-west corner and a mark on the right edge: nothing
    // moves, and the paper below the line is the smaller part.
    {
      ...base,
      id: 6,
      line_id: 9,
      kind: 'aux',
      tag: 'aux',
      line: { n: [-0.4472, 0.8944], d: 0 },
      segment: [
        [0, 0],
        [1, 0.5],
      ],
      witnesses: [
        witness(1, [{ kind: 'corner', id: 0, corner: 'sw' }, { kind: 'point', id: 9 }], []),
      ],
      cp_line_ids: [],
    },
    // O4: the perpendicular to the bottom edge through a mark at x = 0.3.
    {
      ...base,
      id: 7,
      line_id: 10,
      line: { n: [1, 0], d: 0.3 },
      segment: [
        [0.3, 0],
        [0.3, 1],
      ],
      witnesses: [
        witness(4, [{ kind: 'point', id: 10 }, { kind: 'edge', id: 2, side: 'bottom' }], []),
      ],
      cp_line_ids: [7],
    },
    // O5 through a mark on the left edge, bringing a mark above the fold
    // onto the crease at y = ¼ below it: the mark sits on the larger part
    // of the sheet, so the picture swings the strip below instead.
    {
      ...base,
      id: 9,
      line_id: 11,
      line: { n: [0, 1], d: 0.3 },
      segment: [
        [0, 0.3],
        [1, 0.3],
      ],
      witnesses: [
        witness(
          5,
          [{ kind: 'point', id: 12 }, { kind: 'point', id: 13 }, { kind: 'line', id: 8 }],
          [1]
        ),
      ],
      cp_line_ids: [8],
    },
    // A press on the landmark: a pinch's worth at a crossing, sighted from a crease.
    {
      ...fixture.steps[0]!,
      id: 8,
      kind: 'press',
      tag: 'aux',
      extent: {
        kind: 'pinches',
        spans: [
          [
            [0.4, 0.5],
            [0.46, 0.5],
          ],
        ],
      },
      press: { at: [0.43, 0.5], point: 11, sighted_from: 5 },
      unlocks: [],
    },
  ];
  return {
    ...fixture,
    steps: [...fixture.steps, ...extra],
    points: [
      ...fixture.points,
      { id: 9, p: [1, 0.5], lines: [1], on_boundary: true },
      { id: 10, p: [0.3, 0.6], lines: [], on_boundary: false },
      { id: 11, p: [0.43, 0.5], lines: [4], on_boundary: false },
      { id: 12, p: [0, 0.3], lines: [0], on_boundary: true },
      { id: 13, p: [0.5, 0.35], lines: [], on_boundary: false },
    ],
    lines: [
      ...fixture.lines,
      { id: 9, tag: 'aux', step: 6 },
      { id: 10, tag: 'cp', step: 7 },
      { id: 11, tag: 'cp', step: 9 },
    ],
  };
}

/** A similarity with a reflection in it, like the crate's own frame map. */
const [c, s] = [Math.cos(Math.PI / 7), Math.sin(Math.PI / 7)];
function image(p: readonly [number, number]): [number, number] {
  const [x, y] = [p[0] * 400, -p[1] * 400];
  return [x * c - y * s - 200, x * s + y * c + 60];
}

function frames(sequence: PrecreaseSequence): { unit: DiagramFrame; model: DiagramFrame } {
  const points = planModelPoints(sequence);
  const mapped = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    const [x, y] = image([points[i]!, points[i + 1]!]);
    mapped[i] = x;
    mapped[i + 1] = y;
  }
  return {
    unit: unitFrame(sequence),
    model: modelFrame(sequence, decodePlanModel(sequence, mapped)),
  };
}

describe('stepFoldMotion', () => {
  const sequence = widened();
  const { unit, model } = frames(sequence);

  it("swings the side the card's arrow starts from, in both frames", () => {
    let arrows = 0;
    for (const frame of [unit, model]) {
      sequence.steps.forEach((_, index) => {
        const motion = stepFoldMotion(sequence, frame, index);
        const diagram = plannerStepDiagram(sequence, frame, index);
        expect(motion).not.toBeNull();
        for (const primitive of diagram?.primitives ?? []) {
          if (primitive.kind !== 'fold-arrow') continue;
          arrows += 1;
          const [start] = arcSamplePoints(primitive.out);
          const flap = motion!.flaps[0]!;
          expect(sideOf(flap.chord, { x: start[0], y: start[1] })).toBe(flap.side);
        }
      });
    }
    // Every fixture fold, the perpendicular and the O5 draw one; only O1 draws none.
    expect(arrows).toBe(2 * (sequence.steps.length - 1));
  });

  it('names the same physical side from both frames', () => {
    sequence.steps.forEach((_, index) => {
      const inUnit = stepFoldMotion(sequence, unit, index)!;
      const inModel = stepFoldMotion(sequence, model, index)!;
      const inside = flapCentroid(unit, inUnit.flaps[0]!)!;
      const [x, y] = image([inside.x, inside.y]);
      expect(sideOf(inModel.flaps[0]!.chord, { x, y })).toBe(inModel.flaps[0]!.side);
    });
  });

  it('presses what the step creases: the landmark by its two pinches', () => {
    const motion = stepFoldMotion(sequence, unit, 0)!;
    expect(motion.kind).toBe('aux');
    expect(motion.flaps[0]!.creased).toEqual([
      [
        { x: 0, y: 0.5 },
        { x: 0.06, y: 0.5 },
      ],
      [
        { x: 0.94, y: 0.5 },
        { x: 1, y: 0.5 },
      ],
    ]);
    // The corner that moves is below the landmark, so the bottom half swings.
    expect(motion.flaps[0]!.side).toBe(-1);
  });

  it('swings the smaller flap when nothing is brought onto anything', () => {
    const motion = stepFoldMotion(sequence, unit, 5)!;
    // Below the line from the corner to the right edge's middle is a quarter
    // of the sheet; above it, three quarters.
    expect(motion.flaps[0]!.side).toBe(-1);
    expect(motion.kind).toBe('aux');
  });

  it("swings the shorter arm's corner for a perpendicular", () => {
    const motion = stepFoldMotion(sequence, unit, 6)!;
    // The foot is at x = 0.3, so the south-west corner is the nearer one.
    expect(sideOf(motion.flaps[0]!.chord, { x: 0, y: 0 })).toBe(motion.flaps[0]!.side);
  });

  it('swings the smaller flap when the crate’s mover sits on the larger one', () => {
    // The mark at (0.5, 0.35) is above the fold at y = 0.3, on seven tenths
    // of the sheet; its landing on y = ¼ is on the three tenths below. The
    // strip below swings, as a folder would have it.
    const motion = stepFoldMotion(sequence, unit, 7)!;
    expect(sideOf(motion.flaps[0]!.chord, { x: 0.5, y: 0.25 })).toBe(motion.flaps[0]!.side);
    expect(sideOf(motion.flaps[0]!.chord, { x: 0.5, y: 0.35 })).toBe(-motion.flaps[0]!.side);
  });

  it("presses only a press step's own spans", () => {
    const motion = stepFoldMotion(sequence, unit, 8)!;
    expect(motion.kind).toBe('press');
    expect(motion.flaps[0]!.creased).toEqual([
      [
        { x: 0.4, y: 0.5 },
        { x: 0.46, y: 0.5 },
      ],
    ]);
  });

  it('has nothing to swing for a pleat', () => {
    const grid = plannerSequenceWithGridFixture();
    expect(stepFoldMotion(grid, unitFrame(grid), 0)).toBeNull();
  });

  it('carries both flaps of a twin, overlapping or not, in the order the card names them', () => {
    // x = ¼ and x = ¾, the corner at the south-west swinging for both: the
    // left flap of the second contains the whole first flap — and both play,
    // one after the other.
    const overlapping = stepFoldMotion(fixture, unitFrame(fixture), 1, 3)!;
    expect(overlapping.flaps).toHaveLength(2);
    expect(overlapping.flaps[0]!.chord[0]).toEqual({ x: 0.25, y: 0 });
    expect(overlapping.flaps[1]!.chord[0]).toEqual({ x: 0.75, y: 0 });
    // The same pair with the south-east corner swinging for the second: the
    // right quarter and the left quarter.
    const apart: PrecreaseSequence = {
      ...fixture,
      steps: fixture.steps.map((step, i) =>
        i === 3
          ? {
              ...step,
              witnesses: [
                witness(2, [{ kind: 'corner', id: 1, corner: 'se' }, { kind: 'point', id: 4 }], [0]),
              ],
            }
          : step
      ),
    };
    const motion = stepFoldMotion(apart, unitFrame(apart), 1, 3)!;
    expect(motion.flaps).toHaveLength(2);
    expect(motion.flaps[0]!.side).toBe(1);
    expect(motion.flaps[1]!.side).toBe(-1);
  });
});
