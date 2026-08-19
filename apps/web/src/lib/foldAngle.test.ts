import { describe, expect, it } from 'vitest';
import type { OristudioCpLineSegment } from '../engine/oristudioCpTypes';
import {
  FOLD_MAGNITUDE_FULL,
  FOLD_MAGNITUDE_UNITS_PER_DEGREE,
  creaseFoldAngle,
  creaseFoldMagnitudeDegrees,
  degreesToFoldMagnitude,
  formatFoldAngle,
  isClassicCrease,
  isFoldingCrease,
} from './foldAngle';

function segment(color: string, foldMagnitude?: number): OristudioCpLineSegment {
  return {
    a: { x: 0, y: 0 },
    b: { x: 1, y: 0 },
    active: 'Inactive0',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  };
}

describe('creaseFoldAngle', () => {
  it('follows the FOLD sign convention: mountain negative, valley positive', () => {
    expect(creaseFoldAngle(segment('Red1'))).toBe(-180);
    expect(creaseFoldAngle(segment('Blue2'))).toBe(180);
  });

  it('combines colour direction with the stored magnitude', () => {
    const ninety = 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE;
    expect(creaseFoldAngle(segment('Red1', ninety))).toBe(-90);
    expect(creaseFoldAngle(segment('Blue2', ninety))).toBe(90);
  });

  it('is null for anything that is not a crease', () => {
    expect(creaseFoldAngle(segment('Black0'))).toBeNull();
    expect(creaseFoldAngle(segment('Cyan3'))).toBeNull();
    expect(isFoldingCrease('Black0')).toBe(false);
    expect(isFoldingCrease('Red1')).toBe(true);
  });

  it('reports magnitude without the sign', () => {
    const ninety = 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE;
    expect(creaseFoldMagnitudeDegrees(segment('Red1', ninety))).toBe(90);
    expect(creaseFoldMagnitudeDegrees(segment('Blue2', ninety))).toBe(90);
    expect(creaseFoldMagnitudeDegrees(segment('Black0'))).toBeNull();
  });
});

describe('isClassicCrease', () => {
  it('treats an absent magnitude and an explicit 180 alike', () => {
    expect(isClassicCrease(segment('Red1'))).toBe(true);
    expect(isClassicCrease(segment('Red1', FOLD_MAGNITUDE_FULL))).toBe(true);
  });

  it('is false only for an explicit non-180 angle', () => {
    expect(isClassicCrease(segment('Blue2', 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE))).toBe(false);
    expect(isClassicCrease(segment('Blue2', 0))).toBe(false);
  });

  it('is trivially true for non-creases', () => {
    expect(isClassicCrease(segment('Black0'))).toBe(true);
  });
});

describe('degreesToFoldMagnitude', () => {
  it('rejects values outside 0..=180', () => {
    expect(degreesToFoldMagnitude(-1)).toBeNull();
    expect(degreesToFoldMagnitude(180.5)).toBeNull();
    expect(degreesToFoldMagnitude(Number.NaN)).toBeNull();
  });

  it('represents common construction angles exactly', () => {
    for (const degrees of [22.5, 30, 45, 60, 90, 120, 135, 180]) {
      const units = degreesToFoldMagnitude(degrees);
      expect(units).toBe(degrees * FOLD_MAGNITUDE_UNITS_PER_DEGREE);
    }
  });
});

describe('formatFoldAngle', () => {
  it('trims trailing zeros', () => {
    expect(formatFoldAngle(90)).toBe('90°');
    expect(formatFoldAngle(-90)).toBe('-90°');
    expect(formatFoldAngle(45.5)).toBe('45.5°');
  });

  it('rounds to two decimal places', () => {
    // The angles a solve actually produces, at the width the badge shows them.
    expect(formatFoldAngle(-70.5288)).toBe('-70.53°');
    expect(formatFoldAngle(53.4588)).toBe('53.46°');
    expect(formatFoldAngle(-122.8816)).toBe('-122.88°');
    expect(formatFoldAngle(114.2369)).toBe('114.24°');
  });

  it('keeps an unfolded mountain at 0°, not -0°', () => {
    expect(formatFoldAngle(-0)).toBe('0°');
    // Rounding a sub-precision mountain must not resurrect the negative zero.
    expect(formatFoldAngle(-0.001)).toBe('0°');
  });
});
