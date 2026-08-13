import { describe, expect, it } from 'vitest';
import type { OristudioCpDocumentSnapshot } from '../engine/oristudioCpTypes';
import {
  closestOrieditaGridPoint,
  CP_EDITABLE_CANVAS_RECT,
  CP_EDITABLE_FIT_RECT,
  CP_PAPER_RECT,
  advanceOristudioCpLineStyle,
  clampOristudioCpLineWidth,
  clampOristudioCpPointSize,
  cpLineAssignmentLabel,
  cpLineColorClass,
  cpLineStyleColorKind,
  cpSelectionSize,
  cpSvgPointToModel,
  expandedModelBoundsFromPoints,
  getCpGridLines,
  getCpVertexPoints,
  getEditableCpModelBounds,
  getOrieditaGridBasis,
  modelPointToCpSvg,
  nearestCpSnapTarget,
  cpKernelSnapCandidates,
  nearestOrieditaDrawPointTarget,
  normalizeOrieditaGridSize,
  ORIEDITA_PAPER_BOUNDS,
  orieditaGridBaseState,
  orieditaGridLinesForModelBounds,
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

    expect(modelPointToCpSvg({ x: -200, y: -200 }, bounds)).toEqual({
      x: CP_PAPER_RECT.x,
      y: CP_PAPER_RECT.y,
    });
    expect(modelPointToCpSvg({ x: 200, y: 200 }, bounds)).toEqual({
      x: CP_PAPER_RECT.x + CP_PAPER_RECT.width,
      y: CP_PAPER_RECT.y + CP_PAPER_RECT.height,
    });

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
    const vertices = getCpVertexPoints(document);

    // Deduplicated endpoint positions (order is irrelevant — they render as dots).
    expect(vertices).toHaveLength(3);
    expect(vertices).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ])
    );

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
        points: [1],
        circles: [],
        texts: [],
        faces: [],
      })
    ).toBe(3);
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
      label: 'paper bottom right',
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
      label: 'paper top left',
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
    expect(cpLineColorClass('Red1', 'mvf')).toBe('crease crease--fold-mountain crease--line-color-mountain');
    expect(cpLineColorClass('Blue2', 'mvf')).toBe('crease crease--fold-valley crease--line-color-valley');
    expect(cpLineColorClass('Cyan3', 'mvf')).toBe('crease crease--fold-flat crease--line-color-flat');
    expect(cpLineColorClass('None', 'mvf')).toBe('crease crease--line-color-unassigned');
    expect(cpLineColorClass('Purple8', 'mvf')).toBe('crease crease--line-color-purple');
    expect(cpLineColorClass('Red1', 'agrh')).toBe('crease crease--kind-axial');
    expect(cpLineAssignmentLabel('Black0')).toBe('edge');
    expect(cpLineAssignmentLabel('Purple8')).toBe('purple');
  });
});

describe('kernel-side snap policy', () => {
  const grid = { ...document.crease_pattern.grid, base_state: 'WithinPaper' };
  const allOn = {
    gridVisible: true,
    snapToGrid: true,
    snapToVertices: true,
    snapToLines: true,
  };

  it('lets a visible grid snap everywhere, as the canvas snapper does', () => {
    expect(cpKernelSnapCandidates(grid, allOn)).toEqual({ grid: 'Full', vertices: true });
  });

  it('falls back to the document grid state when the grid is hidden from view', () => {
    expect(cpKernelSnapCandidates(grid, { ...allOn, gridVisible: false })).toEqual({
      grid: 'WithinPaper',
      vertices: true,
    });
    expect(
      cpKernelSnapCandidates({ ...grid, base_state: 'Hidden' }, { ...allOn, gridVisible: false })
    ).toEqual({ grid: 'Hidden', vertices: true });
    expect(
      cpKernelSnapCandidates({ ...grid, base_state: 'Full' }, { ...allOn, gridVisible: false })
    ).toEqual({ grid: 'Full', vertices: true });
  });

  it('drops the grid when snapping to it is off, however the grid is displayed', () => {
    expect(cpKernelSnapCandidates(grid, { ...allOn, snapToGrid: false })).toEqual({
      grid: 'Hidden',
      vertices: true,
    });
    expect(
      cpKernelSnapCandidates(grid, { ...allOn, snapToGrid: false, gridVisible: false })
    ).toEqual({ grid: 'Hidden', vertices: true });
  });

  it('carries vertex snapping independently, so Snapping off means neither', () => {
    expect(cpKernelSnapCandidates(grid, { ...allOn, snapToVertices: false })).toEqual({
      grid: 'Full',
      vertices: false,
    });
    expect(
      cpKernelSnapCandidates(grid, {
        gridVisible: true,
        snapToGrid: false,
        snapToVertices: false,
        snapToLines: false,
      })
    ).toEqual({ grid: 'Hidden', vertices: false });
  });

  it('reads an unknown stored grid state the way the rest of the viewport does', () => {
    expect(
      cpKernelSnapCandidates({ ...grid, base_state: 'within_paper' }, { ...allOn, gridVisible: false })
    ).toEqual({ grid: 'WithinPaper', vertices: true });
  });
});

describe('Oriedita line-style helpers', () => {
  it('maps line colors to crease kinds for dash targeting', () => {
    expect(cpLineStyleColorKind('Red1')).toBe('mountain');
    expect(cpLineStyleColorKind('Blue2')).toBe('valley');
    expect(cpLineStyleColorKind('Black0')).toBe('edge');
    expect(cpLineStyleColorKind('Cyan3')).toBe('aux');
    expect(cpLineStyleColorKind('Purple8')).toBe('other');
  });

  it('cycles through the five Oriedita line styles', () => {
    expect(advanceOristudioCpLineStyle('color')).toBe('black-white');
    expect(advanceOristudioCpLineStyle('black-white')).toBe('color-and-shape');
    expect(advanceOristudioCpLineStyle('color-and-shape')).toBe('black-one-dot');
    expect(advanceOristudioCpLineStyle('black-one-dot')).toBe('black-two-dot');
    expect(advanceOristudioCpLineStyle('black-two-dot')).toBe('color');
  });

  it('clamps line width and point size to Oriedita ranges', () => {
    expect(clampOristudioCpLineWidth(0)).toBe(1);
    expect(clampOristudioCpLineWidth(3.4)).toBe(3);
    expect(clampOristudioCpLineWidth(99)).toBe(8);
    expect(clampOristudioCpPointSize(-2)).toBe(0);
    expect(clampOristudioCpPointSize(4)).toBe(4);
    expect(clampOristudioCpPointSize(50)).toBe(10);
  });
});

describe('viewport-following (infinite) grid generation', () => {
  const visibleGrid = visibleOrieditaGridMetadata(document.crease_pattern.grid);

  it('tracks the visible region so the grid extends past the paper as it grows', () => {
    // A region larger than the paper (which spans [-200, 200]) must produce grid
    // lines well outside the paper, unlike a fixed paper-bounded grid.
    const wide = orieditaGridLinesForModelBounds(
      { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000, spanX: 2000, spanY: 2000 },
      visibleGrid
    );
    const maxCoordinate = Math.max(
      ...wide.flatMap((line) => [line.a.x, line.a.y, line.b.x, line.b.y])
    );
    const minCoordinate = Math.min(
      ...wide.flatMap((line) => [line.a.x, line.a.y, line.b.x, line.b.y])
    );
    expect(maxCoordinate).toBeGreaterThan(400);
    expect(minCoordinate).toBeLessThan(-400);

    // A smaller visible region generates a grid confined to that region, proving
    // the extent follows the viewport rather than a fixed world.
    const narrow = orieditaGridLinesForModelBounds(
      { minX: -50, minY: -50, maxX: 50, maxY: 50, spanX: 100, spanY: 100 },
      visibleGrid
    );
    const narrowMax = Math.max(
      ...narrow.flatMap((line) => [line.a.x, line.a.y, line.b.x, line.b.y])
    );
    expect(narrowMax).toBeLessThan(400);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it('caps line count for very large visible regions like Oriedita', () => {
    const huge = orieditaGridLinesForModelBounds(
      { minX: -100000, minY: -100000, maxX: 100000, maxY: 100000, spanX: 200000, spanY: 200000 },
      visibleGrid
    );
    expect(huge.length).toBeGreaterThan(0);
    expect(huge.length).toBeLessThan(1000);
  });

  it('pads viewport corners into a model region by the requested margin', () => {
    const bounds = expandedModelBoundsFromPoints(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 40 },
        { x: 100, y: 40 },
      ],
      0.5
    );
    expect(bounds.minX).toBeCloseTo(-50);
    expect(bounds.maxX).toBeCloseTo(150);
    expect(bounds.minY).toBeCloseTo(-20);
    expect(bounds.maxY).toBeCloseTo(60);
    expect(bounds.spanX).toBeCloseTo(200);
    expect(bounds.spanY).toBeCloseTo(80);
  });
});
