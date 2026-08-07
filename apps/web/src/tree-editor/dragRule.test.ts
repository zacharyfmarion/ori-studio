import { describe, expect, it } from 'vitest';
import {
  treeDragUpdates,
  rotatePointsAround,
  translatePoints,
  leafLocationAt,
} from './dragRule';
import type { Point } from '../lib/geometry';
import type { TreeDragLengthRule } from './dragRule';

const near = (a: Point, b: Point, eps = 1e-9) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

describe('leafLocationAt', () => {
  it('places a leaf at unit length toward the target', () => {
    const loc = leafLocationAt({ x: 10, y: 10 }, { x: 15, y: 10 });
    expect(near(loc, { x: 11, y: 10 })).toBe(true);
  });

  it('normalizes diagonal directions to unit length', () => {
    const loc = leafLocationAt({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(near(loc, { x: 0.6, y: 0.8 })).toBe(true);
  });

  it('falls back to straight up when the target coincides with the parent', () => {
    const loc = leafLocationAt({ x: 2, y: 2 }, { x: 2, y: 2 });
    expect(near(loc, { x: 2, y: 1 })).toBe(true);
  });

  it('honors a custom length', () => {
    const loc = leafLocationAt({ x: 0, y: 0 }, { x: 1, y: 0 }, 3);
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

/**
 * The drag rule sets the dragged edge's **length as well as its direction**, and
 * carries the subtree rigidly.
 *
 * Holding the length fixed reduces it exactly to the rotation-only rule it
 * replaces, which is why the rotation cases below still read the way they did.
 */
describe('treeDragUpdates', () => {
  //   0 (root) --- 1 --- 2
  const vertices = new Map([
    [0, { x: 0, y: 0 }],
    [1, { x: 1, y: 0 }],
    [2, { x: 2, y: 0 }],
  ]);

  /** Lengths that never change, so a drag is a pure rotation. */
  const held = (current: number) => ({
    current,
    min: 1,
    max: null,
    step: 1,
    quantize: () => current,
  });
  /** Whole grid cells, as box-pleat has. */
  const snapped = (current: number) => ({
    current,
    min: 1,
    max: null,
    step: 1,
    quantize: (distance: number) => Math.round(distance),
  });

  it('moves nothing when the root is dragged', () => {
    const moved = treeDragUpdates({
      vertexId: 0,
      parentId: null,
      vertices,
      subtreeIds: [0, 1, 2],
      start: { x: 0, y: 0 },
      target: { x: 3, y: 5 },
      length: held(1),
    });
    expect(moved.updates.size).toBe(0);
  });

  it('rotates a vertex and its subtree about its parent, preserving edge lengths', () => {
    const moved = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1, 2],
      start: { x: 1, y: 0 },
      // A quarter turn about the root.
      target: { x: 0, y: 4 },
      length: held(1),
    }).updates;
    const one = moved.get(1);
    const two = moved.get(2);
    expect(one?.x).toBeCloseTo(0);
    expect(one?.y).toBeCloseTo(1);
    expect(two?.x).toBeCloseTo(0);
    expect(two?.y).toBeCloseTo(2);
    // Untouched: the move is scoped to the subtree.
    expect(moved.has(0)).toBe(false);
    // Every edge keeps its length — the invariant the whole rule exists for.
    expect(Math.hypot(one!.x - 0, one!.y - 0)).toBeCloseTo(1);
    expect(Math.hypot(two!.x - one!.x, two!.y - one!.y)).toBeCloseTo(1);
  });

  it('takes the length the cursor distance snaps to, and carries the subtree out', () => {
    const result = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1, 2],
      start: { x: 1, y: 0 },
      // Straight out along the same line, past the midpoint between 3 and 4.
      target: { x: 3.6, y: 0 },
      length: snapped(1),
    });
    expect(result.length).toBe(4);
    expect(result.updates.get(1)!.x).toBeCloseTo(4);
    // The child rode out with it, and the edge between them is untouched.
    expect(result.updates.get(2)!.x).toBeCloseTo(5);
    expect(
      Math.hypot(
        result.updates.get(2)!.x - result.updates.get(1)!.x,
        result.updates.get(2)!.y - result.updates.get(1)!.y
      )
    ).toBeCloseTo(1);
  });

  it('holds the length while the cursor is nearer the one it already has', () => {
    const result = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1, 2],
      // Turned a quarter and pulled to 1.4 — nearer 1 than 2, so it only turns.
      start: { x: 1, y: 0 },
      target: { x: 0, y: 1.4 },
      length: snapped(1),
    });
    expect(result.length).toBe(1);
    expect(result.updates.get(1)!.x).toBeCloseTo(0);
    expect(result.updates.get(1)!.y).toBeCloseTo(1);
  });

  it('never goes below the floor, however far in the cursor comes', () => {
    const result = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1, 2],
      start: { x: 1, y: 0 },
      target: { x: 0.05, y: 0 },
      length: snapped(1),
    });
    expect(result.length).toBe(1);
  });

  it('stops the gesture at the surface bounds instead of deforming the subtree', () => {
    const result = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1, 2],
      start: { x: 1, y: 0 },
      // Wants length 6, but nothing may go past x = 3.
      target: { x: 6, y: 0 },
      length: snapped(1),
      bounds: (point) => point.x <= 3 + 1e-9,
    });
    for (const point of result.updates.values()) expect(point.x).toBeLessThanOrEqual(3 + 1e-9);
    // Rigidity is the point: clamping each vertex onto the wall would have left
    // the child sitting on top of its parent.
    const one = result.updates.get(1)!;
    const two = result.updates.get(2)!;
    expect(Math.hypot(two.x - one.x, two.y - one.y)).toBeCloseTo(1);
  });

  it('moves nothing when the parent is unknown', () => {
    expect(
      treeDragUpdates({
        vertexId: 1,
        parentId: 99,
        vertices,
        subtreeIds: [1, 2],
        start: { x: 1, y: 0 },
        target: { x: 0, y: 1 },
        length: held(1),
      }).updates.size
    ).toBe(0);
  });

  it('moves nothing when the dragged vertex is missing from its own subtree', () => {
    expect(
      treeDragUpdates({
        vertexId: 1,
        parentId: 0,
        vertices,
        subtreeIds: [2],
        start: { x: 1, y: 0 },
        target: { x: 0, y: 1 },
        length: held(1),
      }).updates.size
    ).toBe(0);
  });
});

/**
 * A paired vertex may not be dragged across the mirror.
 *
 * Its partner is reflected across the same line, so crossing it swaps the two —
 * the drawing turns inside out. The gesture is swept from where it is now, which
 * is valid, toward what the cursor asked for, and stopped at the first held
 * vertex that would reach the line.
 */
describe('treeDragUpdates — the mirror is a wall', () => {
  // Vertical through x = 10, as the BP tree's mirror always is.
  const axis = { loc: { x: 10, y: 10 }, angle: 90 };
  // Root at the centre, one leaf a unit to its right.
  const vertices = new Map<number, Point>([
    [0, { x: 10, y: 10 }],
    [1, { x: 11, y: 10 }],
  ]);

  // Matches BP_TREE_SYMMETRY_TOLERANCE: the band inside which a vertex already
  // counts as sitting on the axis.
  const CLEARANCE = 0.02;

  /** Length held fixed, so these stay tests about the angle alone. */
  const held = (current: number) => ({ current, min: 1, max: null, step: 1, quantize: () => current });

  function drag(target: Point, heldIds: number[]) {
    return treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices,
      subtreeIds: [1],
      start: { x: 11, y: 10 },
      target,
      length: held(1),
      mirror:
        heldIds.length > 0
          ? { axis, heldIds: new Set(heldIds), clearance: CLEARANCE }
          : null,
    }).updates;
  }

  it('stops a held vertex short of the line, not on it', () => {
    // Straight across to the far side. It stops at the clearance band, not at
    // the line: a vertex *on* the mirror is at the same point as its reflection,
    // so a pair that reached it would be two nodes stacked on one spot.
    const moved = drag({ x: 9, y: 10 }, [1]);
    expect(moved.get(1)!.x).toBeGreaterThanOrEqual(10 + CLEARANCE - 1e-6);
    expect(moved.get(1)!.x).toBeLessThan(10 + CLEARANCE + 0.01);
  });

  it('lets it swing right up to the line and no further, from either direction', () => {
    for (const target of [
      { x: 9, y: 4 },
      { x: 9, y: 16 },
    ]) {
      const moved = drag(target, [1]);
      expect(moved.get(1)!.x).toBeGreaterThanOrEqual(10 + CLEARANCE - 1e-6);
    }
  });

  it('leaves an unheld vertex free to cross', () => {
    const moved = drag({ x: 9, y: 10 }, []);
    expect(moved.get(1)?.x).toBeCloseTo(9, 9);
  });

  it('does not interfere with a rotation that stays on its own side', () => {
    const heldDrag = drag({ x: 10 + Math.SQRT1_2, y: 10 + Math.SQRT1_2 }, [1]);
    const free = drag({ x: 10 + Math.SQRT1_2, y: 10 + Math.SQRT1_2 }, []);
    expect(heldDrag.get(1)).toEqual(free.get(1));
  });

  it('never lets a whole subtree cross, not just the grabbed vertex', () => {
    // The child hangs further out than its parent, so it reaches the mirror
    // first and is what decides the limit.
    const deep = new Map<number, Point>([
      [0, { x: 10, y: 10 }],
      [1, { x: 12, y: 10 }],
      [2, { x: 14, y: 10 }],
    ]);
    const moved = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: deep,
      subtreeIds: [1, 2],
      start: { x: 12, y: 10 },
      target: { x: 8, y: 11 },
      length: held(2),
      mirror: { axis, heldIds: new Set([1, 2]), clearance: CLEARANCE },
    }).updates;
    expect(moved.get(1)!.x).toBeGreaterThanOrEqual(10 + CLEARANCE - 1e-6);
    expect(moved.get(2)!.x).toBeGreaterThanOrEqual(10 + CLEARANCE - 1e-6);
  });

  it('holds a lengthening drag back from the mirror too', () => {
    // The wall now has two ways to be hit: turning toward it, and simply growing
    // past it. The sweep covers both because it moves along the whole gesture.
    const result = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: new Map<number, Point>([
        [0, { x: 10, y: 10 }],
        [1, { x: 9, y: 10 }],
      ]),
      subtreeIds: [1],
      start: { x: 9, y: 10 },
      // Straight out to the left, which would take it to x = 4 — but it is held
      // on its own (left) side and must not be pushed through the axis.
      target: { x: 4, y: 10 },
      length: { current: 1, min: 1, max: null, step: 1, quantize: (d) => Math.round(d) },
      mirror: { axis, heldIds: new Set([1]), clearance: CLEARANCE },
    });
    // Growing away from the mirror is fine — this one is checking the sweep does
    // not spuriously refuse it.
    expect(result.updates.get(1)!.x).toBeLessThanOrEqual(10 - CLEARANCE);
    expect(result.length).toBe(6);
  });

  it('leaves a vertex whose circle never meets the mirror unclamped', () => {
    // Pivot far from the line and a short edge: the leaf cannot reach it however
    // far it turns, so the clamp must not invent a limit.
    const offAxis = new Map<number, Point>([
      [0, { x: 16, y: 10 }],
      [1, { x: 17, y: 10 }],
    ]);
    const moved = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: offAxis,
      subtreeIds: [1],
      start: { x: 17, y: 10 },
      target: { x: 15, y: 10 },
      length: held(1),
      mirror: { axis, heldIds: new Set([1]), clearance: CLEARANCE },
    }).updates;
    expect(moved.get(1)?.x).toBeCloseTo(15, 9);
  });
});

/**
 * A vertex that sits on the mirror line.
 *
 * It is its own reflection, so a rotate-and-extend drag would take it off the
 * line and break that silently — which is why such a vertex used to be refused a
 * drag outright, and read to the user as a node that could not be resized.
 * Refusing is too strong: every point *along* the line keeps the invariant. The
 * gesture becomes a slide, and stays one under either length rule.
 */
describe('treeDragUpdates — a vertex pinned to the mirror slides along it', () => {
  const axis = { loc: { x: 0, y: 0 }, angle: 90 }; // vertical, through the origin

  const continuous = (current: number) => ({
    current,
    min: 0.1,
    max: null,
    step: null,
    quantize: (distance: number) => distance,
  });
  const snapped = (current: number) => ({
    current,
    min: 1,
    max: null,
    step: 1,
    quantize: (distance: number) => Math.round(distance),
  });

  /** Parent on the axis, child two units up it. */
  function slideFromAxisParent(target: Point, length: TreeDragLengthRule) {
    return treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: new Map<number, Point>([
        [0, { x: 0, y: 0 }],
        [1, { x: 0, y: 2 }],
      ]),
      subtreeIds: [1],
      start: { x: 0, y: 2 },
      target,
      length,
      pinToAxis: axis,
    });
  }

  it('moves, where it used to refuse to', () => {
    const { updates } = slideFromAxisParent({ x: 0.6, y: 3.4 }, continuous(2));
    expect(updates.size).toBe(1);
  });

  it('tracks the cursor along the line, taking the length from the drawing', () => {
    const { updates, length } = slideFromAxisParent({ x: 0.6, y: 3.4 }, continuous(2));
    const moved = updates.get(1)!;
    expect(moved.x).toBeCloseTo(0, 12); // still on the mirror
    expect(moved.y).toBeCloseTo(3.4, 12); // at the cursor's height
    expect(length).toBeCloseTo(3.4, 12);
  });

  it('steps between whole lengths where the rule has them, still on the line', () => {
    const { updates, length } = slideFromAxisParent({ x: 0.6, y: 3.4 }, snapped(2));
    const moved = updates.get(1)!;
    expect(moved.x).toBeCloseTo(0, 12);
    expect(length).toBe(3);
    expect(moved.y).toBeCloseTo(3, 12);
  });

  it('slides to the other side of the parent when the cursor goes there', () => {
    const { updates } = slideFromAxisParent({ x: 0, y: -1.5 }, continuous(2));
    expect(updates.get(1)!.y).toBeCloseTo(-1.5, 12);
  });

  it('carries the subtree rigidly', () => {
    const { updates } = treeDragUpdates({
      vertexId: 1,
      parentId: 0,
      vertices: new Map<number, Point>([
        [0, { x: 0, y: 0 }],
        [1, { x: 0, y: 2 }],
        [2, { x: 1, y: 3 }],
      ]),
      subtreeIds: [1, 2],
      start: { x: 0, y: 2 },
      target: { x: 0, y: 4 },
      length: continuous(2),
      pinToAxis: axis,
    });
    const one = updates.get(1)!;
    const two = updates.get(2)!;
    // The child kept its offset from the vertex it hangs from: a slide up the
    // line is a translation, so nothing inside the subtree may deform.
    expect(two.x - one.x).toBeCloseTo(1, 12);
    expect(two.y - one.y).toBeCloseTo(1, 12);
  });

  /**
   * Parent *off* the axis is the case a naive projection gets wrong: the pinned
   * vertex must land where the circle of an admissible radius meets the line,
   * which is not the cursor's own projection.
   */
  describe('with the parent off the line', () => {
    function slideFromOffAxisParent(target: Point, length: TreeDragLengthRule) {
      return treeDragUpdates({
        vertexId: 1,
        parentId: 0,
        vertices: new Map<number, Point>([
          [0, { x: -3, y: 0 }],
          [1, { x: 0, y: 4 }],
        ]),
        subtreeIds: [1],
        start: { x: 0, y: 4 },
        target,
        length,
        pinToAxis: axis,
      });
    }

    it('lands on the line at exactly the admissible radius', () => {
      const { updates, length } = slideFromOffAxisParent({ x: 0.5, y: 4.2 }, snapped(5));
      const moved = updates.get(1)!;
      expect(moved.x).toBeCloseTo(0, 12);
      expect(Math.hypot(moved.x + 3, moved.y - 0)).toBeCloseTo(length, 12);
      expect(Number.isInteger(length)).toBe(true);
    });

    it('cannot come nearer than the foot of the perpendicular', () => {
      // The parent is 3 units from the line, so no radius under 3 reaches it.
      const { length } = slideFromOffAxisParent({ x: 0, y: 0.2 }, snapped(5));
      expect(length).toBeGreaterThanOrEqual(3);
    });

    it('moves nothing when no admissible radius reaches the line', () => {
      const { updates } = slideFromOffAxisParent(
        { x: 0, y: 1 },
        { ...snapped(5), max: 2 } // ceiling below the parent's own distance
      );
      expect(updates.size).toBe(0);
    });
  });
});
