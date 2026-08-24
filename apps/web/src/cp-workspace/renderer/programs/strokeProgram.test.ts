import { describe, expect, it } from 'vitest';
import { dashSlotUniforms, dashTableUniforms } from './strokeProgram';
import { MAX_DASH_SLOTS } from '../types';
import {
  cpLineStyleDashPatterns,
  HINT_DASH_SLOT,
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
  ORISTUDIO_DASH_UNASSIGNED,
  UNASSIGNED_DASH_SLOT,
} from '../../../lib/oristudioCpLineStyle';
import { ORISTUDIO_CP_LINE_STYLES } from '../../../lib/creasePatternViewport';

/**
 * The shader walks `on`/`off` run-by-run, so a pattern is correct when its runs
 * land in the right lanes and the period (their sum) matches the source pattern.
 */
function period(uniforms: { on: readonly number[]; off: readonly number[] }): number {
  return [...uniforms.on, ...uniforms.off].reduce((sum, run) => sum + run, 0);
}

describe('dashSlotUniforms', () => {
  it('splits alternating runs into the on/off lanes', () => {
    expect(dashSlotUniforms(ORIEDITA_DASH_ONE_DOT, 1)).toEqual({
      on: [10, 3, 0],
      off: [3, 3, 0],
    });
  });

  it('fills all three lanes for the two-dot chain', () => {
    expect(dashSlotUniforms(ORIEDITA_DASH_TWO_DOT, 1)).toEqual({
      on: [10, 3, 3],
      off: [3, 3, 3],
    });
  });

  it('leaves unused lanes at zero so short patterns collapse', () => {
    expect(dashSlotUniforms(ORIEDITA_DASH_VALLEY, 1)).toEqual({ on: [8, 0, 0], off: [8, 0, 0] });
  });

  it('scales CSS px to device px', () => {
    const uniforms = dashSlotUniforms(ORIEDITA_DASH_VALLEY, 2);
    expect(uniforms).toEqual({ on: [16, 0, 0], off: [16, 0, 0] });
    expect(period(uniforms)).toBe(32);
  });

  it('keeps each pattern period intact', () => {
    for (const pattern of [
      ORIEDITA_DASH_ONE_DOT,
      ORIEDITA_DASH_TWO_DOT,
      ORIEDITA_DASH_VALLEY,
      ORISTUDIO_DASH_UNASSIGNED,
    ]) {
      const total = pattern.reduce((sum, run) => sum + run, 0);
      expect(period(dashSlotUniforms(pattern, 1))).toBe(total);
    }
  });
});

describe('dashTableUniforms', () => {
  it('always yields one entry per slot, padding missing slots with solid', () => {
    const slots = dashTableUniforms([ORIEDITA_DASH_VALLEY], 1);
    expect(slots).toHaveLength(MAX_DASH_SLOTS);
    expect(period(slots[0])).toBe(16);
    for (const slot of slots.slice(1)) expect(period(slot)).toBe(0);
  });

  it('is all solid when the geometry declares no patterns', () => {
    for (const slot of dashTableUniforms(undefined, 1)) expect(period(slot)).toBe(0);
    for (const slot of dashTableUniforms([], 1)) expect(period(slot)).toBe(0);
  });

  it('has a slot for every pattern the line styles can put in play', () => {
    // The shader reads a fixed number of slots, so a style whose table outgrew
    // MAX_DASH_SLOTS would silently draw its last pattern solid.
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      const patterns = cpLineStyleDashPatterns(style);
      expect(patterns.length).toBeLessThanOrEqual(MAX_DASH_SLOTS);
      const slots = dashTableUniforms(patterns, 1);
      const undecided = slots[UNASSIGNED_DASH_SLOT - 1];
      expect(period(undecided)).toBe(
        ORISTUDIO_DASH_UNASSIGNED.reduce((sum, run) => sum + run, 0)
      );
    }
  });

  it('carries the hint pattern to the lane the shader reads it from', () => {
    // The one slot whose leading run is empty: it is the undecided dash shifted
    // by a mark, and the shift *is* that empty run (the shader has no phase).
    // Landing it in the wrong lane draws a hinted crease with the plain dash in
    // the direction's colour — the grey marks gone, and no way to tell from a
    // decided crease under a solid style.
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      const hint = dashTableUniforms(cpLineStyleDashPatterns(style), 1)[HINT_DASH_SLOT - 1];
      expect(hint).toEqual({ on: [0, 3, 0], off: [10, 7, 0] });
      expect(period(hint)).toBe(
        2 * ORISTUDIO_DASH_UNASSIGNED.reduce((sum, run) => sum + run, 0)
      );
    }
  });
});
