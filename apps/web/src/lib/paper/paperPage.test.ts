import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAPER_PAGE,
  DEFAULT_PAPER_SIZE_MM,
  PAPER_PADDING_MM_RANGE,
  PAPER_SHEET_MM_RANGE,
  normalizePaperPage,
} from './paperPage';

describe('the default page', () => {
  // Always a size: the picture's size on screen is not one anybody chose.
  it('is 50 mm, and a stored "as shown" from an older build reads as it', () => {
    expect(DEFAULT_PAPER_SIZE_MM).toBe(50);
    expect(DEFAULT_PAPER_PAGE.sheet).toEqual({ mm: DEFAULT_PAPER_SIZE_MM });
    expect(normalizePaperPage({ ...DEFAULT_PAPER_PAGE, sheet: 'as-shown' }).sheet).toEqual({
      mm: DEFAULT_PAPER_SIZE_MM,
    });
  });
});

describe('normalizePaperPage', () => {
  it('returns the default for anything that is not a page', () => {
    expect(normalizePaperPage(undefined)).toBe(DEFAULT_PAPER_PAGE);
    expect(normalizePaperPage(null)).toBe(DEFAULT_PAPER_PAGE);
    expect(normalizePaperPage('as-shown')).toBe(DEFAULT_PAPER_PAGE);
    expect(normalizePaperPage({})).toEqual(DEFAULT_PAPER_PAGE);
  });

  it('keeps a well-formed page', () => {
    const page = {
      sheet: { mm: 150 },
      paddingMm: 2.5,
      background: '#ffffff',
      keepHiddenFaces: false,
    };
    expect(normalizePaperPage(page)).toEqual(page);
    expect(normalizePaperPage({ ...page, sheet: 'as-shown' }).sheet).toEqual(DEFAULT_PAPER_PAGE.sheet);
  });

  it('defaults each malformed field on its own', () => {
    expect(
      normalizePaperPage({
        sheet: { mm: 'big' },
        paddingMm: Number.NaN,
        background: 'white',
        keepHiddenFaces: 'yes',
      })
    ).toEqual(DEFAULT_PAPER_PAGE);
    expect(normalizePaperPage({ sheet: { mm: -5 } }).sheet).toEqual(DEFAULT_PAPER_PAGE.sheet);
    expect(normalizePaperPage({ sheet: { mm: 0 } }).sheet).toEqual(DEFAULT_PAPER_PAGE.sheet);
  });

  it('reads a null background as transparent and folds a hex to lowercase', () => {
    expect(normalizePaperPage({ background: null }).background).toBeNull();
    expect(normalizePaperPage({ background: '#FFFFFF' }).background).toBe('#ffffff');
  });

  it('clamps the sheet size and the margin to their ranges', () => {
    expect(normalizePaperPage({ sheet: { mm: 1e6 } }).sheet).toEqual({
      mm: PAPER_SHEET_MM_RANGE.max,
    });
    expect(normalizePaperPage({ sheet: { mm: 1 } }).sheet).toEqual({
      mm: PAPER_SHEET_MM_RANGE.min,
    });
    expect(normalizePaperPage({ paddingMm: -3 }).paddingMm).toBe(PAPER_PADDING_MM_RANGE.min);
    expect(normalizePaperPage({ paddingMm: 1e6 }).paddingMm).toBe(PAPER_PADDING_MM_RANGE.max);
  });
});
