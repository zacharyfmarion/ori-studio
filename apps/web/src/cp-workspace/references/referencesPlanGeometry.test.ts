import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  decodePlanModel,
  EDGE_ORDER,
  findingBounds,
  planModelPoints,
  planStepOverlay,
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

  it('lays the request out in exactly the order it is read back', () => {
    // Two values per point, and the count has to match or every later entry
    // is off by one — the one failure mode this contract can have.
    const expected =
      sequence.steps.reduce(
        (n, step) => n + 2 + (step.extent.kind === 'pinches' ? step.extent.spans.length * 2 : 0),
        0
      ) +
      sequence.points.length +
      8 +
      sequence.findings.filter((finding) => finding.segment).length * 2;
    expect(planModelPoints(sequence).length).toBe(expected * 2);
  });
});

describe('planStepOverlay', () => {
  const sequence = plannerSequenceFixture();
  const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));

  it('draws the fold across the sheet, and creases only what the pattern gains', () => {
    const overlay = planStepOverlay(sequence, model, 2);
    const kinds = overlay.ghosts.map((ghost) => ghost.kind);
    // The whole chord, faintly: the fold runs the width of the paper whatever
    // is pressed along it.
    expect(kinds.filter((kind) => kind === 'unfolded')).toHaveLength(1);
    // …and no `new` ghost, because this step puts creases in the pattern and
    // the pattern draws them. Ghosting them too drew each crease twice, and
    // drew it right across the sheet where the pattern gains only part of it.
    expect(kinds.filter((kind) => kind === 'new')).toHaveLength(0);
    // Steps 1 and 2 came earlier; nothing after step 3 is drawn.
    expect(overlay.ghosts.length).toBeLessThanOrEqual(6);
  });

  it('ghosts an auxiliary step, which has no crease in the pattern to draw it', () => {
    const auxIndex = sequence.steps.findIndex((step) => step.cp_line_ids.length === 0);
    expect(auxIndex).toBeGreaterThanOrEqual(0);
    const overlay = planStepOverlay(sequence, model, auxIndex);
    expect(overlay.ghosts.filter((ghost) => ghost.kind === 'new').length).toBeGreaterThan(0);
  });

  it('picks out the lines the step is made against', () => {
    // Step 5 (index 4) uses the bottom edge and the landmark's line.
    const overlay = planStepOverlay(sequence, model, 4);
    const inputs = overlay.ghosts.filter((ghost) => ghost.kind === 'input');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(overlay.bounds).not.toBeNull();
  });

  it('marks the points a step folds through', () => {
    const overlay = planStepOverlay(sequence, model, 1);
    expect(overlay.markers.map((marker) => marker.kind)).toContain('input');
  });

  it('hands the view the crease ids the step realises', () => {
    expect(planStepOverlay(sequence, model, 2).highlightLineIds).toEqual([2, 3]);
    expect(planStepOverlay(sequence, model, 0).highlightLineIds).toEqual([]);
  });

  it('draws a pinch as its spans, and as a full line when pinches are hidden', () => {
    const shown = planStepOverlay(sequence, model, 0, { showPinches: true });
    const hidden = planStepOverlay(sequence, model, 0, { showPinches: false });
    expect(shown.ghosts.filter((ghost) => ghost.kind === 'new')).toHaveLength(2);
    expect(hidden.ghosts.filter((ghost) => ghost.kind === 'new')).toHaveLength(1);
  });

  it('is empty for a step index that names nothing', () => {
    const overlay = planStepOverlay(sequence, model, 99);
    expect(overlay.ghosts).toEqual([]);
    expect(overlay.highlightLineIds).toEqual([]);
  });
});

describe('findingBounds', () => {
  const sequence = plannerSequenceFixture();
  const model = decodePlanModel(sequence, mapToModel(planModelPoints(sequence)));

  it('frames a finding by its own segment', () => {
    expect(findingBounds(model, 0)).not.toBeNull();
    expect(findingBounds(model, 5)).toBeNull();
  });
});
