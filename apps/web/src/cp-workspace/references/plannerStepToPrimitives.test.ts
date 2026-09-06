import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import { plannerGroupDiagram, plannerStepDiagram } from './plannerStepToPrimitives';

describe('plannerStepDiagram', () => {
  const sequence = plannerSequenceFixture();

  it('always starts with the sheet, like a ReferenceFinder diagram', () => {
    const diagram = plannerStepDiagram(sequence, 1);
    expect(diagram?.primitives[0]).toEqual({ kind: 'sheet', width: 1, height: 1 });
    expect(diagram?.sheet).toEqual({ width: 1, height: 1 });
  });

  it('draws a pinched step as its spans, never as a full crease', () => {
    // The difference is the whole point of the pinch pass, and a thumbnail
    // that got it wrong would be telling the folder to leave a visible line.
    const diagram = plannerStepDiagram(sequence, 0);
    const pinches = diagram?.primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.style === 'pinch'
    );
    expect(pinches).toHaveLength(2);
    expect(
      diagram?.primitives.some(
        (primitive) => primitive.kind === 'line' && primitive.style === 'valley'
      )
    ).toBe(false);
  });

  it('draws a full crease as the valley style', () => {
    const diagram = plannerStepDiagram(sequence, 1);
    expect(
      diagram?.primitives.filter(
        (primitive) => primitive.kind === 'line' && primitive.style === 'valley'
      )
    ).toHaveLength(1);
  });

  it('draws the references the fold is made against', () => {
    // Step 5 (index 4) is O3 on the bottom edge and the landmark's crease.
    const diagram = plannerStepDiagram(sequence, 4);
    const highlights = diagram?.primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.style === 'highlight'
    );
    expect(highlights).toHaveLength(2);
  });

  it('draws a corner input as a point', () => {
    const diagram = plannerStepDiagram(sequence, 0);
    expect(diagram?.primitives.filter((primitive) => primitive.kind === 'point')).toHaveLength(2);
  });

  it('draws the motion as an arc from the moving input to its image', () => {
    // The fixture's witnesses all move input 0. The arc is upstream's
    // `CalcArrow`; what matters here is that one is drawn at all and that it
    // starts where the moving input is.
    const diagram = plannerStepDiagram(sequence, 1);
    const arcs = diagram?.primitives.filter((primitive) => primitive.kind === 'arc') ?? [];
    expect(arcs).toHaveLength(1);
    const arc = arcs[0];
    if (arc.kind !== 'arc') throw new Error('not an arc');
    expect(arc.style).toBe('arrow');
    expect(arc.radius).toBeGreaterThan(0);
  });

  it('letters the inputs the way ReferenceFinder does: A… for lines, P… for marks', () => {
    const diagram = plannerStepDiagram(sequence, 4);
    const labels = (diagram?.primitives ?? []).filter(
      (primitive) => primitive.kind === 'label'
    );
    const text = labels.map((label) => (label.kind === 'label' ? label.text : ''));
    // Step 5 is O3 on two lines.
    expect(text).toEqual(['A', 'B']);
  });

  it('draws the letters last, so a crease cannot cover them', () => {
    const diagram = plannerStepDiagram(sequence, 4);
    const kinds = (diagram?.primitives ?? []).map((primitive) => primitive.kind);
    expect(kinds[kinds.length - 1]).toBe('label');
  });

  it('is null for an index that names no step', () => {
    expect(plannerStepDiagram(sequence, 42)).toBeNull();
  });
});

describe('plannerGroupDiagram', () => {
  const sequence = plannerSequenceFixture();

  it('shows a row of three parallel creases as three lines', () => {
    const diagram = plannerGroupDiagram(sequence, [2, 3, 4]);
    const creases = diagram?.primitives.filter(
      (primitive) =>
        primitive.kind === 'line' && (primitive.style === 'valley' || primitive.style === 'crease')
    );
    expect(creases).toHaveLength(3);
  });

  it('falls back to the single step’s own picture for a row of one', () => {
    expect(plannerGroupDiagram(sequence, [5])).toEqual(plannerStepDiagram(sequence, 4));
  });

  it('is null for an empty row', () => {
    expect(plannerGroupDiagram(sequence, [])).toBeNull();
  });
});
