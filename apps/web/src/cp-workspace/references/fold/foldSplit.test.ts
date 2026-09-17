import { describe, expect, it } from 'vitest';
import type { PointGeometry, StrokeGeometry } from '../../renderer/types';
import { dropPointsOnFlaps, splitStrokesAtFolds } from './foldSplit';

/** Strokes from `[ax, ay, bx, by]` rows, each with its own colour and width. */
function strokes(rows: readonly (readonly [number, number, number, number])[]): StrokeGeometry {
  const count = rows.length;
  const geometry: StrokeGeometry = {
    a: new Float32Array(count * 2),
    b: new Float32Array(count * 2),
    color: new Float32Array(count * 4),
    widthMul: new Float32Array(count),
    dashSlot: new Float32Array(count),
    dashPhase: new Float32Array(count),
    count,
    dashPatterns: [[4, 2]],
  };
  rows.forEach(([ax, ay, bx, by], i) => {
    geometry.a.set([ax, ay], i * 2);
    geometry.b.set([bx, by], i * 2);
    geometry.color.set([i / 10, 0.5, 0.25, 1], i * 4);
    geometry.widthMul[i] = 1 + i;
    geometry.dashSlot![i] = i % 2;
    geometry.dashPhase![i] = 10 * i;
  });
  return geometry;
}

const VERTICAL = {
  chord: [
    { x: 5, y: 0 },
    { x: 5, y: 10 },
  ] as const,
  side: 1 as const, // x < 5, by the cross product's sign
};

describe('splitStrokesAtFolds', () => {
  it('keeps the resting side, moves the flap side, and cuts a crossing stroke in two', () => {
    const source = strokes([
      [6, 1, 9, 1], // right of the line: stays
      [1, 2, 4, 2], // left of the line: moves
      [1, 3, 9, 3], // crosses at x = 5: half each
      [5, 0, 5, 10], // the hinge itself: stays
    ]);
    const { base, flap } = splitStrokesAtFolds(source, [VERTICAL]);
    expect(base.count).toBe(3);
    expect(flap.count).toBe(2);
    // The crossing stroke's right half stays…
    expect(Array.from(base.a.slice(2, 4))).toEqual([5, 3]);
    expect(Array.from(base.b.slice(2, 4))).toEqual([9, 3]);
    // …with its dash pattern carried past the cut, so the two halves dash as one.
    expect(base.dashPhase![1]).toBe(20 + 4);
    // …and its left half moves, keeping the appearance of stroke 2.
    expect(Array.from(flap.a.slice(2, 4))).toEqual([1, 3]);
    expect(Array.from(flap.b.slice(2, 4))).toEqual([5, 3]);
    expect(flap.widthMul[1]).toBe(3);
    expect(flap.color[4]).toBeCloseTo(0.2);
    expect(flap.dashPhase[1]).toBe(20);
    expect(Array.from(flap.flap)).toEqual([0, 0]);
    expect(flap.dashPatterns).toEqual([[4, 2]]);
  });

  it('leaves hidden strokes alone and cuts against every flap in turn', () => {
    const source = strokes([
      [0, 5, 10, 5], // crosses both lines below
      [0, 5, 10, 5], // hidden: alpha 0
    ]);
    source.color[7] = 0;
    const left = {
      chord: [
        { x: 2, y: 0 },
        { x: 2, y: 10 },
      ] as const,
      side: 1 as const,
    };
    const right = {
      chord: [
        { x: 8, y: 0 },
        { x: 8, y: 10 },
      ] as const,
      side: -1 as const,
    };
    const { base, flap } = splitStrokesAtFolds(source, [left, right]);
    expect(flap.count).toBe(2);
    expect(Array.from(flap.flap)).toEqual([0, 1]);
    expect(Array.from(flap.b.slice(0, 2))).toEqual([2, 5]);
    expect(Array.from(flap.a.slice(2, 4))).toEqual([8, 5]);
    // The middle piece and the hidden stroke stay.
    expect(base.count).toBe(2);
    expect(Array.from(base.a.slice(0, 2))).toEqual([2, 5]);
    expect(Array.from(base.b.slice(0, 2))).toEqual([8, 5]);
    expect(base.color[7]).toBe(0);
  });
});

describe('a sheet turning over', () => {
  it('takes every stroke and every mark with it, the line included', () => {
    const source = strokes([
      [6, 1, 9, 1],
      [1, 3, 9, 3],
      [5, 0, 5, 10],
    ]);
    const whole = { ...VERTICAL, whole: true };
    const { base, flap } = splitStrokesAtFolds(source, [whole]);
    expect(base.count).toBe(0);
    expect(flap.count).toBe(3);
    expect(Array.from(flap.flap)).toEqual([0, 0, 0]);
    const points: PointGeometry = {
      center: Float32Array.from([1, 1, 5, 5, 9, 9]),
      radius: Float32Array.from([1, 2, 3]),
      screenSpace: Float32Array.from([1, 1, 1]),
      fill: new Float32Array(12),
      stroke: new Float32Array(12),
      count: 3,
    };
    expect(dropPointsOnFlaps(points, [whole]).count).toBe(0);
  });
});

describe('dropPointsOnFlaps', () => {
  it('drops the marks that would move and keeps the rest, the hinge included', () => {
    const points: PointGeometry = {
      center: Float32Array.from([1, 1, 5, 5, 9, 9]),
      radius: Float32Array.from([1, 2, 3]),
      screenSpace: Float32Array.from([1, 1, 1]),
      fill: new Float32Array(12).fill(0.5),
      stroke: new Float32Array(12).fill(0.25),
      count: 3,
    };
    const kept = dropPointsOnFlaps(points, [VERTICAL]);
    expect(kept.count).toBe(2);
    expect(Array.from(kept.center)).toEqual([5, 5, 9, 9]);
    expect(Array.from(kept.radius)).toEqual([2, 3]);
    // Nothing on the flap: the same buffer back.
    expect(dropPointsOnFlaps(points, [{ ...VERTICAL, side: -1 }])).not.toBe(points);
    expect(dropPointsOnFlaps(kept, [VERTICAL])).toBe(kept);
  });
});
