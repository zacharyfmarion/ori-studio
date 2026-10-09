import { describe, expect, it } from 'vitest';
import type { PicturePoint } from './annotationModel';
import { facesOver, facesOverWithin } from './behindFlaps';
import { isConvexRing, OVER_MIN_WIDTH, overlapsWider, sharedPart, triangulate } from './faceOverlap';
import type { PictureCover } from './pictureGeometry';
import heart from './__fixtures__/heartFacePairs.json';

type Ring = PicturePoint[];

function cover(ring: Ring, order: number): PictureCover {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { ring, order, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

/**
 * Zach's heart, step 16 (index), refolded with no spread by 18.0's harness
 * (`artifacts/revision-3/18e/heartPair.mjs`): two faces meeting along a fold,
 * whose stored corners cross there by a hair, and the narrowest pair that
 * truly overlaps, each in picture units on the unspread picture, with their
 * levels.
 */
const falsePair = heart.falsePair as { faces: number[]; levels: number[]; rings: Ring[] };
const truePair = heart.truePair as { faces: number[]; levels: number[]; rings: Ring[] };
/** A pair as covers, the order each face's level reversed, as the x-ray reads them. */
const covers = ({ levels, rings }: { levels: number[]; rings: Ring[] }) => rings.map((ring, i) => cover(ring, -levels[i]!));

describe('what two faces share (Revision 3, 18.0 results, 2)', () => {
  it('takes the heart’s two faces that meet along a fold as overlapping by 15e’s test, but not by a shared part wider than the tolerance', () => {
    const [a, b] = covers(falsePair);
    const [low] = a!.order < b!.order ? [a!, b!] : [b!, a!];
    // 15e's own test: the lower face's "faces over it" take the other in.
    expect(facesOver({ orders: [], covers: [a!, b!] }, [low])).toHaveLength(2);
    // What they share is a sliver along the fold, a few millionths of the picture wide.
    expect(sharedPart(a!.ring, b!.ring).width).toBeLessThan(1e-5);
    expect(overlapsWider(a!, b!)).toBe(false);
    expect(facesOverWithin({ orders: [], covers: [a!, b!] }, [low])).toEqual([low]);
  });

  it('takes the heart’s narrowest true overlap as one, some hundreds of times the tolerance', () => {
    const [a, b] = covers(truePair);
    const [low, high] = a!.order < b!.order ? [a!, b!] : [b!, a!];
    expect(sharedPart(a!.ring, b!.ring).width).toBeGreaterThan(100 * OVER_MIN_WIDTH);
    expect(overlapsWider(a!, b!)).toBe(true);
    expect(facesOverWithin({ orders: [], covers: [a!, b!] }, [low])).toEqual([low, high]);
  });

  it('measures a convex overlap exactly: two unit squares a half apart share a half by one, its mean width two thirds', () => {
    const square = (x: number): Ring => [
      [x, 0],
      [x + 1, 0],
      [x + 1, 1],
      [x, 1],
    ];
    const { area, width } = sharedPart(square(0), square(0.5));
    expect(area).toBeCloseTo(0.5, 12);
    // Area over half its perimeter: 0.5 / 1.5.
    expect(width).toBeCloseTo(1 / 3, 12);
    // Side by side, they meet along a side and share nothing.
    expect(sharedPart(square(0), square(1))).toEqual({ area: 0, width: 0 });
  });

  it('cuts a face that is not convex into triangles, and finds what it shares by its pieces', () => {
    // An L: a 2 × 2 square less its top-right quarter, which a unit square there misses.
    const l: Ring = [
      [0, 0],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
    ];
    expect(isConvexRing(l)).toBe(false);
    const triangles = triangulate(l);
    expect(triangles).toHaveLength(4);
    const area = (ring: Ring) => Math.abs(ring.reduce((sum, [x, y], i) => sum + x * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * y, 0)) / 2;
    expect(triangles.reduce((sum, triangle) => sum + area(triangle), 0)).toBeCloseTo(3, 12);
    const corner: Ring = [
      [1.2, 1.2],
      [1.8, 1.2],
      [1.8, 1.8],
      [1.2, 1.8],
    ];
    expect(sharedPart(l, corner).area).toBe(0);
    const across: Ring = [
      [0.5, 0.5],
      [1.5, 0.5],
      [1.5, 1.5],
      [0.5, 1.5],
    ];
    // Three quarters of the unit square lie in the L, whichever is cut.
    expect(sharedPart(l, across).area).toBeCloseTo(0.75, 12);
    expect(sharedPart(across, l).area).toBeCloseTo(0.75, 12);
    expect(sharedPart(across, l).width).toBeGreaterThan(OVER_MIN_WIDTH);
  });
});
