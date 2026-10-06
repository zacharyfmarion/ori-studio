import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PAGE_SETUP, type DiagramPageSetup } from '../document/diagramDocument';
import {
  FIT_RUN_BREAK,
  FIT_SAME,
  FIT_ZOOM,
  layoutDiagramPages,
  MARKS_FLOOR,
  overrunFit,
  pictureFloor,
  pictureOverrun,
  runLevels,
  scaleRuns,
  STEP_NUMBER_SIZE_MM,
  STEP_TEXT_LEADING_MM,
  STEP_TEXT_SIZE_MM,
  TURN_GUTTER_MM,
  TURN_STACK_CLEAR_MM,
  turnGlyphMm,
  type LayoutCell,
  type LayoutPage,
  type LayoutStep,
  type LayoutTurn,
} from './diagramPageLayout';
import { readFontMetrics, type FontMetrics } from '../fonts/fontMetrics';
import { curvePoint, curveStart, type Lane } from './flowLane';
import { estimateTextSetter } from './estimateTextSetter';
import { fontTextSetter } from './fontTextSetter';
import { printPaper } from './printPaper';

const SHORT = 'Fold in half.';
const LONG =
  'Fold the bottom edge up to the top edge, crease firmly, unfold, then fold both sides in to meet the centre line and turn the model over carefully.';

const NO_MARKS = { width: 0, height: 0 };

function step(index: number, patch: Partial<LayoutStep> = {}): LayoutStep {
  return {
    id: `step-${index}`,
    text: SHORT,
    breakBefore: false,
    picture: { kind: 'paper', width: 400, height: 400, frame: { width: 400, height: 400 }, marks: NO_MARKS },
    turnsBefore: [],
    turnsAfter: [],
    ...patch,
  };
}

const steps = (count: number, patch: (index: number) => Partial<LayoutStep> = () => ({})) =>
  Array.from({ length: count }, (_, index) => step(index, patch(index)));

/** The pages under a setup: the grid unless it says, as these cases were written for (a new diagram's is the flow). */
function layout(list: LayoutStep[], setup: Partial<DiagramPageSetup> = {}, title = 'Crane') {
  return layoutDiagramPages(list, { ...DEFAULT_PAGE_SETUP, layout: 'grid', ...setup }, title, estimateTextSetter);
}

const paper = (width: number, height: number = width): LayoutStep['picture'] => ({
  kind: 'paper',
  width,
  height,
  frame: { width, height },
  marks: NO_MARKS,
});
/** A picture `width` × `height` in its units, its marks reaching `marks` mm past that at their pt size. */
const marked = (width: number, height: number, marks: { width: number; height: number }): LayoutStep['picture'] => ({
  kind: 'paper',
  width,
  height,
  frame: { width, height },
  marks,
});
const upload = (width: number, height: number): LayoutStep['picture'] => ({
  kind: 'fit',
  width,
  height,
  frame: { width, height },
  marks: NO_MARKS,
});

/** How near the lane comes to a point, mm: sampled finely along each of its curves. */
function laneDistance(lane: Lane, point: { x: number; y: number }): number {
  let nearest = Infinity;
  lane.curves.forEach((curve, index) => {
    const from = curveStart(lane, index);
    for (let n = 0; n <= 2000; n += 1) {
      const at = curvePoint(from, curve, n / 2000);
      nearest = Math.min(nearest, Math.hypot(at.x - point.x, at.y - point.y));
    }
  });
  return nearest;
}

/** Where a cell draws its picture, at its scale, centred in its room. */
function drawnOf(cell: LayoutCell, picture: LayoutStep['picture']) {
  const scale = cell.mmPerUnit ?? cell.frameMm;
  if (!picture || scale === null) return null;
  const w = picture.width * scale;
  const h = picture.height * scale;
  return { x: cell.drawMm.x + (cell.drawMm.w - w) / 2, y: cell.drawMm.y + (cell.drawMm.h - h) / 2, w, h };
}

describe('printPaper', () => {
  it('turns the sheet for landscape, B5 being the JIS size', () => {
    expect(printPaper({ size: 'a4', orientation: 'landscape', marginMm: 12 })).toEqual({
      widthMm: 297,
      heightMm: 210,
      marginMm: 12,
    });
    expect(printPaper({ size: 'b5-jis', orientation: 'portrait', marginMm: 0 })).toMatchObject({ widthMm: 182, heightMm: 257 });
  });
});

describe('scaleRuns', () => {
  const fit = (shared: number, own = shared) => ({ own, shared });
  const scales = (fits: { own: number; shared: number }[]) => scaleRuns(fits).map(({ scale }) => scale);
  const each = (values: number[]) => values.map((value) => fit(value));

  it('keeps one scale while each fits it, the smallest of them', () => {
    expect(scales(each([1, 1.1, 0.95]))).toEqual([0.95, 0.95, 0.95]);
    expect(scaleRuns([])).toEqual([]);
  });

  it('draws a model smaller for one step at its neighbours’ scale, and zooms in where it stays smaller', () => {
    expect(scales(each([1, 1, 2, 1, 1]))).toEqual([1, 1, 1, 1, 1]);
    expect(scales(each([1, 1, 1, 2, 2, 2]))).toEqual([1, 1, 1, 2, 2, 2]);
  });

  it('lowers a run for a step needing a little more room, and lets one needing much more stand alone', () => {
    expect(scales(each([1, 1, 0.85, 1, 1]))).toEqual([0.85, 0.85, 0.85, 0.85, 0.85]);
    expect(scales(each([1, 1, 1, 1, 0.3, 1, 1, 1, 1]))).toEqual([1, 1, 1, 1, 0.3, 1, 1, 1, 1]);
    // Unfolded for good: a run of its own.
    expect(scales(each([1, 1, 1, 0.4, 0.4, 0.4]))).toEqual([1, 1, 1, 0.4, 0.4, 0.4]);
  });

  it('draws one model alike however its steps’ instructions vary its room (review)', () => {
    // The square base, then five bird bases whose three-line instructions leave them less room.
    expect(new Set(scales(each([0.1979, 0.1741, 0.1538, 0.1741, 0.1538, 0.1741])))).toEqual(new Set([0.1538]));
  });

  it('never flickers between two scales every step all fit (review)', () => {
    expect(new Set(scales(each([1, 0.85, 1.2, 0.96, 1])))).toEqual(new Set([0.85]));
    expect(new Set(scales(each([1, 0.85, 1.2, 0.85, 1])))).toEqual(new Set([0.85]));
  });

  it('gives the same answer read from either end', () => {
    let seed = 11;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      const values = Array.from({ length: 2 + Math.floor(random() * 12) }, () => 0.2 + random() * 2);
      const forward = scales(each(values));
      const backward = scales(each([...values].reverse())).reverse();
      expect(backward).toEqual(forward);
      // And never past what a picture fits, nor changing from one step to the next by less than a zoom.
      forward.forEach((scale, index) => expect(scale).toBeLessThanOrEqual(values[index]!));
      forward.slice(1).forEach((scale, index) => {
        const before = forward[index]!;
        if (scale !== before) expect(Math.max(scale, before) / Math.min(scale, before)).toBeGreaterThanOrEqual(FIT_ZOOM * (1 - 1e-9));
      });
    }
  });

  it('gives the same answer from either end where costs tie: a model back at a size it had, or shrinking by equal steps (review)', () => {
    const runs = (...parts: [number, number][]) => parts.flatMap(([steps, fit]) => Array<number>(steps).fill(fit));
    const cases = [
      runs([10, 1], [10, 0.8], [10, 0.64], [10, 0.512]),
      runs([10, 1], [10, 1.25], [10, 1.5625]),
      runs([10, 1], [10, 0.8], [10, 1.03], [10, 0.7]),
      runs([6, 0.172], [6, 0.144], [6, 0.175], [6, 0.125]),
      Array.from({ length: 40 }, (_, k) => 1.03 ** k),
      // Ratios that tie exactly: 0.9 / 0.6 = 0.6 / 0.4 (third review).
      [0.9, 1.8, 0.6, 1.3, 0.4, 0.6, 1.9, 1.2, 2, 2],
    ];
    for (const values of cases) {
      expect(scales(each([...values].reverse())).reverse()).toEqual(scales(each(values)));
    }
    // A model that shrinks and grows back as it shrank is drawn the same both ways, not with the zoom at one end (third review).
    for (const values of [
      [2, 1, 0.5, 0.5, 1, 2],
      [2, 1, 0.5, 1.2, 0.5, 1.2, 0.5, 1, 2],
      [1.93, 1.69, 1.3, 1.3, 1, 1, 1.3, 1.3, 1.69, 1.93],
    ]) {
      const drawn = scales(each(values));
      expect([...drawn].reverse(), values.join(' ')).toEqual(drawn);
      // As real fits are: the same picture a row lower, its room a few ulps off (review 4).
      const bumped = (at: number, ulps: number) => values.map((value, index) => (index === at ? value * (1 + ulps * Number.EPSILON) : value));
      for (const nudged of [bumped(values.length - 1, 1), bumped(0, 1), bumped(1, -2)]) {
        const near = scales(each(nudged));
        expect([...near].reverse(), nudged.join(' ')).toEqual(near);
      }
      let seed = 7;
      for (let trial = 0; trial < 200; trial += 1) {
        const noisy = values.map((value) => {
          seed = (seed * 16807) % 2147483647;
          return value * (1 + (Math.floor((seed / 2147483647) * 9) - 4) * Number.EPSILON);
        });
        const near = scales(each(noisy));
        expect(near.map((scale) => Number(scale.toPrecision(12))).reverse(), noisy.join(' ')).toEqual(
          near.map((scale) => Number(scale.toPrecision(12)))
        );
      }
    }
  });

  it('finds the cut and the scales that cost least, as every one tried in turn does (review)', () => {
    // Fits more than FIT_SAME apart, a zoom under each included, so nothing is snapped after.
    const FITS = [0.5, 1, 1.2, 1.45];
    const zoom = Math.log(FIT_ZOOM);
    const costOf = (values: number[], drawn: number[]) =>
      values.reduce((sum, value, index) => sum + Math.log(value / drawn[index]!), 0) +
      drawn.slice(1).filter((scale, index) => scale !== drawn[index]).length * FIT_RUN_BREAK;
    /**
     * The least cost of every cut into runs, each run at any level its pictures fit but a whole zoom under
     * its smallest, each a zoom from the next: a picture's own, or any number of zooms under it, as a run
     * held under one held under another is (third review).
     */
    const cheapest = (values: number[]) => {
      const levels = [...new Set(FITS.flatMap((fit) => Array.from({ length: 7 }, (_, k) => Math.log(fit) - k * zoom)))];
      let least = Infinity;
      const walk = (start: number, previous: number | null, cost: number) => {
        if (start === values.length) {
          least = Math.min(least, cost);
          return;
        }
        for (let end = start + 1; end <= values.length; end += 1) {
          const run = values.slice(start, end);
          const low = Math.log(Math.min(...run));
          for (const level of levels) {
            if (level > low + 1e-12) continue;
            if (level <= low - zoom * (1 - 1e-9)) continue;
            if (previous !== null && Math.abs(level - previous) < zoom * (1 - 1e-9)) continue;
            const spent = run.reduce((sum, value) => sum + Math.log(value) - level, 0) + (previous === null ? 0 : FIT_RUN_BREAK);
            walk(end, level, cost + spent);
          }
        }
      };
      walk(0, null, 0);
      return least;
    };
    let seed = 5;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let trial = 0; trial < 150; trial += 1) {
      const values = Array.from({ length: 2 + Math.floor(random() * 5) }, () => FITS[Math.floor(random() * FITS.length)]!);
      expect(costOf(values, scales(each(values))), values.join(' ')).toBeCloseTo(cheapest(values), 9);
    }
  });

  it('never changes scale by less than a zoom reads as, from one step to the next (review)', () => {
    // The crane: the square base, the bird base, and the kite, a fifth smaller, for its last seven steps.
    const crane = each([0.096, 0.096, 0.085, 0.168, 0.168, 0.168, 0.168, 0.144, 0.172, 0.172, 0.172, 0.172, 0.172, 0.172, 0.236]);
    expect(scales(crane)).toEqual([...Array(3).fill(0.085), ...Array(12).fill(0.144)]);
    // A model half the size for long enough still zooms in.
    expect(scales(each([1, 1, 1, 1.5, 1.5, 1.5, 1.5]))).toEqual([1, 1, 1, 1.5, 1.5, 1.5, 1.5]);
    // Shrinking a fifth at a time: one zoom, between the two that are furthest apart.
    expect(scales(each([...Array(5).fill(0.5), ...Array(5).fill(0.6), ...Array(5).fill(0.75)]))).toEqual([
      ...Array(10).fill(0.5),
      ...Array(5).fill(0.75),
    ]);
  });

  it('zooms where the model ends much smaller, though it got there by steps each too small to read (review)', () => {
    const fill = (steps: number, fit: number) => Array<number>(steps).fill(fit);
    // A fifth, then a fifth more: the last twenty drawn half as large again, not all at the first.
    expect(scales(each([...fill(20, 1), ...fill(5, 1.25), ...fill(20, 1.5)]))).toEqual([...fill(25, 1), ...fill(20, 1.5)]);
    const stepped = scales(each([...fill(5, 0.5), ...fill(5, 0.625), ...fill(5, 0.75)]));
    expect(new Set(stepped).size).toBe(2);
    expect(stepped[14]! / stepped[0]!).toBeGreaterThanOrEqual(FIT_ZOOM);
    // A model growing 3.5% a step for thirty steps zooms as it goes: no picture drawn at half its size.
    const growing = Array.from({ length: 30 }, (_, k) => 1 / 1.035 ** k);
    const drawn = scales(each(growing));
    expect(new Set(drawn).size).toBeGreaterThan(2);
    growing.forEach((fit, index) => expect(fit / drawn[index]!).toBeLessThan(1.5));
  });

  it('draws a step needing a little more room a zoom under its neighbours, rather than draw every one at its scale (review)', () => {
    const fill = (steps: number, fit: number) => Array<number>(steps).fill(fit);
    expect(scales(each([...fill(20, 1), 0.78, ...fill(20, 1)]))).toEqual([...fill(20, 1), 1 / FIT_ZOOM, ...fill(20, 1)]);
    // Needing much more: alone at its own.
    expect(scales(each([...fill(20, 1), 0.5, ...fill(20, 1)]))).toEqual([...fill(20, 1), 0.5, ...fill(20, 1)]);
  });

  it('draws a run under a chain of zooms where that costs least, not only one zoom under a picture (third review)', () => {
    const fill = (steps: number, fit: number) => Array<number>(steps).fill(fit);
    // One step a little smaller than six a zoom under twenty: two zooms under the twenty, not alone at a third.
    const chain = scales(each([fill(1, FIT_ZOOM ** -1.9), fill(6, FIT_ZOOM ** -0.5), fill(20, 1)].flat()));
    expect(chain[0]).toBeCloseTo(FIT_ZOOM ** -2, 9);
    expect(chain[1]).toBeCloseTo(1 / FIT_ZOOM, 9);
    expect(chain[26]).toBe(1);
    // A model shrinking a fifth at a time: a zoom at each, the first ten at their own.
    const staircase = scales(each([fill(10, 1), fill(10, 0.8), fill(10, 0.6), fill(10, 0.46)].flat()));
    expect(staircase.slice(0, 10)).toEqual(fill(10, 1));
    expect(staircase[10]).toBeCloseTo(1 / FIT_ZOOM, 9);
    expect(staircase[20]).toBeCloseTo(FIT_ZOOM ** -2, 9);
    expect(staircase[30]).toBeCloseTo(FIT_ZOOM ** -3, 9);
  });

  it('never draws a run a whole zoom under its own pictures, to part two scales by less than a zoom (review)', () => {
    const fill = (steps: number, fit: number) => Array<number>(steps).fill(fit);
    // A model a seventh or a tenth smaller for long: one scale, not one step dipped a zoom between two.
    expect(scales(each([...fill(20, 1), ...fill(20, 1.14)]))).toEqual(fill(40, 1));
    expect(scales(each([...fill(20, 1.14), ...fill(20, 1)]))).toEqual(fill(40, 1));
    expect(scales(each([...fill(40, 1), ...fill(40, 1.1)]))).toEqual(fill(80, 1));
    // Nor where the scale past it would have been snapped to the one before it.
    expect(scales(each([...fill(60, 1), ...fill(60, 1.06)]))).toEqual(fill(120, 1));
    // Nor snapped there after the cut: a step a zoom under the run before it is not snapped down to a
    // scale near that, more than a zoom under its own fit (review 4).
    expect(scales(each([...fill(10, 0.73), ...fill(10, 0.3), ...fill(50, 1), 0.97])).at(-1)).toBeCloseTo(1 / FIT_ZOOM, 9);

    // Phases of a model changing size, each step a little off: a run is drawn under both its
    // neighbours only where a picture in it needs the room.
    let seed = 11;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let trial = 0; trial < 200; trial += 1) {
      let level = 0;
      const values: number[] = [];
      for (let phase = 2 + Math.floor(random() * 3); phase > 0; phase -= 1) {
        level += (random() * 2 - 1) * 0.8 * Math.log(FIT_ZOOM);
        for (let step = 8 + Math.floor(random() * 40); step > 0; step -= 1) values.push(Math.exp(level) * (1 + (random() * 2 - 1) * 0.04));
      }
      const drawn = scales(each(values));
      const runs: { from: number; to: number }[] = [];
      drawn.forEach((scale, index) => {
        if (index > 0 && scale === drawn[index - 1]) runs[runs.length - 1]!.to = index + 1;
        else runs.push({ from: index, to: index + 1 });
      });
      runs.forEach((run, k) => {
        const [left, right] = [runs[k - 1], runs[k + 1]];
        if (!left || !right) return;
        const lower = Math.min(drawn[left.from]!, drawn[right.from]!);
        if (!(drawn[run.from]! < lower)) return;
        expect(Math.min(...values.slice(run.from, run.to)), `trial ${trial}, steps ${run.from}–${run.to}`).toBeLessThan(lower);
      });
      // And no run a whole zoom under its own smallest picture, snapped or not (review 4).
      runs.forEach((run) => {
        expect(Math.min(...values.slice(run.from, run.to)) / drawn[run.from]!, `trial ${trial}, steps ${run.from}–${run.to}`).toBeLessThan(FIT_ZOOM);
      });
    }
  });

  it('runs only at levels a picture is less than a zoom above, however far under the rest one fit is (review 4)', () => {
    // One picture drawn at nearly nothing among 300: a level for every zoom between would be 79,000.
    const shares = Array.from({ length: 300 }, (_, index) => (index === 150 ? 1e-30 : 1 + (index % 7) * 0.01));
    const { levels, scaleAt } = runLevels(shares);
    expect(levels.length).toBeLessThan(2 * shares.length);
    const zoom = Math.log(FIT_ZOOM);
    for (const level of levels) {
      expect(shares.some((share) => Math.log(share) >= level && Math.log(share) < level + zoom)).toBe(true);
      expect(Math.log(scaleAt.get(level)!)).toBeCloseTo(level, 9);
    }
    // Each picture's own, and the levels a zoom under one that another is less than a zoom above.
    expect(runLevels([1, 1 / 1.2]).levels.map(Math.exp)).toEqual([1 / 1.3, 1 / 1.2, 1].map((value) => expect.closeTo(value, 12)));
    // And the cut is the same: a step at nearly nothing alone, the rest one run.
    const drawn = scales(each(shares));
    expect(drawn[150]).toBe(1e-30);
    expect(new Set(drawn.filter((_, index) => index !== 150))).toEqual(new Set([1]));
  });

  it('draws runs whose scales are near one another at one, wherever they are', () => {
    expect(scales(each([1, 1, 1, 0.3, 0.3, 0.3, 1.04, 1.04, 1.04]))).toEqual([1, 1, 1, 0.3, 0.3, 0.3, 1, 1, 1]);
    expect(FIT_SAME).toBeGreaterThan(1.04);
  });

  it('draws a chain of near scales at the first of each, not one drifting into the next (review)', () => {
    const runs = (...parts: number[]) => parts.flatMap((fit) => Array<number>(3).fill(fit));
    expect(scales(each(runs(1.1, 0.5, 1.05, 0.5, 1)))).toEqual(runs(1.1, 0.5, 1, 0.5, 1));
  });

  it('keeps a zoom a run far off would take back, snapped to a scale too near its neighbour’s (review)', () => {
    const runs = (...parts: number[]) => parts.flatMap((fit) => Array<number>(10).fill(fit));
    // 1.37 is within FIT_SAME of 1.295, but 1.295 is no zoom from the 1 beside it.
    expect(scales(each(runs(1.295, 0.5, 1, 1.37)))).toEqual(runs(1.295, 0.5, 1, 1.37));
  });

  it('draws one whose own room is smaller than its share at its own, alone', () => {
    const runs = scaleRuns([fit(1), fit(1, 0.6), fit(1)]);
    expect(runs.map(({ scale }) => scale)).toEqual([1, 0.6, 1]);
    expect(runs.map(({ reduced }) => reduced)).toEqual([false, true, false]);
  });

  it('draws a picture that fits nothing at nothing, and the rest as though it were not there', () => {
    expect(scales([fit(1), fit(0), fit(1)])).toEqual([1, 0, 1]);
    const broken = scales([fit(1), fit(Number.NaN), fit(1)]);
    expect([broken[0], broken[2]]).toEqual([1, 1]);
  });
});

describe('pictureOverrun and pictureFloor', () => {
  const line = (grows: number, beyond: number) => ({ grows, beyond });
  /** A unit-square paper picture, its marks past each side as given. */
  const square = (left: number, right: number, top = 0, bottom = 0) => ({
    kind: 'paper' as const,
    width: 1,
    height: 1,
    frame: { width: 1, height: 1 },
    marks: { width: left + right, height: top + bottom },
    sides: { left: line(0, left), right: line(0, right), top: line(0, top), bottom: line(0, bottom) },
  });

  it('is how far a picture hangs out of its room as the page places it: nothing that fits, its marks split where they are even', () => {
    expect(pictureOverrun(square(1, 1), 20, 20, 15)).toBe(0);
    // 15 mm of paper and 4 mm past each side in a 20 mm room: 3 mm over, 1.5 out of each side.
    expect(pictureOverrun(square(4, 4), 20, 20, 15)).toBeCloseTo(1.5, 12);
    // All of it on one side: the paper against the far side of the room, its marks 4 mm out of the near one.
    expect(pictureOverrun(square(9, 0), 20, 20, 15)).toBeCloseTo(4, 12);
    // The worse way of the two.
    expect(pictureOverrun(square(0, 0, 4, 4), 30, 20, 15)).toBeCloseTo(1.5, 12);
    // At the scale its fit gives it, as little as it can.
    const fit = overrunFit(20, 1, line(0, 4), line(0, 4));
    expect(pictureOverrun(square(4, 4), 20, 20, fit)).toBeCloseTo(0, 9);
  });

  it('is the least scale the fit draws a picture at: what grows with it half the room, the way that lets it shrink more', () => {
    const grown = { ...square(0, 0), sides: { left: line(0.5, 0), right: line(0.5, 0), top: line(0, 0), bottom: line(0, 0) } };
    // Across, 2 per scale grows in 20 mm; down, the paper alone in 30 mm.
    expect(pictureFloor(grown, 20, 30)).toBeCloseTo(((1 - MARKS_FLOOR) * 20) / 2, 12);
    expect(pictureFloor(square(1, 1), 20, 30)).toBeCloseTo((1 - MARKS_FLOOR) * 20, 12);
  });
});

describe('overrunFit', () => {
  const line = (grows: number, beyond: number) => ({ grows, beyond });

  it('fits marks even on both sides as it always did: as large as fits, else the floor (third review)', () => {
    // A unit frame, past each side a tenth of it and a mm: 1.2 × scale + 2 in all.
    expect(overrunFit(20, 1, line(0.1, 1), line(0.1, 1))).toBeCloseTo((20 - 2) / 1.2, 9);
    // Marks of 15 mm in a room of 20: the floor, what grows with the paper half the room.
    expect(overrunFit(20, 1, line(0.1, 7.5), line(0.1, 7.5))).toBeCloseTo((20 * (1 - MARKS_FLOOR)) / 1.2, 9);
    // Nothing past it: the paper fills the room.
    expect(overrunFit(20, 1, line(0, 0), line(0, 0))).toBeCloseTo(20, 9);
  });

  it('leaves a glyph larger than its paper the room where it is centred, and centres it where it is not (third review)', () => {
    // A glyph 11.6 mm tall, as large past either side as the paper is small: the paper fills its room.
    expect(overrunFit(10.2, 1, line(-0.5, 5.8), line(-0.5, 5.8))).toBeCloseTo(10.2, 9);
    // At the paper's foot it reaches past the top by 0.95 of the paper less, the bottom by 0.05: the paper
    // as large as lets it be centred, 1 + 0.9 of it in the room.
    expect(overrunFit(10.2, 1, line(-0.95, 5.8), line(-0.05, 5.8))).toBeCloseTo(10.2 / 1.9, 9);
    // Hanging wholly below the paper, it can be centred by no scale: the paper shrinks to its floor.
    expect(overrunFit(10, 1, line(0, 0), line(0, 8))).toBeCloseTo(10 * (1 - MARKS_FLOOR), 9);
  });

  it('counts a lip either side the reach may hang into for nothing', () => {
    // 2 mm past the bottom of a room of 10, with a lip of 1 mm: the paper 9 mm.
    expect(overrunFit(10, 1, line(0, 0), line(0, 2), 1)).toBeCloseTo(9, 9);
  });
});

describe('layoutDiagramPages', () => {
  it('puts every step in exactly one cell, in order, across pages, and no text below its cell', () => {
    const sizes: DiagramPageSetup['size'][] = ['a4', 'a5', 'b5-jis', 'letter'];
    for (const size of sizes) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        for (const layoutKind of ['grid', 'flow'] as const) {
          for (const [columns, rows] of [[2, 1], [3, 3], [5, 6]] as const) {
            // Square, tall and wide models, with no text, a line or a long instruction.
            const shapes = [paper(400), paper(200, 600), paper(600, 150)];
            const list = steps(23, (index) => ({
              text: index % 4 === 3 ? '' : index % 3 ? SHORT : LONG,
              picture: shapes[index % shapes.length]!,
            }));
            const result = layout(list, { size, orientation, layout: layoutKind, columns, rows });
            const placed = result.pages.flatMap((page) => page.cells.map((cell) => cell.stepId));
            expect(placed).toEqual(list.map((s) => s.id));
            for (const cell of result.pages.flatMap((page) => page.cells)) {
              // Every picture fits the room it is drawn in, at its scale.
              const drawn = drawnOf(cell, list.find((each) => each.id === cell.stepId)!.picture)!;
              expect(drawn.w).toBeLessThanOrEqual(cell.drawMm.w + 1e-9);
              expect(drawn.h).toBeLessThanOrEqual(cell.drawMm.h + 1e-9);
            }
            for (const page of result.pages) {
              for (const cell of page.cells) {
                const lastBaseline = cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM;
                if (cell.text.lines.length > 0) expect(lastBaseline).toBeLessThanOrEqual(cell.cellMm.y + cell.cellMm.h + 1e-9);
                // The picture box and the room it is drawn in are inside the cell, under the number, over the text.
                expect(cell.pictureMm.x).toBeGreaterThanOrEqual(cell.cellMm.x - 1e-9);
                expect(cell.pictureMm.x + cell.pictureMm.size).toBeLessThanOrEqual(cell.cellMm.x + cell.cellMm.w + 1e-9);
                expect(cell.pictureMm.y).toBeGreaterThan(cell.numberAt.y);
                expect(cell.drawMm.x).toBeGreaterThanOrEqual(cell.cellMm.x - 1e-9);
                expect(cell.drawMm.x + cell.drawMm.w).toBeLessThanOrEqual(cell.cellMm.x + cell.cellMm.w + 1e-9);
                expect(cell.drawMm.h).toBeGreaterThanOrEqual(cell.pictureMm.size - 1e-9);
                // Never past the cell further than the box itself (12 mm at least) already is.
                const floor = Math.max(cell.cellMm.y + cell.cellMm.h, cell.pictureMm.y + cell.pictureMm.size);
                expect(cell.drawMm.y + cell.drawMm.h).toBeLessThanOrEqual(floor + 1e-9);
                if (cell.text.lines.length > 0) expect(cell.text.firstBaseline).toBeGreaterThan(cell.drawMm.y + cell.drawMm.h);
                // Every line fits its slot.
                for (const line of cell.text.lines) expect(line.widthMm).toBeLessThanOrEqual(cell.text.widthMm + 1e-9);
              }
            }
          }
        }
      }
    }
  });

  it('keeps every line inside its slot with the fonts’ own advances too', () => {
    const read = (path: string) => readFontMetrics(readFileSync(resolve(process.cwd(), 'src/diagram/fonts', path)));
    const fonts: Partial<Record<string, FontMetrics>> = {
      'latin-400': read('NotoSans-Regular.ttf'),
      'latin-700': read('NotoSans-Bold.ttf'),
      'sc-400': read('fixtures/NotoSansSC-Regular.fixture.ttf'),
    };
    const setter = fontTextSetter((key, weight) => fonts[`${key}-${weight}`] ?? null, 'sc');
    const CJK = '将底角向上折至顶角，压实折痕后展开。将底角向上折至顶角，压实折痕后展开。';
    for (const [columns, rows] of [[2, 1], [3, 3], [5, 6]] as const) {
      const list = steps(12, (index) => ({ text: [SHORT, LONG, CJK][index % 3]! }));
      const result = layoutDiagramPages(list, { ...DEFAULT_PAGE_SETUP, layout: 'grid', columns, rows }, 'Crane', setter);
      for (const cell of result.pages.flatMap((page) => page.cells)) {
        for (const line of cell.text.lines) expect(line.widthMm).toBeLessThanOrEqual(cell.text.widthMm + 1e-9);
        const last = cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM;
        if (cell.text.lines.length > 0) expect(last).toBeLessThanOrEqual(cell.cellMm.y + cell.cellMm.h + 1e-9);
      }
    }
  });

  it('starts a new page at a step that asks for one', () => {
    const list = steps(5, (index) => ({ breakBefore: index === 2 }));
    const result = layout(list);
    expect(result.pages.map((page) => page.cells.map((cell) => cell.number))).toEqual([[1, 2], [3, 4, 5]]);
    // A break on a page's first step is no extra page.
    expect(layout(steps(2, (index) => ({ breakBefore: index === 0 }))).pages).toHaveLength(1);
  });

  it('draws every paper picture at one scale under One scale: the largest at which each fits its room', () => {
    const list = [step(0, { picture: paper(400) }), step(1, { picture: paper(200) }), step(2, { picture: paper(150, 450) })];
    const result = layout(list, { scale: 'paper' });
    const [first, second, tall] = result.pages[0]!.cells;
    // The smaller model is drawn smaller: one scale, not two fits.
    for (const cell of [first, second, tall]) expect(cell!.mmPerUnit).toBe(result.mmPerUnit);
    // The largest: the square fills its room across, or the tall one its room down.
    const limits = [first!.drawMm.w / 400, tall!.drawMm.h / 450, first!.drawMm.h / 400];
    expect(Math.min(...limits.map((limit) => Math.abs(limit - result.mmPerUnit!)))).toBeLessThan(1e-9);
    // The tall one runs past its square box, its text below it.
    expect(tall!.drawMm.h).toBeGreaterThan(tall!.pictureMm.size);
    expect(tall!.text.firstBaseline).toBeGreaterThan(tall!.drawMm.y + tall!.drawMm.h);
    // Uploads are fitted to their box under One scale.
    const fitted = layout([step(0, { picture: upload(1, 1) })], { scale: 'paper' }).pages[0]!.cells[0]!;
    expect(fitted.mmPerUnit).toBeNull();
    expect(fitted.frameMm).toBeNull();
  });

  it('fits each by default, keeping the paper one scale while it can, a taller model running taller', () => {
    expect(DEFAULT_PAGE_SETUP.scale).toBe('fit');
    // Zach's crane in paper units: the square base, its kite, the bird base taller than both, no words under it.
    const list = [
      step(0, { picture: paper(283, 285) }),
      step(1, { picture: paper(283, 285) }),
      step(2, { picture: paper(166, 403), text: '' }),
    ];
    const result = layout(list);
    expect(result.mmPerUnit).toBeNull();
    const [base, kite, bird] = result.pages[0]!.cells;
    expect(kite!.mmPerUnit).toBe(base!.mmPerUnit);
    expect(bird!.mmPerUnit).toBe(base!.mmPerUnit);
    for (const cell of [base, kite, bird]) expect(cell!.scaleReduced).toBe(false);
    // The bird base is drawn taller than its box at the run's scale, not shrunk into it.
    expect(bird!.drawMm.h).toBeCloseTo(403 * bird!.mmPerUnit!, 9);
    expect(bird!.drawMm.h).toBeGreaterThan(bird!.pictureMm.size);
    // The square base alone would be drawn larger: the run gave a little for the bird base.
    const alone = layout([list[0]!]).pages[0]!.cells[0]!;
    expect(alone.mmPerUnit!).toBeGreaterThan(base!.mmPerUnit!);
  });

  it('zooms in where the model stays much smaller, and draws pictures with no paper by their frames', () => {
    const small = (index: number) => step(index, { picture: paper(150) });
    const list = [step(0, { picture: paper(400) }), step(1, { picture: paper(400) }), small(2), small(3), small(4)];
    const [a, b, c, d] = layout(list).pages[0]!.cells;
    expect(b!.mmPerUnit).toBe(a!.mmPerUnit);
    expect(c!.mmPerUnit! / a!.mmPerUnit!).toBeGreaterThan(2);
    expect(d!.mmPerUnit).toBe(c!.mmPerUnit);
    expect(c!.scaleReduced).toBe(false);
    // Smaller for one step only: drawn at its neighbours' scale.
    const blip = layout([step(0, { picture: paper(400) }), small(1), step(2, { picture: paper(400) })]).pages[0]!.cells;
    expect(new Set(blip.map((cell) => cell.mmPerUnit)).size).toBe(1);
    // Uploads keep one frame among themselves, apart from the paper.
    const mixed = layout([step(0, { picture: upload(1, 0.5) }), step(1, { picture: paper(400) }), step(2, { picture: upload(1, 1) })]);
    const [wide, cp, square] = mixed.pages[0]!.cells;
    expect(wide!.frameMm).toBe(square!.frameMm);
    expect(wide!.mmPerUnit).toBeNull();
    expect(cp!.frameMm).toBeNull();
  });

  it('draws a step that needs much more room smaller alone between steps that do not, and starts a run when it lasts', () => {
    const run = [step(0, { picture: paper(400) }), step(1, { picture: paper(400) })];
    const once = layout([...run, step(2, { picture: paper(400, 900) }), step(3, { picture: paper(400) }), step(4, { picture: paper(400) })]);
    const [a, , far, after] = once.pages[0]!.cells;
    expect(far!.mmPerUnit!).toBeLessThan(a!.mmPerUnit! * 0.6);
    expect(after!.mmPerUnit).toBe(a!.mmPerUnit);
    // Unfolded for good: the steps from it are a run of their own.
    const unfolded = layout([...run, step(2, { picture: paper(400, 900) }), step(3, { picture: paper(400, 900) })]);
    const [, , first, second] = unfolded.pages[0]!.cells;
    expect(first!.scaleReduced).toBe(false);
    expect(second!.mmPerUnit).toBe(first!.mmPerUnit);
  });

  it('gives marks that keep their pt size up to their floor of the room, and where marks lie always', () => {
    for (const scale of ['fit', 'paper'] as const) {
      // A square picture's room is its cell's width less the gutter: under the height its short text leaves.
      const room = (cell: LayoutCell) => cell.drawMm.w;
      // Letters 10 mm across past a 400-unit sheet: they take 10 mm, the sheet the rest.
      const near = layout([step(0, { picture: marked(400, 400, { width: 10, height: 10 }) })], { scale }).pages[0]!.cells[0]!;
      expect(near.mmPerUnit! * 400).toBeCloseTo(room(near) - 10, 6);
      // Letters wider than the room: the sheet keeps its floor's share of it, the letters reach out.
      const over = layout([step(0, { picture: marked(400, 400, { width: 200, height: 200 }) })], { scale }).pages[0]!.cells[0]!;
      expect(over.mmPerUnit! * 400).toBeCloseTo(room(over) * (1 - MARKS_FLOOR), 6);
      // A mark lying far from the picture grows with it: the picture shrinks as far as it must, no floor.
      const far = layout([step(0, { picture: marked(1600, 400, { width: 0, height: 0 }) })], { scale }).pages[0]!.cells[0]!;
      expect(far.mmPerUnit! * 1600).toBeCloseTo(far.drawMm.w, 6);
    }
  });

  it('draws a picture whose box gave room to long text smaller alone, and never anything that is not a number', () => {
    const list = [
      step(0, { picture: paper(400) }),
      step(1, { picture: paper(400), text: `${LONG} ${LONG} ${LONG} ${LONG}` }),
      step(2, { picture: paper(400) }),
      step(3, { picture: { kind: 'paper', width: 0, height: Number.NaN, frame: { width: 0, height: 0 }, marks: NO_MARKS } }),
    ];
    const [a, long, c, broken] = layout(list).pages[0]!.cells;
    expect(c!.mmPerUnit).toBe(a!.mmPerUnit);
    expect(long!.scaleReduced).toBe(true);
    expect(long!.mmPerUnit!).toBeLessThan(a!.mmPerUnit!);
    expect(broken!.mmPerUnit).toBeNull();
    expect(broken!.drawMm.h).toBe(broken!.pictureMm.size);
  });

  it('gives a long instruction room from its picture, to half of it, then cuts it with "…"', () => {
    const fits = layout([step(0)]).pages[0]!.cells[0]!;
    const longer = layout([step(0, { text: LONG })]).pages[0]!.cells[0]!;
    expect(longer.pictureMm.size).toBeLessThan(fits.pictureMm.size);
    expect(longer.pictureMm.size).toBeGreaterThanOrEqual(fits.pictureMm.size * 0.5 - 1e-9);
    expect(longer.textOverflow).toBe(false);
    const endless = layout([step(0, { text: `${LONG} ${LONG} ${LONG} ${LONG}` })]).pages[0]!.cells[0]!;
    expect(endless.pictureMm.size).toBeCloseTo(fits.pictureMm.size * 0.5, 9);
    expect(endless.textOverflow).toBe(true);
    expect(endless.text.lines.at(-1)?.ellipsis).toBe(true);
    // Its picture is drawn smaller than the shared scale, alone.
    expect(endless.scaleReduced).toBe(true);
  });

  it('gives a short instruction its lines in a cell too small for them, and none it does not need', () => {
    // A4 landscape, six rows: at the full box the first baseline is below the
    // slot by more than a leading — the instruction must still be printed.
    const cell = layout([step(0)], { orientation: 'landscape', rows: 6 }).pages[0]!.cells[0]!;
    expect(cell.text.lines.map((line) => line.text)).toEqual([SHORT]);
    expect(cell.textOverflow).toBe(false);
    // Three to a row, every setup prints a short instruction whole; and no
    // setup leaves a cell with no text at all, even five to a row.
    for (const size of ['a4', 'a5', 'b5-jis', 'letter'] as const) {
      for (const orientation of ['portrait', 'landscape'] as const) {
        for (const layoutKind of ['grid', 'flow'] as const) {
          for (const rows of [1, 3, 6]) {
            const where = `${size} ${orientation} ${layoutKind} ${rows}`;
            const setup = { size, orientation, layout: layoutKind, rows };
            for (const placed of layout(steps(6), { ...setup, columns: 3 }).pages.flatMap((page) => page.cells)) {
              expect(placed.text.lines.map((line) => line.text).join(' '), where).toBe(SHORT);
              expect(placed.textOverflow, where).toBe(false);
            }
            for (const placed of layout(steps(6), { ...setup, columns: 5 }).pages.flatMap((page) => page.cells)) {
              expect(placed.text.lines.length, where).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });

  it('runs every other row back in flow, with a band that leaves the page where the sequence goes on', () => {
    const result = layout(steps(10), { layout: 'flow', columns: 3, rows: 2 });
    const [first, second] = result.pages;
    const xs = (cells: LayoutCell[]) => cells.map((cell) => cell.cellMm.x);
    // The left page ends its two rows at the spine: the first reads right to left, the second back.
    expect(xs(first!.cells.slice(0, 3))).toEqual([...xs(first!.cells.slice(0, 3))].sort((a, b) => b - a));
    expect(xs(first!.cells.slice(3, 6))).toEqual([...xs(first!.cells.slice(3, 6))].sort((a, b) => a - b));
    expect(first!.band?.curves.at(-1)?.to).toMatchObject({ x: result.paper.widthMm + 10 });
    expect(second!.band?.from).toMatchObject({ x: -10 });
    expect(layout(steps(3), { layout: 'flow', showPath: false }).pages[0]!.band).toBeNull();
  });

  it('numbers pages from the first number, each at its outer corner', () => {
    const result = layout(steps(12), { pageNumbers: { enabled: true, first: 4 } });
    expect(result.pages.map((page) => [page.number, page.side, page.pageNumberAt?.anchor])).toEqual([
      [4, 'left', 'start'],
      [5, 'right', 'end'],
    ]);
    // The first page on the right: its number at the right, whatever it is.
    const right = layout(steps(12), { firstPageSide: 'right' });
    expect(right.pages.map((page) => [page.number, page.side, page.pageNumberAt?.anchor])).toEqual([
      [1, 'right', 'end'],
      [2, 'left', 'start'],
    ]);
    expect(layout(steps(1), { pageNumbers: { enabled: false, first: 1 } }).pages[0]!.pageNumberAt).toBeNull();
  });

  it('cuts a title too long for the page with "…", inside its tab', () => {
    const long = 'Traditional Crane, folded from one fifteen centimetre square with a colour change on both wings';
    const result = layout(steps(1), { size: 'a5' }, long);
    const { tab, line, textAt, rule } = result.title!;
    expect(line.ellipsis).toBe(true);
    expect(tab.x + tab.w).toBeLessThanOrEqual(result.paper.widthMm - result.paper.marginMm + 1e-9);
    expect(textAt.x + line.widthMm).toBeLessThanOrEqual(tab.x + tab.w + 1e-9);
    expect(rule.x2).toBeGreaterThanOrEqual(rule.x1);
  });

  it('sizes the title tab to the title, and has no header without one', () => {
    const titled = layout(steps(1), {}, 'Crane');
    expect(titled.title?.tab.w).toBeCloseTo(titled.title!.line.widthMm + 8, 9);
    expect(layout(steps(1), {}, '   ').title).toBeNull();
    expect(layout(steps(1), { showTitle: false }).title).toBeNull();
    // Without the header the cells start at the margin.
    expect(layout(steps(1), { showTitle: false }).pages[0]!.cells[0]!.cellMm.y).toBe(DEFAULT_PAGE_SETUP.marginMm);
  });

  it('runs the title tab and rule on past the paper’s edge on a page with no margin, for a print shop’s bleed', () => {
    const edge = layout(steps(1), { marginMm: 0 }, 'Crane');
    const { tab, textAt, rule } = edge.title!;
    expect(tab.x).toBeLessThan(-3);
    expect(tab.y).toBeLessThan(-3);
    // The tab's inner edges and its text stay where the paper puts them.
    expect(tab.x + tab.w).toBeCloseTo(edge.title!.line.widthMm + 8, 9);
    expect(tab.y + tab.h).toBeCloseTo(7, 9);
    expect(textAt.x).toBe(4);
    expect(rule.x2).toBeGreaterThan(edge.paper.widthMm + 3);
    // With a margin, nothing reaches the edge, and nothing runs past it.
    const kept = layout(steps(1), {}, 'Crane').title!;
    expect(kept.tab.x).toBe(DEFAULT_PAGE_SETUP.marginMm);
    expect(kept.rule.x2).toBe(layout(steps(1)).paper.widthMm - DEFAULT_PAGE_SETUP.marginMm);
  });

  it('lays out an empty diagram as one empty page', () => {
    const result = layout([]);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.cells).toEqual([]);
  });
});

describe('turns between steps on the page (D22)', () => {
  const over = (id: string): LayoutTurn => ({ id, turn: { kind: 'turn-over', axis: 'vertical' } });
  const centreOf = (cell: { pictureMm: { x: number; y: number; size: number } }) => ({
    x: cell.pictureMm.x + cell.pictureMm.size / 2,
    y: cell.pictureMm.y + cell.pictureMm.size / 2,
  });

  it('keeps a gutter between all the pictures of a diagram with a turn: one scale, a little smaller', () => {
    // Landscape A4 at 5 × 2: cells narrow enough that their width, not their height, sets the box.
    const setup = { orientation: 'landscape', columns: 5, rows: 2 } as const;
    const plain = layout(steps(4), setup);
    const turning = layout(steps(4, (index) => (index === 2 ? { turnsBefore: [over('turn-a')] } : {})), setup);
    const box = (result: typeof plain) => result.pages[0]!.cells[0]!.pictureMm.size;
    expect(box(turning)).toBeCloseTo(box(plain) - (TURN_GUTTER_MM - 6), 6);
    // Every picture, not only the two beside the turn.
    expect(new Set(turning.pages[0]!.cells.map((cell) => cell.pictureMm.size)).size).toBe(1);
  });

  it('prints a turn midway between two pictures on a row, at their height', () => {
    const result = layout(steps(3, (index) => (index === 1 ? { turnsBefore: [over('turn-a')] } : {})));
    const [a, b] = result.pages[0]!.cells;
    const [turn] = result.pages[0]!.turns;
    expect(turn).toMatchObject({ id: 'turn-a', turn: { kind: 'turn-over' } });
    const right = a!.pictureMm.x + a!.pictureMm.size;
    expect(turn!.at.x).toBeCloseTo((right + b!.pictureMm.x) / 2, 6);
    expect(turn!.at.y).toBeCloseTo(centreOf(a!).y, 6);
  });

  it('prints one across a grid’s row or a page at the next picture’s leading edge, and one after the last at its trailing edge', () => {
    const list = steps(4, (index) =>
      index === 3 ? { turnsBefore: [over('turn-row')], turnsAfter: [over('turn-end')] } : {}
    );
    const result = layout(list, { columns: 3, rows: 3 });
    const cells = result.pages[0]!.cells;
    const byId = new Map(result.pages[0]!.turns.map((turn) => [turn.id, turn]));
    const fourth = cells[3]!;
    // Step 4 starts the second row: the turn before it sits at its left, half a gutter out.
    const gutter = fourth.cellMm.w - fourth.pictureMm.size;
    expect(byId.get('turn-row')!.at.x).toBeCloseTo(fourth.pictureMm.x - gutter / 2, 6);
    expect(byId.get('turn-row')!.at.y).toBeCloseTo(centreOf(fourth).y, 6);
    expect(byId.get('turn-end')!.at.x).toBeCloseTo(fourth.pictureMm.x + fourth.pictureMm.size + gutter / 2, 6);
  });

  /** Where a cell's text ends, with its descenders; its picture's bottom when it has none. */
  const textBottom = (cell: LayoutCell) =>
    cell.text.lines.length > 0
      ? cell.text.firstBaseline + (cell.text.lines.length - 1) * STEP_TEXT_LEADING_MM + 0.3 * STEP_TEXT_SIZE_MM
      : cell.drawMm.y + cell.drawMm.h;
  /** The top of a cell's number: its figures stand under three quarters of its size. */
  const numberTop = (cell: LayoutCell) => cell.numberAt.y - 0.75 * STEP_NUMBER_SIZE_MM;
  /** The turns' stack, top to bottom, as printed. */
  const extent = (turns: LayoutPage['turns']) => ({
    top: Math.min(...turns.map((turn) => turn.at.y - turn.box.h / 2)),
    bottom: Math.max(...turns.map((turn) => turn.at.y + turn.box.h / 2)),
  });

  it('prints one across a flow row’s end in the band’s bend: under the step before’s text, over the next one’s number', () => {
    // Zach, 2026-10-06, the X-ray Heart's page 1: "the turn over step between
    // 3 and 4 should be rendered in the flow lane between steps 3 and 4, not
    // to the right of step 4."
    const list = steps(9, (index) =>
      index === 3 ? { turnsBefore: [over('turn-down-right')] } : index === 6 ? { turnsBefore: [over('turn-down-left')] } : {}
    );
    const result = layout(list, { layout: 'flow', columns: 3, rows: 3 });
    const page = result.pages[0]!;
    const byId = new Map(page.turns.map((turn) => [turn.id, turn]));
    for (const [id, before] of [
      ['turn-down-right', 2],
      ['turn-down-left', 5],
    ] as const) {
      const turn = byId.get(id)!;
      const [above, below] = [page.cells[before]!, page.cells[before + 1]!];
      // On the lane itself, where it crosses the gap between the rows.
      expect(laneDistance(page.band!, turn.at), id).toBeLessThan(0.05);
      // Between the rows, clear of the words above and the number below, and centred there.
      const { top, bottom } = extent([turn]);
      expect(top, id).toBeGreaterThan(textBottom(above));
      expect(bottom, id).toBeLessThan(numberTop(below));
      expect(Math.abs(turn.at.y - (textBottom(above) + numberTop(below)) / 2), id).toBeLessThan(1);
    }
    // The first bend is at the right, the second at the left.
    expect(byId.get('turn-down-right')!.at.x).toBeGreaterThan(page.cells[2]!.pictureMm.x + page.cells[2]!.pictureMm.size);
    expect(byId.get('turn-down-left')!.at.x).toBeLessThan(page.cells[5]!.pictureMm.x);
    // Each goes the way of the row it leads into.
    expect(byId.get('turn-down-right')!.rightToLeft).toBe(true);
    expect(byId.get('turn-down-left')!.rightToLeft).toBe(false);
  });

  it('keeps a flow row’s end clear for the turns after it: the step before gives up its text’s room, or its picture’s', () => {
    const upright: LayoutTurn = { id: 'turn-b', turn: { kind: 'turn-over', axis: 'horizontal' } };
    const rotate: LayoutTurn = { id: 'turn-c', turn: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } } };
    const stacked = [over('turn-a'), upright, rotate];
    // A text that fills its cell to the last line, and a tall picture with no text.
    for (const before of [{ text: `${LONG} ${LONG} ${LONG}` }, { text: '', picture: paper(150, 600) }]) {
      const list = steps(6, (index) => (index === 2 ? before : index === 3 ? { turnsBefore: stacked } : {}));
      const result = layout(list, { layout: 'flow', columns: 3, rows: 3 });
      const page = result.pages[0]!;
      const [above, below] = [page.cells[2]!, page.cells[3]!];
      const { top, bottom } = extent(page.turns);
      const label = before.text === '' ? 'picture' : 'text';
      expect(top, label).toBeGreaterThanOrEqual(textBottom(above) + TURN_STACK_CLEAR_MM - 1e-6);
      expect(bottom, label).toBeLessThanOrEqual(numberTop(below) - TURN_STACK_CLEAR_MM + 1e-6);
      // Only the step before the turns gives way: without them, it reaches further down.
      const plain = layout(
        steps(6, (index) => (index === 2 ? before : index === 3 ? {} : index === 4 ? { turnsBefore: [over('turn-row')] } : {})),
        { layout: 'flow', columns: 3, rows: 3 }
      ).pages[0]!;
      expect(textBottom(plain.cells[2]!), label).toBeGreaterThan(top);
      expect(plain.cells[0]!.pictureMm.size).toBeCloseTo(page.cells[0]!.pictureMm.size, 6);
    }
  });

  it('prints one before a flow page’s first step at its leading edge, as on the page before there is no row to turn from', () => {
    const list = steps(11, (index) => (index === 0 || index === 9 ? { turnsBefore: [over(`turn-${index}`)] } : {}));
    const result = layout(list, { layout: 'flow', columns: 3, rows: 3 });
    for (const [pageIndex, id] of [
      [0, 'turn-0'],
      [1, 'turn-9'],
    ] as const) {
      const page = result.pages[pageIndex]!;
      const first = page.cells[0]!;
      const turn = page.turns.find((each) => each.id === id)!;
      expect(turn.at.x, id).toBeCloseTo(first.pictureMm.x - (first.cellMm.w - first.pictureMm.size) / 2, 6);
      expect(turn.at.y, id).toBeCloseTo(first.drawMm.y + first.drawMm.h / 2, 6);
    }
  });

  it('reads a flow row that runs right to left from its right, and says which way each turn’s row reads', () => {
    const list = steps(6, (index) =>
      index === 1
        ? { turnsBefore: [over('turn-first-row')] }
        : index === 2
          ? { turnsBefore: [over('turn-into')] }
          : index === 3
            ? { turnsBefore: [over('turn-a')] }
            : index === 4
              ? { turnsBefore: [over('turn-across')] }
              : index === 5
                ? { turnsAfter: [over('turn-end')] }
                : {}
    );
    const result = layout(list, { layout: 'flow', columns: 2, rows: 3 });
    // Steps 3 and 4 share the second row, read right to left: the turn is between them.
    const [, , third, fourth] = result.pages[0]!.cells;
    expect(third!.pictureMm.x).toBeGreaterThan(fourth!.pictureMm.x);
    const byId = new Map(result.pages[0]!.turns.map((turn) => [turn.id, turn]));
    expect(byId.get('turn-a')!.at.x).toBeCloseTo((fourth!.pictureMm.x + fourth!.pictureMm.size + third!.pictureMm.x) / 2, 6);
    // Each in the row of the step it comes before, or after the last: one
    // across into a row reads as that row does.
    expect(Object.fromEntries([...byId].map(([id, turn]) => [id, turn.rightToLeft]))).toEqual({
      'turn-first-row': false,
      'turn-into': true,
      'turn-a': true,
      'turn-across': false,
      'turn-end': false,
    });
    // A grid reads every row left to right.
    expect(layout(list, { columns: 2, rows: 3 }).pages[0]!.turns.every((turn) => !turn.rightToLeft)).toBe(true);
  });

  it('stands several turns in one place one above another, each clear of the next, and keeps them on the paper', () => {
    const upright: LayoutTurn = { id: 'turn-b', turn: { kind: 'turn-over', axis: 'horizontal' } };
    const rotate: LayoutTurn = { id: 'turn-c', turn: { kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } } };
    const list = steps(2, (index) => (index === 1 ? { turnsBefore: [over('turn-a'), upright, rotate] } : {}));
    const result = layout(list, { marginMm: 0 });
    const turns = result.pages[0]!.turns;
    expect(turns.map((turn) => turn.id)).toEqual(['turn-a', 'turn-b', 'turn-c']);
    expect(new Set(turns.map((turn) => turn.at.x)).size).toBe(1);
    // Each glyph's box, by how it stands: the top-to-bottom turn-over upright.
    expect(turns.map((turn) => turn.box)).toEqual(turns.map((turn) => turnGlyphMm(turn.turn)));
    expect(turns[1]!.box.h).toBeGreaterThan(turns[1]!.box.w);
    for (let n = 1; n < turns.length; n += 1) {
      const above = turns[n - 1]!;
      const below = turns[n]!;
      expect(below.at.y - below.box.h / 2 - (above.at.y + above.box.h / 2)).toBeCloseTo(TURN_STACK_CLEAR_MM, 6);
    }
    // The stack is centred where one would be.
    const [a, b] = result.pages[0]!.cells;
    const top = turns[0]!.at.y - turns[0]!.box.h / 2;
    const bottom = turns[2]!.at.y + turns[2]!.box.h / 2;
    expect((top + bottom) / 2).toBeCloseTo((centreOf(a!).y + centreOf(b!).y) / 2, 6);
  });

  it('keeps every glyph off the pictures and on the paper, whatever the margin, grid or flow', () => {
    const rotate: LayoutTurn = { id: 'turn-r', turn: { kind: 'rotate', rotate: { amount: 'half', direction: 'ccw' } } };
    const shapes = [paper(400), paper(150, 600), paper(700, 200)];
    const list = steps(9, (index) => ({
      picture: shapes[index % shapes.length]!,
      ...(index === 0
        ? { turnsBefore: [over('turn-first')] }
        : index === 3
          ? { turnsBefore: [over('turn-row'), rotate] }
          : index === 8
            ? { turnsAfter: [over('turn-end')] }
            : {}),
    }));
    const clash = (box: { x: number; y: number; w: number; h: number }, picture: { x: number; y: number; w: number; h: number }) =>
      box.x < picture.x + picture.w && picture.x < box.x + box.w && box.y < picture.y + picture.h && picture.y < box.y + box.h;
    const square = ({ x, y, size }: { x: number; y: number; size: number }) => ({ x, y, w: size, h: size });
    for (const pageLayout of ['grid', 'flow'] as const) {
      for (const marginMm of [0, 3, 5, 8, 12, 20, 30]) {
        const result = layout(list, { layout: pageLayout, marginMm });
        const { widthMm } = result.paper;
        for (const turn of result.pages[0]!.turns) {
          const box = { x: turn.at.x - turn.box.w / 2, y: turn.at.y - turn.box.h / 2, w: turn.box.w, h: turn.box.h };
          expect(box.x, `${pageLayout} ${marginMm} ${turn.id}`).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w, `${pageLayout} ${marginMm} ${turn.id}`).toBeLessThanOrEqual(widthMm);
          for (const cell of result.pages[0]!.cells) {
            expect(clash(box, square(cell.pictureMm)), `${pageLayout} ${marginMm} ${turn.id} over step ${cell.number}`).toBe(false);
            // Nor the picture as it is drawn, wider or taller than its box.
            const picture = list.find((each) => each.id === cell.stepId)!.picture;
            expect(clash(box, drawnOf(cell, picture)!), `${pageLayout} ${marginMm} ${turn.id} over drawn ${cell.number}`).toBe(false);
          }
        }
      }
    }
  });

  it('says which step each turn comes before, none for those after the last', () => {
    const list = steps(4, (index) =>
      index === 0 ? { turnsBefore: [over('turn-a')] } : index === 3 ? { turnsBefore: [over('turn-b')], turnsAfter: [over('turn-c')] } : {}
    );
    const turns = layout(list).pages[0]!.turns;
    expect(turns.map((turn) => [turn.id, turn.beforeStepId])).toEqual([
      ['turn-a', 'step-0'],
      ['turn-b', 'step-3'],
      ['turn-c', null],
    ]);
  });

  it('prints none on a diagram without turns, and keeps its pictures their size', () => {
    const result = layout(steps(3));
    expect(result.pages[0]!.turns).toEqual([]);
  });
});
