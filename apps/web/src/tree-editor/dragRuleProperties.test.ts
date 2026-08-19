import { describe, expect, it } from 'vitest';
import { treeDragUpdates, type TreeDragMirror } from './dragRule';
import type { Point } from '../lib/geometry';

/**
 * The drag rule's invariants, over random trees and gestures.
 *
 * These are the properties the rule exists to have, and the interesting failures
 * are geometric rather than enumerable — a clamp that stops one vertex but not
 * its child, a rounding step that pushes a length back over a wall the sweep had
 * just stopped at. A handful of hand-picked cases will not find those; a few
 * thousand random ones will.
 */

/** A deterministic generator, so a failure is reproducible from its seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

interface Scenario {
  vertices: Map<number, Point>;
  subtreeIds: number[];
  vertexId: number;
  parentId: number;
  start: Point;
  target: Point;
  currentLength: number;
}

/** A parent, a dragged vertex, and a chain of two below it. */
function scenario(next: () => number): Scenario {
  const pivot = { x: next() * 20 - 10, y: next() * 20 - 10 };
  const currentLength = 1 + Math.floor(next() * 5);
  const angle = next() * Math.PI * 2;
  const dragged = {
    x: pivot.x + Math.cos(angle) * currentLength,
    y: pivot.y + Math.sin(angle) * currentLength,
  };
  const childAngle = next() * Math.PI * 2;
  const childLength = 1 + next() * 3;
  const child = {
    x: dragged.x + Math.cos(childAngle) * childLength,
    y: dragged.y + Math.sin(childAngle) * childLength,
  };
  const grandAngle = next() * Math.PI * 2;
  const grandLength = 1 + next() * 3;
  const grand = {
    x: child.x + Math.cos(grandAngle) * grandLength,
    y: child.y + Math.sin(grandAngle) * grandLength,
  };
  return {
    vertices: new Map([
      [0, pivot],
      [1, dragged],
      [2, child],
      [3, grand],
    ]),
    subtreeIds: [1, 2, 3],
    vertexId: 1,
    parentId: 0,
    start: dragged,
    target: { x: pivot.x + (next() * 24 - 12), y: pivot.y + (next() * 24 - 12) },
    currentLength,
  };
}

const snapped = (current: number) => ({
  current,
  min: 1,
  max: null,
  step: 1,
  quantize: (distance: number) => Math.round(distance),
});

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const CASES = 400;

describe('drag rule properties', () => {
  it('keeps every edge inside the dragged subtree at its original length', () => {
    const next = random(20260806);
    for (let i = 0; i < CASES; i += 1) {
      const s = scenario(next);
      const { updates } = treeDragUpdates({ ...s, length: snapped(s.currentLength) });
      if (updates.size === 0) continue;
      for (const [a, b] of [
        [1, 2],
        [2, 3],
      ] as const) {
        const before = distance(s.vertices.get(a)!, s.vertices.get(b)!);
        const after = distance(updates.get(a)!, updates.get(b)!);
        expect(after).toBeCloseTo(before, 9);
      }
    }
  });

  it('changes exactly one edge — the one being dragged — and to the length it reports', () => {
    const next = random(11);
    for (let i = 0; i < CASES; i += 1) {
      const s = scenario(next);
      const result = treeDragUpdates({ ...s, length: snapped(s.currentLength) });
      if (result.updates.size === 0) continue;
      const dragged = distance(s.vertices.get(0)!, result.updates.get(1)!);
      expect(dragged).toBeCloseTo(result.length, 9);
    }
  });

  it('only ever reports an admissible length', () => {
    const next = random(3407);
    for (let i = 0; i < CASES; i += 1) {
      const s = scenario(next);
      const result = treeDragUpdates({
        ...s,
        length: {
          current: s.currentLength,
          min: 1,
          max: 6,
          step: 1,
          quantize: (d) => Math.round(d),
        },
      });
      expect(Number.isInteger(result.length)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(6);
    }
  });

  it('never lets a held vertex reach the mirror, however the gesture is composed', () => {
    const next = random(99);
    const axis = { loc: { x: 0, y: 0 }, angle: 90 };
    const clearance = 0.02;
    const normalDistance = (point: Point) => point.x - axis.loc.x;
    for (let i = 0; i < CASES; i += 1) {
      const s = scenario(next);
      // Only a scenario that starts legally can be swept from.
      const held = s.subtreeIds.filter(
        (id) => Math.abs(normalDistance(s.vertices.get(id)!)) >= clearance,
      );
      if (held.length === 0) continue;
      const mirror: TreeDragMirror = { axis, heldIds: new Set(held), clearance };
      const { updates } = treeDragUpdates({ ...s, length: snapped(s.currentLength), mirror });
      if (updates.size === 0) continue;
      for (const id of held) {
        const before = normalDistance(s.vertices.get(id)!);
        const after = normalDistance(updates.get(id)!);
        // Same side, and no closer than the clearance band.
        expect(Math.sign(after) === Math.sign(before) || after === 0).toBe(true);
        expect(Math.abs(after)).toBeGreaterThanOrEqual(clearance - 1e-6);
      }
    }
  });

  it('never puts a vertex outside the surface bounds', () => {
    const next = random(555);
    const inside = (point: Point) =>
      point.x >= -12 && point.x <= 12 && point.y >= -12 && point.y <= 12;
    for (let i = 0; i < CASES; i += 1) {
      const s = scenario(next);
      if (![...s.vertices.values()].every(inside)) continue;
      const { updates } = treeDragUpdates({
        ...s,
        length: snapped(s.currentLength),
        bounds: inside,
      });
      for (const point of updates.values()) expect(inside(point)).toBe(true);
    }
  });

  it('reproduces the rotation-only rule when the length cannot change', () => {
    const next = random(777);
    for (let i = 0; i < CASES; i += 1) {
      const s = scenario(next);
      const { updates, length } = treeDragUpdates({
        ...s,
        length: {
          current: s.currentLength,
          min: 1,
          max: null,
          step: 1,
          quantize: () => s.currentLength,
        },
      });
      if (updates.size === 0) continue;
      expect(length).toBe(s.currentLength);
      // Every vertex kept its distance to the pivot: a pure rotation, which is
      // exactly what the rule this replaces did.
      for (const id of s.subtreeIds) {
        const before = distance(s.vertices.get(0)!, s.vertices.get(id)!);
        const after = distance(s.vertices.get(0)!, updates.get(id)!);
        expect(after).toBeCloseTo(before, 9);
      }
    }
  });
});
