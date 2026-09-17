import { describe, expect, it } from 'vitest';
import { decodePlanModel, planModelPoints } from '../referencesPlanGeometry';
import { plannerSequenceFixture } from '../__fixtures__/plannerSequence';
import { referencesViewSteps } from '../referencesSequenceView';
import type { ReferencesPlanVariant } from '../referencesResults';
import { candidateFoldScene, chordFrame, fromChordFrame, inChordFrame, planFoldScene } from './foldScene';
import { sideOf as sideOfChord } from '../diagram/plannerDiagram';
import type { ReferencesCandidateResult, ReferencesOriginals } from '../referencesResults';
import type { ExtractedSolution } from '../referenceFinder/extractor';
import type { RawSolution } from '../referenceFinder/solution';
import type { StepDiagramModel } from '../referenceFinderDiagramToPrimitives';
import type { PrecreaseFrame } from '../sheetFrames';
import { foldArrowArc } from '../stepDiagramGeometry';
import { diagonalStepDiagram } from '../referencesCandidateSteps';
import { diagramInModel } from '../referenceFinderStepInModel';

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
    // The hand takes the sheet's left edge: positive `u` points that way.
    const along = chordFrame(flap!.chord, flap!.side);
    expect(inChordFrame(along, { x: -200, y: 0 }).u).toBeCloseTo(200);
  });

  it('has no fold for the finished card', () => {
    expect(planFoldScene([plan], steps, steps.length - 1)).toBeNull();
  });

  it('has no fold without a plan to read', () => {
    expect(planFoldScene([], [], 0)).toBeNull();
  });
});

describe('candidateFoldScene', () => {
  /** A 400-unit square at −200, ReferenceFinder's unit sheet laid on it unflipped. */
  const frame: PrecreaseFrame = {
    origin: [-200, -200],
    x_axis: [1, 0],
    y_axis: [0, 1],
    width: 400,
    height: 400,
  };
  const originals: ReferencesOriginals = {
    lines: {
      sw_ne: { a: { x: -200, y: -200 }, b: { x: 200, y: 200 } },
      nw_se: { a: { x: -200, y: 200 }, b: { x: 200, y: -200 } },
    },
    marks: {},
  };
  /** One fold at y = 0 (a mark step after it), then the answer's line. */
  const candidate: ReferencesCandidateResult = {
    solution: { steps: [], freeDiagonals: [] } as unknown as ExtractedSolution,
    raw: { diagrams: [] } as unknown as RawSolution,
    modelSteps: [
      { line: { a: { x: -200, y: 0 }, b: { x: 200, y: 0 } } },
      { point: { x: 0, y: 0 } },
    ],
  };
  const arrowFrom = (from: [number, number], to: [number, number]): StepDiagramModel => ({
    sheet: { width: 400, height: 400, centre: [0, 0] },
    primitives: [
      { kind: 'line', from: [-200, 0], to: [-140, 0], style: 'pinch-valley' },
      { kind: 'line', from: [-140, 0], to: [200, 0], style: 'dotted' },
      { kind: 'fold-arrow', out: foldArrowArc(from, to, [0, 0])! },
    ],
  });

  it('reads the fold line, the side the arrow starts from, and the pinch from the picture', () => {
    // The arrow starts below the line: the bottom half swings up.
    const scene = candidateFoldScene(frame, originals, candidate, { kind: 'rf', steps: [0, 1], diagramIndex: 0 }, arrowFrom([0, -200], [0, 200]))!;
    expect(scene.kind).toBe('reference');
    const [flap] = scene.flaps;
    expect(flap!.chord).toEqual([
      { x: -200, y: 0 },
      { x: 200, y: 0 },
    ]);
    expect(sideOfChord(flap!.chord, { x: 0, y: -100 })).toBe(flap!.side);
    expect(flap!.creased).toEqual([[0, 60]]);
    expect(scene.reach).toBeCloseTo(200);
    expect(scene.sheetShortSide).toBe(400);
    // The other way round, the top half swings.
    const down = candidateFoldScene(frame, originals, candidate, { kind: 'rf', steps: [0, 1], diagramIndex: 0 }, arrowFrom([0, 200], [0, -200]))!;
    expect(sideOfChord(down.flaps[0]!.chord, { x: 0, y: 100 })).toBe(down.flaps[0]!.side);
  });

  it('folds the whole line when the picture draws no pinch, and the smaller side without an arrow', () => {
    const whole: StepDiagramModel = {
      sheet: { width: 400, height: 400, centre: [0, 0] },
      primitives: [{ kind: 'line', from: [-200, 0], to: [200, 0], style: 'valley' }],
    };
    const scene = candidateFoldScene(frame, originals, candidate, { kind: 'rf', steps: [0], diagramIndex: 0 }, whole)!;
    expect(scene.flaps[0]!.creased).toEqual([[0, 400]]);
    // Equal halves and no arrow: the side holding the sheet's first corner.
    expect(scene.flaps[0]!.side).toBe(sideOfChord(scene.flaps[0]!.chord, { x: -200, y: -200 }));
  });

  it('has no fold for a card that only makes a mark, and folds a diagonal corner to corner', () => {
    expect(candidateFoldScene(frame, originals, candidate, { kind: 'rf', steps: [1], diagramIndex: null }, null)).toBeNull();
    const diagonal = candidateFoldScene(frame, originals, candidate, { kind: 'diagonal', diagonal: 'sw_ne' }, null)!;
    expect(diagonal.flaps[0]!.chord).toEqual([
      { x: -200, y: -200 },
      { x: 200, y: 200 },
    ]);
    expect(diagonal.flaps[0]!.creased[0]![1]).toBeCloseTo(Math.hypot(400, 400));
    // Read from its own card, the flap that swings is the one the arrow
    // starts on — the bottom-right corner's half, off the crease — so the
    // animation and the card agree on what moves.
    const card = diagramInModel(diagonalStepDiagram('sw_ne', { width: 1, height: 1 }), frame);
    const drawn = candidateFoldScene(frame, originals, candidate, { kind: 'diagonal', diagonal: 'sw_ne' }, card)!;
    expect(drawn.flaps[0]!.side).toBe(sideOfChord(drawn.flaps[0]!.chord, { x: 200, y: -200 }));
    expect(drawn.flaps[0]!.side).not.toBe(sideOfChord(drawn.flaps[0]!.chord, { x: -200, y: 200 }));
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
