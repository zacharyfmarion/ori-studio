import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from '../__fixtures__/plannerSequence';
import { decodePlanModel, planModelPoints } from '../referencesPlanGeometry';
import { modelFrame, unitFrame } from './diagramFrames';
import {
  plannerFinishedDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerDiagram';

/**
 * The bridge's `rfToModelMany`, stood in for by a similarity — which is what a
 * real frame is (`crates/oristudio-precrease/src/frame.rs:80` builds an
 * orthonormal basis with determinant −1). A rotation is in it on purpose: the
 * paper is not axis-aligned in the document, and every case below would pass
 * trivially against a scale-and-flip.
 */
const TURN = Math.PI / 7;
const SCALE = 400;
function mapToModel(points: Float64Array): Float64Array {
  const out = new Float64Array(points.length);
  const [c, s] = [Math.cos(TURN), Math.sin(TURN)];
  for (let i = 0; i < points.length; i += 2) {
    // Scale, rotate, flip y, translate — a similarity with a reflection.
    const [x, y] = [points[i] * SCALE, -points[i + 1] * SCALE];
    out[i] = x * c - y * s - 200;
    out[i + 1] = x * s + y * c + 60;
  }
  return out;
}

/** The same map, for checking a unit-frame point against its model image. */
function image(p: readonly [number, number]): [number, number] {
  const mapped = mapToModel(Float64Array.from(p));
  return [mapped[0], mapped[1]];
}

/** The view's coordinates are already model space. */
const here = (p: readonly [number, number]) => p;

const sequence = plannerSequenceFixture();
const unit = unitFrame(sequence);
const model = modelFrame(sequence, decodePlanModel(sequence, mapToModel(planModelPoints(sequence))));

/**
 * Every primitive as a comparable shape, in model space.
 *
 * `map` carries the card's unit coordinates across; the view's are already
 * there, so it gets the identity. Mapping both was the first thing this test
 * got wrong, and it fails loudly rather than quietly, which is the point.
 */
function inModelSpace(
  primitives: readonly unknown[],
  map: (p: readonly [number, number]) => readonly [number, number]
): unknown[] {
  const round = (v: number) => Number(v.toFixed(6));
  const at = (p: readonly [number, number]) => map(p).map(round);
  return primitives.map((raw) => {
    const p = raw as Record<string, unknown>;
    switch (p.kind) {
      case 'line':
        return {
          kind: 'line',
          style: p.style,
          // A line has no direction of its own: `dashRulerAlong` canonicalises
          // it, and the canonical end differs between a frame and its rotation.
          ends: [at(p.from as [number, number]), at(p.to as [number, number])].sort(),
        };
      case 'point':
      case 'label':
        return { ...p, at: at(p.at as [number, number]) };
      case 'fold-arrow':
        return { kind: 'fold-arrow' };
      case 'turn-over':
        return { kind: 'turn-over', at: at(p.at as [number, number]) };
      default:
        return { kind: p.kind };
    }
  });
}

/**
 * The claim the whole shared model rests on, made checkable.
 *
 * Two files used to decide what a step draws — one for the card, one for the
 * view — and by the time they were compared they disagreed in six places, the
 * loudest being whether the un-creased rest of a fold's chord is drawn at all.
 * One rule set answers that once; this is what says so.
 */
describe('the two frames describe the same picture', () => {
  it('emits the same primitives, in the same order, for every step', () => {
    for (let i = 0; i < sequence.steps.length; i += 1) {
      const card = plannerStepDiagram(sequence, unit, i);
      const view = plannerStepDiagram(sequence, model, i);
      expect(view, `step ${i}`).not.toBeNull();
      // The card draws the paper and the canvas has the document's own border
      // creases under everything, so that one primitive is the card's alone.
      const drawn = card!.primitives.filter((p) => p.kind !== 'sheet');
      expect(inModelSpace(view!.primitives, here), `step ${i}`).toEqual(inModelSpace(drawn, image));
    }
  });

  it('agrees on the turn-over card and the finished pattern', () => {
    for (const after of [null, 0, 2]) {
      const card = plannerTurnOverDiagram(sequence, unit, after);
      const view = plannerTurnOverDiagram(sequence, model, after);
      const drawn = card.primitives.filter((p) => p.kind !== 'sheet');
      expect(inModelSpace(view.primitives, here), `after ${after}`).toEqual(inModelSpace(drawn, image));
    }
    const card = plannerFinishedDiagram(sequence, unit);
    const view = plannerFinishedDiagram(sequence, model);
    const drawn = card.primitives.filter((p) => p.kind !== 'sheet');
    expect(inModelSpace(view.primitives, here)).toEqual(inModelSpace(drawn, image));
  });
});

describe('the model frame', () => {
  // The one piece of geometry that does not arrive mapped. It is recovered from
  // each endpoint's position along its own chord, which a similarity preserves.
  it('recovers a step’s creased spans exactly', () => {
    for (const step of sequence.steps) {
      const spans = model.creases(step);
      expect(spans).toHaveLength(step.cp_spans.length);
      for (const [i, span] of spans.entries()) {
        for (const [end, want] of [
          [span[0], step.cp_spans[i][0]],
          [span[1], step.cp_spans[i][1]],
        ] as const) {
          const [x, y] = image(want);
          expect(end.x).toBeCloseTo(x, 9);
          expect(end.y).toBeCloseTo(y, 9);
        }
      }
    }
  });

  // The crease a step made is a stretch of the same chord, recovered the
  // same way — and it is the pattern's own pieces when the plan did not reach.
  it('recovers what a step made along its chord, and falls back to the pieces', () => {
    const reached = {
      ...sequence,
      steps: sequence.steps.map((step, i) =>
        i === 1
          ? {
              ...step,
              cp_spans: [
                [
                  [0.25, 0.2],
                  [0.25, 0.4],
                ],
              ] as [[number, number], [number, number]][],
              made: [
                [
                  [0.25, 0],
                  [0.25, 0.7],
                ],
              ] as [[number, number], [number, number]][],
            }
          : step
      ),
    };
    const frame = modelFrame(reached, decodePlanModel(reached, mapToModel(planModelPoints(reached))));
    const [run] = frame.made(reached.steps[1]);
    expect(run).toBeDefined();
    for (const [end, want] of [
      [run![0], [0.25, 0]],
      [run![1], [0.25, 0.7]],
    ] as const) {
      const [x, y] = image(want);
      expect(end.x).toBeCloseTo(x, 9);
      expect(end.y).toBeCloseTo(y, 9);
    }
    // Every other step has no `made`, so its pieces are what it made.
    expect(frame.made(reached.steps[0])).toEqual(frame.creases(reached.steps[0]));
    expect(unitFrame(reached).made(reached.steps[1])).toEqual([
      [
        { x: 0.25, y: 0 },
        { x: 0.25, y: 0.7 },
      ],
    ]);
  });

  it('measures the paper and finds its middle under a rotation', () => {
    expect(model.sheet.width).toBeCloseTo(SCALE, 9);
    expect(model.sheet.height).toBeCloseTo(SCALE, 9);
    const [cx, cy] = image([0.5, 0.5]);
    expect(model.centre.x).toBeCloseTo(cx, 9);
    expect(model.centre.y).toBeCloseTo(cy, 9);
  });
});
