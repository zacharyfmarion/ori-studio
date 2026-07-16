import type {
  OristudioBpFlap,
  OristudioBpGraphicPrimitive,
  OristudioBpPackingView,
  OristudioBpSheet,
} from '../engine/oristudioBpTypes';
import type { PlotRect, Point } from './geometry';

export const BP_PACKING_VIEWBOX_SIZE = 720;
export const BP_PACKING_BASE_WORLD_RECT: PlotRect = {
  x: 0,
  y: 0,
  width: BP_PACKING_VIEWBOX_SIZE,
  height: BP_PACKING_VIEWBOX_SIZE,
};

const BASE_SHEET_RECT: PlotRect = { x: 54, y: 54, width: 612, height: 612 };
const SHADOW_INSET = 10;
const WORLD_PADDING = 44;
const LABEL_HEIGHT = 22;

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BpPackingGridLine {
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

function includePoints(bounds: Bounds, points: readonly Point[]): void {
  for (const point of points) includePoint(bounds, point);
}

function labelWidth(text: string, characterWidth: number): number {
  return Math.max(18, text.length * characterWidth) + 12;
}

export function bpPackingPaperRect(sheet: OristudioBpSheet): PlotRect {
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

export function bpPackingShadowRect(sheet: OristudioBpSheet): PlotRect {
  const rect = bpPackingPaperRect(sheet);
  return {
    x: rect.x - SHADOW_INSET,
    y: rect.y - SHADOW_INSET,
    width: rect.width + SHADOW_INSET * 2,
    height: rect.height + SHADOW_INSET * 2,
  };
}

export function bpPackingPointToSvg(
  point: Point,
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): Point {
  return {
    x: rect.x + (point.x / Math.max(1, sheet.width)) * rect.width,
    y: rect.y + rect.height - (point.y / Math.max(1, sheet.height)) * rect.height,
  };
}

export function bpPackingUnitToSvg(
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): number {
  return rect.width / Math.max(1, sheet.width);
}

export function bpPackingRectToSvg(
  rect: { x: number; y: number; width: number; height: number },
  sheet: OristudioBpSheet,
  paperRect = bpPackingPaperRect(sheet)
): PlotRect {
  const bottomLeft = bpPackingPointToSvg({ x: rect.x, y: rect.y }, sheet, paperRect);
  const unit = bpPackingUnitToSvg(sheet, paperRect);
  return {
    x: bottomLeft.x,
    y: bottomLeft.y - rect.height * unit,
    width: rect.width * unit,
    height: rect.height * unit,
  };
}

export function constrainBpPackingFlapTarget(
  flap: OristudioBpFlap,
  target: Point,
  sheet: OristudioBpSheet
): Point {
  const vector = {
    x: target.x - flap.anchor.x,
    y: target.y - flap.anchor.y,
  };
  const fix = constrainFlap(
    (point) => constrainBpPackingPoint(point, sheet),
    flap.anchor,
    flap.width,
    flap.height,
    vector
  );
  return {
    x: flap.anchor.x + fix.x,
    y: flap.anchor.y + fix.y,
  };
}

export function constrainBpPackingFlapGroupTarget(
  flaps: OristudioBpFlap[],
  reference: OristudioBpFlap,
  target: Point,
  sheet: OristudioBpSheet
): { loc: Point; vector: Point } {
  const vector = {
    x: target.x - reference.anchor.x,
    y: target.y - reference.anchor.y,
  };
  const fix = flaps.reduce(
    (current, flap) =>
      constrainFlap(
        (point) => constrainBpPackingPoint(point, sheet),
        flap.anchor,
        flap.width,
        flap.height,
        current
      ),
    vector
  );
  return {
    loc: {
      x: reference.anchor.x + fix.x,
      y: reference.anchor.y + fix.y,
    },
    vector: fix,
  };
}

export function constrainBpPackingPoint(point: Point, sheet: OristudioBpSheet): Point {
  if (sheet.kind === 'diagonal') return diagonalConstrain(sheet.width, point);
  return {
    x: Math.min(Math.max(0, point.x), Math.max(0, sheet.width)),
    y: Math.min(Math.max(0, point.y), Math.max(0, sheet.height)),
  };
}

function constrainFlap(
  constrain: (point: Point) => Point,
  location: Point,
  width: number,
  height: number,
  vector: Point
): Point {
  const zeroWidth = width === 0;
  const zeroHeight = height === 0;
  if (zeroWidth && zeroHeight) return fixVector(constrain, location, vector);
  if (zeroWidth || zeroHeight) {
    const fixed = fixVector(constrain, location, vector);
    const point = zeroWidth
      ? { x: location.x, y: location.y + height }
      : { x: location.x + width, y: location.y };
    return fixVector(constrain, point, fixed);
  }
  const data = flapDots(location, width, height)
    .map((point) => {
      const fix = fixVector(constrain, point, vector);
      const dx = fix.x - vector.x;
      const dy = fix.y - vector.y;
      return { point, distance: dx * dx + dy * dy, fix };
    })
    .filter((entry) => entry.distance > 0)
    .sort((a, b) => b.distance - a.distance);
  if (data.length <= 1) return vector;
  let result = data[1].fix;
  if (data[2]) result = fixVector(constrain, data[2].point, result);
  if (data[3]) result = fixVector(constrain, data[3].point, result);
  return result;
}

function fixVector(constrain: (point: Point) => Point, point: Point, vector: Point): Point {
  const target = { x: point.x + vector.x, y: point.y + vector.y };
  const fix = constrain(target);
  return { x: fix.x - point.x, y: fix.y - point.y };
}

function flapDots(location: Point, width: number, height: number): Point[] {
  return [
    { x: location.x + width, y: location.y + height },
    { x: location.x, y: location.y + height },
    location,
    { x: location.x + width, y: location.y },
  ];
}

function diagonalConstrain(width: number, point: Point): Point {
  let { x, y } = point;
  const size = width;
  const h = size % 2;
  const f = (size - h) / 2;
  const c = (size + h) / 2;
  if (x + y < f) {
    const d = f - x - y;
    x += Math.floor(d / 2);
    y += Math.ceil(d / 2);
  }
  if (y - x > c) {
    const d = y - x - c;
    x += Math.floor(d / 2);
    y -= Math.ceil(d / 2);
  }
  if (x - y > c) {
    const d = x - y - c;
    x -= Math.floor(d / 2);
    y += Math.ceil(d / 2);
  }
  if (x + y > c + size) {
    const d = x + y - c - size;
    x -= Math.floor(d / 2);
    y -= Math.ceil(d / 2);
  }
  if (x < 0) x = 0;
  if (x > size) x = size;
  return { x, y };
}

export function bpPackingGridLines(
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): BpPackingGridLine[] {
  const lines: BpPackingGridLine[] = [];
  const interval = Math.max(1, sheet.grid.interval || 1);
  for (let x = 0; x <= sheet.width; x += interval) {
    const from = bpPackingPointToSvg({ x, y: 0 }, sheet, rect);
    const to = bpPackingPointToSvg({ x, y: sheet.height }, sheet, rect);
    lines.push({ id: `x:${x}`, kind: x === 0 || x === sheet.width ? 'major' : 'minor', from, to });
  }
  for (let y = 0; y <= sheet.height; y += interval) {
    const from = bpPackingPointToSvg({ x: 0, y }, sheet, rect);
    const to = bpPackingPointToSvg({ x: sheet.width, y }, sheet, rect);
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
        from: bpPackingPointToSvg({ x: startX, y: startY }, sheet, rect),
        to: bpPackingPointToSvg({ x: endX, y: endY }, sheet, rect),
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
        from: bpPackingPointToSvg({ x: startX, y: startY }, sheet, rect),
        to: bpPackingPointToSvg({ x: endX, y: endY }, sheet, rect),
      });
    }
  }
  return lines;
}

export function getBpPackingWorldRect(packing: OristudioBpPackingView): PlotRect {
  const paperRect = bpPackingPaperRect(packing.sheet);
  const shadowRect = bpPackingShadowRect(packing.sheet);
  const bounds: Bounds = {
    minX: BP_PACKING_BASE_WORLD_RECT.x,
    minY: BP_PACKING_BASE_WORLD_RECT.y,
    maxX: BP_PACKING_BASE_WORLD_RECT.x + BP_PACKING_BASE_WORLD_RECT.width,
    maxY: BP_PACKING_BASE_WORLD_RECT.y + BP_PACKING_BASE_WORLD_RECT.height,
  };

  includeRect(bounds, shadowRect);
  includeRect(bounds, paperRect);

  for (const flap of packing.flaps) {
    const rect = bpPackingRectToSvg(
      { x: flap.anchor.x, y: flap.anchor.y, width: flap.width, height: flap.height },
      packing.sheet,
      paperRect
    );
    includeRect(bounds, rect);
    includeRect(bounds, {
      x: rect.x + rect.width / 2 + 8,
      y: rect.y + rect.height / 2 - LABEL_HEIGHT / 2,
      width: labelWidth(flap.name || String(flap.id), 8),
      height: LABEL_HEIGHT,
    });
  }

  for (const junction of packing.invalidJunctions) {
    for (const polygon of junction.polygons) {
      includePoints(
        bounds,
        polygon.map((point) => bpPackingPointToSvg(point, packing.sheet, paperRect))
      );
    }
  }

  for (const primitive of packing.graphics) includePrimitive(bounds, primitive, packing.sheet, paperRect);

  return {
    x: bounds.minX - WORLD_PADDING,
    y: bounds.minY - WORLD_PADDING,
    width: bounds.maxX - bounds.minX + WORLD_PADDING * 2,
    height: bounds.maxY - bounds.minY + WORLD_PADDING * 2,
  };
}

function includePrimitive(
  bounds: Bounds,
  primitive: OristudioBpGraphicPrimitive,
  sheet: OristudioBpSheet,
  paperRect: PlotRect
): void {
  if (primitive.kind === 'line') {
    includePoints(bounds, primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect)));
    return;
  }
  if (primitive.kind === 'polyline' || primitive.kind === 'polygon') {
    includePoints(bounds, primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect)));
    return;
  }
  if (primitive.kind === 'circle') {
    const center = bpPackingPointToSvg(primitive.center, sheet, paperRect);
    const radius = primitive.radius * bpPackingUnitToSvg(sheet, paperRect);
    includeRect(bounds, {
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2,
    });
    return;
  }
  includePoint(bounds, bpPackingPointToSvg(primitive.loc, sheet, paperRect));
}
