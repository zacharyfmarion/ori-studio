import { describe, expect, it } from 'vitest';
import { dashSlotUniforms, dashTableUniforms } from './strokeProgram';
import {
  ORIEDITA_DASH_ONE_DOT,
  ORIEDITA_DASH_TWO_DOT,
  ORIEDITA_DASH_VALLEY,
} from '../../../lib/oristudioCpLineStyle';

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
    for (const pattern of [ORIEDITA_DASH_ONE_DOT, ORIEDITA_DASH_TWO_DOT, ORIEDITA_DASH_VALLEY]) {
      const total = pattern.reduce((sum, run) => sum + run, 0);
      expect(period(dashSlotUniforms(pattern, 1))).toBe(total);
    }
  });
});

describe('dashTableUniforms', () => {
  it('always yields one entry per slot, padding missing slots with solid', () => {
    const slots = dashTableUniforms([ORIEDITA_DASH_VALLEY], 1);
    expect(slots).toHaveLength(2);
    expect(period(slots[0])).toBe(16);
    expect(period(slots[1])).toBe(0);
  });

  it('is all solid when the geometry declares no patterns', () => {
    for (const slot of dashTableUniforms(undefined, 1)) expect(period(slot)).toBe(0);
    for (const slot of dashTableUniforms([], 1)) expect(period(slot)).toBe(0);
  });
});
