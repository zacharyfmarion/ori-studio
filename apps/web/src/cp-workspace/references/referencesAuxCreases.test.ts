import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { referencesSheetAux, referencesShowsAux, shownSheetAux } from './referencesAuxCreases';
import type { PrecreaseComponent } from './sheetFrames';

const HIDDEN: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  auxCreases: { ...DEFAULT_PAPER_STYLE.auxCreases, visible: false },
};

function sheet(aux: number[], unit: [number, number, number, number][]): PrecreaseComponent {
  return {
    id: 3,
    frame: null,
    rf_rect: null,
    affines: null,
    outline: [],
    outline_residual: 0,
    is_fallback: false,
    border_segment_indices: [0, 1, 2, 3],
    segment_indices: [4],
    unit_segments: [[0, 0, 1, 1]],
    aux_segment_indices: aux,
    aux_unit_segments: unit,
    merged_lines: [],
    exactness: null,
    refused: null,
  };
}

const geometry = {
  // Six segments: the border, one crease, and an aux line at index 5.
  segEndpoints: Float64Array.from([
    ...[0, 0, 400, 0],
    ...[400, 0, 400, 400],
    ...[400, 400, 0, 400],
    ...[0, 400, 0, 0],
    ...[0, 0, 400, 400],
    ...[0, 100, 400, 100],
  ]),
} as unknown as CpGeometryTransport;

describe('referencesShowsAux', () => {
  it('follows the style’s own switch until the option is set', () => {
    expect(referencesShowsAux(DEFAULT_PAPER_STYLE, null)).toBe(true);
    expect(referencesShowsAux(HIDDEN, null)).toBe(false);
    expect(referencesShowsAux(HIDDEN, true)).toBe(true);
    expect(referencesShowsAux(DEFAULT_PAPER_STYLE, false)).toBe(false);
  });
});

describe('referencesSheetAux', () => {
  it('carries a sheet’s aux lines as ids, unit segments and model segments', () => {
    const aux = referencesSheetAux(sheet([5], [[0, 0.75, 1, 0.75]]), geometry)!;
    expect(aux.component).toBe(3);
    // The editor's crease ids are 1-based.
    expect([...aux.ids]).toEqual([6]);
    expect(aux.unit).toEqual([
      [
        { x: 0, y: 0.75 },
        { x: 1, y: 0.75 },
      ],
    ]);
    expect(aux.model).toEqual([
      [
        { x: 0, y: 100 },
        { x: 400, y: 100 },
      ],
    ]);
  });

  it('is null for a sheet with none', () => {
    expect(referencesSheetAux(sheet([], []), geometry)).toBeNull();
  });
});

describe('shownSheetAux', () => {
  const inks = {
    aux: { pen: DEFAULT_PAPER_STYLE.auxCreases.pen, css: 0.5 * PT_TO_CSS_PX },
    showAux: true,
  };

  it('hands the canvas the ids and the pen while they are shown', () => {
    const aux = referencesSheetAux(sheet([5], [[0, 0.75, 1, 0.75]]), geometry);
    expect(shownSheetAux(aux, inks)).toEqual({ ids: aux!.ids, pen: inks.aux });
    expect(shownSheetAux(aux, { ...inks, showAux: false })).toBeNull();
    expect(shownSheetAux(null, inks)).toBeNull();
  });
});
