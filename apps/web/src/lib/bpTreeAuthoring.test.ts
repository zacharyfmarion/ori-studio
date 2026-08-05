import { describe, expect, it } from 'vitest';
import {
  bpTreeDragUpdates,
  rotatePointsAround,
  translatePoints,
  unitLeafLocation,
} from './bpTreeAuthoring';
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

describe('bpTreeDragUpdates', () => {
  //   0 (root) --- 1 --- 2
  const vertices = new Map([
    [0, { x: 0, y: 0 }],
    [1, { x: 1, y: 0 }],
    [2, { x: 2, y: 0 }],
  ]);

  it('moves nothing when the root is dragged', () => {
    const moved = bpTreeDragUpdates({
      vertexId: 0,
      parentId: null,
      vertices,
      subtreeIds: [0, 1, 2],
      start: { x: 0, y: 0 },
      target: { x: 3, y: 5 },
    });
    expect(moved.size).toBe(0);
  });

  it('rotates a vertex and its subtree about its parent, preserving edge lengths', () => {
    const moved = bpTreeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1, 2],
      start: { x: 1, y: 0 },
      // A quarter turn about the root.
      target: { x: 0, y: 4 },
    });
    const one = moved.get(1);
    const two = moved.get(2);
    expect(one?.x).toBeCloseTo(0);
    expect(one?.y).toBeCloseTo(1);
    expect(two?.x).toBeCloseTo(0);
    expect(two?.y).toBeCloseTo(2);
    // Untouched: rotation is scoped to the subtree.
    expect(moved.has(0)).toBe(false);
    // Every edge keeps its length — the invariant the whole rule exists for.
    expect(Math.hypot(one!.x - 0, one!.y - 0)).toBeCloseTo(1);
    expect(Math.hypot(two!.x - one!.x, two!.y - one!.y)).toBeCloseTo(1);
  });

  it('moves nothing when the parent is unknown', () => {
    expect(
      bpTreeDragUpdates({
        vertexId: 1,
        parentId: 99,
        vertices,
        subtreeIds: [1, 2],
        start: { x: 1, y: 0 },
        target: { x: 0, y: 1 },
      }).size
    ).toBe(0);
  });

  it('moves nothing when the dragged vertex is missing from its own subtree', () => {
    expect(
      bpTreeDragUpdates({
        vertexId: 1,
        parentId: 0,
        vertices,
        subtreeIds: [2],
        start: { x: 1, y: 0 },
        target: { x: 0, y: 1 },
      }).size
    ).toBe(0);
  });
});

/**
 * A paired vertex may not be dragged across the mirror.
 *
 * Its partner is reflected across the same line, so crossing it swaps the two —
 * the drawing turns inside out. A drag rotates rigidly about the parent, so the
 * limit is on the *angle*: sweep from where it is now, which is valid, and stop
 * at the first held vertex that would reach the line.
 */
describe('bpTreeDragUpdates — the mirror is a wall', () => {
  // Vertical through x = 10, as the BP tree's mirror always is.
  const axis = { loc: { x: 10, y: 10 }, angle: 90 };
  // Root at the centre, one leaf a unit to its right.
  const vertices = new Map<number, Point>([
    [0, { x: 10, y: 10 }],
    [1, { x: 11, y: 10 }],
  ]);

  function drag(target: Point, heldIds: number[]) {
    return bpTreeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1],
      start: { x: 11, y: 10 },
      target,
      mirror: heldIds.length > 0 ? { axis, heldIds: new Set(heldIds) } : null,
    });
  }

  it('stops a held vertex on the line rather than past it', () => {
    // Straight across to the far side; the pivot sits on the mirror, so the leaf
    // can only swing as far as the line itself.
    const moved = drag({ x: 9, y: 10 }, [1]);
    expect(moved.get(1)?.x).toBeCloseTo(10, 9);
  });

  it('lets it swing right up to the line and no further, from either direction', () => {
    for (const target of [
      { x: 9, y: 4 },
      { x: 9, y: 16 },
    ]) {
      const moved = drag(target, [1]);
      expect(moved.get(1)!.x).toBeGreaterThanOrEqual(10 - 1e-9);
    }
  });

  it('leaves an unheld vertex free to cross', () => {
    const moved = drag({ x: 9, y: 10 }, []);
    expect(moved.get(1)?.x).toBeCloseTo(9, 9);
  });

  it('does not interfere with a rotation that stays on its own side', () => {
    const held = drag({ x: 10 + Math.SQRT1_2, y: 10 + Math.SQRT1_2 }, [1]);
    const free = drag({ x: 10 + Math.SQRT1_2, y: 10 + Math.SQRT1_2 }, []);
    expect(held.get(1)).toEqual(free.get(1));
  });

  it('never lets a whole subtree cross, not just the grabbed vertex', () => {
    // The child hangs further out than its parent, so it reaches the mirror
    // first and is what decides the limit.
    const deep = new Map<number, Point>([
      [0, { x: 10, y: 10 }],
      [1, { x: 12, y: 10 }],
      [2, { x: 14, y: 10 }],
    ]);
    const moved = bpTreeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: deep,
      subtreeIds: [1, 2],
      start: { x: 12, y: 10 },
      target: { x: 8, y: 11 },
      mirror: { axis, heldIds: new Set([1, 2]) },
    });
    expect(moved.get(1)!.x).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(moved.get(2)!.x).toBeGreaterThanOrEqual(10 - 1e-9);
  });

  it('leaves a vertex whose circle never meets the mirror unclamped', () => {
    // Pivot far from the line and a short edge: the leaf cannot reach it however
    // far it turns, so the clamp must not invent a limit.
    const offAxis = new Map<number, Point>([
      [0, { x: 16, y: 10 }],
      [1, { x: 17, y: 10 }],
    ]);
    const moved = bpTreeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: offAxis,
      subtreeIds: [1],
      start: { x: 17, y: 10 },
      target: { x: 15, y: 10 },
      mirror: { axis, heldIds: new Set([1]) },
    });
    expect(moved.get(1)?.x).toBeCloseTo(15, 9);
  });
});
