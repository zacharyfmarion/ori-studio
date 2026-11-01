import { describe, expect, it } from 'vitest';
import { convexHull, type Point } from '../../lib/geometry';
import { insideEvenOdd } from '../../cp-workspace/picking/polygonContains';
import { distanceToSegment } from '../../cp-workspace/picking/lineHitIndex';
import { insetRing, ringInsetPx } from './faceRing';

const SQUARE: Point[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

/** A seeded generator (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How far `p` lies inside `ring`: its distance to the nearest side, negative outside. */
function depthIn(ring: readonly Point[], p: Point): number {
  const nearest = Math.min(...ring.map((a, i) => distanceToSegment(p.x, p.y, a, ring[(i + 1) % ring.length]!)));
  return insideEvenOdd(ring, p) ? nearest : -nearest;
}

function signedArea(ring: readonly Point[]): number {
  return ring.reduce((sum, p, i) => {
    const q = ring[(i + 1) % ring.length]!;
    return sum + (p.x * q.y - q.x * p.y) / 2;
  }, 0);
}

describe('a face’s ring, inside it', () => {
  it('sits a pixel clear of the line along the face: half that line, half its stroke, a pixel in', () => {
    expect(ringInsetPx(2)).toBe(2);
    expect(ringInsetPx(1.5)).toBe(1.75);
    // A crease at line width 3, at the fit zoom: 1.5 × 3 = 4.5 px wide.
    expect(ringInsetPx(2, 4.5)).toBe(4.25);
  });

  it('moves every side of a square in by the inset', () => {
    const ring = insetRing(SQUARE, 2)!;
    expect(ring.map(({ x, y }) => [x, y])).toEqual([
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
    ]);
  });

  it('keeps the ring’s winding, either way round', () => {
    const backwards = [...SQUARE].reverse();
    const ring = insetRing(backwards, 1)!;
    expect(Math.sign(signedArea(ring))).toBe(Math.sign(signedArea(backwards)));
    expect(Math.abs(signedArea(ring))).toBeCloseTo(64);
  });

  it('drops corners along a side, as a folded outline names them', () => {
    const named = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 4 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(insetRing(named, 2)).toEqual(insetRing(SQUARE, 2));
  });

  it('is null when the face is too small to hold it', () => {
    expect(insetRing(SQUARE, 5)).toBeNull();
    expect(insetRing(SQUARE, 6)).toBeNull();
    const sliver = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 1 },
    ];
    expect(insetRing(sliver, 1)).toBeNull();
    expect(insetRing([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.1)).toBeNull();
    expect(insetRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }], 0.1)).toBeNull();
  });

  it('never leaves its face: every corner lies the inset inside every side', () => {
    const next = random(7);
    let rings = 0;
    for (let trial = 0; trial < 400; trial += 1) {
      const points = Array.from({ length: 3 + Math.floor(next() * 8) }, () => ({ x: next() * 100, y: next() * 60 }));
      const face = convexHull(points);
      if (face.length < 3) continue;
      const inset = next() * 12;
      const ring = insetRing(face, inset);
      if (!ring) continue;
      rings += 1;
      for (const corner of ring) expect(depthIn(face, corner)).toBeGreaterThanOrEqual(inset * (1 - 1e-6));
      expect(Math.abs(signedArea(ring))).toBeLessThan(Math.abs(signedArea(face)));
    }
    // Most of them hold a ring: the test says something.
    expect(rings).toBeGreaterThan(200);
  });

  it('insets a face with a reflex corner (the L a refusal names, D4)', () => {
    const l = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 50 },
      { x: 50, y: 50 },
      { x: 50, y: 100 },
      { x: 0, y: 100 },
    ];
    const ring = insetRing(l, 3)!;
    expect(ring).toHaveLength(6);
    for (const corner of ring) expect(depthIn(l, corner)).toBeGreaterThanOrEqual(3 * (1 - 1e-6));
    // The reflex corner moves away from the notch, along its diagonal.
    expect(ring[3]!.x).toBeCloseTo(47);
    expect(ring[3]!.y).toBeCloseTo(47);
    // Too thick for the arms: none.
    expect(insetRing(l, 26)).toBeNull();
  });
});
