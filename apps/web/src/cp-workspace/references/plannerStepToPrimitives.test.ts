import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  plannerFinishedDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerStepToPrimitives';
import { arcExtent } from './stepDiagramGeometry';
import type { PrecreaseDirection, PrecreaseSequence } from './precreaseSequence';

/** The fixture with a direction on each step, since the fixture's is neutral. */
function directed(...directions: PrecreaseDirection[]): PrecreaseSequence {
  const sequence = plannerSequenceFixture();
  return {
    ...sequence,
    steps: sequence.steps.map((step, i) => ({
      ...step,
      direction: directions[i] ?? 'unassigned',
      direction_share: directions[i] && directions[i] !== 'unassigned' ? 1 : 0,
      side: directions[i] === 'mountain' ? ('back' as const) : ('front' as const),
    })),
  };
}

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

  it('draws a full crease in the direction the crate settled', () => {
    const valley = plannerStepDiagram(directed('unassigned', 'valley'), 1);
    expect(
      valley?.primitives.filter((p) => p.kind === 'line' && p.style === 'valley')
    ).toHaveLength(1);
    const mountain = plannerStepDiagram(directed('unassigned', 'mountain'), 1);
    expect(
      mountain?.primitives.filter((p) => p.kind === 'line' && p.style === 'mountain')
    ).toHaveLength(1);
  });

  // An auxiliary line is creased, but the pattern assigns it nothing — so it
  // takes the neutral ink rather than borrowing a direction it does not have.
  it('draws an unassigned crease in neither direction', () => {
    const diagram = plannerStepDiagram(directed('unassigned', 'unassigned'), 1);
    const styles = diagram?.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).not.toContain('valley');
    expect(styles).not.toContain('mountain');
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

describe('the cards that are not folds', () => {
  const sequence = plannerSequenceFixture();

  // The turn-over symbol is a ring with an arrow looping over it, not a chord
  // across the sheet with a head at each end — that is a *fold* arrow, and it
  // said the wrong thing.
  it('draws the standard turn-over symbol, one-headed, on the sheet', () => {
    const diagram = plannerTurnOverDiagram(sequence, null);
    const ring = diagram.primitives.filter((p) => p.kind === 'circle');
    const arcs = diagram.primitives.filter((p) => p.kind === 'arc');
    expect(ring).toHaveLength(1);
    expect(arcs).toHaveLength(1);
    const [loop] = arcs;
    if (loop.kind !== 'arc' || ring[0]?.kind !== 'circle') throw new Error('shape');
    // One head: a turn-over is a one-way motion, unlike a fold.
    expect(loop.heads).toBe('end');
    // The arrow clears the ring it loops over, and both sit on the sheet.
    expect(loop.radius).toBeGreaterThan(ring[0].radius);
    expect(ring[0].at).toEqual([0.5, 0.5]);
    expect(loop.center).toEqual([0.5, 0.5]);
    expect(loop.radius).toBeLessThan(0.5);
    // Left, over the top, down to the right: the arrow starts on the far side
    // from where it ends, and passes above the centre on the way.
    expect(Math.cos(loop.from)).toBeLessThan(0);
    expect(Math.cos(loop.to)).toBeGreaterThan(0);
    expect(arcExtent(loop)).toBeGreaterThan(Math.PI);
  });

  it('draws the build-up so far plus a turn-over arrow', () => {
    const diagram = plannerTurnOverDiagram(sequence, sequence.steps.length - 1);
    expect(diagram.primitives[0]).toEqual({ kind: 'sheet', width: 1, height: 1 });
    expect(diagram.primitives.filter((p) => p.kind === 'arc')).toHaveLength(1);
    // Every crease made, as context: none of them is the instruction.
    expect(diagram.primitives.every((p) => p.kind !== 'line' || p.style === 'crease')).toBe(true);
  });

  // A turn-over happens between folds, so it must not show creases the folder
  // has not made yet — which is what drawing the whole sequence would do.
  it('draws only the creases folded by the time it is reached', () => {
    const lines = (after: number | null) =>
      plannerTurnOverDiagram(sequence, after).primitives.filter((p) => p.kind === 'line').length;
    expect(lines(null)).toBe(0);
    expect(lines(0)).toBeLessThan(lines(sequence.steps.length - 1));
  });

  it('draws the finished pattern in the directions its steps were made in', () => {
    const diagram = plannerFinishedDiagram(directed('mountain', 'valley'));
    const styles = diagram.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).toContain('mountain');
    expect(styles).toContain('valley');
    // A step with no crease in the pattern has no direction to state.
    expect(styles).toContain('crease');
  });
});
