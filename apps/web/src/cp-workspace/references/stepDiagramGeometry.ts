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
}

/** Margin round the sheet as a fraction of the viewBox side, so labels at a corner fit. */
export const DIAGRAM_PADDING = 0.1;

/**
 * A projector that fits `sheet` into a square `size × size` viewBox, centred,
 * y flipped so the sheet's bottom edge is at the bottom of the picture.
 */
export function createDiagramProjector(sheet: DiagramSheet, size = 100): DiagramProjector {
  const longer = Math.max(sheet.width, sheet.height, Number.EPSILON);
  const pad = size * DIAGRAM_PADDING;
  const scale = (size - 2 * pad) / longer;
  const offsetX = pad + ((longer - sheet.width) * scale) / 2;
  const offsetY = pad + ((longer - sheet.height) * scale) / 2;
  const project = ((point: readonly [number, number]): SvgPoint => ({
    x: offsetX + point[0] * scale,
    y: offsetY + (sheet.height - point[1]) * scale,
  })) as DiagramProjector;
  project.scale = scale;
  project.viewBox = `0 0 ${size} ${size}`;
  project.size = size;
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
  const sweep = arc.ccw ? 0 : 1;
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${fmt(r)} ${fmt(r)} 0 ${large} ${sweep} ${fmt(end.x)} ${fmt(end.y)}`;
}

/**
 * The arc's direction of travel at its end, in SVG space (unit length). For
 * the arrowhead: RF's arrows are arcs with the head at `to`.
 */
export function arcEndDirection(arc: DiagramArc): SvgPoint {
  const tangent = arc.ccw
    ? { x: -Math.sin(arc.to), y: Math.cos(arc.to) }
    : { x: Math.sin(arc.to), y: -Math.cos(arc.to) };
  // y flips with the projection; the radius scales both components equally so
  // the direction is unchanged otherwise.
  return { x: tangent.x, y: -tangent.y };
}

/**
 * A filled arrowhead as SVG polygon `points`: the tip at `tip`, pointing along
 * `direction`, `size` long and two thirds as wide.
 */
export function arrowheadPoints(tip: SvgPoint, direction: SvgPoint, size: number): string {
  const length = Math.hypot(direction.x, direction.y) || 1;
  const ux = direction.x / length;
  const uy = direction.y / length;
  const back = { x: tip.x - ux * size, y: tip.y - uy * size };
  const half = size / 3;
  const left = { x: back.x - uy * half, y: back.y + ux * half };
  const right = { x: back.x + uy * half, y: back.y - ux * half };
  return [tip, left, right].map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
}

export type LabelAnchor = 'start' | 'middle' | 'end';

/**
 * Where a label's text sits relative to its point: pushed away from the sheet's
 * centre so it does not cover the reference it names, and anchored so it does
 * not run off the near edge. Offsets are SVG user units.
 */
export function labelPlacement(
  at: readonly [number, number],
  sheet: DiagramSheet,
  project: DiagramProjector
): { anchor: LabelAnchor; dx: number; dy: number } {
  const offset = project.size * 0.035;
  const cx = sheet.width / 2;
  const cy = sheet.height / 2;
  const edge = 1e-6;
  let anchor: LabelAnchor = 'middle';
  let dx = 0;
  if (at[0] <= cx - edge) {
    anchor = 'end';
    dx = -offset;
  } else if (at[0] >= cx + edge) {
    anchor = 'start';
    dx = offset;
  }
  // Above the point when it sits in the top half (screen up is smaller y),
  // below it otherwise; a text baseline sits above the point by default so the
  // downward offset is larger to clear the glyphs.
  const dy = at[1] >= cy ? -offset * 0.8 : offset * 1.6;
  return { anchor, dx, dy };
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.?0+$/, '');
}
