import { describe, expect, it } from 'vitest';
import {
  circleRingIntersectsConvexQuad,
  pointInConvexQuad,
  segmentIntersectsConvexQuad,
  type ConvexQuad,
} from './convexQuad';

/** The axis-aligned box 0..10 as a quad, in both windings. */
const box: ConvexQuad = [
  { x: 0, y: 0 },
  { x: 0, y: 10 },
  { x: 10, y: 10 },
  { x: 10, y: 0 },
];
const boxReversed: ConvexQuad = [box[3], box[2], box[1], box[0]];

/** A diamond: the unit box turned 45 degrees about the origin, "radius" 10. */
const diamond: ConvexQuad = [
  { x: 0, y: -10 },
  { x: -10, y: 0 },
  { x: 0, y: 10 },
  { x: 10, y: 0 },
];

describe('pointInConvexQuad', () => {
  it('accepts inside and boundary, rejects outside', () => {
    expect(pointInConvexQuad({ x: 5, y: 5 }, box)).toBe(true);
    expect(pointInConvexQuad({ x: 0, y: 5 }, box)).toBe(true); // on an edge
    expect(pointInConvexQuad({ x: 11, y: 5 }, box)).toBe(false);
  });

  it('does not depend on winding', () => {
    // The corners come from a drag, which can go in any direction.
    expect(pointInConvexQuad({ x: 5, y: 5 }, boxReversed)).toBe(true);
    expect(pointInConvexQuad({ x: 11, y: 5 }, boxReversed)).toBe(false);
  });

  it('follows the rotated shape, not its bounding box', () => {
    expect(pointInConvexQuad({ x: 0, y: 0 }, diamond)).toBe(true);
    // Inside the diamond's AABB but outside the diamond itself.
    expect(pointInConvexQuad({ x: 9, y: 9 }, diamond)).toBe(false);
  });
});

describe('segmentIntersectsConvexQuad', () => {
  // These four mirror `segmentIntersectsAabb`'s cases exactly, so the
  // generalisation is provably a superset of what it replaced.
  it('is true when an endpoint is inside', () => {
    expect(segmentIntersectsConvexQuad({ x: 5, y: 5 }, { x: 50, y: 50 }, box)).toBe(true);
  });
  it('is true when the segment crosses with both endpoints outside', () => {
    expect(segmentIntersectsConvexQuad({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
  });
  it('is false when the segment misses entirely', () => {
    expect(segmentIntersectsConvexQuad({ x: -5, y: -5 }, { x: -1, y: 20 }, box)).toBe(false);
  });
  it('is true when it clips a corner', () => {
    expect(segmentIntersectsConvexQuad({ x: -1, y: 2 }, { x: 2, y: -1 }, box)).toBe(true);
  });

  it('does not depend on winding', () => {
    expect(segmentIntersectsConvexQuad({ x: -5, y: 5 }, { x: 15, y: 5 }, boxReversed)).toBe(true);
    expect(segmentIntersectsConvexQuad({ x: -5, y: -5 }, { x: -1, y: 20 }, boxReversed)).toBe(false);
  });

  it('rejects a segment the rotated box misses but its AABB would catch', () => {
    // The behaviour the whole change is for: near the diamond's corner, the
    // model-space bounding box says "hit" and the box the user actually drew
    // says "miss". A short segment tucked into the top-right of the AABB.
    const a = { x: 8, y: 8 };
    const b = { x: 9.5, y: 9.5 };
    expect(segmentIntersectsConvexQuad(a, b, diamond)).toBe(false);
    // ...while one through the middle still hits.
    expect(segmentIntersectsConvexQuad({ x: -5, y: 0 }, { x: 5, y: 0 }, diamond)).toBe(true);
  });

  it('handles a degenerate (flat) quad from a straight drag', () => {
    // A straight drag holds one screen axis exactly: the quad collapses to a
    // line, and a crease that crosses it must still be caught.
    const flat: ConvexQuad = [
      { x: 3, y: 1 },
      { x: 3, y: 9 },
      { x: 3, y: 9 },
      { x: 3, y: 1 },
    ];
    expect(segmentIntersectsConvexQuad({ x: 0, y: 5 }, { x: 6, y: 5 }, flat)).toBe(true);
    expect(segmentIntersectsConvexQuad({ x: 0, y: 50 }, { x: 6, y: 50 }, flat)).toBe(false);
  });

  it('treats a zero-length segment as a point test', () => {
    expect(segmentIntersectsConvexQuad({ x: 5, y: 5 }, { x: 5, y: 5 }, box)).toBe(true);
    expect(segmentIntersectsConvexQuad({ x: 50, y: 5 }, { x: 50, y: 5 }, box)).toBe(false);
  });
});

describe('circleRingIntersectsConvexQuad', () => {
  // Circle centred at (0,0) radius 10, mirroring `circleRingIntersectsAabb`.
  const quadOf = (minX: number, minY: number, maxX: number, maxY: number): ConvexQuad => [
    { x: minX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
    { x: maxX, y: minY },
  ];

  it('is true when the quad straddles the ring', () => {
    expect(circleRingIntersectsConvexQuad(0, 0, 10, quadOf(8, -2, 12, 2))).toBe(true);
  });
  it('is true when the quad encloses the whole ring', () => {
    expect(circleRingIntersectsConvexQuad(0, 0, 10, quadOf(-20, -20, 20, 20))).toBe(true);
  });
  it('is false when the quad sits wholly inside the ring', () => {
    expect(circleRingIntersectsConvexQuad(0, 0, 10, quadOf(-2, -2, 2, 2))).toBe(false);
  });
  it('is false when the quad is entirely outside the ring', () => {
    expect(circleRingIntersectsConvexQuad(0, 0, 10, quadOf(50, 50, 60, 60))).toBe(false);
  });

  it('follows a rotated quad rather than its bounding box', () => {
    // A small diamond sitting inside the ring touches nothing...
    const inner: ConvexQuad = [
      { x: 0, y: -3 },
      { x: -3, y: 0 },
      { x: 0, y: 3 },
      { x: 3, y: 0 },
    ];
    expect(circleRingIntersectsConvexQuad(0, 0, 10, inner)).toBe(false);
    // ...while one reaching past the ring crosses it.
    expect(circleRingIntersectsConvexQuad(0, 0, 10, diamond)).toBe(true);
  });
});
