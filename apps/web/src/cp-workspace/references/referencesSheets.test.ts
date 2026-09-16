import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  referencesSheets,
  resolveSelectedSheet,
  sheetBorderLineIds,
  sheetLineIds,
  sheetThumbnail,
} from './referencesSheets';
import type { PrecreaseComponent, SheetAnalysis } from './sheetFrames';

function component(overrides: Partial<PrecreaseComponent> = {}): PrecreaseComponent {
  return {
    id: 0,
    frame: { origin: [0, 0], x_axis: [1, 0], y_axis: [0, -1], width: 1, height: 1 },
    rf_rect: { width: 1, height: 1 },
    affines: null,
    outline: [],
    outline_residual: 0,
    is_fallback: false,
    border_segment_indices: [0, 1, 2, 3],
    segment_indices: [4],
    unit_segments: [],
    merged_lines: [],
    exactness: null,
    refused: null,
    ...overrides,
  } as PrecreaseComponent;
}

function analysis(components: PrecreaseComponent[]): SheetAnalysis {
  return { components, warnings: [] } as unknown as SheetAnalysis;
}

describe('referencesSheets', () => {
  it('puts the plannable sheets first, largest first', () => {
    const sheets = referencesSheets(
      analysis([
        component({ id: 0, segment_indices: [4] }),
        component({ id: 1, frame: null, rf_rect: null, segment_indices: [5, 6, 7, 8, 9] }),
        component({ id: 2, segment_indices: [5, 6, 7] }),
      ])
    );
    expect(sheets.map((sheet) => sheet.id)).toEqual([2, 0, 1]);
    expect(sheets.map((sheet) => sheet.plannable)).toEqual([true, true, false]);
  });

  it('counts the border in a sheet’s creases', () => {
    const [sheet] = referencesSheets(analysis([component()]));
    expect(sheet.creaseCount).toBe(5);
  });
});

describe('resolveSelectedSheet', () => {
  const sheets = referencesSheets(
    analysis([component({ id: 0 }), component({ id: 7, frame: null, rf_rect: null })])
  );

  it('keeps a stored id that still names a sheet', () => {
    expect(resolveSelectedSheet(sheets, 7)).toBe(7);
  });

  // The analysis is recomputed on every revision, so an id from a previous
  // shape of the document may now name a different pattern or none at all.
  it('falls back to the first plannable sheet when the stored id is gone', () => {
    expect(resolveSelectedSheet(sheets, 42)).toBe(0);
    expect(resolveSelectedSheet(sheets, null)).toBe(0);
  });

  it('answers null for a document with no sheets', () => {
    expect(resolveSelectedSheet([], 3)).toBeNull();
  });
});

describe('sheetLineIds', () => {
  it('is 1-based and covers the border and the creases', () => {
    expect([...sheetLineIds(component())].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    expect([...sheetBorderLineIds(component())].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });
});

describe('sheetThumbnail', () => {
  // A unit square with one diagonal: border 0-3 black, crease 4 mountain.
  const geometry = {
    segEndpoints: Float64Array.from([
      0, 0, 100, 0, 100, 0, 100, 100, 100, 100, 0, 100, 0, 100, 0, 0, 0, 0, 100, 100,
    ]),
    // Five segments at `SEG_ATTR_STRIDE` 5; only the fifth (the diagonal) is
    // a mountain, so its colour sits at index 20.
    segAttr: Int32Array.from([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0,
    ]),
  } as unknown as CpGeometryTransport;

  it('fits the sheet into the box and classifies its strokes', () => {
    const thumbnail = sheetThumbnail(geometry, component(), 100);
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.viewBox).toBe('0 0 100 100');
    const kinds = thumbnail?.strokes.map((stroke) => stroke.kind) ?? [];
    expect(kinds.filter((kind) => kind === 'border')).toHaveLength(4);
    expect(kinds).toContain('mountain');
    // The border draws last, over the creases that end on it.
    expect(kinds[kinds.length - 1]).toBe('border');
    for (const stroke of thumbnail?.strokes ?? []) {
      for (const value of [stroke.x1, stroke.y1, stroke.x2, stroke.y2]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('refuses a degenerate sheet rather than dividing by zero', () => {
    const flat = {
      segEndpoints: Float64Array.from([5, 5, 5, 5]),
      segAttr: Int32Array.from([0, 0, 0, 0, 0]),
    } as unknown as CpGeometryTransport;
    expect(
      sheetThumbnail(flat, component({ border_segment_indices: [0], segment_indices: [] }))
    ).toBeNull();
  });
});
