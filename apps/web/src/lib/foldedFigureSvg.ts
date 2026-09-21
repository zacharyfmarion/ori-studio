import type {
  OristudioCpFoldedRenderGeometry,
  OristudioCpFoldedRenderPaint,
  OristudioCpFoldedRenderPathCommand,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedRenderStroke,
  OristudioCpRgbaColor,
} from '../engine/oristudioCpTypes';
import { shadowLedgeHeight, shadowSvgBands } from '../cp-workspace/folded/foldedShadowProfile';
import type { Point } from './geometry';
import { escapeXml } from './xmlEscape';

/**
 * SVG serialization of a folded-figure render snapshot.
 *
 * The kernel hands back declarative drawing primitives in crease-pattern
 * **model** coordinates, so they map onto SVG elements one for one — no
 * tessellation, unlike the WebGL canvas path in `cpFoldedToScene`, which has to
 * triangulate. A layer shadow is the one primitive with no direct element: it
 * becomes the casting outline, stroked, dilated and blurred into the occlusion
 * curve, clipped to the paper it falls on — the same curve the canvas
 * evaluates, see `foldedShadowProfile`.
 */
export interface FoldedFigureSvgOptions {
  /** Model point → page coordinates. */
  project: (point: Point) => Point;
  /** Page units per model unit, for stroke widths and ellipse radii. */
  scale: number;
  /** Prefix for generated def ids, to keep two figures from colliding. */
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
  return paint.kind === 'color' || paint.kind === 'layer_shadow';
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
    if (primitive.style.paint.kind === 'layer_shadow') {
      const element = layerShadowElement(
        primitive,
        primitive.style.paint,
        `${prefix}-${index}`,
        project,
        scale,
        defs
      );
      if (element) elements.push(element);
      return;
    }
    const paint = paintAttr(primitive.style.paint);
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
  paint: OristudioCpFoldedRenderPaint
): { value: string; opacity: number } | null {
  return paint.kind === 'color' ? colorAttr(paint.color) : null;
}

/**
 * A layer shadow: the casting outline stroked with round caps, turned into the
 * occlusion curve by a filter, clipped to the receiving paper — one stroke
 * and filter per ledge height, since the curve scales with the height.
 *
 * The filter is the profile's definition drawn literally: the stroke's alpha
 * is the innermost band; each wider band is that alpha dilated out to its
 * half-width; every band is Gaussian-blurred by its σ; the bands are summed
 * with their weights by arithmetic compositing (plain stacking would
 * multiply them instead), and the sum inks black at the contact darkness.
 * Along a straight edge that is exactly what the canvas evaluates.
 *
 * The filter region is given explicitly, in page units: the default is the
 * element's box plus ten per cent, which for a short outline is narrower than
 * the blur it has to hold.
 */
function layerShadowElement(
  primitive: OristudioCpFoldedRenderPrimitive,
  paint: Extract<OristudioCpFoldedRenderPaint, { kind: 'layer_shadow' }>,
  id: string,
  project: (point: Point) => Point,
  scale: number,
  defs: string[]
): string | null {
  if (primitive.geometry.kind !== 'path' || paint.occluder_edges.length === 0) return null;
  const receiver = pathData(primitive.geometry.commands, project);
  if (!receiver) return null;

  const byStep = new Map<number, { outline: string[]; bounds: FoldedFigureBounds }>();
  for (const edge of paint.occluder_edges) {
    const step = Math.max(1, Math.round(edge.step));
    const a = project(edge.from);
    const b = project(edge.to);
    let group = byStep.get(step);
    if (!group) {
      group = { outline: [], bounds: { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity } };
      byStep.set(step, group);
    }
    for (const p of [a, b]) {
      group.bounds.minX = Math.min(group.bounds.minX, p.x);
      group.bounds.minY = Math.min(group.bounds.minY, p.y);
      group.bounds.maxX = Math.max(group.bounds.maxX, p.x);
      group.bounds.maxY = Math.max(group.bounds.maxY, p.y);
    }
    group.outline.push(`M ${num(a.x)} ${num(a.y)} L ${num(b.x)} ${num(b.y)}`);
  }

  const strokes: string[] = [];
  for (const [step, group] of [...byStep].sort(([l], [r]) => l - r)) {
    const height = shadowLedgeHeight(step, paint.sheet_thickness * scale);
    const shadow = shadowSvgBands(height, paint.strength);
    if (!(shadow.strokeWidth > 0) || !(shadow.opacity > 0)) continue;
    // Everything the widest blurred band can reach: its half-width plus three sigma.
    const margin = Math.max(
      ...shadow.bands.map((band) => shadow.strokeWidth / 2 + band.dilateRadius + 3 * band.stdDeviation)
    );
    const filterId = `${id}-occlusion-${step}`;
    const stages: string[] = [];
    const bandResults: string[] = [];
    shadow.bands.forEach((band, index) => {
      const spread = `band${index}`;
      const source =
        band.dilateRadius > 0
          ? (stages.push(
              `<feMorphology in="SourceAlpha" operator="dilate" radius="${num(band.dilateRadius)}" result="${spread}-wide"/>`
            ),
            `${spread}-wide`)
          : 'SourceAlpha';
      stages.push(
        `<feGaussianBlur in="${source}" stdDeviation="${num(band.stdDeviation)}" result="${spread}"/>`
      );
      bandResults.push(spread);
    });
    // sum = w0·band0 + w1·band1 (+ w2·band2 …), one arithmetic composite per band after the first.
    let acc = bandResults[0];
    shadow.bands.forEach((band, index) => {
      if (index === 0) return;
      const k2 = index === 1 ? num(shadow.bands[0].weight) : '1.00';
      stages.push(
        `<feComposite in="${acc}" in2="${bandResults[index]}" operator="arithmetic" k1="0" k2="${k2}" k3="${num(band.weight)}" k4="0" result="sum${index}"/>`
      );
      acc = `sum${index}`;
    });
    stages.push(
      `<feFlood flood-color="#000000" flood-opacity="${num(shadow.opacity)}" result="ink"/>`,
      `<feComposite in="ink" in2="${acc}" operator="in"/>`
    );
    defs.push(
      `    <filter id="${filterId}" filterUnits="userSpaceOnUse" x="${num(group.bounds.minX - margin)}" y="${num(group.bounds.minY - margin)}" width="${num(group.bounds.maxX - group.bounds.minX + 2 * margin)}" height="${num(group.bounds.maxY - group.bounds.minY + 2 * margin)}" color-interpolation-filters="sRGB">${stages.join('')}</filter>`
    );
    strokes.push(
      `<path d="${group.outline.join(' ')}" fill="none" stroke="#000000" stroke-width="${num(shadow.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round" filter="url(#${filterId})"/>`
    );
  }
  if (strokes.length === 0) return null;
  defs.push(`    <clipPath id="${id}-paper"><path d="${receiver}"/></clipPath>`);
  return `  <g clip-path="url(#${id}-paper)">${strokes.join('')}</g>`;
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
