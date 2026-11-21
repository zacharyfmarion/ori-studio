import { describe, expect, it } from 'vitest';
import { spreadOpening } from '../src/opening.js';
import type { Point, SpreadInput } from '../src/types.js';

/**
 * Unit squares stacked over [0, 1]², hinged along x = 0: every face shares the
 * hinge's two vertices and has its own far side, at height `slopes[f]`, so
 * face f rises along x at that slope.
 */
function hinged(slopes: number[], cells: SpreadInput['cells']): { input: SpreadInput; heights: number[] } {
  const xy: Point[] = [[0, 0], [0, 1]];
  const heights = [0, 0];
  const faces: number[][] = [];
  const triangles: [number, number, number][] = [];
  const triangleFaces: number[] = [];
  slopes.forEach((slope, f) => {
    const c = xy.length;
    xy.push([1, 0], [1, 1]);
    heights.push(slope, slope);
    faces.push([0, c, c + 1, 1]);
    triangles.push([0, c, c + 1], [0, c + 1, 1]);
    triangleFaces.push(f, f);
  });
  return { input: { xy, faces, triangles, triangleFaces, orders: [], cells }, heights };
}

describe('spreadOpening', () => {
  it('reads a hinge opened both ways as the two slopes apart', () => {
    const { input, heights } = hinged([-0.1, 0.1], [{ faces: [1, 0], point: [0.5, 0.5], area: 1 }]);
    const { opening, steep } = spreadOpening(input, heights);
    expect(opening).toBeCloseTo(0.2, 12);
    expect(steep).toBeCloseTo(0.1, 12);
  });

  it('ignores tilt the whole stack shares: only layers parting count', () => {
    const { input, heights } = hinged([0.3, 0.3], [{ faces: [1, 0], point: [0.5, 0.5], area: 1 }]);
    const { opening, steep } = spreadOpening(input, heights);
    expect(opening).toBe(0);
    expect(steep).toBeCloseTo(0.3, 12);
  });

  it('weighs every neighbouring pair by its cell’s area, a deep cell once per pair', () => {
    const { input, heights } = hinged([0, 0.1, 0.3], [
      { faces: [2, 1, 0], point: [0.25, 0.5], area: 1 },
      { faces: [1, 0], point: [0.75, 0.5], area: 2 },
      // A single layer and an empty cell part from nothing.
      { faces: [0], point: [0.5, 0.25], area: 5 },
      { faces: [2, 0], point: [0.5, 0.75], area: 0 },
    ]);
    // Pairs: 2/1 parts 0.2 and 1/0 parts 0.1 at weight 1; 1/0 parts 0.1 at weight 2.
    expect(spreadOpening(input, heights).opening).toBeCloseTo((0.2 + 0.1 + 2 * 0.1) / 4, 12);
  });

  it('scales with the heights, so a gain on them is a gain on it', () => {
    const cells = [{ faces: [1, 0], point: [0.5, 0.5] as Point, area: 1 }];
    const { input, heights } = hinged([0.02, 0.07], cells);
    const once = spreadOpening(input, heights);
    const thrice = spreadOpening(input, heights.map((h) => 3 * h));
    expect(thrice.opening).toBeCloseTo(3 * once.opening, 12);
    expect(thrice.steep).toBeCloseTo(3 * once.steep, 12);
  });

  it('lets no sliver set how steep the paper is', () => {
    const input: SpreadInput = {
      xy: [[0, 0], [1, 0], [0, 1], [2, 0], [2.002, 0], [2, 1]],
      faces: [[0, 1, 2], [3, 4, 5]],
      triangles: [[0, 1, 2], [3, 4, 5]],
      triangleFaces: [0, 1],
      orders: [],
      cells: [],
    };
    // The big face rises 0.1 along x; the sliver, 0.1% of the paper, rises 10.
    const heights = [0, 0.1, 0, 0, 0.02, 0];
    expect(spreadOpening(input, heights)).toEqual({ opening: 0, steep: expect.closeTo(0.1, 12) });
  });

  it('reads a flat solve as opening nothing', () => {
    const { input } = hinged([0, 0], [{ faces: [1, 0], point: [0.5, 0.5], area: 1 }]);
    expect(spreadOpening(input, input.xy.map(() => 0))).toEqual({ opening: 0, steep: 0 });
  });
});
