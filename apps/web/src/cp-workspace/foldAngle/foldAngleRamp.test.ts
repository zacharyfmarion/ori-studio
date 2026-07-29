import { describe, expect, it } from 'vitest';
import type { Rgba } from '../renderer/types';
import { MAX_WASH, applyFoldAngleRamp } from './foldAngleRamp';
import { FOLD_MAGNITUDE_FULL, FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';

const INK: Rgba = [1, 0, 0, 1];
const CANVAS: Rgba = [0, 0, 0, 1];
const degrees = (value: number) => value * FOLD_MAGNITUDE_UNITS_PER_DEGREE;

describe('fold angle ramp', () => {
  it('returns a classic crease unchanged, by identity', () => {
    // Identity matters, not just equality: the classic path is the hot path, and
    // a classic document must render byte-identically to before this feature.
    expect(applyFoldAngleRamp(INK, undefined, CANVAS)).toBe(INK);
    expect(applyFoldAngleRamp(INK, FOLD_MAGNITUDE_FULL, CANVAS)).toBe(INK);
  });

  it('washes shallower angles further toward the canvas', () => {
    const at135 = applyFoldAngleRamp(INK, degrees(135), CANVAS)[0];
    const at90 = applyFoldAngleRamp(INK, degrees(90), CANVAS)[0];
    const at45 = applyFoldAngleRamp(INK, degrees(45), CANVAS)[0];
    expect(at135).toBeGreaterThan(at90);
    expect(at90).toBeGreaterThan(at45);
  });

  it('floors the wash so even a 0 degree crease stays clearly drawn', () => {
    // A fully washed crease would be invisible, and near-invisible reads as
    // "dimmed" -- an existing meaning on this surface.
    const flat = applyFoldAngleRamp(INK, 0, CANVAS);
    expect(flat[0]).toBeCloseTo(1 - MAX_WASH, 6);
    expect(flat[0]).toBeGreaterThan(0.4);
  });

  it('never touches alpha', () => {
    // Alpha is the surface's dimming channel; the ramp must stay out of it.
    for (const magnitude of [0, degrees(45), degrees(90), degrees(179)]) {
      expect(applyFoldAngleRamp(INK, magnitude, CANVAS)[3]).toBe(1);
    }
  });

  it('washes toward whatever the canvas is, so it works in both themes', () => {
    const light: Rgba = [1, 1, 1, 1];
    const inkOnLight = applyFoldAngleRamp([0, 0, 1, 1], degrees(90), light);
    // Toward white: the blue channel stays, the others rise.
    expect(inkOnLight[0]).toBeGreaterThan(0);
    expect(inkOnLight[2]).toBeGreaterThan(0.5);
  });

  it('clamps a magnitude beyond the full range', () => {
    expect(applyFoldAngleRamp(INK, FOLD_MAGNITUDE_FULL * 2, CANVAS)).toBe(INK);
  });
});
