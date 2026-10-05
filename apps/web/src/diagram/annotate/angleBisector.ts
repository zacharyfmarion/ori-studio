/**
 * Annotate's Angle Bisector (implementation-plans/diagram-annotate-second-pass.md,
 * 15b): Edit's — Oriedita's `SQUARE_BISECTOR_7`, which the kernel ports as
 * `square_bisector_*` in `crates/oristudio-cp/src/operations/construction.rs` —
 * worked on a step's picture, in picture units.
 *
 * Three ways, as upstream has them:
 * - **Three points**, the vertex second: the bisector is the vertex's line
 *   through the triangle's incentre ({@link angleIncentre}, the kernel's
 *   `center`). Refused when the first point lies on the line through the
 *   other two: there is no angle.
 * - **Two lines that meet**: the bisector of the angle their far ends span,
 *   from where they cross — the incentre of the crossing and each line's
 *   end farthest from it.
 * - **Two parallel lines**: the midline between them, whose ends are where
 *   it meets two more lines.
 * Each then runs to where its line meets the destination, a line of the
 * picture or one drawn on it, refused when the two are parallel — and, an
 * Ori Studio addition for a picture with no lines (an upload), to a point
 * pressed on no line, projected onto it.
 *
 * Upstream's tolerances are lengths in a crease pattern's units; a picture
 * unit is its frame's longer side, so parallel is told by angle here
 * ({@link PARALLEL_SIN}), and a point on a line by its distance to it over
 * the lengths involved.
 *
 * Pure: no DOM, no store.
 */
import type { PicturePoint } from './annotationModel';

/** A line picked on the picture: one of its own, or a line drawn on it. Its two ends; its line runs on past both. */
export interface PickedLine {
  a: PicturePoint;
  b: PicturePoint;
}

/** What a bisector draws: its line, from the vertex, and the angle its equal-angle mark marks (none between parallels). */
export interface Bisected {
  line: { from: PicturePoint; to: PicturePoint };
  /** The vertex, and a point along each arm: the angle the mark shows halved. */
  angle: { vertex: PicturePoint; arms: readonly [PicturePoint, PicturePoint] } | null;
}

/** Why a bisector cannot be drawn: the points make no angle, its line runs along the one it should end on, or it would have no length. */
export type BisectorRefusal = 'no-angle' | 'parallel' | 'no-length';

/**
 * Two lines are parallel within this sine of the angle between them. A
 * stored picture keeps its points to 0.01 px of a sheet hundreds of px
 * across, so two creases meant parallel lie some 1e-5 apart in angle; a
 * hundredth of a degree is far past that, and far under what an eye tells.
 */
export const PARALLEL_SIN = 2e-4;

const sub = (p: PicturePoint, q: PicturePoint): PicturePoint => [p[0] - q[0], p[1] - q[1]];
const cross = (u: PicturePoint, v: PicturePoint) => u[0] * v[1] - u[1] * v[0];
const length = (u: PicturePoint) => Math.hypot(u[0], u[1]);
const distance = (p: PicturePoint, q: PicturePoint) => length(sub(p, q));

/**
 * The incentre of the triangle `a`, `b`, `c`: where its angle bisectors
 * meet — the point the kernel's `center` finds by crossing two of them
 * (the tests hold the two alike), here as the corners' mean weighted by the
 * sides opposite them, which divides by nothing that can vanish.
 */
export function angleIncentre(a: PicturePoint, b: PicturePoint, c: PicturePoint): PicturePoint {
  const sa = distance(b, c);
  const sb = distance(c, a);
  const sc = distance(a, b);
  const sum = sa + sb + sc;
  return [(sa * a[0] + sb * b[0] + sc * c[0]) / sum, (sa * a[1] + sb * b[1] + sc * c[1]) / sum];
}

/** Whether the lines along `u` and `v` run parallel ({@link PARALLEL_SIN}). */
export function runParallel(u: PicturePoint, v: PicturePoint): boolean {
  const lengths = length(u) * length(v);
  return !(lengths > 0) || Math.abs(cross(u, v)) <= PARALLEL_SIN * lengths;
}

/** Where the line through `p` along `u` meets the line through `q` along `v`; null when they are parallel. */
export function lineCrossing(p: PicturePoint, u: PicturePoint, q: PicturePoint, v: PicturePoint): PicturePoint | null {
  if (runParallel(u, v)) return null;
  const t = cross(sub(q, p), v) / cross(u, v);
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}

/** `at` projected onto the line through `p` along `u`. */
function projectOnto(at: PicturePoint, p: PicturePoint, u: PicturePoint): PicturePoint {
  const t = ((at[0] - p[0]) * u[0] + (at[1] - p[1]) * u[1]) / (u[0] * u[0] + u[1] * u[1]);
  return [p[0] + u[0] * t, p[1] + u[1] * t];
}

/** Whether `p` lies on the line through `a` and `b`: upstream's `is_point_within_line_span`, by angle. */
function onLineThrough(p: PicturePoint, a: PicturePoint, b: PicturePoint): boolean {
  const ab = sub(b, a);
  const ap = sub(p, a);
  if (!(length(ab) > 0) || !(length(ap) > 0) || !(distance(p, b) > 0)) return true;
  return Math.abs(cross(ab, ap)) <= PARALLEL_SIN * length(ab) * length(ap);
}

/**
 * The end of a line from `vertex` along `direction` at `destination`: where
 * it meets that line, or the press it was let go at projected onto it.
 */
function endAt(vertex: PicturePoint, direction: PicturePoint, destination: PickedLine | PicturePoint): PicturePoint | BisectorRefusal {
  if (Array.isArray(destination)) return projectOnto(destination, vertex, direction);
  const along = sub(destination.b, destination.a);
  return lineCrossing(vertex, direction, destination.a, along) ?? 'parallel';
}

function drawn(from: PicturePoint, to: PicturePoint | BisectorRefusal, angle: Bisected['angle']): Bisected | BisectorRefusal {
  if (typeof to === 'string') return to;
  return distance(from, to) > 0 ? { line: { from, to }, angle } : 'no-length';
}

/** The bisector of the angle at `vertex` between `first` and `third`, run to `destination`: upstream's three-point way. */
export function bisectFromPoints(
  first: PicturePoint,
  vertex: PicturePoint,
  third: PicturePoint,
  destination: PickedLine | PicturePoint
): Bisected | BisectorRefusal {
  if (onLineThrough(first, vertex, third)) return 'no-angle';
  const direction = sub(angleIncentre(first, vertex, third), vertex);
  return drawn(vertex, endAt(vertex, direction, destination), { vertex, arms: [first, third] });
}

/** The end of `line` farther from `point`: upstream's `determine_furthest_endpoint`. */
function farEnd(line: PickedLine, point: PicturePoint): PicturePoint {
  return distance(line.a, point) >= distance(line.b, point) ? line.a : line.b;
}

/**
 * Where two picked lines cross, run on past their ends; null when they are
 * parallel, which is the midline's way ({@link parallelMidline}).
 */
export function linesCrossing(first: PickedLine, second: PickedLine): PicturePoint | null {
  return lineCrossing(first.a, sub(first.b, first.a), second.a, sub(second.b, second.a));
}

/**
 * The bisector of the angle two lines that meet span with their far ends,
 * from where they cross, run to `destination`: upstream's two-line way.
 * Null when they are parallel.
 */
export function bisectFromLines(
  first: PickedLine,
  second: PickedLine,
  destination: PickedLine | PicturePoint
): Bisected | BisectorRefusal | null {
  const vertex = linesCrossing(first, second);
  if (!vertex) return null;
  const arms: [PicturePoint, PicturePoint] = [farEnd(first, vertex), farEnd(second, vertex)];
  if (!(distance(arms[0], vertex) > 0) || !(distance(arms[1], vertex) > 0)) return 'no-angle';
  const direction = sub(angleIncentre(arms[0], vertex, arms[1]), vertex);
  return drawn(vertex, endAt(vertex, direction, destination), { vertex, arms });
}

/** The line halfway between two parallel lines: a point on it, and its direction. */
export interface Midline {
  at: PicturePoint;
  along: PicturePoint;
}

/**
 * The midline between two parallel lines, as upstream's indicator: through
 * the middle of the second line's first end and its foot on the first,
 * along the first. Null when they are not parallel, or are one line.
 */
export function parallelMidline(first: PickedLine, second: PickedLine): Midline | null {
  const along = sub(first.b, first.a);
  if (!runParallel(along, sub(second.b, second.a))) return null;
  const foot = projectOnto(second.a, first.a, along);
  if (!(distance(foot, second.a) > 0)) return null;
  return { at: [(second.a[0] + foot[0]) / 2, (second.a[1] + foot[1]) / 2], along };
}

/**
 * The midline between two parallel lines, from where it meets one
 * destination to where it meets the other: upstream's parallel way. A
 * destination parallel to the sources (and so to the midline) is refused, as
 * upstream refuses it, and two destinations that are one line.
 */
export function bisectBetween(
  midline: Midline,
  firstEnd: PickedLine | PicturePoint,
  secondEnd: PickedLine | PicturePoint
): Bisected | BisectorRefusal {
  const from = endAt(midline.at, midline.along, firstEnd);
  if (typeof from === 'string') return from;
  return drawn(from, endAt(midline.at, midline.along, secondEnd), null);
}

/** What a press offers a pick: the point it snapped to, the line under it, and where it is (or was put down freely). */
export interface BisectorPress {
  point: PicturePoint | null;
  line: PickedLine | null;
  at: PicturePoint;
}

/**
 * The picks so far: points (up to three, the vertex second), lines (up to
 * two that meet), or two parallel lines and the first of their ends.
 */
export type BisectorPicks =
  | { kind: 'points'; points: readonly PicturePoint[] }
  | { kind: 'lines'; lines: readonly PickedLine[] }
  | { kind: 'parallel'; lines: readonly [PickedLine, PickedLine]; midline: Midline; ends: readonly (PickedLine | PicturePoint)[] };

export const NO_PICKS: BisectorPicks = { kind: 'points', points: [] };

/** What the next press is for, for the tool window to say. */
export type BisectorStep =
  | 'first'
  | 'vertex'
  | 'third'
  | 'end'
  | 'second-line'
  | 'line-end'
  | 'parallel-first-end'
  | 'parallel-second-end';

export function bisectorStep(picks: BisectorPicks): BisectorStep {
  switch (picks.kind) {
    case 'points':
      return (['first', 'vertex', 'third', 'end'] as const)[Math.min(picks.points.length, 3)]!;
    case 'lines':
      return picks.lines.length < 2 ? 'second-line' : 'line-end';
    case 'parallel':
      return picks.ends.length === 0 ? 'parallel-first-end' : 'parallel-second-end';
  }
}

/** A press's result: the picks after it, and — the last one — what it drew, or why it could not. */
export interface BisectorPicked {
  picks: BisectorPicks;
  drawn?: Bisected;
  refused?: BisectorRefusal;
}

/**
 * The picks after a press. The first decides the way, a point first as Edit
 * does: a press on a point (or on nothing) starts three points, a press on a
 * line two lines. The last runs the bisector to the line pressed, or where
 * the press is; a refusal starts again.
 */
export function bisectorPick(picks: BisectorPicks, press: BisectorPress): BisectorPicked {
  const destination = press.line ?? press.at;
  switch (picks.kind) {
    case 'points': {
      if (picks.points.length === 0 && press.point === null && press.line !== null) {
        return { picks: { kind: 'lines', lines: [press.line] } };
      }
      if (picks.points.length < 3) return { picks: { kind: 'points', points: [...picks.points, press.point ?? press.at] } };
      const [first, vertex, third] = picks.points as [PicturePoint, PicturePoint, PicturePoint];
      return finished(bisectFromPoints(first, vertex, third, destination));
    }
    case 'lines': {
      if (picks.lines.length < 2) {
        // A second line is needed: a press on none picks nothing.
        if (press.line === null) return { picks };
        const [first] = picks.lines as [PickedLine];
        const midline = parallelMidline(first, press.line);
        if (midline) return { picks: { kind: 'parallel', lines: [first, press.line], midline, ends: [] } };
        if (!linesCrossing(first, press.line)) return { picks: NO_PICKS, refused: 'no-angle' };
        return { picks: { kind: 'lines', lines: [first, press.line] } };
      }
      const [first, second] = picks.lines as [PickedLine, PickedLine];
      const result = bisectFromLines(first, second, destination);
      return finished(result ?? 'no-angle');
    }
    case 'parallel': {
      // Upstream's filter: an end runs to a line that crosses the midline.
      if (press.line && runParallel(sub(press.line.b, press.line.a), picks.midline.along)) {
        return { picks, refused: 'parallel' };
      }
      if (picks.ends.length === 0) return { picks: { ...picks, ends: [destination] } };
      return finished(bisectBetween(picks.midline, picks.ends[0]!, destination));
    }
  }
}

function finished(result: Bisected | BisectorRefusal): BisectorPicked {
  return typeof result === 'string' ? { picks: NO_PICKS, refused: result } : { picks: NO_PICKS, drawn: result };
}

/** The picks with the last taken back — Escape's step — or null when there were none. */
export function bisectorUnpick(picks: BisectorPicks): BisectorPicks | null {
  switch (picks.kind) {
    case 'points':
      return picks.points.length === 0 ? null : { kind: 'points', points: picks.points.slice(0, -1) };
    case 'lines':
      return picks.lines.length === 1 ? NO_PICKS : { kind: 'lines', lines: picks.lines.slice(0, 1) };
    case 'parallel':
      return picks.ends.length > 0 ? { ...picks, ends: [] } : { kind: 'lines', lines: [picks.lines[0]] };
  }
}

/**
 * What the bisector would draw were the next press `press`: the preview the
 * canvas shows under the pointer once only the destination is left. Null
 * before that, or for a press that would be refused.
 */
export function bisectorPreview(picks: BisectorPicks, press: BisectorPress): Bisected | null {
  const ready =
    (picks.kind === 'points' && picks.points.length === 3) ||
    (picks.kind === 'lines' && picks.lines.length === 2) ||
    (picks.kind === 'parallel' && picks.ends.length === 1);
  if (!ready) return null;
  const { drawn } = bisectorPick(picks, press);
  return drawn ?? null;
}
