import { describe, expect, it } from 'vitest';
import { returnStroke } from '../stepDiagramGeometry';
import { seenFromTheBack } from './diagramModel';
import { modelFrame, unitFrame } from './diagramFrames';
import { decodePlanModel, planModelPoints } from '../referencesPlanGeometry';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import {
  plannerSequenceFixture,
  plannerSequenceWithGridFixture,
} from '../__fixtures__/plannerSequence';
import {
  plannerFinishedDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerDiagram';
import type {
  PrecreaseDirection,
  PrecreaseGridBound,
  PrecreaseGridStepLine,
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
    expect(diagram?.sheet).toEqual({ width: 1, height: 1, centre: [0.5, 0.5] });
  });

  // A symmetric design's second pair for the same fold: drawn beside the
  // first with the next letters, its own ring on each mark and its own
  // arrow, so the folder lines up both ends of the fold at once.
  it('draws a mirror witness with its own letters and arrow', () => {
    const also = {
      ...sequence.steps[1]!.witnesses[0]!,
      inputs: [
        { kind: 'corner' as const, id: 1, corner: 'se' as const },
        { kind: 'point' as const, id: 4 },
      ],
    };
    const mirrored = {
      ...sequence,
      steps: sequence.steps.map((s, i) => (i === 1 ? { ...s, also } : s)),
    };
    const alone = plannerStepDiagram(sequence, unitFrame(sequence), 1);
    const both = plannerStepDiagram(mirrored, unitFrame(mirrored), 1);
    const letters = (model: typeof both) =>
      model?.primitives.flatMap((p) => (p.kind === 'label' ? [p.text] : [])) ?? [];
    expect(letters(alone)).toEqual(['P', 'Q']);
    // The mirror shares the mark both corners fold onto: it keeps Q, and
    // its ring is drawn once.
    expect(letters(both)).toEqual(['P', 'Q', 'R']);
    const arrows = (model: typeof both) =>
      model?.primitives.filter((p) => p.kind === 'fold-arrow').length ?? 0;
    expect(arrows(both)).toBe(arrows(alone) + 1);
    const rings = (model: typeof both) =>
      model?.primitives.filter((p) => p.kind === 'point').length ?? 0;
    expect(rings(both)).toBe(rings(alone) + 1);
  });

  // A twin pair — two folds that mirror each other, made at once — is one
  // card: both creases, both witnesses with the letters carrying on, an
  // arrow for each.
  it('draws a twin pair on one card with both creases and continued letters', () => {
    const mirror = {
      ...sequence.steps[2]!.witnesses[0]!,
      inputs: [
        { kind: 'corner' as const, id: 1, corner: 'se' as const },
        { kind: 'point' as const, id: 5 },
      ],
    };
    const paired = {
      ...sequence,
      points: [...sequence.points, { id: 5, p: [1, 0.5] as [number, number], lines: [1, 4], on_boundary: true }],
      steps: sequence.steps.map((s, i) =>
        i === 1 ? { ...s, twin: 3 } : i === 2 ? { ...s, twin: 2, witnesses: [mirror], chosen: 0 } : s
      ),
    };
    const alone = plannerStepDiagram(sequence, unitFrame(sequence), 1);
    const both = plannerStepDiagram(paired, unitFrame(paired), 1, { twin: 2 });
    const letters = (model: typeof both) =>
      model?.primitives.flatMap((p) => (p.kind === 'label' ? [p.text] : [])) ?? [];
    expect(letters(alone)).toEqual(['P', 'Q']);
    expect(letters(both)).toEqual(['P', 'Q', 'R', 'S']);
    const arrows = (model: typeof both) =>
      model?.primitives.filter((p) => p.kind === 'fold-arrow').length ?? 0;
    expect(arrows(both)).toBe(arrows(alone) + 1);
    // Two chords in the fold's own style: the pair's creases.
    const creases = (model: typeof both) =>
      model?.primitives.filter(
        (p) => p.kind === 'line' && p.style !== 'highlight' && p.style !== 'crease'
      ).length ?? 0;
    expect(creases(both)).toBe(creases(alone) * 2);
  });

  // A mark both folds of a pair use — the centre both corners fold onto —
  // is one thing on the card: one ring, one letter, named the same in both.
  it('letters a reference both twins share once', () => {
    const shared = {
      ...sequence.steps[1]!.witnesses[0]!,
      inputs: [
        { kind: 'corner' as const, id: 1, corner: 'se' as const },
        { kind: 'point' as const, id: 4 },
      ],
    };
    const paired = {
      ...sequence,
      steps: sequence.steps.map((s, i) =>
        i === 1 ? { ...s, twin: 3 } : i === 2 ? { ...s, twin: 2, witnesses: [shared], chosen: 0 } : s
      ),
    };
    const both = plannerStepDiagram(paired, unitFrame(paired), 1, { twin: 2 });
    const letters = both?.primitives.flatMap((p) => (p.kind === 'label' ? [p.text] : [])) ?? [];
    expect(letters).toEqual(['P', 'Q', 'R']);
    expect(both?.primitives.filter((p) => p.kind === 'point')).toHaveLength(3);
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

  // The model names directions from the front, as the pattern does; the card
  // of the paper's back renames them once, at render time. A mountain made
  // from the back is a valley on the face that card shows — "fold P onto Q"
  // — and renaming it anywhere else as well would show a mountain there
  // again. This is the composition, which no test of either half covers.
  it('shows a mountain made from the back as a valley on the back-face card', () => {
    const seq = directed('unassigned', 'mountain');
    const model = plannerStepDiagram(seq, unitFrame(seq), 1);
    expect(seq.steps[1]!.side).toBe('back');
    const shown = seenFromTheBack(model?.primitives ?? []);
    expect(shown.filter((p) => p.kind === 'line' && p.style === 'valley')).toHaveLength(1);
    expect(shown.some((p) => p.kind === 'line' && p.style === 'mountain')).toBe(false);
  });

  it('draws an unassigned crease in neither direction', () => {
    const diagram = plannerStepDiagram(directed('unassigned', 'unassigned'), unitFrame(directed('unassigned', 'unassigned')), 1);
    const styles = diagram?.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).not.toContain('valley');
    expect(styles).not.toContain('mountain');
  });

  it('draws the references the fold is made against', () => {
    // Step 5 (index 4) is O3 on the bottom edge and the landmark's crease.
    const diagram = plannerStepDiagram(sequence, unitFrame(sequence), 4);
    // Two inputs, two letters. The landmark's crease is two pinches on the
    // paper, so it is drawn as two pieces — the crease as it is, not its chord.
    const labels = (diagram?.primitives ?? []).filter((p) => p.kind === 'label');
    expect(labels.map((l) => (l.kind === 'label' ? l.text : ''))).toEqual(['A', 'B']);
    const highlights = (diagram?.primitives ?? []).filter(
      (primitive) => primitive.kind === 'line' && primitive.style === 'highlight'
    );
    expect(highlights).toHaveLength(3);
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

  // A fold creased on past the pattern's line, because a later step lines
  // up against it there: that crease is made now, in the step's own style,
  // and is on the paper for every later card.
  it('draws what a step presses on past the pattern, now and later', () => {
    const seq = directed('unassigned', 'valley');
    const on = {
      ...seq,
      steps: seq.steps.map((s, i) =>
        i === 1
          ? {
              ...s,
              pressed_on: [
                [
                  [0.5, 0.5],
                  [0.5, 0.2],
                ] as [[number, number], [number, number]],
              ],
            }
          : s
      ),
    };
    const near = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;
    const seg = (l: Extract<StepDiagramPrimitive, { kind: 'line' }>, a: number[], b: number[]) =>
      (near(l.from, a) && near(l.to, b)) || (near(l.from, b) && near(l.to, a));
    const own = plannerStepDiagram(on, unitFrame(on), 1);
    const valleys = (own?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'valley'
    );
    expect(valleys.some((l) => seg(l, [0.5, 0.5], [0.5, 0.2]))).toBe(true);
    // And on the next card it is crease already there.
    const later = plannerStepDiagram(on, unitFrame(on), 2);
    const earlier = (later?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'crease'
    );
    expect(earlier.some((l) => seg(l, [0.5, 0.5], [0.5, 0.2]))).toBe(true);
  });

  // A fold the pattern holds in pieces is made as one crease, from the
  // reference each end stops at: `made` is what the folder creases, and the
  // pieces are only where the pattern's own creases are.
  it('draws the crease the step makes, not the pattern’s pieces', () => {
    const seq = directed('unassigned', 'valley');
    const near = (a: readonly number[], b: readonly number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;
    const seg = (l: Extract<StepDiagramPrimitive, { kind: 'line' }>, a: number[], b: number[]) =>
      (near(l.from, a) && near(l.to, b)) || (near(l.from, b) && near(l.to, a));
    const pieces: PrecreasePlanSegment[] = [
      [
        [0.25, 0.1],
        [0.25, 0.3],
      ],
      [
        [0.25, 0.6],
        [0.25, 0.8],
      ],
    ];
    const whole: PrecreasePlanSegment[] = [
      [
        [0.25, 0],
        [0.25, 1],
      ],
    ];
    const reached = {
      ...seq,
      steps: seq.steps.map((s, i) =>
        i === 1 ? { ...s, extent: { kind: 'full' as const }, cp_spans: pieces, made: whole } : s
      ),
    };
    const own = plannerStepDiagram(reached, unitFrame(reached), 1);
    const valleys = (own?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'valley'
    );
    expect(valleys).toHaveLength(1);
    expect(seg(valleys[0]!, [0.25, 0], [0.25, 1])).toBe(true);
    // On the next card the whole run is crease already there.
    const later = plannerStepDiagram(reached, unitFrame(reached), 2);
    const earlier = (later?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'crease'
    );
    expect(earlier.some((l) => seg(l, [0.25, 0], [0.25, 1]))).toBe(true);
    // A surface that draws the pattern's creases itself is left the rest:
    // the blank the fold creased through, and the stretch out to each edge.
    const rest = (
      plannerStepDiagram(reached, unitFrame(reached), 2, { earlier: 'unpatterned' })?.primitives ??
      []
    ).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'crease' && near([l(p)[0][0], 0], [0.25, 0])
    );
    function l(p: Extract<StepDiagramPrimitive, { kind: 'line' }>) {
      return [p.from, p.to] as const;
    }
    const spans = rest.map((p) => [p.from[1], p.to[1]].sort((a, b) => a - b));
    expect(spans).toEqual(
      expect.arrayContaining([
        [0, 0.1],
        [0.3, 0.6],
        [0.8, 1],
      ])
    );
    expect(spans).not.toContainEqual([0.1, 0.3]);
    expect(spans).not.toContainEqual([0.6, 0.8]);
    // A plan that did not reach draws the pieces as they are.
    const plain = {
      ...seq,
      steps: seq.steps.map((s, i) =>
        i === 1 ? { ...s, extent: { kind: 'full' as const }, cp_spans: pieces, made: [] } : s
      ),
    };
    const pieceLines = (plannerStepDiagram(plain, unitFrame(plain), 1)?.primitives ?? []).filter(
      (p) => p.kind === 'line' && p.style === 'valley'
    );
    expect(pieceLines).toHaveLength(2);
  });

  // markhor step 38 → 39: a fold made in three runs with blank paper between
  // them. A surface that draws the pattern's own creases is left only what
  // the step creased past them — and there is nothing past them here, so
  // nothing; the blank between the runs is not crease, whichever way the
  // creases of the same line lie beyond a run's ends.
  it('never draws the blank between a step’s runs as crease', () => {
    const seq = directed('unassigned', 'valley');
    // Off the fixture's own landmark at y = ½.
    const y = 0.3;
    const runs: PrecreasePlanSegment[] = [
      [
        [1, y],
        [0.85, y],
      ],
      [
        [0.65, y],
        [0.35, y],
      ],
      [
        [0.15, y],
        [0, y],
      ],
    ];
    const pieces: PrecreasePlanSegment[] = [
      [
        [1, y],
        [0.85, y],
      ],
      [
        [0, y],
        [0.15, y],
      ],
      [
        [0.35, y],
        [0.5, y],
      ],
      [
        [0.65, y],
        [0.5, y],
      ],
    ];
    const across = {
      ...seq,
      steps: seq.steps.map((s, i) =>
        i === 1
          ? {
              ...s,
              line: { n: [0, 1] as [number, number], d: y },
              segment: [
                [0, y],
                [1, y],
              ] as [[number, number], [number, number]],
              extent: { kind: 'full' as const },
              cp_spans: pieces,
              made: runs,
            }
          : s
      ),
    };
    const at = (earlier: 'all' | 'unpatterned') =>
      (plannerStepDiagram(across, unitFrame(across), 2, { earlier })?.primitives ?? [])
        .filter(
          (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
            p.kind === 'line' &&
            p.style === 'crease' &&
            Math.abs(p.from[1] - y) < 1e-9 &&
            Math.abs(p.to[1] - y) < 1e-9
        )
        .map((p) => [p.from[0], p.to[0]].sort((a, b) => a - b).map((v) => +v.toFixed(3)))
        .sort((a, b) => a[0]! - b[0]!);
    expect(at('all')).toEqual([
      [0, 0.15],
      [0.35, 0.65],
      [0.85, 1],
    ]);
    expect(at('unpatterned')).toEqual([]);
  });

  // The dash pattern of the crease a step makes begins where the crease
  // begins, whatever the line's position on the sheet: a short crease that
  // started in a gap of the pattern read as no fold at all.
  it('opens the crease it makes with a dash', () => {
    const seq = directed('unassigned', 'valley');
    const short = {
      ...seq,
      steps: seq.steps.map((s, i) =>
        i === 1
          ? {
              ...s,
              extent: { kind: 'full' as const },
              cp_spans: [
                [
                  [0.25, 0.71],
                  [0.25, 0.73],
                ],
              ] as PrecreasePlanSegment[],
              made: [
                [
                  [0.25, 0.71],
                  [0.25, 0.73],
                ],
              ] as PrecreasePlanSegment[],
            }
          : s
      ),
    };
    const lines = (plannerStepDiagram(short, unitFrame(short), 1)?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'valley'
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.dashPhase ?? 0).toBeCloseTo(0, 9);
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
    // The auxiliary first step was made in a direction too, but the finished
    // pattern assigns it none: it is drawn neutral there.
    const finished = directed('valley', 'mountain', 'valley');
    const diagram = plannerFinishedDiagram(finished, unitFrame(finished));
    const styles = diagram.primitives.flatMap((p) => (p.kind === 'line' ? [p.style] : []));
    expect(styles).toContain('mountain');
    expect(styles).toContain('valley');
    expect(styles).toContain('crease');
    const auxStyles = plannerFinishedDiagram(finished, unitFrame(finished))
      .primitives.filter((p) => p.kind === 'line' && p.style === 'pinch-valley');
    expect(auxStyles).toHaveLength(0);
  });
});

describe('a press step', () => {
  // A press carries the witness of the fold that made its line — here the
  // fixture's step 2, O2 folding the SW corner onto a mark — so it draws as
  // that fold did, with a pinch for its extent.
  const sequence = plannerSequenceFixture();
  const made = sequence.steps[1]!;
  const press = {
    ...made,
    id: 99,
    kind: 'press' as const,
    cp_line_ids: [],
    cp_spans: [],
    direction: 'valley' as const,
    extent: { kind: 'pinches' as const, spans: [[[0.47, 0.5], [0.53, 0.5]] as [[number, number], [number, number]]] },
    press: { at: [0.5, 0.5] as [number, number], point: 4, sighted_from: 6 },
  };
  const withPress = { ...sequence, steps: [...sequence.steps, press] };
  const diagram = plannerStepDiagram(withPress, unitFrame(withPress), withPress.steps.length - 1);
  const original = plannerStepDiagram(sequence, unitFrame(sequence), 1);
  const kinds = (d: typeof diagram) => (d?.primitives ?? []).map((p) => p.kind);

  it('draws its pinch, and nothing that claims to be pattern crease', () => {
    const lines = (diagram?.primitives ?? []).filter((p) => p.kind === 'line');
    expect(lines.some((l) => l.style === 'pinch-valley')).toBe(true);
    expect(lines.some((l) => l.style === 'valley' || l.style === 'mountain')).toBe(false);
  });

  // A press that runs the crease out to somewhere the folder can find is a
  // stretch of crease — "crease only the part shown" — and is drawn as one,
  // in the direction's dashes; a heavy solid stroke says "pinch here".
  it('draws a press that carries the line out as crease, not as a pinch', () => {
    const out = {
      ...press,
      extent: {
        kind: 'pinches' as const,
        spans: [[[0.25, 0.4], [0.25, 0]] as [[number, number], [number, number]]],
      },
      press: { at: [0.25, 0.3] as [number, number], point: null, sighted_from: null },
    };
    const withOut = { ...sequence, steps: [...sequence.steps, out] };
    const d = plannerStepDiagram(withOut, unitFrame(withOut), withOut.steps.length - 1);
    const lines = (d?.primitives ?? []).filter((p) => p.kind === 'line');
    expect(lines.some((l) => l.style === 'valley')).toBe(true);
    expect(lines.some((l) => l.style === 'pinch-valley')).toBe(false);
  });

  it('shows the same references and motion as the fold that made its line', () => {
    const rings = (d: typeof diagram) =>
      (d?.primitives ?? []).filter((p) => p.kind === 'point').map((p) => (p.kind === 'point' ? p.at : null));
    expect(rings(diagram)).toEqual(rings(original));
    const labels = (d: typeof diagram) =>
      (d?.primitives ?? []).filter((p) => p.kind === 'label').map((l) => (l.kind === 'label' ? l.text : ''));
    expect(labels(diagram)).toEqual(labels(original));
    expect(kinds(diagram).filter((k) => k === 'fold-arrow')).toEqual(
      kinds(original).filter((k) => k === 'fold-arrow')
    );
  });
});

// markhor step 4: the bottom edge folded onto the vertical midline, along the
// diagonal from (0.5, 0) to (0, 0.5). Only the left half of the edge swings up,
// onto the lower half of the midline; the right half of the edge and the upper
// half of the midline stay where they are. And the edge's own midpoint is the
// very point the fold passes through — anchoring the arrow there gave an arc of
// zero length and no arrow at all.
describe('a line folded onto a line', () => {
  const sequence = plannerSequenceFixture();
  const midline = sequence.steps[2]!; // x = 0.5, line id 6, made at step 3
  const step = {
    ...sequence.steps[4]!,
    id: 98,
    line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: 0.5 * Math.SQRT1_2 },
    segment: [
      [0.5, 0],
      [0, 0.5],
    ] as [[number, number], [number, number]],
    cp_spans: [] as [[number, number], [number, number]][],
    witnesses: [
      {
        ...sequence.steps[4]!.witnesses[0]!,
        axiom: 3,
        inputs: [
          { kind: 'edge' as const, id: 2, side: 'bottom' as const },
          { kind: 'line' as const, id: midline.line_id },
        ],
        who_moves: [0],
      },
    ],
    chosen: 0,
  };
  const withStep = { ...sequence, steps: [...sequence.steps, step] };
  const diagram = plannerStepDiagram(withStep, unitFrame(withStep), withStep.steps.length - 1);
  const highlights = (diagram?.primitives ?? []).filter(
    (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
      p.kind === 'line' && p.style === 'highlight'
  );
  const near = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;
  const isSeg = (l: (typeof highlights)[number], a: number[], b: number[]) =>
    (near(l.from, a) && near(l.to, b)) || (near(l.from, b) && near(l.to, a));

  it('draws an arrow, from the half of the edge that moves', () => {
    const arrows = (diagram?.primitives ?? []).filter((p) => p.kind === 'fold-arrow');
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0]!;
    if (arrow.kind !== 'fold-arrow') throw new Error('unreachable');
    // From the midpoint of the moving half, (0.25, 0), to its image on the
    // midline, (0.5, 0.25) — not from (0.5, 0), which is on the fold. The arc
    // is stored as centre, radius and two angles; read its ends back.
    const { center, radius, from, to } = arrow.out;
    const at = (angle: number) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    expect(near(at(from), [0.25, 0])).toBe(true);
    expect(near(at(to), [0.5, 0.25])).toBe(true);
  });

  it('highlights only the half of the edge that moves', () => {
    expect(highlights.some((l) => isSeg(l, [0, 0], [0.5, 0]))).toBe(true);
    expect(highlights.some((l) => isSeg(l, [0, 0], [1, 0]))).toBe(false);
  });

  // The edge lands on the midline's lower half, but the folder lines up
  // against the whole crease from step 1, and that runs the full height. So
  // the arm is shown as far as the crease goes on that side — all of it — not
  // cut off where the edge happens to reach.
  it('highlights the midline as far as its crease runs on the side the edge lands', () => {
    expect(highlights.some((l) => isSeg(l, [0.5, 0], [0.5, 1]))).toBe(true);
    expect(highlights.some((l) => isSeg(l, [0.5, 0], [0.5, 0.5]))).toBe(false);
  });

  // markhor step 11: the top edge folded onto a line whose chord runs from
  // (1, 0.5) to (0.5, 1) but whose crease is only the upper half of that. The
  // arm must stop where the crease stops, not run on down the chord.
  it('stops a receiving line where its crease stops, not where its chord does', () => {
    // A made line, creased on half its chord, and a top-edge fold onto it. The
    // fold bisects the top edge and the line at (0.5, 1), along x = y... the
    // bisector from (0.5, 1) toward the interior.
    const seq = plannerSequenceFixture();
    const partial = {
      ...seq.steps[2]!, // reuse a CP step shell
      id: 97,
      line_id: 42,
      line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: 1.5 * Math.SQRT1_2 },
      segment: [
        [1, 0.5],
        [0.5, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [0.75, 0.75],
          [0.5, 1],
        ],
      ] as [[number, number], [number, number]][],
      extent: { kind: 'full' as const },
    };
    const fold = {
      ...seq.steps[4]!,
      id: 96,
      // The bisector of the top edge (y = 1) and the partial line, at their
      // meeting point (0.5, 1): the edge runs at 0°, the line at −45°, so the
      // fold runs at −22.5° and reaches the right edge at y = 1 − ½·tan 22.5°.
      line: {
        n: [Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)] as [number, number],
        d: 0.5 * Math.sin(Math.PI / 8) + Math.cos(Math.PI / 8),
      },
      segment: [
        [0.5, 1],
        [1, 1 - 0.5 * Math.tan(Math.PI / 8)],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 3,
          inputs: [
            { kind: 'edge' as const, id: 3, side: 'top' as const },
            { kind: 'line' as const, id: 42 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const withBoth = {
      ...seq,
      steps: [...seq.steps, partial, fold],
      lines: [...seq.lines, { id: 42, tag: 'cp' as const, step: 97 }],
    };
    const d = plannerStepDiagram(withBoth, unitFrame(withBoth), withBoth.steps.length - 1);
    const lines = (d?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    // The receiving arm is the crease, (0.75, 0.75)–(0.5, 1), and no more.
    expect(lines.some((l) => isSeg(l, [0.75, 0.75], [0.5, 1]))).toBe(true);
    expect(lines.some((l) => isSeg(l, [1, 0.5], [0.5, 1]))).toBe(false);
  });

  // crocodile step 39: a grid line A (y = ¾, creased whole) folded onto a
  // line B (x = ¾) along the 45° bisector x + y = 1½ through their crossing
  // J = (¾, ¾). B is creased in two pieces: one that begins at J and runs up
  // the top-right corner, and one below J from y = 0.55 to 0.65. The corner
  // is the small flap, so A's right arm swings, and it lands on B's *lower*
  // piece — the upper piece begins at the fold and runs off with the flap,
  // and used to be lit as the arm to fold onto.
  it('lights the piece of the receiving line the moving arm actually lands on', () => {
    const seq = plannerSequenceFixture();
    const a = {
      ...seq.steps[0]!,
      id: 95,
      line_id: 43,
      line: { n: [0, 1] as [number, number], d: 0.75 },
      segment: [
        [0, 0.75],
        [1, 0.75],
      ] as [[number, number], [number, number]],
      extent: { kind: 'full' as const },
      cp_spans: [] as [[number, number], [number, number]][],
    };
    const b = {
      ...seq.steps[2]!,
      id: 96,
      line_id: 44,
      line: { n: [1, 0] as [number, number], d: 0.75 },
      segment: [
        [0.75, 0],
        [0.75, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [0.75, 0.75],
          [0.75, 1],
        ],
        [
          [0.75, 0.55],
          [0.75, 0.65],
        ],
      ] as [[number, number], [number, number]][],
    };
    const fold = {
      ...seq.steps[4]!,
      id: 97,
      line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: 1.5 * Math.SQRT1_2 },
      segment: [
        [1, 0.5],
        [0.5, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 3,
          inputs: [
            { kind: 'line' as const, id: 43 },
            { kind: 'line' as const, id: 44 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const withAll = {
      ...seq,
      steps: [...seq.steps, a, b, fold],
      lines: [
        ...seq.lines,
        { id: 43, tag: 'aux' as const, step: 95 },
        { id: 44, tag: 'cp' as const, step: 96 },
      ],
    };
    const d = plannerStepDiagram(withAll, unitFrame(withAll), withAll.steps.length - 1);
    const lit = (d?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    expect(lit).toHaveLength(2);
    // A: the arm on the corner flap.
    expect(lit.some((l) => isSeg(l, [0.75, 0.75], [1, 0.75]))).toBe(true);
    // B: the piece A lands on, below the crossing — not the one that begins
    // at the fold and runs up.
    expect(lit.some((l) => isSeg(l, [0.75, 0.55], [0.75, 0.65]))).toBe(true);
    expect(lit.some((l) => isSeg(l, [0.75, 0.75], [0.75, 1]))).toBe(false);
    // And the arrow leaves from that arm of A, landing on B below J.
    const arrows = (d?.primitives ?? []).filter((p) => p.kind === 'fold-arrow');
    expect(arrows).toHaveLength(1);
  });

  // The same fold with B creased only below the crossing on the far side of
  // the fold from the corner: the corner flap's arm still lands there.
  it('prefers the arm that lands on crease over one that lands on nothing', () => {
    const seq = plannerSequenceFixture();
    const a = {
      ...seq.steps[0]!,
      id: 95,
      line_id: 43,
      line: { n: [0, 1] as [number, number], d: 0.75 },
      segment: [
        [0, 0.75],
        [1, 0.75],
      ] as [[number, number], [number, number]],
      extent: { kind: 'full' as const },
      cp_spans: [] as [[number, number], [number, number]][],
    };
    // B creased only *above* J: the corner flap's arm (A's right half) lands
    // below J on nothing, so the other arm of A moves, onto B's crease.
    const b = {
      ...seq.steps[2]!,
      id: 96,
      line_id: 44,
      line: { n: [1, 0] as [number, number], d: 0.75 },
      segment: [
        [0.75, 0],
        [0.75, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [0.75, 0.75],
          [0.75, 1],
        ],
      ] as [[number, number], [number, number]][],
    };
    const fold = {
      ...seq.steps[4]!,
      id: 97,
      line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: 1.5 * Math.SQRT1_2 },
      segment: [
        [1, 0.5],
        [0.5, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 3,
          inputs: [
            { kind: 'line' as const, id: 43 },
            { kind: 'line' as const, id: 44 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const withAll = {
      ...seq,
      steps: [...seq.steps, a, b, fold],
      lines: [
        ...seq.lines,
        { id: 43, tag: 'aux' as const, step: 95 },
        { id: 44, tag: 'cp' as const, step: 96 },
      ],
    };
    const d = plannerStepDiagram(withAll, unitFrame(withAll), withAll.steps.length - 1);
    const lit = (d?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    expect(lit.some((l) => isSeg(l, [0, 0.75], [0.75, 0.75]))).toBe(true);
    expect(lit.some((l) => isSeg(l, [0.75, 0.75], [0.75, 1]))).toBe(true);
    expect(lit.some((l) => isSeg(l, [0.75, 0.75], [1, 0.75]))).toBe(false);
  });

  // markhor step 12: the right edge folded onto the main diagonal, which is
  // creased in two separate pieces — (0,0)–(0.25,0.25) and (0.75,0.75)–(1,1).
  // Both are on the interior side of the fold, but only the one coming out of
  // the corner at (1, 1) is what the folder lines the edge up against.
  it('keeps only the unbroken run that comes out of the vertex', () => {
    const seq = plannerSequenceFixture();
    const diagonal = {
      ...seq.steps[2]!,
      id: 95,
      line_id: 43,
      line: { n: [Math.SQRT1_2, -Math.SQRT1_2] as [number, number], d: 0 },
      segment: [
        [0, 0],
        [1, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [0, 0],
          [0.25, 0.25],
        ],
        [
          [0.75, 0.75],
          [1, 1],
        ],
      ] as [[number, number], [number, number]][],
      extent: { kind: 'full' as const },
    };
    // The bisector at (1, 1) of the right edge (down, −90°) and the diagonal
    // (down-left, −135°): −112.5°, reaching y = 0 at x = 1 − tan 22.5°.
    const fold = {
      ...seq.steps[4]!,
      id: 94,
      line: { n: [Math.cos(Math.PI / 8), -Math.sin(Math.PI / 8)] as [number, number], d: 0 },
      segment: [
        [1 - Math.tan(Math.PI / 8), 0],
        [1, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 3,
          inputs: [
            { kind: 'edge' as const, id: 1, side: 'right' as const },
            { kind: 'line' as const, id: 43 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const withBoth = {
      ...seq,
      steps: [...seq.steps, diagonal, fold],
      lines: [...seq.lines, { id: 43, tag: 'cp' as const, step: 95 }],
    };
    const d = plannerStepDiagram(withBoth, unitFrame(withBoth), withBoth.steps.length - 1);
    const lines = (d?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    expect(lines.some((l) => isSeg(l, [0.75, 0.75], [1, 1]))).toBe(true);
    expect(lines.some((l) => isSeg(l, [0, 0], [0.25, 0.25]))).toBe(false);
    // And the moving arm is the whole right edge: the fold meets it only at
    // the corner, so all of it is on the moving side, and all of it lands on
    // the diagonal — (1, 0) reflects to (0.29, 0.29), on the paper.
    expect(lines.some((l) => isSeg(l, [1, 0], [1, 1]))).toBe(true);
  });

  // The vertical x = 0.25 folded onto a diagonal whose pattern crease sits
  // far down the sheet, and which a later step pressed out to the crossing.
  // That press is the crease the vertical actually lands on — the one the
  // folder lines up against — and it was made after the diagonal, so the
  // making step alone does not know about it.
  it('lines a receiving line up against a press made on it after it was made', () => {
    const seq = plannerSequenceFixture();
    // x + y = 1.15, creased from (1, 0.15) to (0.5, 0.65) by the pattern.
    const diagonal = {
      ...seq.steps[2]!,
      id: 93,
      line_id: 44,
      line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: 1.15 * Math.SQRT1_2 },
      segment: [
        [1, 0.15],
        [0.15, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [1, 0.15],
          [0.5, 0.65],
        ],
      ] as [[number, number], [number, number]][],
      extent: { kind: 'full' as const },
    };
    // A press on it, out to its crossing with x = 0.25 at (0.25, 0.9) and a
    // little past, located by its end rather than a sighting.
    const pinch = {
      ...diagonal,
      id: 92,
      kind: 'press' as const,
      cp_line_ids: [] as number[],
      cp_spans: [] as [[number, number], [number, number]][],
      extent: {
        kind: 'pinches' as const,
        spans: [
          [
            [0.22, 0.93],
            [0.28, 0.87],
          ],
        ] as [[number, number], [number, number]][],
      },
      press: { at: [0.25, 0.9] as [number, number], point: null, sighted_from: null },
    };
    // The vertical, creased edge to edge.
    const vertical = {
      ...seq.steps[2]!,
      id: 91,
      line_id: 45,
      line: { n: [1, 0] as [number, number], d: 0.25 },
      segment: [
        [0.25, 0],
        [0.25, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [0.25, 0],
          [0.25, 1],
        ],
      ] as [[number, number], [number, number]][],
      extent: { kind: 'full' as const },
    };
    // The bisector at (0.25, 0.9) that carries the vertical's upper arm
    // (straight up) onto the diagonal's lower-right arm: it runs at −22.5°
    // from the vertex... i.e. the fold direction is the sum of the unit arm
    // directions (0, 1) + (1, −1)/√2.
    const ux = Math.SQRT1_2;
    const uy = 1 - Math.SQRT1_2;
    const len = Math.hypot(ux, uy);
    const n: [number, number] = [-uy / len, ux / len];
    const fold = {
      ...seq.steps[4]!,
      id: 90,
      line: { n, d: n[0] * 0.25 + n[1] * 0.9 },
      segment: [
        [0.25 - (ux / uy) * 0.1, 1],
        [0.25 + (ux / uy) * 0.1, 0.8],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 3,
          inputs: [
            { kind: 'line' as const, id: 45 },
            { kind: 'line' as const, id: 44 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const withAll = {
      ...seq,
      steps: [...seq.steps, diagonal, vertical, pinch, fold],
      lines: [
        ...seq.lines,
        { id: 44, tag: 'cp' as const, step: 93 },
        { id: 45, tag: 'cp' as const, step: 91 },
      ],
    };
    const d = plannerStepDiagram(withAll, unitFrame(withAll), withAll.steps.length - 1);
    const lines = (d?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    // The receiving arm is the press's lower-right half, out of the vertex.
    expect(lines.some((l) => isSeg(l, [0.25, 0.9], [0.28, 0.87]))).toBe(true);
    expect(lines.some((l) => isSeg(l, [1, 0.15], [0.5, 0.65]))).toBe(false);
    // The moving arm is the vertical above the vertex.
    expect(lines.some((l) => isSeg(l, [0.25, 0.9], [0.25, 1]))).toBe(true);
  });

  // markhor step 16: a perpendicular to the main diagonal through P at
  // (0.75, 0.396). The crate says nothing moves; a folder holds P and swings
  // the (1, 1) corner over until it lies on the diagonal's other arm, landing
  // at (0.146, 0.146). The picture is that: P, the corner, the arm it lands
  // on, and the motion.
  it('draws a perpendicular as a hinge, a corner, and the arm it lands on', () => {
    const seq = plannerSequenceFixture();
    const diagonal = {
      ...seq.steps[2]!,
      id: 95,
      line_id: 43,
      line: { n: [Math.SQRT1_2, -Math.SQRT1_2] as [number, number], d: 0 },
      segment: [
        [0, 0],
        [1, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [
        [
          [0, 0],
          [0.25, 0.25],
        ],
        [
          [0.75, 0.75],
          [1, 1],
        ],
      ] as [[number, number], [number, number]][],
      extent: { kind: 'full' as const },
    };
    const P: [number, number] = [0.75, 0.3964466];
    // The perpendicular through P: x + y = 0.75 + 0.3964 = 1.1464.
    const k = P[0] + P[1];
    const fold = {
      ...seq.steps[4]!,
      id: 93,
      line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: k * Math.SQRT1_2 },
      segment: [
        [1, k - 1],
        [k - 1, 1],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 4,
          inputs: [
            { kind: 'point' as const, id: 50 },
            { kind: 'line' as const, id: 43 },
          ],
          who_moves: [],
        },
      ],
      chosen: 0,
    };
    const withBoth = {
      ...seq,
      steps: [...seq.steps, diagonal, fold],
      lines: [...seq.lines, { id: 43, tag: 'cp' as const, step: 95 }],
      points: [...seq.points, { id: 50, p: P, lines: [43], on_boundary: false }],
    };
    const d = plannerStepDiagram(withBoth, unitFrame(withBoth), withBoth.steps.length - 1);
    const prims = d?.primitives ?? [];
    const lines = prims.filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    const points = prims.filter((p) => p.kind === 'point');
    const labels = prims.filter((p) => p.kind === 'label').map((l) => (l.kind === 'label' ? l.text : ''));
    // The hinge and the corner, lettered P and Q; the receiving arm, lettered A.
    expect(points.some((p) => p.kind === 'point' && near(p.at, P))).toBe(true);
    expect(points.some((p) => p.kind === 'point' && near(p.at, [1, 1]))).toBe(true);
    expect(labels.sort()).toEqual(['A', 'P', 'Q']);
    // Only the arm the corner lands on — the run out of the fold on that side.
    expect(lines.some((l) => isSeg(l, [0, 0], [0.25, 0.25]))).toBe(true);
    expect(lines.some((l) => isSeg(l, [0.75, 0.75], [1, 1]))).toBe(false);
    // And the motion, corner to where it lands.
    const arrows = prims.filter((p) => p.kind === 'fold-arrow');
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0]!;
    if (arrow.kind !== 'fold-arrow') throw new Error('unreachable');
    const { center, radius, from, to } = arrow.out;
    const at = (angle: number) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    expect(near(at(from), [1, 1])).toBe(true);
    expect(near(at(to), [k - 1, k - 1])).toBe(true);
  });

  // Abra step 20: x = 0.293 through a mark, perpendicular to the bottom edge.
  // A diagram says "fold the bottom edge onto itself through P", and the card
  // shows that: the mark, the whole edge, and the corner swinging with no
  // name of its own — not a corner brought onto an arm.
  it('shows a perpendicular to an edge as the edge folded onto itself', () => {
    const seq = plannerSequenceFixture();
    const P: [number, number] = [0.25, 0.8];
    const fold = {
      ...seq.steps[1]!,
      id: 93,
      cp_spans: [
        [
          [0.25, 0],
          [0.25, 0.3],
        ],
      ] as [[number, number], [number, number]][],
      made: [
        [
          [0.25, 0],
          [0.25, 0.3],
        ],
      ] as [[number, number], [number, number]][],
      extent: { kind: 'full' as const },
      witnesses: [
        {
          ...seq.steps[1]!.witnesses[0]!,
          axiom: 4,
          inputs: [
            { kind: 'point' as const, id: 50 },
            { kind: 'edge' as const, id: 2, side: 'bottom' as const },
          ],
          who_moves: [],
        },
      ],
      chosen: 0,
    };
    const withFold = {
      ...seq,
      steps: [...seq.steps, fold],
      points: [...seq.points, { id: 50, p: P, lines: [5], on_boundary: false }],
    };
    const d = plannerStepDiagram(withFold, unitFrame(withFold), withFold.steps.length - 1);
    const prims = d?.primitives ?? [];
    const lines = prims.filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    const points = prims.filter((p) => p.kind === 'point');
    const labels = prims.filter((p) => p.kind === 'label').map((l) => (l.kind === 'label' ? l.text : ''));
    // The mark and the edge, and nothing lettered for the corner.
    expect(points).toHaveLength(1);
    expect(points.some((p) => p.kind === 'point' && near(p.at, P))).toBe(true);
    expect(labels.sort()).toEqual(['A', 'P']);
    // The whole edge, both arms of it.
    expect(lines.some((l) => isSeg(l, [0, 0], [1, 0]))).toBe(true);
    // And the corner's motion onto the other arm.
    const arrows = prims.filter((p) => p.kind === 'fold-arrow');
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0]!;
    if (arrow.kind !== 'fold-arrow') throw new Error('unreachable');
    const { center, radius, from, to } = arrow.out;
    const at = (angle: number) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    expect(near(at(from), [0, 0])).toBe(true);
    expect(near(at(to), [0.5, 0])).toBe(true);
  });

  // markhor steps 4 and 8: the midline from step 1 is one crease the folder
  // made in one go, but the pattern cuts it into four pieces where its
  // mountain/valley assignment changes. Those cuts are not where the crease
  // stops; the whole line is the reference.
  it('treats a crease the pattern cuts at its M/V changes as one run', () => {
    const seq = plannerSequenceFixture();
    const cut = {
      ...seq.steps[2]!, // x = 0.5, line id 6, made at step 3
      cp_spans: [
        [
          [0.5, 0],
          [0.5, 0.25],
        ],
        [
          [0.5, 0.25],
          [0.5, 0.5],
        ],
        [
          [0.5, 0.5],
          [0.5, 0.75],
        ],
        [
          [0.5, 0.75],
          [0.5, 1],
        ],
      ] as [[number, number], [number, number]][],
    };
    const fold = {
      ...seq.steps[4]!,
      id: 92,
      line: { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: 0.5 * Math.SQRT1_2 },
      segment: [
        [0.5, 0],
        [0, 0.5],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...seq.steps[4]!.witnesses[0]!,
          axiom: 3,
          inputs: [
            { kind: 'edge' as const, id: 2, side: 'bottom' as const },
            { kind: 'line' as const, id: 6 },
          ],
          who_moves: [0],
        },
      ],
      chosen: 0,
    };
    const steps = seq.steps.map((st, i) => (i === 2 ? cut : st));
    const withFold = { ...seq, steps: [...steps, fold] };
    const d = plannerStepDiagram(withFold, unitFrame(withFold), withFold.steps.length - 1);
    const lines = (d?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    // The whole midline, as one piece — not the bottom quarter alone.
    expect(lines.some((l) => isSeg(l, [0.5, 0], [0.5, 1]))).toBe(true);
    expect(lines.some((l) => isSeg(l, [0.5, 0], [0.5, 0.25]))).toBe(false);
  });

  it('leaves a line the fold does not cross whole', () => {
    // The fixture's own O3: bottom edge onto y = 0.5 along y = 0.25. Parallel
    // to the fold, so all of it moves and all of it is shown.
    const plain = plannerStepDiagram(sequence, unitFrame(sequence), 4);
    const lines = (plain?.primitives ?? []).filter(
      (p): p is Extract<StepDiagramPrimitive, { kind: 'line' }> =>
        p.kind === 'line' && p.style === 'highlight'
    );
    expect(lines.some((l) => isSeg(l, [0, 0], [1, 0]))).toBe(true);
  });
});

// wolpertinger step 125: an O5 through a mark P on the right edge, bringing
// the edge onto an interior mark Q. Only the stretch of the edge that swings
// over — the arm on the side of the fold where Q lands — takes part; the
// stretch above the pivot stays where it is and is not lit. And since it is
// the edge that moves, the arrow runs from where Q will land to Q.
describe('a point brought onto a line', () => {
  const sequence = plannerSequenceFixture();
  // The fold x − y = ½, through P = (1, ½) on the right edge and (½, 0):
  // Q = (0.6, 0.5) lands on the edge at (1, 0.1), below the pivot.
  const o5 = (who_moves: number[]) => {
    const step = {
      ...sequence.steps[4]!,
      id: 98,
      line: { n: [Math.SQRT1_2, -Math.SQRT1_2] as [number, number], d: 0.5 * Math.SQRT1_2 },
      segment: [
        [1, 0.5],
        [0.5, 0],
      ] as [[number, number], [number, number]],
      cp_spans: [] as [[number, number], [number, number]][],
      witnesses: [
        {
          ...sequence.steps[4]!.witnesses[0]!,
          axiom: 5,
          inputs: [
            { kind: 'point' as const, id: 20 },
            { kind: 'point' as const, id: 21 },
            { kind: 'edge' as const, id: 1, side: 'right' as const },
          ],
          who_moves,
        },
      ],
      chosen: 0,
    };
    return {
      ...sequence,
      steps: [...sequence.steps, step],
      points: [
        ...sequence.points,
        { id: 20, p: [1, 0.5] as [number, number], lines: [1, 6], on_boundary: true },
        { id: 21, p: [0.6, 0.5] as [number, number], lines: [4, 8], on_boundary: false },
      ],
    };
  };
  const near = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;
  type Line = Extract<StepDiagramPrimitive, { kind: 'line' }>;
  const isSeg = (l: Line, a: number[], b: number[]) =>
    (near(l.from, a) && near(l.to, b)) || (near(l.from, b) && near(l.to, a));
  const draw = (seq: ReturnType<typeof o5>) =>
    plannerStepDiagram(seq, unitFrame(seq), seq.steps.length - 1)?.primitives ?? [];
  const highlights = (primitives: readonly StepDiagramPrimitive[]) =>
    primitives.filter((p): p is Line => p.kind === 'line' && p.style === 'highlight');
  const arrowEnds = (primitives: readonly StepDiagramPrimitive[]) => {
    const arrow = primitives.find((p) => p.kind === 'fold-arrow');
    if (!arrow || arrow.kind !== 'fold-arrow') throw new Error('no arrow');
    const { center, radius, from, to } = arrow.out;
    const at = (angle: number) => [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
    return { from: at(from), to: at(to) };
  };

  it('lights only the arm of the line the mark lands on', () => {
    for (const who of [[2], [1]]) {
      const lit = highlights(draw(o5(who)));
      expect(lit.some((l) => isSeg(l, [1, 0], [1, 0.5]))).toBe(true);
      expect(lit.some((l) => isSeg(l, [1, 0], [1, 1]))).toBe(false);
      expect(lit.some((l) => isSeg(l, [1, 0.5], [1, 1]))).toBe(false);
    }
  });

  it('swings the edge from where the mark will land, onto the mark', () => {
    const { from, to } = arrowEnds(draw(o5([2])));
    expect(near(from, [1, 0.1])).toBe(true);
    expect(near(to, [0.6, 0.5])).toBe(true);
  });

  it('swings the mark onto the edge when the mark is what moves', () => {
    const { from, to } = arrowEnds(draw(o5([1])));
    expect(near(from, [0.6, 0.5])).toBe(true);
    expect(near(to, [1, 0.1])).toBe(true);
  });
});

// A box-pleated plan opens with its grid: one step per family, every line of
// it edge to edge, mountain and valley alternating. That is a pleat, not a
// sighting, and the card has to say so — the whole family at once, with no
// arrow and nothing lettered.
describe('a grid step', () => {
  const sequence = plannerSequenceWithGridFixture();
  const unit = unitFrame(sequence);
  type Line = Extract<StepDiagramPrimitive, { kind: 'line' }>;
  const lines = (primitives: readonly StepDiagramPrimitive[] | undefined) =>
    (primitives ?? []).filter((p): p is Line => p.kind === 'line');
  const near = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!) < 1e-9;
  const isSeg = (l: Line, a: number[], b: number[]) =>
    (near(l.from, a) && near(l.to, b)) || (near(l.from, b) && near(l.to, a));

  it('draws every line of the family full-length, each in its own direction', () => {
    const diagram = plannerStepDiagram(sequence, unit, 0);
    const drawn = lines(diagram?.primitives);
    // Three lines, alternating: x = ¼ mountain, x = ½ valley, x = ¾ mountain.
    expect(drawn.map((l) => l.style)).toEqual(['mountain', 'valley', 'mountain']);
    expect(drawn.some((l) => isSeg(l, [0.25, 0], [0.25, 1]))).toBe(true);
    expect(drawn.some((l) => isSeg(l, [0.5, 0], [0.5, 1]))).toBe(true);
    expect(drawn.some((l) => isSeg(l, [0.75, 0], [0.75, 1]))).toBe(true);
    // The whole line, not the pattern's pieces of it: x = ½ is cut in two in
    // the pattern and is one crease here.
    expect(drawn.some((l) => isSeg(l, [0.5, 0], [0.5, 0.5]))).toBe(false);
  });

  it('draws neither an arrow nor a letter: nothing is brought onto anything', () => {
    for (const index of [0, 1]) {
      const kinds = (plannerStepDiagram(sequence, unit, index)?.primitives ?? []).map((p) => p.kind);
      expect(kinds).not.toContain('fold-arrow');
      expect(kinds).not.toContain('label');
      expect(kinds).not.toContain('point');
      expect(kinds[0]).toBe('sheet');
    }
  });

  // The pleat's directions are named from the front, as every direction is;
  // a grid step is made from the front and the card is never mirrored. This
  // is what keeps `seenFromTheBack` the one place a face is renamed.
  it('names the pleat’s directions from the front', () => {
    expect(sequence.steps[1]!.side).toBe('front');
    expect(sequence.steps[1]!.direction).toBe('unassigned');
    // The second family's own lines, under which the first family is crease.
    const styles = lines(plannerStepDiagram(sequence, unit, 1)?.primitives)
      .map((l) => l.style)
      .filter((style) => style !== 'crease');
    expect(styles).toEqual(['mountain', 'valley', 'mountain']);
  });

  it('is on every later card as crease, the whole family of it', () => {
    const later = lines(plannerStepDiagram(sequence, unit, 2)?.primitives).filter(
      (l) => l.style === 'crease'
    );
    expect(later).toHaveLength(6);
  });

  // The canvas draws the pattern's own creases itself, held to the steps made
  // so far — so of a pleated family only the lines the pattern lacks are left
  // for the step to put on it.
  it('leaves only the grid’s own lines to a surface that draws the pattern', () => {
    const later = lines(
      plannerStepDiagram(sequence, unit, 2, { earlier: 'unpatterned' })?.primitives
    ).filter((l) => l.style === 'crease');
    expect(later).toHaveLength(3);
    expect(later.some((l) => isSeg(l, [0.75, 0], [0.75, 1]))).toBe(true);
    expect(later.some((l) => isSeg(l, [0, 0.25], [1, 0.25]))).toBe(true);
    expect(later.some((l) => isSeg(l, [0, 0.75], [1, 0.75]))).toBe(true);
    expect(later.some((l) => isSeg(l, [0.25, 0], [0.25, 1]))).toBe(false);
  });

  // The pleat creases a line edge to edge whatever the pattern wants of it, and
  // the canvas's own ink stops where the pattern's does — so the rest of an
  // in-pattern grid line is the step's to draw there, and nowhere else's.
  it('draws the stretch of an in-pattern grid line the pattern does not crease', () => {
    const partial = structuredClone(sequence);
    const family = partial.steps[0]!.grid!;
    family.lines[0]!.cp_spans = [
      [
        [0.25, 0],
        [0.25, 0.5],
      ],
    ];
    partial.steps[0]!.cp_spans = family.lines.flatMap((line) => line.cp_spans);
    const later = lines(
      plannerStepDiagram(partial, unitFrame(partial), 2, { earlier: 'unpatterned' })?.primitives
    ).filter((l) => l.style === 'crease');
    expect(later).toHaveLength(4);
    expect(later.some((l) => isSeg(l, [0.25, 0.5], [0.25, 1]))).toBe(true);
    expect(later.some((l) => isSeg(l, [0.25, 0], [0.25, 0.5]))).toBe(false);
    // And the model frame agrees: the gap is recovered along the mapped line.
    const model = modelFrame(partial, decodePlanModel(partial, planModelPoints(partial)));
    const view = lines(
      plannerStepDiagram(partial, model, 2, { earlier: 'unpatterned' })?.primitives
    ).filter((l) => l.style === 'crease');
    expect(view).toHaveLength(4);
    expect(view.some((l) => isSeg(l, [0.25, 0.5], [0.25, 1]))).toBe(true);
  });

  it('is on the turn-over card as crease', () => {
    const drawn = lines(plannerTurnOverDiagram(sequence, unit, 1).primitives);
    expect(drawn).toHaveLength(6);
    expect(drawn.every((l) => l.style === 'crease')).toBe(true);
  });

  // The finished pattern: a grid line the pattern holds is drawn in the
  // direction it was pleated, whatever the pattern will want of it once the
  // model collapses (plan D26); one the pattern lacks is auxiliary and takes
  // the neutral ink, as an auxiliary fold does.
  it('finishes with in-pattern grid lines by pleat direction and the rest as crease', () => {
    const drawn = lines(plannerFinishedDiagram(sequence, unit).primitives);
    const styleOf = (a: number[], b: number[]) => drawn.find((l) => isSeg(l, a, b))?.style;
    expect(styleOf([0.25, 0], [0.25, 1])).toBe('mountain');
    expect(styleOf([0.5, 0], [0.5, 1])).toBe('valley');
    expect(styleOf([0.75, 0], [0.75, 1])).toBe('crease');
    // y = ½ is pleated as a valley and the pattern wants a mountain: the
    // pleat's direction is the one the folder made.
    expect(sequence.steps[1]!.grid!.lines[1]!.pattern_direction).toBe('mountain');
    expect(styleOf([0, 0.5], [1, 0.5])).toBe('valley');
    expect(styleOf([0, 0.25], [1, 0.25])).toBe('crease');
    expect(styleOf([0, 0.75], [1, 0.75])).toBe('crease');
    // And the fold after the grid, in its own direction.
    expect(styleOf([0, 0.5], [0.5, 1])).toBe('valley');
  });

  // A grid step that is not a pleat makes one level's lines in bands, and
  // the card has to say where: each band as a wash of the paper between the
  // lines it is bounded by, those lines picked out, and the band's own lines
  // in the directions the pattern wants them.
  describe('made in bands', () => {
    const [vertical] = sequence.steps;
    const family = vertical!.grid!;
    const band = (d: number, index: number, direction: PrecreaseDirection): PrecreaseGridStepLine => ({
      line_id: 20 + index,
      line: { n: [1, 0], d },
      segment: [
        [d, 0],
        [d, 1],
      ],
      spans: [],
      index,
      direction,
      pattern_direction: direction,
      pattern_share: 1,
      cp_line_ids: [20 + index],
      cp_spans: [
        [
          [d, 0.25],
          [d, 0.75],
        ],
      ],
    });
    const lines8 = [band(0.375, 3, 'valley'), band(0.625, 5, 'valley')];
    const step = {
      ...vertical!,
      id: 3,
      line_id: lines8[0]!.line_id,
      line: lines8[0]!.line,
      segment: lines8[0]!.segment,
      cp_line_ids: lines8.flatMap((l) => l.cp_line_ids),
      cp_spans: lines8.flatMap((l) => l.cp_spans),
      grid: {
        ...family,
        cells: 8,
        level: 8,
        pleat: false,
        regions: [
          {
            bounds: [
              { index: 2, fraction: 0.25, edge: null, line_id: 4 },
              { index: 6, fraction: 0.75, edge: null, line_id: 6 },
            ] as [PrecreaseGridBound, PrecreaseGridBound],
            lines: 2,
          },
        ],
        lines: lines8,
        in_pattern: 2,
        reversed: 0,
      },
    };
    const banded: PrecreaseSequence = {
      ...sequence,
      steps: [sequence.steps[0]!, sequence.steps[1]!, step],
      lines: [
        ...sequence.lines,
        ...lines8.map((l) => ({ id: l.line_id, tag: 'cp' as const, step: 3 })),
      ],
    };

    it('washes the band between its bounds and picks the bounds out', () => {
      const diagram = plannerStepDiagram(banded, unitFrame(banded), 2);
      const regions = (diagram?.primitives ?? []).filter((p) => p.kind === 'region');
      expect(regions).toHaveLength(1);
      const region = regions[0]!;
      if (region.kind !== 'region') throw new Error('unreachable');
      const xs = region.corners.map((c) => c[0]).sort();
      const ys = region.corners.map((c) => c[1]).sort();
      expect(xs).toEqual([0.25, 0.25, 0.75, 0.75]);
      expect(ys).toEqual([0, 0, 1, 1]);
      const highlights = lines(diagram?.primitives).filter((l) => l.style === 'highlight');
      expect(highlights.some((l) => isSeg(l, [0.25, 0], [0.25, 1]))).toBe(true);
      expect(highlights.some((l) => isSeg(l, [0.75, 0], [0.75, 1]))).toBe(true);
      expect(highlights).toHaveLength(2);
      // The wash goes under everything but the paper.
      const kinds = (diagram?.primitives ?? []).map((p) => p.kind);
      expect(kinds.indexOf('region')).toBeLessThan(kinds.indexOf('line'));
    });

    it('draws the band’s lines whole, the way the pattern wants them', () => {
      const diagram = plannerStepDiagram(banded, unitFrame(banded), 2);
      const own = lines(diagram?.primitives).filter(
        (l) => l.style !== 'highlight' && l.style !== 'crease'
      );
      expect(own.map((l) => l.style)).toEqual(['valley', 'valley']);
      expect(own.some((l) => isSeg(l, [0.375, 0], [0.375, 1]))).toBe(true);
      expect(own.some((l) => isSeg(l, [0.625, 0], [0.625, 1]))).toBe(true);
    });

    it('is a pleat on the card when it is a pleat, with no wash', () => {
      const kinds = (plannerStepDiagram(sequence, unit, 0)?.primitives ?? []).map((p) => p.kind);
      expect(kinds).not.toContain('region');
    });

    // A band creased only part way along its lines is that much of the
    // paper: the wash stops where the crease does, and so do the lines.
    it('cuts the wash and the lines to the band’s extent', () => {
      const cut = {
        ...step,
        grid: {
          ...step.grid,
          regions: step.grid.regions.map((region) => ({
            ...region,
            extent: [0.25, 0.75] as [number, number],
            along: [
              { index: 1, fraction: 0.25, edge: null, line_id: 7 },
              { index: 3, fraction: 0.75, edge: null, line_id: 9 },
            ] as [PrecreaseGridBound, PrecreaseGridBound],
          })),
          lines: step.grid.lines.map((line) => ({
            ...line,
            spans: [
              [
                [line.line.d, 0.25],
                [line.line.d, 0.75],
              ] as PrecreasePlanSegment,
            ],
          })),
        },
      };
      const seq: PrecreaseSequence = { ...banded, steps: [banded.steps[0]!, banded.steps[1]!, cut] };
      const diagram = plannerStepDiagram(seq, unitFrame(seq), 2);
      const region = (diagram?.primitives ?? []).find((p) => p.kind === 'region');
      if (!region || region.kind !== 'region') throw new Error('no wash');
      expect(region.corners.map((c) => c[0]).sort()).toEqual([0.25, 0.25, 0.75, 0.75]);
      expect(region.corners.map((c) => c[1]).sort()).toEqual([0.25, 0.25, 0.75, 0.75]);
      const own = lines(diagram?.primitives).filter(
        (l) => l.style !== 'highlight' && l.style !== 'crease'
      );
      expect(own.some((l) => isSeg(l, [0.375, 0.25], [0.375, 0.75]))).toBe(true);
      expect(own.some((l) => isSeg(l, [0.375, 0], [0.375, 1]))).toBe(false);
      // And on the next card it is that much crease, no more.
      const later: PrecreaseSequence = {
        ...seq,
        steps: [...seq.steps, { ...banded.steps[0]!, id: 4, grid: undefined, kind: 'cp' }],
      };
      const context = lines(plannerStepDiagram(later, unitFrame(later), 3)?.primitives).filter(
        (l) => l.style === 'crease'
      );
      expect(context.some((l) => isSeg(l, [0.375, 0.25], [0.375, 0.75]))).toBe(true);
      expect(context.some((l) => isSeg(l, [0.375, 0], [0.375, 1]))).toBe(false);
    });
  });

  // A grid step's own line id is only its family's first; the rest are in
  // the family. A step sighted from y = ½ — the horizontal family's second
  // line — has to be shown that line, not y = ¼.
  it('lets a later step sight from any line of the family, not just the first', () => {
    const diagram = plannerStepDiagram(sequence, unit, 2);
    const highlights = lines(diagram?.primitives).filter((l) => l.style === 'highlight');
    // The receiving arm: y = ½ on the side the edge lands, out of the vertex
    // at (0, ½). The moving arm: the upper half of the left edge.
    expect(highlights.some((l) => isSeg(l, [0, 0.5], [1, 0.5]))).toBe(true);
    expect(highlights.some((l) => isSeg(l, [0, 0.5], [0, 1]))).toBe(true);
    expect(highlights.some((l) => isSeg(l, [0, 0.25], [1, 0.25]))).toBe(false);
    expect(highlights.some((l) => isSeg(l, [0.25, 0], [0.25, 1]))).toBe(false);
    // And the arrow leaves from the half of the edge that moves.
    const arrows = (diagram?.primitives ?? []).filter((p) => p.kind === 'fold-arrow');
    expect(arrows).toHaveLength(1);
    const arrow = arrows[0]!;
    if (arrow.kind !== 'fold-arrow') throw new Error('unreachable');
    const { center, radius, from } = arrow.out;
    expect(near([center[0] + radius * Math.cos(from), center[1] + radius * Math.sin(from)], [0, 0.75])).toBe(true);
  });

  // The same picture from both frames, the claim `diagramFrames.test.ts`
  // makes for the plain fixture: a grid step's family arrives mapped in the
  // one round trip, and the view must draw exactly what the card does.
  it('draws the same primitives from the unit frame and the model frame', () => {
    const [c, s] = [Math.cos(Math.PI / 7), Math.sin(Math.PI / 7)];
    const image = (p: readonly [number, number]): [number, number] => {
      const [x, y] = [p[0] * 400, -p[1] * 400];
      return [x * c - y * s - 200, x * s + y * c + 60];
    };
    const mapToModel = (points: Float64Array) => {
      const out = new Float64Array(points.length);
      for (let i = 0; i < points.length; i += 2) {
        const [x, y] = image([points[i]!, points[i + 1]!]);
        out[i] = x;
        out[i + 1] = y;
      }
      return out;
    };
    const model = modelFrame(
      sequence,
      decodePlanModel(sequence, mapToModel(planModelPoints(sequence)))
    );
    const round = (v: number) => Number(v.toFixed(6));
    const comparable = (
      primitives: readonly StepDiagramPrimitive[],
      map: (p: readonly [number, number]) => readonly [number, number]
    ) =>
      primitives.map((p) => {
        if (p.kind === 'line') {
          return { kind: p.kind, style: p.style, ends: [map(p.from).map(round), map(p.to).map(round)].sort() };
        }
        if (p.kind === 'point' || p.kind === 'label' || p.kind === 'turn-over') {
          return { ...p, at: map(p.at).map(round) };
        }
        return { kind: p.kind };
      });
    for (let i = 0; i < sequence.steps.length; i += 1) {
      const card = plannerStepDiagram(sequence, unit, i)!.primitives.filter((p) => p.kind !== 'sheet');
      const view = plannerStepDiagram(sequence, model, i)!.primitives;
      expect(comparable(view, (p) => p), `step ${i}`).toEqual(comparable(card, image));
    }
    const card = plannerFinishedDiagram(sequence, unit).primitives.filter((p) => p.kind !== 'sheet');
    const finished = plannerFinishedDiagram(sequence, model);
    expect(comparable(finished.primitives, (p) => p)).toEqual(comparable(card, image));
    // And the sheet the picture is of has its middle where the paper's middle
    // is in the model — the letters stand outward from it — rather than half
    // the paper's size from the model's origin.
    expect(finished.sheet.centre?.map(round)).toEqual(image([0.5, 0.5]).map(round));
    expect(finished.sheet.width).toBeCloseTo(400, 6);
  });
});

// The receiving line of a line-onto-line fold is drawn as the piece the fold
// lands crease on. Markhor's step 80 folded the left edge onto the
// antidiagonal, creased in two pieces, one of them starting at the fold's
// own vertex — and in the document frame (a 400-unit sheet) that piece was
// judged a few billionths off the fold, dropped, and the card showed the
// piece at the far corner instead, which the edge never reaches.
describe('a receiving piece that starts at the fold, in the document frame', () => {
  const base = plannerSequenceFixture();
  const template = base.steps[1]!;
  const anti = { n: [Math.SQRT1_2, Math.SQRT1_2] as [number, number], d: Math.SQRT1_2 };
  const fold = { n: [0.9238795325, 0.3826834324] as [number, number], d: 0.3826834324 };
  const seg = (a: [number, number], b: [number, number]): PrecreasePlanSegment => [a, b];
  const antidiagonal = {
    ...template,
    id: 1,
    line_id: 4,
    line: anti,
    segment: seg([1, 0], [0, 1]),
    witnesses: [],
    chosen: null,
    cp_line_ids: [1],
    cp_spans: [seg([1, 0], [0.75, 0.25]), seg([0.375, 0.625], [0, 1])],
    made: [seg([1, 0], [0.75, 0.25]), seg([0.375, 0.625], [0, 1])],
    side: 'front' as const,
  };
  const edgeOnto = {
    ...template,
    id: 2,
    line_id: 5,
    line: fold,
    segment: seg([0.41421356, 0], [0, 1]),
    witnesses: [
      {
        axiom: 3,
        inputs: [
          { kind: 'edge' as const, id: 0, side: 'left' as const },
          { kind: 'line' as const, id: 4 },
        ],
        root: 0,
        who_moves: [0],
        hard: false,
        visible: true,
        skinny: false,
        ease: 1,
        err: 0,
      },
    ],
    chosen: 0,
    cp_line_ids: [2],
    cp_spans: [seg([0.3017767, 0.2714466], [0, 1])],
    made: [seg([0.3017767, 0.2714466], [0, 1])],
    side: 'back' as const,
  };
  const sequence: PrecreaseSequence = {
    ...base,
    steps: [antidiagonal, edgeOnto],
    lines: [
      { id: 0, tag: 'edge', step: null },
      { id: 1, tag: 'edge', step: null },
      { id: 2, tag: 'edge', step: null },
      { id: 3, tag: 'edge', step: null },
      { id: 4, tag: 'cp', step: 1 },
      { id: 5, tag: 'cp', step: 2 },
    ],
    points: [],
  };
  const highlights = (model: ReturnType<typeof plannerStepDiagram>) =>
    model?.primitives.flatMap((p) => (p.kind === 'line' && p.style === 'highlight' ? [p] : [])) ?? [];
  const near = (p: readonly [number, number], q: readonly [number, number]) =>
    Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3;
  const drawsPiece = (
    model: ReturnType<typeof plannerStepDiagram>,
    a: [number, number],
    b: [number, number]
  ) =>
    highlights(model).some(
      (p) => (near(p.from, a) && near(p.to, b)) || (near(p.from, b) && near(p.to, a))
    );

  it('shows the piece the edge lands on, not the far one, on the unit square', () => {
    const model = plannerStepDiagram(sequence, unitFrame(sequence), 1);
    expect(drawsPiece(model, [0.375, 0.625], [0, 1])).toBe(true);
    expect(drawsPiece(model, [1, 0], [0.75, 0.25])).toBe(false);
  });

  it('shows only the piece at the vertex when the edge lands on several', () => {
    // The antidiagonal creased in two pieces the left edge lands on: the
    // folder lines up the one at the vertex, not the one further along.
    const both: PrecreaseSequence = {
      ...sequence,
      steps: sequence.steps.map((s) =>
        s.id === 1
          ? {
              ...s,
              cp_spans: [seg([0.375, 0.625], [0.55, 0.45]), seg([0.1, 0.9], [0, 1])],
              made: [seg([0.375, 0.625], [0.55, 0.45]), seg([0.1, 0.9], [0, 1])],
            }
          : s
      ),
    };
    const model = plannerStepDiagram(both, unitFrame(both), 1);
    expect(drawsPiece(model, [0.1, 0.9], [0, 1])).toBe(true);
    expect(drawsPiece(model, [0.375, 0.625], [0.55, 0.45])).toBe(false);
  });

  it('shows the same piece on a 400-unit sheet placed at −200', () => {
    const points = planModelPoints(sequence);
    const mapped = new Float64Array(points.length);
    for (let i = 0; i < points.length; i += 2) {
      mapped[i] = 400 * points[i]! - 200;
      mapped[i + 1] = 400 * points[i + 1]! - 200;
    }
    const frame = modelFrame(sequence, decodePlanModel(sequence, mapped));
    const model = plannerStepDiagram(sequence, frame, 1, { earlier: 'unpatterned' });
    expect(drawsPiece(model, [-50, 50], [-200, 200])).toBe(true);
    expect(drawsPiece(model, [200, -200], [100, -100])).toBe(false);
  });
});
