import { describe, expect, it } from 'vitest';
import { returnStroke } from '../stepDiagramGeometry';
import { unitFrame } from './diagramFrames';
import { plannerSequenceFixture } from '../__fixtures__/plannerSequence';
import {
  plannerFinishedDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerDiagram';
import type {
  PrecreaseDirection,
  PrecreasePlanSegment,
  PrecreaseSequence,
} from '../precreaseSequence';

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
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 1);
    expect(diagram?.primitives[0]).toEqual({ kind: 'sheet', width: 1, height: 1 });
    expect(diagram?.sheet).toEqual({ width: 1, height: 1 });
  });

  it('draws a pinched step as its spans, never as a full crease', () => {
    // The difference is the whole point of the pinch pass, and a thumbnail
    // that got it wrong would be telling the folder to leave a visible line.
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 0);
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
    const valley = plannerStepDiagram(directed('unassigned', 'valley'), unitFrame(directed('unassigned', 'valley')), 1);
    expect(
      valley?.primitives.filter((p) => p.kind === 'line' && p.style === 'valley')
    ).toHaveLength(1);
    const mountain = plannerStepDiagram(directed('unassigned', 'mountain'), unitFrame(directed('unassigned', 'mountain')), 1);
    expect(
      mountain?.primitives.filter((p) => p.kind === 'line' && p.style === 'mountain')
    ).toHaveLength(1);
  });

  // An auxiliary line is creased, but the pattern assigns it nothing — so it
  // takes the neutral ink rather than borrowing a direction it does not have.
  it('draws an unassigned crease in neither direction', () => {
    const diagram = plannerStepDiagram(directed('unassigned', 'unassigned'), unitFrame(directed('unassigned', 'unassigned')), 1);
    const styles = diagram?.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).not.toContain('valley');
    expect(styles).not.toContain('mountain');
  });

  it('draws the references the fold is made against', () => {
    // Step 5 (index 4) is O3 on the bottom edge and the landmark's crease.
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 4);
    const highlights = diagram?.primitives.filter(
      (primitive) => primitive.kind === 'line' && primitive.style === 'highlight'
    );
    expect(highlights).toHaveLength(2);
  });

  // The ring around a mark says where it is. Picking out the two creases that
  // put it there as well turned a step with one landmark into a picture with
  // three highlighted things in it, and the extra two are not what the sentence
  // is pointing at.
  it('marks a point input with its ring alone, not the creases that locate it', () => {
    // Step 2's inputs are the SW corner and the mark where the left edge meets
    // the auxiliary crease from step 1 — both of those lines are already made.
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 1);
    const highlights = (diagram?.primitives ?? []).filter(
      (primitive) => primitive.kind === 'line' && primitive.style === 'highlight'
    );
    expect(highlights).toHaveLength(0);
    expect(
      (diagram?.primitives ?? []).filter(
        (primitive) => primitive.kind === 'point' && primitive.style === 'highlight'
      )
    ).toHaveLength(2);
  });

  // A crease pattern's line is not an instruction to crease all of it. The rest
  // of the chord used to be drawn faintly to say the fold still runs the full
  // width, and the faint stand-in read as one more thing to fold.
  it('draws only what the step actually creases', () => {
    for (const index of [0, 1, 2, 3, 4]) {
      const styles = (plannerStepDiagram(sequence, unitFrame(sequence), index)?.primitives ?? []).flatMap((p) =>
        p.kind === 'line' ? [p.style] : []
      );
      expect(styles).not.toContain('unfolded');
    }
  });

  it('draws a corner input as a point', () => {
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 0);
    expect(diagram?.primitives.filter((primitive) => primitive.kind === 'point')).toHaveLength(2);
  });

  // Every step here is a precrease: folded, then released. The symbol for that
  // is the path the paper takes over the crease and back — one stroke out, one
  // back, one head — not an arc with a head at each end, which says the paper
  // ends up somewhere it does not.
  it('draws the motion as the path out to the image and back', () => {
    // The fixture's witnesses all move input 0. The outgoing arc is upstream's
    // `CalcArrow`; what matters here is that the round trip is drawn and that
    // it begins and ends where the moving input is.
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 1);
    const arrows = diagram?.primitives.filter((primitive) => primitive.kind === 'fold-arrow') ?? [];
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0];
    if (arrow.kind !== 'fold-arrow') throw new Error('not a fold arrow');
    expect(arrow.out.radius).toBeGreaterThan(0);
    const at = (arc: typeof arrow.out, angle: number) => [
      arc.center[0] + arc.radius * Math.cos(angle),
      arc.center[1] + arc.radius * Math.sin(angle),
    ];
    // The return comes back *beside* the mark, not onto it: that is where the
    // one arrowhead goes, and a head landing on the mark buries it. Derived
    // where the picture is drawn, so this asks for it by the same offset.
    const back = returnStroke(arrow.out, 0.1);
    expect(back).not.toBeNull();
    const start = at(arrow.out, arrow.out.from);
    const end = at(back!, back!.to);
    expect(Math.hypot(end[0] - start[0], end[1] - start[1])).toBeCloseTo(0.1, 9);
  });

  it('letters the inputs the way ReferenceFinder does: A… for lines, P… for marks', () => {
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 4);
    const labels = (diagram?.primitives ?? []).filter(
      (primitive) => primitive.kind === 'label'
    );
    const text = labels.map((label) => (label.kind === 'label' ? label.text : ''));
    // Step 5 is O3 on two lines.
    expect(text).toEqual(['A', 'B']);
  });

  it('draws the letters last, so a crease cannot cover them', () => {
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 4);
    const kinds = (diagram?.primitives ?? []).map((primitive) => primitive.kind);
    expect(kinds[kinds.length - 1]).toBe('label');
  });

  it('is null for an index that names no step', () => {
    expect(plannerStepDiagram(sequence, unitFrame(sequence), 42)).toBeNull();
  });
});

// The canvas draws the document's own creases under this, so a step that drew
// them again would be putting two copies of one line a hair apart — each one
// filling the other's dash gaps, which is how it was found.
describe('a surface that already has the crease pattern under it', () => {
  /**
   * The fixture with every step folded as a valley — so the step's own crease
   * is told apart from the build-up by its style — and the first two of them
   * creasing something the pattern holds.
   */
  function patterned(inPattern = 2): PrecreaseSequence {
    const sequence = plannerSequenceFixture();
    return {
      ...sequence,
      steps: sequence.steps.map((step, i) => ({
        ...step,
        direction: 'valley' as const,
        direction_share: 1,
        ...(i < inPattern
          ? {
              extent: { kind: 'full' as const },
              cp_spans: [
                [
                  [0, 0.2 * (i + 1)],
                  [1, 0.2 * (i + 1)],
                ],
              ] as PrecreasePlanSegment[],
            }
          : {}),
      })),
    };
  }

  const creaseLines = (sequence: PrecreaseSequence, earlier?: 'all' | 'unpatterned') =>
    (
      plannerStepDiagram(sequence, unitFrame(sequence), 3, earlier ? { earlier } : {})
        ?.primitives ?? []
    ).filter((p) => p.kind === 'line' && p.style === 'crease');

  it('leaves out the earlier creases the pattern is drawing', () => {
    const sequence = patterned();
    expect(creaseLines(sequence, 'all')).toHaveLength(3);
    // Steps 0 and 1 are in the pattern; step 2's auxiliary chord is not.
    expect(creaseLines(sequence, 'unpatterned')).toHaveLength(1);
  });

  it('still draws the marks no crease pattern records', () => {
    // A pinch and an auxiliary fold leave nothing behind for the pattern to
    // hold, so dropping them here would drop them from the picture entirely.
    const sequence = patterned(0);
    expect(creaseLines(sequence, 'unpatterned')).toEqual(creaseLines(sequence, 'all'));
    expect(creaseLines(sequence, 'unpatterned').length).toBeGreaterThan(0);
  });

  it('never touches the crease the step is about, which is the point of it', () => {
    const sequence = patterned();
    const own = (earlier: 'all' | 'unpatterned') =>
      (
        plannerStepDiagram(sequence, unitFrame(sequence), 1, { earlier })?.primitives ?? []
      ).filter((p) => p.kind === 'line' && p.style !== 'crease' && p.style !== 'highlight');
    expect(own('unpatterned')).toEqual(own('all'));
    expect(own('unpatterned').length).toBeGreaterThan(0);
  });
});

describe('the cards that are not folds', () => {
  const sequence = plannerSequenceFixture();

  // The turn-over symbol is the house's own glyph — a stroke that loops once —
  // not a chord across the sheet with a head at each end, which is a *fold*
  // arrow and said the wrong thing.
  it('draws the house turn-over glyph on the sheet', () => {
    const diagram = plannerTurnOverDiagram(sequence, unitFrame(sequence), null);
    const glyphs = diagram.primitives.filter((p) => p.kind === 'turn-over');
    expect(glyphs).toHaveLength(1);
    const [glyph] = glyphs;
    if (glyph.kind !== 'turn-over') throw new Error('shape');
    expect(glyph.at).toEqual([0.5, 0.5]);
    // And it is the only thing on a card with nothing folded yet.
    expect(diagram.primitives.filter((p) => p.kind === 'arc')).toHaveLength(0);
    expect(diagram.primitives.filter((p) => p.kind === 'line')).toHaveLength(0);
  });

  it('draws the build-up so far under the glyph', () => {
    const diagram = plannerTurnOverDiagram(sequence, unitFrame(sequence), sequence.steps.length - 1);
    expect(diagram.primitives[0]).toEqual({ kind: 'sheet', width: 1, height: 1 });
    expect(diagram.primitives.filter((p) => p.kind === 'turn-over')).toHaveLength(1);
    // Every crease made, as context: none of them is the instruction.
    expect(diagram.primitives.every((p) => p.kind !== 'line' || p.style === 'crease')).toBe(true);
  });

  // A turn-over happens between folds, so it must not show creases the folder
  // has not made yet — which is what drawing the whole sequence would do.
  it('draws only the creases folded by the time it is reached', () => {
    const lines = (after: number | null) =>
      plannerTurnOverDiagram(sequence, unitFrame(sequence), after).primitives.filter((p) => p.kind === 'line').length;
    expect(lines(null)).toBe(0);
    expect(lines(0)).toBeLessThan(lines(sequence.steps.length - 1));
  });

  it('draws the finished pattern in the directions its steps were made in', () => {
    const finished = directed('mountain', 'valley');
    const diagram = plannerFinishedDiagram(finished, unitFrame(finished));
    const styles = diagram.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).toContain('mountain');
    expect(styles).toContain('valley');
    // A step with no crease in the pattern has no direction to state.
    expect(styles).toContain('crease');
  });
});
