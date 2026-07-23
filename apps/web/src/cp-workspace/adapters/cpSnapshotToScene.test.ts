import { describe, expect, it, vi } from 'vitest';
import { applyAffine, cpSnapshotToScene, translationMatrix } from './cpSnapshotToScene';
import type { Rgba } from '../renderer/types';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

describe('cpSnapshotToScene', () => {
  it('packs endpoints and per-segment colours', () => {
    const segments = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 20 }, color: 'Red1' },
      { a: { x: 5, y: 6 }, b: { x: 7, y: 8 }, color: 'Blue2' },
    ];
    const scene = cpSnapshotToScene(segments, (c) => (c === 'Red1' ? RED : BLUE));
    expect(scene.strokes.count).toBe(2);
    expect(Array.from(scene.strokes.a)).toEqual([0, 0, 5, 6]);
    expect(Array.from(scene.strokes.b)).toEqual([10, 20, 7, 8]);
    expect(Array.from(scene.strokes.color)).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
  });

  it('memoises colour resolution per distinct assignment', () => {
    const colorFor = vi.fn((): Rgba => RED);
    const segments = Array.from({ length: 5 }, () => ({
      a: { x: 0, y: 0 },
      b: { x: 1, y: 1 },
      color: 'Red1',
    }));
    cpSnapshotToScene(segments, colorFor);
    expect(colorFor).toHaveBeenCalledTimes(1);
  });

  it('handles an empty document', () => {
    const scene = cpSnapshotToScene([], () => RED);
    expect(scene.strokes.count).toBe(0);
    expect(scene.strokes.a).toHaveLength(0);
  });
});

describe('cpSnapshotToScene move preview', () => {
  const segments = [
    { a: { x: 0, y: 0 }, b: { x: 10, y: 0 }, color: 'a' },
    { a: { x: 0, y: 5 }, b: { x: 0, y: 15 }, color: 'b' },
    { a: { x: 20, y: 20 }, b: { x: 30, y: 30 }, color: 'c' },
  ];
  const SEL: Rgba = [0, 0, 1, 1];
  const selection = { selected: new Set([1, 3]), color: SEL, widthMul: 2.5 };

  it('shifts only the moved lines in place and leaves others put', () => {
    const { strokes } = cpSnapshotToScene(segments, () => RED, selection, {
      ids: new Set([1, 3]),
      matrix: translationMatrix({ x: 2, y: -3 }),
    });
    expect(strokes.count).toBe(3);
    // line 1 (index 0) shifted by (2,-3)
    expect(Array.from(strokes.a.slice(0, 2))).toEqual([2, -3]);
    expect(Array.from(strokes.b.slice(0, 2))).toEqual([12, -3]);
    // line 2 (index 1) not in move set — unchanged
    expect(Array.from(strokes.a.slice(2, 4))).toEqual([0, 5]);
    expect(Array.from(strokes.b.slice(2, 4))).toEqual([0, 15]);
    // line 3 (index 2) shifted
    expect(Array.from(strokes.a.slice(4, 6))).toEqual([22, 17]);
    expect(Array.from(strokes.b.slice(4, 6))).toEqual([32, 27]);
    // moved lines keep their selection highlight (colour + width)
    expect(Array.from(strokes.color.slice(0, 4))).toEqual([0, 0, 1, 1]);
    expect(strokes.widthMul[0]).toBeCloseTo(2.5);
  });

  it('is a no-op offset when move is omitted', () => {
    const { strokes } = cpSnapshotToScene(segments, () => RED, selection);
    expect(Array.from(strokes.a.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(strokes.a.slice(4, 6))).toEqual([20, 20]);
  });

  it('applies a rotate+scale matrix, not just a translation', () => {
    // Quarter turn about the origin, doubled, then shifted — the shape a
    // four-point move produces.
    const matrix = [0, -2, 2, 0, 1, 1] as const;
    const { strokes } = cpSnapshotToScene(segments, () => RED, selection, {
      ids: new Set([1]),
      matrix,
    });
    // line 1: (0,0)→(1,1), (10,0)→(1,21)
    expect(Array.from(strokes.a.slice(0, 2))).toEqual([1, 1]);
    expect(Array.from(strokes.b.slice(0, 2))).toEqual([1, 21]);
    // untransformed lines are untouched
    expect(Array.from(strokes.a.slice(2, 4))).toEqual([0, 5]);
  });

  it('translationMatrix round-trips through applyAffine', () => {
    expect(applyAffine(translationMatrix({ x: 2, y: -3 }), 10, 20)).toEqual({ x: 12, y: 17 });
  });
});
