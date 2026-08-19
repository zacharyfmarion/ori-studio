import { describe, expect, it } from 'vitest';
import {
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  symmetrySide,
  type SymmetryAxis,
} from './symmetryGeometry';

const vertical: SymmetryAxis = { loc: { x: 0.5, y: 0.5 }, angle: 90 };

describe('symmetryGeometry', () => {
  it('reflection is an involution across the axis', () => {
    const p = { x: 0.2, y: 0.31 };
    const back = reflectPointAcrossSymmetryAxis(
      reflectPointAcrossSymmetryAxis(p, vertical),
      vertical,
    );
    expect(back.x).toBeCloseTo(p.x);
    expect(back.y).toBeCloseTo(p.y);
  });

  it('snaps a point within tolerance onto the axis and reports it', () => {
    // 0.01 < default tolerance 0.015 → snaps to the axis line (x = 0.5).
    const near = snapPointToSymmetryAxis({ x: 0.49, y: 0.8 }, vertical);
    expect(near.snapped).toBe(true);
    expect(near.point.x).toBeCloseTo(0.5);
    expect(near.point.y).toBeCloseTo(0.8);
    expect(symmetrySide(near.point, vertical)).toBe(0);
  });

  it('leaves a point beyond tolerance untouched', () => {
    const far = snapPointToSymmetryAxis({ x: 0.2, y: 0.8 }, vertical);
    expect(far.snapped).toBe(false);
    expect(far.point).toEqual({ x: 0.2, y: 0.8 });
    expect(far.distance).toBeCloseTo(0.3);
  });
});
