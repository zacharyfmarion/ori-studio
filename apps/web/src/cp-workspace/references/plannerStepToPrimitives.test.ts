import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  plannerFinishedDiagram,
  plannerReverseDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerStepToPrimitives';

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

describe('the closing steps', () => {
  const sequence = plannerSequenceFixture();

  it('draws the whole sheet plus a turn-over arrow', () => {
    const diagram = plannerTurnOverDiagram(sequence);
    expect(diagram.primitives[0]).toEqual({ kind: 'sheet', width: 1, height: 1 });
    expect(diagram.primitives.filter((p) => p.kind === 'arc')).toHaveLength(1);
    // Every crease made, as context: none of them is the instruction.
    expect(
      diagram.primitives.every((p) => p.kind !== 'line' || p.style === 'crease')
    ).toBe(true);
  });

  it('draws the creases to reverse as valleys, because from the back they are', () => {
    const diagram = plannerReverseDiagram(sequence, new Set([1]));
    const valleys = diagram.primitives.filter((p) => p.kind === 'line' && p.style === 'valley');
    const creases = diagram.primitives.filter((p) => p.kind === 'line' && p.style === 'crease');
    expect(valleys.length).toBeGreaterThan(0);
    expect(creases.length).toBeGreaterThan(0);
    // No arrow: the instruction is to reverse, not to fold something new.
    expect(diagram.primitives.some((p) => p.kind === 'arc')).toBe(false);
  });

  it('draws the finished pattern in the directions it ends up with', () => {
    const directions = sequence.steps.map((_, i) =>
      i === 0 ? ('mountain' as const) : i === 1 ? ('valley' as const) : ('none' as const)
    );
    const diagram = plannerFinishedDiagram(sequence, directions);
    const styles = diagram.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).toContain('mountain');
    expect(styles).toContain('valley');
    // A step with no crease in the pattern has no direction to state.
    expect(styles).toContain('crease');
  });
});
