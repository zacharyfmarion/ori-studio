import { describe, expect, it } from 'vitest';
import type { PicturePoint } from './annotationModel';
import { facesAt, facesOver, hiddenArcs, hiddenStretches, shareUnder } from './behindFlaps';
import type { PictureCover, PictureLayers } from './pictureGeometry';

/** A face, painted `order`th, its box from its ring. */
function face(ring: PicturePoint[], order: number): PictureCover {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return { ring, order, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}

const square = (x0: number, y0: number, x1: number, y1: number, order: number) =>
  face(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    order
  );

/**
 * The base (0), a flap folded over it (1), a smaller flap over that and past
 * it (2), and a face apart from both (3): painted back to front.
 */
const BASE = square(0, 0, 1, 1, 0);
const FLAP = square(0.2, 0.2, 0.6, 0.6, 1);
const OVER = square(0.5, 0.3, 0.8, 0.5, 2);
const APART = square(0.7, 0.7, 0.9, 0.9, 3);
const layers = (...covers: PictureCover[]): PictureLayers => ({ orders: [], covers });
const LAYERS = layers(BASE, FLAP, OVER, APART);

describe('the faces at a point', () => {
  it('are the faces it is inside, the top first; on a rim, not that face, unless rims count', () => {
    expect(facesAt(LAYERS, [0.3, 0.3])).toEqual([FLAP, BASE]);
    expect(facesAt(LAYERS, [0.55, 0.4])).toEqual([OVER, FLAP, BASE]);
    expect(facesAt(LAYERS, [0.2, 0.3])).toEqual([BASE]);
    expect(facesAt(LAYERS, [0.2, 0.3], true)).toEqual([FLAP, BASE]);
    expect(facesAt(LAYERS, [1.5, 0.5])).toEqual([]);
  });
});

describe('the faces over a face', () => {
  it('are those painted after it and overlapping it, and those over them in turn', () => {
    expect(facesOver(LAYERS, [FLAP])).toEqual([FLAP, OVER]);
    // Over the smaller flap but not the first: over it all the same.
    const top = square(0.7, 0.35, 0.95, 0.45, 4);
    expect(facesOver(layers(BASE, FLAP, OVER, APART, top), [FLAP])).toEqual([FLAP, OVER, top]);
    // The base: everything painted after it lies on it.
    expect(new Set(facesOver(LAYERS, [BASE]))).toEqual(new Set([BASE, FLAP, OVER, APART]));
  });

  it('count a face laid exactly on another, or along a shared side and past it, and never one beside it', () => {
    const stacked = square(0.2, 0.2, 0.6, 0.6, 5);
    expect(facesOver(layers(FLAP, stacked), [FLAP])).toEqual([FLAP, stacked]);
    // Along the same two lines, half over it: no side crosses another, no corner is inside.
    const left = square(0, 0, 2, 2, 0);
    const right = square(1, 0, 3, 2, 1);
    expect(facesOver(layers(left, right), [left])).toEqual([left, right]);
    // Beside it, sharing a side: not over it.
    const beside = square(0.6, 0.2, 1, 0.6, 6);
    expect(facesOver(layers(FLAP, beside), [FLAP])).toEqual([FLAP]);
  });
});

describe('a mark behind a flap', () => {
  const line: PicturePoint[] = [
    [0.3, 0.4],
    [0.95, 0.4],
  ];

  it('is dotted from its end until it comes out from under the flap and every face over it', () => {
    // Under the flap to x 0.6, under the face over it on to 0.8.
    const [[start, end]] = hiddenStretches(line, { from: 1 }, LAYERS) as [readonly [number, number]];
    expect(start).toBe(0);
    expect(end).toBeCloseTo(0.5 / 0.65, 12);
    // Two layers down, under the base too: dotted to its end.
    expect(hiddenStretches(line, { from: 2 }, LAYERS)).toEqual([[0, 1]]);
  });

  it('stays solid once it is out, though it crosses the flap again in front', () => {
    const crimp: PicturePoint[] = [
      [0.3, 0.25],
      [0.9, 0.25],
      [0.9, 0.22],
      [0.3, 0.22],
    ];
    expect(shareUnder(crimp, facesOver(LAYERS, [FLAP]))).toBeCloseTo(0.3 / 1.23, 12);
  });

  it('is dotted from its tip back, from both ends as two stretches, and not at all from an end on no face', () => {
    const across: PicturePoint[] = [
      [0.3, 0.4],
      [0.9, 0.8],
    ];
    // Its tip on the rim of the face apart from the rest, read a hair inside:
    // dotted back to where it comes out, through that face's bottom side (y 0.7).
    const [[start, end]] = hiddenStretches(across, { to: 1 }, LAYERS) as [readonly [number, number]];
    expect(end).toBe(1);
    expect(start).toBeCloseTo((0.7 - 0.4) / 0.4, 12);
    expect(hiddenStretches(across, { from: 1, to: 1 }, LAYERS)).toHaveLength(2);
    expect(
      hiddenStretches(
        [
          [1.5, 0.4],
          [0.95, 0.4],
        ],
        { from: 1 },
        LAYERS
      )
    ).toEqual([]);
  });

  it('reads an end on a corner in the face the mark goes into', () => {
    // From the flap's corner, into it: under the flap.
    const into: PicturePoint[] = [
      [0.2, 0.2],
      [0.4, 0.4],
    ];
    expect(hiddenStretches(into, { from: 1 }, LAYERS)).toEqual([[0, 1]]);
    // From the same corner, away from it: under nothing but the base, which is the top there.
    const away: PicturePoint[] = [
      [0.2, 0.2],
      [0.1, 0.1],
    ];
    expect(hiddenStretches(away, { from: 1 }, LAYERS)).toEqual([[0, 1]]);
    expect(hiddenStretches(away, { from: 1 }, layers(FLAP))).toEqual([]);
  });
});

describe('a circle behind a flap', () => {
  it('is dotted along the arcs under the faces over its centre, its centre on a corner on each face that meets there', () => {
    // On the flap's corner: the quarter of its ring up and to the left, as the page turns clockwise from the right.
    const [[start, end]] = hiddenArcs([0.6, 0.6], 0.05, 1, LAYERS) as [readonly [number, number]];
    expect(start).toBeCloseTo(0.5, 2);
    expect(end).toBeCloseTo(0.75, 2);
    // On no face: nothing over it.
    expect(hiddenArcs([1.5, 0.5], 0.05, 1, LAYERS)).toEqual([]);
  });
});
