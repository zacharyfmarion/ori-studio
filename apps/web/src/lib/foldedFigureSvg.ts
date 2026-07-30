import type {
  OristudioCpFoldedRenderGeometry,
  OristudioCpFoldedRenderPaint,
  OristudioCpFoldedRenderPathCommand,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedRenderStroke,
  OristudioCpRgbaColor,
} from '../engine/oristudioCpTypes';
import type { Point } from './geometry';
import { escapeXml } from './xmlEscape';

/**
 * SVG serialization of a folded-figure render snapshot.
 *
 * The kernel hands back declarative drawing primitives in crease-pattern
 * **model** coordinates, so they map onto SVG elements one for one — no
 * tessellation, unlike the WebGL canvas path in `cpFoldedToScene`, which has to
 * triangulate. That also means gradients survive as real `<linearGradient>`
 * defs here rather than collapsing to their start colour.
 */
export interface FoldedFigureSvgOptions {
  /** Model point → page coordinates. */
  project: (point: Point) => Point;
  /** Page units per model unit, for stroke widths and ellipse radii. */
  scale: number;
  /** Prefix for generated gradient ids, to keep two figures from colliding. */
  idPrefix?: string;
}

export interface FoldedFigureBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Steps used to flatten quadratic/cubic path curves when measuring bounds. */
const CURVE_STEPS = 12;
/** Stroke width (model units) for a primitive with no basic stroke. */
const DEFAULT_STROKE_WIDTH = 1;
/** Font size (page units at scale 1) for the kernel's text primitives. */
const TEXT_FONT_SIZE = 12;

function colorAttr(color: OristudioCpRgbaColor): { value: string; opacity: number } {
  const hex = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, '0');
  return {
    value: `#${hex(color.red)}${hex(color.green)}${hex(color.blue)}`,
    opacity: color.alpha / 255,
  };
}

function strokeWidth(stroke: OristudioCpFoldedRenderStroke): number {
  return stroke.kind === 'basic' ? stroke.width : DEFAULT_STROKE_WIDTH;
}

/** Every point a geometry touches, in model coordinates (curves flattened). */
function geometryPoints(geometry: OristudioCpFoldedRenderGeometry): Point[] {
  switch (geometry.kind) {
    case 'path':
      return pathPoints(geometry.commands);
    case 'segment':
      return [geometry.from, geometry.to];
    case 'polygon':
      return geometry.points;
    case 'rect':
    case 'ellipse':
      return [
        { x: geometry.x, y: geometry.y },
        { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
      ];
    case 'text':
      return [geometry.position];
    default:
      return [];
  }
}

function pathPoints(commands: readonly OristudioCpFoldedRenderPathCommand[]): Point[] {
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  for (const command of commands) {
    switch (command.command) {
      case 'move_to':
      case 'line_to':
        cursor = command.point;
        points.push(cursor);
        break;
      case 'quad_to':
        points.push(...flattenQuad(cursor, command.control, command.point));
        cursor = command.point;
        break;
      case 'cubic_to':
        points.push(...flattenCubic(cursor, command.control_1, command.control_2, command.point));
        cursor = command.point;
        break;
      case 'close':
        break;
    }
  }
  return points;
}

function flattenQuad(from: Point, control: Point, to: Point): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= CURVE_STEPS; i += 1) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push({
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    });
  }
  return out;
}

function flattenCubic(from: Point, c1: Point, c2: Point, to: Point): Point[] {
  const out: Point[] = [];
  for (let i = 1; i <= CURVE_STEPS; i += 1) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push({
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    });
  }
  return out;
}

/** Bounding box of a snapshot once projected. Null when it draws nothing. */
export function projectedFoldedFigureBounds(
  snapshot: OristudioCpFoldedRenderSnapshot,
  project: (point: Point) => Point
): FoldedFigureBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const primitive of snapshot.primitives) {
    if (!isDrawn(primitive)) continue;
    for (const point of geometryPoints(primitive.geometry)) {
      const projected = project(point);
      minX = Math.min(minX, projected.x);
      minY = Math.min(minY, projected.y);
      maxX = Math.max(maxX, projected.x);
      maxY = Math.max(maxY, projected.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function isDrawn(primitive: OristudioCpFoldedRenderPrimitive): boolean {
  const paint = primitive.style.paint;
  return paint.kind === 'color' || paint.kind === 'gradient';
}

function num(value: number): string {
  return value.toFixed(2);
}

/**
 * Serialize a folded figure to SVG elements (no wrapping `<svg>`), ready to drop
 * into an export page. Texture and unrecognized paints are skipped, matching the
 * canvas renderer.
 */
export function foldedFigureSvgBody(
  snapshot: OristudioCpFoldedRenderSnapshot,
  options: FoldedFigureSvgOptions
): string {
  const { project, scale } = options;
  const prefix = options.idPrefix ?? 'folded';
  const defs: string[] = [];
  const elements: string[] = [];
  const primitives = [...snapshot.primitives].sort((l, r) => l.sequence - r.sequence);

  primitives.forEach((primitive, index) => {
    if (!isDrawn(primitive)) return;
    const paint = paintAttr(primitive.style.paint, `${prefix}-${index}`, project, defs);
    if (!paint) return;
    const isFill = primitive.kind.startsWith('fill_');
    const style = isFill
      ? `fill="${paint.value}"${paint.opacity < 1 ? ` fill-opacity="${num(paint.opacity)}"` : ''} stroke="none"`
      : `fill="none" stroke="${paint.value}"${paint.opacity < 1 ? ` stroke-opacity="${num(paint.opacity)}"` : ''} stroke-width="${num(Math.max(0.4, strokeWidth(primitive.style.stroke) * scale))}" stroke-linecap="round" stroke-linejoin="round"`;
    const element = geometryElement(primitive.geometry, style, project, scale);
    if (element) elements.push(element);
  });

  const body = elements.join('\n');
  return defs.length > 0 ? `  <defs>\n${defs.join('\n')}\n  </defs>\n${body}` : body;
}

function paintAttr(
  paint: OristudioCpFoldedRenderPaint,
  id: string,
  project: (point: Point) => Point,
  defs: string[]
): { value: string; opacity: number } | null {
  if (paint.kind === 'color') return colorAttr(paint.color);
  if (paint.kind !== 'gradient') return null;

  const from = project(paint.from);
  const to = project(paint.to);
  const start = colorAttr(paint.from_color);
  const end = colorAttr(paint.to_color);
  defs.push(
    `    <linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(from.x)}" y1="${num(from.y)}" x2="${num(to.x)}" y2="${num(to.y)}"${paint.cyclic ? ' spreadMethod="reflect"' : ''}>` +
      `<stop offset="0" stop-color="${start.value}" stop-opacity="${num(start.opacity)}"/>` +
      `<stop offset="1" stop-color="${end.value}" stop-opacity="${num(end.opacity)}"/>` +
      `</linearGradient>`
  );
  return { value: `url(#${id})`, opacity: 1 };
}

function geometryElement(
  geometry: OristudioCpFoldedRenderGeometry,
  style: string,
  project: (point: Point) => Point,
  scale: number
): string | null {
  switch (geometry.kind) {
    case 'path': {
      const d = pathData(geometry.commands, project);
      return d ? `  <path d="${d}" ${style}/>` : null;
    }
    case 'segment': {
      const a = project(geometry.from);
      const b = project(geometry.to);
      return `  <line x1="${num(a.x)}" y1="${num(a.y)}" x2="${num(b.x)}" y2="${num(b.y)}" ${style}/>`;
    }
    case 'polygon': {
      if (geometry.points.length === 0) return null;
      const points = geometry.points
        .map(project)
        .map((point) => `${num(point.x)},${num(point.y)}`)
        .join(' ');
      const tag = style.startsWith('fill="none"') ? 'polyline' : 'polygon';
      return `  <${tag} points="${points}" ${style}/>`;
    }
    case 'rect': {
      const a = project({ x: geometry.x, y: geometry.y });
      const b = project({ x: geometry.x + geometry.width, y: geometry.y + geometry.height });
      return `  <rect x="${num(Math.min(a.x, b.x))}" y="${num(Math.min(a.y, b.y))}" width="${num(Math.abs(b.x - a.x))}" height="${num(Math.abs(b.y - a.y))}" ${style}/>`;
    }
    case 'ellipse': {
      const center = project({
        x: geometry.x + geometry.width / 2,
        y: geometry.y + geometry.height / 2,
      });
      return `  <ellipse cx="${num(center.x)}" cy="${num(center.y)}" rx="${num(Math.abs(geometry.width / 2) * scale)}" ry="${num(Math.abs(geometry.height / 2) * scale)}" ${style}/>`;
    }
    case 'text': {
      const at = project(geometry.position);
      return `  <text x="${num(at.x)}" y="${num(at.y)}" font-size="${num(TEXT_FONT_SIZE * scale)}" ${style}>${escapeXml(geometry.value)}</text>`;
    }
    default:
      return null;
  }
}

function pathData(
  commands: readonly OristudioCpFoldedRenderPathCommand[],
  project: (point: Point) => Point
): string {
  const parts: string[] = [];
  for (const command of commands) {
    switch (command.command) {
      case 'move_to': {
        const p = project(command.point);
        parts.push(`M ${num(p.x)} ${num(p.y)}`);
        break;
      }
      case 'line_to': {
        const p = project(command.point);
        parts.push(`L ${num(p.x)} ${num(p.y)}`);
        break;
      }
      case 'quad_to': {
        const c = project(command.control);
        const p = project(command.point);
        parts.push(`Q ${num(c.x)} ${num(c.y)} ${num(p.x)} ${num(p.y)}`);
        break;
      }
      case 'cubic_to': {
        const c1 = project(command.control_1);
        const c2 = project(command.control_2);
        const p = project(command.point);
        parts.push(`C ${num(c1.x)} ${num(c1.y)} ${num(c2.x)} ${num(c2.y)} ${num(p.x)} ${num(p.y)}`);
        break;
      }
      case 'close':
        parts.push('Z');
        break;
    }
  }
  return parts.join(' ');
}
