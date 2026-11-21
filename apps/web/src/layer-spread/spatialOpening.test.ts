import { describe, expect, it } from 'vitest';
import type { Point3 } from '@oristudio/layer-spread';
import type { SpatialSpreadInput, SpatialSpreadSolution } from '../cp-workspace/folded/folded3dMaterial';
import { spatialDrawAmount } from '../cp-workspace/folded/spatialSpreadSettings';
import { spatialOpeningGain } from './spatialOpening';
import { spreadUpdate } from './spreadUpdate';

// Two stacked triangles, each with half a square unit of material, moving apart rigidly.
const triangle: Point3[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const input: SpatialSpreadInput = {
  positions: [...triangle, ...triangle], faces: [[0, 1, 2], [3, 4, 5]], triangles: [[0, 1, 2], [3, 4, 5]],
  triangle_faces: [0, 1], groups: [0, 0], cells: [{ ring: triangle, faces: [0, 1], normal: [0, 0, 1] }],
};
const solution = (gap: number): SpatialSpreadSolution => ({
  version: 'spatial-vector-v1', constraint_residual: 0, status: 'solved', max_order_violation: 0,
  mean_gap: gap, displacements: input.positions.map((_, i) => [0, 0, i < 3 ? 0 : gap]),
});

describe('the spatial v2 scale', () => {
  it('opens a translating pair by 1.6% at full Amount, independently of rotation and size', () => {
    const field = solution(0.001);
    const gain = spatialOpeningGain(input, field);
    expect(4 * field.mean_gap * gain).toBeCloseTo(0.016, 12);
    const transform = ([x, y, z]: Point3): Point3 => [7 * z, 7 * x, 7 * y];
    expect(spatialOpeningGain({ ...input, positions: input.positions.map(transform) }, {
      ...field, displacements: field.displacements.map(transform), mean_gap: 7 * field.mean_gap,
    })).toBeCloseTo(gain, 12);
  });

  it('bounds travel, local deformation, order error and very small gaps', () => {
    const field = solution(0.0001);
    expect(spatialOpeningGain(input, field)).toBe(8);
    expect(spatialOpeningGain(input, { ...field, max_order_violation: 0.001 })).toBeCloseTo(1.25);
    expect(spatialOpeningGain(input, { ...field, displacements: input.positions.map(() => [0, 0, 0.05]) })).toBe(2.5);
    const narrow = { ...input, positions: input.positions.map(([x, y, z]): Point3 => [x / 10, y * 10, z]) };
    const strained = { ...field, displacements: input.positions.map(([x]): Point3 => [x * 0.02, 0, 0]) };
    expect(spatialOpeningGain(narrow, strained)).toBeCloseTo(1.25);
    expect(spatialOpeningGain(input, solution(1e-12))).toBe(1);
    expect(spatialOpeningGain(input, solution(0))).toBe(1);
  });

  it('uses the same mesh for two saved versions and discloses a capped conversion', () => {
    const legacy = { kind: 'spatial' as const, version: 1 as const, amount: 1 };
    for (const gain of [0.5, 1, 4]) {
      const updated = spreadUpdate(legacy, false, null, gain)!;
      expect(updated.capped).toBe(false);
      expect(spatialDrawAmount({ ...legacy, version: 2, amount: updated.amount }, gain)).toBe(spatialDrawAmount(legacy, gain));
    }
    expect(spreadUpdate(legacy, false, null, 0.1)).toEqual({ amount: 4, capped: true });
    expect(spreadUpdate(legacy, false, null, null)).toBeNull();
  });
});
