import { describe, expect, it, vi } from 'vitest';
import { applyAffine, cpSnapshotToScene, translationMatrix } from './cpSnapshotToScene';
import type { CpLineAppearance } from './cpLineStyle';
import type { Rgba } from '../renderer/types';

const RED: Rgba = [1, 0, 0, 1];
const BLUE: Rgba = [0, 0, 1, 1];

/** A solid appearance for `color` — the whole of the "color" line style. */
function solid(color: Rgba): CpLineAppearance {
  return { color, dashSlot: 0 };
}

/** No dash patterns in play, matching the solid styles. */
const SOLID_PATTERNS: readonly (readonly number[])[] = [];

describe('cpSnapshotToScene', () => {
  it('packs endpoints and per-segment colours', () => {
    const segments = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 20 }, color: 'Red1' },
      { a: { x: 5, y: 6 }, b: { x: 7, y: 8 }, color: 'Blue2' },
    ];
    const scene = cpSnapshotToScene(segments, (c) => solid(c === 'Red1' ? RED : BLUE), SOLID_PATTERNS);
    expect(scene.strokes.count).toBe(2);
    expect(Array.from(scene.strokes.a)).toEqual([0, 0, 5, 6]);
    expect(Array.from(scene.strokes.b)).toEqual([10, 20, 7, 8]);
    expect(Array.from(scene.strokes.color)).toEqual([1, 0, 0, 1, 0, 0, 1, 1]);
  });

  it('memoises colour resolution per distinct assignment', () => {
    const appearanceFor = vi.fn((): CpLineAppearance => solid(RED));
    const segments = Array.from({ length: 5 }, () => ({
      a: { x: 0, y: 0 },
      b: { x: 1, y: 1 },
      color: 'Red1',
    }));
    cpSnapshotToScene(segments, appearanceFor, SOLID_PATTERNS);
    expect(appearanceFor).toHaveBeenCalledTimes(1);
  });

  it('carries the line style through as per-segment dash slots', () => {
    const patterns = [
      [10, 3, 3, 3],
      [8, 8],
    ];
    const segments = [
      { a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, color: 'Red1' },
      { a: { x: 0, y: 1 }, b: { x: 1, y: 1 }, color: 'Blue2' },
      { a: { x: 0, y: 2 }, b: { x: 1, y: 2 }, color: 'Black0' },
    ];
    const { strokes } = cpSnapshotToScene(
      segments,
      (color) => ({ color: RED, dashSlot: color === 'Red1' ? 1 : color === 'Blue2' ? 2 : 0 }),
      patterns
    );
    expect(strokes.dashPatterns).toBe(patterns);
    expect(Array.from(strokes.dashSlot ?? [])).toEqual([1, 2, 0]);
  });

  it('keeps selected creases solid so the highlight does not read as broken', () => {
    const segments = [{ a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, color: 'Red1' }];
    const { strokes } = cpSnapshotToScene(segments, () => ({ color: RED, dashSlot: 1 }), [[8, 8]], {
      selected: new Set([1]),
      color: BLUE,
      widthMul: 2,
    });
    expect(Array.from(strokes.dashSlot ?? [])).toEqual([0]);
  });

  it('handles an empty document', () => {
    const scene = cpSnapshotToScene([], () => solid(RED), SOLID_PATTERNS);
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
    const { strokes } = cpSnapshotToScene(segments, () => solid(RED), SOLID_PATTERNS, selection, {
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
    const { strokes } = cpSnapshotToScene(segments, () => solid(RED), SOLID_PATTERNS, selection);
    expect(Array.from(strokes.a.slice(0, 2))).toEqual([0, 0]);
    expect(Array.from(strokes.a.slice(4, 6))).toEqual([20, 20]);
  });

  it('applies a rotate+scale matrix, not just a translation', () => {
    // Quarter turn about the origin, doubled, then shifted — the shape a
    // four-point move produces.
    const matrix = [0, -2, 2, 0, 1, 1] as const;
    const { strokes } = cpSnapshotToScene(segments, () => solid(RED), SOLID_PATTERNS, selection, {
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

  describe('endpoint moves (the vertex drag)', () => {
    it('moves one end of a crease and leaves the other where it is', () => {
      // Line 1's `a` and line 2's `a` sit on a shared vertex; line 3 does not.
      const { strokes } = cpSnapshotToScene(segments, () => solid(RED), SOLID_PATTERNS, undefined, {
        ids: new Set(),
        endpoints: new Set([0 * 2, 1 * 2]),
        matrix: translationMatrix({ x: 4, y: 7 }),
      });
      // line 1: `a` follows, `b` stays
      expect(Array.from(strokes.a.slice(0, 2))).toEqual([4, 7]);
      expect(Array.from(strokes.b.slice(0, 2))).toEqual([10, 0]);
      // line 2: `a` follows, `b` stays
      expect(Array.from(strokes.a.slice(2, 4))).toEqual([4, 12]);
      expect(Array.from(strokes.b.slice(2, 4))).toEqual([0, 15]);
      // line 3: untouched at both ends
      expect(Array.from(strokes.a.slice(4, 6))).toEqual([20, 20]);
      expect(Array.from(strokes.b.slice(4, 6))).toEqual([30, 30]);
    });

    it('moves a `b` endpoint through the odd key', () => {
      const { strokes } = cpSnapshotToScene(segments, () => solid(RED), SOLID_PATTERNS, undefined, {
        ids: new Set(),
        endpoints: new Set([0 * 2 + 1]),
        matrix: translationMatrix({ x: 1, y: 2 }),
      });
      expect(Array.from(strokes.a.slice(0, 2))).toEqual([0, 0]);
      expect(Array.from(strokes.b.slice(0, 2))).toEqual([11, 2]);
    });

    it('moves both ends when a whole-segment id and an endpoint key overlap', () => {
      // `ids` wins for the whole segment; the endpoint entry adds nothing. This
      // is not a state the tools produce, but the two sets are independent and
      // the union must not double-apply the matrix.
      const { strokes } = cpSnapshotToScene(segments, () => solid(RED), SOLID_PATTERNS, undefined, {
        ids: new Set([1]),
        endpoints: new Set([0 * 2]),
        matrix: translationMatrix({ x: 3, y: 3 }),
      });
      expect(Array.from(strokes.a.slice(0, 2))).toEqual([3, 3]);
      expect(Array.from(strokes.b.slice(0, 2))).toEqual([13, 3]);
    });
  });
});
