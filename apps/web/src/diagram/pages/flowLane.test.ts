import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_SETUP,
  DEFAULT_PATH_WIDTH_MM,
  type DiagramPageSetup,
  type DiagramPageSide,
} from '../document/diagramDocument';
import {
  layoutDiagramPages,
  pageGrid,
  type LayoutCell,
  type LayoutStep,
  type LayoutTurn,
} from './diagramPageLayout';
import { partBox } from './pagePlacement';
import { estimateTextSetter } from './estimateTextSetter';
import { curvePoint, curveStart, flowPagePlan, pageSide, type Lane, type LaneCurve, type LanePoint } from './flowLane';

// Each matrix searches many complete layouts, including dense pages and wide bands.
vi.setConfig({ testTimeout: 120_000 });

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
            // G1: the same tangent direction. Unequal handles allow each bend its own radius.
            const lengthIn = Math.hypot(into.x, into.y), lengthOut = Math.hypot(out.x, out.y);
            expect((into.x * out.x + into.y * out.y) / lengthIn / lengthOut, `${label} at ${at.x},${at.y}`).toBeCloseTo(1, 9);
            expect(Math.hypot(out.x, out.y), `${label} at ${at.x},${at.y}`).toBeGreaterThan(0.01);
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

  it.each(SETUPS)('keeps bends round enough for every supported band width: %j', (setup) => {
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
  });

  it('adapts packed bends to wider bands without changing step order', () => {
    const narrow = flow(steps(16), { pathWidthMm: 8 });
    const wide = flow(steps(16), { pathWidthMm: 50 });
    expect(wide.pages.flatMap(page => page.cells.map(c => c.stepId))).toEqual(narrow.pages.flatMap(page => page.cells.map(c => c.stepId)));
    expect(wide.pages[0]!.band).not.toEqual(narrow.pages[0]!.band);
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

  it('starts the facing page at the bottom left and reads successive passes upward', () => {
    const result = flow(steps(16), { stepsPerPage: 9 });
    const page = result.pages[1]!;
    expect(page.cells[0]!.rightToLeft).toBe(false);
    expect(page.cells[0]!.drawMm.x).toBeLessThan(page.cells[1]!.drawMm.x);
    const firstPass = page.cells.filter(c => c.flowRow === 0), lastPass = page.cells.filter(c => c.flowRow === page.cells.at(-1)!.flowRow);
    const average = (cells: LayoutCell[]) => cells.reduce((sum, c) => sum + centreOf(c).y, 0) / cells.length;
    expect(average(firstPass)).toBeGreaterThan(average(lastPass));
    expect(heightAt(page.band!, 0)).toBeCloseTo(heightAt(result.pages[0]!.band!, result.paper.widthMm)!, 6);
  });

  it('takes a short page directly from its final picture to the spine, with no empty-cell tail', () => {
    const result = flow(steps(12, index => ({ breakBefore: index === 4 })), { stepsPerPage: 9 });
    const page = result.pages[0]!, lane = page.band!;
    expect(page.cells).toHaveLength(4);
    const last = centreOf(page.cells.at(-1)!);
    const knots = [lane.from, ...lane.curves.map(c => c.to)];
    const beyond = knots.slice(knots.findIndex(k => Math.hypot(k.x - last.x, k.y - last.y) < 1e-8) + 1);
    expect(beyond).toHaveLength(2);
    expect(beyond.map(p => p.x)).toEqual([result.paper.widthMm, result.paper.widthMm + 10]);
  });

  it('packs the same occupied steps the same way, whether a page limit or explicit break ends the page', () => {
    // 7 steps on A4 are 3 · 3 · 1: the lane goes on from the seventh through the two empty cells.
    const short = flow(steps(14), { stepsPerPage: 7 });
    expect(short.pages.map((page) => page.cells.length)).toEqual([7, 7]);
    const lane = short.pages[0]!.band!;
    const knots = [lane.from, ...lane.curves.map((curve) => curve.to)];
    const seventh = centreOf(short.pages[0]!.cells[6]!);
    const beyond = knots.slice(knots.findIndex((knot) => knot.x === seventh.x && knot.y === seventh.y) + 1);
    // Only the spine and bleed follow the last picture; no unused cells.
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
            expect(first.cellMm.x, label).toBeLessThan(result.paper.widthMm / 3);
            expect(first.rightToLeft).toBe(false);
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
    expect(one.cells[0]!.cellMm.x).toBeLessThan(result.paper.widthMm / 3);
    expect(one.cells[0]!.rightToLeft).toBe(false);
    expect(one.cells[0]!.cellMm.y).toBeLessThan(one.cells[8]!.cellMm.y);
    // Its last row ends at the outer edge: the lane runs off it there.
    const end = one.band!.curves.at(-1)!.to.x;
    expect(end === result.paper.widthMm + 10 || end === centreOf(one.cells.at(-1)!).x).toBe(true);
  });
});

describe('a turn across a flow row break, on the lane', () => {
  const over = (id: string): LayoutTurn => ({ id, turn: { kind: 'turn-over', axis: 'vertical' } });
  const clear = (page: ReturnType<typeof flow>['pages'][number]) => {
    for (const turn of page.turns) for (const cell of page.cells) for (const part of ['picture', 'number', 'text'] as const) {
      const b = partBox(cell, part);
      if (!b.w || !b.h) continue;
      const overlaps = turn.at.x + turn.box.w / 2 > b.x && turn.at.x - turn.box.w / 2 < b.x + b.w && turn.at.y + turn.box.h / 2 > b.y && turn.at.y - turn.box.h / 2 < b.y + b.h;
      expect(overlaps, `${turn.id} over step ${cell.number} ${part}`).toBe(false);
    }
  };
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
          expect(k).toBeGreaterThan(0);
          expect(distance(lanes[pageIndex]!, turn.at), `${turn.id} ${showPath}`).toBeLessThan(.05);
          expect(turn.rightToLeft).toBe(page.cells[k]!.rightToLeft);

        }
        expect(page.turns, `page ${pageIndex + 1}`).toHaveLength(2);
        clear(page);
      });

    }
  });

  it('keeps the upper step’s words clear of turns on a page read up', () => {
    // Long words on step 13 (page 2's middle row, over the bend from 12): it gives way, as a step over a bend does.
    const long = 'Fold the corners in to the centre, crease and unfold, then turn the model over and fold it in half again. '.repeat(3);
    const list = steps(16, (index) =>
      index === 12 ? { text: long, turnsBefore: [over('turn-a'), over('turn-b'), over('turn-c')] } : {}
    );
    const page = flow(list, { stepsPerPage: 9 }).pages[1]!;
    expect(page.turns).toHaveLength(3);
    clear(page);
  });
});
