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
    aux_segment_indices: [],
    aux_unit_segments: [],
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
  // A square sheet, border 0-3 black, with one crease of each kind across it:
  // 4 a mountain diagonal, 5 a cyan line (an aux line), 6 a crease with no
  // colour, 7 an angle crease hinted valley, and 8 the sheet's own aux line.
  const geometry = {
    segEndpoints: Float64Array.from([
      ...[0, 0, 100, 0],
      ...[100, 0, 100, 100],
      ...[100, 100, 0, 100],
      ...[0, 100, 0, 0],
      ...[0, 0, 100, 100],
      ...[0, 20, 100, 20],
      ...[0, 40, 100, 40],
      ...[0, 60, 100, 60],
      ...[0, 80, 100, 80],
    ]),
    // `SEG_ATTR_STRIDE` 5: `[color, active, selected, customized, hint]`.
    segAttr: Int32Array.from([
      ...[0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0],
      ...[0, 0, 0, 0, 0],
      ...[1, 0, 0, 0, 0],
      ...[3, 0, 0, 0, 0],
      ...[-1, 0, 0, 0, 0],
      ...[-2, 0, 0, 0, 2],
      ...[3, 0, 0, 0, 0],
    ]),
  } as unknown as CpGeometryTransport;
  const sheet = () =>
    component({ segment_indices: [4, 5, 6, 7], aux_segment_indices: [8] });

  it('fits the sheet into the box and gives each crease its role', () => {
    const thumbnail = sheetThumbnail(geometry, sheet(), 100);
    expect(thumbnail).not.toBeNull();
    expect(thumbnail?.viewBox).toBe('0 0 100 100');
    const byY = new Map(
      thumbnail?.strokes
        .filter((stroke) => stroke.y1 === stroke.y2 && stroke.y1 > 0 && stroke.y1 < 100)
        .map((stroke) => [stroke.y1, stroke.role])
    );
    // The kernel's reading of each colour, as the Simulate card reads the FOLD.
    expect(byY.get(20)).toBe('aux');
    expect(byY.get(40)).toBe('unassigned');
    expect(byY.get(60)).toBe('valley');
    expect(byY.get(80)).toBe('aux');
    const roles = thumbnail?.strokes.map((stroke) => stroke.role) ?? [];
    expect(roles.filter((role) => role === 'edge')).toHaveLength(4);
    expect(roles).toContain('mountain');
    // The paper's edge draws last, over the creases that end on it.
    expect(roles[roles.length - 1]).toBe('edge');
    for (const stroke of thumbnail?.strokes ?? []) {
      for (const value of [stroke.x1, stroke.y1, stroke.x2, stroke.y2]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });

  it('lays the sheet on the paper the canvas fills, and marks where aux lines meet it', () => {
    const thumbnail = sheetThumbnail(geometry, sheet(), 100);
    // The border's hull, counter-clockwise from its lowest point.
    expect(thumbnail?.paper).toBe('M0 0L100 0L100 100L0 100Z');
    const aux = thumbnail?.strokes.find((stroke) => stroke.role === 'aux' && stroke.y1 === 80);
    expect(aux?.onBoundary).toEqual([true, true]);
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
