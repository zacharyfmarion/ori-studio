import { describe, expect, it } from 'vitest';
import {
  contactCentroid,
  contactSpread,
  IDENTITY_PINCH,
  pinchTransform,
  type GesturePoint,
} from './pinchTransform';

const at = (x: number, y: number): GesturePoint => ({ x, y });

describe('contactCentroid', () => {
  it('is null for an empty set', () => {
    expect(contactCentroid([])).toBeNull();
  });

  it('is the point itself for one contact', () => {
    expect(contactCentroid([at(12, -4)])).toEqual({ x: 12, y: -4 });
  });

  it('is the midpoint for two contacts', () => {
    expect(contactCentroid([at(0, 0), at(100, 40)])).toEqual({ x: 50, y: 20 });
  });

  it('averages three contacts', () => {
    expect(contactCentroid([at(0, 0), at(30, 0), at(0, 30)])).toEqual({ x: 10, y: 10 });
  });
});

describe('contactSpread', () => {
  it('is zero for a single contact', () => {
    expect(contactSpread([at(5, 5)], at(5, 5))).toBe(0);
  });

  // Half the gap, so a ratio of spreads is a ratio of finger gaps — which is
  // what makes `scale` the literal pinch ratio with no constant in between.
  it('is half the gap for two contacts', () => {
    expect(contactSpread([at(0, 0), at(80, 0)], at(40, 0))).toBe(40);
  });
});

describe('pinchTransform', () => {
  it('is the identity for an empty set', () => {
    expect(pinchTransform([], [])).toEqual(IDENTITY_PINCH);
  });

  it('is the identity when the sets differ in size', () => {
    expect(pinchTransform([at(0, 0)], [at(0, 0), at(10, 10)])).toEqual(IDENTITY_PINCH);
  });

  it('reports pure translation when both fingers move together', () => {
    const prev = [at(100, 100), at(200, 100)];
    const next = [at(130, 90), at(230, 90)];
    expect(pinchTransform(prev, next)).toEqual({ dx: 30, dy: -10, scale: 1 });
  });

  it('reports the literal spread ratio when the fingers separate', () => {
    // 100px apart -> 200px apart, centred on the same point: exactly 2x.
    const prev = [at(100, 0), at(200, 0)];
    const next = [at(50, 0), at(250, 0)];
    const transform = pinchTransform(prev, next);
    expect(transform.scale).toBeCloseTo(2, 10);
    expect(transform.dx).toBeCloseTo(0, 10);
    expect(transform.dy).toBeCloseTo(0, 10);
  });

  it('reports a ratio below one when the fingers close', () => {
    const transform = pinchTransform([at(0, 0), at(200, 0)], [at(50, 0), at(150, 0)]);
    expect(transform.scale).toBeCloseTo(0.5, 10);
  });

  it('separates translation from scale when the fingers do both', () => {
    const transform = pinchTransform([at(0, 0), at(100, 0)], [at(60, 20), at(260, 20)]);
    expect(transform.scale).toBeCloseTo(2, 10);
    expect(transform.dx).toBeCloseTo(110, 10);
    expect(transform.dy).toBeCloseTo(20, 10);
  });

  it('treats a single contact as a pan', () => {
    // The "one finger of a pinch lifted" case: zero spread, so no zoom, and the
    // camera keeps following the finger that is still down.
    expect(pinchTransform([at(10, 10)], [at(40, 25)])).toEqual({ dx: 30, dy: 15, scale: 1 });
  });

  it('refuses a ratio between coincident contacts', () => {
    // Synthetic input can put two ids on one pixel; a ratio taken there is noise.
    const transform = pinchTransform([at(0, 0), at(1, 0)], [at(0, 0), at(400, 0)]);
    expect(transform.scale).toBe(1);
  });

  it('generalises to three contacts through the mean radius', () => {
    const prev = [at(-10, 0), at(10, 0), at(0, 0)];
    const next = [at(-20, 0), at(20, 0), at(0, 0)];
    expect(pinchTransform(prev, next).scale).toBeCloseTo(2, 10);
  });

  // Documents the v1 decision recorded on `pinchTransform`: the twist is right
  // there in the contact set and is deliberately not consumed, because a CP
  // knocked a few degrees off square is worse than one that never turns.
  it('ignores a pure twist', () => {
    const prev = [at(-50, 0), at(50, 0)];
    const next = [at(0, -50), at(0, 50)];
    const transform = pinchTransform(prev, next);
    expect(transform.dx).toBeCloseTo(0, 10);
    expect(transform.dy).toBeCloseTo(0, 10);
    expect(transform.scale).toBeCloseTo(1, 10);
  });

  // The property the canvas relies on to keep the anchored zoom honest: applying
  // a sample's scale about the previous centroid, then its translation, lands the
  // anchored point back under the new centroid. Checked here in the abstract, so
  // the canvas only has to get the order right.
  it('composes so that the previous centroid maps onto the next one', () => {
    const prev = [at(120, 80), at(220, 140)];
    const next = [at(90, 100), at(290, 220)];
    const { dx, dy, scale } = pinchTransform(prev, next);
    const from = contactCentroid(prev)!;
    const to = contactCentroid(next)!;
    // A zoom anchored at `from` leaves `from` fixed; the pan then carries it.
    expect(from.x + dx).toBeCloseTo(to.x, 10);
    expect(from.y + dy).toBeCloseTo(to.y, 10);
    // And the spread really did grow by `scale`.
    expect(contactSpread(next, to)).toBeCloseTo(contactSpread(prev, from) * scale, 10);
  });
});
