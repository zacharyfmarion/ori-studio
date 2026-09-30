/**
 * The arithmetic behind a step diagram's SVG, with no DOM in it.
 *
 * ReferenceFinder draws in sheet units with the origin at the bottom-left and
 * y up; SVG has y down. Every primitive goes through the one projector built
 * here, so the flip happens in exactly one place — an arc's sweep direction and
 * an arrowhead's tangent are the two things that go wrong when it happens in
 * two.
 */

import { erodeSegment } from '../../lib/paper/paperSvg';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_INK_PER_SHEET,
  DIAGRAM_LINE_INK,
  type DiagramPens,
} from './diagram/diagramInk';

export interface DiagramSheet {
  width: number;
  height: number;
  /**
   * Where the paper's middle is, in the same space as the primitives. Absent,
   * it is `(width/2, height/2)` — true of the unit frame a card draws in, and
   * false of the canvas, where the paper sits wherever the document put it
   * and its size says nothing about its position.
   */
  centre?: readonly [number, number];
  /**
   * The paper's own axes in the same space, as unit vectors — which way its
   * width and height run. Absent, they are the space's own, true of the unit
   * frame a card draws in; on the canvas the paper may be turned, and its
   * edge is then found along these.
   */
  axes?: { readonly x: readonly [number, number]; readonly y: readonly [number, number] };
}

export interface SvgPoint {
  x: number;
  y: number;
}

/** Sheet-unit point → SVG user point. */
export interface DiagramProjector {
  (point: readonly [number, number]): SvgPoint;
  /** SVG user units per sheet unit. */
  scale: number;
  /**
   * The projection's linear part: where the source's unit x and y axes land.
   *
   * A direction is not a point and does not survive `project(a) - project(b)`
   * bookkeeping in the caller — an arc's tangent has to be pushed through this,
   * or an arrowhead built for a projector that flips y points backwards under
   * one that does not. That is exactly what happened the first time this
   * drawing was put over a camera.
   */
  ex: SvgPoint;
  ey: SvgPoint;
  /**
   * One ink, in SVG user units — the pen this drawing is made with.
   *
   * Every weight, dash run and letter is a multiple of it, so the picture
   * scales with its box instead of being pinned to screen pixels. See
   * `diagram/diagramInk.ts`.
   */
  ink: number;
  /**
   * Each line style's weight, dash and cap, in ink. The card draws with the
   * table, its existing creases in the paper style's aux pen at the card's
   * scale (`cardDiagramPens`); over the canvas the arrow and the existing
   * creases are the style's own pens (`canvasDiagramPens`).
   */
  pens: DiagramPens;
  /**
   * How much shorter this drawing's dash runs are than the pen says.
   *
   * The pen's runs suit the canvas, where a dash is measured against creases.
   * On a card the same runs are measured against the paper — a valley's `12.8`
   * is an eighth of the sheet — and a pattern that repeats five times across a
   * thumbnail reads as a few strokes rather than as a dashed line. Only the
   * dash array takes it, never the stroke width: the line keeps its weight and
   * says what it is more often.
   */
  dashScale: number;
  /** The `viewBox` attribute for the whole diagram. */
  viewBox: string;
  size: number;
  /**
   * The projection reverses handedness — the picture is of the paper's back.
   *
   * Read off the basis rather than carried as a flag, because a projector may
   * arrive from a camera rather than from a fit: an arc's sweep and an
   * arrowhead's tangent are the two things that go wrong when a mirror is
   * assumed instead of measured. A plain fit already flips y, so the *even*
   * determinant is the mirrored one.
   */
  mirrored: boolean;
}

/** Whether a basis reverses handedness relative to a plain y-flip fit. */
function mirrors(ex: SvgPoint, ey: SvgPoint): boolean {
  return ex.x * ey.y - ex.y * ey.x > 0;
}

/**
 * A projector onto a live camera's own pixels, for a diagram drawn over the
 * crease pattern rather than into a box of its own.
 *
 * `view` is the canvas's model → CSS affine, so `scale` moves with the zoom —
 * an arrowhead and a mark's ring are shares of the paper and have to. `ink` does
 * not: it is the pen, fixed by the paper at fit, or a ten-times zoom would
 * arrive with a ten-times nib.
 */
export function createOverlayProjector(
  view: { origin: readonly [number, number]; ex: readonly [number, number]; ey: readonly [number, number] },
  ink: number,
  pens: DiagramPens = DIAGRAM_LINE_INK
): DiagramProjector {
  const ex = { x: view.ex[0], y: view.ex[1] };
  const ey = { x: view.ey[0], y: view.ey[1] };
  const project = ((point: readonly [number, number]): SvgPoint => ({
    x: view.origin[0] + point[0] * ex.x + point[1] * ey.x,
    y: view.origin[1] + point[0] * ex.y + point[1] * ey.y,
  })) as DiagramProjector;
  // A similarity, so one number is the whole scale.
  project.scale = Math.sqrt(Math.abs(ex.x * ey.y - ex.y * ey.x));
  project.ex = ex;
  project.ey = ey;
  project.ink = ink;
  project.pens = pens;
  // The pen's own runs: on the canvas a dash is read against the creases.
  project.dashScale = 1;
  project.viewBox = '';
  project.size = 0;
  project.mirrored = mirrors(ex, ey);
  return project;
}

/**
 * The same drawing with other pens: a projector's copy that maps every point
 * as it did and carries `pens` in place of its own. For a caller that was
 * handed a projector and draws part of the picture with a pen of its own — a
 * step's export, whose arrow is the paper style's.
 */
export function withPens(project: DiagramProjector, pens: DiagramPens): DiagramProjector {
  const copy = ((point: readonly [number, number]) => project(point)) as DiagramProjector;
  copy.scale = project.scale;
  copy.ex = project.ex;
  copy.ey = project.ey;
  copy.ink = project.ink;
  copy.pens = pens;
  copy.dashScale = project.dashScale;
  copy.viewBox = project.viewBox;
  copy.size = project.size;
  copy.mirrored = project.mirrored;
  return copy;
}

/** Margin round the sheet as a fraction of the viewBox side, so labels at a corner fit. */
export const DIAGRAM_PADDING = 0.1;

/**
 * A card's dash runs against the pen's — see `DiagramProjector.dashScale`.
 *
 * Chosen by eye on the 128 px card: at half, a valley repeats ten times across
 * the sheet instead of five and still reads as a valley, and the mountain's
 * dot is 0.8 px, which a card at device resolution still shows as a dot. A
 * third made the mountain's dot vanish; two thirds left the valley reading as
 * strokes.
 */
export const DIAGRAM_CARD_DASH_SCALE = 0.5;

/**
 * A projector that fits `sheet` into a square `size × size` viewBox, centred,
 * y flipped so the sheet's bottom edge is at the bottom of the picture.
 *
 * `mirrored` draws the paper's back: x runs the other way, exactly as
 * `ReferencesCpView` reflects the canvas, so a card and the view beside it show
 * the same thing. It is a mirror in the *projection* rather than a transform on
 * the SVG so that labels stay the right way round — mirrored text is not a
 * diagram, it is a mistake.
 */
export function createDiagramProjector(
  sheet: DiagramSheet,
  size = 100,
  mirrored = false,
  pens: DiagramPens = DIAGRAM_LINE_INK
): DiagramProjector {
  const longer = Math.max(sheet.width, sheet.height, Number.EPSILON);
  const pad = size * DIAGRAM_PADDING;
  const scale = (size - 2 * pad) / longer;
  const offsetX = pad + ((longer - sheet.width) * scale) / 2;
  const offsetY = pad + ((longer - sheet.height) * scale) / 2;
  const project = ((point: readonly [number, number]): SvgPoint => ({
    x: offsetX + (mirrored ? sheet.width - point[0] : point[0]) * scale,
    y: offsetY + (sheet.height - point[1]) * scale,
  })) as DiagramProjector;
  project.scale = scale;
  project.ex = { x: mirrored ? -scale : scale, y: 0 };
  project.ey = { x: 0, y: -scale };
  project.ink = longer * scale * DIAGRAM_INK_PER_SHEET;
  project.pens = pens;
  project.dashScale = DIAGRAM_CARD_DASH_SCALE;
  project.viewBox = `0 0 ${size} ${size}`;
  project.size = size;
  project.mirrored = mirrors(project.ex, project.ey);
  return project;
}

/** A sheet-unit point, as the primitives carry them. */
export type SheetPoint = readonly [number, number];

/**
 * Erode (D8) for an existing crease on a step's sheet: an end on the sheet's
 * boundary is pulled toward the crease's middle by `erode` × the sheet's
 * longer side, an end inside stays, and a crease the pull would invert is
 * dropped (null). In sheet units, before projection, so the card and the
 * canvas erode the same crease by the same share of the paper — the rule the
 * painter applies to every other surface (`erodeSegment`).
 *
 * The sheet is the rectangle round `sheet.centre` (or its own middle) along
 * `sheet.axes` (or the space's own), which is the paper a step's creases lie
 * on; the boundary is read with a tolerance of a millionth of the sheet,
 * since a crease to the edge is placed there by construction and not by
 * rounding.
 */
export function erodeCreaseOnSheet(
  from: SheetPoint,
  to: SheetPoint,
  sheet: DiagramSheet,
  erode: number
): [SheetPoint, SheetPoint] | null {
  const longer = Math.max(sheet.width, sheet.height);
  if (!(erode > 0) || !(longer > 0)) return [from, to];
  const eroded = erodeSegment(
    [from[0], from[1]],
    [to[0], to[1]],
    [onSheetBoundary(from, sheet), onSheetBoundary(to, sheet)],
    erode * longer
  );
  return eroded && [eroded[0], eroded[1]];
}

/**
 * Whether a point lies on the sheet's edge: the rule {@link erodeCreaseOnSheet}
 * reads an endpoint by, and the one a step's export flags an aux line's ends
 * with, so the card, the canvas and the page pull the same ends in. The sheet
 * is the rectangle round `sheet.centre` (or its own middle) along `sheet.axes`
 * (or the space's own); the edge is read with a tolerance of a millionth of
 * the sheet, since a crease to the edge is placed there by construction and
 * not by rounding.
 */
export function onSheetBoundary([x, y]: SheetPoint, sheet: DiagramSheet): boolean {
  const longer = Math.max(sheet.width, sheet.height);
  if (!(longer > 0)) return false;
  const { centre, xAxis, yAxis } = sheetFrame(sheet);
  const epsilon = longer * 1e-6;
  // The point in the paper's own frame: along its width and its height.
  const u = (x - centre[0]) * xAxis[0] + (y - centre[1]) * xAxis[1];
  const v = (x - centre[0]) * yAxis[0] + (y - centre[1]) * yAxis[1];
  const du = Math.abs(Math.abs(u) - sheet.width / 2);
  const dv = Math.abs(Math.abs(v) - sheet.height / 2);
  const withinU = Math.abs(u) <= sheet.width / 2 + epsilon;
  const withinV = Math.abs(v) <= sheet.height / 2 + epsilon;
  return (du <= epsilon && withinV) || (dv <= epsilon && withinU);
}

/**
 * The sheet's four corners in the primitives' space, from its bottom-left
 * anticlockwise in the paper's own frame — the rectangle
 * {@link onSheetBoundary} reads the edge of, as a ring.
 */
export function sheetCorners(sheet: DiagramSheet): [SheetPoint, SheetPoint, SheetPoint, SheetPoint] {
  const { centre, xAxis, yAxis } = sheetFrame(sheet);
  const at = (u: number, v: number): SheetPoint => [
    centre[0] + u * xAxis[0] + v * yAxis[0],
    centre[1] + u * xAxis[1] + v * yAxis[1],
  ];
  const w = sheet.width / 2;
  const h = sheet.height / 2;
  return [at(-w, -h), at(w, -h), at(w, h), at(-w, h)];
}

/** Where the paper is and which way it lies: its middle and its axes, with the unit frame's defaults. */
/** The sheet's middle and axes in its diagram's space, with their defaults filled in. */
export function sheetFrame(sheet: DiagramSheet) {
  return {
    centre: sheet.centre ?? ([sheet.width / 2, sheet.height / 2] as const),
    xAxis: sheet.axes?.x ?? UNIT_AXES.x,
    yAxis: sheet.axes?.y ?? UNIT_AXES.y,
  };
}

/** The space's own axes: a sheet that is not turned. */
const UNIT_AXES = { x: [1, 0], y: [0, 1] } as const;

export interface DiagramArc {
  center: readonly [number, number];
  radius: number;
  /** Radians, sheet units (y up). */
  from: number;
  to: number;
  ccw: boolean;
}

const TWO_PI = Math.PI * 2;

/** The angle the arc sweeps through in its direction of travel, in `[0, 2π)`. */
export function arcExtent(arc: DiagramArc): number {
  const signed = arc.ccw ? arc.to - arc.from : arc.from - arc.to;
  return ((signed % TWO_PI) + TWO_PI) % TWO_PI;
}

function pointOnArc(arc: DiagramArc, angle: number): [number, number] {
  return [
    arc.center[0] + arc.radius * Math.cos(angle),
    arc.center[1] + arc.radius * Math.sin(angle),
  ];
}

/**
 * The SVG path for an arc.
 *
 * The flip is where the sweep flag comes from: a counter-clockwise arc in the
 * sheet's y-up frame *looks* counter-clockwise on screen after projection, and
 * SVG's `sweep-flag = 1` means the positive-angle direction of its own y-down
 * frame, which looks clockwise. So a counter-clockwise arc takes `sweep 0`.
 */
export function arcPathData(arc: DiagramArc, project: DiagramProjector): string {
  const start = project(pointOnArc(arc, arc.from));
  const end = project(pointOnArc(arc, arc.to));
  const r = arc.radius * project.scale;
  const large = arcExtent(arc) > Math.PI ? 1 : 0;
  // A mirror reverses handedness, so the sweep flag flips with it.
  const sweep = arc.ccw === project.mirrored ? 1 : 0;
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;
}

/**
 * The arc's direction of travel at its end, in SVG space (unit length). For
 * the arrowhead: RF's arrows are arcs with the head at `to`.
 */
export function arcEndDirection(arc: DiagramArc, project: DiagramProjector): SvgPoint {
  return through(
    project,
    arc.ccw
      ? { x: -Math.sin(arc.to), y: Math.cos(arc.to) }
      : { x: Math.sin(arc.to), y: -Math.cos(arc.to) }
  );
}

/**
 * A direction from the source space into the projector's, unit length.
 *
 * Through the basis, not by assuming which axes a projector flips. Every
 * projector here is a similarity, so a direction maps to a direction and only
 * the length has to be put back.
 */
function through(project: DiagramProjector, v: SvgPoint): SvgPoint {
  const x = v.x * project.ex.x + v.y * project.ey.x;
  const y = v.x * project.ex.y + v.y * project.ey.y;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

/**
 * The arc's direction of travel at its start, reversed — the direction an
 * arrowhead placed at `from` points in. Upstream's `fromDir`.
 */
export function arcStartDirection(arc: DiagramArc, project: DiagramProjector): SvgPoint {
  const tangent = arc.ccw
    ? { x: -Math.sin(arc.from), y: Math.cos(arc.from) }
    : { x: Math.sin(arc.from), y: -Math.cos(arc.from) };
  // Reversed: an arrowhead at the start points back the way the arc came.
  return through(project, { x: -tangent.x, y: -tangent.y });
}

/** Half-angle of a fold arrow's arc — upstream's `ha`, 30°. */
const ARROW_HALF_ANGLE = Math.PI / 6;

/**
 * Half-angle of the stroke that comes back, so the two separate into a loop
 * rather than retracing one line.
 *
 * Wider than the outgoing stroke's, so the return bulges further: the arc a
 * half-angle subtends is `2 · ha`, and a fatter arc over the same chord stands
 * off the flatter one in the middle while still meeting it at both ends. The
 * one number worth tuning if the loop reads too fat or too thin.
 */
const RETURN_HALF_ANGLE = Math.PI / 4;

/** The arc between two points and the centre it turns about. */
function arcThrough(
  fromPt: readonly [number, number],
  toPt: readonly [number, number],
  center: readonly [number, number]
): DiagramArc {
  const radius = Math.hypot(toPt[0] - center[0], toPt[1] - center[1]);
  const from = Math.atan2(fromPt[1] - center[1], fromPt[0] - center[0]);
  const to = Math.atan2(toPt[1] - center[1], toPt[0] - center[0]);
  let ra = to - from;
  while (ra < 0) ra += TWO_PI;
  while (ra > TWO_PI) ra -= TWO_PI;
  return { center, radius, from, to, ccw: ra < Math.PI };
}

/**
 * The two centres of curvature that make an arc of half-angle `ha` over the
 * chord `fromPt → toPt`, or null when the chord is a point.
 *
 * `0.5 * mu.Rotate90() / tan(ha)`: the offset from the midpoint to either
 * centre. Rotate90 is (x, y) -> (-y, x).
 */
function curvatureCentres(
  fromPt: readonly [number, number],
  toPt: readonly [number, number],
  halfAngle: number
): [[number, number], [number, number]] | null {
  const dx = toPt[0] - fromPt[0];
  const dy = toPt[1] - fromPt[1];
  if (Math.hypot(dx, dy) <= 1e-9) return null;
  const mid: [number, number] = [(fromPt[0] + toPt[0]) / 2, (fromPt[1] + toPt[1]) / 2];
  const tana = Math.tan(halfAngle);
  const mup: [number, number] = [(0.5 * -dy) / tana, (0.5 * dx) / tana];
  return [
    [mid[0] + mup[0], mid[1] + mup[1]],
    [mid[0] - mup[0], mid[1] - mup[1]],
  ];
}

/**
 * The arc of a fold arrow from `fromPt` to its image `toPt`.
 *
 * A port of `RefDgmr::CalcArrow` (`third_party/reference-finder/src/core/class/
 * refDgmr.cpp:29`), verbatim including its choice of centre: the arc subtends
 * 60°, and of the two centres that give that, the one *farther* from the sheet's
 * middle is taken so the arrow bulges inward. `centre` is the paper's middle —
 * a point rather than a `width/2, height/2`, because in the document's own
 * space the paper is wherever it is and at whatever angle.
 *
 * Null when the two points coincide, which is a fold that moves nothing.
 */
export function foldArrowArc(
  fromPt: readonly [number, number],
  toPt: readonly [number, number],
  centre: readonly [number, number]
): DiagramArc | null {
  const centres = curvatureCentres(fromPt, toPt, ARROW_HALF_ANGLE);
  if (!centres) return null;
  const far = (c: readonly [number, number]) => Math.hypot(c[0] - centre[0], c[1] - centre[1]);
  return arcThrough(fromPt, toPt, far(centres[0]) > far(centres[1]) ? centres[0] : centres[1]);
}

/**
 * Three points on an arc — its start, its middle and its end, in travel order.
 *
 * How an arc crosses a coordinate change. A circle's centre, radius and two
 * angles are not points, and no point map moves them; three points on it are,
 * and because every frame map here is a **similarity** — a uniform scale, a
 * rotation and possibly a flip — a circle's image is a circle, so the three
 * images determine it exactly. {@link arcThroughPoints} is the way back.
 */
export function arcSamplePoints(
  arc: DiagramArc
): [[number, number], [number, number], [number, number]] {
  const half = (arcExtent(arc) / 2) * (arc.ccw ? 1 : -1);
  return [pointOnArc(arc, arc.from), pointOnArc(arc, arc.from + half), pointOnArc(arc, arc.to)];
}

/** The chord a flattened arc's vertices are spaced at, in radians: 5°, below any pen at any size a step is drawn. */
const ARC_FLATTEN_STEP = Math.PI / 36;

/**
 * The arc as a run of points along it, from its start to its end in its
 * direction of travel — for a painter that has no arc and draws a fold's arc
 * as the line runs between these. One vertex every {@link ARC_FLATTEN_STEP},
 * at least two; a full circle's ends coincide, as its `from` and `to` do.
 */
export function arcPolyline(arc: DiagramArc): [number, number][] {
  const extent = arcExtent(arc);
  const steps = Math.max(1, Math.ceil(extent / ARC_FLATTEN_STEP));
  const signed = arc.ccw ? extent : -extent;
  const points: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    points.push(pointOnArc(arc, arc.from + (signed * i) / steps));
  }
  return points;
}

/**
 * The arc through three points, or null when they are collinear.
 *
 * The circle is where two perpendicular bisectors meet; the middle sample says
 * which of the two arcs between the ends was the one sampled, which is the
 * whole of the direction information and cannot be had from the ends alone.
 */
export function arcThroughPoints(
  from: readonly [number, number],
  middle: readonly [number, number],
  to: readonly [number, number]
): DiagramArc | null {
  const [ax, ay] = from;
  const [bx, by] = middle;
  const [cx, cy] = to;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) <= 1e-12) return null;
  const sa = ax * ax + ay * ay;
  const sb = bx * bx + by * by;
  const sc = cx * cx + cy * cy;
  const center: [number, number] = [
    (sa * (by - cy) + sb * (cy - ay) + sc * (ay - by)) / d,
    (sa * (cx - bx) + sb * (ax - cx) + sc * (bx - ax)) / d,
  ];
  const radius = Math.hypot(ax - center[0], ay - center[1]);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const angle = (p: readonly [number, number]) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const start = angle(from);
  const end = angle(to);
  const wrap = (v: number) => ((v % TWO_PI) + TWO_PI) % TWO_PI;
  // Counter-clockwise iff the middle sample falls inside the counter-clockwise
  // sweep from one end to the other.
  const ccw = wrap(angle(middle) - start) < wrap(end - start);
  return { center, radius, from: start, to: end, ccw };
}

/**
 * A fold-and-unfold arrow: the path the paper takes over the crease and back.
 *
 * Both strokes run between the same two points — where the paper starts and
 * where it lands — and bulge the same way by different amounts, so together
 * they read as one journey out and back rather than two folds. The single head
 * is at the end of `back`, on the paper's *starting* position, because that is
 * where a precrease leaves it. An arrow with a head at each end says the paper
 * ends up somewhere; this one says it ends up where it was.
 */
export interface FoldUnfoldArrow {
  /** The paper going over: upstream's arc, `from` at the mark that moves. */
  out: DiagramArc;
  /** The paper coming back, ending where `out` began. Carries the head. */
  back: DiagramArc;
}

/**
 * The return stroke for an outgoing one: the same journey the other way, bowing
 * further out, and ending `offset` to the side of where the outgoing one began.
 *
 * Derived from the arc rather than from the two points so it serves both
 * sources — the planner's arrows, built by {@link foldArrowArc}, and
 * ReferenceFinder's own, which arrive off the wire with the centre already
 * chosen. Whichever side upstream bulged to, the return goes with it, and the
 * offset goes further that way still: the loop then opens where the head is and
 * closes at the far end, which is the shape a diagram draws.
 */
export function returnStroke(out: DiagramArc, offset: number): DiagramArc | null {
  const a = pointOnArc(out, out.from);
  const b = pointOnArc(out, out.to);
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (span <= 1e-9) return null;
  const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // The side the outgoing arc bulges to is the side away from its centre.
  const normal: [number, number] = [-(b[1] - a[1]) / span, (b[0] - a[0]) / span];
  const towardsCentre =
    normal[0] * (out.center[0] - mid[0]) + normal[1] * (out.center[1] - mid[1]);
  const bulge = towardsCentre > 0 ? -1 : 1;
  const end: [number, number] = [
    a[0] + normal[0] * bulge * offset,
    a[1] + normal[1] * bulge * offset,
  ];

  const centres = curvatureCentres(b, end, RETURN_HALF_ANGLE);
  if (!centres) return null;
  const endMid: [number, number] = [(b[0] + end[0]) / 2, (b[1] + end[1]) / 2];
  const side = (c: readonly [number, number]) =>
    (c[0] - endMid[0]) * (out.center[0] - endMid[0]) +
    (c[1] - endMid[1]) * (out.center[1] - endMid[1]);
  return arcThrough(b, end, side(centres[0]) > side(centres[1]) ? centres[0] : centres[1]);
}

/**
 * The whole symbol around an arc that is already the outgoing stroke —
 * ReferenceFinder's own arrows, which arrive off the wire with their centre and
 * angles already chosen.
 *
 * The one place the side-step is decided, so an arrow built from a witness and
 * one read off the wire cannot end up with different symbols. `offset` is how
 * far to the side the return ends, in the arc's own units —
 * {@link foldReturnOffset}, which the *drawing* decides, because a card sizes
 * it by the paper and a camera view sizes it by the pen.
 */
export function foldAndUnfoldFromArc(out: DiagramArc, offset: number): FoldUnfoldArrow | null {
  const back = returnStroke(out, offset);
  return back ? { out, back } : null;
}

/** The whole symbol for a fold that is made and released, or null if nothing moves. */
export function foldAndUnfoldArrow(
  fromPt: readonly [number, number],
  toPt: readonly [number, number],
  centre: readonly [number, number],
  offset: number
): FoldUnfoldArrow | null {
  const out = foldArrowArc(fromPt, toPt, centre);
  return out ? foldAndUnfoldFromArc(out, offset) : null;
}

/**
 * The angle that `by` of arc length covers, signed in the direction of travel,
 * so that `from + alongArc(arc, d)` is `d` further along the arc.
 */
function alongArc(arc: DiagramArc, by: number): number {
  return (by / Math.max(arc.radius, 1e-6)) * (arc.ccw ? 1 : -1);
}

/** Where the arc ends, in its own units. */
export function arcEndPoint(arc: DiagramArc): [number, number] {
  return pointOnArc(arc, arc.to);
}

/**
 * The outgoing stroke of a fold arrow, stopped at the rim of the mark it lands
 * on — or left alone when it lands on nothing marked.
 *
 * A point folded onto a point (O2) ends its journey at the other mark, and the
 * mark is a ring: a stroke drawn to its centre crosses the ring and turns round
 * inside it. So the arc gives up one rim at its end, and the return is built
 * from there — which is why this runs *before* the return exists. A point
 * folded onto a line (O5, O6, O7) or a line onto a line (O3) lands on nothing
 * marked, and the arc ends where it ends.
 *
 * `marks` are the picture's ring centres and `rim` its ring radius, both in the
 * projector's units, because "lands on" is a question about the drawing — a
 * rim is a length in ink, and ink is decided by what the picture is drawn on.
 */
export function foldArrowLanding(
  out: DiagramArc,
  marks: readonly SvgPoint[],
  rim: number,
  project: DiagramProjector
): DiagramArc {
  const end = project(arcEndPoint(out));
  const lands = marks.some((mark) => Math.hypot(mark.x - end.x, mark.y - end.y) <= rim);
  if (!lands) return out;
  const by = rim / project.scale;
  // The start gives up a rim too (`foldArrowTrim`); an arc with no room for
  // both would turn inside out rather than shorten.
  if (out.radius * arcExtent(out) <= 2 * by) return out;
  return { ...out, to: out.to - alongArc(out, by) };
}

/**
 * The two strokes as drawn.
 *
 * The shaft starts on the rim of the ring round the mark rather than at its
 * centre. The return stops where its head's notch goes: the head's reach
 * ({@link arrowheadReach}) short of its own end, so that the head, laid on
 * that end along the stroke's own direction ({@link arcArrowhead}), puts its
 * tip within a hair of where the return used to end — beside the mark, not on
 * it and not past it. The hair is how far the arc bends away from its tangent
 * over the reach, about `reach² / 2r`: a pixel or so on a step's page.
 *
 * `head` and `rim` are lengths in the same units as the radii, so the caller
 * passes all three in whichever space it is drawing.
 */
export function foldArrowTrim(arrow: FoldUnfoldArrow, head: number, rim = 0): FoldUnfoldArrow {
  return {
    out: { ...arrow.out, from: arrow.out.from + alongArc(arrow.out, rim) },
    back: { ...arrow.back, to: arrow.back.to - alongArc(arrow.back, arrowheadReach(head)) },
  };
}

/**
 * `ink` of the drawing's pen, in the projector's own units, but no more than
 * `ofChord` of the chord `arc` spans.
 */
function inkUpToChord(
  arc: DiagramArc,
  project: DiagramProjector,
  ink: number,
  ofChord: number
): number {
  const from = pointOnArc(arc, arc.from);
  const to = pointOnArc(arc, arc.to);
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]) * project.scale;
  return Math.min(ink * project.ink, ofChord * chord);
}

/**
 * How long an arrow's head should be, tip to barbs, in the projector's own
 * units.
 *
 * From the pen rather than from the paper, because the same picture is drawn
 * over a camera as well as into a box: a share of the paper is a head that
 * grows to eighty pixels on a fit view and keeps growing as you zoom. Capped at
 * a share of the chord the arrow spans, which *is* about that arrow, so a short
 * motion still gets a head rather than a blob — but never shorter than
 * {@link ARROWHEAD_MIN_STROKES} of the arrow's own stroke, below which the
 * head is no wider than the shaft it ends and the stroke's cap shows through
 * its sides.
 */
export function arrowheadSize(arc: DiagramArc, project: DiagramProjector): number {
  const sized = inkUpToChord(arc, project, DIAGRAM_ARROWHEAD_INK.length, DIAGRAM_ARROWHEAD_INK.ofChord);
  return Math.max(sized, ARROWHEAD_MIN_STROKES * project.pens.arrow.width * project.ink);
}

/**
 * The shortest head, in widths of the arrow's own stroke. At
 * {@link ARROWHEAD_ASPECT} a head this long is a little over twice as wide as
 * its shaft, and its sides stand clear of the shaft's round cap at the notch.
 */
export const ARROWHEAD_MIN_STROKES = 4;

/**
 * How far to the side a fold-and-unfold arrow's return ends, in the
 * projector's own units: the width the loop opens to at the mark.
 *
 * The paper comes back to where it started, so the head belongs *beside* that
 * point rather than on it or past it. Carrying the return on round its own
 * circle instead put the head beyond the mark and across the shaft that starts
 * there — the two ends of one loop crossing, which reads as a tangle rather
 * than a journey. So the return simply stays out on its own side of the loop
 * and stops level with the mark, offset by this much.
 *
 * Sized as the head is — by the pen, capped at a share of the chord — and for
 * the same reasons, but not *by* the head: it was one head length until the
 * head was made smaller, and a smaller head is no reason for the two strokes
 * to crowd each other (`DIAGRAM_FOLD_RETURN_INK`).
 */
export function foldReturnOffset(arc: DiagramArc, project: DiagramProjector): number {
  return inkUpToChord(arc, project, DIAGRAM_FOLD_RETURN_INK.offset, DIAGRAM_FOLD_RETURN_INK.ofChord);
}

/**
 * How long an arrowhead is against its half-width: 3.4 : 1, a little over
 * half as wide as it is long.
 *
 * `images/arrow_head.svg`, the house template's head, is a straight-backed
 * triangle 5.7005 long on a half-base of 2.2805 — 2.5 : 1 — and the head was
 * drawn at exactly that until a reader set it beside a printed diagram. The
 * heads there are slimmer, with a back that curves in toward the tip
 * ({@link ARROWHEAD_NOTCH}); beside them the template's triangle read as a
 * blunt wedge, so this follows the printed diagram rather than the template.
 * Twice as long as wide (4 : 1) was then a little too narrow.
 */
export const ARROWHEAD_ASPECT = 3.4;

/**
 * How far an arrowhead's back curves in toward its tip, as a share of its
 * length: the notch, where the back crosses the axis, stands this far in front
 * of the line through the two barbs.
 */
export const ARROWHEAD_NOTCH = 0.18;

/** A filled arrowhead's outline, in the drawing's units. */
export interface Arrowhead {
  tip: SvgPoint;
  /** The back corners, one either side of the axis. */
  barbs: readonly [SvgPoint, SvgPoint];
  /**
   * Where the back crosses the axis. A shaft that feeds the head ends here,
   * so the head sits on the shaft and continues it.
   */
  notch: SvgPoint;
}

/** How far an arrowhead's tip stands in front of its notch, for a head `length` long. */
export function arrowheadReach(length: number): number {
  return length * (1 - ARROWHEAD_NOTCH);
}

/**
 * An arrowhead `length` long, tip to barbs, with its notch at `notch` and its
 * axis along `direction`.
 */
export function arrowheadAt(notch: SvgPoint, direction: SvgPoint, length: number): Arrowhead {
  const norm = Math.hypot(direction.x, direction.y) || 1;
  const ux = direction.x / norm;
  const uy = direction.y / norm;
  const reach = arrowheadReach(length);
  const behind = length - reach;
  const half = length / ARROWHEAD_ASPECT;
  // The middle of the line through the barbs, behind the notch.
  const base = { x: notch.x - ux * behind, y: notch.y - uy * behind };
  return {
    tip: { x: notch.x + ux * reach, y: notch.y + uy * reach },
    barbs: [
      { x: base.x - uy * half, y: base.y + ux * half },
      { x: base.x + uy * half, y: base.y - ux * half },
    ],
    notch,
  };
}

/**
 * The head a stroke ending at `arc`'s `to` carries: its notch on that end and
 * its axis along the arc's direction of travel there, so it sits squarely on
 * the stroke and carries it on. `length` is in the projector's own units, and
 * the head is in them too.
 *
 * The tangent is taken where the stroke *stops*, not where the tip lands. A
 * head aimed along the tangent at its tip sat skewed on a curved shaft: its
 * back was centred off the stroke by about `length² / 2r`, enough on a step's
 * arcs to see the shaft run into the head to one side of its middle.
 */
export function arcArrowhead(
  arc: DiagramArc,
  project: DiagramProjector,
  length: number
): Arrowhead {
  return arrowheadAt(project(arcEndPoint(arc)), arcEndDirection(arc, project), length);
}

/**
 * A filled arrowhead as SVG path data: from the tip to one barb, back across a
 * shallow curve through the notch to the other barb, and home to the tip.
 *
 * The back is a quadratic whose control point stands as far in front of the
 * notch as the notch does of the barbs' midpoint — which puts the curve's own
 * midpoint exactly on the notch, where the shaft ends.
 */
export function arrowheadPath(head: Arrowhead): string {
  const [a, b] = head.barbs;
  const control = {
    x: 2 * head.notch.x - (a.x + b.x) / 2,
    y: 2 * head.notch.y - (a.y + b.y) / 2,
  };
  return `M ${pointText(head.tip)} L ${pointText(a)} Q ${pointText(control)} ${pointText(b)} Z`;
}

/** A cubic Bézier's four control points. */
type Cubic = readonly [SvgPoint, SvgPoint, SvgPoint, SvgPoint];

/** The point at parameter `t` on a cubic. */
function cubicPoint([p0, p1, p2, p3]: Cubic, t: number): SvgPoint {
  const s = 1 - t;
  const [a, b, c, d] = [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t];
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

/** The part of a cubic from parameter `t` to its end, as a cubic of its own (de Casteljau). */
function cubicFrom([p0, p1, p2, p3]: Cubic, t: number): Cubic {
  const lerp = (a: SvgPoint, b: SvgPoint) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const [a, b, c] = [lerp(p0, p1), lerp(p1, p2), lerp(p2, p3)];
  const [d, e] = [lerp(a, b), lerp(b, c)];
  return [lerp(d, e), e, c, p3];
}

/** The parameter at which `length` of a cubic has been travelled from its start; 1 past its end. */
function cubicParameterAt(cubic: Cubic, length: number): number {
  const steps = 1024;
  let travelled = 0;
  let last = cubic[0];
  for (let i = 1; i <= steps; i += 1) {
    const next = cubicPoint(cubic, i / steps);
    const step = Math.hypot(next.x - last.x, next.y - last.y);
    if (travelled + step >= length) return (i - 1 + (length - travelled) / step) / steps;
    travelled += step;
    last = next;
  }
  return 1;
}

/**
 * The turn-over symbol's stroke opens with this curve, from the end the head
 * is on into the loop, in the symbol's own box.
 */
const TURN_OVER_LEAD: Cubic = [
  { x: 25.282, y: 4.923 },
  { x: 21.103, y: -0.049 },
  { x: 13.926, y: 1.855 },
  { x: 13.926, y: 1.855 },
];

/** The rest of the stroke: the loop, and out the other side. */
const TURN_OVER_LOOP =
  'C 8.533 2.887 8.711 7.191 8.711 7.191 ' +
  'C 8.698 9.071 9.698 10.738 11.328 11.674 ' +
  'C 12.958 12.610 14.966 12.596 16.583 11.638 ' +
  'C 18.200 10.679 19.176 8.925 19.138 7.046 ' +
  'C 19.138 7.046 19.318 2.887 13.925 1.855 ' +
  'C 13.925 1.855 5.675 0.094 1.496 5.066';

/**
 * How long the turn-over glyph's head is, tip to barbs, in the symbol's own
 * box. It was set to give the reference glyph's base width at the template's
 * 2.5 : 1; kept at the slimmer {@link ARROWHEAD_ASPECT}, the head is the fold
 * arrow's shape and narrower than the glyph it was copied from.
 */
const TURN_OVER_HEAD_LENGTH = 4.1;

/**
 * The opening curve as drawn: the head's reach taken off its front, which is
 * the stretch the head covers, so it starts where the head's notch goes.
 */
const TURN_OVER_SHAFT = cubicFrom(
  TURN_OVER_LEAD,
  cubicParameterAt(TURN_OVER_LEAD, arrowheadReach(TURN_OVER_HEAD_LENGTH))
);

/**
 * The turn-over glyph's head, in the symbol's own box: the fold arrow's head,
 * fitted to the stroke by the fold arrow's rule — its notch where the stroke
 * now ends and its axis back along the stroke's direction there (the stroke
 * is written from the head end, so the head points against it). Its tip lands
 * within two thirds of a unit of the end the stroke was transcribed with,
 * about a pixel on a step's page.
 *
 * The head used to have its tip on that end, pointing along the opening
 * tangent, with the stroke running on underneath it to the point. The stroke
 * turns twenty degrees within a head's length there, so it left the head
 * through one side, and its round cap stood proud of the tip.
 */
export const TURN_OVER_HEAD: Arrowhead = arrowheadAt(
  TURN_OVER_SHAFT[0],
  {
    x: TURN_OVER_SHAFT[0].x - TURN_OVER_SHAFT[1].x,
    y: TURN_OVER_SHAFT[0].y - TURN_OVER_SHAFT[1].y,
  },
  TURN_OVER_HEAD_LENGTH
);

/** {@link TURN_OVER_HEAD} as SVG path data. */
export const TURN_OVER_HEAD_PATH = arrowheadPath(TURN_OVER_HEAD);

/**
 * The turn-over symbol, from `images/turn_over_symbol.svg`: a stroke that
 * comes in from the left, loops once, and leaves to the right, where the
 * arrowhead is. Its own box is 29 × 14.
 *
 * Transcribed rather than re-derived — an arc-and-circle approximation of a
 * hand-drawn loop is not the same glyph, and this one is the house's. Verbatim
 * but for the front of its opening curve, which stops at the head's notch
 * ({@link TURN_OVER_HEAD}) as a fold arrow's shaft does, so its cap is buried
 * in the head.
 */
export const TURN_OVER_PATH =
  `M ${pointText(TURN_OVER_SHAFT[0])} ` +
  `C ${TURN_OVER_SHAFT.slice(1).map(pointText).join(' ')} ${TURN_OVER_LOOP}`;
/** The symbol's own coordinate box. */
export const TURN_OVER_BOX = { width: 29, height: 14 } as const;

/** A point as SVG path data writes one. */
function pointText(p: SvgPoint): string {
  return `${fmt(p.x)} ${fmt(p.y)}`;
}

/**
 * Put a segment on its line's own axis, and say how far along it starts.
 *
 * A crease is stored as a segment per crossing, and each one restarts its dash
 * — so a dashed line reads as a row of unrelated dashes with a reset at every
 * vertex. Two collinear segments only agree about a pattern if they agree about
 * which way the line runs and where its zero is, so the direction is
 * canonicalised (the half-turn that makes `x` positive, or `y` when it is
 * vertical), the endpoints swapped to match, and the phase is the projection of
 * the start onto that axis. Any two segments of one line then land on the same
 * ruler, whatever order the document happens to store them in.
 *
 * One implementation for two surfaces: the card sets `stroke-dashoffset` from
 * it and the canvas uploads it as `dashPhase`, and the two must not be able to
 * disagree about where a dash begins.
 */
/**
 * How far a unit direction's `x` may sit from zero and still count as vertical.
 *
 * Generous against floating-point noise — a lerp along a chord leaves about
 * 1e-16 — and far tighter than any line a reader could tell from vertical.
 */
const AXIS_TOLERANCE = 1e-9;

export function dashRulerAlong(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  zero?: { x: number; y: number }
): { ax: number; ay: number; bx: number; by: number; phase: number } {
  const length = Math.hypot(bx - ax, by - ay);
  if (length === 0) return { ax, ay, bx, by, phase: 0 };
  const dx = (bx - ax) / length;
  const dy = (by - ay) / length;
  // The tolerance is the whole point, and an exact `dx === 0` here was a real
  // bug: a vertical crease read off the document has `dx` of exactly zero,
  // while the same crease recovered by interpolating along its own chord has
  // `dx` of about 1e-16. The two then canonicalise the *opposite* way, land
  // half a period apart, and fill each other's gaps — one line drawn twice,
  // reading solid.
  const backwards = dx < -AXIS_TOLERANCE || (dx <= AXIS_TOLERANCE && dy < 0);
  const [ux, uy] = backwards ? [-dx, -dy] : [dx, dy];
  // The ruler's zero: the origin's foot on the line, unless the caller names
  // where the crease begins — see `dashZeroOf`. Measured from the origin, a
  // short crease can start anywhere in the pattern, and one that starts in a
  // gap is a fold the reader cannot see.
  const from = zero ? zero.x * ux + zero.y * uy : 0;
  if (backwards) {
    return { ax: bx, ay: by, bx: ax, by: ay, phase: bx * ux + by * uy - from };
  }
  return { ax, ay, bx, by, phase: ax * ux + ay * uy - from };
}

/**
 * Where the dash pattern of a crease drawn as several pieces begins: the end
 * of its pieces that comes first along the line's canonical direction, so
 * the first piece opens with a dash and every later piece continues the
 * pattern from there. `undefined` for no pieces, when the ruler falls back
 * to the origin.
 */
export function dashZeroOf(
  pieces: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[]
): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined;
  let least = Infinity;
  for (const [a, b] of pieces) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    const backwards = dx < -AXIS_TOLERANCE || (dx <= AXIS_TOLERANCE && dy < 0);
    const [ux, uy] = backwards ? [-dx, -dy] : [dx, dy];
    for (const p of [a, b]) {
      const along = p.x * ux + p.y * uy;
      if (along < least) {
        least = along;
        best = p;
      }
    }
  }
  return best;
}

/**
 * The stretch of a segment that lies on the paper, as `[t0, t1]` along it from
 * `from` (0) to `to` (1); null when none of it does, or only a point.
 *
 * `outline` is the paper as it is filled — convex, wound either way, the hull
 * `sheetOutline` takes — so one pass of half-planes finds it (Cyrus–Beck). A
 * segment lying along an edge counts as on the paper: the edge is the paper's.
 * For a mark that may leave the sheet, which takes a different ink off it
 * (X11 of the paper export plan).
 */
export function paperSpan(
  from: SheetPoint,
  to: SheetPoint,
  outline: readonly SheetPoint[]
): [number, number] | null {
  const n = outline.length;
  if (n < 3) return null;
  let area = 0;
  let size = 0;
  for (let i = 0; i < n; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    area += a[0] * b[1] - b[0] * a[1];
    size = Math.max(size, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  }
  const orientation = Math.sign(area);
  if (orientation === 0) return null;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.hypot(dx, dy);
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < n; i += 1) {
    const a = outline[i]!;
    const b = outline[(i + 1) % n]!;
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const edge = Math.hypot(ex, ey);
    // Inside this edge's half-plane where `at + rate · t ≥ 0`.
    const at = orientation * (ex * (from[1] - a[1]) - ey * (from[0] - a[0]));
    const rate = orientation * (ex * dy - ey * dx);
    // Parallel to the edge: all on its inner side, or none of it — allowing a
    // billionth of the paper for a segment laid along the edge by construction.
    if (Math.abs(rate) <= 1e-12 * edge * length) {
      if (at < -1e-9 * size * edge) return null;
      continue;
    }
    const t = -at / rate;
    if (rate > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    // A touch at one point — a corner grazed from outside — is no stretch.
    if (t1 - t0 <= 1e-9) return null;
  }
  return [t0, t1];
}

/**
 * How far past the paper the box a mark off it is clipped to reaches, in
 * shares of the paper's larger side. An arrow arcs off the sheet by a
 * fraction of it; four sheets is room for any mark and still a box a vector
 * editor draws at a sane size.
 */
export const OFF_PAPER_REACH = 4;

/** A ring as SVG `points`. */
export function paperRingPoints(ring: readonly SvgPoint[]): string {
  return ring.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

/**
 * Everything but the paper, as one path to clip with under `clip-rule:
 * evenodd`: a box reaching {@link OFF_PAPER_REACH} of the paper's size past it
 * on every side, each ring cut out of it. Empty when there is no paper.
 *
 * Two rings that overlap — a flap folded back over the paper it lies on —
 * count twice under evenodd, and their overlap comes back as ground. The
 * caller draws the paper's copy of a mark over the ground's, so that stretch
 * still reads as paper.
 */
export function offPaperPathData(rings: readonly (readonly SvgPoint[])[]): string {
  const drawn = rings.filter((ring) => ring.length >= 3);
  if (drawn.length === 0) return '';
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of drawn) {
    for (const p of ring) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  const reach = OFF_PAPER_REACH * Math.max(maxX - minX, maxY - minY, Number.EPSILON);
  const [x0, y0, x1, y1] = [minX - reach, minY - reach, maxX + reach, maxY + reach].map(fmt);
  const box = `M ${x0} ${y0} H ${x1} V ${y1} H ${x0} Z`;
  const cut = drawn.map(
    (ring) => `M ${ring.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L ')} Z`
  );
  return [box, ...cut].join(' ');
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}
