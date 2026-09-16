import { describe, expect, it } from 'vitest';
import {
  plannerSequenceFixture,
  plannerSequenceWithGridFixture,
} from './__fixtures__/plannerSequence';
import {
  decodePlanModel,
  EDGE_ORDER,
  planModelPoints,
  planStepScene,
  planTurnOverScene,
} from './referencesPlanGeometry';

/**
 * A stand-in for the bridge's `rfToModelMany`: the planner unit frame scaled
 * and flipped, which is what a real frame does. Any invertible map would do —
 * what the tests check is that the layout and the read-back agree.
 */
function mapToModel(points: Float64Array): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i] * 400 - 200;
    out[i + 1] = 200 - points[i + 1] * 400;
  }
  return out;
}

describe('planModelPoints / decodePlanModel', () => {
  const sequence = plannerSequenceFixture();

  it('round-trips every step, mark, edge and finding through one call', () => {
    const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
    expect(model.steps).toHaveLength(sequence.steps.length);
    expect(model.points).toHaveLength(sequence.points.length);
    expect(model.findings).toHaveLength(sequence.findings.length);
    expect(Object.keys(model.edges).sort()).toEqual([...EDGE_ORDER].sort());
  });

  it('keeps a pinched step’s spans, not just its chord', () => {
    const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
    // Step 1 is the landmark, pinched at two marks.
    expect(model.steps[0].pinches).toHaveLength(2);
    expect(model.steps[1].pinches).toHaveLength(0);
  });

  it('maps a step’s chord to the frame the view draws in', () => {
    const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
    // The landmark is y = ½ in the unit frame: the model-space midline.
    expect(model.steps[0].segment.a).toEqual({ x: -200, y: 0 });
    expect(model.steps[0].segment.b).toEqual({ x: 200, y: 0 });
  });

  /**
   * How many points the layout holds, counted independently of it: per step
   * the chord, then each pinch, each press-on and each grid line as two
   * endpoints; then the marks, the four edges, and each finding's segment.
   */
  const pointCount = (seq: typeof sequence) =>
    seq.steps.reduce(
      (n, step) =>
        n +
        2 +
        (step.extent.kind === 'pinches' ? step.extent.spans.length * 2 : 0) +
        step.pressed_on.length * 2 +
        (step.grid?.lines.length ?? 0) * 2,
      0
    ) +
    seq.points.length +
    8 +
    seq.findings.filter((finding) => finding.segment).length * 2;

  it('lays the request out in exactly the order it is read back', () => {
    // Two values per point, and the count has to match or every later entry
    // is off by one — the one failure mode this contract can have.
    expect(planModelPoints(sequence).length).toBe(pointCount(sequence) * 2);
    const gridded = plannerSequenceWithGridFixture();
    expect(planModelPoints(gridded).length).toBe(pointCount(gridded) * 2);
  });

  // A grid step's own chord is only its family's first line; the family
  // crosses in the same round trip, after the chord, so the view can draw the
  // pleat without a second call.
  it('carries every line of a pleated family, after the step’s own chord', () => {
    const gridded = plannerSequenceWithGridFixture();
    const model = decodePlanModel(gridded, mapToModel(planModelPoints(gridded)));
    for (const [i, step] of gridded.steps.entries()) {
      expect(model.steps[i].gridLines).toHaveLength(step.grid?.lines.length ?? 0);
    }
    // The vertical family's last line, x = ¾, edge to edge.
    const last = model.steps[0].gridLines[2];
    expect(last.a).toEqual({ x: 100, y: 200 });
    expect(last.b).toEqual({ x: 100, y: -200 });
    // And what comes after the family is still read in its place.
    expect(model.points[2]).toEqual({ x: 0, y: 0 });
    expect(model.edges.top.a).toEqual({ x: -200, y: -200 });
  });
});

describe('planStepScene', () => {
  const sequence = plannerSequenceFixture();
  const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));
  const styles = (index: number) =>
    (planStepScene(sequence, model, index).diagram?.primitives ?? []).flatMap((p) =>
      p.kind === 'line' ? [p.style] : []
    );

  // The rules are the card's, tested against the card in
  // `diagram/plannerDiagram.test.ts`. What is checked here is that the *view*
  // gets them — this used to be a second rule set, and the two had drifted.
  it('creases only what the pattern gains, and no faint stand-in for the rest', () => {
    const drawn = styles(2);
    expect(drawn).not.toContain('unfolded');
    // Two creases on this step's line, plus the earlier steps as context.
    expect(drawn.filter((style) => style === 'valley' || style === 'crease').length)
      .toBeGreaterThan(0);
  });

  it('draws an auxiliary step, which leaves no crease in the pattern to draw it', () => {
    const auxIndex = sequence.steps.findIndex((step) => step.cp_line_ids.length === 0);
    expect(auxIndex).toBeGreaterThanOrEqual(0);
    expect(styles(auxIndex).length).toBeGreaterThan(0);
  });

  it('picks out the lines the step is made against', () => {
    // Step 5 (index 4) uses the bottom edge and the landmark's line.
    const scene = planStepScene(sequence, model, 4);
    expect(styles(4).filter((style) => style === 'highlight').length).toBeGreaterThanOrEqual(2);
    expect(scene.bounds).not.toBeNull();
  });

  it('marks the points a step folds through', () => {
    const marks = (planStepScene(sequence, model, 1).diagram?.primitives ?? []).filter(
      (p) => p.kind === 'point'
    );
    expect(marks.length).toBeGreaterThan(0);
  });

  it('hands the view the crease ids the step realises', () => {
    expect(planStepScene(sequence, model, 2).highlightLineIds).toEqual([2, 3]);
    expect(planStepScene(sequence, model, 0).highlightLineIds).toEqual([]);
  });

  it('draws a pinch as its spans', () => {
    expect(styles(0).filter((s) => s === 'pinch')).toHaveLength(2);
  });

  it('is empty for a step index that names nothing', () => {
    const scene = planStepScene(sequence, model, 99);
    expect(scene.diagram).toBeNull();
    expect(scene.highlightLineIds).toEqual([]);
  });
});

describe('planTurnOverScene', () => {
  const sequence = plannerSequenceFixture();
  const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));

  // The card's own picture, on the pattern: the creases so far in the card's
  // grey, and the symbol — nothing picked out, nothing to frame.
  it('draws the creases made so far, greyed, under the turn-over symbol', () => {
    const scene = planTurnOverScene(sequence, model, 1);
    const primitives = scene.diagram?.primitives ?? [];
    const lines = primitives.filter((p) => p.kind === 'line');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((p) => p.kind === 'line' && p.style === 'crease')).toBe(true);
    expect(primitives.filter((p) => p.kind === 'turn-over')).toHaveLength(1);
    expect(scene.bounds).toBeNull();
    expect(scene.highlightLineIds).toEqual([]);
  });

  it('draws only the symbol before the first fold', () => {
    const primitives = planTurnOverScene(sequence, model, null).diagram?.primitives ?? [];
    expect(primitives.filter((p) => p.kind === 'line')).toHaveLength(0);
    expect(primitives.filter((p) => p.kind === 'turn-over')).toHaveLength(1);
  });

  it('frames a grid step by its whole family, not its first line', () => {
    const gridded = plannerSequenceWithGridFixture();
    const scene = planStepScene(
      gridded,
      decodePlanModel(gridded, mapToModel(planModelPoints(gridded))),
      0
    );
    // The vertical family, x = ¼ … ¾, edge to edge.
    expect(scene.bounds).toEqual({ minX: -100, maxX: 100, minY: -200, maxY: 200 });
    // Every pattern crease the family holds, for the canvas's crease visibility.
    expect(scene.highlightLineIds).toEqual([1, 2, 3]);
  });
});
