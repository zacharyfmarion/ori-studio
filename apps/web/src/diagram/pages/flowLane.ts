/**
 * The flow layout's lane (D10, D22): which way each page's rows run, so that
 * in print the lane carries on across a spread, and the lane itself as one
 * smooth curve.
 *
 * **Spreads.** Pages pair into spreads from the side the first one falls on
 * (`DiagramPageSetup.firstPageSide`). Across a spread the lane leaves the left
 * page at its spine edge and comes into the right page at its spine edge at
 * the same height, so a reader's eye runs straight on over the gutter. So:
 * - a right page the lane comes into from its facing page reads from the
 *   bottom row up, the bottom row left to right from the spine;
 * - a left page with its facing page after it ends its last row at the spine:
 *   its rows run so the bottom row reads left to right — from the top left
 *   with an odd number of rows, from the top right with an even one — and
 *   where its steps end early (a page break), the lane runs on through the
 *   empty cells to the spine;
 * - across a page turn there is nothing to line up with: the next page starts
 *   at its top left as before, and the lane runs off a page, or comes in, only
 *   at its outer edge, never into the spine, where it would seem to go on on
 *   the facing page.
 *
 * **The curve.** The lane passes through every picture's centre heading along
 * its row, and turns between rows in a half ellipse out past the row's end
 * (`FLOW_BEND`, or further for a wide band: {@link bendReach}), through an
 * apex heading straight down or up. It is a cubic
 * Hermite spline through those knots: each knot has one handle, shared by the
 * curves either side, so the lane is tangent-continuous (C1) everywhere and
 * has no corner. The earlier lane was a Catmull–Rom spline through the same
 * points, whose tangent at a row's last picture aimed from the picture before
 * at the bend: the lane rose over that picture and fell back — the kinks Zach
 * saw between steps 11 and 12 of the X-ray Heart.
 *
 * Pure.
 */
import type { DiagramPageSide } from '../document/diagramDocument';

/** How far out past a row's last picture's centre the lane turns to the next row, as a share of the cell's width. */
export const FLOW_BEND = 0.46;

/**
 * A quarter ellipse's handle, as a share of its radius: the cubic closest to
 * the arc, `4/3·(√2 − 1)`.
 */
const QUARTER = (4 / 3) * (Math.SQRT2 - 1);

/**
 * How much rounder a bend's cubic is where it ends than the quarter ellipse
 * it stands for: its radius there over the ellipse's, `1.5·QUARTER²/(1 − QUARTER)`
 * (about 1.022). Between its ends it is as round as the ellipse, within 1%.
 */
const CUBIC_END = (1.5 * QUARTER * QUARTER) / (1 - QUARTER);

/**
 * How far out past a row's last picture's centre the lane's apex is, turning
 * to a row `halfPitch` × 2 below or above it, for a band `halfWidth` either
 * side of the lane: `FLOW_BEND` of the cell, moved only as far as keeps the
 * bend no tighter than the band is half wide, so its inner edge never folds.
 *
 * The bend is a quarter ellipse each way, across `reach` and down
 * `halfPitch`: tightest where it leaves the row, `reach²/halfPitch`, or at
 * its apex, `halfPitch²/reach` — each {@link CUBIC_END} rounder as drawn. So
 * `reach` stays between `√(halfWidth·halfPitch/CUBIC_END)` and
 * `CUBIC_END·halfPitch²/halfWidth`. A band wider than the rows are apart
 * covers the bend's inside, its two runs overlapping: it is taken as wide as
 * they are apart, a round bend. Every bend a band as wide as an A4 page of
 * 3 × 3 steps draws by itself already keeps clear: there it is unmoved.
 */
export function bendReach(cellW: number, halfPitch: number, halfWidth: number): number {
  const reach = FLOW_BEND * cellW;
  const half = Math.min(halfWidth, halfPitch);
  if (!(half > 0) || !(halfPitch > 0)) return reach;
  const least = Math.sqrt((half * halfPitch) / CUBIC_END);
  const most = (CUBIC_END * halfPitch * halfPitch) / half;
  return Math.min(Math.max(reach, least), most);
}

export interface LanePoint {
  x: number;
  y: number;
}

/** One cubic Bézier of the lane: its two control points and its end. It starts where the one before ends. */
export interface LaneCurve {
  c1: LanePoint;
  c2: LanePoint;
  to: LanePoint;
}

/** The lane as drawn, in mm on the page: from its start, cubic Béziers end to end. */
export interface Lane {
  from: LanePoint;
  curves: LaneCurve[];
}

/** Which side of its spread a page falls on, by its index. */
export function pageSide(pageIndex: number, firstPageSide: DiagramPageSide): DiagramPageSide {
  const first = pageIndex % 2 === 0;
  return first === (firstPageSide === 'left') ? 'left' : 'right';
}

/** How a flow page's rows run, and how its lane meets the pages either side. */
export interface FlowPagePlan {
  side: DiagramPageSide;
  /** Rows are read from the bottom up: a right page the lane comes into at its spine. */
  up: boolean;
  /** The page's first row reads right to left; the rows after it turn back, as every flow row does. */
  firstRightToLeft: boolean;
  /** Where the lane comes in: over the spine from the facing page, over a page turn, or not at all on the first page. */
  entry: 'spine' | 'turn' | 'none';
  /** Where it goes: over the spine to the facing page, over a page turn, or nowhere after the last page. */
  exit: 'spine' | 'turn' | 'none';
}

/** The plan of the `pageIndex`th of `pageCount` flow pages of `rows` rows. */
export function flowPagePlan(
  pageIndex: number,
  pageCount: number,
  firstPageSide: DiagramPageSide,
  rows: number
): FlowPagePlan {
  const side = pageSide(pageIndex, firstPageSide);
  const entry = pageIndex === 0 ? 'none' : side === 'right' ? 'spine' : 'turn';
  const exit = pageIndex === pageCount - 1 ? 'none' : side === 'left' ? 'spine' : 'turn';
  // A left page handing over ends at its spine: its bottom row reads left to right.
  const firstRightToLeft = exit === 'spine' && rows % 2 === 0;
  return { side, up: entry === 'spine', firstRightToLeft, entry, exit };
}

/** Whether a page's `row`th row in reading order reads right to left. */
export function rowRightToLeft(plan: Pick<FlowPagePlan, 'firstRightToLeft'>, row: number): boolean {
  return plan.firstRightToLeft !== (row % 2 === 1);
}

/** A place the lane passes through, in reading order: a picture's centre, or an empty cell's on a page that runs on to its spine. */
export interface LaneStop extends LanePoint {
  /** The stop's row in reading order. */
  row: number;
  rightToLeft: boolean;
}

/** A point the lane passes through, the way it is heading there (a unit vector), and whether it is past the paper's edge. */
interface Knot extends LanePoint {
  heading: LanePoint;
  off: boolean;
}

/**
 * The lane through a page's stops, and for each stop after a row break the
 * index of the curve that runs into the bend before it (the next runs out).
 * `spineIn` and `spineOut` are its height at the spine, coming in and going
 * out, shared with the facing page; `offPage` how far past the paper's edge
 * it runs; `halfWidth` how far the band is drawn either side of it, which
 * its bends keep clear of ({@link bendReach}).
 */
export function flowLane(input: {
  stops: readonly LaneStop[];
  plan: FlowPagePlan;
  pageWidth: number;
  cellW: number;
  halfWidth: number;
  offPage: number;
  spineIn: number | null;
  spineOut: number | null;
}): { lane: Lane; bends: Map<number, number> } | null {
  const { stops, plan, pageWidth: W, cellW, halfWidth, offPage } = input;
  const first = stops[0];
  const last = stops.at(-1);
  if (!first || !last) return null;
  const knots: Knot[] = [];
  const along = (rightToLeft: boolean): LanePoint => ({ x: rightToLeft ? -1 : 1, y: 0 });
  const outerLeft = plan.side === 'left';

  if (plan.entry === 'spine' && input.spineIn !== null) {
    // In over the spine, at the facing page's height: the paper's edge is a knot, so it is met exactly there.
    const spine = outerLeft ? W : 0;
    const inward = outerLeft ? -1 : 1;
    knots.push(
      { x: spine - inward * offPage, y: input.spineIn, heading: { x: inward, y: 0 }, off: true },
      { x: spine, y: input.spineIn, heading: { x: inward, y: 0 }, off: false }
    );
  } else if (plan.entry === 'turn' && first.rightToLeft !== outerLeft) {
    // In from the outer edge, at the first picture's height.
    knots.push({ x: outerLeft ? -offPage : W + offPage, y: first.y, heading: along(first.rightToLeft), off: true });
  }

  // For each stop after a row break, the curve into the bend before it: the one from the knot before its apex.
  const bendAt = new Map<number, number>();
  stops.forEach((stop, n) => {
    const before = stops[n - 1];
    if (before && before.row !== stop.row) {
      bendAt.set(n, knots.length - 1);
      knots.push(bendApex(before, stop, cellW, halfWidth));
    }
    knots.push({ x: stop.x, y: stop.y, heading: along(stop.rightToLeft), off: false });
  });

  if (plan.exit === 'spine' && input.spineOut !== null) {
    const spine = outerLeft ? W : 0;
    const outward = outerLeft ? 1 : -1;
    knots.push(
      { x: spine, y: input.spineOut, heading: { x: outward, y: 0 }, off: false },
      { x: spine + outward * offPage, y: input.spineOut, heading: { x: outward, y: 0 }, off: true }
    );
  } else if (plan.exit === 'turn' && last.rightToLeft === outerLeft) {
    // Off the outer edge, where the page turns; never into the spine.
    knots.push({ x: outerLeft ? -offPage : W + offPage, y: last.y, heading: along(last.rightToLeft), off: true });
  }

  const handles = knotHandles(knots);
  const curves: LaneCurve[] = [];
  for (let n = 0; n + 1 < knots.length; n += 1) {
    const [a, b] = [knots[n]!, knots[n + 1]!];
    const [ha, hb] = [handles[n]!, handles[n + 1]!];
    curves.push({
      c1: { x: a.x + a.heading.x * ha, y: a.y + a.heading.y * ha },
      c2: { x: b.x - b.heading.x * hb, y: b.y - b.heading.y * hb },
      to: { x: b.x, y: b.y },
    });
  }
  return { lane: { from: { x: knots[0]!.x, y: knots[0]!.y }, curves }, bends: bendAt };
}

/**
 * Where the lane turns from one row to the next: out past the row's end by
 * {@link bendReach}, halfway between the two pictures' heights, heading
 * straight down or up.
 */
function bendApex(before: LaneStop, next: LaneStop, cellW: number, halfWidth: number): Knot {
  const reach = bendReach(cellW, Math.abs(next.y - before.y) / 2, halfWidth);
  return {
    x: before.x + (before.rightToLeft ? -1 : 1) * reach,
    y: (before.y + next.y) / 2,
    heading: { x: 0, y: next.y >= before.y ? 1 : -1 },
    off: false,
  };
}

/**
 * Each knot's handle length, shared by the curves either side of it (C1): the
 * shorter of what each would take alone — a third of the way along a run
 * between two pictures or to an edge, and a quarter ellipse's handle round a
 * bend (`QUARTER` of its radius each way). A picture beside a bend may take up
 * to half its run instead: a wide band's bend reaches further out
 * ({@link bendReach}), its quarter ellipse's handle with it, and a third would
 * pinch the bend where it leaves the row. The run's other end takes no more
 * than half either, so the run never doubles back; beside a bend as far out
 * as `FLOW_BEND`, a third is never the shorter. A run past the paper's edge
 * takes no say at its end on the paper, so a short stub off the page never
 * pinches the curve where it is seen; there it is straight, and stays off the
 * paper.
 */
function knotHandles(knots: readonly Knot[]): number[] {
  const handles = knots.map(() => Infinity);
  const alone = knots.map(() => Infinity);
  const turning = (n: number) => {
    const [a, b] = [knots[n], knots[n + 1]];
    return a !== undefined && b !== undefined && (a.heading.y !== 0 || b.heading.y !== 0);
  };
  for (let n = 0; n + 1 < knots.length; n += 1) {
    const [a, b] = [knots[n]!, knots[n + 1]!];
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const bend = turning(n);
    /** The share of a run the `at`th knot's handle may take: half when the curve on its other side is a bend, else a third. */
    const share = (at: number) => (turning(at - 1) || turning(at) ? 1 / 2 : 1 / 3);
    // Round a bend: each end's handle a quarter ellipse's, across its radius that way.
    const handle = (end: Knot, at: number) => (bend ? QUARTER * (end.heading.y !== 0 ? dy : dx) : dx * share(at));
    alone[n] = Math.min(alone[n]!, handle(a, n));
    alone[n + 1] = Math.min(alone[n + 1]!, handle(b, n + 1));
    if (!(b.off && !a.off)) handles[n] = Math.min(handles[n]!, handle(a, n));
    if (!(a.off && !b.off)) handles[n + 1] = Math.min(handles[n + 1]!, handle(b, n + 1));
  }
  // A picture with only stubs either side — alone on its page — takes theirs: they are straight.
  return handles.map((handle, n) => (Number.isFinite(handle) ? handle : Number.isFinite(alone[n]!) ? alone[n]! : 0));
}

/** A point of a cubic Bézier at `t`. */
export function curvePoint(from: LanePoint, curve: LaneCurve, t: number): LanePoint {
  const u = 1 - t;
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return {
    x: a * from.x + b * curve.c1.x + c * curve.c2.x + d * curve.to.x,
    y: a * from.y + b * curve.c1.y + c * curve.c2.y + d * curve.to.y,
  };
}

/** Where the `index`th curve of the lane starts. */
export function curveStart(lane: Lane, index: number): LanePoint {
  return index === 0 ? lane.from : lane.curves[index - 1]!.to;
}

/**
 * The lane's x at height `y` in the bend whose first curve is `index` — its
 * way out to the apex and its way back, each running one way down or up — or
 * null when the bend does not reach that height.
 */
export function bendXAt(lane: Lane, index: number, y: number): number | null {
  for (const n of [index, index + 1]) {
    const curve = lane.curves[n];
    if (!curve) continue;
    const from = curveStart(lane, n);
    const [low, high] = from.y <= curve.to.y ? [0, 1] : [1, 0];
    const yLow = curvePoint(from, curve, low).y;
    const yHigh = curvePoint(from, curve, high).y;
    if (y < yLow - 1e-9 || y > yHigh + 1e-9) continue;
    // Each half of a bend runs one way up or down (its handles are level and upright): bisect.
    let [a, b] = [low, high];
    for (let step = 0; step < 60; step += 1) {
      const t = (a + b) / 2;
      if (curvePoint(from, curve, t).y < y) a = t;
      else b = t;
    }
    return curvePoint(from, curve, (a + b) / 2).x;
  }
  return null;
}
