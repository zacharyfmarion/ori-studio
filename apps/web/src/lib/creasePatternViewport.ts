import type {
  OristudioCpDocumentSnapshot,
  OristudioCpGridMetadata,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import type { Point, PlotRect } from './geometry';
import { cpPaletteEntryForColor } from './oristudioCpPalette';

export const CP_VIEWBOX_SIZE = 720;
export const CP_WORLD_RECT: PlotRect = { x: 0, y: 0, width: CP_VIEWBOX_SIZE, height: CP_VIEWBOX_SIZE };
export const CP_PAPER_RECT: PlotRect = { x: 66, y: 54, width: 588, height: 588 };
export const CP_PAPER_SHADOW_RECT: PlotRect = { x: 56, y: 44, width: 608, height: 608 };
export const CP_EDITABLE_CANVAS_RECT: PlotRect = {
  x: CP_PAPER_RECT.x + CP_PAPER_RECT.width / 2 - 3000,
  y: CP_PAPER_RECT.y + CP_PAPER_RECT.height / 2 - 3000,
  width: 6000,
  height: 6000,
};
export const CP_EDITABLE_FIT_RECT: PlotRect = {
  x: CP_PAPER_RECT.x - 32,
  y: CP_PAPER_RECT.y - 32,
  width: CP_PAPER_RECT.width + 64,
  height: CP_PAPER_RECT.height + 64,
};
export const ORIEDITA_PAPER_MIN = -200;
export const ORIEDITA_PAPER_MAX = 200;
export const ORIEDITA_PAPER_SIZE = ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN;
export const ORIEDITA_PAPER_BOUNDS: CpModelBounds = {
  minX: ORIEDITA_PAPER_MIN,
  minY: ORIEDITA_PAPER_MIN,
  maxX: ORIEDITA_PAPER_MAX,
  maxY: ORIEDITA_PAPER_MAX,
  spanX: ORIEDITA_PAPER_SIZE,
  spanY: ORIEDITA_PAPER_SIZE,
};
const ORIEDITA_PAPER_CORNERS: Array<{ point: Point; label: string }> = [
  { point: { x: ORIEDITA_PAPER_MIN, y: ORIEDITA_PAPER_MIN }, label: 'paper top left' },
  { point: { x: ORIEDITA_PAPER_MAX, y: ORIEDITA_PAPER_MIN }, label: 'paper top right' },
  { point: { x: ORIEDITA_PAPER_MIN, y: ORIEDITA_PAPER_MAX }, label: 'paper bottom left' },
  { point: { x: ORIEDITA_PAPER_MAX, y: ORIEDITA_PAPER_MAX }, label: 'paper bottom right' },
];

const MODEL_PADDING_RATIO = 0.04;
const DEFAULT_SPAN = 1;
const MAX_GRID_LINES = 80;
const MAX_ORIEDITA_GRID_LINES = 460;
const GRID_EPSILON = 1e-9;
const POINT_SNAP_DISTANCE_MULTIPLIER = 1.75;

export interface OristudioCpSelection {
  lines: number[];
  points: number[];
  circles: number[];
  texts: number[];
  faces: number[];
}

// Oriedita's canvas LineStyle enum (oriedita.editor.canvas.LineStyle).
export type OristudioCpLineStyle =
  | 'color'
  | 'black-white'
  | 'color-and-shape'
  | 'black-one-dot'
  | 'black-two-dot';

export const ORISTUDIO_CP_LINE_STYLES: readonly OristudioCpLineStyle[] = [
  'color',
  'black-white',
  'color-and-shape',
  'black-one-dot',
  'black-two-dot',
];

export const ORISTUDIO_CP_LINE_STYLE_LABELS: Record<OristudioCpLineStyle, string> = {
  color: 'Color',
  'black-white': 'Black & white',
  'color-and-shape': 'Color + shape',
  'black-one-dot': 'Black one-dot',
  'black-two-dot': 'Black two-dot',
};

export const ORISTUDIO_CP_MIN_LINE_WIDTH = 1;
export const ORISTUDIO_CP_MAX_LINE_WIDTH = 8;
export const ORISTUDIO_CP_MIN_POINT_SIZE = 0;
export const ORISTUDIO_CP_MAX_POINT_SIZE = 10;

export interface OristudioCpViewportOptions {
  gridVisible: boolean;
  snapToGrid: boolean;
  snapToVertices: boolean;
  snapToLines: boolean;
  camvIssuesVisible?: boolean;
  lineStyle?: OristudioCpLineStyle;
  lineWidth?: number;
  pointSize?: number;
}

export const DEFAULT_ORISTUDIO_CP_LINE_STYLE: OristudioCpLineStyle = 'color';
export const DEFAULT_ORISTUDIO_CP_LINE_WIDTH = 1;
export const DEFAULT_ORISTUDIO_CP_POINT_SIZE = 1;

export type OristudioCpViewportOptionKey = keyof OristudioCpViewportOptions;

// Maps an Oriedita LineColor to the crease-kind used by line-style dash rules.
export function cpLineStyleColorKind(color: string): 'mountain' | 'valley' | 'edge' | 'aux' | 'other' {
  switch (color) {
    case 'Red1':
      return 'mountain';
    case 'Blue2':
      return 'valley';
    case 'Black0':
      return 'edge';
    case 'Cyan3':
      return 'aux';
    default:
      return 'other';
  }
}

export function advanceOristudioCpLineStyle(style: OristudioCpLineStyle): OristudioCpLineStyle {
  const index = ORISTUDIO_CP_LINE_STYLES.indexOf(style);
  return ORISTUDIO_CP_LINE_STYLES[(index + 1) % ORISTUDIO_CP_LINE_STYLES.length];
}

export function clampOristudioCpLineWidth(value: number): number {
  if (!Number.isFinite(value)) return ORISTUDIO_CP_MIN_LINE_WIDTH;
  return Math.min(ORISTUDIO_CP_MAX_LINE_WIDTH, Math.max(ORISTUDIO_CP_MIN_LINE_WIDTH, Math.round(value)));
}

export function clampOristudioCpPointSize(value: number): number {
  if (!Number.isFinite(value)) return ORISTUDIO_CP_MIN_POINT_SIZE;
  return Math.min(ORISTUDIO_CP_MAX_POINT_SIZE, Math.max(ORISTUDIO_CP_MIN_POINT_SIZE, Math.round(value)));
}

export const EMPTY_ORISTUDIO_CP_SELECTION: OristudioCpSelection = {
  lines: [],
  points: [],
  circles: [],
  texts: [],
  faces: [],
};

export const DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS: OristudioCpViewportOptions = {
  gridVisible: true,
  snapToGrid: true,
  snapToVertices: true,
  snapToLines: true,
  camvIssuesVisible: true,
  lineStyle: 'color',
  lineWidth: 1,
  pointSize: 1,
};

export interface CpModelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  spanX: number;
  spanY: number;
}

export interface CpGridLine {
  id: string;
  a: Point;
  b: Point;
  major: boolean;
}

export interface CpSnapTarget {
  point: Point;
  kind: 'grid' | 'vertex' | 'point' | 'line';
  label: string;
  distance: number;
}

export interface CpGridRenderOptions {
  canvasRect?: PlotRect;
  paperRect?: PlotRect;
}

export interface CpVertex {
  id: string;
  point: Point;
  lineIds: number[];
}

export type OrieditaGridBaseState = 'hidden' | 'within-paper' | 'full';

export interface OrieditaGridBasis {
  baseState: OrieditaGridBaseState;
  gridSize: number;
  gridWidth: number;
  origin: Point;
  a: Point;
  b: Point;
  c: Point;
  diagonalMax: number;
  diagonalMin: number;
}

export function emptyOristudioCpSelection(): OristudioCpSelection {
  return { ...EMPTY_ORISTUDIO_CP_SELECTION };
}

export function cpSelectionSize(selection: OristudioCpSelection): number {
  return (
    selection.lines.length +
    selection.points.length +
    selection.circles.length +
    selection.texts.length +
    selection.faces.length
  );
}

export function cpVertexId(point: Point): string {
  return `${quantizeCoordinate(point.x)}:${quantizeCoordinate(point.y)}`;
}

export function getCpVertices(
  document: OristudioCpDocumentSnapshot | null | undefined
): CpVertex[] {
  if (!document) return [];

  const vertices = new Map<string, CpVertex>();
  document.crease_pattern.line_segments.forEach((segment, index) => {
    const lineId = index + 1;
    for (const point of [segment.a, segment.b]) {
      const id = cpVertexId(point);
      const existing = vertices.get(id);
      if (existing) {
        if (!existing.lineIds.includes(lineId)) {
          existing.lineIds = [...existing.lineIds, lineId].sort((a, b) => a - b);
        }
      } else {
        vertices.set(id, { id, point, lineIds: [lineId] });
      }
    }
  });

  return Array.from(vertices.values()).sort((a, b) =>
    a.point.x === b.point.x ? a.point.y - b.point.y : a.point.x - b.point.x
  );
}

export function toggleCpSelectionList<T extends number | string>(ids: T[], id: T): T[] {
  return ids.includes(id)
    ? ids.filter((selectedId) => selectedId !== id)
    : Array.from(new Set([...ids, id])).sort((a, b) =>
        typeof a === 'number' && typeof b === 'number'
          ? a - b
          : String(a).localeCompare(String(b))
      );
}

export function orieditaGridBaseState(state: string): OrieditaGridBaseState {
  const normalized = state.replace(/[_\s-]/gu, '').toLowerCase();
  switch (normalized) {
    case 'hidden':
      return 'hidden';
    case 'full':
      return 'full';
    case 'withinpaper':
      return 'within-paper';
    default:
      return 'within-paper';
  }
}

export function getOrieditaGridBasis(grid: OristudioCpGridMetadata): OrieditaGridBasis {
  const gridSize = normalizeOrieditaGridSize(grid.grid_size);
  const gridWidth = ORIEDITA_PAPER_SIZE / gridSize;
  const gridXLength = grid.grid_xa + grid.grid_xb * Math.sqrt(Math.max(0, grid.grid_xc));
  const gridYLength = grid.grid_ya + grid.grid_yb * Math.sqrt(Math.max(0, grid.grid_yc));
  // Oriedita Grid#setGrid stores the configured angle negated before calculating vector b.
  const angleRadians = (-grid.grid_angle * Math.PI) / 180;
  const a = { x: gridWidth * gridXLength, y: 0 };
  const b = {
    x: gridWidth * gridYLength * Math.cos(angleRadians),
    y: gridWidth * gridYLength * Math.sin(angleRadians),
  };
  const c = { x: b.x - a.x, y: b.y - a.y };
  const diagonalA = distance({ x: 0, y: 0 }, addPoints(a, b));
  const diagonalB = distance(a, b);
  return {
    baseState: resolveOrieditaGridBaseState(grid, gridXLength, gridYLength),
    gridSize,
    gridWidth,
    origin: { x: ORIEDITA_PAPER_MIN, y: ORIEDITA_PAPER_MAX },
    a,
    b,
    c,
    diagonalMax: Math.max(diagonalA, diagonalB),
    diagonalMin: Math.min(diagonalA, diagonalB),
  };
}

export function normalizeOrieditaGridSize(gridSize: number): number {
  if (!Number.isFinite(gridSize)) return 1;
  return Math.max(1, Math.trunc(gridSize));
}

export function normalizeOrieditaIntervalGridSize(intervalGridSize: number): number {
  if (!Number.isFinite(intervalGridSize)) return 1;
  return Math.max(1, Math.trunc(intervalGridSize));
}

// Mirrors Oriedita's GridMetadata.set_grid_angle clamp
// (Epsilon.GRID_ANGLE_THRESHOLD = 1.0 degree).
export const ORIEDITA_GRID_ANGLE_MIN = 1;
export const ORIEDITA_GRID_ANGLE_MAX = 179;

export function clampOrieditaGridAngle(gridAngle: number): number {
  if (!Number.isFinite(gridAngle)) return 90;
  return Math.min(ORIEDITA_GRID_ANGLE_MAX, Math.max(ORIEDITA_GRID_ANGLE_MIN, gridAngle));
}

// Mirrors Oriedita's GridMetadata.validate_grid: the resolved axis length
// `a + b * sqrt(c)` must be non-negative and at least Epsilon.UNKNOWN_1EN4 (1e-6).
const ORIEDITA_GRID_SCALE_EPSILON = 1e-6;

export function isValidOrieditaGridScale(a: number, b: number, c: number): boolean {
  const gridLength = a + b * Math.sqrt(c);
  return gridLength >= 0 && Math.abs(gridLength) >= ORIEDITA_GRID_SCALE_EPSILON;
}

export const ORIEDITA_GRID_SCALE_DEFAULTS = { a: 1, b: 0, c: 1 } as const;

export function visibleOrieditaGridMetadata(
  grid: OristudioCpGridMetadata
): OristudioCpGridMetadata {
  return {
    ...grid,
    base_state: 'Full',
  };
}

function resolveOrieditaGridBaseState(
  grid: OristudioCpGridMetadata,
  gridXLength: number,
  gridYLength: number
): OrieditaGridBaseState {
  const baseState = orieditaGridBaseState(grid.base_state);
  if (baseState !== 'within-paper') return baseState;
  if (
    !nearlyEqual(gridXLength, 1) ||
    !nearlyEqual(gridYLength, 1) ||
    !nearlyEqual(grid.grid_angle, 90)
  ) {
    return 'full';
  }
  return baseState;
}

export function getEditableCpModelBounds(
  document: OristudioCpDocumentSnapshot | null | undefined
): CpModelBounds {
  const points: Point[] = [];
  const includeOrieditaPaper =
    !!document && orieditaGridBaseState(document.crease_pattern.grid.base_state) !== 'hidden';
  if (document) {
    if (includeOrieditaPaper) {
      points.push(
        { x: ORIEDITA_PAPER_MIN, y: ORIEDITA_PAPER_MIN },
        { x: ORIEDITA_PAPER_MAX, y: ORIEDITA_PAPER_MAX }
      );
    }
    for (const segment of document.crease_pattern.line_segments) {
      points.push(segment.a, segment.b);
    }
    for (const segment of document.crease_pattern.aux_line_segments) {
      points.push(segment.a, segment.b);
    }
    points.push(...document.crease_pattern.points);
    for (const circle of document.crease_pattern.circles) {
      points.push(
        { x: circle.x - circle.r, y: circle.y - circle.r },
        { x: circle.x + circle.r, y: circle.y + circle.r }
      );
    }
    for (const text of document.crease_pattern.texts) {
      points.push({ x: textCoordinate(text.x), y: textCoordinate(text.y) });
    }
  }

  if (points.length === 0) {
    return boundsFromMinMax(0, 0, DEFAULT_SPAN, DEFAULT_SPAN);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  if (includeOrieditaPaper && pointsWithinOrieditaPaper(points)) {
    return { ...ORIEDITA_PAPER_BOUNDS };
  }

  const span = Math.max(maxX - minX, maxY - minY, DEFAULT_SPAN);
  const padding = span * MODEL_PADDING_RATIO;
  return boundsFromMinMax(minX - padding, minY - padding, maxX + padding, maxY + padding);
}

export function modelPointToCpSvg(
  point: Point,
  bounds: CpModelBounds,
  rect: PlotRect = CP_PAPER_RECT
): Point {
  return {
    x: rect.x + ((point.x - bounds.minX) / bounds.spanX) * rect.width,
    y: rect.y + ((point.y - bounds.minY) / bounds.spanY) * rect.height,
  };
}

export function cpSvgPointToModel(
  point: Point,
  bounds: CpModelBounds,
  rect: PlotRect = CP_PAPER_RECT
): Point {
  return {
    x: bounds.minX + ((point.x - rect.x) / rect.width) * bounds.spanX,
    y: bounds.minY + ((point.y - rect.y) / rect.height) * bounds.spanY,
  };
}

export function cpLineColorClass(color: string, mode: 'mvf' | 'agrh'): string {
  if (mode === 'agrh') return 'crease crease--kind-axial';
  const paletteEntry = cpPaletteEntryForColor(color);
  if (paletteEntry) {
    const legacyClass = legacyFoldClassForLineColor(color);
    return [
      'crease',
      legacyClass,
      `crease--line-color-${paletteEntry.cssClass}`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  switch (color) {
    case 'Red1':
      return 'crease crease--fold-mountain';
    case 'Blue2':
      return 'crease crease--fold-valley';
    case 'Black0':
      return 'crease crease--fold-border';
    default:
      return 'crease crease--fold-flat';
  }
}

function legacyFoldClassForLineColor(color: string): string | null {
  switch (color) {
    case 'Red1':
      return 'crease--fold-mountain';
    case 'Blue2':
      return 'crease--fold-valley';
    case 'Black0':
      return 'crease--fold-border';
    case 'Cyan3':
      return 'crease--fold-flat';
    default:
      return null;
  }
}

export function cpLineAssignmentLabel(color: string): string {
  const paletteEntry = cpPaletteEntryForColor(color);
  if (paletteEntry) return paletteEntry.label.toLowerCase();
  switch (color) {
    case 'Red1':
      return 'mountain';
    case 'Blue2':
      return 'valley';
    case 'Black0':
      return 'edge';
    default:
      return 'auxiliary';
  }
}

export function getCpGridLines(
  bounds: CpModelBounds,
  grid: OristudioCpGridMetadata | number,
  intervalSize = 1,
  renderOptions: CpGridRenderOptions = {}
): CpGridLine[] {
  if (typeof grid !== 'number') {
    return getOrieditaGridLines(bounds, grid, renderOptions);
  }

  const gridSize = grid;
  const divisions = Math.min(MAX_GRID_LINES, Math.max(1, gridSize));
  const interval = Math.max(1, intervalSize);
  const lines: CpGridLine[] = [];

  for (let index = 0; index <= divisions; index += 1) {
    const x = bounds.minX + (bounds.spanX * index) / divisions;
    const y = bounds.minY + (bounds.spanY * index) / divisions;
    const major = index % interval === 0;
    lines.push({
      id: `x-${index}`,
      a: { x, y: bounds.minY },
      b: { x, y: bounds.maxY },
      major,
    });
    lines.push({
      id: `y-${index}`,
      a: { x: bounds.minX, y },
      b: { x: bounds.maxX, y },
      major,
    });
  }

  return lines;
}

export function getOrieditaGridLines(
  bounds: CpModelBounds,
  grid: OristudioCpGridMetadata,
  renderOptions: CpGridRenderOptions = {}
): CpGridLine[] {
  const basis = getOrieditaGridBasis(grid);
  if (basis.baseState === 'hidden' || !hasValidGridBasis(basis)) return [];
  return orieditaGridLinesForDrawingBounds(
    gridDrawingBounds(bounds, basis, renderOptions),
    grid,
    basis
  );
}

/**
 * Generate Oriedita grid lines over an explicit model-space region.
 *
 * Unlike {@link getOrieditaGridLines}, this does not derive the drawing bounds
 * from a fixed canvas rect. The caller supplies the currently visible model
 * region (e.g. from the live pan/zoom transform), which lets the grid follow
 * the viewport and appear effectively infinite, matching Oriedita's behavior of
 * repainting the grid across the visible canvas on every frame.
 */
export function orieditaGridLinesForModelBounds(
  drawingBounds: CpModelBounds,
  grid: OristudioCpGridMetadata
): CpGridLine[] {
  const basis = getOrieditaGridBasis(grid);
  if (basis.baseState === 'hidden' || !hasValidGridBasis(basis)) return [];
  return orieditaGridLinesForDrawingBounds(drawingBounds, grid, basis);
}

/**
 * Build a model-space bounding box from viewport corner points, padded by a
 * margin so small pans do not immediately reveal an ungridded edge before the
 * grid is regenerated.
 */
export function expandedModelBoundsFromPoints(
  points: Point[],
  marginRatio = 0.5
): CpModelBounds {
  const bounds = boundsFromPoints(points);
  const marginX = bounds.spanX * marginRatio;
  const marginY = bounds.spanY * marginRatio;
  return boundsFromMinMax(
    bounds.minX - marginX,
    bounds.minY - marginY,
    bounds.maxX + marginX,
    bounds.maxY + marginY
  );
}

function orieditaGridLinesForDrawingBounds(
  drawingBounds: CpModelBounds,
  grid: OristudioCpGridMetadata,
  basis: OrieditaGridBasis
): CpGridLine[] {
  let { minA, maxA, minB, maxB } = gridIndexRange(drawingBounds, basis);
  if (basis.baseState === 'within-paper') {
    minA = Math.max(0, minA);
    maxA = Math.min(basis.gridSize, maxA);
    minB = Math.max(0, minB);
    maxB = Math.min(basis.gridSize, maxB);
  }
  if (minA > maxA || minB > maxB) return [];

  const offsetA = positiveModulo(minA, basis.gridSize);
  const offsetB = positiveModulo(minB, basis.gridSize);
  const startA = minA - offsetA;
  const startB = minB - offsetB;
  const lineStep = gridLineStep(minA, maxA, minB, maxB, grid.draw_diagonal_gridlines);
  const lines: CpGridLine[] = [];

  for (let i = startA; i <= maxA; i += lineStep) {
    const a = gridPoint(basis, i, minB);
    const b = gridPoint(basis, i, maxB);
    lines.push({
      id: `oriedita-a-${i}`,
      a,
      b,
      major: isIntervalLine(i, grid.interval_grid_size, grid.vertical_scale_position),
    });
  }

  for (let i = startB; i <= maxB; i += lineStep) {
    const a = gridPoint(basis, minA, i);
    const b = gridPoint(basis, maxA, i);
    lines.push({
      id: `oriedita-b-${i}`,
      a,
      b,
      major: isIntervalLine(i, grid.interval_grid_size, grid.horizontal_scale_position),
    });
  }

  if (grid.draw_diagonal_gridlines) {
    for (let i = minA - (offsetA + offsetB); i <= maxA; i += lineStep) {
      const a = gridPoint(basis, i, minB);
      lines.push({
        id: `oriedita-diagonal-a-${i}`,
        a,
        b: addPoints(a, scalePoint(basis.c, i - minA)),
        major: isIntervalLine(i + minB, grid.interval_grid_size, 0),
      });
    }
    for (let i = minB - (offsetA + offsetB); i <= maxB; i += lineStep) {
      const a = gridPoint(basis, maxA, i);
      lines.push({
        id: `oriedita-diagonal-b-${i}`,
        a,
        b: addPoints(a, scalePoint(basis.c, maxB - i)),
        major: isIntervalLine(i + maxA, grid.interval_grid_size, 0),
      });
    }
  }

  return lines;
}

export function closestOrieditaGridPoint(
  point: Point,
  grid: OristudioCpGridMetadata
): Point | null {
  const basis = getOrieditaGridBasis(grid);
  if (basis.baseState === 'hidden' || !hasValidGridBasis(basis)) return null;

  const searchRadius = basis.diagonalMax;
  const bounds = boundsFromMinMax(
    point.x - searchRadius,
    point.y - searchRadius,
    point.x + searchRadius,
    point.y + searchRadius
  );
  const { minA, maxA, minB, maxB } = gridIndexRange(bounds, basis);
  let bestPoint: Point | null = null;
  let bestDistance = searchRadius;

  for (let i = minA; i <= maxA; i += 1) {
    for (let j = minB; j <= maxB; j += 1) {
      const candidate = gridPoint(basis, i, j);
      if (basis.baseState === 'within-paper' && !isWithinOrieditaPaper(candidate)) continue;
      const candidateDistance = distance(point, candidate);
      if (candidateDistance <= bestDistance) {
        bestDistance = candidateDistance;
        bestPoint = candidate;
      }
    }
  }

  return bestPoint;
}

export function nearestCpSnapTarget(
  document: OristudioCpDocumentSnapshot,
  point: Point,
  bounds: CpModelBounds,
  options: OristudioCpViewportOptions,
  maxDistance = Math.max(bounds.spanX, bounds.spanY) * 0.015
): CpSnapTarget | null {
  let best: CpSnapTarget | null = null;
  const pointSnapDistance = maxDistance * POINT_SNAP_DISTANCE_MULTIPLIER;
  const consider = (target: CpSnapTarget, targetMaxDistance = maxDistance) => {
    if (target.distance > targetMaxDistance) return;
    if (!best || target.distance < best.distance) best = target;
  };

  if (options.snapToVertices) {
    document.crease_pattern.line_segments.forEach((segment, index) => {
      consider(
        pointTarget(segment.a, point, 'vertex', `line ${index + 1} start`),
        pointSnapDistance
      );
      consider(
        pointTarget(segment.b, point, 'vertex', `line ${index + 1} end`),
        pointSnapDistance
      );
    });
    document.crease_pattern.points.forEach((candidate, index) => {
      consider(pointTarget(candidate, point, 'point', `point ${index + 1}`), pointSnapDistance);
    });
    ORIEDITA_PAPER_CORNERS.forEach((corner) => {
      consider(pointTarget(corner.point, point, 'vertex', corner.label), pointSnapDistance);
    });
  }

  if (options.snapToLines) {
    document.crease_pattern.line_segments.forEach((segment, index) => {
      const projected = closestPointOnSegment(point, segment);
      consider(pointTarget(projected, point, 'line', `line ${index + 1}`));
    });
  }

  if (options.snapToGrid) {
    const grid = options.gridVisible
      ? visibleOrieditaGridMetadata(document.crease_pattern.grid)
      : document.crease_pattern.grid;
    const gridPoint = closestOrieditaGridPoint(point, grid);
    if (gridPoint) {
      consider(pointTarget(gridPoint, point, 'grid', 'grid'));
    }
  }

  return best;
}

export function nearestOrieditaDrawPointTarget(
  document: OristudioCpDocumentSnapshot,
  point: Point,
  bounds: CpModelBounds,
  options: OristudioCpViewportOptions,
  maxDistance = Math.max(bounds.spanX, bounds.spanY) * 0.015
): CpSnapTarget | null {
  let best: CpSnapTarget | null = null;
  const pointSnapDistance = maxDistance * POINT_SNAP_DISTANCE_MULTIPLIER;
  const consider = (target: CpSnapTarget, targetMaxDistance = maxDistance) => {
    if (target.distance > targetMaxDistance) return;
    if (!best || target.distance < best.distance) best = target;
  };

  if (options.snapToVertices) {
    document.crease_pattern.line_segments.forEach((segment, index) => {
      consider(
        pointTarget(segment.a, point, 'vertex', `line ${index + 1} start`),
        pointSnapDistance
      );
      consider(
        pointTarget(segment.b, point, 'vertex', `line ${index + 1} end`),
        pointSnapDistance
      );
    });
    document.crease_pattern.points.forEach((candidate, index) => {
      consider(pointTarget(candidate, point, 'point', `point ${index + 1}`), pointSnapDistance);
    });
    document.crease_pattern.circles.forEach((circle, index) => {
      consider(
        pointTarget({ x: circle.x, y: circle.y }, point, 'point', `circle ${index + 1} center`),
        pointSnapDistance
      );
    });
    ORIEDITA_PAPER_CORNERS.forEach((corner) => {
      consider(pointTarget(corner.point, point, 'vertex', corner.label), pointSnapDistance);
    });
  }

  if (options.snapToGrid) {
    const grid = options.gridVisible
      ? visibleOrieditaGridMetadata(document.crease_pattern.grid)
      : document.crease_pattern.grid;
    const gridPoint = closestOrieditaGridPoint(point, grid);
    if (gridPoint) {
      consider(pointTarget(gridPoint, point, 'grid', 'grid'));
    }
  }

  return best;
}

export function textCoordinate(value: number | { 0: number }): number {
  return typeof value === 'number' ? value : value[0];
}

function boundsFromMinMax(minX: number, minY: number, maxX: number, maxY: number): CpModelBounds {
  return {
    minX,
    minY,
    maxX,
    maxY,
    spanX: Math.max(DEFAULT_SPAN * 1e-6, maxX - minX),
    spanY: Math.max(DEFAULT_SPAN * 1e-6, maxY - minY),
  };
}

function pointsWithinOrieditaPaper(points: Point[]): boolean {
  return points.every(isWithinOrieditaPaper);
}

function isWithinOrieditaPaper(point: Point): boolean {
  return (
    point.x >= ORIEDITA_PAPER_MIN - GRID_EPSILON &&
    point.x <= ORIEDITA_PAPER_MAX + GRID_EPSILON &&
    point.y >= ORIEDITA_PAPER_MIN - GRID_EPSILON &&
    point.y <= ORIEDITA_PAPER_MAX + GRID_EPSILON
  );
}

function hasValidGridBasis(basis: OrieditaGridBasis): boolean {
  const determinant = basis.a.x * basis.b.y - basis.b.x * basis.a.y;
  return Math.abs(determinant) > GRID_EPSILON;
}

function gridDrawingBounds(
  bounds: CpModelBounds,
  basis: OrieditaGridBasis,
  renderOptions: CpGridRenderOptions
): CpModelBounds {
  if (basis.baseState !== 'full') return bounds;
  const canvasRect = renderOptions.canvasRect ?? CP_WORLD_RECT;
  const paperRect = renderOptions.paperRect ?? CP_PAPER_RECT;
  const points = [
    cpSvgPointToModel({ x: canvasRect.x, y: canvasRect.y }, bounds, paperRect),
    cpSvgPointToModel(
      { x: canvasRect.x + canvasRect.width, y: canvasRect.y },
      bounds,
      paperRect
    ),
    cpSvgPointToModel(
      { x: canvasRect.x, y: canvasRect.y + canvasRect.height },
      bounds,
      paperRect
    ),
    cpSvgPointToModel(
      { x: canvasRect.x + canvasRect.width, y: canvasRect.y + canvasRect.height },
      bounds,
      paperRect
    ),
  ];
  return boundsFromPoints(points);
}

function gridIndexRange(bounds: CpModelBounds, basis: OrieditaGridBasis) {
  const indices = [
    gridIndex({ x: bounds.minX, y: bounds.minY }, basis),
    gridIndex({ x: bounds.minX, y: bounds.maxY }, basis),
    gridIndex({ x: bounds.maxX, y: bounds.minY }, basis),
    gridIndex({ x: bounds.maxX, y: bounds.maxY }, basis),
  ];
  return {
    minA: floorGridIndex(Math.min(...indices.map((point) => point.x))),
    maxA: ceilGridIndex(Math.max(...indices.map((point) => point.x))),
    minB: floorGridIndex(Math.min(...indices.map((point) => point.y))),
    maxB: ceilGridIndex(Math.max(...indices.map((point) => point.y))),
  };
}

function boundsFromPoints(points: Point[]): CpModelBounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return boundsFromMinMax(minX, minY, maxX, maxY);
}

function gridIndex(point: Point, basis: OrieditaGridBasis): Point {
  const determinant = basis.a.x * basis.b.y - basis.b.x * basis.a.y;
  const x = point.x - basis.origin.x;
  const y = point.y - basis.origin.y;
  return {
    x: (basis.b.y / determinant) * x + (-basis.b.x / determinant) * y,
    y: (-basis.a.y / determinant) * x + (basis.a.x / determinant) * y,
  };
}

function gridPoint(basis: OrieditaGridBasis, aIndex: number, bIndex: number): Point {
  return addPoints(
    basis.origin,
    addPoints(scalePoint(basis.a, aIndex), scalePoint(basis.b, bIndex))
  );
}

function floorGridIndex(value: number): number {
  return Math.floor(value + GRID_EPSILON);
}

function ceilGridIndex(value: number): number {
  return Math.ceil(value - GRID_EPSILON);
}

function positiveModulo(value: number, modulo: number): number {
  const safeModulo = Math.max(1, Math.trunc(modulo));
  return ((value % safeModulo) + safeModulo) % safeModulo;
}

function quantizeCoordinate(value: number): string {
  return String(Math.round(value * 1e9));
}

function isIntervalLine(index: number, intervalSize: number, position: number): boolean {
  const interval = Math.max(1, Math.trunc(intervalSize));
  return positiveModulo(index, interval) === positiveModulo(position, interval);
}

function gridLineStep(
  minA: number,
  maxA: number,
  minB: number,
  maxB: number,
  includeDiagonals: boolean
): number {
  const baseCount = Math.max(0, maxA - minA + 1) + Math.max(0, maxB - minB + 1);
  const estimatedCount = includeDiagonals ? baseCount * 2 : baseCount;
  return Math.max(1, Math.ceil(estimatedCount / MAX_ORIEDITA_GRID_LINES));
}

function addPoints(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scalePoint(point: Point, scalar: number): Point {
  return { x: point.x * scalar, y: point.y * scalar };
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= GRID_EPSILON;
}

function pointTarget(
  candidate: Point,
  point: Point,
  kind: CpSnapTarget['kind'],
  label: string
): CpSnapTarget {
  return {
    point: candidate,
    kind,
    label,
    distance: distance(candidate, point),
  };
}

function closestPointOnSegment(point: Point, segment: OristudioCpLineSegment): Point {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return segment.a;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared)
  );
  return {
    x: segment.a.x + dx * t,
    y: segment.a.y + dy * t,
  };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
