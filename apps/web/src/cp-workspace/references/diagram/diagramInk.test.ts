import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../../lib/paper/paperStyle';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_DASH_SLOTS,
  DIAGRAM_INK_PER_SHEET,
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_SHEET_INK,
  DIAGRAM_TURN_OVER_INK,
  canvasDiagramInk,
  canvasDiagramPens,
  cardDiagramPens,
  diagramDashPatterns,
  diagramDashSlot,
  labelWidth,
  penInk,
} from './diagramInk';

/**
 * The table against the stylesheet it replaced.
 *
 * These numbers were `stroke-width` and `stroke-dasharray` declarations in
 * `theme.css`, and moving them is the kind of change a typo passes every other
 * check in. This is the only thing between a mistyped digit and a silently
 * restyled filmstrip, so it is written as the literals, not as arithmetic.
 */
describe('the diagram’s pen', () => {
  it('is a ninety-sixth of the paper, so one ink is about a pixel on a card', () => {
    expect(DIAGRAM_INK_PER_SHEET).toBe(1 / 96);
    // Today's card: a 118 px box, a viewBox of 100, a sheet of 80 of those
    // units. The pen is within 2% of the CSS pixel it replaces.
    const sheetOnScreen = 80 * (118 / 100);
    expect(sheetOnScreen * DIAGRAM_INK_PER_SHEET).toBeCloseTo(0.983, 3);
  });

  it('carries every weight the stylesheet used to', () => {
    // An earlier crease's opacity is the theme's (`themes/referencesInk.ts`),
    // not the pen's, so it is the one style with a weight and no opacity.
    expect(DIAGRAM_LINE_INK).toEqual({
      crease: { width: 0.75, cap: 'round' },
      // The pattern's own aux lines: the made crease's pen.
      aux: { width: 0.75, cap: 'round' },
      edge: { width: 1.2, cap: 'round' },
      highlight: { width: 2, cap: 'round' },
      valley: { width: 1.6, cap: 'butt', dash: [12.8, 6.4] },
      mountain: { width: 1.6, cap: 'butt', dash: [6.4, 3.2, 1.6, 3.2] },
      arrow: { width: 1.4, cap: 'round' },
      dotted: { width: 1.2, cap: 'butt', dash: [1.2, 3.6] },
      pinch: { width: 2.4, cap: 'round' },
      'pinch-mountain': { width: 2.4, cap: 'round' },
      'pinch-valley': { width: 2.4, cap: 'round' },
      unfolded: { width: 1, cap: 'round', opacity: 0.28 },
    });
    expect(DIAGRAM_SHEET_INK).toEqual({ width: 1, opacity: 0.55 });
    expect(DIAGRAM_MARK_INK).toEqual({ width: 1.2, radius: 3.84 });
  });

  // The template's ratios, in units of the stroke width: valley 8:4, mountain
  // 4:2:1:2. Written out because the dash arrays above are the product, and a
  // product does not say what it came from.
  it('keeps the template’s dash ratios', () => {
    const runs = (style: 'valley' | 'mountain') =>
      DIAGRAM_LINE_INK[style].dash!.map((run) => run / DIAGRAM_LINE_INK[style].width);
    expect(runs('valley')).toEqual([8, 4]);
    expect(runs('mountain')).toEqual([4, 2, 1, 2]);
  });

  // Every annotation size is in ink too, so the same drawing over a camera can
  // set its pen from the crease width instead of from the paper. On a card
  // these reproduce exactly the shares of the paper they replace.
  it('keeps the card’s own proportions for the annotations', () => {
    const perSheet = 1 / DIAGRAM_INK_PER_SHEET;
    expect(DIAGRAM_MARK_INK.radius / perSheet).toBeCloseTo(0.04, 9);
    expect(DIAGRAM_ARROWHEAD_INK.length / perSheet).toBeCloseTo(0.11, 9);
    expect(DIAGRAM_TURN_OVER_INK / perSheet).toBeCloseTo(0.42, 9);
  });

  // A letter and its halo already scaled with the viewBox, unlike the strokes,
  // so they convert at 1.2 ink to the user unit rather than 1:1. Getting that
  // backwards shrinks every letter by a fifth.
  it('converts the label from user units, not from screen pixels', () => {
    const inkPerUserUnit = 96 / 80;
    expect(DIAGRAM_LABEL_INK.size / inkPerUserUnit).toBeCloseTo(9, 6);
    expect(DIAGRAM_LABEL_INK.halo / inkPerUserUnit).toBeCloseTo(2.5, 6);
  });

  // The letter's footprint is estimated, not measured — an SVG `<text>` has no
  // size until it is drawn — and the standoff is the halo's reach, so a letter
  // that clears a ring by it does not erase a piece of the ring with its
  // ground-coloured halo either.
  it('keeps a letter’s box and standoff in step with its halo', () => {
    expect(DIAGRAM_LABEL_INK.glyph).toEqual({ height: 1, baseline: 0.86 });
    expect(DIAGRAM_LABEL_INK.standoff).toBe(DIAGRAM_LABEL_INK.halo / 2);
  });

  // Over the canvas the arrow is the paper style's own pen, in CSS pixels, and
  // one ink there is a fixed number of CSS pixels — so the arrow's weight in
  // ink is whatever puts its stroke at the pen. The rest of the table, and the
  // card's copy of it, stay as they are.
  it('draws the canvas’s arrow at the paper style’s pen and touches nothing else', () => {
    const pens = canvasDiagramPens(1, 1.4);
    expect(pens.arrow.width * canvasDiagramInk(1)).toBeCloseTo(1.4, 9);
    expect(pens.arrow.cap).toBe('round');
    expect(canvasDiagramPens(2, 4).arrow.width * canvasDiagramInk(2)).toBeCloseTo(4, 9);
    const { arrow: _arrow, ...rest } = pens;
    const { arrow: _tableArrow, ...table } = DIAGRAM_LINE_INK;
    expect(rest).toEqual(table);
    expect(DIAGRAM_LINE_INK.arrow.width).toBe(1.4);
  });

  // Sized by the letter, not by an average: a Q at the right edge of a card
  // ran off it when every capital was taken to be two thirds of an em.
  it('sizes a label by the advances of its own letters', () => {
    expect(labelWidth('P', 10)).toBeCloseTo(6.18, 6);
    expect(labelWidth('Q', 10)).toBeCloseTo(7.52, 6);
    expect(labelWidth('PQ', 10)).toBeCloseTo(6.18 + 7.52, 6);
    expect(labelWidth('W', 10)).toBeGreaterThan(labelWidth('I', 10) * 3);
    // An unknown glyph is taken at the widest common width, not at zero.
    expect(labelWidth('α', 10)).toBeCloseTo(7.5, 6);
  });
});

describe('the existing crease as the paper style’s aux pen', () => {
  const dashed = { width: 0.45, color: '#9aa4ad', dash: [4, 2] as number[], cap: 'round' as const };

  // A pen's dash is stated in multiples of its width, so at any weight in ink
  // the runs are that many of it; the cap is the pen's.
  it('turns a pen into ink at a given weight', () => {
    expect(penInk(dashed, 2)).toEqual({ width: 2, dash: [8, 4], cap: 'round' });
    expect(penInk(DEFAULT_PAPER_STYLE.auxCreases.pen, 0.5)).toEqual({ width: 0.5, cap: 'butt' });
  });

  // The card's pen is a share of the paper, so the style reaches it as a
  // ratio: the aux pen against the edge pen, on the table's edge weight. At
  // the defaults that is 0.5/0.9 of 1.2 — near the 0.75 the table drew.
  it('draws the card’s crease at the aux pen’s ratio to the edge pen', () => {
    const pens = cardDiagramPens(DEFAULT_PAPER_STYLE);
    expect(pens.crease.width).toBeCloseTo((1.2 * 0.5) / 0.9, 9);
    expect(pens.crease.cap).toBe('butt');
    expect(pens.crease.dash).toBeUndefined();
    const restyled = cardDiagramPens({
      auxCreases: { pen: dashed },
      edges: { ...DEFAULT_PAPER_STYLE.edges, width: 0.9 },
    });
    expect(restyled.crease.width).toBeCloseTo(0.6, 9);
    expect(restyled.crease.dash!.map((run) => run / restyled.crease.width)).toEqual([4, 2]);
    expect(restyled.crease.cap).toBe('round');
    // The pattern's aux lines take the same pen, and nothing else moves.
    expect(restyled.aux).toEqual(restyled.crease);
    const { crease: _crease, aux: _aux, ...rest } = restyled;
    const { crease: _table, aux: _tableAux, ...table } = DIAGRAM_LINE_INK;
    expect(rest).toEqual(table);
  });

  // Over the canvas one ink is a fixed number of CSS pixels, so the crease's
  // weight in ink is whatever puts its stroke at the pen — like the arrow.
  it('draws the canvas’s crease at the aux pen in CSS px', () => {
    const pens = canvasDiagramPens(1, 1.4, { pen: dashed, css: 0.6 });
    expect(pens.crease.width * canvasDiagramInk(1)).toBeCloseTo(0.6, 9);
    expect(pens.crease.dash!.map((run) => run / pens.crease.width)).toEqual([4, 2]);
    expect(pens.crease.cap).toBe('round');
    expect(canvasDiagramPens(1, 1.4).crease).toEqual(DIAGRAM_LINE_INK.crease);
  });

  // The fourth dash slot is the crease's, filled from the pens in hand: solid
  // for the table, the aux pen's runs when the style dashes it.
  it('gives the crease the fourth slot and its pen’s runs', () => {
    expect(DIAGRAM_DASH_SLOTS).toEqual(['valley', 'mountain', 'dotted', 'crease']);
    expect(diagramDashSlot('crease')).toBe(4);
    expect(diagramDashPatterns(2)[3]).toEqual([]);
    const pens = canvasDiagramPens(1, 1.4, { pen: dashed, css: 0.6 });
    const width = pens.crease.width * 2;
    expect(diagramDashPatterns(2, pens)[3]!.map((run) => run / width)).toEqual([4, 2]);
    expect(diagramDashPatterns(2, pens).slice(0, 3)).toEqual(diagramDashPatterns(2).slice(0, 3));
  });
});
