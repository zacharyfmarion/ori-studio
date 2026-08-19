import type {
  OristudioBpSheet,
  OristudioBpTreeView,
  OristudioBpTreeVertex,
} from '../engine/oristudioBpTypes';
import { bpFlapLabel } from './bpFlapLabel';
import type { PlotRect, Point } from './geometry';

export const BP_TREE_VIEWBOX_SIZE = 720;
export const BP_TREE_BASE_WORLD_RECT: PlotRect = {
  x: 0,
  y: 0,
  width: BP_TREE_VIEWBOX_SIZE,
  height: BP_TREE_VIEWBOX_SIZE,
};

const BASE_SHEET_RECT: PlotRect = { x: 66, y: 54, width: 588, height: 588 };
const SHADOW_INSET = 10;
const WORLD_PADDING = 42;
const NODE_RADIUS = 8;
const LEAF_CIRCLE_MIN_RADIUS = 22;
const LABEL_HEIGHT = 22;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BpTreeViewportOptions {
  vertexLocations?: ReadonlyMap<number, Point>;
  padding?: number;
  /**
   * Fit to the tree nodes only (not the whole paper sheet), so a unit-length
   * edge renders at a comfortable size. A minimum extent keeps a tiny tree from
   * zooming in absurdly.
   */
  contentOnly?: boolean;
  minExtent?: number;
}

// ~1.5 sheet units of context (the sheet maps to 588 SVG units ≈ 29/unit), so a
// unit-length edge fills a good part of the view instead of rendering tiny.
const CONTENT_MIN_EXTENT = 44;

export interface BpTreeGridLine {
  id: string;
  kind: 'major' | 'minor' | 'diagonal';
  from: Point;
  to: Point;
}

function includePoint(bounds: Bounds, point: Point): void {
  bounds.minX = Math.min(bounds.minX, point.x);
  bounds.minY = Math.min(bounds.minY, point.y);
  bounds.maxX = Math.max(bounds.maxX, point.x);
  bounds.maxY = Math.max(bounds.maxY, point.y);
}

function includeRect(bounds: Bounds, rect: PlotRect): void {
  includePoint(bounds, { x: rect.x, y: rect.y });
  includePoint(bounds, { x: rect.x + rect.width, y: rect.y + rect.height });
}

function includeCircle(bounds: Bounds, center: Point, radius: number): void {
  includeRect(bounds, {
    x: center.x - radius,
    y: center.y - radius,
    width: radius * 2,
    height: radius * 2,
  });
}

function labelWidth(text: string, characterWidth: number): number {
  return Math.max(18, text.length * characterWidth) + 12;
}

export function bpTreePaperRect(sheet: OristudioBpSheet): PlotRect {
  const width = Math.max(1, sheet.width);
  const height = Math.max(1, sheet.height);
  const scale = Math.min(BASE_SHEET_RECT.width / width, BASE_SHEET_RECT.height / height);
  const rectWidth = width * scale;
  const rectHeight = height * scale;
  return {
    x: BASE_SHEET_RECT.x + (BASE_SHEET_RECT.width - rectWidth) / 2,
    y: BASE_SHEET_RECT.y + (BASE_SHEET_RECT.height - rectHeight) / 2,
    width: rectWidth,
    height: rectHeight,
  };
}

export function bpTreeShadowRect(sheet: OristudioBpSheet): PlotRect {
  const rect = bpTreePaperRect(sheet);
  return {
    x: rect.x - SHADOW_INSET,
    y: rect.y - SHADOW_INSET,
    width: rect.width + SHADOW_INSET * 2,
    height: rect.height + SHADOW_INSET * 2,
  };
}

export function bpTreePointToSvg(
  point: Point,
  sheet: OristudioBpSheet,
  rect = bpTreePaperRect(sheet),
): Point {
  return {
    x: rect.x + (point.x / Math.max(1, sheet.width)) * rect.width,
    y: rect.y + rect.height - (point.y / Math.max(1, sheet.height)) * rect.height,
  };
}

export function svgToBpTreePoint(
  point: Point,
  sheet: OristudioBpSheet,
  rect = bpTreePaperRect(sheet),
): Point {
  return constrainBpTreePoint(
    {
      x: ((point.x - rect.x) / rect.width) * Math.max(1, sheet.width),
      y: ((rect.y + rect.height - point.y) / rect.height) * Math.max(1, sheet.height),
    },
    sheet,
  );
}

export function constrainBpTreePoint(point: Point, sheet: OristudioBpSheet): Point {
  // Clamp to the sheet bounds without snapping to the grid — the BP tree editor
  // uses continuous coordinates so leaves can sit at any angle around a parent.
  const x = Math.min(Math.max(0, point.x), Math.max(0, sheet.width));
  const y = Math.min(Math.max(0, point.y), Math.max(0, sheet.height));
  return { x, y };
}

export function bpTreeUnitToSvg(sheet: OristudioBpSheet, rect = bpTreePaperRect(sheet)): number {
  return rect.width / Math.max(1, sheet.width);
}

export function bpTreeLeafCircleRadius(
  tree: OristudioBpTreeView,
  vertexId: number,
  rect = bpTreePaperRect(tree.sheet),
): number {
  const incidentEdge = tree.edges.find((edge) => edge.vertices.includes(vertexId));
  const unit = bpTreeUnitToSvg(tree.sheet, rect);
  return Math.max(LEAF_CIRCLE_MIN_RADIUS, (incidentEdge?.length ?? 1) * unit);
}

export function bpTreeGridLines(
  sheet: OristudioBpSheet,
  rect = bpTreePaperRect(sheet),
): BpTreeGridLine[] {
  const lines: BpTreeGridLine[] = [];
  const interval = Math.max(1, sheet.grid.interval || 1);
  for (let x = 0; x <= sheet.width; x += interval) {
    const from = bpTreePointToSvg({ x, y: 0 }, sheet, rect);
    const to = bpTreePointToSvg({ x, y: sheet.height }, sheet, rect);
    lines.push({ id: `x:${x}`, kind: x === 0 || x === sheet.width ? 'major' : 'minor', from, to });
  }
  for (let y = 0; y <= sheet.height; y += interval) {
    const from = bpTreePointToSvg({ x: 0, y }, sheet, rect);
    const to = bpTreePointToSvg({ x: sheet.width, y }, sheet, rect);
    lines.push({ id: `y:${y}`, kind: y === 0 || y === sheet.height ? 'major' : 'minor', from, to });
  }
  if (sheet.grid.kind === 'diagonal') {
    for (let x = -sheet.height; x <= sheet.width; x += interval) {
      const startX = Math.max(0, x);
      const startY = Math.max(0, -x);
      const endX = Math.min(sheet.width, x + sheet.height);
      const endY = Math.min(sheet.height, sheet.width - x);
      lines.push({
        id: `d1:${x}`,
        kind: 'diagonal',
        from: bpTreePointToSvg({ x: startX, y: startY }, sheet, rect),
        to: bpTreePointToSvg({ x: endX, y: endY }, sheet, rect),
      });
    }
    for (let x = 0; x <= sheet.width + sheet.height; x += interval) {
      const startX = Math.max(0, x - sheet.height);
      const startY = Math.min(sheet.height, x);
      const endX = Math.min(sheet.width, x);
      const endY = Math.max(0, x - sheet.width);
      lines.push({
        id: `d2:${x}`,
        kind: 'diagonal',
        from: bpTreePointToSvg({ x: startX, y: startY }, sheet, rect),
        to: bpTreePointToSvg({ x: endX, y: endY }, sheet, rect),
      });
    }
  }
  return lines;
}

/**
 * The world the box-pleat tree camera frames: the sheet and its margin, and
 * nothing about what has been drawn on it.
 *
 * Fixed on purpose. A world computed from the drawing's own bounds resizes the
 * SVG under a camera transform that does not, so every added node nudges the
 * whole drawing on screen — the view moving as a side effect of an edit. The
 * sheet is the natural fixed extent here, the same role ExplOri's centred square
 * plays on a surface that has no sheet.
 */
export function bpTreeSheetWorldRect(sheet: OristudioBpSheet): PlotRect {
  const bounds: Bounds = {
    minX: BP_TREE_BASE_WORLD_RECT.x,
    minY: BP_TREE_BASE_WORLD_RECT.y,
    maxX: BP_TREE_BASE_WORLD_RECT.x + BP_TREE_BASE_WORLD_RECT.width,
    maxY: BP_TREE_BASE_WORLD_RECT.y + BP_TREE_BASE_WORLD_RECT.height,
  };
  includeRect(bounds, bpTreeShadowRect(sheet));
  includeRect(bounds, bpTreePaperRect(sheet));
  return {
    x: bounds.minX - WORLD_PADDING,
    y: bounds.minY - WORLD_PADDING,
    width: bounds.maxX - bounds.minX + WORLD_PADDING * 2,
    height: bounds.maxY - bounds.minY + WORLD_PADDING * 2,
  };
}

export function getBpTreeWorldRect(
  tree: OristudioBpTreeView,
  options: BpTreeViewportOptions = {},
): PlotRect {
  const paperRect = bpTreePaperRect(tree.sheet);
  const shadowRect = bpTreeShadowRect(tree.sheet);
  const bounds: Bounds = options.contentOnly
    ? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    : {
        minX: BP_TREE_BASE_WORLD_RECT.x,
        minY: BP_TREE_BASE_WORLD_RECT.y,
        maxX: BP_TREE_BASE_WORLD_RECT.x + BP_TREE_BASE_WORLD_RECT.width,
        maxY: BP_TREE_BASE_WORLD_RECT.y + BP_TREE_BASE_WORLD_RECT.height,
      };

  if (!options.contentOnly) {
    includeRect(bounds, shadowRect);
    includeRect(bounds, paperRect);
  }

  for (const vertex of tree.vertices) {
    const point = bpTreePointToSvg(vertexLoc(vertex, options), tree.sheet, paperRect);
    includeCircle(bounds, point, NODE_RADIUS);
    const label = bpTreeVertexLabel(vertex);
    if (label) {
      includeRect(bounds, {
        x: point.x + 8,
        y: point.y - LABEL_HEIGHT / 2,
        width: labelWidth(label, 8.2),
        height: LABEL_HEIGHT,
      });
    }
  }

  for (const edge of tree.edges) {
    const a = tree.vertices.find((vertex) => vertex.id === edge.vertices[0]);
    const b = tree.vertices.find((vertex) => vertex.id === edge.vertices[1]);
    if (!a || !b) continue;
    const p1 = bpTreePointToSvg(vertexLoc(a, options), tree.sheet, paperRect);
    const p2 = bpTreePointToSvg(vertexLoc(b, options), tree.sheet, paperRect);
    includeRect(bounds, {
      x: (p1.x + p2.x) / 2 + 6,
      y: (p1.y + p2.y) / 2 - 22,
      width: labelWidth(String(edge.length), 7.2),
      height: LABEL_HEIGHT,
    });
  }

  if (options.contentOnly && Number.isFinite(bounds.minX)) {
    // Enforce a minimum span around the node bounds so a tiny tree isn't
    // over-zoomed; a larger tree keeps its natural bounds.
    const minExtent = options.minExtent ?? CONTENT_MIN_EXTENT;
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    if (bounds.maxX - bounds.minX < minExtent) {
      bounds.minX = centerX - minExtent / 2;
      bounds.maxX = centerX + minExtent / 2;
    }
    if (bounds.maxY - bounds.minY < minExtent) {
      bounds.minY = centerY - minExtent / 2;
      bounds.maxY = centerY + minExtent / 2;
    }
  }

  const padding = options.padding ?? WORLD_PADDING;
  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
  };
}

export function bpTreeVertexLabel(vertex: OristudioBpTreeVertex): string {
  return bpFlapLabel(vertex.id, vertex.name);
}

function vertexLoc(vertex: OristudioBpTreeVertex, options: BpTreeViewportOptions): Point {
  return options.vertexLocations?.get(vertex.id) ?? vertex.loc;
}
