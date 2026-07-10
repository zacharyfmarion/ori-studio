import { describe, expect, it } from 'vitest';
import { rotatePointsAround, translatePoints, unitLeafLocation } from './bpTreeAuthoring';
import type { Point } from './geometry';

const near = (a: Point, b: Point, eps = 1e-9) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

describe('unitLeafLocation', () => {
  it('places a leaf at unit length toward the target', () => {
    const loc = unitLeafLocation({ x: 10, y: 10 }, { x: 15, y: 10 });
    expect(near(loc, { x: 11, y: 10 })).toBe(true);
  });

  it('normalizes diagonal directions to unit length', () => {
    const loc = unitLeafLocation({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(near(loc, { x: 0.6, y: 0.8 })).toBe(true);
  });

  it('falls back to straight up when the target coincides with the parent', () => {
    const loc = unitLeafLocation({ x: 2, y: 2 }, { x: 2, y: 2 });
    expect(near(loc, { x: 2, y: 1 })).toBe(true);
  });

  it('honors a custom length', () => {
    const loc = unitLeafLocation({ x: 0, y: 0 }, { x: 1, y: 0 }, 3);
    expect(near(loc, { x: 3, y: 0 })).toBe(true);
  });
});

describe('rotatePointsAround', () => {
  it('rotates a single point 90 degrees around the pivot', () => {
    const pivot = { x: 0, y: 0 };
    const result = rotatePointsAround(pivot, { x: 1, y: 0 }, { x: 0, y: 1 }, [[1, { x: 1, y: 0 }]]);
    expect(near(result.get(1) as Point, { x: 0, y: 1 })).toBe(true);
  });

  it('preserves distance to the pivot for the whole subtree', () => {
    const pivot = { x: 5, y: 5 };
    const dragged: Point = { x: 6, y: 5 };
    const child: Point = { x: 7, y: 5 };
    const result = rotatePointsAround(pivot, dragged, { x: 5, y: 8 }, [
      [1, dragged],
      [2, child],
    ]);
    const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
    // Dragged node keeps its 1-unit radius; child keeps its 2-unit radius.
    expect(dist(result.get(1) as Point, pivot)).toBeCloseTo(1, 9);
    expect(dist(result.get(2) as Point, pivot)).toBeCloseTo(2, 9);
    // The subtree stays rigid: the dragged→child spacing is unchanged.
    expect(dist(result.get(1) as Point, result.get(2) as Point)).toBeCloseTo(1, 9);
  });
});

describe('translatePoints', () => {
  it('shifts every point by the drag delta', () => {
    const result = translatePoints({ x: 0, y: 0 }, { x: 2, y: -3 }, [
      [1, { x: 10, y: 10 }],
      [2, { x: 0, y: 0 }],
    ]);
    expect(near(result.get(1) as Point, { x: 12, y: 7 })).toBe(true);
    expect(near(result.get(2) as Point, { x: 2, y: -3 })).toBe(true);
  });
});
