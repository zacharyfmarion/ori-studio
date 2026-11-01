import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { GRID_MIN_CELLS, StackHitIndex, type StackCell } from './stackHitIndex';
import {
  bruteForceCell,
  bruteForceCells,
  convexPartition,
  onAnOutline,
  queryTimes,
  samplePoints,
  scatteredHulls,
  scatteredStars,
  trominoPartition,
} from './stackHitIndex.fixtures';

const FIXTURES: { name: string; cells: StackCell[]; convex: boolean }[] = [
  { name: 'a square cut by 40 lines (convex, tiling)', cells: convexPartition(1, 40), convex: true },
  { name: '200 convex hulls (overlapping)', cells: scatteredHulls(4, 200), convex: true },
  { name: 'a 20 × 20 tromino tiling (non-convex, tiling)', cells: trominoPartition(2, 20), convex: false },
  { name: '200 stars (non-convex, overlapping)', cells: scatteredStars(3, 200), convex: false },
];

/** Rounding on an outline: closer than this, inside and outside are not compared. */
const ON_OUTLINE = 1e-9;

describe.each(FIXTURES)('the stack hit index over $name', ({ cells, convex }) => {
  it('checks each cell once: convex ones take the fast test', () => {
    const index = new StackHitIndex(cells);
    const nonConvex = index.cells.filter((cell) => !cell.convex).length;
    if (convex) expect(nonConvex).toBe(0);
    else expect(nonConvex).toBeGreaterThan(cells.length / 4);
  });

  it.each([true, false])('finds the cell a brute force finds, first in order (grid: %s)', (grid) => {
    const index = new StackHitIndex(cells, { grid });
    let onOutline = 0;
    let hits = 0;
    for (const p of samplePoints(cells, 5000, 11)) {
      const expected = bruteForceCell(cells, p);
      const hit = index.stackAt(p);
      const actual = hit?.cell ?? -1;
      if (actual !== expected) {
        // Only where rounding on an outline decides.
        expect(onAnOutline(cells, [expected, actual], p, ON_OUTLINE), `at ${p.x}, ${p.y}`).toBe(true);
        onOutline += 1;
        continue;
      }
      if (hit) {
        hits += 1;
        // The scene's own stack, as given.
        expect(hit.faces).toBe(cells[hit.cell]!.faces_top_to_bottom);
      }
    }
    expect(hits).toBeGreaterThan(1000);
    expect(onOutline).toBe(0);
  });

  it('lists every cell round a point, in order, as a brute force does', () => {
    const index = new StackHitIndex(cells);
    for (const p of samplePoints(cells, 2000, 12)) {
      const expected = bruteForceCells(cells, p);
      const actual = index.cellsAt(p);
      if (actual.join() !== expected.join()) {
        expect(onAnOutline(cells, [...expected, ...actual], p, ON_OUTLINE), `at ${p.x}, ${p.y}`).toBe(true);
      }
    }
  });
});

/** Every corner of every cell, and the middle of every side: points on outlines, where cells meet. */
function outlinePoints(cells: readonly StackCell[]): Point[] {
  return cells.flatMap(({ polygon }) =>
    polygon.flatMap((a, k) => {
      const b = polygon[(k + 1) % polygon.length]!;
      return [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
    })
  );
}

describe('the grid', () => {
  it.each(FIXTURES)('answers as the linear scan does, on outlines and within epsilon too: $name', ({ cells }) => {
    const grid = new StackHitIndex(cells, { grid: true });
    const linear = new StackHitIndex(cells, { grid: false });
    const points = [...samplePoints(cells, 2000, 13), ...outlinePoints(cells)];
    for (const epsilon of [0, 1e-9, 1e-3]) {
      for (const p of points) {
        expect(grid.stackAt(p, epsilon)?.cell, `at ${p.x}, ${p.y} ± ${epsilon}`).toBe(linear.stackAt(p, epsilon)?.cell);
        expect(grid.cellsAt(p, epsilon)).toEqual(linear.cellsAt(p, epsilon));
      }
    }
  });

  it(`is built from ${GRID_MIN_CELLS} cells up, and its answers are the same either way`, () => {
    const few = convexPartition(5, 3);
    expect(few.length).toBeLessThan(GRID_MIN_CELLS);
    const index = new StackHitIndex(few);
    for (const p of samplePoints(few, 200, 14)) expect(index.stackAt(p)?.cell ?? -1).toBe(bruteForceCell(few, p));
  });
});

describe('where cells meet, and off the paper', () => {
  const left: StackCell = {
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ],
    faces_top_to_bottom: [3, 1],
  };
  const right: StackCell = {
    polygon: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
    ],
    faces_top_to_bottom: [2],
  };

  it('gives a shared edge to the first cell in the scene’s order, and lists both there', () => {
    const index = new StackHitIndex([left, right]);
    expect(index.stackAt({ x: 1, y: 0.5 })).toEqual({ cell: 0, faces: [3, 1] });
    expect(new StackHitIndex([right, left]).stackAt({ x: 1, y: 0.5 })?.cell).toBe(0);
    expect(index.cellsAt({ x: 1, y: 0.5 })).toEqual([0, 1]);
    expect(index.cellsAt({ x: 1.5, y: 0.5 })).toEqual([1]);
  });

  it('answers null off the paper, and takes a point within epsilon of it', () => {
    const index = new StackHitIndex([left, right]);
    expect(index.stackAt({ x: 2.1, y: 0.5 })).toBeNull();
    expect(index.stackAt({ x: 2.1, y: 0.5 }, 0.2)?.cell).toBe(1);
    expect(index.cellsAt({ x: 2.1, y: 0.5 })).toEqual([]);
    expect(new StackHitIndex([]).stackAt({ x: 0, y: 0 })).toBeNull();
  });

  it('finds all of a non-convex cell, unless told every cell is convex', () => {
    const ell: StackCell = {
      polygon: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 0, y: 1 },
      ],
      faces_top_to_bottom: [0],
    };
    const index = new StackHitIndex([ell]);
    expect(index.cells[0]!.convex).toBe(false);
    expect(index.stackAt({ x: 0.75, y: 0.75 })).toBeNull();
    expect(index.stackAt({ x: 0.75, y: 0.25 })?.cell).toBe(0);
    expect(index.stackAt({ x: 0.25, y: 0.75 })?.cell).toBe(0);
    // The caller's word is taken, as Fold's is (its cells are convex by
    // construction): the convex test loses the arm past the reflex corner.
    expect(new StackHitIndex([ell], { convex: true }).stackAt({ x: 0.25, y: 0.75 })).toBeNull();
  });
});

describe('query time (reported, not asserted)', () => {
  it('stays small on thousands of cells', () => {
    const rows: string[] = [];
    for (const [name, cells] of [
      ['a square cut by 90 lines', convexPartition(6, 90)],
      ['a 40 × 40 tromino tiling', trominoPartition(7, 40)],
      ['2,000 stars', scatteredStars(8, 2000)],
    ] as const) {
      const points = samplePoints(cells, 10000, 15);
      for (const grid of [true, false]) {
        const { p50, p99, max } = queryTimes(new StackHitIndex(cells, { grid }), points);
        rows.push(
          `${name} (${cells.length} cells), ${grid ? 'grid' : 'linear'}: p50 ${p50.toFixed(1)} µs, p99 ${p99.toFixed(1)} µs, max ${max.toFixed(1)} µs`
        );
      }
    }
    console.info(`stackAt over 10,000 random points:\n${rows.join('\n')}`);
    expect(rows).toHaveLength(6);
  });
});
