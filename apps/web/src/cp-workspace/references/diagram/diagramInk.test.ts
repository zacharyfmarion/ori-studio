import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, PT_PER_MM } from '../../../lib/paper/paperSvg';
import { MAX_DASH_SLOTS } from '../../renderer/types';
import { ARROWHEAD_ASPECT } from '../stepDiagramGeometry';

/** The defaults with solid folds: the Default preset dashes them. */
const SOLID_FOLDS: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, dash: null },
  valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, dash: null },
};

/** A stroke's dash in multiples of its width, rounded past float noise. */
const runs = (ink: { width: number; dash?: readonly number[] }) =>
  (ink.dash ?? []).map((run) => Number((run / ink.width).toFixed(9)));

/**
 * The two pairs apart in width, dash and cap, so a line that took the other
 * pair's pen cannot pass for its own.
 */
const APART: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  mountainFolds: { width: 0.5, color: '#a00001', dash: null, cap: 'round' },
  valleyFolds: { width: 0.6, color: '#0000a1', dash: [2, 1], cap: 'round' },
  mountainDiagramCreases: { width: 1.2, color: '#a00002', dash: [5, 1, 1, 1], cap: 'butt' },
  valleyDiagramCreases: { width: 1.5, color: '#0000a2', dash: [6, 3], cap: 'butt' },
};
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_DASH_SLOTS,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_INK_PER_SHEET,
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_MARKS,
  DIAGRAM_SHEET_INK,
  DIAGRAM_TURN_OVER_INK,
  REFERENCES_VIEW_FLOORS,
  REFERENCES_VIEW_MARKS,
  canvasDiagramInk,
  canvasDiagramPens,
  cardDiagramPens,
  diagramDashPatterns,
  diagramDashSlot,
  labelWidth,
  penInk,
  withReferencesViewFloors,
  type DiagramPens,
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
      // The accent weighs what the arrow does: both are marks of the step.
      highlight: { width: 1.4, cap: 'round' },
      valley: { width: 1.6, cap: 'butt', dash: [12.8, 6.4] },
      mountain: { width: 1.6, cap: 'butt', dash: [6.4, 3.2, 1.6, 3.2] },
      // The finished pattern's lines weigh what a step's fold does in the table.
      'fold-valley': { width: 1.6, cap: 'butt', dash: [12.8, 6.4] },
      'fold-mountain': { width: 1.6, cap: 'butt', dash: [6.4, 3.2, 1.6, 3.2] },
      arrow: { width: 1.4, cap: 'round' },
      dotted: { width: 1.2, cap: 'butt', dash: [1.2, 3.6] },
      pinch: { width: 2.4, cap: 'round' },
      'pinch-mountain': { width: 2.4, cap: 'round' },
      'pinch-valley': { width: 2.4, cap: 'round' },
      unfolded: { width: 1, cap: 'round', opacity: 0.28 },
    });
    expect(DIAGRAM_SHEET_INK).toEqual({ width: 1, opacity: 0.55 });
    // Four fifths of the reference diagrams' 4% of the card's paper.
    expect(DIAGRAM_MARK_INK).toEqual({ radius: 3.07 });
    expect(DIAGRAM_MARK_INK.radius / 3.84).toBeCloseTo(0.8, 2);
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
    // The ring is four fifths of the card's 4%, which read as too big on a page.
    expect(DIAGRAM_MARK_INK.radius / perSheet).toBeCloseTo(0.032, 3);
    expect(DIAGRAM_TURN_OVER_INK / perSheet).toBeCloseTo(0.42, 9);
    // The return's offset is what the head was: the loop keeps its width.
    expect(DIAGRAM_FOLD_RETURN_INK.offset / perSheet).toBeCloseTo(0.11, 9);
    expect(DIAGRAM_FOLD_RETURN_INK.ofChord).toBe(DIAGRAM_ARROWHEAD_INK.ofChord);
  });

  // The head is a printed diagram's, not upstream's 0.11 of the paper, which a
  // reader found too big beside one: at the default pen on a step's page it
  // is about 2.8 mm long and 1.65 mm wide.
  it('draws an arrowhead the size of a printed diagram’s', () => {
    expect(DIAGRAM_ARROWHEAD_INK.length).toBe(8.5);
    expect(DIAGRAM_ARROWHEAD_INK.ofChord).toBe(0.26);
    const mm = (DIAGRAM_ARROWHEAD_INK.length * canvasDiagramInk(1) * PT_PER_CSS_PX) / PT_PER_MM;
    expect(mm).toBeCloseTo(2.8, 1);
    expect((2 * mm) / ARROWHEAD_ASPECT).toBeCloseTo(1.65, 1);
    expect(DIAGRAM_ARROWHEAD_INK.length).toBeLessThan(DIAGRAM_FOLD_RETURN_INK.offset);
  });

  // A letter and its halo already scaled with the viewBox, unlike the strokes,
  // so they convert at 1.2 ink to the user unit rather than 1:1. Getting that
  // backwards shrinks every letter by a fifth. The letter was 9 user units
  // until a step's page showed it a touch large; it is 8.
  it('converts the label from user units, not from screen pixels', () => {
    const inkPerUserUnit = 96 / 80;
    expect(DIAGRAM_LABEL_INK.size / inkPerUserUnit).toBeCloseTo(8, 6);
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
  // ink is whatever puts its stroke at the pen. The accent follows it, as in
  // the table; the rest of the table, and the card's copy of it, stay as they
  // are.
  it('draws the canvas’s arrow, and the accent at its weight, at the paper style’s pen and touches nothing else', () => {
    const pens = canvasDiagramPens(2, 4);
    expect(pens.arrow.width * canvasDiagramInk(2)).toBeCloseTo(4, 9);
    expect(pens.arrow.cap).toBe('round');
    expect(pens.highlight).toEqual({ ...DIAGRAM_LINE_INK.highlight, width: pens.arrow.width });
    const { arrow: _arrow, highlight: _highlight, ...rest } = pens;
    const { arrow: _tableArrow, highlight: _tableHighlight, ...table } = DIAGRAM_LINE_INK;
    expect(rest).toEqual(table);
    expect(DIAGRAM_LINE_INK.arrow.width).toBe(1.4);
    expect(DIAGRAM_LINE_INK.highlight.width).toBe(DIAGRAM_LINE_INK.arrow.width);
  });

  // A print pen is a hairline on screen: the Diagram preset's 0.75 pt arrow
  // is one CSS pixel beside thirteen-pixel lettering. The arrow keeps the
  // table's weight at the least.
  it('never draws the canvas’s arrow lighter than the table’s', () => {
    expect(canvasDiagramPens(1, 1).arrow.width).toBe(DIAGRAM_LINE_INK.arrow.width);
    expect(canvasDiagramPens(1, 1).arrow.width * canvasDiagramInk(1)).toBeCloseTo(1.75, 9);
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
      mountainFolds: DEFAULT_PAPER_STYLE.mountainFolds,
      valleyFolds: DEFAULT_PAPER_STYLE.valleyFolds,
      mountainDiagramCreases: DEFAULT_PAPER_STYLE.mountainDiagramCreases,
      valleyDiagramCreases: DEFAULT_PAPER_STYLE.valleyDiagramCreases,
    });
    expect(restyled.crease.width).toBeCloseTo(0.6, 9);
    expect(restyled.crease.dash!.map((run) => run / restyled.crease.width)).toEqual([4, 2]);
    expect(restyled.crease.cap).toBe('round');
    // The pattern's aux lines take the same pen; the marks the style has no
    // pen for keep the table's.
    expect(restyled.aux).toEqual(restyled.crease);
    const {
      crease: _c,
      aux: _a,
      edge: _e,
      mountain: _m,
      valley: _v,
      'fold-mountain': _fm,
      'fold-valley': _fv,
      ...rest
    } = restyled;
    const {
      crease: _tc,
      aux: _ta,
      edge: _te,
      mountain: _tm,
      valley: _tv,
      'fold-mountain': _tfm,
      'fold-valley': _tfv,
      ...table
    } = DIAGRAM_LINE_INK;
    expect(rest).toEqual(table);
  });

  // Mountain and valley follow the style too: its dash, or none — a style with
  // solid folds draws a card's finished pattern solid, not in the table's
  // dashes. A step's fold is an instruction and is not the fold pens' to say.
  it('draws the card’s pattern lines and edge in the style’s fold pens, at their ratio to the edge pen', () => {
    const solid = cardDiagramPens(SOLID_FOLDS);
    expect(solid['fold-mountain'].dash).toBeUndefined();
    expect(solid['fold-valley'].dash).toBeUndefined();
    // The step's fold keeps the diagram-crease pens' dashes.
    expect(solid.mountain.dash).toBeDefined();
    expect(solid.valley.dash).toBeDefined();
    expect(solid.edge.width).toBeCloseTo(1.2, 9);
    expect(solid['fold-mountain'].width).toBeCloseTo(
      (1.2 * DEFAULT_PAPER_STYLE.mountainFolds.width) / DEFAULT_PAPER_STYLE.edges.width,
      9
    );
    const dashedValley = cardDiagramPens({
      ...SOLID_FOLDS,
      valleyFolds: { ...SOLID_FOLDS.valleyFolds, dash: [4, 2] },
    });
    expect(
      dashedValley['fold-valley'].dash!.map((run) => run / dashedValley['fold-valley'].width)
    ).toEqual([4, 2]);
    // The dash slots follow the pens: the fold valley's is the style's, the fold mountain's solid.
    expect(diagramDashPatterns(1, dashedValley)[diagramDashSlot('fold-valley') - 1]!.length).toBe(2);
    expect(diagramDashPatterns(1, dashedValley)[diagramDashSlot('fold-mountain') - 1]).toEqual([]);
  });

  // The two pairs mean two things — a step's instruction and a crease
  // pattern's line — and a card draws each in its own.
  it('draws a step’s fold in the diagram-crease pens and a pattern’s line in the fold pens', () => {
    const pens = cardDiagramPens(APART);
    const at = (width: number) => (1.2 * width) / APART.edges.width;
    expect(pens.mountain).toEqual({ width: at(1.2), dash: [5, 1, 1, 1].map((r) => r * at(1.2)), cap: 'butt' });
    expect(pens.valley).toEqual({ width: at(1.5), dash: [6, 3].map((r) => r * at(1.5)), cap: 'butt' });
    expect(pens['fold-mountain']).toEqual({ width: at(0.5), cap: 'round' });
    expect(pens['fold-valley']).toEqual({ width: at(0.6), dash: [2, 1].map((r) => r * at(0.6)), cap: 'round' });
    // A pinch takes only its colour from the pens: its weight is the table's.
    expect(pens['pinch-mountain']).toEqual(DIAGRAM_LINE_INK['pinch-mountain']);
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

  it('draws the canvas’s edge and lines at their pens in CSS px, when given them', () => {
    const pens = canvasDiagramPens(1, 1.4, undefined, {
      edge: { pen: DEFAULT_PAPER_STYLE.edges, css: 1.5 },
      mountainFolds: { pen: APART.mountainFolds, css: 0.7 },
      valleyFolds: { pen: APART.valleyFolds, css: 0.8 },
      mountainDiagramCreases: { pen: APART.mountainDiagramCreases, css: 1.6 },
      valleyDiagramCreases: { pen: APART.valleyDiagramCreases, css: 2 },
    });
    const ink = canvasDiagramInk(1);
    expect(pens.edge.width * ink).toBeCloseTo(1.5, 9);
    // A step's fold in the diagram-crease pens.
    expect(pens.mountain.width * ink).toBeCloseTo(1.6, 9);
    expect(runs(pens.mountain)).toEqual([5, 1, 1, 1]);
    expect(pens.valley.width * ink).toBeCloseTo(2, 9);
    expect(runs(pens.valley)).toEqual([6, 3]);
    // A pattern's line in the fold pens.
    expect(pens['fold-mountain'].width * ink).toBeCloseTo(0.7, 9);
    expect(pens['fold-mountain'].dash).toBeUndefined();
    expect(pens['fold-valley'].width * ink).toBeCloseTo(0.8, 9);
    expect(runs(pens['fold-valley'])).toEqual([2, 1]);
    // Without them the table's, as the reference diagrams drew before a style.
    expect(canvasDiagramPens(1, 1.4).mountain).toEqual(DIAGRAM_LINE_INK.mountain);
    expect(canvasDiagramPens(1, 1.4)['fold-mountain']).toEqual(DIAGRAM_LINE_INK['fold-mountain']);
  });

  // Six slots, one assignment for both channels: a step's fold, a dotted
  // line, an earlier crease and a pattern's line, each in its own. The stroke
  // program reads a fixed number of them, and a seventh would draw solid.
  it('fills six slots, within what the stroke program reads', () => {
    expect(DIAGRAM_DASH_SLOTS).toEqual([
      'valley',
      'mountain',
      'dotted',
      'crease',
      'fold-valley',
      'fold-mountain',
    ]);
    expect(DIAGRAM_DASH_SLOTS.length).toBeLessThanOrEqual(MAX_DASH_SLOTS);
    // A pinch is solid on screen, whichever pair its colour comes from.
    expect(diagramDashSlot('pinch-mountain')).toBe(0);
    expect(diagramDashSlot('pinch-valley')).toBe(0);
    // Each pair's patterns are its own pens'.
    const pens = cardDiagramPens(APART);
    const patterns = diagramDashPatterns(1, pens);
    const ratio = (style: 'mountain' | 'valley' | 'fold-mountain' | 'fold-valley') =>
      patterns[diagramDashSlot(style) - 1]!.map((run) => run / pens[style].width);
    expect(ratio('mountain')).toEqual([5, 1, 1, 1]);
    expect(ratio('valley')).toEqual([6, 3]);
    expect(ratio('fold-mountain')).toEqual([]);
    expect(ratio('fold-valley')).toEqual([2, 1]);
  });

  // The fourth dash slot is the crease's, filled from the pens in hand: solid
  // for the table, the aux pen's runs when the style dashes it.
  it('gives the crease the fourth slot and its pen’s runs', () => {
    expect(diagramDashSlot('crease')).toBe(4);
    expect(diagramDashPatterns(2)[3]).toEqual([]);
    const pens = canvasDiagramPens(1, 1.4, { pen: dashed, css: 0.6 });
    const width = pens.crease.width * 2;
    expect(diagramDashPatterns(2, pens)[3]!.map((run) => run / width)).toEqual([4, 2]);
    expect(diagramDashPatterns(2, pens).slice(0, 3)).toEqual(diagramDashPatterns(2).slice(0, 3));
    expect(diagramDashPatterns(2, pens).slice(4)).toEqual(diagramDashPatterns(2).slice(4));
  });
});

/**
 * The References view is a full-screen picture, not a page: its marks and
 * lines are never smaller than its floors, and a card's and a page's are the
 * print sizes.
 */
describe('the References view floors', () => {
  it('raise the print marks to the view’s, and leave a page’s alone', () => {
    for (const mark of ['ringRadius', 'labelSize', 'arrowheadLength'] as const) {
      expect(REFERENCES_VIEW_MARKS[mark]).toBe(
        Math.max(DIAGRAM_MARKS[mark], REFERENCES_VIEW_FLOORS.marks[mark])
      );
    }
    expect(DIAGRAM_MARKS).toEqual({
      ringRadius: DIAGRAM_MARK_INK.radius,
      labelSize: DIAGRAM_LABEL_INK.size,
      arrowheadLength: DIAGRAM_ARROWHEAD_INK.length,
    });
  });

  it('leave a pen at or over its floor alone, and raise one under it with its pattern', () => {
    const pens: DiagramPens = {
      ...DIAGRAM_LINE_INK,
      valley: { width: 0.5, dash: [2, 1], cap: 'butt' },
      mountain: { width: 3, cap: 'butt' },
    };
    const floored = withReferencesViewFloors(pens);
    expect(floored.mountain).toBe(pens.mountain);
    expect(floored.valley.width).toBe(REFERENCES_VIEW_FLOORS.lines.valley);
    expect(floored.valley.dash!.map((run) => run / floored.valley.width)).toEqual([4, 2]);
    expect(floored.valley.cap).toBe('butt');
    // Floors in another ink: the reader's over the pens'.
    expect(withReferencesViewFloors(pens, 0.5).valley.width).toBe(
      REFERENCES_VIEW_FLOORS.lines.valley * 0.5
    );
  });
});
