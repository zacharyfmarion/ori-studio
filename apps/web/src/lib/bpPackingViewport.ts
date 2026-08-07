import type {
  OristudioBpArcPoint,
  OristudioBpCoverageRegion,
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

interface BpSheetFrame {
  /** Grid-space coordinate of the frame's left/bottom origin. */
  originX: number;
  originY: number;
  /** Frame span in grid units — the bounding box the sheet maps into. */
  spanX: number;
  spanY: number;
}

/**
 * The coordinate frame a sheet maps into. A rectangular sheet spans [0,width] ×
 * [0,height]. A diagonal sheet is a square of `size` placed as a diamond, so it
 * maps into Box Pleating Studio's render box (`DiagonalGrid.$renderWidth` /
 * `$offset`): a square of side `size + size%2` whose origin is shifted by
 * `-size%2/2` on each axis. Routing every screen mapping through this frame keeps
 * the diamond border, the clipped grid, and the flap lattice on one transform,
 * including the half-cell shift on odd sizes.
 */
export function bpPackingSheetFrame(sheet: OristudioBpSheet): BpSheetFrame {
  if (sheet.kind === 'diagonal') {
    const size = Math.max(1, Math.round(sheet.width));
    const shift = (size % 2) / 2;
    const span = size + (size % 2);
    const origin = shift === 0 ? 0 : -shift; // avoid -0 for even sizes
    return { originX: origin, originY: origin, spanX: span, spanY: span };
  }
  return {
    originX: 0,
    originY: 0,
    spanX: Math.max(1, sheet.width),
    spanY: Math.max(1, sheet.height),
  };
}

export function bpPackingPaperRect(sheet: OristudioBpSheet): PlotRect {
  const frame = bpPackingSheetFrame(sheet);
  const scale = Math.min(
    BASE_SHEET_RECT.width / frame.spanX,
    BASE_SHEET_RECT.height / frame.spanY
  );
  const rectWidth = frame.spanX * scale;
  const rectHeight = frame.spanY * scale;
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
  const frame = bpPackingSheetFrame(sheet);
  return {
    x: rect.x + ((point.x - frame.originX) / frame.spanX) * rect.width,
    y: rect.y + rect.height - ((point.y - frame.originY) / frame.spanY) * rect.height,
  };
}

/** Inverse of {@link bpPackingPointToSvg}: SVG space back to grid coordinates. */
export function bpPackingSvgToPoint(
  svgPoint: Point,
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): Point {
  const frame = bpPackingSheetFrame(sheet);
  return {
    x: frame.originX + ((svgPoint.x - rect.x) / rect.width) * frame.spanX,
    y: frame.originY + ((rect.y + rect.height - svgPoint.y) / rect.height) * frame.spanY,
  };
}

export function bpPackingUnitToSvg(
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): number {
  const frame = bpPackingSheetFrame(sheet);
  return rect.width / frame.spanX;
}

/**
 * The paper outline in SVG space. A rectangular sheet returns its four corners; a
 * diagonal sheet returns Box Pleating Studio's diamond (`DiagonalGrid.$getBorderPath`),
 * the square rotated 45° so its vertices land on the render box's edge midpoints.
 */
export function bpPackingSheetBorderPoints(
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): Point[] {
  if (sheet.kind === 'diagonal') {
    const size = Math.max(1, Math.round(sheet.width));
    const shift = (size % 2) / 2;
    const full = size + (size % 2) - shift;
    const half = (size + (size % 2)) / 2 - shift;
    return [
      { x: half, y: -shift },
      { x: full, y: half },
      { x: half, y: full },
      { x: -shift, y: half },
    ].map((corner) => bpPackingPointToSvg(corner, sheet, rect));
  }
  return [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ];
}

/** The drop-shadow polygon: the paper outline pushed out from its centroid. */
export function bpPackingSheetShadowPoints(
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): Point[] {
  const border = bpPackingSheetBorderPoints(sheet, rect);
  const cx = border.reduce((sum, p) => sum + p.x, 0) / border.length;
  const cy = border.reduce((sum, p) => sum + p.y, 0) / border.length;
  return border.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * SHADOW_INSET, y: p.y + (dy / len) * SHADOW_INSET };
  });
}

/**
 * A flap's "circle" in Box Pleating Studio's sense (`Flap.$drawCircle`): the flap
 * rectangle grown by the flap's radius on every side, with a corner radius equal to
 * that radius. It marks the minimum paper the flap needs, and degenerates to a true
 * circle when the flap has no width or height.
 */
export function bpPackingFlapClearanceRect(
  flap: Pick<OristudioBpFlap, 'anchor' | 'width' | 'height' | 'radius'>,
  sheet: OristudioBpSheet,
  paperRect = bpPackingPaperRect(sheet)
): PlotRect & { radius: number } {
  const grown = bpPackingRectToSvg(
    {
      x: flap.anchor.x - flap.radius,
      y: flap.anchor.y - flap.radius,
      width: flap.width + flap.radius * 2,
      height: flap.height + flap.radius * 2,
    },
    sheet,
    paperRect
  );
  return { ...grown, radius: flap.radius * bpPackingUnitToSvg(sheet, paperRect) };
}

/**
 * Box Pleating Studio's narrowness ratio for one invalid-junction outline
 * (`client/project/components/layout/junction.ts#getNarrowness`): how flat the
 * lens between two arcs is. Only two-arc paths have one — anything else is left
 * unstroked, matching BP's `NaN` result for longer paths.
 */
/**
 * Thickness of a two-arc conflict region across its middle, in grid units.
 *
 * The region is a lens: two arcs over a shared chord, bulging apart. Its widest
 * point is the sum of the two arcs' sagittas. Used to keep the outline stroke
 * from dwarfing the shape it is meant to make visible.
 */
export function bpArcPathThickness(path: readonly OristudioBpArcPoint[]): number | null {
  if (path.length !== 2) return null;
  const [first, second] = path;
  if (first.r == null || second.r == null) return null;
  const half = Math.hypot(second.x - first.x, second.y - first.y) / 2;
  if (half === 0) return null;
  const sagitta = (radius: number): number =>
    radius <= half ? radius : radius - Math.sqrt(radius * radius - half * half);
  return sagitta(Math.abs(first.r)) + sagitta(Math.abs(second.r));
}


/**
 * Renders an arc outline as an SVG path `d`, mirroring BP's canvas drawing of an
 * {@link https://github.com/MuTsunTsai/box-pleating-studio | InvalidJunction}:
 * `moveTo`, then `arcTo(anchor, point, radius)` or `lineTo(point)` per point, and a
 * closing arc when the first point carries one.
 *
 * BP draws in a y-up frame and can hard-code the SVG sweep flag; {@link
 * bpPackingPointToSvg} flips y, so the flag is derived per segment from the turn
 * direction in SVG space instead. Corner arcs of a rounded rectangle never exceed a
 * quarter turn and the intersection sweep only subdivides them, so the large-arc flag
 * is always 0.
 */
export function bpArcPathToSvgPath(
  path: readonly OristudioBpArcPoint[],
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): string {
  if (path.length === 0) return '';
  const unit = bpPackingUnitToSvg(sheet, rect);
  const points = path.map((point) => bpPackingPointToSvg(point, sheet, rect));
  const anchors = path.map((point) =>
    point.arc ? bpPackingPointToSvg(point.arc, sheet, rect) : null
  );

  // A junction region is the intersection of two rounded rects — convex — so
  // every arc on its boundary turns the same way. Take that direction once from
  // the path's winding rather than from a per-corner cross product, which flips
  // on a near-collinear corner and bulges that one arc outward, drawing the
  // conflict outside the flap it belongs to. Upstream emits a constant sweep for
  // the same reason (`svgGraphics.arcTo`); deriving it from the winding also
  // survives a path handed to us in the opposite order.
  // Walk the control polygon — each point followed by the anchor of the arc that
  // leaves it — so the winding is well defined even for a two-vertex lens, whose
  // points alone enclose no area.
  const control: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    control.push(points[i]);
    const next = (i + 1) % points.length;
    const anchor = anchors[next];
    if (anchor) control.push(anchor);
  }
  let signedArea = 0;
  for (let i = 0; i < control.length; i++) {
    const from = control[i];
    const to = control[(i + 1) % control.length];
    signedArea += from.x * to.y - to.x * from.y;
  }
  // Screen space is y-down, so a positive signed area is a clockwise path.
  const sweep = signedArea > 0 ? 1 : 0;

  const segment = (index: number, to: Point): string => {
    const radius = path[index].r;
    if (!anchors[index] || radius == null) return `L${round(to.x)},${round(to.y)}`;
    const radiusPx = radius * unit;
    if (radiusPx <= 0) return `L${round(to.x)},${round(to.y)}`;
    return `A${round(radiusPx)},${round(radiusPx)},0,0,${sweep},${round(to.x)},${round(to.y)}`;
  };

  let d = `M${round(points[0].x)},${round(points[0].y)}`;
  for (let i = 1; i < path.length; i++) d += segment(i, points[i]);
  if (path[0].arc && path.length > 1) d += segment(0, points[0]);
  return `${d}Z`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * One flap-or-river region as an SVG path `d` in screen space: the outer ring
 * followed by each hole, every subpath closed.
 *
 * Meant to be filled with `fill-rule: evenodd`, which is exact for a single
 * region because a node's own rings are disjoint and properly nested — an
 * island sitting inside a hole is enclosed by three rings, so it fills again.
 * Even-odd across *different* regions is not exact and must not be used: an
 * invalid packing overlaps them, and the overlap would cancel.
 */
export function bpPackingCoveragePath(
  region: OristudioBpCoverageRegion,
  sheet: OristudioBpSheet,
  rect = bpPackingPaperRect(sheet)
): string {
  return [region.outer, ...region.holes]
    .filter((ring) => ring.length > 2)
    .map((ring) =>
      ring
        .map((point, index) => {
          const { x, y } = bpPackingPointToSvg(point, sheet, rect);
          return `${index === 0 ? 'M' : 'L'}${round(x)},${round(y)}`;
        })
        .join('')
    )
    .map((subpath) => `${subpath}Z`)
    .join('');
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

/**
 * Round an anchor onto the sheet's grid.
 *
 * A flap anchor is a grid position. The BP kernel requires it: an off-grid flap
 * makes its junction overlap fractional, which fails device generation for the
 * *whole* design rather than just that flap. Drags and nudges already translate
 * by whole cells, so an on-grid flap stays on-grid without help — this exists to
 * bring one back that started off it.
 */
export function snapBpPackingAnchorToGrid(anchor: Point, sheet: OristudioBpSheet): Point {
  const interval = Math.max(sheet.grid.interval, 0);
  if (interval <= 0) return anchor;
  return {
    x: Math.round(anchor.x / interval) * interval,
    y: Math.round(anchor.y / interval) * interval,
  };
}

export function constrainBpPackingFlapGroupTarget(
  flaps: OristudioBpFlap[],
  reference: OristudioBpFlap,
  target: Point,
  sheet: OristudioBpSheet
): { loc: Point; vector: Point } {
  // A group translates rigidly — one vector moves every member — so a correction
  // that puts the reference back on the grid takes every other member off it.
  // A lone flap has no such tie, which makes it the one place a design saved
  // off-grid can come back onto it.
  const wanted = flaps.length > 1 ? target : snapBpPackingAnchorToGrid(target, sheet);
  const vector = {
    x: wanted.x - reference.anchor.x,
    y: wanted.y - reference.anchor.y,
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

/**
 * Whether a point lies within the sheet. Defined as "constraining it changes
 * nothing", which reuses the already-ported rectangular and diagonal constrain
 * logic instead of re-deriving the diamond containment test — the same
 * semantics the engine's `BpGrid::contains` uses. Flap dots are integer grid
 * coordinates, so an exact match is safe (a tiny epsilon guards float drift).
 */
export function bpPackingSheetContains(point: Point, sheet: OristudioBpSheet): boolean {
  const fixed = constrainBpPackingPoint(point, sheet);
  return Math.abs(fixed.x - point.x) < 1e-6 && Math.abs(fixed.y - point.y) < 1e-6;
}

/**
 * Whether a flap of the given footprint may sit at `anchor`, mirroring the
 * engine's `validate_flap_with_sheet`: at most one of the flap's four corner
 * tips may fall outside the sheet. Used to pre-check a width/height edit so an
 * out-of-range value snaps back instantly instead of failing an engine round
 * trip (matching Box Pleating Studio, whose resize setter silently rejects).
 */
export function bpPackingCanResizeFlap(
  anchor: Point,
  width: number,
  height: number,
  sheet: OristudioBpSheet
): boolean {
  const offSheet = flapDots(anchor, width, height).filter(
    (dot) => !bpPackingSheetContains(dot, sheet)
  ).length;
  return offSheet <= 1;
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
  if (sheet.grid.kind === 'diagonal') {
    // Box Pleating Studio's DiagonalGrid.$drawGrid: the grid lines stay horizontal
    // and vertical, but each is clipped to the diamond — widest across the middle,
    // tapering to a point at the top/bottom/left/right corners. The border itself is
    // the rotated square drawn separately (bpPackingSheetBorderPoints).
    const size = Math.max(1, Math.round(sheet.width));
    const shift = size % 2;
    for (let i = 1 - shift; i < size + shift; i++) {
      const offset = Math.abs(i - size / 2) - shift / 2;
      lines.push({
        id: `dh:${i}`,
        kind: 'minor',
        from: bpPackingPointToSvg({ x: offset, y: i }, sheet, rect),
        to: bpPackingPointToSvg({ x: size - offset, y: i }, sheet, rect),
      });
      lines.push({
        id: `dv:${i}`,
        kind: 'minor',
        from: bpPackingPointToSvg({ x: i, y: offset }, sheet, rect),
        to: bpPackingPointToSvg({ x: i, y: size - offset }, sheet, rect),
      });
    }
    return lines;
  }
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
  return lines;
}

/**
 * The drawable extent of the packing canvas, which is also what a fit frames.
 *
 * `cropToSheet` mirrors the Layers > Outside paper toggle. With the crop on, the
 * geometry layers are masked to the sheet, so anything hanging past its edge —
 * most often a corner flap's clearance circle — cannot be drawn and has no
 * business enlarging the world. Leaving it in is what made a fit after
 * optimizing zoom out to frame circles nobody can see.
 *
 * The flap dots and labels are outside the mask (see `BpPackingPanel`), so they
 * still count either way.
 */
export function getBpPackingWorldRect(
  packing: OristudioBpPackingView,
  options: { cropToSheet?: boolean } = {}
): PlotRect {
  const cropToSheet = options.cropToSheet === true;
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
    // The body is masked when cropping; whatever of it shows is inside the
    // sheet, which is already in the bounds. Its dot and label are not masked.
    if (cropToSheet) {
      includePoints(bounds, [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }]);
    } else {
      includeRect(bounds, rect);
    }
    includeRect(bounds, {
      x: rect.x + rect.width / 2 + 8,
      y: rect.y + rect.height / 2 - LABEL_HEIGHT / 2,
      width: labelWidth(flap.name || String(flap.id), 8),
      height: LABEL_HEIGHT,
    });
  }

  if (cropToSheet) {
    return {
      x: bounds.minX - WORLD_PADDING,
      y: bounds.minY - WORLD_PADDING,
      width: bounds.maxX - bounds.minX + WORLD_PADDING * 2,
      height: bounds.maxY - bounds.minY + WORLD_PADDING * 2,
    };
  }

  for (const junction of packing.invalidJunctions) {
    for (const path of junction.paths) {
      // Each arc stays inside the triangle formed by its endpoints and its tangent
      // anchor, so including the anchors covers the bulge the endpoints alone miss.
      const outline = path.flatMap((point) => (point.arc ? [point, point.arc] : [point]));
      includePoints(
        bounds,
        outline.map((point) => bpPackingPointToSvg(point, packing.sheet, paperRect))
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
