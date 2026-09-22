/**
 * The flat figure's aux creases as the canvas draws them: the kernel's folded
 * aux lines, eroded, and — on opaque paper — cut down to where their face
 * shows.
 *
 * The canvas draws the flat figure from the oracle-checked drawer's stream
 * (D6). Under `Paper5` that is one fill per subface in the colour of the face
 * on top of it, and no buried layer anywhere in it. The kernel's paper scene
 * carries an aux line for every face it crosses, buried or not, so drawn as
 * they come the pieces under other layers would show through fills that in
 * the export are covered by the whole faces painted over them. There is
 * nothing here to cover them with, so each piece is instead clipped to the
 * subfaces whose stack has its face on top — the exact region of the figure
 * where the drawer shows that face — and the rest is left out. Same picture,
 * reached from the other side.
 *
 * Under `Transparent3` and `Wire2` the drawer shows every layer — a
 * translucent fill per face, or every outline — so a buried face's creases
 * show with it: every eroded piece is drawn and nothing is clipped. (The
 * export of such a figure is the opaque picture, every layer kept, whose
 * buried pieces the painter covers in order; the canvas has no cover, and
 * draws what its own fills show.)
 *
 * Erode comes first (D8): an endpoint on its face's outline retreats by the
 * style's fraction of the sheet, in the scene's own units, with the shared
 * rule (`auxLineOnBoundary`) and pull (`erodeSegment`); a cut a subface edge
 * makes afterwards is where the face goes under another and never retreats.
 *
 * Coordinates in and out are the render snapshot's, so the result maps onto
 * the canvas exactly as the snapshot's own primitives do.
 */

import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { erodeSegment } from '../../lib/paper/paperSvg';
import { auxLineOnBoundary, foldedSceneEpsilon } from './foldedFlatScene';

/** One drawn piece of an aux crease, in the render snapshot's coordinates. */
export interface FoldedFlatAuxSegment {
  a: Point;
  b: Point;
}

/**
 * How much of the figure the drawer shows for the pieces to be cut to: the
 * top face of every stack (`Paper5`), or every layer (`Transparent3`, `Wire2`).
 */
export type FoldedFlatAuxCoverage = 'top-face' | 'every-layer';

/** The coverage a display style draws the flat figure with. */
export function foldedFlatAuxCoverage(
  displayStyle: OristudioCpFoldedFigureDisplayStyle
): FoldedFlatAuxCoverage {
  return displayStyle === 'Transparent3' || displayStyle === 'Wire2' ? 'every-layer' : 'top-face';
}

/**
 * The aux pieces to draw for `kernel`, at `erode` (a fraction of the sheet),
 * cut to `coverage`. Empty when the figure carries no aux lines.
 */
export function foldedFlatAuxSegments(
  kernel: OristudioCpFoldedPaperScene,
  erode: number,
  coverage: FoldedFlatAuxCoverage = 'top-face'
): FoldedFlatAuxSegment[] {
  if (kernel.aux_lines.length === 0) return [];
  const epsilon = foldedSceneEpsilon(kernel);
  const distance = Math.max(0, erode) * kernel.sheet;
  const shown = coverage === 'top-face' ? shownRegions(kernel) : null;
  const out: FoldedFlatAuxSegment[] = [];
  for (const aux of kernel.aux_lines) {
    const eroded = erodeSegment(
      [aux.from.x, aux.from.y],
      [aux.to.x, aux.to.y],
      auxLineOnBoundary(kernel, aux, epsilon),
      distance
    );
    if (!eroded) continue;
    const a = { x: eroded[0][0], y: eroded[0][1] };
    const b = { x: eroded[1][0], y: eroded[1][1] };
    if (!shown) {
      out.push({ a, b });
      continue;
    }
    for (const piece of clipToRegions(a, b, shown.get(aux.face) ?? [], epsilon)) out.push(piece);
  }
  return out;
}

/** Per face, the subface polygons whose stack has that face on top. */
function shownRegions(kernel: OristudioCpFoldedPaperScene): Map<number, Point[][]> {
  const regions = new Map<number, Point[][]>();
  for (const { polygon, faces_top_to_bottom: stack } of kernel.subfaces) {
    const top = stack[0];
    if (top === undefined || polygon.length < 3) continue;
    const list = regions.get(top);
    if (list) list.push(polygon);
    else regions.set(top, [polygon]);
  }
  return regions;
}

/**
 * The parts of `a`→`b` inside the union of `regions`, as maximal runs.
 *
 * Every crossing of a region edge is a candidate cut; between consecutive
 * cuts the segment is wholly in or wholly out of the union, so the midpoint
 * decides, and consecutive inside intervals are joined so a piece running
 * across several subfaces of one face is one stroke with no seam.
 */
export function clipToRegions(
  a: Point,
  b: Point,
  regions: readonly (readonly Point[])[],
  epsilon: number
): FoldedFlatAuxSegment[] {
  if (regions.length === 0) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (!(length > epsilon)) return [];
  const cuts = [0, 1];
  for (const polygon of regions) {
    for (let i = 0; i < polygon.length; i += 1) {
      const t = crossing(a, dx, dy, polygon[i]!, polygon[(i + 1) % polygon.length]!);
      if (t !== undefined && t > 0 && t < 1) cuts.push(t);
    }
  }
  cuts.sort((l, r) => l - r);
  const at = (t: number): Point => ({ x: a.x + dx * t, y: a.y + dy * t });
  const out: FoldedFlatAuxSegment[] = [];
  let open: { start: number; end: number } | null = null;
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const start = cuts[i]!;
    const end = cuts[i + 1]!;
    // A run below the tolerance is a seam, not a piece; it neither opens nor
    // closes one, so a piece continues across it.
    if ((end - start) * length <= epsilon) continue;
    const inside = regions.some((polygon) => contains(polygon, at((start + end) / 2), epsilon));
    if (inside) {
      if (open) open.end = end;
      else open = { start, end };
    } else if (open) {
      out.push({ a: at(open.start), b: at(open.end) });
      open = null;
    }
  }
  if (open) out.push({ a: at(open.start), b: at(open.end) });
  return out;
}

/**
 * Where `a + t·d` crosses the edge `p`→`q`, as `t`, or undefined when the two
 * are parallel or the crossing is off the edge.
 */
function crossing(a: Point, dx: number, dy: number, p: Point, q: Point): number | undefined {
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const denominator = dx * ey - dy * ex;
  if (Math.abs(denominator) < 1e-12) return undefined;
  const wx = p.x - a.x;
  const wy = p.y - a.y;
  const t = (wx * ey - wy * ex) / denominator;
  const u = (wx * dy - wy * dx) / denominator;
  if (u < 0 || u > 1) return undefined;
  return t;
}

/** Inside by even-odd, with a point within `epsilon` of the boundary counted in. */
export function contains(polygon: readonly Point[], point: Point, epsilon: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const p = polygon[i]!;
    const q = polygon[j]!;
    if (distanceToSegment(point, p, q) <= epsilon) return true;
    const crosses = p.y > point.y !== q.y > point.y;
    if (crosses && point.x < ((q.x - p.x) * (point.y - p.y)) / (q.y - p.y) + p.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(point: Point, p: Point, q: Point): number {
  const ex = q.x - p.x;
  const ey = q.y - p.y;
  const length2 = ex * ex + ey * ey;
  const t =
    length2 > 0
      ? Math.min(1, Math.max(0, ((point.x - p.x) * ex + (point.y - p.y) * ey) / length2))
      : 0;
  return Math.hypot(point.x - (p.x + ex * t), point.y - (p.y + ey * t));
}
