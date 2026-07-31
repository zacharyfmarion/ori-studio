/**
 * Turning a crease pattern into something comparable.
 *
 * Naive segment-set equality fails immediately on real drawings:
 *
 *  - The engine does not split creases where they cross, so one user might draw
 *    a crease as a single stroke and another as two collinear halves. Both are
 *    the same pattern.
 *  - Endpoints land wherever snapping put them, so exact float equality is the
 *    wrong test.
 *  - A segment has no inherent direction; `a→b` and `b→a` are one crease.
 *
 * So a pattern is reduced to a canonical form first: drop the paper edge,
 * quantize endpoints, merge every collinear run into maximal chains, and key
 * each chain independently of endpoint order. Two patterns are the same when
 * their canonical forms are.
 */
import type { OristudioCpLineSegment, OristudioCpModel } from '../../engine/oristudioCpTypes';
import { ORIEDITA_PAPER_MAX, ORIEDITA_PAPER_MIN } from '../../lib/creasePatternViewport';

/** Kernel colour for the paper edge. */
const EDGE_COLOR = 'Black0';

/** Default endpoint tolerance, as a fraction of paper width (a 64th). */
export const DEFAULT_TOLERANCE = 1 / 64;

/** Assignment placeholder when only geometry is being compared. */
export const ANY_ASSIGNMENT = '*';

const PAPER_SIZE = ORIEDITA_PAPER_MAX - ORIEDITA_PAPER_MIN;

export interface CanonicalCrease {
  /** Kernel line colour, or {@link ANY_ASSIGNMENT} when assignment is ignored. */
  assignment: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** Order-independent identity, used for set operations. */
  key: string;
  /** Identity ignoring assignment — how a wrong-fold-type crease is spotted. */
  geometryKey: string;
}

export interface CanonicalizeOptions {
  /** Fraction of paper width within which two endpoints are the same point. */
  tolerance?: number;
  /** Include auxiliary/construction lines. Off by default. */
  includeAuxiliary?: boolean;
  /** Treat all assignments as equal, so only geometry is compared. */
  ignoreAssignment?: boolean;
  /** Keep the paper edge. Off by default — every pattern has it, so it is noise. */
  includeEdge?: boolean;
}

interface Interval {
  start: number;
  end: number;
}

/** A maximal set of collinear, same-assignment creases along one infinite line. */
interface CollinearRun {
  assignment: string;
  /** Unit direction, normalized to a canonical half so a↔b cannot differ. */
  dx: number;
  dy: number;
  /** Perpendicular distance from the origin to the line. */
  offset: number;
  /** Extents along the direction, before merging. */
  spans: Interval[];
}

function quantize(value: number, step: number): number {
  // `+ 0` normalizes -0 to 0 so geometrically identical points key identically.
  return Math.round(value / step) * step + 0;
}

/** A segment lying along the paper's boundary, which is not a crease. */
function isPaperEdge(segment: OristudioCpLineSegment, epsilon: number): boolean {
  const onVertical =
    (Math.abs(segment.a.x - ORIEDITA_PAPER_MIN) <= epsilon &&
      Math.abs(segment.b.x - ORIEDITA_PAPER_MIN) <= epsilon) ||
    (Math.abs(segment.a.x - ORIEDITA_PAPER_MAX) <= epsilon &&
      Math.abs(segment.b.x - ORIEDITA_PAPER_MAX) <= epsilon);
  const onHorizontal =
    (Math.abs(segment.a.y - ORIEDITA_PAPER_MIN) <= epsilon &&
      Math.abs(segment.b.y - ORIEDITA_PAPER_MIN) <= epsilon) ||
    (Math.abs(segment.a.y - ORIEDITA_PAPER_MAX) <= epsilon &&
      Math.abs(segment.b.y - ORIEDITA_PAPER_MAX) <= epsilon);
  return onVertical || onHorizontal;
}

/**
 * The infinite line a segment lies on.
 *
 * The direction is normalized to a canonical half (positive x, or positive y
 * when vertical) so `a→b` and `b→a` describe the same line. `offset` is the
 * signed distance from the origin along that direction's normal, which together
 * with the direction identifies the line uniquely.
 *
 * Returns null for a segment too short to have a meaningful direction.
 */
function lineOf(
  segment: OristudioCpLineSegment,
  step: number
): { dx: number; dy: number; offset: number; key: string } | null {
  let dx = segment.b.x - segment.a.x;
  let dy = segment.b.y - segment.a.y;
  const length = Math.hypot(dx, dy);
  if (length <= step / 2) return null;

  dx /= length;
  dy /= length;
  if (dx < 0 || (dx === 0 && dy < 0)) {
    dx = -dx;
    dy = -dy;
  }

  const offset = -dy * segment.a.x + dx * segment.a.y;
  // Quantizing the key (but not the values) is what lets near-parallel,
  // near-coincident creases group together despite float noise.
  const key = `${quantize(dx, 1e-6)},${quantize(dy, 1e-6)},${quantize(offset, step)}`;
  return { dx, dy, offset, key };
}

/** Merge intervals that overlap or touch within tolerance. */
function mergeIntervals(intervals: Interval[], step: number): Interval[] {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    // Touching counts as joined — this is what makes two collinear halves read
    // as the single crease they visually are.
    if (last && interval.start <= last.end + step) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

/**
 * Reduce a pattern to canonical creases: paper edge dropped, endpoints
 * quantized, collinear runs of the same assignment merged into maximal chains.
 */
export function canonicalizeCreasePattern(
  model: OristudioCpModel,
  options: CanonicalizeOptions = {}
): CanonicalCrease[] {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const step = tolerance * PAPER_SIZE;

  const source = options.includeAuxiliary
    ? [...model.line_segments, ...model.aux_line_segments]
    : model.line_segments;

  // Group by (assignment, infinite line). Merging across assignments would
  // silently accept a mountain where a valley was asked for.
  const runs = new Map<string, CollinearRun>();

  for (const segment of source) {
    if (!options.includeEdge && segment.color === EDGE_COLOR && isPaperEdge(segment, step)) {
      continue;
    }
    const line = lineOf(segment, step);
    if (!line) continue;

    const assignment = options.ignoreAssignment ? ANY_ASSIGNMENT : segment.color;
    const groupKey = `${assignment}#${line.key}`;
    const projectionA = segment.a.x * line.dx + segment.a.y * line.dy;
    const projectionB = segment.b.x * line.dx + segment.b.y * line.dy;
    const span = {
      start: Math.min(projectionA, projectionB),
      end: Math.max(projectionA, projectionB),
    };

    const existing = runs.get(groupKey);
    if (existing) {
      existing.spans.push(span);
    } else {
      runs.set(groupKey, {
        assignment,
        dx: line.dx,
        dy: line.dy,
        offset: line.offset,
        spans: [span],
      });
    }
  }

  const creases: CanonicalCrease[] = [];
  for (const run of runs.values()) {
    for (const span of mergeIntervals(run.spans, step)) {
      // A point at distance `t` along the line: `t * direction` plus the line's
      // perpendicular offset along the normal `(-dy, dx)`.
      const ax = quantize(run.dx * span.start - run.dy * run.offset, step);
      const ay = quantize(run.dy * span.start + run.dx * run.offset, step);
      const bx = quantize(run.dx * span.end - run.dy * run.offset, step);
      const by = quantize(run.dy * span.end + run.dx * run.offset, step);

      // Order endpoints so drawing direction cannot change identity.
      const forwardFirst = ax < bx || (ax === bx && ay <= by);
      const [lowX, lowY, highX, highY] = forwardFirst ? [ax, ay, bx, by] : [bx, by, ax, ay];

      const geometryKey = `${lowX},${lowY}|${highX},${highY}`;
      creases.push({
        assignment: run.assignment,
        ax: lowX,
        ay: lowY,
        bx: highX,
        by: highY,
        key: `${run.assignment}|${geometryKey}`,
        geometryKey,
      });
    }
  }

  return creases.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}
