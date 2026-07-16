import { describe, expect, it } from 'vitest';
import {
  circleRingIntersectsAabb,
  distanceToSegment,
  LineHitIndex,
  segmentIntersectsAabb,
} from './lineHitIndex';

describe('segmentIntersectsAabb', () => {
  const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
  it('is true when an endpoint is inside', () => {
    expect(segmentIntersectsAabb({ x: 5, y: 5 }, { x: 50, y: 50 }, box)).toBe(true);
  });
  it('is true when the segment crosses with both endpoints outside', () => {
    expect(segmentIntersectsAabb({ x: -5, y: 5 }, { x: 15, y: 5 }, box)).toBe(true);
  });
  it('is false when the segment misses the box entirely', () => {
    expect(segmentIntersectsAabb({ x: -5, y: -5 }, { x: -1, y: 20 }, box)).toBe(false);
  });
  it('is true when it clips a corner', () => {
    expect(segmentIntersectsAabb({ x: -1, y: 2 }, { x: 2, y: -1 }, box)).toBe(true);
  });
});

describe('circleRingIntersectsAabb', () => {
  // Circle centred at (0,0) radius 10.
  it('is true when the box straddles the ring (touches the edge)', () => {
    expect(circleRingIntersectsAabb(0, 0, 10, { minX: 8, minY: -2, maxX: 12, maxY: 2 })).toBe(true);
  });
  it('is true when the box encloses the whole ring', () => {
    expect(
      circleRingIntersectsAabb(0, 0, 10, { minX: -20, minY: -20, maxX: 20, maxY: 20 })
    ).toBe(true);
  });
  it('is false when the box sits wholly inside the ring', () => {
    expect(circleRingIntersectsAabb(0, 0, 10, { minX: -2, minY: -2, maxX: 2, maxY: 2 })).toBe(false);
  });
  it('is false when the box is entirely outside the ring', () => {
    expect(circleRingIntersectsAabb(0, 0, 10, { minX: 50, minY: 50, maxX: 60, maxY: 60 })).toBe(
      false
    );
  });
});

describe('distanceToSegment', () => {
  it('measures perpendicular distance within the segment', () => {
    expect(distanceToSegment(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(3);
  });
  it('clamps to endpoints beyond the segment', () => {
    expect(distanceToSegment(-4, 0, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(4);
  });
});

describe('LineHitIndex', () => {
  const segments = [
    { id: 1, a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }, // long horizontal
    { id: 2, a: { x: 50, y: 20 }, b: { x: 50, y: 80 } }, // vertical
    { id: 3, a: { x: 200, y: 200 }, b: { x: 210, y: 210 } }, // far away
  ];
  const index = new LineHitIndex(segments);

  it('finds a long segment far from its midpoint (bbox binning)', () => {
    // near the far end of segment 1, nowhere near its midpoint
    expect(index.query(98, 1, 3)).toBe(1);
  });

  it('finds the nearest of overlapping candidates', () => {
    expect(index.query(50, 21, 5)).toBe(2);
  });

  it('returns -1 when nothing is within tolerance', () => {
    expect(index.query(150, 150, 3)).toBe(-1);
  });

  it('handles an empty index', () => {
    expect(new LineHitIndex([]).query(0, 0, 5)).toBe(-1);
  });

  it('handles a point cloud (zero-length segments) without exploding', () => {
    // Points indexed as zero-length segments give meanLen 0; a naive cellSize
    // collapses to ~1e-6 and query's reach blows up. This must stay fast.
    const points = [
      { id: 1, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { id: 2, a: { x: 100, y: 0 }, b: { x: 100, y: 0 } },
      { id: 3, a: { x: 50, y: 50 }, b: { x: 50, y: 50 } },
    ];
    const index = new LineHitIndex(points);
    const start = performance.now();
    expect(index.query(100.5, 0.5, 3)).toBe(2);
    expect(index.query(50, 51, 3)).toBe(3);
    expect(index.query(200, 200, 3)).toBe(-1);
    expect(performance.now() - start).toBeLessThan(50);
  });

  it('finds the nearest coincident-point when tolerance dwarfs spacing', () => {
    const points = [
      { id: 1, a: { x: 0, y: 0 }, b: { x: 0, y: 0 } },
      { id: 2, a: { x: 1, y: 0 }, b: { x: 1, y: 0 } },
    ];
    const index = new LineHitIndex(points);
    // Huge tolerance would explode the grid neighbourhood → linear fallback.
    expect(index.query(0.9, 0, 1e9)).toBe(2);
  });
});
