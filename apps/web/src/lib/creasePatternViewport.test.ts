import { describe, expect, it } from 'vitest';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import {
  closestOrieditaGridPoint,
  CP_EDITABLE_CANVAS_RECT,
  CP_EDITABLE_FIT_RECT,
  CP_PAPER_RECT,
  cpLineAssignmentLabel,
  cpLineColorClass,
  cpSelectionSize,
  cpSvgPointToModel,
  getCpGridLines,
  getCpVertices,
  getEditableCpModelBounds,
  getOrieditaGridBasis,
  modelPointToCpSvg,
  nearestCpSnapTarget,
  nearestOrieditaDrawPointTarget,
  normalizeOrieditaGridSize,
  ORIEDITA_PAPER_BOUNDS,
  orieditaGridBaseState,
  toggleCpSelectionList,
  visibleOrieditaGridMetadata,
} from './creasePatternViewport';

const document: OristudioCpDocumentSnapshot = {
  title: 'fixture',
  metadata: {},
  crease_pattern: {
    line_segments: [
      {
        a: { x: 0, y: 0 },
        b: { x: 10, y: 0 },
        active: 'Inactive0',
        color: 'Red1',
        selected: 0,
        customized: 0,
        customized_color: { red: 100, green: 200, blue: 200 },
      },
      {
        a: { x: 0, y: 0 },
        b: { x: 0, y: 10 },
        active: 'Inactive0',
        color: 'Blue2',
        selected: 0,
        customized: 0,
        customized_color: { red: 100, green: 200, blue: 200 },
      },
    ],
    circles: [],
    points: [{ x: 5, y: 5 }],
    aux_line_segments: [],
    texts: [],
    grid: {
      interval_grid_size: 2,
      grid_size: 10,
      grid_xa: 1,
      grid_xb: 0,
      grid_xc: 1,
      grid_ya: 1,
      grid_yb: 0,
      grid_yc: 1,
      grid_angle: 90,
      base_state: 'WithinPaper',
      vertical_scale_position: 0,
      horizontal_scale_position: 0,
      draw_diagonal_gridlines: false,
    },
  },
};

describe('crease pattern viewport helpers', () => {
  it('uses Oriedita paper bounds for active-grid documents and reversible SVG mapping', () => {
    const bounds = getEditableCpModelBounds(document);
    expect(bounds).toEqual(ORIEDITA_PAPER_BOUNDS);

    const svg = modelPointToCpSvg({ x: 5, y: 5 }, bounds);
    const model = cpSvgPointToModel(svg, bounds);
    expect(model.x).toBeCloseTo(5);
    expect(model.y).toBeCloseTo(5);
  });

  it('generates Oriedita paper-coordinate grid lines with interval offsets', () => {
    const bounds = getEditableCpModelBounds(document);
    const lines = getCpGridLines(bounds, document.crease_pattern.grid);

    expect(lines).toHaveLength(22);
    expect(lines.filter((line) => line.major)).toHaveLength(12);
    const leftLine = lines.find((line) => line.id === 'oriedita-a-0');
    expect(leftLine?.a.x).toBeCloseTo(-200);
    expect(leftLine?.a.y).toBeCloseTo(200);
    expect(leftLine?.b.x).toBeCloseTo(-200);
    expect(leftLine?.b.y).toBeCloseTo(-200);
    expect(leftLine?.major).toBe(true);
    const bottomLine = lines.find((line) => line.id === 'oriedita-b-10');
    expect(bottomLine?.a.x).toBeCloseTo(-200);
    expect(bottomLine?.a.y).toBeCloseTo(-200);
    expect(bottomLine?.b.x).toBeCloseTo(200);
    expect(bottomLine?.b.y).toBeCloseTo(-200);
    expect(bottomLine?.major).toBe(true);
  });

  it('hides the grid and keeps geometry bounds when Oriedita grid state is hidden', () => {
    const hiddenDocument: OristudioCpDocumentSnapshot = {
      ...document,
      crease_pattern: {
        ...document.crease_pattern,
        grid: { ...document.crease_pattern.grid, base_state: 'Hidden' },
      },
    };
    const bounds = getEditableCpModelBounds(hiddenDocument);

    expect(bounds.minX).toBeLessThan(0);
    expect(bounds.maxX).toBeLessThan(11);
    expect(getCpGridLines(bounds, hiddenDocument.crease_pattern.grid)).toEqual([]);
    expect(closestOrieditaGridPoint({ x: 0, y: 0 }, hiddenDocument.crease_pattern.grid)).toBeNull();

    const visibleGrid = visibleOrieditaGridMetadata(hiddenDocument.crease_pattern.grid);
    expect(visibleGrid.base_state).toBe('Full');
    expect(getCpGridLines(ORIEDITA_PAPER_BOUNDS, visibleGrid).length).toBeGreaterThan(22);
  });

  it('ports Oriedita non-square and angled grid basis math', () => {
    const basis = getOrieditaGridBasis({
      ...document.crease_pattern.grid,
      grid_size: 4,
      grid_xa: 2,
      grid_xb: 1,
      grid_xc: 4,
      grid_ya: 1,
      grid_yb: 1,
      grid_yc: 9,
      grid_angle: 60,
      base_state: 'Full',
    });

    expect(basis.gridWidth).toBe(100);
    expect(basis.a).toEqual({ x: 400, y: 0 });
    expect(basis.b.x).toBeCloseTo(200);
    expect(basis.b.y).toBeCloseTo(-346.41016151377545);
    expect(basis.baseState).toBe('full');

    expect(
      getOrieditaGridBasis({
        ...document.crease_pattern.grid,
        grid_angle: 60,
        base_state: 'WithinPaper',
      }).baseState
    ).toBe('full');
  });

  it('normalizes Oriedita grid size input with a minimum of one division', () => {
    expect(normalizeOrieditaGridSize(32.8)).toBe(32);
    expect(normalizeOrieditaGridSize(0)).toBe(1);
    expect(normalizeOrieditaGridSize(-8)).toBe(1);
    expect(normalizeOrieditaGridSize(Number.NaN)).toBe(1);
    expect(
      getOrieditaGridBasis({
        ...document.crease_pattern.grid,
        grid_size: 0,
      }).gridWidth
    ).toBe(400);
  });

  it('extends full-state grids across the visible CP viewport', () => {
    const withinPaperLines = getCpGridLines(ORIEDITA_PAPER_BOUNDS, {
      ...document.crease_pattern.grid,
      grid_size: 2,
      base_state: 'WithinPaper',
    });
    const fullLines = getCpGridLines(ORIEDITA_PAPER_BOUNDS, {
      ...document.crease_pattern.grid,
      grid_size: 2,
      base_state: 'Full',
    });

    expect(withinPaperLines).toHaveLength(6);
    expect(fullLines.length).toBeGreaterThan(withinPaperLines.length);
    expect(fullLines.some((line) => line.a.x < -200 || line.a.y > 200)).toBe(true);
  });

  it('extends full-state grids across the larger editable CP canvas', () => {
    const compactLines = getCpGridLines(ORIEDITA_PAPER_BOUNDS, {
      ...document.crease_pattern.grid,
      grid_size: 4,
      base_state: 'Full',
    });
    const editableLines = getCpGridLines(
      ORIEDITA_PAPER_BOUNDS,
      {
        ...document.crease_pattern.grid,
        grid_size: 4,
        base_state: 'Full',
      },
      1,
      {
        canvasRect: CP_EDITABLE_CANVAS_RECT,
        paperRect: CP_PAPER_RECT,
      }
    );

    expect(CP_EDITABLE_CANVAS_RECT.width).toBeGreaterThan(CP_EDITABLE_FIT_RECT.width);
    expect(editableLines.length).toBeGreaterThan(compactLines.length);
    expect(editableLines.some((line) => line.a.x < -200 || line.b.x > 200)).toBe(true);
  });

  it('caps dense full-canvas grid rendering for performance', () => {
    const lines = getCpGridLines(
      ORIEDITA_PAPER_BOUNDS,
      {
        ...document.crease_pattern.grid,
        grid_size: 160,
        base_state: 'Full',
        draw_diagonal_gridlines: true,
      },
      1,
      {
        canvasRect: CP_EDITABLE_CANVAS_RECT,
        paperRect: CP_PAPER_RECT,
      }
    );

    expect(lines.length).toBeLessThanOrEqual(520);
  });

  it('draws optional diagonal grid lines from the Oriedita index ranges', () => {
    const lines = getCpGridLines(ORIEDITA_PAPER_BOUNDS, {
      ...document.crease_pattern.grid,
      grid_size: 2,
      interval_grid_size: 2,
      draw_diagonal_gridlines: true,
    });

    expect(lines.filter((line) => line.id.startsWith('oriedita-a-'))).toHaveLength(3);
    expect(lines.filter((line) => line.id.startsWith('oriedita-b-'))).toHaveLength(3);
    expect(lines.filter((line) => line.id.startsWith('oriedita-diagonal-'))).toHaveLength(6);
    expect(lines.find((line) => line.id === 'oriedita-diagonal-a-1')).toMatchObject({
      a: { x: 0, y: 200 },
      b: { x: -200, y: 0 },
    });
  });

  it('finds nearest snap candidates without mutating selection state', () => {
    const bounds = getEditableCpModelBounds(document);
    const vertices = getCpVertices(document);

    expect(vertices).toEqual([
      { id: '0:0', point: { x: 0, y: 0 }, lineIds: [1, 2] },
      { id: '0:10000000000', point: { x: 0, y: 10 }, lineIds: [2] },
      { id: '10000000000:0', point: { x: 10, y: 0 }, lineIds: [1] },
    ]);

    expect(
      nearestCpSnapTarget(document, { x: 0.03, y: 0.02 }, bounds, {
        gridVisible: true,
        snapToGrid: true,
        snapToVertices: true,
        snapToLines: true,
      })
    ).toMatchObject({ kind: 'line', label: 'line 1' });

    expect(toggleCpSelectionList([2], 1)).toEqual([1, 2]);
    expect(toggleCpSelectionList([1, 2], 1)).toEqual([2]);
    expect(toggleCpSelectionList(['0:0'], '1:0')).toEqual(['0:0', '1:0']);
    expect(
      cpSelectionSize({
        lines: [1, 2],
        vertices: ['0:0'],
        points: [1],
        circles: [],
        texts: [],
        faces: [],
      })
    ).toBe(4);
  });

  it('uses Oriedita draw snapping without snapping endpoints to line interiors', () => {
    const bounds = getEditableCpModelBounds(document);

    expect(
      nearestCpSnapTarget(document, { x: 2, y: 0.2 }, bounds, {
        gridVisible: false,
        snapToGrid: false,
        snapToVertices: true,
        snapToLines: true,
      })
    ).toMatchObject({ kind: 'line', label: 'line 1' });

    expect(
      nearestOrieditaDrawPointTarget(
        document,
        { x: 2, y: 0.2 },
        bounds,
        {
          gridVisible: false,
          snapToGrid: false,
          snapToVertices: true,
          snapToLines: true,
        },
        3
      )
    ).toMatchObject({ kind: 'vertex', label: 'line 1 start', point: { x: 0, y: 0 } });
  });

  it('uses a larger capture radius for Oriedita draw vertex snapping', () => {
    const bounds = getEditableCpModelBounds(document);

    expect(
      nearestOrieditaDrawPointTarget(
        document,
        { x: 16.5, y: 0 },
        bounds,
        {
          gridVisible: false,
          snapToGrid: false,
          snapToVertices: true,
          snapToLines: false,
        },
        5
      )
    ).toMatchObject({ kind: 'vertex', label: 'line 1 end', point: { x: 10, y: 0 } });

    expect(
      nearestOrieditaDrawPointTarget(
        document,
        { x: 16.5, y: 0 },
        bounds,
        {
          gridVisible: false,
          snapToGrid: false,
          snapToVertices: false,
          snapToLines: false,
        },
        5
      )
    ).toBeNull();
  });

  it('snaps to the same Oriedita paper grid basis used for rendering', () => {
    expect(closestOrieditaGridPoint({ x: 2, y: -3 }, document.crease_pattern.grid)).toEqual({
      x: 0,
      y: 0,
    });
    expect(
      nearestCpSnapTarget(document, { x: 38, y: 42 }, getEditableCpModelBounds(document), {
        gridVisible: true,
        snapToGrid: true,
        snapToVertices: false,
        snapToLines: false,
      })
    ).toMatchObject({ kind: 'grid', point: { x: 40, y: 40 } });
  });

  it('treats paper corners as point-like snap targets', () => {
    const options = {
      gridVisible: false,
      snapToGrid: false,
      snapToVertices: true,
      snapToLines: false,
    };

    expect(
      nearestCpSnapTarget(document, { x: 198, y: 199 }, ORIEDITA_PAPER_BOUNDS, options, 4)
    ).toMatchObject({
      kind: 'vertex',
      label: 'paper top right',
      point: { x: 200, y: 200 },
    });
    expect(
      nearestOrieditaDrawPointTarget(
        document,
        { x: -198, y: -199 },
        ORIEDITA_PAPER_BOUNDS,
        options,
        4
      )
    ).toMatchObject({
      kind: 'vertex',
      label: 'paper bottom left',
      point: { x: -200, y: -200 },
    });
  });

  it('uses the visible viewport grid for grid snapping when saved grid state is hidden', () => {
    const hiddenDocument: OristudioCpDocumentSnapshot = {
      ...document,
      crease_pattern: {
        ...document.crease_pattern,
        grid: { ...document.crease_pattern.grid, base_state: 'Hidden' },
      },
    };

    expect(
      nearestCpSnapTarget(hiddenDocument, { x: 38, y: 42 }, getEditableCpModelBounds(document), {
        gridVisible: true,
        snapToGrid: true,
        snapToVertices: false,
        snapToLines: false,
      })
    ).toMatchObject({ kind: 'grid', point: { x: 40, y: 40 } });
    expect(
      nearestCpSnapTarget(hiddenDocument, { x: 38, y: 42 }, getEditableCpModelBounds(document), {
        gridVisible: false,
        snapToGrid: true,
        snapToVertices: false,
        snapToLines: false,
      })
    ).toBeNull();
  });

  it('maps Oriedita line colors to existing CP render classes', () => {
    expect(orieditaGridBaseState('WITHIN_PAPER')).toBe('within-paper');
    expect(cpLineColorClass('Red1', 'mvf')).toBe('crease crease--fold-mountain');
    expect(cpLineColorClass('Blue2', 'mvf')).toBe('crease crease--fold-valley');
    expect(cpLineColorClass('Cyan3', 'mvf')).toBe('crease crease--fold-flat');
    expect(cpLineColorClass('Red1', 'agrh')).toBe('crease crease--kind-axial');
    expect(cpLineAssignmentLabel('Black0')).toBe('edge');
  });
});
