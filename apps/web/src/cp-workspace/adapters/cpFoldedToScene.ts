import earcut from 'earcut';
import { modelPointToCpSvg, ORIEDITA_PAPER_BOUNDS } from '../../lib/creasePatternViewport';
import type { Point } from '../../lib/geometry';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedRenderGeometry,
  OristudioCpFoldedRenderPaint,
  OristudioCpFoldedRenderPathCommand,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderStroke,
  OristudioCpRgbaColor,
} from '../../engine/oristudioCpTypes';
import type { Aabb } from '../picking/lineHitIndex';
import type { FillGeometry, FoldedGeometry, Rgba } from '../renderer/types';

/** Steps used to flatten quadratic/cubic path curves into polylines. */
const CURVE_STEPS = 12;
/** Points used to tessellate an ellipse. */
const ELLIPSE_STEPS = 48;
/** Default stroke width (user px) when a primitive has no basic stroke. */
const DEFAULT_STROKE_WIDTH = 1;

function normColor(c: OristudioCpRgbaColor): Rgba {
  return [c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255];
}

function paintColor(paint: OristudioCpFoldedRenderPaint): Rgba | null {
  if (paint.kind === 'color') return normColor(paint.color);
  // Gradients are approximated by their start colour for now.
  if (paint.kind === 'gradient') return normColor(paint.from_color);
  return null;
}

function strokeWidth(stroke: OristudioCpFoldedRenderStroke): number {
  return stroke.kind === 'basic' ? stroke.width : DEFAULT_STROKE_WIDTH;
}

function flattenQuad(from: Point, control: Point, to: Point, out: Point[]): void {
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push({
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    });
  }
}

function flattenCubic(from: Point, c1: Point, c2: Point, to: Point, out: Point[]): void {
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS;
    const u = 1 - t;
    out.push({
      x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
      y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
    });
  }
}

/** Flatten path commands into subpaths (one polyline per `move_to`). */
function pathSubpaths(commands: readonly OristudioCpFoldedRenderPathCommand[]): Point[][] {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  const start = () => {
    if (current.length > 0) subpaths.push(current);
    current = [];
  };
  for (const cmd of commands) {
    switch (cmd.command) {
      case 'move_to':
        start();
        cursor = cmd.point;
        current.push(cursor);
        break;
      case 'line_to':
        cursor = cmd.point;
        current.push(cursor);
        break;
      case 'quad_to':
        flattenQuad(cursor, cmd.control, cmd.point, current);
        cursor = cmd.point;
        break;
      case 'cubic_to':
        flattenCubic(cursor, cmd.control_1, cmd.control_2, cmd.point, current);
        cursor = cmd.point;
        break;
      case 'close':
        if (current.length > 0) current.push(current[0]);
        break;
    }
  }
  if (current.length > 0) subpaths.push(current);
  return subpaths;
}

function ellipsePoints(x: number, y: number, width: number, height: number): Point[] {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const points: Point[] = [];
  for (let i = 0; i < ELLIPSE_STEPS; i++) {
    const a = (i / ELLIPSE_STEPS) * Math.PI * 2;
    points.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return points;
}

/** Decompose a primitive's geometry into subpaths (local coords). */
function geometrySubpaths(geometry: OristudioCpFoldedRenderGeometry): Point[][] {
  switch (geometry.kind) {
    case 'polygon':
      return [geometry.points];
    case 'segment':
      return [[geometry.from, geometry.to]];
    case 'rect':
      return [
        [
          { x: geometry.x, y: geometry.y },
          { x: geometry.x + geometry.width, y: geometry.y },
          { x: geometry.x + geometry.width, y: geometry.y + geometry.height },
          { x: geometry.x, y: geometry.y + geometry.height },
        ],
      ];
    case 'ellipse':
      return [ellipsePoints(geometry.x, geometry.y, geometry.width, geometry.height)];
    case 'path':
      return pathSubpaths(geometry.commands);
    case 'text':
      return [];
    default:
      return [];
  }
}

/** Accumulates GPU-ready fill triangles and edge strokes across all figures. */
class FoldedBuilder {
  fillPos: number[] = [];
  fillColor: number[] = [];
  strokeA: number[] = [];
  strokeB: number[] = [];
  strokeColor: number[] = [];
  strokeWidthMul: number[] = [];

  addFillRing(ring: Point[], color: Rgba): void {
    if (ring.length < 3) return;
    const flat: number[] = [];
    for (const p of ring) flat.push(p.x, p.y);
    const indices = earcut(flat);
    for (const i of indices) {
      this.fillPos.push(flat[i * 2], flat[i * 2 + 1]);
      this.fillColor.push(color[0], color[1], color[2], color[3]);
    }
  }

  addStrokePolyline(points: Point[], color: Rgba, width: number): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      this.strokeA.push(a.x, a.y);
      this.strokeB.push(b.x, b.y);
      this.strokeColor.push(color[0], color[1], color[2], color[3]);
      this.strokeWidthMul.push(width);
    }
  }

  build(): FoldedGeometry {
    return {
      fills: {
        position: new Float32Array(this.fillPos),
        color: new Float32Array(this.fillColor),
        count: this.fillPos.length / 2,
      },
      strokes: {
        a: new Float32Array(this.strokeA),
        b: new Float32Array(this.strokeB),
        color: new Float32Array(this.strokeColor),
        widthMul: new Float32Array(this.strokeWidthMul),
        count: this.strokeA.length / 2,
      },
    };
  }
}

/**
 * A live scale preview applied to one figure while it is being drag-scaled: its
 * user-space geometry is scaled by `factor` about `pivot` (both in SVG user
 * coordinates). Cheap and wasm-free — the committed `model.scale` is only written
 * on release. Other figures are unaffected.
 */
export interface FoldedFigureScalePreview {
  figureId: string;
  factor: number;
  pivot: Point;
}

/**
 * Build folded-figure geometry (triangulated fills + edge strokes) in SVG user
 * coordinates from the figures' render snapshots, matching the SVG primitive
 * layer: points map through {@link modelPointToCpSvg} plus the figure's display
 * offset, and primitives are emitted in `sequence` order so overlapping,
 * semi-transparent facets composite correctly.
 *
 * When `scalePreview` targets a figure, that figure's user-space points are scaled
 * about the preview pivot (see {@link FoldedFigureScalePreview}).
 *
 * First cut: solid colours (gradients use their start colour); text is skipped.
 */
export function cpFoldedToScene(
  figures: readonly OristudioCpFoldedFigureEntry[],
  scalePreview?: FoldedFigureScalePreview | null
): FoldedGeometry {
  const builder = new FoldedBuilder();

  for (const figure of figures) {
    const snapshot = figure.renderSnapshot;
    if (!snapshot?.primitives.length) continue;
    const offset = figure.displayOffset ?? { x: 0, y: 0 };
    const preview =
      scalePreview && scalePreview.figureId === figure.id ? scalePreview : null;
    const toUser = (p: Point): Point => {
      const u = modelPointToCpSvg(p, ORIEDITA_PAPER_BOUNDS);
      const x = u.x + offset.x;
      const y = u.y + offset.y;
      if (!preview) return { x, y };
      return {
        x: preview.pivot.x + (x - preview.pivot.x) * preview.factor,
        y: preview.pivot.y + (y - preview.pivot.y) * preview.factor,
      };
    };

    const primitives: OristudioCpFoldedRenderPrimitive[] = [...snapshot.primitives].sort(
      (l, r) => l.sequence - r.sequence
    );

    for (const primitive of primitives) {
      const color = paintColor(primitive.style.paint);
      if (!color) continue;
      const isFill = primitive.kind.startsWith('fill_');
      const subpaths = geometrySubpaths(primitive.geometry).map((sp) => sp.map(toUser));

      if (isFill) {
        for (const ring of subpaths) builder.addFillRing(ring, color);
      } else {
        const width = strokeWidth(primitive.style.stroke);
        for (const line of subpaths) builder.addStrokePolyline(line, color, width);
      }
    }
  }

  return builder.build();
}

/**
 * Build folded geometry from explicit face rings + edge segments already in SVG user
 * coordinates. Used for imported `.fold` folded-form frames (faces → triangulated
 * fills, edges → strokes), which the surface draws through the same `userView` as the
 * generated folded figures.
 */
export function foldedGeometryFromShapes(
  faces: readonly { ring: readonly Point[]; color: Rgba }[],
  edges: readonly { a: Point; b: Point; color: Rgba; width: number }[]
): FoldedGeometry {
  const builder = new FoldedBuilder();
  for (const face of faces) builder.addFillRing([...face.ring], face.color);
  for (const edge of edges) builder.addStrokePolyline([edge.a, edge.b], edge.color, edge.width);
  return builder.build();
}

/**
 * Translucent red (Oriedita `(255,0,0,75)`) used to fill the two faces a fold
 * could not consistently stack — the flat-CP half of `drawSelfIntersectingSubFaces`.
 */
const CONTRADICTION_FILL: Rgba = [1, 0, 0, 75 / 255];

/**
 * Build a model-space filled-triangle overlay for the contradicting faces of any
 * folded figures whose fold hit a global layer-ordering contradiction. Polygons
 * are the flat CP faces (CP model coordinates, straight from
 * `snapshot.contradiction_faces`) so they draw in the CP editor's model view —
 * no coordinate mapping, unlike the folded scene. Empty when nothing contradicts.
 */
export function cpContradictionFaceFills(
  figures: readonly OristudioCpFoldedFigureEntry[]
): FillGeometry {
  const position: number[] = [];
  const color: number[] = [];
  const addRing = (ring: readonly Point[]): void => {
    if (ring.length < 3) return;
    const flat: number[] = [];
    for (const p of ring) flat.push(p.x, p.y);
    for (const i of earcut(flat)) {
      position.push(flat[i * 2], flat[i * 2 + 1]);
      color.push(CONTRADICTION_FILL[0], CONTRADICTION_FILL[1], CONTRADICTION_FILL[2], CONTRADICTION_FILL[3]);
    }
  };
  for (const figure of figures) {
    const faces = figure.snapshot?.contradiction_faces;
    if (!faces) continue;
    addRing(faces.upper);
    addRing(faces.lower);
  }
  return {
    position: new Float32Array(position),
    color: new Float32Array(color),
    count: position.length / 2,
  };
}

/** A folded figure's id paired with its bounding box in SVG user coordinates. */
export interface FoldedFigureBounds {
  id: string;
  bounds: Aabb;
}

/**
 * Bounding box (SVG user coords) of each folded figure, using the same
 * model->user + display-offset mapping as {@link cpFoldedToScene} so the pick
 * box matches what is drawn. Figures with no drawable geometry are omitted.
 * Order follows `figures`, i.e. draw order — later entries render on top.
 */
export function foldedFigureUserBounds(
  figures: readonly OristudioCpFoldedFigureEntry[]
): FoldedFigureBounds[] {
  const result: FoldedFigureBounds[] = [];
  for (const figure of figures) {
    const snapshot = figure.renderSnapshot;
    if (!snapshot?.primitives.length) continue;
    const offset = figure.displayOffset ?? { x: 0, y: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const primitive of snapshot.primitives) {
      for (const subpath of geometrySubpaths(primitive.geometry)) {
        for (const p of subpath) {
          const u = modelPointToCpSvg(p, ORIEDITA_PAPER_BOUNDS);
          const x = u.x + offset.x;
          const y = u.y + offset.y;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (Number.isFinite(minX)) {
      result.push({ id: figure.id, bounds: { minX, minY, maxX, maxY } });
    }
  }
  return result;
}
