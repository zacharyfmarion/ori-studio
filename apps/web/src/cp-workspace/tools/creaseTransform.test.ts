import { describe, expect, it } from 'vitest';
import golden from '../../../../../tests/fixtures/cp/crease-transform-golden.json';
import { applyAffine } from '../adapters/cpSnapshotToScene';
import {
  angleBetween0360,
  matrixFromPointPairs,
  segmentAngleDeg,
  similarityFromPointPairs,
} from './creaseTransform';
import { heldEndpointKeys } from '../pins/vertexPins';
import { endpointKey } from './vertexEndpoints';

interface GoldenCase {
  sourceA: [number, number];
  sourceB: [number, number];
  targetA: [number, number];
  targetB: [number, number];
  transformed: [number, number, number, number][];
}

interface PinnedGoldenCase extends GoldenCase {
  pins: [number, number][];
}

const point = ([x, y]: [number, number]) => ({ x, y });

describe('creaseTransform golden parity with the kernel', () => {
  // The fixture is produced by crates/oristudio-cp/tests/transform_preview_golden.rs
  // from `operations::transform::transform_segments_by_points` — the exact code the
  // commit runs. A drift on either side fails on the other.
  const segments = golden.segments as [number, number, number, number][];

  it.each((golden.cases as GoldenCase[]).map((c, i) => [i, c] as const))(
    'case %i reproduces the kernel-transformed endpoints',
    (_index, testCase) => {
      const matrix = matrixFromPointPairs(
        point(testCase.sourceA),
        point(testCase.sourceB),
        point(testCase.targetA),
        point(testCase.targetB)
      );
      expect(matrix).not.toBeNull();
      if (matrix === null) return;

      segments.forEach(([ax, ay, bx, by], segmentIndex) => {
        const [expectedAx, expectedAy, expectedBx, expectedBy] =
          testCase.transformed[segmentIndex];
        const a = applyAffine(matrix, ax, ay);
        const b = applyAffine(matrix, bx, by);
        // Tolerance, not equality: the matrix form re-associates the kernel's
        // per-point arithmetic, so the two agree to well inside a ulp-scale slack
        // but not bit-for-bit. The commit still comes from the kernel.
        const close = (actual: number, expected: number) =>
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
            1e-12 * (1 + Math.abs(expected))
          );
        close(a.x, expectedAx);
        close(a.y, expectedAy);
        close(b.x, expectedBx);
        close(b.y, expectedBy);
      });
    }
  );

  /**
   * The pinned half, and the reason it is worth a golden of its own.
   *
   * A pin makes the preview and the commit disagree in a way a plain matrix
   * cannot express: the commit *stretches* a crease with one held end while a
   * rigid preview translates it, so the creases jump on release. The browser's
   * answer is `heldEndpointKeys` plus one condition per end in the scene
   * adapters; this asserts that answer reproduces the kernel's `PinnedPoints`
   * exactly, over the same segments and transform.
   */
  it.each((golden.pinnedCases as PinnedGoldenCase[]).map((c, i) => [i, c] as const))(
    'pinned case %i reproduces the kernel-held endpoints',
    (_index, testCase) => {
      const matrix = matrixFromPointPairs(
        point(testCase.sourceA),
        point(testCase.sourceB),
        point(testCase.targetA),
        point(testCase.targetB)
      );
      expect(matrix).not.toBeNull();
      if (matrix === null) return;

      const held = heldEndpointKeys(
        segments.map(([ax, ay, bx, by]) => ({ a: { x: ax, y: ay }, b: { x: bx, y: by } })),
        testCase.pins.map(point)
      );

      segments.forEach(([ax, ay, bx, by], segmentIndex) => {
        const [expectedAx, expectedAy, expectedBx, expectedBy] =
          testCase.transformed[segmentIndex];
        // Exactly what the scene adapters do per end: move it unless it is held.
        const a = held.has(endpointKey(segmentIndex, 'a'))
          ? { x: ax, y: ay }
          : applyAffine(matrix, ax, ay);
        const b = held.has(endpointKey(segmentIndex, 'b'))
          ? { x: bx, y: by }
          : applyAffine(matrix, bx, by);
        const close = (actual: number, expected: number) =>
          expect(Math.abs(actual - expected)).toBeLessThanOrEqual(
            1e-12 * (1 + Math.abs(expected))
          );
        close(a.x, expectedAx);
        close(a.y, expectedAy);
        close(b.x, expectedBx);
        close(b.y, expectedBy);
      });
    }
  );
});

describe('segmentAngleDeg', () => {
  it('measures direction in degrees, normalised to [0, 360)', () => {
    const o = { x: 0, y: 0 };
    expect(segmentAngleDeg(o, { x: 1, y: 0 })).toBe(0);
    expect(segmentAngleDeg(o, { x: 0, y: 1 })).toBeCloseTo(90, 12);
    expect(segmentAngleDeg(o, { x: -1, y: 0 })).toBeCloseTo(180, 12);
    expect(segmentAngleDeg(o, { x: 0, y: -1 })).toBeCloseTo(270, 12);
  });

  it('returns the kernel sentinel for a zero-length pair', () => {
    expect(segmentAngleDeg({ x: 3, y: 4 }, { x: 3, y: 4 })).toBe(-10000);
  });
});

describe('angleBetween0360', () => {
  it('wraps into [0, 360)', () => {
    expect(angleBetween0360(-90)).toBe(270);
    expect(angleBetween0360(360)).toBe(0);
    expect(angleBetween0360(725)).toBe(5);
  });
});

describe('similarityFromPointPairs', () => {
  const o = { x: 0, y: 0 };

  it('resolves rotation, scale, pivot, and delta', () => {
    const similarity = similarityFromPointPairs(o, { x: 1, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 8 });
    expect(similarity).not.toBeNull();
    expect(similarity?.rotationDeg).toBeCloseTo(90, 12);
    expect(similarity?.scale).toBeCloseTo(3, 12);
    expect(similarity?.pivot).toEqual(o);
    expect(similarity?.delta).toEqual({ x: 5, y: 5 });
  });

  it('is null for a degenerate source pair, so the surface shows no ghost', () => {
    expect(similarityFromPointPairs(o, o, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });

  it('is null for a degenerate target pair rather than collapsing to a point', () => {
    const target = { x: 4, y: 4 };
    expect(similarityFromPointPairs(o, { x: 1, y: 0 }, target, target)).toBeNull();
  });
});
