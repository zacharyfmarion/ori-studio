import { describe, expect, it } from 'vitest';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_INK_PER_SHEET,
  DIAGRAM_LABEL_INK,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARK_INK,
  DIAGRAM_SHEET_INK,
  DIAGRAM_TURN_OVER_INK,
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
    expect(DIAGRAM_LABEL_INK.offset / inkPerUserUnit).toBeCloseTo(3.5, 6);
  });
});
