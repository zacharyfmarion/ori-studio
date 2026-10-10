import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SETUP,
  DEFAULT_PATH_WIDTH_MM,
  type DiagramPageSetup,
  type DiagramPageSide,
} from '../document/diagramDocument';
import {
  layoutDiagramPages,
  pageGrid,
  STEP_NUMBER_SIZE_MM,
  STEP_TEXT_LEADING_MM,
  STEP_TEXT_SIZE_MM,
  type LayoutCell,
  type LayoutStep,
  type LayoutTurn,
} from './diagramPageLayout';
import { estimateTextSetter } from './estimateTextSetter';
import { curvePoint, curveStart, FLOW_BEND, flowPagePlan, pageSide, type Lane, type LaneCurve, type LanePoint } from './flowLane';

/**
 * The flow layout's lane (Zach, 2026-10-06, the X-ray Heart: "it kind of has
 * kinks in it - can you make it be smooth like a nice bezier curve"; "in
 * print, the end of the flow on one page lines up with the start on the next
 * … for heart, the flow should start on the bottom left").
 */

const NO_MARKS = { width: 0, height: 0 };
const paper = (width: number, height: number = width): LayoutStep['picture'] => ({
  kind: 'paper',
  width,
  height,
  frame: { width, height },
  marks: NO_MARKS,
});
/** Square, tall and wide models, so the pictures' centres stand at different heights, as the heart's do. */
const SHAPES = [paper(400), paper(200, 600), paper(600, 250), paper(300, 420)];
const TEXTS = ['Fold in half.', '', 'Fold the corners in to the centre, crease and unfold, then turn the model over.'];

function steps(count: number, patch: (index: number) => Partial<LayoutStep> = () => ({})): LayoutStep[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `step-${index}`,
    text: TEXTS[index % TEXTS.length]!,
    breakBefore: false,
    picture: SHAPES[index % SHAPES.length]!,
    turnsBefore: [],
    turnsAfter: [],
    ...patch(index),
  }));
}

const flow = (list: LayoutStep[], setup: Partial<DiagramPageSetup> = {}) =>
  layoutDiagramPages(list, { ...DEFAULT_PAGE_SETUP, layout: 'flow', ...setup }, 'Heart', estimateTextSetter);

const centreOf = (cell: LayoutCell): LanePoint => ({
  x: cell.pictureMm.x + cell.pictureMm.size / 2,
  y: cell.drawMm.y + cell.drawMm.h / 2,
});

/** Each join's way out of the curve before it and into the curve after it. */
function joins(lane: Lane): { at: LanePoint; into: LanePoint; out: LanePoint }[] {
  return lane.curves.slice(0, -1).map((curve, index) => {
    const next = lane.curves[index + 1]!;
    return {
      at: curve.to,
      into: { x: curve.to.x - curve.c2.x, y: curve.to.y - curve.c2.y },
      out: { x: next.c1.x - curve.to.x, y: next.c1.y - curve.to.y },
    };
  });
}

/** The lane sampled finely, curve by curve. */
function sample(lane: Lane, per = 400): LanePoint[][] {
  return lane.curves.map((curve, index) => {
    const from = curveStart(lane, index);
    return Array.from({ length: per + 1 }, (_, n) => curvePoint(from, curve, n / per));
  });
}

/** The lane's height where it crosses `x`, on the curve that does. */
function heightAt(lane: Lane, x: number): number | null {
  for (const points of sample(lane, 2000)) {
    for (let n = 1; n < points.length; n += 1) {
      const [a, b] = [points[n - 1]!, points[n]!];
      if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return null;
}

/** The lane's radius of curvature at `t` along a curve: how tight it bends there. */
function radiusAt(from: LanePoint, curve: LaneCurve, t: number): number {
  const u = 1 - t;
  const { c1, c2, to } = curve;
  const d1 = {
    x: 3 * u * u * (c1.x - from.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (to.x - c2.x),
    y: 3 * u * u * (c1.y - from.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (to.y - c2.y),
  };
  const d2 = {
    x: 6 * u * (c2.x - 2 * c1.x + from.x) + 6 * t * (to.x - 2 * c2.x + c1.x),
    y: 6 * u * (c2.y - 2 * c1.y + from.y) + 6 * t * (to.y - 2 * c2.y + c1.y),
  };
  const cross = Math.abs(d1.x * d2.y - d1.y * d2.x);
  return cross === 0 ? Infinity : Math.hypot(d1.x, d1.y) ** 3 / cross;
}

/** Each half of each bend between rows: the curve, where it starts, and how far it falls or rises. */
function bendHalves(lane: Lane): { from: LanePoint; curve: LaneCurve; drop: number }[] {
  return lane.curves.flatMap((curve, index) => {
    const from = curveStart(lane, index);
    // Into an apex its last handle is upright; out of one, its first.
    const into = Math.abs(curve.c2.x - curve.to.x) < 1e-9 && Math.abs(curve.c2.y - curve.to.y) > 1e-9;
    const out = Math.abs(curve.c1.x - from.x) < 1e-9 && Math.abs(curve.c1.y - from.y) > 1e-9;
    return into || out ? [{ from, curve, drop: Math.abs(curve.to.y - from.y) }] : [];
  });
}

/**
 * Flow pages of every shape the steps per page derive (`flowShape`), each
 * with the shape it derives: odd and even rows, one row, one column, up to
 * seven columns or seven rows, and last rows the steps leave short — on a
 * left page, where the lane runs on through the empty cells to the spine.
 */
const SHAPED: readonly (readonly [Partial<DiagramPageSetup>, string])[] = [
  // The default.
  [{ stepsPerPage: 9 }, '3×3'],
  // An even number of rows.
  [{ stepsPerPage: 6, orientation: 'landscape' }, '3×2'],
  [{ stepsPerPage: 12, orientation: 'landscape' }, '4×3'],
  // 3 · 3 · 1 and 3 · 3 · 2: an odd number of rows, the last short.
  [{ stepsPerPage: 7 }, '3×3'],
  [{ stepsPerPage: 8 }, '3×3'],
  // 3 · 3 · 3 · 1: an even number of rows, the last short.
  [{ stepsPerPage: 10 }, '3×4'],
  // 2 × 4 full, and 2 · 2 · 2 · 1, on A5.
  [{ stepsPerPage: 8, size: 'a5' }, '2×4'],
  [{ stepsPerPage: 7, size: 'a5' }, '2×4'],
  // One row, and one column.
  [{ stepsPerPage: 2, orientation: 'landscape' }, '2×1'],
  [{ stepsPerPage: 2 }, '1×2'],
  // Five columns, six and seven; and seven rows, past the six a flow page's own rows reached.
  [{ stepsPerPage: 15, orientation: 'landscape' }, '5×3'],
  [{ stepsPerPage: 24, orientation: 'landscape' }, '6×4'],
  [{ stepsPerPage: 28, orientation: 'landscape' }, '7×4'],
  [{ stepsPerPage: 28 }, '4×7'],
  [{ stepsPerPage: 9, marginMm: 0 }, '3×3'],
];
const SETUPS = SHAPED.map(([setup]) => setup);

describe('the flow setups these cases run over', () => {
  it('derive the shapes they name', () => {
    for (const [setup, shape] of SHAPED) {
      const { columns, rows } = pageGrid({ ...DEFAULT_PAGE_SETUP, layout: 'flow', ...setup });
      expect(`${columns}×${rows}`, JSON.stringify(setup)).toBe(shape);
    }
  });
});

describe('flowPagePlan', () => {
  it('pairs pages into spreads from the side the first one falls on', () => {
    const sides = (first: DiagramPageSide) => [0, 1, 2, 3, 4].map((index) => pageSide(index, first));
    expect(sides('left')).toEqual(['left', 'right', 'left', 'right', 'left']);
    expect(sides('right')).toEqual(['right', 'left', 'right', 'left', 'right']);
  });

  it('hands over at the spine across a spread, and starts over at the top left across a page turn', () => {
    const plans = (first: DiagramPageSide, rows: number) =>
      [0, 1, 2, 3].map((index) => {
        const { entry, exit, up, firstRightToLeft } = flowPagePlan(index, 4, first, rows);
        return `${entry}>${exit}${up ? ' up' : ''}${firstRightToLeft ? ' rtl' : ''}`;
      });
    // Left first: 1–2 and 3–4 are spreads; 2 → 3 is a page turn.
    expect(plans('left', 3)).toEqual(['none>spine', 'spine>turn up', 'turn>spine', 'spine>none up']);
    // An even number of rows: a left page handing over starts at its top right, so its last row ends at the spine.
    expect(plans('left', 2)).toEqual(['none>spine rtl', 'spine>turn up', 'turn>spine rtl', 'spine>none up']);
    // Right first: 1 stands alone; 2–3 is a spread.
    expect(plans('right', 3)).toEqual(['none>turn', 'turn>spine', 'spine>turn up', 'turn>none']);
    expect(plans('right', 2)).toEqual(['none>turn', 'turn>spine rtl', 'spine>turn up', 'turn>none']);
  });
});

describe('the flow lane', () => {
  it('is tangent-continuous at every join of its curves: one handle either side, no corner', () => {
    for (const setup of SETUPS) {
      for (const firstPageSide of ['left', 'right'] as const) {
        const result = flow(steps(23), { ...setup, firstPageSide });
        for (const [index, page] of result.pages.entries()) {
          const label = `${JSON.stringify(setup)} ${firstPageSide} page ${index + 1}`;
          for (const { at, into, out } of joins(page.band!)) {
            // C1: the same handle into the join as out of it — so the same direction, and no corner.
            expect(Math.hypot(into.x - out.x, into.y - out.y), `${label} at ${at.x},${at.y}`).toBeLessThan(1e-9);
            expect(Math.hypot(out.x, out.y), `${label} at ${at.x},${at.y}`).toBeGreaterThan(0.5);
          }
        }
      }
    }
  });

  it('runs between two pictures on a row without rising over either: no hump before a bend (the heart’s kinks)', () => {
    for (const setup of SETUPS) {
      const result = flow(steps(23), setup);
      for (const page of result.pages) {
        const centres = page.cells.map(centreOf);
        const lane = page.band!;
        lane.curves.forEach((curve, index) => {
          const from = curveStart(lane, index);
          const a = centres.findIndex((centre) => Math.hypot(centre.x - from.x, centre.y - from.y) < 1e-9);
          const b = centres.findIndex((centre) => Math.hypot(centre.x - curve.to.x, centre.y - curve.to.y) < 1e-9);
          // Only a run from one picture to the next on its row.
          if (a < 0 || b !== a + 1 || page.cells[a]!.cellMm.y - page.cells[b]!.cellMm.y > page.cells[a]!.cellMm.h / 2) return;
          const [low, high] = [Math.min(from.y, curve.to.y), Math.max(from.y, curve.to.y)];
          for (const point of sample({ from, curves: [curve] })[0]!) {
            expect(point.y, `${JSON.stringify(setup)} ${a + 1}→${b + 1}`).toBeGreaterThanOrEqual(low - 1e-9);
            expect(point.y, `${JSON.stringify(setup)} ${a + 1}→${b + 1}`).toBeLessThanOrEqual(high + 1e-9);
          }
        });
      }
    }
  });

  it('runs through every picture’s centre, in reading order, behind the steps', () => {
    const result = flow(steps(16));
    for (const page of result.pages) {
      const lane = page.band!;
      const knots = [lane.from, ...lane.curves.map((curve) => curve.to)];
      let after = -1;
      for (const centre of page.cells.map(centreOf)) {
        const at = knots.findIndex((knot, index) => index > after && Math.hypot(knot.x - centre.x, knot.y - centre.y) < 1e-9);
        expect(at).toBeGreaterThan(after);
        after = at;
      }
    }
  });
});

describe('the band’s width and colour (Zach, 2026-10-06: "an option for how wide the flow ribbon is, and for what color it is")', () => {
  it('draws the band at the width the setup says, 20 mm by default whatever the size of the steps (Zach, 2026-10-08)', () => {
    expect(DEFAULT_PATH_WIDTH_MM).toBe(20);
    for (const setup of SETUPS) {
      const plain = flow(steps(12), setup);
      expect(plain.bandWidthMm).toBe(DEFAULT_PATH_WIDTH_MM);
      expect(plain.bandInk).toBe('#ecece8');
      const chosen = flow(steps(12), { ...setup, pathWidthMm: 18, pathColor: '#d6e8f5' });
      expect(chosen.bandWidthMm).toBe(18);
      expect(chosen.bandInk).toBe('#d6e8f5');
    }
  });

  it('keeps every bend no tighter than the band is half wide, at any width the steps leave room for', () => {
    for (const setup of SETUPS) {
      for (const pathWidthMm of [8, DEFAULT_PATH_WIDTH_MM, 26, 40, 60]) {
        const result = flow(steps(23), { ...setup, pathWidthMm });
        // A band wider than a step's cell has no room to turn in.
        if (result.bandWidthMm > result.cellMm.w) continue;
        const half = result.bandWidthMm / 2;
        for (const [index, page] of result.pages.entries()) {
          for (const { from, curve, drop } of bendHalves(page.band!)) {
            // A band wider than its rows are apart covers its bend's inside: then the bend is round, as tight as they are apart.
            const needs = Math.min(half, drop);
            const tightest = Math.min(...Array.from({ length: 201 }, (_, n) => radiusAt(from, curve, n / 200)));
            expect(tightest, `${JSON.stringify(setup)} ${pathWidthMm} mm, page ${index + 1}`).toBeGreaterThan(0.96 * needs);
          }
        }
      }
    }
  });

  it('moves a bend out only as far as a wider band needs: the heart’s stay where they were', () => {
    const apexes = (pathWidthMm: number) =>
      flow(steps(16), { stepsPerPage: 9, pathWidthMm }).pages.flatMap((page) =>
        bendHalves(page.band!).flatMap(({ from, curve }) => (Math.abs(curve.c2.x - curve.to.x) < 1e-9 ? [{ from, to: curve.to }] : []))
      );
    const cellW = flow(steps(16), { stepsPerPage: 9 }).cellMm.w;
    // The default, a narrower one and the 26 mm it drew by itself before there was one: FLOW_BEND of a cell past the row's last picture.
    for (const width of [8, DEFAULT_PATH_WIDTH_MM, 26]) {
      for (const { from, to } of apexes(width)) expect(Math.abs(to.x - from.x)).toBeCloseTo(FLOW_BEND * cellW, 9);
    }
    // Wider than its bends allow: out past that.
    const wide = apexes(50);
    expect(wide.length).toBeGreaterThan(0);
    for (const { from, to } of wide) expect(Math.abs(to.x - from.x)).toBeGreaterThan(FLOW_BEND * cellW + 1);
  });

  it('keeps the band level and at one height over the spine, at any width', () => {
    for (const pathWidthMm of [8, 50]) {
      const result = flow(steps(16), { stepsPerPage: 9, pathWidthMm });
      const W = result.paper.widthMm;
      expect(heightAt(result.pages[1]!.band!, 0)).toBeCloseTo(heightAt(result.pages[0]!.band!, W)!, 6);
    }
  });
});

describe('a printed spread', () => {
  it('carries the lane over the spine at one height, for either first page and any number of rows', () => {
    for (const setup of SETUPS) {
      for (const firstPageSide of ['left', 'right'] as const) {
        // Enough steps for several spreads, the last page short.
        const result = flow(steps(4 * (setup.stepsPerPage ?? 9) + 2), { ...setup, firstPageSide });
        const W = result.paper.widthMm;
        let spreads = 0;
        result.pages.forEach((left, index) => {
          const right = result.pages[index + 1];
          if (left.side !== 'left' || !right) return;
          spreads += 1;
          const label = `${JSON.stringify(setup)} ${firstPageSide} pages ${left.number}–${right.number}`;
          const out = heightAt(left.band!, W);
          const into = heightAt(right.band!, 0);
          expect(out, label).not.toBeNull();
          expect(into, label).toBeCloseTo(out!, 6);
          // Level there on both pages: the lane runs straight on over the gutter.
          const exit = left.band!.curves.find((curve) => Math.abs(curve.to.x - W) < 1e-9)!;
          const entry = right.band!.curves.find((curve) => Math.abs(curve.to.x) < 1e-9)!;
          expect(exit.c2.y, label).toBeCloseTo(exit.to.y, 9);
          expect(right.band!.curves[right.band!.curves.indexOf(entry) + 1]!.c1.y, label).toBeCloseTo(entry.to.y, 9);
          // And off the paper into the bleed, both ways.
          expect(left.band!.curves.at(-1)!.to.x, label).toBeCloseTo(W + 10, 9);
          expect(right.band!.from.x, label).toBeCloseTo(-10, 9);
        });
        expect(spreads, `${JSON.stringify(setup)} ${firstPageSide}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('starts the heart’s page 2 at its bottom left, its rows running up', () => {
    // The X-ray Heart: 16 steps, 3 × 3, page 1 on the left.
    const result = flow(steps(16), { stepsPerPage: 9 });
    const [one, two] = result.pages;
    const at = (cell: LayoutCell) => ({ x: Math.round(cell.cellMm.x), y: Math.round(cell.cellMm.y) });
    // Page 1: 1 2 3, 6 5 4, 7 8 9 — ending at its bottom right, by the spine.
    expect(one!.cells.map((cell) => cell.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const nine = one!.cells[8]!;
    expect(nine.cellMm.x + nine.cellMm.w).toBeCloseTo(result.paper.widthMm - result.paper.marginMm, 6);
    // Page 2: 10 at the bottom left, 11 and 12 to its right, 13 over 12, 16 at the top left.
    const cells = two!.cells;
    const columns = [...new Set(cells.map((cell) => Math.round(cell.cellMm.x)))].sort((a, b) => a - b);
    expect(at(cells[0]!).x).toBe(columns[0]);
    expect(cells[0]!.cellMm.y).toBeGreaterThan(cells[3]!.cellMm.y);
    expect(cells.slice(0, 3).map((cell) => at(cell).x)).toEqual(columns);
    expect(at(cells[3]!).x).toBe(columns[2]);
    expect(cells[6]!.cellMm.y).toBeLessThan(cells[3]!.cellMm.y);
    expect(at(cells[6]!).x).toBe(columns[0]);
    // The bottom row of page 2 is the bottom row of page 1.
    expect(Math.round(cells[0]!.cellMm.y)).toBe(Math.round(one!.cells[6]!.cellMm.y));
  });

  it('runs a left page that ends early on through its empty cells to the spine', () => {
    // A page break before step 5: page 1 holds four steps.
    const result = flow(steps(12, (index) => ({ breakBefore: index === 4 })), { stepsPerPage: 9 });
    const [one, two] = result.pages;
    expect(one!.cells).toHaveLength(4);
    const lane = one!.band!;
    const knots = [lane.from, ...lane.curves.map((curve) => curve.to)];
    // Past the last picture it goes on, down to the bottom row and out at the spine.
    const last = centreOf(one!.cells[3]!);
    const beyond = knots.slice(knots.findIndex((knot) => knot.x === last.x && knot.y === last.y) + 1);
    expect(Math.max(...beyond.map((knot) => knot.y))).toBeGreaterThan(one!.cells[3]!.cellMm.y + one!.cells[3]!.cellMm.h);
    expect(heightAt(lane, result.paper.widthMm)).toBeCloseTo(heightAt(two!.band!, 0)!, 6);
  });

  it('runs a left page whose steps per page leave its last row short on to the spine, as one a page break ends there', () => {
    // 7 steps on A4 are 3 · 3 · 1: the lane goes on from the seventh through the two empty cells.
    const short = flow(steps(14), { stepsPerPage: 7 });
    expect(short.pages.map((page) => page.cells.length)).toEqual([7, 7]);
    const lane = short.pages[0]!.band!;
    const knots = [lane.from, ...lane.curves.map((curve) => curve.to)];
    const seventh = centreOf(short.pages[0]!.cells[6]!);
    const beyond = knots.slice(knots.findIndex((knot) => knot.x === seventh.x && knot.y === seventh.y) + 1);
    // Two empty cells' stops along the bottom row, then the spine and the bleed past it.
    expect(beyond.slice(0, 2).every((knot) => knot.x > seventh.x)).toBe(true);
    expect(heightAt(lane, short.paper.widthMm)).toBeCloseTo(heightAt(short.pages[1]!.band!, 0)!, 6);
    // The same pages, band and all, as 9 steps a page with a page break after the seventh.
    const broken = flow(steps(14, (index) => ({ breakBefore: index === 7 })), { stepsPerPage: 9 });
    expect(short.pages).toEqual(broken.pages);
  });

  it('starts a right page with fewer steps than rows at the spine’s row, and goes on up from there', () => {
    const result = flow(steps(11), { stepsPerPage: 9 });
    const two = result.pages[1]!;
    expect(two.cells.map((cell) => cell.number)).toEqual([10, 11]);
    // The bottom row, read from the spine.
    expect(two.cells[0]!.cellMm.y).toBeGreaterThan(result.pages[0]!.cells[3]!.cellMm.y);
    expect(two.cells[0]!.cellMm.x).toBeLessThan(two.cells[1]!.cellMm.x);
    expect(heightAt(two.band!, 0)).toBeCloseTo(heightAt(result.pages[0]!.band!, result.paper.widthMm)!, 6);
  });

  it('over a page turn, starts the next page at its top left and runs the lane only off the outer edge', () => {
    // 3 × 2 and 3 × 3.
    for (const [rows, setup] of [[2, { stepsPerPage: 6, orientation: 'landscape' }], [3, { stepsPerPage: 9 }]] as const) {
      for (const firstPageSide of ['left', 'right'] as const) {
        const result = flow(steps(5 * 3 * rows), { ...setup, firstPageSide });
        const W = result.paper.widthMm;
        result.pages.forEach((page, index) => {
          const next = result.pages[index + 1];
          if (page.side !== 'right' || !next) return;
          const label = `${rows} rows ${firstPageSide} pages ${page.number}–${next.number}`;
          const end = page.band!.curves.at(-1)!.to;
          // Off the outer (right) edge, or ending at its last picture — never into the spine.
          expect(end.x === W + 10 || end.x === centreOf(page.cells.at(-1)!).x, label).toBe(true);
          const last = page.band!.curves.at(-1)!;
          expect(Math.min(last.c1.x, last.c2.x, last.to.x), label).toBeGreaterThan(0);
          // The next page starts at its top; at its left with an odd number of rows, coming in from that outer edge.
          const first = next.cells[0]!;
          expect(first.cellMm.y, label).toBeLessThan(next.cells.at(-1)!.cellMm.y + 1e-9);
          if (rows % 2 === 1) {
            expect(first.cellMm.x, label).toBeCloseTo(result.paper.marginMm, 9);
            expect(next.band!.from.x, label).toBe(-10);
          }
        });
      }
    }
  });

  it('starts a lone first right page at its top left, as a single page does', () => {
    const result = flow(steps(12), { stepsPerPage: 9, firstPageSide: 'right' });
    const one = result.pages[0]!;
    expect(one.side).toBe('right');
    expect(one.cells[0]!.cellMm.x).toBeCloseTo(result.paper.marginMm, 9);
    expect(one.cells[0]!.cellMm.y).toBeLessThan(one.cells[8]!.cellMm.y);
    // Its last row ends at the outer edge: the lane runs off it there.
    expect(one.band!.curves.at(-1)!.to.x).toBe(result.paper.widthMm + 10);
  });
});

describe('a turn across a flow row break, on the lane', () => {
  const over = (id: string): LayoutTurn => ({ id, turn: { kind: 'turn-over', axis: 'vertical' } });
  const foot = (cell: LayoutCell) =>
    cell.text.lines.length > 0
      ? cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM + 0.3 * STEP_TEXT_SIZE_MM
      : cell.drawMm.y + cell.drawMm.h;
  const numberTop = (cell: LayoutCell) => cell.numberAt.y - 0.75 * STEP_NUMBER_SIZE_MM;
  /** How near the lane comes to a point, mm. */
  const distance = (lane: Lane, point: LanePoint) =>
    Math.min(...sample(lane, 2000).flat().map((at) => Math.hypot(at.x - point.x, at.y - point.y)));

  it('sits on the lane in its bend, on a page read down and on one read up, however wide the band', () => {
    // Turns into steps 4 and 7 (page 1, read down) and 13 and 16 (page 2, read up).
    const list = steps(16, (index) => ([3, 6, 12, 15].includes(index) ? { turnsBefore: [over(`turn-${index}`)] } : {}));
    for (const [showPath, pathWidthMm] of [[true, DEFAULT_PATH_WIDTH_MM], [false, DEFAULT_PATH_WIDTH_MM], [true, 50], [false, 50]] as const) {
      const result = flow(list, { stepsPerPage: 9, showPath, pathWidthMm });
      const lanes = flow(list, { stepsPerPage: 9, pathWidthMm }).pages.map((page) => page.band!);
      result.pages.forEach((page, pageIndex) => {
        for (const turn of page.turns) {
          const k = page.cells.findIndex((cell) => cell.stepId === turn.beforeStepId);
          const [before, next] = [page.cells[k - 1]!, page.cells[k]!];
          const [upper, lower] = before.cellMm.y < next.cellMm.y ? [before, next] : [next, before];
          // On the lane — the one drawn, or the one that would be — between the rows' words and numbers.
          expect(distance(lanes[pageIndex]!, turn.at), `${turn.id} ${showPath}`).toBeLessThan(0.05);
          expect(turn.at.y - turn.box.h / 2, turn.id).toBeGreaterThan(foot(upper));
          expect(turn.at.y + turn.box.h / 2, turn.id).toBeLessThan(numberTop(lower));
          // Out past the row's end, where the lane turns.
          const outside = Math.abs(turn.at.x - centreOf(before).x) > before.pictureMm.size / 2;
          expect(outside, turn.id).toBe(true);
        }
        expect(page.turns, `page ${pageIndex + 1}`).toHaveLength(2);
      });
      // On page 2, read up, each goes the way of the row it leads into: 13's right to left, 16's left to right.
      const two = result.pages[1]!;
      expect(two.turns.map((turn) => [turn.id, turn.rightToLeft])).toEqual([
        ['turn-12', true],
        ['turn-15', false],
      ]);
    }
  });

  it('keeps the upper step’s words clear of turns on a page read up', () => {
    // Long words on step 13 (page 2's middle row, over the bend from 12): it gives way, as a step over a bend does.
    const long = 'Fold the corners in to the centre, crease and unfold, then turn the model over and fold it in half again. '.repeat(3);
    const list = steps(16, (index) =>
      index === 12 ? { text: long, turnsBefore: [over('turn-a'), over('turn-b'), over('turn-c')] } : {}
    );
    const page = flow(list, { stepsPerPage: 9 }).pages[1]!;
    const upper = page.cells.find((cell) => cell.stepId === 'step-12')!;
    const lower = page.cells.find((cell) => cell.stepId === 'step-11')!;
    expect(upper.cellMm.y).toBeLessThan(lower.cellMm.y);
    const top = Math.min(...page.turns.map((turn) => turn.at.y - turn.box.h / 2));
    const bottom = Math.max(...page.turns.map((turn) => turn.at.y + turn.box.h / 2));
    expect(top).toBeGreaterThan(foot(upper));
    expect(bottom).toBeLessThan(numberTop(lower));
  });
});
