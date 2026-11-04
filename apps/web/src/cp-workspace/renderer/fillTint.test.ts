import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { StackHitIndex, type StackCell } from '../picking/stackHitIndex';
import { cellsFill, cellsHoldingFill, joinFills, ringsFill, TINT } from './fillTint';
import type { FillGeometry, Rgba } from './types';

const ring = (...corners: [number, number][]): Point[] => corners.map(([x, y]) => ({ x, y }));
const square = ring([0, 0], [1, 0], [1, 1], [0, 1]);
const ell = ring([0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]);
const accent: Rgba = [0.2, 0.4, 1, 0.8];

/** The fill's triangles, three corners each. */
function trianglesOf(fill: FillGeometry): Point[][] {
  const corners = Array.from({ length: fill.count }, (_, k) => ({ x: fill.position[k * 2]!, y: fill.position[k * 2 + 1]! }));
  return Array.from({ length: fill.count / 3 }, (_, k) => corners.slice(k * 3, k * 3 + 3));
}

function area([a, b, c]: Point[]): number {
  return Math.abs((b!.x - a!.x) * (c!.y - a!.y) - (c!.x - a!.x) * (b!.y - a!.y)) / 2;
}

/** Whether `p` lies strictly inside a triangle. */
function within([a, b, c]: Point[], p: Point): boolean {
  const side = (u: Point, v: Point) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const s = [side(a!, b!), side(b!, c!), side(c!, a!)];
  return s.every((value) => value > 0) || s.every((value) => value < 0);
}

describe('the tint ladder', () => {
  it('is Fold’s alphas, named', () => {
    expect(TINT).toEqual({ faint: 0.16, hover: 0.26, moving: 0.3, picked: 0.42, emphasis: 0.5 });
  });
});

describe('ringsFill', () => {
  it('fans a convex ring from its first corner, its colour the ink’s at a share of its alpha', () => {
    const fill = ringsFill([square], accent, TINT.picked)!;
    expect(fill.count).toBe(6);
    expect(Array.from(fill.position)).toEqual([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    const color = Array.from(fill.color.slice(0, 4));
    expect(color.slice(0, 3)).toEqual(Array.from(new Float32Array([0.2, 0.4, 1])));
    expect(color[3]).toBeCloseTo(0.8 * 0.42, 6);
    expect(new Set(Array.from(fill.color)).size).toBe(4);
  });

  it('cuts a non-convex ring into triangles that cover it and nothing past it', () => {
    const fill = ringsFill([ell], accent, TINT.hover)!;
    const triangles = trianglesOf(fill);
    expect(triangles).toHaveLength(4);
    expect(triangles.reduce((sum, triangle) => sum + area(triangle), 0)).toBeCloseTo(0.75, 6);
    expect(triangles.some((triangle) => within(triangle, { x: 0.75, y: 0.75 }))).toBe(false);
  });

  it('draws rings in the order given, and nothing for none or for a ring with no area', () => {
    const fill = ringsFill([square, ring([2, 0], [3, 0], [2, 1])], accent, TINT.faint)!;
    expect(fill.count).toBe(9);
    expect(Array.from(fill.position.slice(12))).toEqual([2, 0, 3, 0, 2, 1]);
    expect(ringsFill([], accent, TINT.faint)).toBeNull();
    expect(ringsFill([ring([0, 0], [1, 1])], accent, TINT.faint)).toBeNull();
  });
});

describe('cell fills', () => {
  const cells: StackCell[] = [
    { polygon: square, faces_top_to_bottom: [4, 2] },
    { polygon: ell.map(({ x, y }) => ({ x: x + 1, y })), faces_top_to_bottom: [2] },
    { polygon: square.map(({ x, y }) => ({ x: x + 3, y })), faces_top_to_bottom: [7] },
  ];
  const index = new StackHitIndex(cells);

  it('lights cells by their index, a non-convex one cut to its outline', () => {
    const fill = cellsFill(index, [1, 2], accent, TINT.picked)!;
    const triangles = trianglesOf(fill);
    expect(triangles).toHaveLength(6);
    expect(triangles.slice(0, 4).reduce((sum, triangle) => sum + area(triangle), 0)).toBeCloseTo(0.75, 6);
    expect(triangles.slice(4).every((triangle) => triangle.every(({ x }) => x >= 3))).toBe(true);
    expect(cellsFill(index, [], accent, TINT.picked)).toBeNull();
    expect(cellsFill(index, [9], accent, TINT.picked)).toBeNull();
  });

  it('lights every cell whose stack holds a face, whole, under other layers too', () => {
    const fill = cellsHoldingFill(index, new Set([2]), accent, TINT.faint)!;
    // The square (2 under 4) and the L.
    expect(fill.count).toBe(6 + 12);
    expect(Array.from(fill.position.slice(0, 12))).toEqual([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
    expect(cellsHoldingFill(index, new Set([5]), accent, TINT.faint)).toBeNull();
    // A cell's triangles are worked out once, and come back the same.
    expect(Array.from(cellsHoldingFill(index, new Set([2]), accent, TINT.faint)!.position)).toEqual(Array.from(fill.position));
  });
});

describe('joinFills', () => {
  it('draws the second over the first, and hands back the one there is', () => {
    const a = ringsFill([square], accent, TINT.faint)!;
    const b = ringsFill([ell], accent, TINT.picked)!;
    const both = joinFills(a, b)!;
    expect(both.count).toBe(a.count + b.count);
    expect(Array.from(both.position)).toEqual([...Array.from(a.position), ...Array.from(b.position)]);
    expect(Array.from(both.color)).toEqual([...Array.from(a.color), ...Array.from(b.color)]);
    expect(joinFills(a, null)).toBe(a);
    expect(joinFills(null, b)).toBe(b);
    expect(joinFills(null, null)).toBeNull();
  });
});
