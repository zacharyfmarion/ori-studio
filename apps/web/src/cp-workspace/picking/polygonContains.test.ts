import { describe, expect, it } from 'vitest';
import type { Point } from '../../lib/geometry';
import { insideConvex, insideEvenOdd, isConvexPolygon } from './polygonContains';

const ring = (...corners: [number, number][]): Point[] => corners.map(([x, y]) => ({ x, y }));

const square = ring([0, 0], [1, 0], [1, 1], [0, 1]);
/** An L: the unit square less its top-right quarter. */
const ell = ring([0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]);
/** A five-pointed star drawn as one stroke: every corner turns the same way, and it winds round twice. */
const pentagram = [0, 2, 4, 1, 3].map((k) => ({
  x: Math.cos((Math.PI / 2) + (k * 2 * Math.PI) / 5),
  y: Math.sin((Math.PI / 2) + (k * 2 * Math.PI) / 5),
}));

describe('insideConvex', () => {
  it('holds the inside and the outline, either winding', () => {
    expect(insideConvex(square, { x: 0.5, y: 0.5 })).toBe(true);
    expect(insideConvex([...square].reverse(), { x: 0.5, y: 0.5 })).toBe(true);
    expect(insideConvex(square, { x: 1, y: 0.5 })).toBe(true);
    expect(insideConvex(square, { x: 1.01, y: 0.5 })).toBe(false);
    expect(insideConvex(square, { x: 1.01, y: 0.5 }, 0.02)).toBe(true);
  });
});

describe('insideEvenOdd', () => {
  it('follows a reflex corner that the convex test cannot', () => {
    expect(insideEvenOdd(ell, { x: 0.75, y: 0.75 })).toBe(false);
    expect(insideEvenOdd(ell, { x: 0.75, y: 0.25 })).toBe(true);
    // The L's upper arm lies beyond the line of its reflex corner's lower side,
    // so the convex test, which wants every side's line, loses it.
    const arm = { x: 0.25, y: 0.75 };
    expect(insideEvenOdd(ell, arm)).toBe(true);
    expect(insideConvex(ell, arm)).toBe(false);
  });

  it('holds the outline, and what lies within epsilon of it', () => {
    expect(insideEvenOdd(ell, { x: 0.75, y: 0.5 })).toBe(true);
    expect(insideEvenOdd(ell, { x: 0.5, y: 0.75 })).toBe(true);
    expect(insideEvenOdd(ell, { x: 0.75, y: 0.51 })).toBe(false);
    expect(insideEvenOdd(ell, { x: 0.75, y: 0.51 }, 0.02)).toBe(true);
    expect(insideEvenOdd(square, { x: 0, y: 0 })).toBe(true);
  });

  it('agrees with the convex test inside and out on a convex ring', () => {
    for (let k = 0; k < 200; k += 1) {
      const p = { x: -0.5 + ((k * 37) % 200) / 100, y: -0.5 + ((k * 53) % 200) / 100 };
      expect(insideEvenOdd(square, p)).toBe(insideConvex(square, p));
    }
  });

  it('leaves out what a self-crossing ring winds round twice', () => {
    expect(insideEvenOdd(pentagram, { x: 0, y: 0 })).toBe(false);
    expect(insideEvenOdd(pentagram, { x: 0, y: 0.7 })).toBe(true);
  });
});

describe('isConvexPolygon', () => {
  it('takes convex rings, corners along a side and repeated corners included', () => {
    expect(isConvexPolygon(square)).toBe(true);
    expect(isConvexPolygon([...square].reverse())).toBe(true);
    expect(isConvexPolygon(ring([0, 0], [0.5, 0], [1, 0], [1, 1], [0, 1]))).toBe(true);
    expect(isConvexPolygon(ring([0, 0], [1, 0], [1, 0], [1, 1], [0, 1]))).toBe(true);
    expect(isConvexPolygon(ring([0, 0], [1, 0], [0.5, 1]))).toBe(true);
  });

  it('refuses a reflex corner, and a star that winds round twice', () => {
    expect(isConvexPolygon(ell)).toBe(false);
    expect(isConvexPolygon(pentagram)).toBe(false);
  });

  it('passes what has no area to test', () => {
    expect(isConvexPolygon(ring([0, 0], [1, 0]))).toBe(true);
    expect(isConvexPolygon(ring([0, 0], [1, 1], [2, 2]))).toBe(true);
  });

  it('reads a straight side with rounding noise in it as straight', () => {
    const noisy = ring([0, 0], [0.5, 1e-17], [1, 0], [1, 1], [1 + 1e-17, 1.5], [1, 2], [0, 2]);
    expect(isConvexPolygon(noisy)).toBe(true);
  });
});
