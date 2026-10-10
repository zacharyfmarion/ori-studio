import { describe, expect, it } from 'vitest';
import { seenFromTheBack } from '../../cp-workspace/references/diagram/diagramModel';
import type { StepDiagramModel, StepDiagramPrimitive } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { arcSamplePoints, type DiagramArc } from '../../cp-workspace/references/stepDiagramGeometry';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { mmToCssPx } from '../../lib/paper/paperSvg';
import { cleanAnnotation, MAX_STEP_ANNOTATIONS, textEms } from '../annotate/annotationModel';
import { annotationDrawing, compiledAnnotation, LABEL_BASELINE } from '../annotate/annotationPrimitives';
import { createStep, DEFAULT_DIAGRAM_STYLE, type DiagramStep, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { storedAnnotations } from '../document/diagramFile';
import { referencesSource } from '../document/diagramSteps.fixtures';
import { stepDiagramLetters, stepDiagramToPicture } from '../pictures/paintStepDiagram';
import { findCard, finishedCard, linesCard, piecesCard, pinchCard, pointsCard } from './referencesCardMarks.fixtures';
import { editableCardMarks, LIFT_SHEET_MM, liftCardMarks, liftedCardPicture, shownCardPicture } from './referencesCardMarks';

const ALL = { letters: true, highlights: true } as const;
const STYLE = DEFAULT_DIAGRAM_STYLE;
const ids = () => {
  let next = 0;
  return () => `annotation-${(next += 1)}`;
};
const lift = (model: StepDiagramModel, mirrored = false, marks: { letters: boolean; highlights: boolean } = ALL) =>
  liftCardMarks(model, mirrored, marks, STYLE, ids())!;
const kinds = (annotations: readonly KnownDiagramAnnotation[]) => annotations.map((annotation) => annotation.kind);
/** A mark's kind and ends, rounded past float noise. */
const ends = (annotations: readonly KnownDiagramAnnotation[]) =>
  annotations.map((mark) => [mark.kind, mark.from.map((v) => +v.toFixed(9)), mark.to.map((v) => +v.toFixed(9))]);
const SHEET: StepDiagramPrimitive = { kind: 'sheet', width: 1, height: 1 };

/** A card with one piece of every style and kind a card can hold, each apart from the others. */
const EVERY_STYLE: StepDiagramModel = {
  sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
  primitives: [
    SHEET,
    { kind: 'region', corners: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2], [0.1, 0.2]] },
    { kind: 'line', from: [0, 0.05], to: [1, 0.05], style: 'crease' },
    { kind: 'line', from: [0, 0.1], to: [1, 0.1], style: 'aux' },
    { kind: 'line', from: [0, 0.15], to: [1, 0.15], style: 'fold-valley' },
    { kind: 'line', from: [0, 0.2], to: [1, 0.2], style: 'fold-mountain' },
    { kind: 'line', from: [0, 0.25], to: [0.5, 0.25], style: 'dotted' },
    { kind: 'line', from: [0, 0.3], to: [0.5, 0.3], style: 'unfolded' },
    { kind: 'line', from: [0, 0.35], to: [0.1, 0.35], style: 'pinch' },
    { kind: 'line', from: [0, 0.4], to: [1, 0.4], style: 'valley' },
    { kind: 'line', from: [0, 0.45], to: [1, 0.45], style: 'mountain' },
    { kind: 'line', from: [0, 0.5], to: [0.1, 0.5], style: 'pinch-valley' },
    { kind: 'line', from: [0, 0.55], to: [0.1, 0.55], style: 'pinch-mountain' },
    { kind: 'line', from: [0, 0.6], to: [1, 0.6], style: 'highlight' },
    { kind: 'point', at: [0.3, 0.7], style: 'normal' },
    { kind: 'point', at: [0.5, 0.7], style: 'highlight' },
    { kind: 'point', at: [0.7, 0.7], style: 'action' },
    { kind: 'fold-arrow', out: { center: [0.5, 0.5], radius: 0.4, from: -Math.PI / 6, to: Math.PI / 6, ccw: true } },
    { kind: 'label', at: [0.3, 0.7], text: 'P', style: 'highlight' },
  ],
};

describe('liftCardMarks', () => {
  it('lifts the step’s folds, its reference lines, rings, letters and arrows, and leaves the paper as it stands', () => {
    const { sheet, annotations } = lift(EVERY_STYLE);
    expect(kinds(annotations)).toEqual([
      'valley-line',
      'mountain-line',
      'valley-line',
      'mountain-line',
      'solid-line',
      'circle',
      'circle',
      'circle',
      'fold-unfold-arrow',
      'label',
    ]);
    // A reference line keeps References' magenta; a fold its pen, through its kind.
    expect(annotations.find((mark) => mark.kind === 'solid-line')).toMatchObject({ color: '#c91d87' });
    // Every one tagged: the card's.
    expect(annotations.every((mark) => mark.imported === 'untouched')).toBe(true);
    // The paper: the sheet, the band, the creases and aux lines, the finished pattern, the uncreased rests, a pinch with no direction.
    expect(sheet.primitives.map((p) => (p.kind === 'line' ? p.style : p.kind))).toEqual([
      'sheet',
      'region',
      'crease',
      'aux',
      'fold-valley',
      'fold-mountain',
      'dotted',
      'unfolded',
      'pinch',
    ]);
    expect(sheet.sheet).toEqual(EVERY_STYLE.sheet);
  });

  it('keeps exactly the pieces it did not lift, in the card’s order and unflipped, front and back', () => {
    for (const model of [pointsCard(), linesCard(), findCard()]) {
      for (const mirrored of [false, true]) {
        const { sheet } = lift(model, mirrored);
        const kept = model.primitives.filter((p) => sheet.primitives.includes(p));
        expect(sheet.primitives).toEqual(kept);
        // The painter turns the paper over itself: the sheet keeps the front's names.
        expect(sheet.primitives.every((p) => model.primitives.includes(p))).toBe(true);
      }
    }
  });

  it('pulls none of the marks the Show menu hides, and keeps the rings', () => {
    const shown = lift(linesCard());
    const noLetters = lift(linesCard(), false, { letters: false, highlights: true });
    const noLines = lift(linesCard(), false, { letters: true, highlights: false });
    expect(kinds(noLetters.annotations)).toEqual(kinds(shown.annotations).filter((kind) => kind !== 'label'));
    expect(kinds(noLines.annotations)).toEqual(kinds(shown.annotations).filter((kind) => kind !== 'solid-line'));
    const rings = lift(pointsCard(), false, { letters: false, highlights: false });
    expect(kinds(rings.annotations).filter((kind) => kind === 'circle')).toHaveLength(3);
    // Hidden is not pulled, nor left in the picture.
    expect(noLines.sheet.primitives.some((p) => p.kind === 'line' && p.style === 'highlight')).toBe(false);
    expect(noLetters.sheet.primitives.some((p) => p.kind === 'label')).toBe(false);
  });

  // 17d review: the sheet is keyed by the card alone, so whatever the Show menu says it must be the same sheet —
  // even for a reference line drawn as an arc, which nothing lifts (and nothing draws today).
  it('leaves the same sheet whatever the Show menu shows', () => {
    const arc: StepDiagramPrimitive = { kind: 'arc', center: [0.5, 0.5], radius: 0.3, from: 0, to: 1, ccw: true, style: 'highlight' };
    for (const model of [EVERY_STYLE, { ...EVERY_STYLE, primitives: [...EVERY_STYLE.primitives, arc] }, pointsCard(), linesCard()]) {
      const sheets = [
        { letters: true, highlights: true },
        { letters: false, highlights: true },
        { letters: true, highlights: false },
        { letters: false, highlights: false },
      ].map((marks) => lift(model, false, marks).sheet);
      for (const sheet of sheets) expect(sheet).toEqual(sheets[0]);
    }
  });

  it('names each fold from the side the card shows', () => {
    const front = lift(pointsCard(), false);
    const back = lift(pointsCard(), true);
    expect(kinds(front.annotations)).toContain('valley-line');
    expect(kinds(back.annotations)).toContain('mountain-line');
    expect(kinds(back.annotations)).not.toContain('valley-line');
    const pinches = lift(pinchCard(), true);
    expect(kinds(pinches.annotations).filter((kind) => kind === 'mountain-line')).toHaveLength(2);
  });

  it('turns each fold arrow into a fold-and-unfold arrow through the same arc, front and back', () => {
    for (const model of [pointsCard(), linesCard(), pinchCard(), findCard(), EVERY_STYLE]) {
      for (const mirrored of [false, true]) {
        const toPicture = stepDiagramToPicture(model, mirrored);
        const arcs = model.primitives.flatMap((p) => (p.kind === 'fold-arrow' ? [p.out] : []));
        const arrows = lift(model, mirrored).annotations.filter((mark) => mark.kind === 'fold-unfold-arrow');
        expect(arrows).toHaveLength(arcs.length);
        arrows.forEach((arrow, index) => {
          const compiled = compiledAnnotation(arrow);
          if (compiled?.kind !== 'mark' || compiled.primitive.kind !== 'fold-arrow') throw new Error('an arc arrow');
          // The compiled arc is in picture units, y up: the original's points mapped there.
          const back = arcSamplePoints(compiled.primitive.out);
          const there = arcSamplePoints(arcs[index] as DiagramArc).map((point) => {
            const [u, v] = toPicture(point);
            return [u, -v];
          });
          back.forEach(([x, y], k) => {
            expect(x).toBeCloseTo(there[k]![0]!, 9);
            expect(y).toBeCloseTo(there[k]![1]!, 9);
          });
          // A 60° arc: References' arrows all bend alike, the back's the other way round.
          expect(Math.abs(arrow.bend!)).toBeCloseTo(1 - Math.cos(Math.PI / 6), 9);
        });
      }
    }
  });

  it('sets each letter as References does — magenta, bold, haloed, 9 pt — its glyph where References puts it at 50 mm, front and back', () => {
    for (const model of [pointsCard(), linesCard(), findCard()]) {
      for (const mirrored of [false, true]) {
        const { annotations } = lift(model, mirrored);
        const labels = model.primitives.flatMap((p, index) => (p.kind === 'label' ? [{ p, index }] : []));
        const letters = annotations.filter((mark) => mark.kind === 'label');
        expect(letters.map((mark) => mark.text)).toEqual(labels.map(({ p }) => p.text));
        const { placements, project } = stepDiagramLetters(model, mirrored, STYLE, LIFT_SHEET_MM);
        const framePx = mmToCssPx(LIFT_SHEET_MM);
        const drawn = annotationDrawing(letters, { width: 1, height: 1 }, framePx, STYLE);
        letters.forEach((letter, k) => {
          expect(letter).toMatchObject({ color: '#c91d87', bold: true, halo: true, sizePt: 9 });
          // Hung from the point it names.
          const [u, v] = stepDiagramToPicture(model, mirrored)(labels[k]!.p.at);
          expect(letter.from[0]).toBeCloseTo(u, 12);
          expect(letter.from[1]).toBeCloseTo(v, 12);
          const placement = placements.get(labels[k]!.index)!;
          const label = drawn.labels[k]!;
          const size = project.marks.labelSize * project.ink;
          expect(label.size).toBeCloseTo(size, 9);
          // Its glyph starts where References' does, on the same baseline, in Noto Sans Bold.
          const advance = textEms(letter.text!, true) * size;
          const start = placement.anchor === 'start' ? placement.x : placement.anchor === 'end' ? placement.x - advance : placement.x - advance / 2;
          expect(label.x - advance / 2).toBeCloseTo(start, 6);
          expect(label.y + LABEL_BASELINE * label.size).toBeCloseTo(placement.y, 6);
          expect(label.halo?.width).toBeCloseTo(3.75, 9);
        });
      }
    }
    expect(9 * PT_TO_CSS_PX).toBeCloseTo(12, 9);
  });

  it('merges the pieces of one fold that touch end to end, and keeps two pinches apart', () => {
    const { annotations } = lift(piecesCard());
    expect(ends(annotations)).toEqual([
      ['valley-line', [0, 0.5], [1, 0.5]],
      ['mountain-line', [0.5, 1], [0.5, 0.9]],
      ['mountain-line', [0.5, 0.1], [0.5, 0]],
    ]);
    // Overlapping pieces are one line too; pieces of two styles never are.
    const overlapping: StepDiagramModel = {
      sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
      primitives: [
        SHEET,
        { kind: 'line', from: [0, 0.5], to: [0.6, 0.5], style: 'highlight' },
        { kind: 'line', from: [0.4, 0.5], to: [1, 0.5], style: 'highlight' },
        { kind: 'line', from: [1, 0.5], to: [1.2, 0.5], style: 'valley' },
      ],
    };
    expect(ends(lift(overlapping).annotations)).toEqual([
      ['solid-line', [0, 0.5], [1, 0.5]],
      ['valley-line', [1, 0.5], [1.2, 0.5]],
    ]);
  });

  it('gives every mark already in the form a file reads back and an edit would leave it in', () => {
    for (const model of [pointsCard(), linesCard(), pinchCard(), findCard(), EVERY_STYLE]) {
      for (const mirrored of [false, true]) {
        const { annotations } = lift(model, mirrored);
        expect(storedAnnotations(annotations)).toEqual(annotations);
        annotations.forEach((mark) => expect(cleanAnnotation(mark)).toBe(mark));
      }
    }
  });

  it('leaves a card whose marks are more than a step holds in its picture', () => {
    const crowded: StepDiagramModel = {
      sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
      primitives: [
        SHEET,
        ...Array.from({ length: MAX_STEP_ANNOTATIONS + 1 }, (_, i): StepDiagramPrimitive => {
          const x = (i + 0.5) / (MAX_STEP_ANNOTATIONS + 1);
          return { kind: 'line', from: [x, 0], to: [x, 1], style: i % 2 ? 'mountain' : 'valley' };
        }),
      ],
    };
    expect(liftCardMarks(crowded, false, ALL, STYLE)).toBeNull();
    const picture = { kind: 'step-diagram' as const, model: crowded, mirrored: false, key: 'steps-x' };
    expect(liftedCardPicture(picture, ALL, STYLE)).toBeNull();
  });
});

describe('liftedCardPicture', () => {
  it('keys the sheet by the card and its marks, then its side', () => {
    const model = pointsCard();
    const front = liftedCardPicture({ kind: 'step-diagram', model, mirrored: false, key: 'steps-abc' }, ALL, STYLE)!;
    const back = liftedCardPicture({ kind: 'step-diagram', model, mirrored: true, key: 'steps-abc-back' }, ALL, STYLE)!;
    expect(front.picture.key).toBe('steps-abc-marks');
    expect(back.picture.key).toBe('steps-abc-marks-back');
    expect(back.picture.mirrored).toBe(true);
    // The sheet does not change with the Show menu: one card has one lifted sheet.
    const hidden = liftedCardPicture({ kind: 'step-diagram', model, mirrored: false, key: 'steps-abc' }, { letters: false, highlights: false }, STYLE)!;
    expect(hidden.picture.model).toEqual(front.picture.model);
  });
});

describe('editableCardMarks (17e)', () => {
  /** A References step showing `picture`, `own` marks of the author's over it. */
  const sent = (picture: DiagramStep['picture'], own = 0): DiagramStep => ({
    ...createStep(() => 'step-1'),
    source: referencesSource(),
    picture,
    annotations: Array.from({ length: own }, (_, i): KnownDiagramAnnotation => ({
      id: `annotation-mine-${i}`,
      kind: 'circle',
      from: [0.5, 0.5],
      to: [0.5, 0.5],
    })),
  });
  const baked = (model: StepDiagramModel, mirrored = false) => ({ kind: 'step-diagram' as const, model, mirrored, key: mirrored ? 'steps-p-back' : 'steps-p' });

  it('counts the marks a step made before marks were lifted would lift, every one, and the author’s beside them', () => {
    const every = lift(pointsCard()).annotations.length;
    expect(editableCardMarks(sent(baked(pointsCard())), STYLE)).toEqual({ lifted: every, total: every, fits: true });
    expect(editableCardMarks(sent(baked(pointsCard(), true), 2), STYLE)).toEqual({ lifted: every, total: every + 2, fits: true });
    // Whatever the step was pulled with: Make Editable lifts them all.
    const shown = sent(baked(pointsCard()));
    const hiding = { ...shown, source: referencesSource({ marks: { letters: false, highlights: false } }) };
    expect(editableCardMarks(hiding, STYLE)?.lifted).toBe(every);
  });

  it('has nothing to lift on a lifted step, a card with no marks, any other picture, or a newer build’s step', () => {
    const split = liftedCardPicture(baked(pointsCard()), { letters: false, highlights: false }, STYLE)!;
    expect(editableCardMarks(sent(split.picture), STYLE)).toBeNull();
    expect(editableCardMarks(sent(liftedCardPicture(baked(pointsCard()), ALL, STYLE)!.picture), STYLE)).toBeNull();
    expect(editableCardMarks(sent(baked(finishedCard())), STYLE)).toBeNull();
    const upload = { ...sent(baked(pointsCard())), source: null };
    expect(editableCardMarks(upload, STYLE)).toBeNull();
    expect(editableCardMarks({ ...sent(baked(pointsCard())), unknown: {} }, STYLE)).toBeNull();
  });

  it('says a card’s marks and the author’s do not fit when they are more than a step holds', () => {
    const crowded: StepDiagramModel = {
      sheet: { width: 1, height: 1, centre: [0.5, 0.5] },
      primitives: [
        SHEET,
        ...Array.from({ length: MAX_STEP_ANNOTATIONS + 1 }, (_, i): StepDiagramPrimitive => {
          const x = (i + 0.5) / (MAX_STEP_ANNOTATIONS + 1);
          return { kind: 'line', from: [x, 0], to: [x, 1], style: i % 2 ? 'mountain' : 'valley' };
        }),
      ],
    };
    expect(editableCardMarks(sent(baked(crowded)), STYLE)).toEqual({
      lifted: MAX_STEP_ANNOTATIONS + 1,
      total: MAX_STEP_ANNOTATIONS + 1,
      fits: false,
    });
    const every = lift(pointsCard()).annotations.length;
    const full = editableCardMarks(sent(baked(pointsCard()), MAX_STEP_ANNOTATIONS - every + 1), STYLE);
    expect(full).toEqual({ lifted: every, total: MAX_STEP_ANNOTATIONS + 1, fits: false });
    expect(editableCardMarks(sent(baked(pointsCard()), MAX_STEP_ANNOTATIONS - every), STYLE)?.fits).toBe(true);
  });
});

describe('shownCardPicture', () => {
  it('shows the card with the marks the Show menu hides taken out, and the card itself when it hides none', () => {
    const picture = { kind: 'step-diagram' as const, model: linesCard(), mirrored: false, key: 'steps-l' };
    expect(shownCardPicture(picture, ALL)).toBe(picture);
    const shown = shownCardPicture(picture, { letters: false, highlights: true });
    expect(shown.model.primitives.some((p) => p.kind === 'label')).toBe(false);
    expect(shown.model.primitives.some((p) => p.kind === 'line' && p.style === 'highlight')).toBe(true);
    expect(shown.key).not.toBe(picture.key);
    // The back's directions are the painter's to give: the model stays the front's.
    expect(seenFromTheBack(shown.model.primitives)).toHaveLength(shown.model.primitives.length);
  });
});
