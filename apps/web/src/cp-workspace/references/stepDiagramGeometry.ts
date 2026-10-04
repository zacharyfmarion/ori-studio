/**
 * The arithmetic behind a step diagram's SVG, with no DOM in it.
 *
 * ReferenceFinder draws in sheet units with the origin at the bottom-left and
 * y up; SVG has y down. Every primitive goes through the one projector built
 * here, so the flip happens in exactly one place — an arc's sweep direction and
 * an arrowhead's tangent are the two things that go wrong when it happens in
 * two.
 */

import {
  chordSide,
  cubicTangent,
  flattenCubic,
  flattenPath,
  measurePath,
  pathPointAt,
  pathTangentAt,
  trimPath,
  type Cubic as PathCubic,
  type PathMeasure,
  type Vec2,
} from '../../lib/cubicBezier';
import { erodeSegment } from '../../lib/paper/paperSvg';
import {
  DIAGRAM_ARROWHEAD_INK,
  DIAGRAM_FOLD_RETURN_INK,
  DIAGRAM_INK_PER_SHEET,
  DIAGRAM_LINE_INK,
  DIAGRAM_MARKS,
  DIAGRAM_PUSH_INK,
  DIAGRAM_ROTATE_INK,
  DIAGRAM_TURN_OVER_INK,
  type DiagramMarks,
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
   * The rings, letters and arrowheads, in ink: the print sizes on a card or a
   * page, the References view's own over its canvas (`REFERENCES_VIEW_MARKS`).
   */
  marks: DiagramMarks;
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
  pens: DiagramPens = DIAGRAM_LINE_INK,
  marks: DiagramMarks = DIAGRAM_MARKS
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
  project.marks = marks;
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
  copy.marks = project.marks;
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
  project.marks = DIAGRAM_MARKS;
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
 * How far the arc bows out past {@link arcPolyline}'s points, in its own
 * units: the sagitta of one step, `r · (1 − cos(step / 2))`. Room a measure
 * taken along the points must add, since the arc is drawn as an arc.
 */
export function arcPolylineDeviation(arc: DiagramArc): number {
  const extent = arcExtent(arc);
  const steps = Math.max(1, Math.ceil(extent / ARC_FLATTEN_STEP));
  return Math.abs(arc.radius) * (1 - Math.cos(extent / steps / 2));
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
  const mark = nearestWithin(marks, end, rim);
  if (!mark) return out;
  const extent = out.radius * arcExtent(out);
  const at = (back: number): Vec2 => {
    const { x, y } = project(pointOnArc(out, out.to - alongArc(out, back)));
    return [x, y];
  };
  // An end at the mark — References' own, always — gives up a rim; one
  // elsewhere in the ring, as far as it takes to stand on it.
  const by = backToRing(at, [mark.x, mark.y], rim, rim / project.scale, extent);
  // The start gives up a rim too (`foldArrowTrim`); an arc with no room for
  // both would turn inside out rather than shorten.
  if (by === null || extent <= by + rim / project.scale) return out;
  return { ...out, to: out.to - alongArc(out, by) };
}

/** The mark nearest `at` within `reach` of it, or null. */
function nearestWithin(marks: readonly SvgPoint[], at: SvgPoint, reach: number): SvgPoint | null {
  let best: SvgPoint | null = null;
  let bestDistance = reach;
  for (const mark of marks) {
    const d = Math.hypot(mark.x - at.x, mark.y - at.y);
    if (d <= bestDistance) {
      best = mark;
      bestDistance = d;
    }
  }
  return best;
}

/**
 * How far back from a stroke's end, along it, it stands on the ring of
 * radius `rim` round `mark`, the end being inside the ring: where it first
 * leaves it going back — the near side, for an end past the middle. An end
 * at the middle gives up `nominal` exactly, as a mark's own arrow always
 * has. `at(back)` is the point `back` from the end, in the units `mark` and
 * `rim` are in; `longest` how far back the stroke runs. Null when it never
 * leaves the ring.
 */
export function backToRing(
  at: (back: number) => Vec2,
  mark: Vec2,
  rim: number,
  nominal: number,
  longest: number
): number | null {
  const off = (back: number) => {
    const [x, y] = at(back);
    return Math.hypot(x - mark[0], y - mark[1]);
  };
  if (off(0) <= rim * 1e-6) return nominal <= longest ? nominal : null;
  // Steps short enough that none steps across the ring.
  const step = nominal / 8;
  let inside = 0;
  for (let back = step; back <= longest; back += step) {
    if (off(back) < rim) {
      inside = back;
      continue;
    }
    let [lo, hi] = [inside, back];
    for (let k = 0; k < 40; k += 1) {
      const middle = (lo + hi) / 2;
      if (off(middle) >= rim) hi = middle;
      else lo = middle;
    }
    return hi;
  }
  return null;
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
  const sized = inkUpToChord(arc, project, project.marks.arrowheadLength, DIAGRAM_ARROWHEAD_INK.ofChord);
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

/**
 * A one-way fold arrow as drawn: the stroke, stopped where its head's notch
 * goes, and the head on that end, so the tip lands where the stroke used to
 * end — the fold-and-unfold arrow's rule for its return ({@link foldArrowTrim}).
 * `head` is in the projector's units, as {@link arrowheadSize} gives it. The
 * shaft is null for an arrow too short to have one: its head alone is drawn.
 */
export function oneWayArrow(
  out: DiagramArc,
  project: DiagramProjector,
  head: number
): { shaft: DiagramArc | null; head: Arrowhead } {
  const reach = arrowheadReach(head) / project.scale;
  if (out.radius * arcExtent(out) <= reach) {
    return { shaft: null, head: arcArrowhead({ ...out, to: out.from }, project, head) };
  }
  const shaft = { ...out, to: out.to - alongArc(out, reach) };
  return { shaft, head: arcArrowhead(shaft, project, head) };
}

/**
 * A fold-and-unfold arrow as a picture draws it: landing on the picture's
 * rings, its return beside the mark it left, both strokes trimmed — the
 * outgoing one for the ring, the return for its head — and the head on the
 * return's end. The one place its drawn shape is decided, so its drawing and
 * the room a page leaves it agree. The strokes are in the arc's own units,
 * the head in the projector's; `marks` are the picture's ring centres, in
 * the projector's units. Null when nothing moves.
 */
export function foldArrowDrawn(
  arc: DiagramArc,
  project: DiagramProjector,
  marks: readonly SvgPoint[]
): { out: DiagramArc; back: DiagramArc; head: Arrowhead } | null {
  // Sized by the pen, not by the paper — see `arrowheadSize`. The trim is
  // done on radii in the same projected units, and the angles it returns
  // then apply to the sheet-unit arcs unchanged.
  const head = arrowheadSize(arc, project);
  const rim = project.marks.ringRadius * project.ink;
  // Stopped at the far mark's rim, if it lands on one, before the return
  // is derived — the return starts where the outgoing stroke stops.
  const out = foldArrowLanding(arc, marks, rim, project);
  // The return, derived here rather than carried: how far to the side it
  // ends is the drawing's business — see the primitive's own note.
  const arrow = foldAndUnfoldFromArc(out, foldReturnOffset(arc, project) / project.scale);
  if (!arrow) return null;
  const trimmed = foldArrowTrim(
    {
      out: { ...arrow.out, radius: arrow.out.radius * project.scale },
      back: { ...arrow.back, radius: arrow.back.radius * project.scale },
    },
    head,
    rim
  );
  const back = { ...arrow.back, to: trimmed.back.to };
  return { out: { ...arrow.out, from: trimmed.out.from }, back, head: arcArrowhead(back, project, head) };
}

/**
 * A one-way fold arrow as a picture draws it: landing on the picture's rings,
 * its head sized by the pen ({@link oneWayArrow}). The one place its drawn
 * shape is decided, as {@link foldArrowDrawn} is a fold-and-unfold arrow's.
 */
export function oneWayArrowDrawn(
  arc: DiagramArc,
  project: DiagramProjector,
  marks: readonly SvgPoint[]
): { shaft: DiagramArc | null; head: Arrowhead } {
  const rim = project.marks.ringRadius * project.ink;
  return oneWayArrow(foldArrowLanding(arc, marks, rim, project), project, arrowheadSize(arc, project));
}

/**
 * A mountain fold's head: one barb, hollow — the tip, the barb on the outside
 * of the curve (away from `centre`, the arc's centre in the same space), and
 * the notch, closed, to be stroked in the arrow's pen. Its edge from the notch
 * to the tip carries the shaft on to the point. The barb stands out
 * {@link HALF_ARROWHEAD_SPREAD} times as far as a filled head's does: an
 * outline with one side is thin, and has to be wide to read as a head.
 */
export function halfArrowheadPath(head: Arrowhead, centre: SvgPoint): string {
  const [a, b] = head.barbs;
  const away = (p: SvgPoint) => Math.hypot(p.x - centre.x, p.y - centre.y);
  const outer = away(a) >= away(b) ? a : b;
  const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const barb = {
    x: base.x + (outer.x - base.x) * HALF_ARROWHEAD_SPREAD,
    y: base.y + (outer.y - base.y) * HALF_ARROWHEAD_SPREAD,
  };
  return `M ${pointText(head.tip)} L ${pointText(barb)} L ${pointText(head.notch)} Z`;
}

/** How much wider a mountain fold's one barb stands than a filled head's. */
const HALF_ARROWHEAD_SPREAD = 1.8;

/**
 * The corners a head's outline reaches, a filled head's or a mountain fold's
 * half head (whose one barb stands out further, on either side): what a crop
 * keeps, before the stroke's own width round them.
 */
export function arrowheadExtent(head: Arrowhead): SvgPoint[] {
  const [a, b] = head.barbs;
  const base = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const spread = (p: SvgPoint) => ({
    x: base.x + (p.x - base.x) * HALF_ARROWHEAD_SPREAD,
    y: base.y + (p.y - base.y) * HALF_ARROWHEAD_SPREAD,
  });
  return [head.tip, head.notch, spread(a), spread(b)];
}

/**
 * A shaped arrow's path in the primitives' space: cubic Bézier segments, tail
 * first, each starting where the one before it ends.
 */
export type DiagramCubic = readonly [SheetPoint, SheetPoint, SheetPoint, SheetPoint];

/** Which fold a path arrow says: a valley's or a mountain's head, or out and back with the return's. */
export type PathArrowFold = 'valley' | 'mountain' | 'fold-unfold';

/**
 * A path through a projector. A Bézier's image under an affine map is the
 * Bézier of its control points' images, so the curve drawn is exactly the
 * one carried.
 */
export function projectPath(path: readonly DiagramCubic[], project: DiagramProjector): PathCubic[] {
  const at = (point: SheetPoint): Vec2 => {
    const { x, y } = project(point);
    return [x, y];
  };
  return path.map(([a, b, c, d]) => [at(a), at(b), at(c), at(d)]);
}

/** Path data for a path of cubics: to its start, then a `C` for each segment. */
export function cubicPathData(path: readonly PathCubic[]): string {
  if (path.length === 0) return '';
  const text = (p: Vec2) => `${fmt(p[0])} ${fmt(p[1])}`;
  return `M ${text(path[0]![0])} ${path.map(([, b, c, d]) => `C ${text(b)} ${text(c)} ${text(d)}`).join(' ')}`;
}

/** Path data for a run of straight lines. */
export function polylinePathData(points: readonly Vec2[]): string {
  return points.map((p, index) => `${index === 0 ? 'M' : 'L'} ${fmt(p[0])} ${fmt(p[1])}`).join(' ');
}

/** A path arrow's head, its return's opening and the rim it stops at, in the drawing's units. */
export interface PathArrowSizes {
  head: number;
  offset: number;
  rim: number;
}

/**
 * A path arrow's sizes, by the arc arrow's rules (`arrowheadSize`,
 * `foldReturnOffset`) with one change: they are capped by a share of the
 * path's length, not of its tail-to-tip chord. A path that loops round may
 * end beside its own tail, and a share of that chord is a head of nothing.
 */
export function pathArrowSizes(length: number, project: DiagramProjector): PathArrowSizes {
  const capped = (ink: number, ofLength: number) => Math.min(ink * project.ink, ofLength * length);
  return {
    head: Math.max(
      capped(project.marks.arrowheadLength, DIAGRAM_ARROWHEAD_INK.ofChord),
      ARROWHEAD_MIN_STROKES * project.pens.arrow.width * project.ink
    ),
    offset: capped(DIAGRAM_FOLD_RETURN_INK.offset, DIAGRAM_FOLD_RETURN_INK.ofChord),
    rim: project.marks.ringRadius * project.ink,
  };
}

/** A path arrow as it is drawn: its strokes, its head, and which side of the head is the inside of the curve. */
export interface PathArrowGeometry {
  /** The outgoing stroke, or null for an arrow too short to have one: its head alone is drawn. */
  shaft: PathCubic[] | null;
  /** A fold-and-unfold arrow's return, from the tip back to beside the tail, stopped at its head's notch. */
  back: Vec2[] | null;
  head: Arrowhead;
  /**
   * A point far inside the curve where the head is: the centre a mountain
   * fold's one barb stands away from ({@link halfArrowheadPath}), as an arc's
   * centre is.
   */
  inside: SvgPoint;
}

/**
 * How far a fold-and-unfold path arrow's return bows out past its straight
 * taper, as a share of the path's length, and no more than the opening.
 *
 * References' return is a 90° arc over a 60° one, which stands off the
 * outgoing stroke by about 0.07 of the arrow's length in its middle as well
 * as the half opening the taper gives there; this keeps that look on a path
 * shaped from an arc. The cap keeps a long winding path's loop the width of
 * a short one's.
 */
const RETURN_BOW = 0.07;

/** The most a path's runs turn at one point before the return is joined round them rather than across. */
const RETURN_JOIN_TURN = 0.25;
/** The step a round join is drawn in. */
const RETURN_JOIN_STEP = Math.PI / 12;

const toSvg = (p: Vec2): SvgPoint => ({ x: p[0], y: p[1] });

/**
 * A shaped arrow, from its path in the drawing's units: where its strokes
 * run and where its head sits, by the arc arrows' rules.
 *
 * - The tip stops at the rim of a ring it lands on (`foldArrowLanding`),
 *   measured along the path.
 * - A one-way arrow's shaft stops at its head's notch, and the head sits
 *   there along the shaft's direction where it stops (`oneWayArrow`).
 * - A fold-and-unfold arrow's shaft starts a rim in from its tail, always
 *   (`foldArrowTrim`), and its return is derived from the landed path
 *   ({@link pathReturn}) and carries the head.
 *
 * `sizes` are asked for by the path's whole length; `marks` are the ring
 * centres, and `tolerance` how far the return's runs may stand off the
 * curves they follow, all in the path's units. Null for a path of no length.
 */
export function pathArrowGeometry(
  path: readonly PathCubic[],
  fold: PathArrowFold,
  sizesFor: (length: number) => PathArrowSizes,
  marks: readonly SvgPoint[],
  tolerance: number
): PathArrowGeometry | null {
  const measure = measurePath(path);
  const { length } = measure;
  if (!(length > 1e-9)) return null;
  const sizes = sizesFor(length);
  const tip = pathPointAt(measure, length);
  const mark = nearestWithin(marks, toSvg(tip), sizes.rim);
  // Stopped on the ring of a mark it lands in, as an arc arrow is (`foldArrowLanding`).
  const by = mark ? backToRing((back) => pathPointAt(measure, length - back), [mark.x, mark.y], sizes.rim, sizes.rim, length) : null;
  // A path with no room for a rim at each end would turn inside out rather than shorten.
  const end = by !== null && length > by + sizes.rim ? length - by : length;
  const reach = arrowheadReach(sizes.head);
  const headAt = (at: Vec2, direction: Vec2 | null) =>
    arrowheadAt(toSvg(at), toSvg(direction ?? [1, 0]), sizes.head);

  if (fold !== 'fold-unfold') {
    if (end <= reach) {
      const head = headAt(pathPointAt(measure, 0), pathTangentAt(measure, 0));
      return { shaft: null, back: null, head, inside: insideOf(measure, 0, sizes.head, head) };
    }
    const stop = end - reach;
    const head = headAt(pathPointAt(measure, stop), pathTangentAt(measure, stop));
    return { shaft: trimPath(measure, 0, stop), back: null, head, inside: insideOf(measure, stop, sizes.head, head) };
  }

  const landed = trimPath(measure, 0, end);
  const back = pathReturn(landed, sizes.offset, tolerance);
  const shaft = sizes.rim < end ? trimPath(measure, sizes.rim, end) : null;
  if (!back) {
    const head = headAt(pathPointAt(measure, end), pathTangentAt(measure, end));
    return { shaft, back: null, head, inside: head.notch };
  }
  const stopped = polylineStoppedShort(back, reach);
  const head = headAt(stopped.end, stopped.direction);
  return { shaft, back: stopped.points, head, inside: head.notch };
}

/**
 * A point far inside the curve where a head sits at `distance` along it: the
 * side the shaft turns toward over the head's last two lengths, or, where it
 * runs straight there, the side away from the one the whole path bulges to.
 * Near an inflection the two can disagree, and the turn near the head wins.
 */
function insideOf(
  measure: PathMeasure,
  distance: number,
  head: number,
  arrowhead: Arrowhead
): SvgPoint {
  const at = pathTangentAt(measure, distance) ?? [1, 0];
  const before = pathTangentAt(measure, Math.max(0, distance - 2 * head)) ?? at;
  const turn = before[0] * at[1] - before[1] * at[0];
  let sign: number;
  if (Math.abs(turn) > Math.sin(Math.PI / 90)) sign = Math.sign(turn);
  else sign = chordSide(flattenPath(measure.path, measure.length * 1e-3), measure.length) < 0 ? -1 : 1;
  const far = 1000 * head;
  return { x: arrowhead.notch.x - at[1] * sign * far, y: arrowhead.notch.y + at[0] * sign * far };
}

/**
 * A fold-and-unfold path arrow's return: the same journey back, from the tip
 * to `offset` beside the tail, on the side the path bulges to — an offset
 * curve of the path, whose distance from it tapers from `offset` at the tail
 * to nothing at the tip and bows out between ({@link RETURN_BOW}).
 *
 * The side is the one the path lies on of its chord (`chordSide`), kept
 * the whole way: on an S the return crosses to neither side of the shaft.
 * Where the path bends tighter than the loop is wide, on the loop's side, an
 * offset curve folds back on itself in a swallowtail; the fold is cut out
 * where the curve crosses itself, so the return turns a sharp inner corner
 * there instead. Round a corner node's outside it is joined round. As runs,
 * from the tip; null for a path of no length.
 */
export function pathReturn(path: readonly PathCubic[], offset: number, tolerance: number): Vec2[] | null {
  // Runs short enough that the taper and the bow are drawn as curves, not
  // chords: a 24th of the control polygon, which is at least as long as the path.
  const hull = path.reduce((sum, [a, b, c, d]) => sum + dist(a, b) + dist(b, c) + dist(c, d), 0);
  const points = flattenPath(path, tolerance, Math.max(hull / 24, tolerance));
  const distinct = points.filter((p, index) => index === 0 || dist(points[index - 1]!, p) > 1e-12);
  if (distinct.length < 2) return null;
  const length = distinct.reduce((sum, p, index) => (index === 0 ? 0 : sum + dist(distinct[index - 1]!, p)), 0);
  // A path on neither side of its chord takes one fixed side, the same on every surface.
  const side = chordSide(distinct, length) < 0 ? 1 : -1;
  const bow = Math.min(RETURN_BOW * length, offset);
  let travelled = 0;
  const widths = distinct.map((p, index) => {
    if (index > 0) travelled += dist(distinct[index - 1]!, p);
    const u = Math.min(1, travelled / length);
    return offset * (1 - u) + bow * Math.sin(Math.PI * u);
  });
  const widest = Math.max(...widths);
  return cutLoops(offsetRuns(distinct, widths, side), 8 * widest).reverse();
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/**
 * How offset runs turn the outside of a sharp bend at a point: round, as a
 * stroke's round join and as a smooth curve's offset is, or mitred while the
 * mitre reaches no more than `miterLimit` widths out and cut straight across
 * (bevelled) past that, as a stroke's mitre join is.
 */
type OffsetJoin = 'round' | { miterLimit: number };

/**
 * Runs offset to one side of their direction of travel by `widths`: through
 * a gentle bend along the two runs' mean normal, round the outside of a
 * sharp one in steps — or mitred, where `joinAt` says so — and straight
 * across its inside, where the two offset runs cross and {@link cutLoops}
 * takes the overlap away.
 */
function offsetRuns(
  points: readonly Vec2[],
  widths: readonly number[],
  side: number,
  joinAt: (index: number) => OffsetJoin = () => 'round'
): Vec2[] {
  const out: Vec2[] = [];
  const direction = (a: Vec2, b: Vec2): Vec2 => {
    const d = dist(a, b);
    return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
  };
  const normal = (t: Vec2): Vec2 => [-t[1] * side, t[0] * side];
  const at = (p: Vec2, n: Vec2, w: number): Vec2 => [p[0] + n[0] * w, p[1] + n[1] * w];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const w = widths[i]!;
    const before = i > 0 ? direction(points[i - 1]!, p) : null;
    const after = i < points.length - 1 ? direction(p, points[i + 1]!) : null;
    if (!before || !after) {
      out.push(at(p, normal((before ?? after)!), w));
      continue;
    }
    const turn = Math.atan2(before[0] * after[1] - before[1] * after[0], before[0] * after[0] + before[1] * after[1]);
    const nIn = normal(before);
    const nOut = normal(after);
    const mitre = () => {
      const mean: Vec2 = [nIn[0] + nOut[0], nIn[1] + nOut[1]];
      const size = Math.hypot(mean[0], mean[1]);
      out.push(at(p, [mean[0] / size, mean[1] / size], w / Math.cos(turn / 2)));
    };
    const join = turn * side < 0 ? joinAt(i) : 'round';
    if (join !== 'round') {
      // A stroke's mitre: the corner, while it stands no further out than the
      // limit allows (a mitre's length over the width is 1/cos(turn/2)).
      if (Math.cos(turn / 2) * join.miterLimit >= 1) mitre();
      else out.push(at(p, nIn, w), at(p, nOut, w));
    } else if (Math.abs(turn) < RETURN_JOIN_TURN) {
      mitre();
    } else if (turn * side < 0) {
      // The outside of the bend: round it, as the stroke's own join is.
      const steps = Math.ceil(Math.abs(turn) / RETURN_JOIN_STEP);
      for (let step = 0; step <= steps; step += 1) {
        const angle = (turn * step) / steps;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        out.push(at(p, [nIn[0] * c - nIn[1] * s, nIn[0] * s + nIn[1] * c], w));
      }
    } else {
      out.push(at(p, nIn, w), at(p, nOut, w));
    }
  }
  return out;
}

/**
 * Runs with the loops they make where they cross themselves within `span` of
 * travel taken out: the crossing kept, and what went round between dropped.
 * Only near crossings: an arrow drawn over itself on purpose crosses its own
 * offset far along it, and keeps the crossing. A cut never drops `keep` — the
 * points from one index to another — so a loop round a short leg cannot be
 * taken for one round its tail.
 */
function cutLoops(points: readonly Vec2[], span: number, keep?: { from: number; to: number }): Vec2[] {
  if (points.length < 4) return [...points];
  const out: Vec2[] = [points[0]!];
  let i = 0;
  while (i < points.length - 1) {
    const a = out[out.length - 1]!;
    const b = points[i + 1]!;
    let cut: { j: number; at: Vec2 } | null = null;
    let travelled = 0;
    for (let j = i + 2; j < points.length - 1; j += 1) {
      travelled += dist(points[j - 1]!, points[j]!);
      if (travelled > span) break;
      // The cut drops points i + 1 to j.
      if (keep && i + 1 <= keep.to && j >= keep.from) break;
      const at = crossing(a, b, points[j]!, points[j + 1]!);
      if (at) cut = { j, at };
    }
    if (cut) {
      out.push(cut.at);
      i = cut.j;
    } else {
      out.push(b);
      i += 1;
    }
  }
  return out;
}

/** Where two runs cross, strictly inside both; null when they do not. */
function crossing(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]];
  const s: Vec2 = [d[0] - c[0], d[1] - c[1]];
  const denominator = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(denominator) < 1e-18) return null;
  const qp: Vec2 = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / denominator;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / denominator;
  const inside = (v: number) => v > 1e-9 && v < 1 - 1e-9;
  return inside(t) && inside(u) ? [a[0] + r[0] * t, a[1] + r[1] * t] : null;
}

/**
 * Runs stopped `by` short of their end, and the direction the last of them
 * runs in where they stop; a run too short to stop short of keeps its first
 * point alone.
 */
function polylineStoppedShort(points: readonly Vec2[], by: number): { points: Vec2[] | null; end: Vec2; direction: Vec2 } {
  let left = by;
  for (let i = points.length - 1; i > 0; i -= 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const run = dist(a, b);
    if (run <= 1e-12) continue;
    const direction: Vec2 = [(b[0] - a[0]) / run, (b[1] - a[1]) / run];
    if (run > left) {
      const end: Vec2 = [b[0] - direction[0] * left, b[1] - direction[1] * left];
      return { points: [...points.slice(0, i), end], end, direction };
    }
    left -= run;
  }
  const first = points[0]!;
  const next = points.find((p) => dist(first, p) > 1e-12) ?? first;
  const run = dist(first, next) || 1;
  return { points: null, end: first, direction: [(next[0] - first[0]) / run, (next[1] - first[1]) / run] };
}

/**
 * A path arrow primitive as a picture draws it: projected, sized by the
 * drawing's pen and its own length, landing on the picture's rings. The one
 * place the primitive's shape is decided, so its drawing and the box a file
 * is cropped to agree.
 */
export function pathArrowDrawn(
  path: readonly DiagramCubic[],
  fold: PathArrowFold,
  project: DiagramProjector,
  marks: readonly SvgPoint[]
): PathArrowGeometry | null {
  return pathArrowGeometry(
    projectPath(path, project),
    fold,
    (length) => pathArrowSizes(length, project),
    marks,
    PATH_FLATTEN_INK * project.ink
  );
}

/** How far a drawn return's runs may stand off the curve they follow, in ink: far under its pen. */
const PATH_FLATTEN_INK = 0.05;

/** A push arrow's shape, in the drawing's units (`DIAGRAM_PUSH_INK` × the ink). */
export interface PushArrowSize {
  head: number;
  headHalf: number;
  shaftHalf: number;
  cleft: number;
}

/**
 * A push arrow's outline, from its tail to its tip: a straight shaft, a head
 * wider than it, and a tail cleft in a V — eight corners, in drawing order.
 * An arrow shorter than its head and cleft is the same shape smaller. Null
 * when the two ends coincide.
 */
export function pushArrowOutline(tail: SvgPoint, tip: SvgPoint, size: PushArrowSize): SvgPoint[] | null {
  const length = Math.hypot(tip.x - tail.x, tip.y - tail.y);
  if (length <= 1e-9) return null;
  const fit = Math.min(1, length / (size.head + 2 * size.cleft));
  const head = size.head * fit;
  const headHalf = size.headHalf * fit;
  const shaftHalf = size.shaftHalf * fit;
  const cleft = size.cleft * fit;
  const u = { x: (tip.x - tail.x) / length, y: (tip.y - tail.y) / length };
  const n = { x: -u.y, y: u.x };
  const at = (along: number, across: number): SvgPoint => ({
    x: tail.x + u.x * along + n.x * across,
    y: tail.y + u.y * along + n.y * across,
  });
  const neck = length - head;
  return [
    at(length, 0),
    at(neck, headHalf),
    at(neck, shaftHalf),
    at(0, shaftHalf),
    at(cleft, 0),
    at(0, -shaftHalf),
    at(neck, -shaftHalf),
    at(neck, -headHalf),
  ];
}

/**
 * A push arrow as a picture draws it, from `from` to `to` in sheet units: its
 * outline in the projector's units, sized by its ink. The one place its drawn
 * shape is decided, as {@link foldArrowDrawn} is a fold arrow's. Null when its
 * ends coincide.
 */
export function pushArrowDrawn(
  from: readonly [number, number],
  to: readonly [number, number],
  project: DiagramProjector
): SvgPoint[] | null {
  const ink = project.ink;
  return pushArrowOutline(project(from), project(to), {
    head: DIAGRAM_PUSH_INK.head * ink,
    headHalf: DIAGRAM_PUSH_INK.headHalf * ink,
    shaftHalf: DIAGRAM_PUSH_INK.shaftHalf * ink,
    cleft: DIAGRAM_PUSH_INK.cleft * ink,
  });
}

/** SVG's default `stroke-miterlimit`: a mitre longer than this many pens is bevelled. */
const SVG_MITER_LIMIT = 4;

/**
 * How far a closed outline stroked `pen` wide with mitred corners reaches past
 * each of its corners: half the pen along the mitre, which grows as the
 * corner sharpens, until SVG bevels it at its default limit and it reaches
 * half the pen. A push arrow's cleft tail is sharp enough to reach well past
 * one pen.
 */
export function mitredCornerReach(outline: readonly SvgPoint[], pen: number): number[] {
  return outline.map((corner, index) => {
    const before = outline[(index + outline.length - 1) % outline.length]!;
    const after = outline[(index + 1) % outline.length]!;
    const a = { x: before.x - corner.x, y: before.y - corner.y };
    const b = { x: after.x - corner.x, y: after.y - corner.y };
    const lengths = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y);
    if (!(lengths > 0)) return pen / 2;
    const angle = Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / lengths)));
    const mitre = 1 / Math.sin(angle / 2);
    return (pen / 2) * (mitre <= SVG_MITER_LIMIT ? mitre : 1);
  });
}

/** The rotate glyph's heads, as a share of a fold arrow's. */
const ROTATE_HEAD_OF_ARROWHEAD = 0.75;

/**
 * The rotate glyph as a picture draws it about `at`, in sheet units: its
 * circle sized by the ink, and its heads a fold arrow's, a little shorter,
 * kept as wide as the pen needs. The one place its drawn shape is decided, so
 * its drawing and the room a page leaves it agree.
 */
export function rotateGlyphDrawn(
  at: readonly [number, number],
  direction: 'cw' | 'ccw',
  project: DiagramProjector
): { centre: SvgPoint; radius: number; strokes: [string, string]; heads: [Arrowhead, Arrowhead] } {
  const centre = project(at);
  const radius = DIAGRAM_ROTATE_INK.radius * project.ink;
  // A fold arrow's head, a little shorter: two of them sit on a small circle.
  const head = Math.max(
    ROTATE_HEAD_OF_ARROWHEAD * project.marks.arrowheadLength * project.ink,
    ARROWHEAD_MIN_STROKES * project.pens.arrow.width * project.ink
  );
  return { centre, radius, ...rotateGlyph(centre, radius, head, direction) };
}

/** Path data for a closed polygon. */
export function polygonPathData(points: readonly SvgPoint[]): string {
  return `M ${points.map(pointText).join(' L ')} Z`;
}

/**
 * A white arrow's tail: drawn to a point, as the Origami House template's
 * tapered white arrows are; cut square across, as its even ones are; or cleft
 * in a V, as a push arrow's is.
 */
export type WhiteArrowTail = 'pointed' | 'square' | 'cleft';

/**
 * A white arrow's size, in the drawing's units: its shaft's width where it
 * meets the head (the neck), and its head's length, tip to back, and width,
 * barb to barb (`DIAGRAM_WHITE_ARROW_INK` × the ink).
 */
export interface WhiteArrowSize {
  neck: number;
  headLength: number;
  headWidth: number;
}

/**
 * The mitre limit a white arrow's outline is shaped and stroked with: the
 * template's (`stroke-miterlimit: 1.5` on every white arrow). The outline's
 * corners are joined to it, and its stroke is to be drawn with it, so the
 * shape and the pen round each corner alike. A corner sharper than 96° is cut
 * across: the regular and wide heads' right-angled tips stay sharp, the
 * narrow head's 64° tip, every barb and a pointed tail are bevelled.
 */
export const WHITE_ARROW_MITER_LIMIT = 1.5;

/**
 * How a pointed tail widens into the neck: a share `u` of the way from the
 * tail, the shaft is `1 − (1 − u)^1.2` of the neck wide. Measured off the
 * template's tapered white arrow (`path4649`), which is within 2% of the
 * neck of this along its whole length: nearly straight sides that meet the
 * head nearly parallel. Its sibling (`path4653`) runs a little thinner at
 * the tail (about `u^1.35`); straight sides lie between the two.
 */
const WHITE_ARROW_TAPER = 1.2;

/** A cleft tail's depth, as a share of the neck: the push arrow's. */
const WHITE_ARROW_CLEFT = DIAGRAM_PUSH_INK.cleft / (2 * DIAGRAM_PUSH_INK.shaftHalf);

/**
 * The shortest shaft a white arrow is drawn with at its size, in necks: a
 * shorter path draws the same shape smaller, as a short push does. A head
 * alone would read as a white triangle, not an arrow.
 */
const WHITE_ARROW_LEAST_SHAFT = 1.5;

/**
 * How far round an outline, in necks, an offset's fold is looked for: the
 * swallowtail round a bend tighter than the shaft is wide, a sharp inner
 * corner's overlap, a shaft bent across its own head. Eight covers a corner
 * turned up to about 165°; a loop longer than this is the path's own, drawn
 * over itself, and is kept.
 */
const WHITE_ARROW_FOLD_SPAN = 8;

/** The least turn at a node, in radians, that makes it a corner the outline is mitred round rather than a smooth bend. */
const WHITE_ARROW_CORNER_TURN = Math.PI / 180;

/**
 * A white arrow's outline, from its centreline `path` in the drawing's
 * units: one closed polygon, its corners in order from the tip, or null for
 * a path of no length or a size of nothing.
 *
 * The head is straight-backed, as the template's is: its back stands square
 * across the path's tangent where the shaft meets it, `headLength` short of
 * the path's end, and its tip lies `headLength` on along that tangent — the
 * fold arrows' rule, so the head points the way the shaft runs into it. The
 * shaft is the path up to there, flattened to `tolerance` and offset to each
 * side by half its width: the neck's the whole way for a square or cleft
 * tail, eased from nothing at a pointed tail ({@link WHITE_ARROW_TAPER}).
 * Round a corner node the outside is mitred to {@link WHITE_ARROW_MITER_LIMIT}
 * and bevelled past it; round a smooth bend it is round, as the curve's own
 * offset is. On the inside the two offset runs are cut where they cross, and
 * so is any fold an offset makes where the path bends tighter than half the
 * width (a swallowtail) or the shaft bends across its head: the outline does
 * not cross itself.
 *
 * A hook a handle drawn a hair the wrong way makes at a node — behind the
 * tail, at a corner — is no part of the shaft ({@link withoutHooks}), and no
 * cut of a fold drops the tail.
 *
 * Not supported (v1): a path that crosses itself, or comes back within the
 * arrow's width (or its head's) of itself. Past {@link WHITE_ARROW_FOLD_SPAN}
 * necks along, its outline is drawn as offset, overlapping itself, as no
 * single outline can draw one arrow passing over another; nearer, the loop is
 * taken for an offset's fold and cut away, leaving a sharp turn. Books draw
 * such an arrow in two pieces.
 */
export function whiteArrowOutline(
  path: readonly PathCubic[],
  size: WhiteArrowSize,
  tail: WhiteArrowTail,
  tolerance: number
): Vec2[] | null {
  const measure = measurePath(path);
  const { length } = measure;
  if (!(length > 1e-9) || !Number.isFinite(length)) return null;
  if (![size.neck, size.headLength, size.headWidth].every((v) => v > 0 && Number.isFinite(v))) return null;
  const fit = Math.min(1, length / (size.headLength + WHITE_ARROW_LEAST_SHAFT * size.neck));
  const neck = size.neck * fit;
  const headLength = size.headLength * fit;
  const headWidth = size.headWidth * fit;
  const neckAt = length - headLength;

  const joint = pathPointAt(measure, neckAt);
  const axis = pathTangentAt(measure, neckAt) ?? [1, 0];
  const shaft = trimPath(measure, 0, neckAt);
  // Runs short enough that a taper is drawn as a curve, not a chord: a 24th
  // of the control polygon, as the fold-and-unfold return's are.
  const hull = shaft.reduce((sum, [a, b, c, d]) => sum + dist(a, b) + dist(b, c) + dist(c, d), 0);
  const fine = Math.max(tolerance, length * 1e-6);
  const runs = runsWithCorners(shaft, fine, Math.max(hull / 24, fine));
  if (runs.points.length < 2) return null;
  const { points, corners, hookedStart } = withoutHooks(runs, neck);

  const run = points.reduce((sum, p, index) => (index === 0 ? 0 : sum + dist(points[index - 1]!, p)), 0);
  let travelled = 0;
  const halves = points.map((p, index) => {
    if (index > 0) travelled += dist(points[index - 1]!, p);
    if (tail !== 'pointed') return neck / 2;
    const u = Math.min(1, travelled / run);
    return (neck / 2) * (1 - Math.pow(1 - u, WHITE_ARROW_TAPER));
  });
  const joinAt = (index: number) => (corners[index] ? { miterLimit: WHITE_ARROW_MITER_LIMIT } : ('round' as const));
  const left = offsetRuns(points, halves, 1, joinAt);
  const right = offsetRuns(points, halves, -1, joinAt);

  // Each side's ends square across the path's own tangents, not its first and
  // last runs': the tail is cut, and the neck meets the head's back, exactly.
  const start = points[0]!;
  const first = dist(start, points[1]!);
  const run0: Vec2 = [(points[1]![0] - start[0]) / first, (points[1]![1] - start[1]) / first];
  // The path's own tangent, unless a hook behind the tail turns it: past one
  // dropped, the way the shaft sets off; against one too small to flatten,
  // the first run.
  const tangent = pathTangentAt(measure, 0);
  const lead = hookedStart ?? (tangent && tangent[0] * run0[0] + tangent[1] * run0[1] > 0 ? tangent : run0);
  const across = (p: Vec2, t: Vec2, w: number): Vec2 => [p[0] - t[1] * w, p[1] + t[0] * w];
  left[0] = across(start, lead, halves[0]!);
  right[0] = across(start, lead, -halves[0]!);
  left[left.length - 1] = across(joint, axis, neck / 2);
  right[right.length - 1] = across(joint, axis, -neck / 2);

  const tip: Vec2 = [joint[0] + axis[0] * headLength, joint[1] + axis[1] * headLength];
  const tailPoints: Vec2[] = tail === 'cleft' ? [pathPointAt(measure, WHITE_ARROW_CLEFT * neck)] : [];
  const [leftTail, rightTail] = [left[0]!, right[0]!];
  const ring = [
    tip,
    across(joint, axis, headWidth / 2),
    ...left.reverse(),
    ...tailPoints,
    ...right,
    across(joint, axis, -headWidth / 2),
    tip,
  ].filter((p, index, all) => index === 0 || dist(all[index - 1]!, p) > 1e-12);
  // The tail is the shaft's start, never a fold: no cut drops it.
  const tailFrom = ring.indexOf(leftTail);
  const tailTo = ring.indexOf(rightTail);
  const keep = tailFrom >= 0 && tailTo >= tailFrom ? { from: tailFrom, to: tailTo } : undefined;
  const cut = cutLoops(ring, WHITE_ARROW_FOLD_SPAN * neck, keep);
  cut.pop();
  return withoutStraightCorners(cut);
}

/** How near its node a hook lies, as a share of the neck: an eighth, a pixel or two at a page's size. */
const HOOK_REACH = 8;
/** How far a hook turns, from its first run to the way the path then goes: more than 60°. */
const HOOK_TURN = Math.cos(Math.PI / 3);

/**
 * A path's runs without the hooks a handle drawn a hair the wrong way makes
 * at a node — behind the tail, or across a short leg at a corner: the run
 * leaving the node (or reaching it) sets off one way and, within an eighth
 * of a neck, turns more than 60° to go another. Offset, so sharp a turn so
 * near the node is a hairpin: a cap behind the tail, a fold across the leg.
 * Inside the path it also kinks at the node, against the run that brought
 * the path there. The points that near the node on that side are dropped,
 * and the node meets the shaft straight. A tight bend runs on from the run
 * before it, and a corner turns at the node itself, between runs that run
 * straight: both are kept.
 */
function withoutHooks(
  { points, corners, nodes }: { points: Vec2[]; corners: boolean[]; nodes: number[] },
  neck: number
): { points: Vec2[]; corners: boolean[]; hookedStart: Vec2 | null } {
  const reach = neck / HOOK_REACH;
  const unit = (a: Vec2, b: Vec2): Vec2 | null => {
    const d = dist(a, b);
    return d > 0 ? [(b[0] - a[0]) / d, (b[1] - a[1]) / d] : null;
  };
  const drop = new Set<number>();
  /** Where the tail hooks, the way the shaft sets off past the hook. */
  let hookedStart: Vec2 | null = null;
  for (const node of nodes) {
    for (const step of [1, -1] as const) {
      const at = points[node]!;
      // The points within reach of the node on this side, an end of the run never among them.
      const near: number[] = [];
      let k = node + step;
      for (; k > 0 && k < points.length - 1 && dist(at, points[k]!) < reach; k += step) near.push(k);
      if (near.length === 0 || k < 0 || k >= points.length) continue;
      // The way the path goes once out of reach: from there, a reach on.
      let far = k;
      while (far + step >= 0 && far + step < points.length && dist(points[k]!, points[far]!) < reach) far += step;
      const first = unit(at, points[node + step]!);
      const way = unit(points[k]!, points[far]!);
      if (!first || !way || first[0] * way[0] + first[1] * way[1] >= HOOK_TURN) continue;
      // Inside the path a hook kinks at the node; a tight bend runs on from the run before it.
      const before = points[node - step];
      const into = before ? unit(before, at) : null;
      if (into && into[0] * first[0] + into[1] * first[1] >= HOOK_TURN) continue;
      if (node === 0 && step === 1) hookedStart = way;
      for (const index of near) drop.add(index);
    }
  }
  if (drop.size === 0) return { points, corners, hookedStart };
  const kept = points.map((_, index) => index).filter((index) => !drop.has(index));
  return { points: kept.map((index) => points[index]!), corners: kept.map((index) => corners[index]!), hookedStart };
}

/**
 * A path's runs ({@link flattenCubic}, no longer than `longest`), each point
 * once, with whether the path turns a corner at it: a node where the way in
 * and the way out — past any segment of no length, by `pathTangentAt`'s rule
 * — part by more than a hair.
 */
function runsWithCorners(
  path: readonly PathCubic[],
  tolerance: number,
  longest: number
): { points: Vec2[]; corners: boolean[]; nodes: number[] } {
  const points: Vec2[] = [];
  const corners: boolean[] = [];
  /** Each node's index among the points: where each cubic starts, and the path's end. */
  const nodes: number[] = [];
  const add = (p: Vec2, corner: boolean) => {
    const last = points[points.length - 1];
    if (last && dist(last, p) <= 1e-12) {
      corners[corners.length - 1] ||= corner;
      return;
    }
    points.push(p);
    corners.push(corner);
  };
  const turnsAt = (index: number) => {
    let into: Vec2 | null = null;
    for (let j = index - 1; j >= 0 && !into; j -= 1) into = cubicTangent(path[j]!, 1);
    let out: Vec2 | null = null;
    for (let j = index; j < path.length && !out; j += 1) out = cubicTangent(path[j]!, 0);
    return !!into && !!out && into[0] * out[0] + into[1] * out[1] < Math.cos(WHITE_ARROW_CORNER_TURN);
  };
  path.forEach((cubic, index) => {
    flattenCubic(cubic, tolerance, longest).forEach((p, k) => {
      add(p, k === 0 && index > 0 && turnsAt(index));
      if (k === 0 && nodes[nodes.length - 1] !== points.length - 1) nodes.push(points.length - 1);
    });
  });
  if (points.length > 0 && nodes[nodes.length - 1] !== points.length - 1) nodes.push(points.length - 1);
  return { points, corners, nodes };
}

/** A closed polygon without the corners it runs straight through, which a straight shaft's runs leave behind. */
function withoutStraightCorners(ring: readonly Vec2[]): Vec2[] {
  const out = ring.filter((p, index) => {
    const a = ring[(index + ring.length - 1) % ring.length]!;
    const b = ring[(index + 1) % ring.length]!;
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0]);
    const ahead = (p[0] - a[0]) * (b[0] - p[0]) + (p[1] - a[1]) * (b[1] - p[1]);
    return !(Math.abs(cross) <= 1e-9 * dist(a, b) ** 2 && ahead > 0);
  });
  return out.length >= 3 ? out : [...ring];
}

/**
 * How far a point is from a hollow glyph's outline — a closed polygon, its
 * corners in order — and 0 inside it. Inside is by the even–odd rule, which
 * answers a concave outline (a curved white arrow's) right; where an outline
 * overlaps itself, the overlap counts as outside, and a press there measures
 * to its nearest edge.
 */
export function outlineDistance(outline: readonly Vec2[], point: Vec2): number {
  if (outline.length === 0) return Infinity;
  const [x, y] = point;
  let inside = false;
  let nearest = Infinity;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i, i += 1) {
    const [xi, yi] = outline[i]!;
    const [xj, yj] = outline[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    const dx = xi - xj;
    const dy = yi - yj;
    const span = dx * dx + dy * dy;
    const t = span > 0 ? Math.min(1, Math.max(0, ((x - xj) * dx + (y - yj) * dy) / span)) : 0;
    nearest = Math.min(nearest, Math.hypot(x - (xj + dx * t), y - (yj + dy * t)));
  }
  return inside ? 0 : nearest;
}

/**
 * The rotate glyph about `centre`, `radius` across, in the drawing's units: a
 * circle drawn as two arrows going the way the model turns, a gap between
 * them, each with a fold arrow's head `head` long. Clockwise is clockwise on
 * the page (the drawing's y is down), whatever the paper's own handedness —
 * it is a symbol for what the folder does, as the turn-over glyph is.
 */
export function rotateGlyph(
  centre: SvgPoint,
  radius: number,
  head: number,
  direction: 'cw' | 'ccw'
): { strokes: [string, string]; heads: [Arrowhead, Arrowhead] } {
  const cw = direction === 'cw';
  const reach = arrowheadReach(head) / Math.max(radius, 1e-9);
  const at = (angle: number): SvgPoint => ({
    x: centre.x + radius * Math.cos(angle),
    y: centre.y + radius * Math.sin(angle),
  });
  // Two arcs of 140°, one over the middle and one under, with 40° gaps at the
  // sides; each runs the way the model turns. Angles grow clockwise on the page.
  const arcs: [number, number][] = [
    [ROTATE_ARC_START, ROTATE_ARC_START + ROTATE_ARC_SWEEP],
    [ROTATE_ARC_START + Math.PI, ROTATE_ARC_START + Math.PI + ROTATE_ARC_SWEEP],
  ];
  const parts = arcs.map(([a, b]) => {
    const [from, to] = cw ? [a, b] : [b, a];
    const end = cw ? to - reach : to + reach;
    const notch = at(end);
    // The direction of travel at the notch: along the tangent, the way the arc runs.
    const travel = cw
      ? { x: -Math.sin(end), y: Math.cos(end) }
      : { x: Math.sin(end), y: -Math.cos(end) };
    const start = at(from);
    const stroke = `M ${pointText(start)} A ${fmt(radius)} ${fmt(radius)} 0 0 ${cw ? 1 : 0} ${pointText(notch)}`;
    return { stroke, head: arrowheadAt(notch, travel, head) };
  });
  return {
    strokes: [parts[0]!.stroke, parts[1]!.stroke],
    heads: [parts[0]!.head, parts[1]!.head],
  };
}

/** Where the rotate glyph's upper arc starts, and how far each arc sweeps (radians, clockwise on the page). */
const ROTATE_ARC_START = (200 * Math.PI) / 180;
const ROTATE_ARC_SWEEP = (140 * Math.PI) / 180;

/** The fraction of a turn the rotate glyph names, as it is printed. */
export const ROTATE_FRACTION: Readonly<Record<'eighth' | 'quarter' | 'half', string>> = {
  eighth: '1/8',
  quarter: '1/4',
  half: '1/2',
};

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

/**
 * What the turn-over symbol covers in its own box: its stroke's control
 * points, which its curves lie within, and its head's corners.
 */
const TURN_OVER_EXTENT = (() => {
  const numbers = TURN_OVER_PATH.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const points: SvgPoint[] = [TURN_OVER_HEAD.tip, TURN_OVER_HEAD.notch, ...TURN_OVER_HEAD.barbs];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push({ x: numbers[i]!, y: numbers[i + 1]! });
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
})();

/**
 * The turn-over glyph as a picture draws it, centred on `at` in sheet units:
 * its transform from its own box, its scale, and the corners of what it
 * covers in the projector's units, turned a quarter for a horizontal axis
 * (none is vertical). Its stroke is the arrow's pen past those.
 */
export function turnOverDrawn(
  at: readonly [number, number],
  axis: 'vertical' | 'horizontal' | undefined,
  project: DiagramProjector
): { centre: SvgPoint; scale: number; transform: string; corners: SvgPoint[] } {
  const centre = project(at);
  const scale = (DIAGRAM_TURN_OVER_INK * project.ink) / TURN_OVER_BOX.width;
  const x = centre.x - (TURN_OVER_BOX.width / 2) * scale;
  const y = centre.y - (TURN_OVER_BOX.height / 2) * scale;
  // A horizontal axis turns the model top to bottom: the glyph a quarter turn round.
  const turned = axis === 'horizontal';
  // Four decimals, as the drawing writes its numbers.
  const round = (value: number) => Number(value.toFixed(4));
  const turn = turned ? `rotate(90 ${round(centre.x)} ${round(centre.y)}) ` : '';
  const place = (px: number, py: number): SvgPoint => {
    const point = { x: x + px * scale, y: y + py * scale };
    // rotate(90) about the centre: (dx, dy) to (-dy, dx).
    return turned ? { x: centre.x - (point.y - centre.y), y: centre.y + (point.x - centre.x) } : point;
  };
  const { minX, minY, maxX, maxY } = TURN_OVER_EXTENT;
  return {
    centre,
    scale,
    transform: `${turn}translate(${round(x)} ${round(y)}) scale(${round(scale)})`,
    corners: [place(minX, minY), place(maxX, minY), place(maxX, maxY), place(minX, maxY)],
  };
}

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
