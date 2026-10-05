/**
 * A fold-and-unfold arrow's return as the drawing derives it, as nodes: what
 * Edit Path shows of a return never shaped by hand, and what the return is
 * written as once one of its nodes is edited (`annotationPath.ts`). An arc's
 * is its own return arc, exactly ({@link arcReturn}); a path's is fitted to
 * the return drawn along it to within {@link RETURN_FIT_INKS}
 * ({@link derivedReturn}). Either way an edit to one part of it leaves the
 * rest where it was drawn.
 *
 * Pure: no DOM, no store.
 */
import { fitCubic, measurePath, nearestOnPath, type Cubic, type Vec2 } from '../../lib/cubicBezier';
import { DIAGRAM_FOLD_RETURN_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { arcExtent, arcThroughPoints, pathReturn, returnStroke } from '../../cp-workspace/references/stepDiagramGeometry';
import type { DiagramPathNode } from '../document/diagramDocument';
import { MAX_PATH_NODES, arrowApex, pathCubics, type PicturePoint } from './annotationModel';
import { INK_UNITS } from './canvasInk';

/** How far, in inks, the curve through a return's nodes may stray from the return drawn: a tenth of a line. */
export const RETURN_FIT_INKS = 0.1;

/**
 * A turn sharper than this where two of the return's runs meet is a corner,
 * and has a node of its own: where the drawing cut out a loop the return
 * would make inside a tight bend. A round join's steps turn less.
 */
const RETURN_CORNER = Math.PI / 9;

/** A place along the return where one of its nodes goes, and whether it is a corner. */
interface Cut {
  distance: number;
  corner: boolean;
}

/** A stretch of the return between two nodes, as fitted: its cubic, how far that strays, and where most. */
interface Piece {
  start: Cut;
  end: Cut;
  cubic: Cubic;
  error: number;
  /** The distance along of the run point farthest from the cubic; null with none between the ends. */
  worst: number | null;
}

/**
 * The return the drawing derives from `out` (`pathReturn`), at the ink the
 * canvas draws in, as nodes from the tip — its first node is the tip — to
 * beside the tail. A piece for each of the path's segments, last first, each
 * its share of the return by length, and a corner node wherever the return
 * turns sharply; then the piece that strays furthest from the drawn return
 * halved where it strays most, while one strays more than
 * {@link RETURN_FIT_INKS} and the return has room for another node. Null for
 * a path of no length.
 */
export function derivedReturn(out: readonly DiagramPathNode[]): DiagramPathNode[] | null {
  const cubics = pathCubics(out);
  const length = measurePath(cubics).length;
  if (!(length > 1e-9)) return null;
  const offset = Math.min(DIAGRAM_FOLD_RETURN_INK.offset * INK_UNITS, DIAGRAM_FOLD_RETURN_INK.ofChord * length);
  const runs = pathReturn(cubics, offset, length * 1e-4);
  const along = runs && measureRuns(runs);
  if (!along || !(along.length > 1e-9)) return null;
  // The return runs tip first: its share cuts are the path's segments last first.
  const shares = cubics.map((cubic) => measurePath([cubic]).length).reverse();
  const cuts = returnCuts(shares, along.length, along.corners(RETURN_CORNER));
  const pieces = cuts.slice(1).map((end, index) => fitPiece(along, cuts[index]!, end));
  const tolerance = RETURN_FIT_INKS * INK_UNITS;
  while (pieces.length < MAX_PATH_NODES - 1) {
    let index = -1;
    pieces.forEach((piece, at) => {
      if (piece.worst !== null && piece.error > tolerance && (index < 0 || piece.error > pieces[index]!.error)) index = at;
    });
    if (index < 0) break;
    const piece = pieces[index]!;
    const middle: Cut = { distance: piece.worst!, corner: false };
    pieces.splice(index, 1, fitPiece(along, piece.start, middle), fitPiece(along, middle, piece.end));
  }
  const point = (p: Vec2): PicturePoint => [p[0], p[1]];
  const nodes: DiagramPathNode[] = pieces.map((piece, index) => ({
    at: point(piece.cubic[0]),
    ...(index > 0 ? { in: point(pieces[index - 1]!.cubic[2]) } : {}),
    out: point(piece.cubic[1]),
    ...(index > 0 && piece.start.corner ? { type: 'corner' as const } : {}),
  }));
  const last = pieces[pieces.length - 1]!.cubic;
  nodes.push({ at: point(last[3]), in: point(last[2]) });
  return nodes;
}

/**
 * The return an arc fold-and-unfold arrow, never shaped, is drawn with
 * (`returnStroke`, as the arc drawing and its hit test build it), as nodes
 * from the tip: one cubic for each quarter turn of it, exactly that arc. An
 * arc is drawn with a return of its own, not a path's ({@link derivedReturn});
 * Edit Path shows that one, so its nodes sit on the line drawn. Null where
 * the arc has none: ends that meet, or a bend of nothing.
 */
export function arcReturn(from: PicturePoint, to: PicturePoint, bend: number): DiagramPathNode[] | null {
  const up = ([x, y]: readonly [number, number]): [number, number] => [x, -y];
  const out = arcThroughPoints(up(from), up(arrowApex(from, to, bend)), up(to));
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const offset = Math.min(DIAGRAM_FOLD_RETURN_INK.offset * INK_UNITS, DIAGRAM_FOLD_RETURN_INK.ofChord * chord);
  const back = out && returnStroke(out, offset);
  if (!back) return null;
  const sweep = arcExtent(back);
  if (!(sweep > 1e-9)) return null;
  const turn = back.ccw ? 1 : -1;
  const pieces = Math.max(1, Math.ceil(sweep / (Math.PI / 2) - 1e-9));
  const step = sweep / pieces;
  const handle = (4 / 3) * Math.tan(step / 4) * back.radius;
  const nodes: DiagramPathNode[] = [];
  for (let index = 0; index <= pieces; index += 1) {
    const angle = back.from + turn * step * index;
    // Back to the picture's y-down: the point and its tangent flipped.
    const onArc: PicturePoint = [back.center[0] + back.radius * Math.cos(angle), -(back.center[1] + back.radius * Math.sin(angle))];
    const at: PicturePoint = index === 0 ? [to[0], to[1]] : onArc;
    const tangent: PicturePoint = [-Math.sin(angle) * turn, -Math.cos(angle) * turn];
    nodes.push({
      at,
      ...(index > 0 ? { in: [at[0] - tangent[0] * handle, at[1] - tangent[1] * handle] as PicturePoint } : {}),
      ...(index < pieces ? { out: [at[0] + tangent[0] * handle, at[1] + tangent[1] * handle] as PicturePoint } : {}),
    });
  }
  return nodes;
}

/**
 * Where the return's nodes go before any piece is halved: its ends, a cut
 * for each share but the last, and its corners — a share's cut that falls
 * within a quarter of a share of a corner moved onto it. The share cuts give
 * way first should there be more than a return holds.
 */
function returnCuts(shares: readonly number[], length: number, corners: readonly number[]): Cut[] {
  const total = shares.reduce((sum, share) => sum + share, 0);
  const near = length / (4 * shares.length);
  const smooth: number[] = [];
  let travelled = 0;
  for (const share of shares.slice(0, -1)) {
    travelled += (share / total) * length;
    if (!corners.some((corner) => Math.abs(corner - travelled) < near)) smooth.push(travelled);
  }
  const inner = [
    ...corners.map((distance) => ({ distance, corner: true })),
    ...(corners.length + smooth.length < MAX_PATH_NODES - 1 ? smooth.map((distance) => ({ distance, corner: false })) : []),
  ].sort((a, b) => a.distance - b.distance);
  return [{ distance: 0, corner: false }, ...inner, { distance: length, corner: false }];
}

/** The cubic that best follows the return between two cuts, leaving each the way the runs do there. */
function fitPiece(along: MeasuredRuns, start: Cut, end: Cut): Piece {
  const { points, distances } = along.between(start.distance, end.distance);
  const leaving = start.corner ? along.leaving(start.distance) : along.heading(start.distance);
  const arriving = end.corner ? along.arriving(end.distance) : along.heading(end.distance);
  const cubic = fitCubic(points, leaving, [-arriving[0], -arriving[1]]);
  let error = 0;
  let worst: number | null = null;
  for (let index = 1; index < points.length - 1; index += 1) {
    const off = nearestOnPath([cubic], points[index]!)?.distance ?? 0;
    if (off > error || worst === null) {
      error = Math.max(error, off);
      worst = distances[index]!;
    }
  }
  return { start, end, cubic, error, worst };
}

type MeasuredRuns = ReturnType<typeof measureRuns>;

/**
 * Runs measured along: how far each point lies from the first, the points
 * between two distances, the way the runs head arriving at a distance and
 * leaving it, and where they turn sharply. Points that repeat are taken once.
 */
function measureRuns(runs: readonly Vec2[]) {
  const points = runs.filter((p, index) => index === 0 || Math.hypot(p[0] - runs[index - 1]![0], p[1] - runs[index - 1]![1]) > 1e-12);
  const at = [0];
  for (let i = 1; i < points.length; i += 1) {
    at.push(at[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  }
  const length = at[at.length - 1]!;
  const unit = (index: number): Vec2 => {
    const a = points[index - 1]!;
    const b = points[index]!;
    const run = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / run, (b[1] - a[1]) / run];
  };
  /** The run (by its last point) that reaches `distance`: the first that ends at or past it. */
  const reaching = (distance: number) => {
    let index = 1;
    while (index < points.length - 1 && at[index]! < distance) index += 1;
    return index;
  };
  /** The run that goes on from `distance`: the last that starts at or before it. */
  const goingOn = (distance: number) => {
    let index = points.length - 1;
    while (index > 1 && at[index - 1]! > distance) index -= 1;
    return index;
  };
  const arriving = (distance: number) => unit(reaching(distance));
  const leaving = (distance: number) => unit(goingOn(distance));
  return {
    length,
    arriving,
    leaving,
    /** The way the runs head through `distance`: between the two at a point, smooth there. */
    heading(distance: number): Vec2 {
      const a = arriving(distance);
      const b = leaving(distance);
      const mean: Vec2 = [a[0] + b[0], a[1] + b[1]];
      const size = Math.hypot(mean[0], mean[1]);
      return size > 1e-9 ? [mean[0] / size, mean[1] / size] : b;
    },
    /** The points between two distances, the ends put exactly there, and how far along each is. */
    between(start: number, end: number): { points: Vec2[]; distances: number[] } {
      const pointAt = (distance: number): Vec2 => {
        const index = reaching(distance);
        const a = points[index - 1]!;
        const b = points[index]!;
        const run = at[index]! - at[index - 1]!;
        const t = run > 0 ? Math.min(1, Math.max(0, (distance - at[index - 1]!) / run)) : 0;
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      };
      const inside = points.flatMap((p, index) => (at[index]! > start && at[index]! < end ? [index] : []));
      return {
        points: [pointAt(start), ...inside.map((index) => points[index]!), pointAt(end)],
        distances: [start, ...inside.map((index) => at[index]!), end],
      };
    },
    /** How far along each point is where the runs turn by more than `angle`. */
    corners(angle: number): number[] {
      const found: number[] = [];
      for (let index = 1; index < points.length - 1; index += 1) {
        const a = unit(index);
        const b = unit(index + 1);
        if (Math.atan2(Math.abs(a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1]) > angle) found.push(at[index]!);
      }
      return found;
    },
  };
}
