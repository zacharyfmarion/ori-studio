import earcut from 'earcut';
import {
  CP_PAPER_RECT,
  cpModelToSvg,
} from '../../lib/creasePatternViewport';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type {
  FoldedFigurePlacement,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedRenderGeometry,
  OristudioCpFoldedRenderPaint,
  OristudioCpFoldedRenderPathCommand,
  OristudioCpFoldedRenderPrimitive,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldedRenderStroke,
  OristudioCpRgbaColor,
} from '../../engine/oristudioCpTypes';
import type { Aabb } from '../picking/lineHitIndex';
import {
  CANVAS_OBJECT_GAP,
  boxAabbInFrame,
  firstFreeSlotBeside,
  pointFromFrame,
  pointToFrame,
  type BesideAnchor,
} from '../canvasObjects/placeBesideCp';
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

function mixColor(from: Rgba, to: Rgba, t: number): Rgba {
  return [
    from[0] + (to[0] - from[0]) * t,
    from[1] + (to[1] - from[1]) * t,
    from[2] + (to[2] - from[2]) * t,
    from[3] + (to[3] - from[3]) * t,
  ];
}

/**
 * Whether a paint draws anything at all — `none`, `texture` and `other` do not.
 * Checked before tessellating so an undrawable primitive costs nothing.
 */
function paintDraws(paint: OristudioCpFoldedRenderPaint): boolean {
  return paint.kind === 'color' || paint.kind === 'gradient';
}

/**
 * A paint's colour at one point, in the primitive's own coordinate space — the
 * space a gradient's `from`/`to` are expressed in, so this must run before the
 * points are mapped to user coordinates.
 *
 * Evaluating per vertex and letting the rasterizer interpolate reproduces a
 * linear gradient exactly wherever the polygon's vertices bracket the gradient
 * axis without clamping in between, which is the case for the shadow bands this
 * exists for: the band is spanned by its edge and the offset, the gradient axis
 * *is* the offset, so all four corners land at t=0 or t=1. Elsewhere it degrades
 * to a per-vertex approximation.
 */
function paintColorAt(paint: OristudioCpFoldedRenderPaint, point: Point): Rgba | null {
  if (paint.kind === 'color') return normColor(paint.color);
  if (paint.kind !== 'gradient') return null;

  const dx = paint.to.x - paint.from.x;
  const dy = paint.to.y - paint.from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return normColor(paint.from_color);

  const raw = ((point.x - paint.from.x) * dx + (point.y - paint.from.y) * dy) / lengthSq;
  // Java2D's GradientPaint clamps outside [0,1] when acyclic and reflects when
  // cyclic, which is what `cyclic` on the kernel primitive records.
  const t = paint.cyclic
    ? Math.abs(raw % 2) > 1
      ? 2 - Math.abs(raw % 2)
      : Math.abs(raw % 2)
    : Math.min(1, Math.max(0, raw));
  return mixColor(normColor(paint.from_color), normColor(paint.to_color), t);
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
  /**
   * Draw order per emitted vertex / segment, in `[0, 1]` with 0 farthest.
   *
   * Set by the caller before each primitive via {@link depth}; the two `add*`
   * methods just stamp whatever is current onto everything they emit. That keeps
   * the depth alongside the geometry it belongs to without threading a parameter
   * through every call.
   */
  fillDepth: number[] = [];
  strokeDepth: number[] = [];
  /** The order stamped onto the next primitive. */
  depth = 0;

  /**
   * `colors` is either one colour for the whole ring or one per vertex, in which
   * case the rasterizer interpolates between them — that is what turns a shadow
   * band's gradient into an actual fade.
   */
  addFillRing(ring: Point[], colors: Rgba | Rgba[]): void {
    if (ring.length < 3) return;
    const flat: number[] = [];
    for (const p of ring) flat.push(p.x, p.y);
    const indices = earcut(flat);
    const perVertex = Array.isArray(colors[0]);
    for (const i of indices) {
      const color = (perVertex ? (colors as Rgba[])[i] : colors) as Rgba;
      this.fillPos.push(flat[i * 2], flat[i * 2 + 1]);
      this.fillColor.push(color[0], color[1], color[2], color[3]);
      this.fillDepth.push(this.depth);
    }
  }

  addStrokePolyline(points: Point[], colors: Rgba | Rgba[], width: number): void {
    const perVertex = Array.isArray(colors[0]);
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i];
      const b = points[i + 1];
      // One colour per segment, so a gradient stroke samples at its midpoint.
      const color = perVertex
        ? mixColor((colors as Rgba[])[i], (colors as Rgba[])[i + 1], 0.5)
        : (colors as Rgba);
      this.strokeA.push(a.x, a.y);
      this.strokeB.push(b.x, b.y);
      this.strokeColor.push(color[0], color[1], color[2], color[3]);
      this.strokeWidthMul.push(width);
      this.strokeDepth.push(this.depth);
    }
  }

  build(): FoldedGeometry {
    return {
      fills: {
        position: new Float32Array(this.fillPos),
        color: new Float32Array(this.fillColor),
        count: this.fillPos.length / 2,
        depth: new Float32Array(this.fillDepth),
      },
      strokes: {
        a: new Float32Array(this.strokeA),
        b: new Float32Array(this.strokeB),
        color: new Float32Array(this.strokeColor),
        widthMul: new Float32Array(this.strokeWidthMul),
        count: this.strokeA.length / 2,
        depth: new Float32Array(this.strokeDepth),
      },
    };
  }

  /** Freeze into the cacheable local form, measuring the bbox over every vertex. */
  buildLocal(): FoldedFigureLocalGeometry {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const measure = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (let i = 0; i < this.fillPos.length; i += 2) measure(this.fillPos[i], this.fillPos[i + 1]);
    for (let i = 0; i < this.strokeA.length; i += 2) {
      measure(this.strokeA[i], this.strokeA[i + 1]);
      measure(this.strokeB[i], this.strokeB[i + 1]);
    }
    const bounds = Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    return {
      fillPos: new Float32Array(this.fillPos),
      fillColor: new Float32Array(this.fillColor),
      strokeA: new Float32Array(this.strokeA),
      strokeB: new Float32Array(this.strokeB),
      strokeColor: new Float32Array(this.strokeColor),
      strokeWidthMul: new Float32Array(this.strokeWidthMul),
      fillDepth: new Float32Array(this.fillDepth),
      strokeDepth: new Float32Array(this.strokeDepth),
      bounds,
      center: bounds
        ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
        : { x: 0, y: 0 },
    };
  }
}

/**
 * One folded figure's geometry in its *local* user space — mapped through
 * {@link cpModelToSvg} but before any {@link FoldedFigurePlacement}.
 *
 * Curve flattening and earcut triangulation happen once per render snapshot and
 * are cached ({@link foldedFigureLocalGeometry}); a drag then only has to run a
 * similarity transform over these arrays, which is what keeps move/scale/rotate
 * cheap at pointer rate.
 */
export interface FoldedFigureLocalGeometry {
  fillPos: Float32Array;
  fillColor: Float32Array;
  strokeA: Float32Array;
  strokeB: Float32Array;
  strokeColor: Float32Array;
  strokeWidthMul: Float32Array;
  /**
   * Draw order within this figure, `[0, 1]` with 0 farthest — one per fill
   * vertex and one per stroke segment.
   *
   * The figure's primitives are emitted in `sequence` order, so this is just
   * that order made numeric. `cpFoldedToScene` rescales it into a per-figure
   * band so figures cannot interleave with each other.
   */
  fillDepth: Float32Array;
  strokeDepth: Float32Array;
  /** Bounding box of every emitted vertex, local user coords. Null when empty. */
  bounds: Aabb | null;
  /** Centre of {@link bounds} — the pivot placement scales and rotates about. */
  center: Point;
}

/**
 * Cache keyed by the render snapshot object. Snapshots are replaced wholesale
 * whenever the kernel re-renders a figure, so object identity is exactly the
 * right invalidation signal, and a `WeakMap` means a discarded snapshot's
 * geometry is collectable with it.
 */
const localGeometryCache = new WeakMap<
  OristudioCpFoldedRenderSnapshot,
  FoldedFigureLocalGeometry
>();

/**
 * Flatten + triangulate one figure's render snapshot into local user space,
 * memoized on the snapshot's identity. Primitives are emitted in `sequence`
 * order so overlapping, semi-transparent facets composite correctly.
 *
 * Gradients are carried as per-vertex colour (see {@link paintColorAt}); text is
 * skipped.
 */
export function foldedFigureLocalGeometry(
  snapshot: OristudioCpFoldedRenderSnapshot
): FoldedFigureLocalGeometry {
  const cached = localGeometryCache.get(snapshot);
  if (cached) return cached;

  const builder = new FoldedBuilder();
  const toUser = cpModelToSvg;
  const primitives: OristudioCpFoldedRenderPrimitive[] = [...snapshot.primitives].sort(
    (l, r) => l.sequence - r.sequence
  );

  for (const [index, primitive] of primitives.entries()) {
    // The whole point of the depth attribute: the primitives are already in
    // painter order here, and the canvas is about to lose that by batching every
    // fill into one draw and every stroke into another. Stamping the order on
    // now lets the depth test put it back.
    //
    // Strictly increasing and strictly inside (0, 1] so no two primitives share a
    // depth and none lands on the cleared value.
    builder.depth = (index + 1) / (primitives.length + 1);
    const paint = primitive.style.paint;
    if (!paintDraws(paint)) continue;
    const isFill = primitive.kind.startsWith('fill_');
    const width = isFill ? 0 : strokeWidth(primitive.style.stroke);

    for (const local of geometrySubpaths(primitive.geometry)) {
      // Colours are sampled in the primitive's space, where a gradient's axis is
      // defined; the points are only then carried into user space.
      const colors = local.map((point) => paintColorAt(paint, point));
      if (colors.some((color) => color === null)) continue;
      const ring = local.map(toUser);
      if (isFill) builder.addFillRing(ring, colors as Rgba[]);
      else builder.addStrokePolyline(ring, colors as Rgba[], width);
    }
  }

  const local = builder.buildLocal();
  localGeometryCache.set(snapshot, local);
  return local;
}

/**
 * The point a figure's placement pivots about, and the centre its box reports.
 *
 * **These two have to be the same point.** The drawing pivots here and the
 * canvas-object overlay draws its (invisible, click-taking) polygon around the
 * box centre — so if they disagree, the figure is visible in one place and
 * clickable in another. That is exactly what happened when the framed box
 * started reporting the offset alone while the drawing still pivoted on the
 * bbox centre: the figure stopped responding to clicks entirely.
 *
 * A **framed** 3D figure pivots on local `(0, 0)`, which is where the projection
 * puts the model centroid — the same point its bounding-sphere frame is centred
 * on, and a point that does not move as the model turns. A figure with no frame
 * keeps the local bbox centre, which is the only centre it has.
 *
 * At rotation 0 and scale 1 the pivot terms cancel in {@link placementAffine},
 * so switching a figure from one to the other does not move it — only what its
 * rotation and scale turn about.
 */
function foldedFigurePivot(
  figure: OristudioCpFoldedFigureEntry,
  local: { center: Point }
): Point {
  const frameRadius = figure.frameRadius ?? null;
  return frameRadius !== null && frameRadius > 0 ? FRAMED_PIVOT : local.center;
}

/**
 * Where a framed figure's model centroid lands, and how big a model unit is,
 * both in the **user** coordinates a render snapshot's points already live in.
 *
 * The projection puts the centroid at its own local `(0, 0)`, but a snapshot
 * reaches this module through `cpModelToSvg` — so local `(0, 0)` is *not* user
 * `(0, 0)`, and `frameRadius` is in model units while the box is in user ones.
 * Getting that wrong put the frame at the origin while the penguin drew around
 * user (383, 343): the click polygon and the figure were 380 units apart, and
 * the figure stopped responding to clicks entirely.
 *
 * `cpModelToSvg` is a fixed affine — paper bounds onto a fixed rect, no camera —
 * so both constants are derived from it once rather than restated.
 */
const FRAMED_PIVOT: Point = cpModelToSvg({ x: 0, y: 0 });
const USER_UNITS_PER_MODEL_UNIT: number =
  cpModelToSvg({ x: 1, y: 0 }).x - cpModelToSvg({ x: 0, y: 0 }).x;

/**
 * The affine a placement applies to local user coordinates:
 * `p ↦ c0 + offset + R(rotation) · scale · (p − c0)`, with `c0` the pivot from
 * {@link foldedFigurePivot}. Returned in the flat form the per-vertex loops want.
 */
function placementAffine(
  placement: FoldedFigurePlacement,
  center: Point
): { a: number; b: number; tx: number; ty: number } {
  const cos = Math.cos(placement.rotation) * placement.scale;
  const sin = Math.sin(placement.rotation) * placement.scale;
  return {
    a: cos,
    b: sin,
    tx: center.x + placement.offset.x - center.x * cos + center.y * sin,
    ty: center.y + placement.offset.y - center.x * sin - center.y * cos,
  };
}

/** Map a single local user-space point through a placement. */
export function applyFoldedPlacementToPoint(
  point: Point,
  placement: FoldedFigurePlacement,
  center: Point
): Point {
  const { a, b, tx, ty } = placementAffine(placement, center);
  return { x: a * point.x - b * point.y + tx, y: b * point.x + a * point.y + ty };
}

/**
 * Build folded-figure geometry (triangulated fills + edge strokes) in SVG user
 * coordinates from the figures' render snapshots and placements.
 *
 * The expensive half (curve flattening, triangulation) is cached per render
 * snapshot; this call only walks the cached vertices through each figure's
 * placement affine, so it is safe to run on every frame of a drag.
 */
export function cpFoldedToScene(
  figures: readonly OristudioCpFoldedFigureEntry[],
  /**
   * Per-figure opacity multiplier, 0..1. Used to fade a figure that no longer
   * matches its creases; defaults to fully opaque.
   *
   * Applied while copying the cached colours into the merged buffers, *not*
   * baked into the cached local geometry — that cache is keyed on the render
   * snapshot, so a figure changing opacity would otherwise keep serving its
   * previous vertices.
   */
  figureOpacity?: (figure: OristudioCpFoldedFigureEntry) => number
): FoldedGeometry {
  const fillPos: number[] = [];
  const fillColor: number[] = [];
  const strokeA: number[] = [];
  const strokeB: number[] = [];
  const strokeColor: number[] = [];
  const strokeWidthMul: number[] = [];
  const fillDepth: number[] = [];
  const strokeDepth: number[] = [];

  // Each figure gets its own band of the depth range, in draw order, so a later
  // figure always covers an earlier one however their own primitives are
  // ordered internally. Without this two overlapping figures would interleave.
  const bands = Math.max(1, figures.length);
  let bandIndex = -1;

  for (const figure of figures) {
    const snapshot = figure.renderSnapshot;
    if (!snapshot?.primitives.length) continue;
    bandIndex += 1;
    // Later figures are nearer, so their band sits closer to 1.
    const bandBase = bandIndex / bands;
    const bandSpan = 1 / bands;
    const local = foldedFigureLocalGeometry(snapshot);
    const opacity = figureOpacity?.(figure) ?? 1;
    const { a, b, tx, ty } = placementAffine(figure.placement, foldedFigurePivot(figure, local));

    for (let i = 0; i < local.fillPos.length; i += 2) {
      const x = local.fillPos[i];
      const y = local.fillPos[i + 1];
      fillPos.push(a * x - b * y + tx, b * x + a * y + ty);
    }
    for (let i = 0; i < local.fillColor.length; i++) {
      fillColor.push(i % 4 === 3 ? local.fillColor[i] * opacity : local.fillColor[i]);
    }
    for (let i = 0; i < local.fillDepth.length; i++) {
      fillDepth.push(bandBase + local.fillDepth[i] * bandSpan);
    }

    for (let i = 0; i < local.strokeA.length; i += 2) {
      const ax = local.strokeA[i];
      const ay = local.strokeA[i + 1];
      const bx = local.strokeB[i];
      const by = local.strokeB[i + 1];
      strokeA.push(a * ax - b * ay + tx, b * ax + a * ay + ty);
      strokeB.push(a * bx - b * by + tx, b * bx + a * by + ty);
    }
    for (let i = 0; i < local.strokeColor.length; i++) {
      strokeColor.push(i % 4 === 3 ? local.strokeColor[i] * opacity : local.strokeColor[i]);
    }
    for (let i = 0; i < local.strokeWidthMul.length; i++) {
      strokeWidthMul.push(local.strokeWidthMul[i]);
    }
    for (let i = 0; i < local.strokeDepth.length; i++) {
      strokeDepth.push(bandBase + local.strokeDepth[i] * bandSpan);
    }
  }

  return {
    fills: {
      position: new Float32Array(fillPos),
      color: new Float32Array(fillColor),
      count: fillPos.length / 2,
      depth: new Float32Array(fillDepth),
    },
    strokes: {
      a: new Float32Array(strokeA),
      b: new Float32Array(strokeB),
      color: new Float32Array(strokeColor),
      widthMul: new Float32Array(strokeWidthMul),
      count: strokeA.length / 2,
      depth: new Float32Array(strokeDepth),
    },
  };
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
 *
 * Exported because the 3D projector annotates an undecided arrangement cell with
 * the same red. The two say the same thing about the same kind of failure, so
 * they share one definition rather than two copies that can drift.
 */
export const CONTRADICTION_FILL: Rgba = [1, 0, 0, 75 / 255];

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
 * The placed, rotated box of a folded figure: its local bbox carried through the
 * placement. `width`/`height` are the *unrotated* extents (local size × scale)
 * and `center`/`rotation` describe where that box sits, matching the shape the
 * canvas-object overlay draws chrome for. Null when the figure draws nothing.
 */
export function foldedFigureBox(figure: OristudioCpFoldedFigureEntry): {
  center: Point;
  width: number;
  height: number;
  rotation: number;
} | null {
  const snapshot = figure.renderSnapshot;
  if (!snapshot?.primitives.length) return null;

  // A 3D figure is a window onto the model, so its frame is fixed and square:
  // sized once at fold time from the bounding sphere, which images to the same
  // circle at every orientation. Deriving it from the projection instead is what
  // made the chrome resize and jump on every orbit.
  //
  // The centre is the placement offset alone, because the projection anchors the
  // model centroid at local (0, 0) — so the model stays put inside its frame
  // while it turns, rather than sliding as its bounds change.
  const local = foldedFigureLocalGeometry(snapshot);
  if (!local.bounds) return null;

  const frameRadius = figure.frameRadius ?? null;
  if (frameRadius !== null && frameRadius > 0) {
    const pivot = foldedFigurePivot(figure, local);
    const side = 2 * frameRadius * USER_UNITS_PER_MODEL_UNIT * figure.placement.scale;
    return {
      // The pivot, not the drawing's bounds — the same point `cpFoldedToScene`
      // pivots about, so the click polygon lands exactly on the figure.
      center: { x: pivot.x + figure.placement.offset.x, y: pivot.y + figure.placement.offset.y },
      width: side,
      height: side,
      rotation: figure.placement.rotation,
    };
  }

  const { minX, minY, maxX, maxY } = local.bounds;
  return {
    // The local centre is the placement's pivot, so it only ever translates.
    center: {
      x: local.center.x + figure.placement.offset.x,
      y: local.center.y + figure.placement.offset.y,
    },
    width: (maxX - minX) * figure.placement.scale,
    height: (maxY - minY) * figure.placement.scale,
    rotation: figure.placement.rotation,
  };
}

/** Gap (SVG user units) between the crease pattern and a figure parked beside it. */
/** The edges a parked folded figure lines up against, in SVG user coordinates. */
export type FoldedFigureAnchor = BesideAnchor;

/**
 * Where a fold's *source* creases sit, in SVG user coordinates — the edges a
 * new folded figure parks against.
 *
 * Anchoring to the nominal paper square instead would leave the figure adrift
 * whenever the pattern does not fill the sheet, which is the common case: a
 * pattern can be drawn anywhere in it. Falls back to the paper square when the
 * ids resolve to nothing, so a figure still lands somewhere sensible.
 */
export function cpUserAnchorForLineIds(
  document: { crease_pattern: { line_segments: readonly { a: Point; b: Point }[] } },
  lineIds: readonly number[],
  frameAngle = 0
): FoldedFigureAnchor {
  const segments = document.crease_pattern.line_segments;
  let minY = Infinity;
  let maxX = -Infinity;
  for (const id of lineIds) {
    // Crease ids are 1-based.
    const line = segments[id - 1];
    if (!line) continue;
    for (const point of [line.a, line.b]) {
      // "Right" and "top" are measured along the *view's* axes, so the figure
      // parks beside the pattern on screen rather than diagonally from it.
      const user = pointToFrame(cpModelToSvg(point), frameAngle);
      if (user.y < minY) minY = user.y;
      if (user.x > maxX) maxX = user.x;
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxX)) {
    const fallback = pointToFrame(
      { x: CP_PAPER_RECT.x + CP_PAPER_RECT.width, y: CP_PAPER_RECT.y },
      frameAngle
    );
    return { right: fallback.x, top: fallback.y };
  }
  return { right: maxX, top: minY };
}

/**
 * Where to park a newly folded figure: just right of the crease pattern it came
 * from, clear of any figures already parked there.
 *
 * The kernel folds a figure into roughly the same coordinates as the flat CP
 * (Oriedita anchors it to the flat bounds), so left alone it lands *on top* of
 * the pattern it was folded from and hides it. Both axes are placed here: the
 * figure's top edge lines up with the paper's top edge, so the two read as a
 * row rather than the figure floating at whatever height the fold produced.
 *
 * `existing` should be the figures already on the canvas. Only those sharing the
 * new figure's horizontal band can displace it, and the band is scanned left to
 * right for the first slot wide enough — so repeated folds line up in a row,
 * a figure parked above or below is correctly ignored, and a hole left by a
 * deleted figure gets reused rather than the row growing forever.
 */
export function placeFoldedFigureBesideCp(
  figure: OristudioCpFoldedFigureEntry,
  existing: readonly OristudioCpFoldedFigureEntry[],
  paper: FoldedFigureAnchor,
  frameAngle = 0
): FoldedFigurePlacement {
  // The box this figure will *have*, at identity placement — not the extent of
  // what it draws.
  //
  // Those are the same rectangle for a flat figure and a different one for a
  // framed 3D figure, whose box is the square its bounding sphere images to and
  // whose centre is the projected centroid rather than the drawing's bbox
  // centre. Reserving the drawing's extent and then giving the figure a larger
  // box centred elsewhere is what let a fresh 3D fold's chrome overlap the
  // crease pattern it was parked beside.
  //
  // An inline simulation cannot have this bug because the rectangle it reserves
  // *is* the box it is given (`inlineSimulation.ts`). This is the same property,
  // reached the only way it can be here: ask for the box.
  const identity = foldedFigureBox({ ...figure, placement: IDENTITY_FOLDED_PLACEMENT });
  if (!identity) return IDENTITY_FOLDED_PLACEMENT;

  // Packed in the view's frame, where a figure created upright is axis-aligned —
  // so its footprint is exactly its box, and the row runs across the screen.
  // `paper` is already expressed in that frame by `cpUserAnchorForLineIds`.
  const width = identity.width;
  const height = identity.height;
  const { left, top } = firstFreeSlotBeside({
    anchor: paper,
    width,
    height,
    gap: CANVAS_OBJECT_GAP,
    blockers: existing
      .filter((other) => other.id !== figure.id)
      .map((other) => {
        const box = foldedFigureBox(other);
        return box ? boxAabbInFrame(box, frameAngle) : null;
      })
      .filter((aabb): aabb is Aabb => aabb !== null),
  });

  // Placement rotates about the figure's pivot, so the centre only ever
  // translates — the offset is box-centre to slot-centre and the rotation rides
  // along. Measured from the identity box for the same reason it was sized from
  // it: the two must describe one rectangle.
  const centre = pointFromFrame({ x: left + width / 2, y: top + height / 2 }, frameAngle);
  return {
    offset: { x: centre.x - identity.center.x, y: centre.y - identity.center.y },
    scale: 1,
    rotation: frameAngle,
  };
}

/**
 * Axis-aligned bounding box (SVG user coords) of each folded figure *as placed*,
 * derived from the same cached local geometry {@link cpFoldedToScene} draws, so
 * the pick box matches what is on screen — including under rotation, where the
 * AABB is taken over the rotated corners. Figures with no drawable geometry are
 * omitted. Order follows `figures`, i.e. draw order — later entries render on top.
 */
/**
 * Axis-aligned bounding box (SVG user coords) of one folded figure *as placed*,
 * taken over its rotated corners so a turned figure is fully enclosed. Null when
 * the figure draws nothing.
 */
export function foldedFigureUserAabb(figure: OristudioCpFoldedFigureEntry): Aabb | null {
  const box = foldedFigureBox(figure);
  if (!box) return null;
  const hw = box.width / 2;
  const hh = box.height / 2;
  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [dx, dy] of [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ]) {
    const x = box.center.x + dx * cos - dy * sin;
    const y = box.center.y + dx * sin + dy * cos;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

export function foldedFigureUserBounds(
  figures: readonly OristudioCpFoldedFigureEntry[]
): FoldedFigureBounds[] {
  const result: FoldedFigureBounds[] = [];
  for (const figure of figures) {
    const bounds = foldedFigureUserAabb(figure);
    if (bounds) result.push({ id: figure.id, bounds });
  }
  return result;
}
