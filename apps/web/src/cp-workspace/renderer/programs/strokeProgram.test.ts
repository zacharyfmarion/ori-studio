import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    // Landing it in the wrong lane draws a hinted crease with the plain dash in
    // the direction's colour — the grey marks gone, and no way to tell from a
    // decided crease under a solid style. Its period identifies it: twice the
    // undecided dash's, which no other slot's is.
    const basePeriod = ORISTUDIO_DASH_UNASSIGNED.reduce((sum, run) => sum + run, 0);
    for (const style of ORISTUDIO_CP_LINE_STYLES) {
      const hint = dashTableUniforms(cpLineStyleDashPatterns(style), 1)[HINT_DASH_SLOT - 1];
      expect(period(hint)).toBe(2 * basePeriod);
      // `inDash` opens with `t < vDashOn.x`, so a positive first run is the
      // shader-side statement of the rule this pattern exists to keep: the
      // hint inks from distance 0, like the grey it is drawn over. A zero here
      // is a hint whose first ink is a whole period along, which on the great
      // majority of creases is no ink at all (see `alternateDashRuns`).
      expect(hint.on[0]).toBeGreaterThan(0);
    }
  });
});

describe('the slots the program reads', () => {
  // Six: the References workspace draws a step's fold, the pattern under it,
  // a dotted line and an earlier crease under one table while a fold plays
  // (`references/diagram/diagramInk`), and a slot the shader has no branch
  // for draws its pattern solid without a word.
  it('is six, each with its uniforms and a branch in the vertex stage', () => {
    expect(MAX_DASH_SLOTS).toBe(6);
    const source = readFileSync(resolve(__dirname, 'strokeProgram.ts'), 'utf8');
    for (let slot = 1; slot <= MAX_DASH_SLOTS; slot += 1) {
      expect(source, `slot ${slot}`).toContain(`uniform vec3 u_dashOn${slot};`);
      expect(source, `slot ${slot}`).toContain(`uniform vec3 u_dashOff${slot};`);
      expect(source, `slot ${slot}`).toContain(`aDashSlot > ${slot - 0.5}`);
      expect(source, `slot ${slot}`).toContain(`dashOn${slot}: slot${slot}.on,`);
      expect(source, `slot ${slot}`).toContain(`dashOff${slot}: slot${slot}.off,`);
      // And each uniform fed from its own slot's props, not a neighbour's.
      expect(source, `slot ${slot}`).toContain(`u_dashOn${slot}: (_ctx, props) => props.dashOn${slot},`);
      expect(source, `slot ${slot}`).toContain(`u_dashOff${slot}: (_ctx, props) => props.dashOff${slot},`);
      expect(source, `slot ${slot}`).toContain(`vDashOn = u_dashOn${slot};`);
    }
    expect(source).not.toContain(`u_dashOn${MAX_DASH_SLOTS + 1}`);
  });

  it('carries a pattern in the last slot to the last lane', () => {
    const patterns = Array.from({ length: MAX_DASH_SLOTS }, (_, i) => (i === MAX_DASH_SLOTS - 1 ? [5, 1] : []));
    const slots = dashTableUniforms(patterns, 1);
    expect(slots).toHaveLength(MAX_DASH_SLOTS);
    expect(period(slots[MAX_DASH_SLOTS - 1]!)).toBe(6);
    for (const slot of slots.slice(0, -1)) expect(period(slot)).toBe(0);
  });
});
