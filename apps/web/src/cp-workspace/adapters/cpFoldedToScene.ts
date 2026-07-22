import earcut from 'earcut';
import {
  CP_PAPER_RECT,
  modelPointToCpSvg,
  ORIEDITA_PAPER_BOUNDS,
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
      bounds,
      center: bounds
        ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
        : { x: 0, y: 0 },
    };
  }
}

/**
 * One folded figure's geometry in its *local* user space — mapped through
 * {@link modelPointToCpSvg} but before any {@link FoldedFigurePlacement}.
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
 * Solid colours only (gradients use their start colour); text is skipped.
 */
export function foldedFigureLocalGeometry(
  snapshot: OristudioCpFoldedRenderSnapshot
): FoldedFigureLocalGeometry {
  const cached = localGeometryCache.get(snapshot);
  if (cached) return cached;

  const builder = new FoldedBuilder();
  const toUser = (p: Point): Point => modelPointToCpSvg(p, ORIEDITA_PAPER_BOUNDS);
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

  const local = builder.buildLocal();
  localGeometryCache.set(snapshot, local);
  return local;
}

/**
 * The affine a placement applies to local user coordinates:
 * `p ↦ c0 + offset + R(rotation) · scale · (p − c0)`, with `c0` the local bbox
 * centre. Returned in the flat form the per-vertex loops want.
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
  figures: readonly OristudioCpFoldedFigureEntry[]
): FoldedGeometry {
  const fillPos: number[] = [];
  const fillColor: number[] = [];
  const strokeA: number[] = [];
  const strokeB: number[] = [];
  const strokeColor: number[] = [];
  const strokeWidthMul: number[] = [];

  for (const figure of figures) {
    const snapshot = figure.renderSnapshot;
    if (!snapshot?.primitives.length) continue;
    const local = foldedFigureLocalGeometry(snapshot);
    const { a, b, tx, ty } = placementAffine(figure.placement, local.center);

    for (let i = 0; i < local.fillPos.length; i += 2) {
      const x = local.fillPos[i];
      const y = local.fillPos[i + 1];
      fillPos.push(a * x - b * y + tx, b * x + a * y + ty);
    }
    for (let i = 0; i < local.fillColor.length; i++) fillColor.push(local.fillColor[i]);

    for (let i = 0; i < local.strokeA.length; i += 2) {
      const ax = local.strokeA[i];
      const ay = local.strokeA[i + 1];
      const bx = local.strokeB[i];
      const by = local.strokeB[i + 1];
      strokeA.push(a * ax - b * ay + tx, b * ax + a * ay + ty);
      strokeB.push(a * bx - b * by + tx, b * bx + a * by + ty);
    }
    for (let i = 0; i < local.strokeColor.length; i++) strokeColor.push(local.strokeColor[i]);
    for (let i = 0; i < local.strokeWidthMul.length; i++) {
      strokeWidthMul.push(local.strokeWidthMul[i]);
    }
  }

  return {
    fills: {
      position: new Float32Array(fillPos),
      color: new Float32Array(fillColor),
      count: fillPos.length / 2,
    },
    strokes: {
      a: new Float32Array(strokeA),
      b: new Float32Array(strokeB),
      color: new Float32Array(strokeColor),
      widthMul: new Float32Array(strokeWidthMul),
      count: strokeA.length / 2,
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
  const local = foldedFigureLocalGeometry(snapshot);
  if (!local.bounds) return null;
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
const FOLDED_FIGURE_GAP = 48;

/** The edges a parked folded figure lines up against, in SVG user coordinates. */
export interface FoldedFigureAnchor {
  right: number;
  top: number;
}

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
  lineIds: readonly number[]
): FoldedFigureAnchor {
  const segments = document.crease_pattern.line_segments;
  let minY = Infinity;
  let maxX = -Infinity;
  for (const id of lineIds) {
    // Crease ids are 1-based.
    const line = segments[id - 1];
    if (!line) continue;
    for (const point of [line.a, line.b]) {
      const user = modelPointToCpSvg(point, ORIEDITA_PAPER_BOUNDS);
      if (user.y < minY) minY = user.y;
      if (user.x > maxX) maxX = user.x;
    }
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxX)) {
    return { right: CP_PAPER_RECT.x + CP_PAPER_RECT.width, top: CP_PAPER_RECT.y };
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
  paper: FoldedFigureAnchor
): FoldedFigurePlacement {
  const snapshot = figure.renderSnapshot;
  if (!snapshot?.primitives.length) return IDENTITY_FOLDED_PLACEMENT;
  const local = foldedFigureLocalGeometry(snapshot);
  if (!local.bounds) return IDENTITY_FOLDED_PLACEMENT;

  // The figure is placed unrotated and unscaled, so its footprint is just its
  // local extent, and its vertical band is fixed by the top alignment.
  const width = local.bounds.maxX - local.bounds.minX;
  const height = local.bounds.maxY - local.bounds.minY;
  const top = paper.top;
  const bottom = top + height;

  // Only figures sharing this horizontal band can block it. One parked below or
  // above is simply not in the way, and treating it as if it were is what used
  // to fling a new figure far off to the right.
  const blockers = existing
    .filter((other) => other.id !== figure.id)
    .map(foldedFigureUserAabb)
    .filter((aabb): aabb is Aabb => aabb !== null)
    .filter((aabb) => aabb.minY - FOLDED_FIGURE_GAP < bottom && aabb.maxY + FOLDED_FIGURE_GAP > top)
    .sort((a, b) => a.minX - b.minX);

  // First fit: walk the band left to right and take the first slot wide enough.
  // Scanning rather than taking the far end means a figure deleted from the
  // middle of a row leaves a hole the next fold reuses, so repeated folding
  // stays put instead of marching off to the right forever.
  let left = paper.right + FOLDED_FIGURE_GAP;
  for (const blocker of blockers) {
    if (blocker.maxX + FOLDED_FIGURE_GAP <= left) continue; // already behind us
    if (blocker.minX - FOLDED_FIGURE_GAP >= left + width) break; // the slot fits here
    left = blocker.maxX + FOLDED_FIGURE_GAP; // overlaps: move past it and re-check
  }

  return {
    offset: { x: left - local.bounds.minX, y: top - local.bounds.minY },
    scale: 1,
    rotation: 0,
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
