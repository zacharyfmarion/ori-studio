import { describe, expect, it } from 'vitest';
import { decodePlanModel, planModelPoints } from '../referencesPlanGeometry';
import { plannerSequenceFixture } from '../__fixtures__/plannerSequence';
import { referencesViewSteps } from '../referencesSequenceView';
import type { ReferencesPlanVariant } from '../referencesResults';
import { chordFrame, fromChordFrame, inChordFrame, planFoldScene } from './foldScene';

/** The fixture on a 400-unit sheet placed at −200, as the document would have it. */
function variant(): ReferencesPlanVariant {
  const sequence = plannerSequenceFixture();
  const points = planModelPoints(sequence);
  const mapped = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    mapped[i] = 400 * points[i]! - 200;
    mapped[i + 1] = 400 * points[i + 1]! - 200;
  }
  return { sequence, model: decodePlanModel(sequence, mapped) };
}

describe('planFoldScene', () => {
  const plan = variant();
  const steps = referencesViewSteps([plan], plan.sequence.steps.map((_, step) => ({ component: 0, step })));

  it('describes the landmark fold: the bottom half swings, pinched at both ends', () => {
    const scene = planFoldScene([plan], steps, 0)!;
    expect(scene.kind).toBe('aux');
    expect(scene.sheetShortSide).toBeCloseTo(400);
    const [flap] = scene.flaps;
    expect(flap!.chord).toEqual([
      { x: -200, y: 0 },
      { x: 200, y: 0 },
    ]);
    // The corner that moves is at (−200, −200): the paper below the line.
    expect(flap!.side).toBe(-1);
    expect(flap!.polygon.map((p) => [p.x, p.y]).sort()).toEqual(
      [
        [-200, -200],
        [200, -200],
        [200, 0],
        [-200, 0],
      ].sort()
    );
    // The two pinches, as distances along the line from its left end.
    expect(flap!.creased.map(([a, b]) => [Math.round(a), Math.round(b)])).toEqual([
      [0, 24],
      [376, 400],
    ]);
    // The far edge of the flap is a half sheet from the line.
    expect(scene.reach).toBeCloseTo(200);
  });

  it('turns the whole sheet over about its vertical centre line on a turn-over card', () => {
    const cards = [{ kind: 'turn-over', side: 'front', component: 0, after: null } as const];
    const scene = planFoldScene([plan], cards, 0)!;
    expect(scene.kind).toBe('turn-over');
    const [flap] = scene.flaps;
    expect(flap!.whole).toBe(true);
    expect(flap!.chord).toEqual([
      { x: 0, y: -200 },
      { x: 0, y: 200 },
    ]);
    expect(flap!.polygon).toHaveLength(4);
    expect(scene.reach).toBeCloseTo(200);
  });

  it('has no fold for the finished card', () => {
    expect(planFoldScene([plan], steps, steps.length - 1)).toBeNull();
  });

  it('has no fold without a plan to read', () => {
    expect(planFoldScene([], [], 0)).toBeNull();
  });
});

describe('chordFrame', () => {
  it('points its normal into the flap and round-trips a point', () => {
    const chord = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ] as const;
    const above = chordFrame(chord, 1);
    expect(above.n).toEqual({ x: -0, y: 1 });
    const below = chordFrame(chord, -1);
    expect(below.n.y).toBe(-1);
    const p = { x: 3, y: -4 };
    const local = inChordFrame(below, p);
    expect(local).toEqual({ s: 3, u: 4 });
    const back = fromChordFrame(below, local.s, local.u);
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });
});
