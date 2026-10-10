import { describe, expect, it } from 'vitest';
import type {
  OristudioCpFoldedPaperFace,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import {
  clipToRegions,
  contains,
  foldedFlatAuxCoverage,
  foldedFlatAuxSegments,
} from './foldedFlatAux';

const point = (x: number, y: number): Point => ({ x, y });

function rectangle(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
}

/** A face whose corners are sheet vertices `first`, `first + 1`, …. */
function face(outline: Point[], first: number): OristudioCpFoldedPaperFace {
  return {
    outline,
    points: outline.map((_, i) => first + i),
    front_up: true,
    edges: outline.map((from, i) => ({
      from,
      to: outline[(i + 1) % outline.length]!,
      kind: 'border',
    })),
  };
}

/**
 * Two flaps side by side, B over A where they overlap: A spans x 0..60 and B
 * x 40..100, both y 0..40, in a sheet of 100. Three subfaces: A alone, the
 * overlap with B on top, B alone.
 */
const A = 0;
const B = 1;
function twoFlaps(aux: OristudioCpFoldedPaperScene['aux_lines']): OristudioCpFoldedPaperScene {
  return {
    schema_version: 2,
    sheet_points: [],
    flipped: false,
    sheet: 100,
    faces: [face(rectangle(0, 0, 60, 40), 0), face(rectangle(40, 0, 100, 40), 4)],
    subfaces: [
      { polygon: rectangle(0, 0, 40, 40), faces_top_to_bottom: [A] },
      { polygon: rectangle(40, 0, 60, 40), faces_top_to_bottom: [B, A] },
      { polygon: rectangle(60, 0, 100, 40), faces_top_to_bottom: [B] },
    ],
    aux_lines: aux,
  };
}

const flat = (segments: { a: Point; b: Point }[]) =>
  segments.map(({ a, b }) => [a.x, a.y, b.x, b.y].map((v) => Number(v.toFixed(6))));

describe('foldedFlatAuxSegments', () => {
  it('draws an aux line only where its face is on top', () => {
    // A's line runs under B from x 40; B's crosses the seam between its two
    // subfaces at x 60 and is one piece regardless.
    const scene = twoFlaps([
      { from: point(0, 20), to: point(60, 20), face: A },
      { from: point(40, 20), to: point(100, 20), face: B },
    ]);
    expect(flat(foldedFlatAuxSegments(scene, 0))).toEqual([
      [0, 20, 40, 20],
      [40, 20, 100, 20],
    ]);
  });

  it('erodes an end on the face outline by the fraction of the sheet, before clipping', () => {
    // Both ends of A's line are on A's outline: each retreats by 0.1 × 100.
    // The clip at x 40 is where A goes under B and is not an outline; it
    // does not retreat.
    const scene = twoFlaps([{ from: point(0, 20), to: point(60, 20), face: A }]);
    expect(flat(foldedFlatAuxSegments(scene, 0.1))).toEqual([[10, 20, 40, 20]]);
  });

  it('leaves an interior end where it is', () => {
    const scene = twoFlaps([{ from: point(0, 20), to: point(30, 20), face: A }]);
    expect(flat(foldedFlatAuxSegments(scene, 0.1))).toEqual([[10, 20, 30, 20]]);
  });

  it('drops a line the pull would invert', () => {
    // 60 long, both ends retreat 35: past the midpoint.
    const scene = twoFlaps([{ from: point(0, 20), to: point(60, 20), face: A }]);
    expect(foldedFlatAuxSegments(scene, 0.35)).toEqual([]);
  });

  it('drops a line whose face shows nowhere', () => {
    const scene = twoFlaps([{ from: point(45, 10), to: point(55, 30), face: A }]);
    expect(foldedFlatAuxSegments(scene, 0)).toEqual([]);
  });

  it('draws every eroded piece whole where the drawer shows every layer', () => {
    // Under Transparent3 or Wire2 the canvas shows A through B, so A's line
    // is drawn under B too — eroded on A's outline as before, and cut nowhere.
    const scene = twoFlaps([
      { from: point(0, 20), to: point(60, 20), face: A },
      { from: point(45, 10), to: point(55, 30), face: A },
    ]);
    expect(flat(foldedFlatAuxSegments(scene, 0.1, 'every-layer'))).toEqual([
      [10, 20, 50, 20],
      [45, 10, 55, 30],
    ]);
    expect(foldedFlatAuxCoverage('Paper5')).toBe('top-face');
    expect(foldedFlatAuxCoverage('Transparent3')).toBe('every-layer');
    expect(foldedFlatAuxCoverage('Wire2')).toBe('every-layer');
  });

  it('is empty for a figure with no aux lines', () => {
    expect(foldedFlatAuxSegments(twoFlaps([]), 0.1)).toEqual([]);
  });
});

describe('clipToRegions', () => {
  const square = rectangle(0, 0, 10, 10);

  it('keeps the part inside and cuts at the boundary', () => {
    expect(flat(clipToRegions(point(-5, 5), point(5, 5), [square], 1e-6))).toEqual([
      [0, 5, 5, 5],
    ]);
  });

  it('cuts a segment that crosses out and back in into two pieces', () => {
    const left = rectangle(0, 0, 4, 10);
    const right = rectangle(6, 0, 10, 10);
    expect(flat(clipToRegions(point(0, 5), point(10, 5), [left, right], 1e-6))).toEqual([
      [0, 5, 4, 5],
      [6, 5, 10, 5],
    ]);
  });

  it('joins pieces across a shared edge into one', () => {
    const left = rectangle(0, 0, 5, 10);
    const right = rectangle(5, 0, 10, 10);
    expect(flat(clipToRegions(point(0, 5), point(10, 5), [left, right], 1e-6))).toEqual([
      [0, 5, 10, 5],
    ]);
  });

  it('keeps a segment lying along a region edge', () => {
    expect(flat(clipToRegions(point(2, 0), point(8, 0), [square], 1e-6))).toEqual([[2, 0, 8, 0]]);
  });

  it('clips inside a non-convex region', () => {
    // An L: the notch at x 5..10, y 5..10 is outside.
    const ell = [
      point(0, 0),
      point(10, 0),
      point(10, 5),
      point(5, 5),
      point(5, 10),
      point(0, 10),
    ];
    expect(flat(clipToRegions(point(0, 7), point(10, 7), [ell], 1e-6))).toEqual([[0, 7, 5, 7]]);
  });

  it('is empty with no regions or a degenerate segment', () => {
    expect(clipToRegions(point(0, 0), point(10, 0), [], 1e-6)).toEqual([]);
    expect(clipToRegions(point(1, 1), point(1, 1), [square], 1e-6)).toEqual([]);
  });
});

describe('contains', () => {
  const square = rectangle(0, 0, 10, 10);
  it('answers inside, outside and on the boundary', () => {
    expect(contains(square, point(5, 5), 1e-6)).toBe(true);
    expect(contains(square, point(15, 5), 1e-6)).toBe(false);
    expect(contains(square, point(10, 5), 1e-6)).toBe(true);
    expect(contains(square, point(10.000001, 5), 1e-3)).toBe(true);
  });
});
