/**
 * The arithmetic behind a step diagram's SVG, with no DOM in it.
 *
 * ReferenceFinder draws in sheet units with the origin at the bottom-left and
 * y up; SVG has y down. Every primitive goes through the one projector built
 * here, so the flip happens in exactly one place — an arc's sweep direction and
 * an arrowhead's tangent are the two things that go wrong when it happens in
 * two.
 */

export interface DiagramSheet {
  width: number;
  height: number;
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
  /** The `viewBox` attribute for the whole diagram. */
  viewBox: string;
  size: number;
  /** The picture is of the paper's back, so x runs the other way. */
  mirrored: boolean;
}

/** Margin round the sheet as a fraction of the viewBox side, so labels at a corner fit. */
export const DIAGRAM_PADDING = 0.1;

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
  mirrored = false
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
  project.viewBox = `0 0 ${size} ${size}`;
  project.size = size;
  project.mirrored = mirrored;
  return project;
}

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
export function arcEndDirection(arc: DiagramArc, mirrored = false): SvgPoint {
  const tangent = arc.ccw
    ? { x: -Math.sin(arc.to), y: Math.cos(arc.to) }
    : { x: Math.sin(arc.to), y: -Math.cos(arc.to) };
  // y flips with the projection, and x flips again when it draws the back; the
  // radius scales both components equally so the direction is unchanged
  // otherwise.
  return { x: mirrored ? -tangent.x : tangent.x, y: -tangent.y };
}

/**
 * The arc's direction of travel at its start, reversed — the direction an
 * arrowhead placed at `from` points in. Upstream's `fromDir`.
 */
export function arcStartDirection(arc: DiagramArc, mirrored = false): SvgPoint {
  const tangent = arc.ccw
    ? { x: -Math.sin(arc.from), y: Math.cos(arc.from) }
    : { x: Math.sin(arc.from), y: -Math.cos(arc.from) };
  return { x: mirrored ? tangent.x : -tangent.x, y: tangent.y };
}

/** Half-angle of a fold arrow's arc — upstream's `ha`, 30°. */
const ARROW_HALF_ANGLE = Math.PI / 6;

/**
 * The arc of a fold arrow from `fromPt` to its image `toPt`.
 *
 * A port of `RefDgmr::CalcArrow` (`third_party/reference-finder/src/core/class/
 * refDgmr.cpp:29`), verbatim including its choice of centre: the arc subtends
 * 60°, and of the two centres that give that, the one *farther* from the sheet's
 * middle is taken so the arrow bulges inward. ReferenceFinder's own steps arrive
 * with the arc already computed and are not routed through this; the planner
 * ships witnesses instead, so its arrows are drawn here — and drawn by upstream's
 * construction rather than a nearby one, so the two picture languages match.
 *
 * Null when the two points coincide, which is a fold that moves nothing.
 */
export function foldArrowArc(
  fromPt: readonly [number, number],
  toPt: readonly [number, number],
  sheet: DiagramSheet
): DiagramArc | null {
  const dx = toPt[0] - fromPt[0];
  const dy = toPt[1] - fromPt[1];
  if (Math.hypot(dx, dy) <= 1e-9) return null;
  const mid: [number, number] = [(fromPt[0] + toPt[0]) / 2, (fromPt[1] + toPt[1]) / 2];
  // `0.5 * mu.Rotate90() / tan(ha)`: the offset from the midpoint to either
  // centre of curvature. Rotate90 is (x, y) -> (-y, x).
  const tana = Math.tan(ARROW_HALF_ANGLE);
  const mup: [number, number] = [(0.5 * -dy) / tana, (0.5 * dx) / tana];
  const target: [number, number] = [sheet.width / 2, sheet.height / 2];
  const c1: [number, number] = [mid[0] + mup[0], mid[1] + mup[1]];
  const c2: [number, number] = [mid[0] - mup[0], mid[1] - mup[1]];
  const far = (c: [number, number]) => Math.hypot(c[0] - target[0], c[1] - target[1]);
  const center = far(c1) > far(c2) ? c1 : c2;
  const radius = Math.hypot(toPt[0] - center[0], toPt[1] - center[1]);
  const from = Math.atan2(fromPt[1] - center[1], fromPt[0] - center[0]);
  const to = Math.atan2(toPt[1] - center[1], toPt[0] - center[0]);
  let ra = to - from;
  while (ra < 0) ra += TWO_PI;
  while (ra > TWO_PI) ra -= TWO_PI;
  return { center, radius, from, to, ccw: ra < Math.PI };
}

/**
 * How long an arrow's heads should be, in sheet units — upstream's rule, ported
 * from the tail of `CalcArrow` (`refDgmr.cpp:60-67`).
 *
 * `0.15` of the paper's shorter side, capped at `0.4` of the chord the arrow
 * spans so a short arrow does not become two touching triangles. We had a flat
 * `0.05` of the viewBox instead, which is a third of upstream's head on a square
 * sheet and does not shrink on a short arrow at all — the two ends of a small
 * arc overlapped, and every head was too faint to read at thumbnail size.
 *
 * The chord is recovered from the arc rather than passed in, because that is
 * what the drawing has: an arc is stored by centre, radius and two angles.
 */
export function arrowheadSize(arc: DiagramArc, sheet: DiagramSheet): number {
  const from = pointOnArc(arc, arc.from);
  const to = pointOnArc(arc, arc.to);
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return Math.min(Math.min(sheet.width, sheet.height) * 0.15, 0.4 * chord);
}

/**
 * A filled arrowhead as SVG polygon `points`: the tip at `tip`, pointing along
 * `direction`, `size` long and two thirds as wide.
 */
export function arrowheadPoints(tip: SvgPoint, direction: SvgPoint, size: number): string {
  const back = arrowheadBase(tip, direction, size);
  const length = Math.hypot(direction.x, direction.y) || 1;
  const ux = direction.x / length;
  const uy = direction.y / length;
  const half = size / ARROWHEAD_ASPECT;
  const left = { x: back.x - uy * half, y: back.y + ux * half };
  const right = { x: back.x + uy * half, y: back.y - ux * half };
  return [tip, left, right].map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

/**
 * Where an arrowhead's base sits: `size` back from the tip along `direction`.
 *
 * The base is perpendicular to `direction` by construction, so a stroke that
 * stops here meets the head square on rather than running through it to the
 * point. Exported so the arc can be trimmed to exactly this spot.
 */
export function arrowheadBase(tip: SvgPoint, direction: SvgPoint, size: number): SvgPoint {
  const length = Math.hypot(direction.x, direction.y) || 1;
  return {
    x: tip.x - (direction.x / length) * size,
    y: tip.y - (direction.y / length) * size,
  };
}

/**
 * The turn-over symbol, verbatim from `images/turn_over_symbol.svg`: a stroke
 * that comes in from the left, loops once, and leaves to the right, where the
 * arrowhead is. Its own box is 29 × 14.
 *
 * Transcribed rather than re-derived — an arc-and-circle approximation of a
 * hand-drawn loop is not the same glyph, and this one is the house's.
 */
export const TURN_OVER_PATH =
  'M 25.282 4.923 C 21.103 -0.049 13.926 1.855 13.926 1.855 ' +
  'C 8.533 2.887 8.711 7.191 8.711 7.191 ' +
  'C 8.698 9.071 9.698 10.738 11.328 11.674 ' +
  'C 12.958 12.610 14.966 12.596 16.583 11.638 ' +
  'C 18.200 10.679 19.176 8.925 19.138 7.046 ' +
  'C 19.138 7.046 19.318 2.887 13.925 1.855 ' +
  'C 13.925 1.855 5.675 0.094 1.496 5.066';
/** The symbol's own coordinate box, and where the arrowhead sits on it. */
export const TURN_OVER_BOX = { width: 29, height: 14 } as const;
/**
 * The stroke's arrowhead end, the direction it points, and how long the head
 * is — all in the symbol's own box.
 *
 * The angle is the reverse of the path's opening tangent: the stroke leaves
 * (25.282, 4.923) toward its first control point at (21.103, −0.049), so the
 * head points back the other way. The length is set to give the reference
 * glyph's base width at this file's 2.5 : 1 aspect.
 */
export const TURN_OVER_HEAD = { at: [25.282, 4.923] as const, angle: 0.872, size: 4.1 };

/**
 * How long an arrowhead is against its half-width.
 *
 * `images/arrow_head.svg` is a triangle 5.7005 long on a half-base of 2.2805 —
 * exactly 2.5 : 1. The head drawn here was 3 : 1, which reads as a dart.
 */
export const ARROWHEAD_ASPECT = 2.5;

export type LabelAnchor = 'start' | 'middle' | 'end';

/**
 * Where a label's text sits relative to its point: pushed away from the sheet's
 * centre so it does not cover the reference it names, and anchored so it does
 * not run off the near edge. Offsets are SVG user units.
 *
 * Decided in **projected** space, not sheet space. The offset is applied in SVG
 * user units, and a mirrored projector gives the two spaces opposite
 * handedness — reading the side off the sheet would push every label on a
 * back-side card inward, over the drawing, and leave the margin it was aimed at
 * empty.
 */
export function labelPlacement(
  at: readonly [number, number],
  sheet: DiagramSheet,
  project: DiagramProjector
): { anchor: LabelAnchor; dx: number; dy: number } {
  const offset = project.size * 0.035;
  const centre = project([sheet.width / 2, sheet.height / 2]);
  const point = project(at);
  const edge = 1e-6 * project.scale;
  let anchor: LabelAnchor = 'middle';
  let dx = 0;
  if (point.x <= centre.x - edge) {
    anchor = 'end';
    dx = -offset;
  } else if (point.x >= centre.x + edge) {
    anchor = 'start';
    dx = offset;
  }
  // Above the point when it sits in the top half (screen up is smaller y),
  // below it otherwise; a text baseline sits above the point by default so the
  // downward offset is larger to clear the glyphs.
  const dy = point.y <= centre.y ? -offset * 0.8 : offset * 1.6;
  return { anchor, dx, dy };
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}
