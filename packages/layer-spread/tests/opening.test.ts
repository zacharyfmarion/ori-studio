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
    // The big face rises 0.1 along x; the sliver, 0.2% of the paper, rises 10.
    const heights = [0, 0.1, 0, 0, 0.02, 0];
    expect(spreadOpening(input, heights)).toMatchObject({ opening: 0, steep: expect.closeTo(0.1, 12) });
  });

  it('reads the slope only the steepest 1% of the paper passes: its 99th percentile by area', () => {
    // Side by side, a face of area `gentle` rising 0.1 along x and one of area `steep` rising 1.
    const two = (gentle: number, steep: number) => {
      const input: SpreadInput = {
        xy: [[0, 0], [2 * gentle, 0], [0, 1], [3, 0], [3 + 2 * steep, 0], [3, 1]],
        faces: [[0, 1, 2], [3, 4, 5]],
        triangles: [[0, 1, 2], [3, 4, 5]],
        triangleFaces: [0, 1],
        orders: [],
        cells: [],
      };
      return spreadOpening(input, [0, 0.2 * gentle, 0, 0, 2 * steep, 0]).steep;
    };
    // 2% of the paper steep is more than the steepest 1%, so it sets the slope; 0.5% is not.
    // With the sliver above, this holds the percentile between 98% and 99.5%: version 2 depends on it.
    expect(two(0.98, 0.02)).toBeCloseTo(1, 12);
    expect(two(0.995, 0.005)).toBeCloseTo(0.1, 12);
  });

  it('reads each cell from the triangle of a bent face that holds its centroid', () => {
    // Face 1 bends along its diagonal: its corner (1, 0) is lifted and (1, 1)
    // is not, so its lower-right triangle rises (s, −s) and its upper-left one
    // lies flat, against a flat face 0.
    const s = 0.1;
    const opening = (point: Point) => {
      const { input, heights } = hinged([0, s], [{ faces: [1, 0], point, area: 1 }]);
      heights[5] = 0;
      return spreadOpening(input, heights).opening;
    };
    expect(opening([0.75, 0.25])).toBeCloseTo(s * Math.SQRT2, 12);
    expect(opening([0.25, 0.75])).toBe(0);
    // Just past the top edge: nearest the upper-left triangle, not the face's first.
    expect(opening([0.5, 1.01])).toBe(0);
  });

  it('reads how high the paper rises against the flat paper’s diagonal, whichever way', () => {
    const cells = [{ faces: [1, 0], point: [0.5, 0.5] as Point, area: 1 }];
    const { input, heights } = hinged([-0.3, 0.1], cells);
    // The box is the unit square: the highest point, 0.3 below, over √2.
    expect(spreadOpening(input, heights).reach).toBeCloseTo(0.3 / Math.SQRT2, 12);
  });

  it('reads a flat solve as opening nothing', () => {
    const { input } = hinged([0, 0], [{ faces: [1, 0], point: [0.5, 0.5], area: 1 }]);
    expect(spreadOpening(input, input.xy.map(() => 0))).toEqual({ opening: 0, steep: 0, reach: 0 });
  });
});
