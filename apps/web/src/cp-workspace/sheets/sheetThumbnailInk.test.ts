import { describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { sheetThumbnailInk } from './sheetThumbnailInk';

const STYLE: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#fafafa', back: '#cccccc' },
  edges: { width: 0.5, color: '#231f20', dash: null, cap: 'butt' },
  mountainFolds: { width: 0.75, color: '#aa0000', dash: [8, 2, 1, 2], cap: 'butt' },
  valleyFolds: { width: 0.75, color: '#0000aa', dash: [4, 2], cap: 'butt' },
  auxCreases: { visible: true, pen: { width: 0.25, color: '#888888', dash: null, cap: 'round' } },
  erode: 0.005,
};

describe('sheetThumbnailInk', () => {
  it('is the style’s paper and pens, at their on-screen weight', () => {
    const ink = sheetThumbnailInk(STYLE);
    expect(ink.paper).toBe('#fafafa');
    expect(ink.pens.edge).toEqual({
      stroke: '#231f20',
      strokeWidth: 0.5 * PT_TO_CSS_PX,
      strokeLinecap: 'butt',
    });
    expect(ink.pens.valley).toEqual({
      stroke: '#0000aa',
      strokeWidth: 0.75 * PT_TO_CSS_PX,
      strokeLinecap: 'butt',
      // 0.75 pt is a CSS pixel, so the pen's multiples are its runs.
      strokeDasharray: '4 2',
    });
    expect(ink.pens.mountain?.stroke).toBe('#aa0000');
    expect(ink.erode).toBe(0.005);
  });

  it('draws a crease with no direction in the aux pen, and aux lines only while shown', () => {
    const shown = sheetThumbnailInk(STYLE);
    expect(shown.pens.unassigned?.stroke).toBe('#888888');
    expect(shown.pens.aux).toEqual(shown.pens.unassigned);
    const hidden = sheetThumbnailInk({ ...STYLE, auxCreases: { ...STYLE.auxCreases, visible: false } });
    expect(hidden.pens.aux).toBeNull();
    // A crease is still a crease when aux lines are hidden.
    expect(hidden.pens.unassigned?.stroke).toBe('#888888');
    // A surface's own answer wins over the style's switch, either way.
    expect(sheetThumbnailInk(STYLE, false).pens.aux).toBeNull();
    expect(
      sheetThumbnailInk({ ...STYLE, auxCreases: { ...STYLE.auxCreases, visible: false } }, true).pens
        .aux
    ).not.toBeNull();
  });

  it('draws the folds by direction whatever a simulation does with them', () => {
    // A crease pattern has folded nothing: "Render all creases as edges" is a
    // simulation's, and not a thumbnail's.
    const ink = sheetThumbnailInk({ ...STYLE, foldsAsEdges: true });
    expect(ink.pens.mountain?.stroke).toBe('#aa0000');
    expect(ink.pens.valley?.stroke).toBe('#0000aa');
  });
});
