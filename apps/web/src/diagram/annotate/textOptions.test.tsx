import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { createDiagram, createStep, DEFAULT_DIAGRAM_STYLE, insertSteps, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { readDiagram, writeDiagram } from '../document/diagramFile';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { diagramFontTexts } from '../pages/diagramPages';

import { unitsMove } from '../zoom/zoomFrames';
import { snapsAnchor } from './annotateSnap';
import { sceneTurnMove } from './annotationCarry';

import { textSizeId, textSizeOfId, textSizeOptions } from './annotateTools';
import { annotationEventDetail, textSizeName } from './annotationEventKind';
import { hitAnnotation, labelBox } from './annotationHit';
import {
  annotationEnds,
  carryAnnotation,
  cleanAnnotation,
  isHungText,
  LABEL_SIZE,
  labelCentre,
  labelHalfWidth,
  mirrorMove,
  moveAnnotation,
  moveAnnotationEnd,
  moveLabelWords,
  textEms,
  textStyleOf,
  withLabelOffset,
  withTextStyle,
  type PictureMove,
  type PicturePoint,
} from './annotationModel';
import {
  annotationDrawing,
  annotationMarks,
  annotationReach,
  annotationTextRuns,
  type AnnotationPaper,
} from './annotationPrimitives';
import { CARD_FRAME_PX, ptInPictureUnits } from './canvasInk';
import { labelAdvance } from './labelAdvances';
import { paintAnnotations } from './paintAnnotations';
import { PLAIN_TEXT_STYLE, readTextStyle, TEXT_HALO_EMS, TEXT_SIZES_PT } from './textStyle';

/**
 * Text's options (17b, §4 of `implementation-plans/diagram-references-annotations.md`):
 * a colour, Bold, a halo, a size in pt and words hung off their anchor by an
 * offset in pt — on the model, drawn, measured, pressed, carried and set in
 * the page's fonts. A label with none draws exactly as every label did.
 */

const style = DEFAULT_DIAGRAM_STYLE;
const SQUARE = { width: 1, height: 1 };
const label = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id: 'l-1',
  kind: 'label',
  from: [0.3, 0.3],
  to: [0.3, 0.3],
  text: 'A',
  ...more,
});

/** One label's `<text>` as drawn at `framePx`, on `paper` when given. */
function drawn(annotation: KnownDiagramAnnotation, framePx = 1000, paper: AnnotationPaper | null = null): Element {
  const drawing = annotationDrawing([annotation], SQUARE, framePx, style, null, paper);
  const markup = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg">{annotationMarks(drawing)}</svg>);
  return new DOMParser().parseFromString(markup, 'image/svg+xml').querySelector('text')!;
}
const number = (element: Element, name: string) => Number(element.getAttribute(name));

describe('a label with none of Text’s options', () => {
  // Captured at HEAD before 17b (`ade79de26`), through the same calls: a card's and a page's markup.
  const PLAIN: KnownDiagramAnnotation[] = [
    label({ id: 'l1' }),
    { id: 'l2', kind: 'label', from: [0.62, 0.18], to: [0.62, 0.18], text: 'Fold 折痕 12' },
  ];

  it('draws the markup it drew before them, byte for byte', () => {
    const drawing = annotationDrawing(PLAIN, SQUARE, CARD_FRAME_PX, style);
    expect(renderToStaticMarkup(<>{annotationMarks(drawing)}</>)).toBe(
      '<text x="56.693" y="60.094" font-size="9.449" text-anchor="middle" fill="#231f20"><tspan font-family="&#x27;Noto Sans&#x27;, sans-serif" font-weight="400">A</tspan></text>' +
        '<text x="117.165" y="37.417" font-size="9.449" text-anchor="middle" fill="#231f20"><tspan font-family="&#x27;Noto Sans&#x27;, sans-serif" font-weight="400">Fold </tspan><tspan font-family="&#x27;Noto Sans SC&#x27;, sans-serif" font-weight="400">折痕 12</tspan></text>'
    );
    // As a page paints it (`paintAnnotations`), its bounds those of its frame.
    const painted = paintAnnotations(PLAIN, { x: 10, y: 20, width: 141.73, height: 141.73 }, CARD_FRAME_PX, style);
    expect(painted).toEqual({
      markup:
        '<g stroke-linejoin="round">\n  <g transform="translate(10.00 20.00) scale(0.749987916667)">' +
        '<text x="56.693" y="60.094" font-size="9.449" text-anchor="middle" fill="#231f20"><tspan font-family="&#x27;Noto Sans&#x27;, sans-serif" font-weight="400">A</tspan></text>' +
        '<text x="117.165" y="37.417" font-size="9.449" text-anchor="middle" fill="#231f20"><tspan font-family="&#x27;Noto Sans&#x27;, sans-serif" font-weight="400">Fold </tspan><tspan font-family="&#x27;Noto Sans SC&#x27;, sans-serif" font-weight="400">折痕 12</tspan></text>' +
        '</g>\n</g>',
      bounds: { x: 10, y: 20, width: 141.73, height: 141.73 },
    });
  });

  it('is today’s look in every option, and on a References picture’s paper too', () => {
    expect(textStyleOf(label())).toEqual(PLAIN_TEXT_STYLE);
    const onPaper = drawn(label(), CARD_FRAME_PX, { outline: [[0, 0], [1, 0], [1, 1], [0, 1]], back: true });
    expect(onPaper.outerHTML).toBe(drawn(label(), CARD_FRAME_PX).outerHTML);
    expect(onPaper.hasAttribute('stroke')).toBe(false);
  });
});

describe('Text’s options, on the model', () => {
  it('writes each only as it is set, Bold and the halo only true, and leaves any other mark as it was', () => {
    const styled = withTextStyle(label(), { color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    expect(styled).toEqual({ ...label(), color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    expect(textStyleOf(styled)).toEqual({ color: '#c91d87', bold: true, halo: true, sizePt: 9 });
    // Back to today's look is a plain label again.
    expect(withTextStyle(styled, PLAIN_TEXT_STYLE)).toEqual(label());
    // A choice it already has changes nothing: the same object.
    expect(withTextStyle(styled, { bold: true })).toBe(styled);
    // A size no label stores is not taken.
    expect(withTextStyle(label(), { sizePt: 2 }).sizePt).toBeUndefined();
    // A callout keeps its look (§4).
    const callout: KnownDiagramAnnotation = { id: 'c', kind: 'callout', from: [0, 0], to: [0.2, 0.2], text: 'Repeat' };
    expect(withTextStyle(callout, { bold: true, sizePt: 9 })).toBe(callout);
  });

  it('cleans them as this build writes them: none off a label, a size and an offset within their ranges', () => {
    const callout = { id: 'c', kind: 'callout', from: [0, 0], to: [0.2, 0.2], text: 'Repeat', bold: true, sizePt: 9 } as KnownDiagramAnnotation;
    expect(cleanAnnotation(callout)).toEqual({ id: 'c', kind: 'callout', from: [0, 0], to: [0.2, 0.2], text: 'Repeat' });
    const kept = label({ bold: true, halo: true, sizePt: 12, offsetPt: [3, -4] });
    expect(cleanAnnotation(kept)).toBe(kept);
    expect(cleanAnnotation(label({ sizePt: 90, offsetPt: [400, -3] }))).toEqual(label({ sizePt: 48, offsetPt: [200, -3] }));
    expect(cleanAnnotation(label({ offsetPt: [Number.NaN, 1] }))).toEqual(label());
    expect(withLabelOffset(label(), [250, -260])).toEqual(label({ offsetPt: [200, -200] }));
    expect(withLabelOffset(label({ offsetPt: [1, 2] }), null)).toEqual(label());
  });

  it('hangs words off their anchor: an end to take hold of, and a centre a print length away', () => {
    expect(isHungText(label())).toBe(false);
    expect(annotationEnds(label())).toEqual([]);
    const hung = label({ offsetPt: [9, -6] });
    expect(isHungText(hung)).toBe(true);
    expect(annotationEnds(hung)).toEqual(['from']);
    // The anchor snaps, as a callout's point does; a plain label never does.
    expect(snapsAnchor(hung, 'from')).toBe(true);
    expect(snapsAnchor(label(), 'from')).toBe(false);
    // At the canvas's 50 mm a pt is 4/3 of a CSS px of 188.98.
    expect(ptInPictureUnits(1)).toBeCloseTo(PT_TO_CSS_PX / CARD_FRAME_PX, 12);
    const centre = labelCentre(hung);
    expect(centre[0]).toBeCloseTo(0.3 + 9 * ptInPictureUnits(1), 12);
    expect(centre[1]).toBeCloseTo(0.3 - 6 * ptInPictureUnits(1), 12);
  });

  it('moves hung text whole by its anchor and by a paste, and by its words its offset alone', () => {
    const hung = label({ offsetPt: [9, -6] });
    // Its anchor, as any point mark's place: the words go with it.
    expect(moveAnnotationEnd(hung, 'from', [0.5, 0.6])).toEqual({ ...hung, from: [0.5, 0.6], to: [0.5, 0.6] });
    expect(moveAnnotation(hung, [0.1, 0.1]).offsetPt).toEqual([9, -6]);
    // Its words, by the pointer's travel in pt at 50 mm: the anchor stays.
    const unit = ptInPictureUnits(1);
    const moved = moveLabelWords(hung, [3 * unit, 2 * unit]);
    expect(moved.from).toEqual(hung.from);
    expect(moved.offsetPt![0]).toBeCloseTo(12, 9);
    expect(moved.offsetPt![1]).toBeCloseTo(-4, 9);
    // A plain label has no words to move apart from its place.
    expect(moveLabelWords(label(), [0.1, 0])).toEqual(label());
  });

  it('carries hung text’s offset as the picture turns and mirrors, its length kept in pt', () => {
    const hung = label({ from: [0.2, 0.3], to: [0.2, 0.3], offsetPt: [6, -4] });
    const length = Math.hypot(6, 4);
    // Turned over: on the other side of its anchor across, as a letter keeps its side of its ring.
    const mirrored = carryAnnotation(hung, mirrorMove(SQUARE));
    expect(mirrored.from).toEqual([0.8, 0.3]);
    expect(mirrored.offsetPt![0]).toBeCloseTo(-6, 12);
    expect(mirrored.offsetPt![1]).toBeCloseTo(-4, 12);
    // A quarter turn clockwise, y down: (x, y) → (1 − y, x), a vector (dx, dy) → (−dy, dx).
    const quarter: PictureMove = { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 };
    const turned = carryAnnotation(hung, quarter);
    expect(turned.offsetPt![0]).toBeCloseTo(4, 9);
    expect(turned.offsetPt![1]).toBeCloseTo(6, 9);
    expect(Math.hypot(...turned.offsetPt!)).toBeCloseTo(length, 9);
    // Into a window a third the size: the anchor's units change, its print length does not.
    const window = unitsMove({ x: 0, y: 0, width: 1, height: 1 }, { x: 0.1, y: 0.2, width: 0.3, height: 0.3 });
    const inWindow = carryAnnotation(hung, window);
    expect(inWindow.from[0]).toBeCloseTo((0.2 - 0.1) / 0.3, 12);
    expect(inWindow.offsetPt![0]).toBeCloseTo(6, 9);
    expect(inWindow.offsetPt![1]).toBeCloseTo(-4, 9);
    // A plain label still moves as its place.
    expect(carryAnnotation(label({ from: [0.2, 0.3], to: [0.2, 0.3] }), mirrorMove(SQUARE)).offsetPt).toBeUndefined();
  });

  it('keeps a carried offset within what the file reads, through a turn that is no quarter turn', () => {
    // Words dragged as far out as they go, on a linked step whose picture turns by 15° presses.
    const far = label({ id: 'p', from: [0.5, 0.5], to: [0.5, 0.5], offsetPt: [180, 180] });
    const bounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    const turned = carryAnnotation(far, sceneTurnMove(bounds, bounds, 45)!);
    // Straight down from its anchor, as the turn takes it, brought in to the 200 pt a file holds.
    expect(turned.offsetPt![0]).toBeCloseTo(0, 9);
    expect(turned.offsetPt![1]).toBeCloseTo(200, 9);
    expect(Math.abs(turned.offsetPt![1])).toBeLessThanOrEqual(200);
    // Carried with the picture, a step's marks are not cleaned: what it writes must read back as its own.
    const step = { ...createStep(() => 'step-1'), annotations: [turned] };
    const document = insertSteps(createDiagram({ title: 'T', hanStyle: 'sc' }), [step], 0);
    const read = readDiagram(JSON.parse(JSON.stringify(writeDiagram(document))))!.document;
    expect(stepsIn(read)[0]!.annotations).toEqual([turned]);
    // A turn that keeps it in reach keeps its length: 15° of [100, 0].
    const near = carryAnnotation(label({ offsetPt: [100, 0] }), sceneTurnMove(bounds, bounds, 15)!);
    expect(Math.hypot(...near.offsetPt!)).toBeCloseTo(100, 9);
  });
});

describe('Text’s options, drawn', () => {
  it('draws its colour, and the style’s arrow ink without one', () => {
    expect(drawn(label({ color: '#e03131' })).getAttribute('fill')).toBe('#e03131');
    expect(drawn(label()).getAttribute('fill')).toBe('#231f20');
  });

  it('writes Bold on the text and every run, so a page sets and embeds Noto Sans Bold', () => {
    const text = drawn(label({ bold: true, text: 'P 折' }));
    expect(text.getAttribute('font-weight')).toBe('700');
    const runs = [...text.querySelectorAll('tspan')];
    expect(runs).toHaveLength(2);
    for (const run of runs) expect(run.getAttribute('font-weight')).toBe('700');
  });

  it('sets a size in pt, whatever size the picture is drawn at; without one, a share of the frame', () => {
    for (const framePx of [CARD_FRAME_PX, 1000]) {
      expect(number(drawn(label({ sizePt: 9 }), framePx), 'font-size')).toBe(12);
      expect(number(drawn(label(), framePx), 'font-size')).toBeCloseTo(LABEL_SIZE * framePx, 3);
    }
  });

  it('hangs words off their anchor by a print length at every size, centred there', () => {
    for (const framePx of [CARD_FRAME_PX, 1000]) {
      const text = drawn(label({ offsetPt: [6, -4], sizePt: 9 }), framePx);
      expect(number(text, 'x')).toBeCloseTo(0.3 * framePx + 6 * PT_TO_CSS_PX, 2);
      // The baseline 0.36 em under the centre, as every label's is.
      expect(number(text, 'y')).toBeCloseTo(0.3 * framePx - 4 * PT_TO_CSS_PX + 0.36 * 12, 2);
      expect(text.getAttribute('text-anchor')).toBe('middle');
    }
  });

  it('knocks the text out of the face it stands on: front, back, off the sheet, and on any other picture', () => {
    const sheet: PicturePoint[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const halo = (annotation: KnownDiagramAnnotation, paper: AnnotationPaper | null) => {
      const text = drawn(annotation, 1000, paper);
      return {
        stroke: text.getAttribute('stroke'),
        width: number(text, 'stroke-width'),
        join: text.getAttribute('stroke-linejoin'),
        order: text.getAttribute('paint-order'),
      };
    };
    const haloed = label({ halo: true, sizePt: 9 });
    // References' 3 ink halo on its 9.6 ink letter: 0.3125 em, round joins, under the fill.
    expect(halo(haloed, { outline: sheet, back: false })).toEqual({ stroke: '#ffffff', width: 3.75, join: 'round', order: 'stroke' });
    expect(TEXT_HALO_EMS * 12).toBe(3.75);
    // The Diagram preset's back is grey.
    expect(halo(haloed, { outline: sheet, back: true }).stroke).toBe('#b3b3b3');
    // Off the sheet — its centre, hung out past the edge — the page's white.
    expect(halo(label({ halo: true, from: [0.99, 0.5], to: [0.99, 0.5], offsetPt: [12, 0] }), { outline: sheet, back: true }).stroke).toBe('#ffffff');
    // No paper given (an upload, a capture): the page's white.
    expect(halo(haloed, null).stroke).toBe('#ffffff');
  });

  it('reaches as far as its words at their size and weight, and its halo, so a file never cuts them', () => {
    const near = label({ from: [0.97, 0.5], to: [0.97, 0.5], text: 'MOUNTAIN', sizePt: 16 });
    const reachOf = (annotation: KnownDiagramAnnotation) => annotationReach(annotationDrawing([annotation], SQUARE, 1000, style));
    const right = (annotation: KnownDiagramAnnotation) => {
      const reach = reachOf(annotation);
      return reach.x + reach.width;
    };
    const size = 16 * PT_TO_CSS_PX;
    expect(right(near)).toBeCloseTo(970 + labelHalfWidth('MOUNTAIN', { size }), 6);
    // Bold sets wider, measured by Noto Sans Bold's advances.
    expect(right({ ...near, bold: true })).toBeCloseTo(970 + labelHalfWidth('MOUNTAIN', { bold: true, size }), 6);
    expect(right({ ...near, bold: true })).toBeGreaterThan(right(near));
    const boldEms = [...'MOUNTAIN'].reduce((sum, letter) => sum + labelAdvance(letter.codePointAt(0)!, true)! / 1000, 0);
    expect(textEms('MOUNTAIN', true)).toBeCloseTo(boldEms, 12);
    expect(boldEms).toBeGreaterThan(textEms('MOUNTAIN'));
    // A halo half its width further.
    expect(right({ ...near, bold: true, halo: true })).toBeCloseTo(
      970 + labelHalfWidth('MOUNTAIN', { bold: true, size }) + (TEXT_HALO_EMS * size) / 2,
      6
    );
    // Half each one's ink in ems, on its wider side: the bundled Noto Sans Bold in Chromium's own
    // rasteriser (canvas measureText, `artifacts/references-marks/17b/ink.mjs`). Regular's advances
    // fall short of ťť's.
    const ink: [string, number][] = [
      ['MAMMOTH', 2.737],
      ['WWWWW', 2.418],
      ['mmmmm', 2.367],
      ['MOUNTAIN', 2.797],
      ['Fold and unfold', 3.801],
      ['ťť', 0.57],
    ];
    for (const [text, half] of ink) expect(labelHalfWidth(text, { bold: true, size: 1 }), text).toBeGreaterThanOrEqual(half);
    expect(labelHalfWidth('ťť', { size: 1 })).toBeLessThan(0.57);
    // Hung text reaches round its words, not its anchor.
    const hung = reachOf(label({ from: [0.5, 0.9], to: [0.5, 0.9], offsetPt: [0, 150], sizePt: 9 }));
    expect(hung.y + hung.height).toBeCloseTo(900 + 150 * PT_TO_CSS_PX + 12, 6);
  });
});

describe('Text’s options, pressed', () => {
  const SIZES = { tolerance: 0.004, glyph: 0.05, label: LABEL_SIZE, ink: 0.0066, calloutPen: 0.0025 };

  it('takes hung text by its words where they hang, and selected, by its anchor', () => {
    const hung = label({ from: [0.3, 0.3], to: [0.3, 0.3], offsetPt: [20, 0] });
    const words = labelCentre(hung);
    expect(hitAnnotation([hung], words, SIZES, null)).toEqual({ annotationId: 'l-1', part: 'body' });
    // Nothing at its anchor but the dot it shows once it is selected.
    expect(hitAnnotation([hung], [0.3, 0.3], SIZES, null)).toBeNull();
    expect(hitAnnotation([hung], [0.3, 0.3], SIZES, 'l-1')).toEqual({ annotationId: 'l-1', part: 'from' });
    // A plain label has no anchor apart from its words.
    expect(hitAnnotation([label()], [0.3, 0.3], SIZES, 'l-1')).toEqual({ annotationId: 'l-1', part: 'body' });
  });

  it('measures a label at its size and weight, a halo past its letters', () => {
    const plain = labelBox(label({ text: 'MOUNTAIN' }), LABEL_SIZE);
    expect(plain.halfWidth).toBeCloseTo(labelHalfWidth('MOUNTAIN'), 12);
    expect(plain.halfHeight).toBeCloseTo(LABEL_SIZE * 0.6, 12);
    const styled = labelBox(label({ text: 'MOUNTAIN', bold: true, halo: true, sizePt: 16 }), LABEL_SIZE);
    const size = ptInPictureUnits(16);
    expect(styled.size).toBeCloseTo(size, 12);
    expect(styled.halfWidth).toBeCloseTo(labelHalfWidth('MOUNTAIN', { bold: true, size }) + (TEXT_HALO_EMS * size) / 2, 12);
    // Pressed at the edge of its bold letters, past where a regular one would end.
    const edge: PicturePoint = [0.3 + labelHalfWidth('MOUNTAIN', { bold: true, size }), 0.3];
    expect(hitAnnotation([label({ text: 'MOUNTAIN', bold: true, sizePt: 16 })], edge, { ...SIZES, tolerance: 1e-4 }, null)?.part).toBe('body');
  });
});

describe('Text’s options, in the page’s fonts', () => {
  it('sets a bold label’s runs at 700, its Han in the diagram’s style', () => {
    const runs = annotationTextRuns([label({ text: 'P 折', bold: true }), label({ id: 'l-2', text: 'Q' })], 'jp');
    expect(runs).toEqual([
      { face: { key: 'latin', weight: 700 }, text: 'P ' },
      { face: { key: 'jp', weight: 700 }, text: '折' },
      { face: { key: 'latin', weight: 400 }, text: 'Q' },
    ]);
  });

  it('loads and embeds Bold for a bold label, Latin and CJK', () => {
    const step = { ...createStep(() => 'step-1'), annotations: [label({ text: 'P 折', bold: true })] };
    const document = insertSteps(createDiagram({ title: 'T', hanStyle: 'sc' }), [step], 0);
    const texts = diagramFontTexts(document);
    expect(texts).toContainEqual({ text: 'P ', weight: 700 });
    expect(texts).toContainEqual({ text: '折', weight: 700, cjk: 'sc' });
  });
});

describe('Text Style’s choices', () => {
  it('offers With the picture and four sizes, and a size from a file as its own', () => {
    const t = ((_key: string, fallback: string, values?: { size: number }) =>
      values ? fallback.replace('{{size}}', String(values.size)) : fallback) as never;
    expect(textSizeOptions(t, null).map((option) => option.label)).toEqual(['With the picture', '7 pt', '9 pt', '12 pt', '16 pt']);
    expect(textSizeOptions(t, 10.5).map((option) => option.id)).toEqual(['picture', '7', '9', '10.5', '12', '16']);
    expect(textSizeOfId(textSizeId(9))).toBe(9);
    expect(textSizeOfId(textSizeId(null))).toBeNull();
    expect(textSizeOfId('300')).toBeNull();
    expect(TEXT_SIZES_PT).toEqual([7, 9, 12, 16]);
  });

  it('reads a stored style option by option, anything else as today’s', () => {
    expect(readTextStyle(null)).toEqual(PLAIN_TEXT_STYLE);
    expect(readTextStyle({ color: '#c91d87', bold: true, halo: true, sizePt: 9 })).toEqual({
      color: '#c91d87',
      bold: true,
      halo: true,
      sizePt: 9,
    });
    expect(readTextStyle({ color: 'pink', bold: 'yes', halo: 1, sizePt: 900 })).toEqual(PLAIN_TEXT_STYLE);
  });

  it('names a label’s look for the events by name alone', () => {
    expect(annotationEventDetail(label())).toEqual({ color: 'ink', bold: 'off', halo: 'off', size: 'picture' });
    expect(annotationEventDetail(label({ color: '#C91D87', bold: true, halo: true, sizePt: 9 }))).toEqual({
      color: 'reference',
      bold: 'on',
      halo: 'on',
      size: '9',
    });
    expect(textSizeName(10.5)).toBe('other');
    expect(annotationEventDetail({ kind: 'solid-line', color: '#123456' })).toEqual({ color: 'custom' });
    expect(annotationEventDetail({ kind: 'valley-arrow' })).toEqual({});
  });
});
