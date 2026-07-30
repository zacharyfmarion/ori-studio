import { describe, expect, it } from 'vitest';
import {
  CP_MEASURE_ANGLE_OPERATION_ID,
  CP_MEASURE_LENGTH_OPERATION_ID,
  cpMeasureKindForOperation,
  cpMeasurePointCount,
  convertCpLength,
  interiorCpAngle,
  copyTextForCpMeasurement,
  exactCpLengthLabel,
  convertCpAngle,
  formatCpAngle,
  formatCpLength,
  formatCpMeasurement,
  isCpMeasurementOperation,
  snapExactCpAngle,
  type CpMeasureScale,
} from './measure';

describe('cpMeasureKindForOperation', () => {
  it('reads the kind off the active tool — length and angle are separate tools', () => {
    expect(cpMeasureKindForOperation(CP_MEASURE_LENGTH_OPERATION_ID)).toBe('distance');
    expect(cpMeasureKindForOperation(CP_MEASURE_ANGLE_OPERATION_ID)).toBe('angle');
    expect(cpMeasureKindForOperation('DisplayLengthBetweenPoints2')).toBe('distance');
    expect(cpMeasureKindForOperation('DisplayAngleBetweenThreePoints3')).toBe('angle');
  });

  it('is null for anything that is not a measure tool', () => {
    expect(cpMeasureKindForOperation('DrawCreaseFree')).toBeNull();
    expect(cpMeasureKindForOperation(null)).toBeNull();
  });
});

describe('cpMeasurePointCount', () => {
  it('collects 2 points for a distance and 3 for an angle', () => {
    expect(cpMeasurePointCount('distance')).toBe(2);
    expect(cpMeasurePointCount('angle')).toBe(3);
  });
});

describe('isCpMeasurementOperation', () => {
  it('is true for every upstream measure op, including the demoted ones', () => {
    expect(isCpMeasurementOperation('DisplayLengthBetweenPoints1')).toBe(true);
    expect(isCpMeasurementOperation('DisplayLengthBetweenPoints2')).toBe(true);
    expect(isCpMeasurementOperation('DisplayAngleBetweenThreePoints1')).toBe(true);
    expect(isCpMeasurementOperation('DisplayAngleBetweenThreePoints3')).toBe(true);
    expect(isCpMeasurementOperation('CreaseSelect')).toBe(false);
    expect(isCpMeasurementOperation(null)).toBe(false);
  });
});

// An Oriedita frame: paper edge 400 model units, an 8-division grid, 150 mm paper.
const SCALE: CpMeasureScale = { paperEdge: 400, gridWidth: 50, paperEdgeMm: 150 };

describe('convertCpLength', () => {
  it('reads the paper edge as 1 and the diagonal as sqrt(2)', () => {
    expect(convertCpLength(400, 'paper', SCALE)).toBe(1);
    expect(convertCpLength(Math.SQRT2 * 400, 'paper', SCALE)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('counts grid squares against the document grid', () => {
    expect(convertCpLength(400, 'grid', SCALE)).toBe(8);
    expect(convertCpLength(25, 'grid', SCALE)).toBe(0.5);
  });

  it('scales physical units off the paper edge', () => {
    expect(convertCpLength(400, 'mm', SCALE)).toBe(150);
    expect(convertCpLength(400, 'cm', SCALE)).toBe(15);
    expect(convertCpLength(400, 'in', SCALE)).toBeCloseTo(150 / 25.4, 12);
  });

  it('leaves model units alone — the value Oriedita itself displays', () => {
    expect(convertCpLength(565.685424949238, 'model', SCALE)).toBe(565.685424949238);
  });

  it('falls back rather than dividing by zero on a degenerate scale', () => {
    const degenerate: CpMeasureScale = { paperEdge: 0, gridWidth: 0, paperEdgeMm: 150 };
    expect(convertCpLength(7, 'paper', degenerate)).toBe(7);
    expect(convertCpLength(7, 'grid', degenerate)).toBe(7);
  });
});

describe('formatCpLength / formatCpAngle', () => {
  it('carries four decimals in paper units, so the diagonal is recognisable', () => {
    expect(formatCpLength(Math.SQRT1_2 * 400, 'paper', SCALE)).toBe('0.7071');
  });

  it('suffixes only the physical units', () => {
    expect(formatCpLength(400, 'mm', SCALE)).toBe('150 mm');
    expect(formatCpLength(400, 'grid', SCALE)).toBe('8');
  });

  it('reads an angle in the unit asked for, snapping in degrees either way', () => {
    expect(formatCpAngle(90)).toBe('90°');
    expect(formatCpAngle(90, 'deg')).toBe('90°');
    expect(formatCpAngle(90, 'rad')).toBe('1.5708 rad');
    expect(formatCpAngle(180, 'rad')).toBe('3.1416 rad');
    // The directed-angle fold and the exact-angle snap both apply before the
    // conversion, so a radian reading never inherits the float noise.
    expect(formatCpAngle(270, 'rad')).toBe('1.5708 rad');
    expect(formatCpAngle(89.99999999999999, 'rad')).toBe('1.5708 rad');
    expect(convertCpAngle(180, 'rad')).toBeCloseTo(Math.PI, 12);
    expect(convertCpAngle(180, 'deg')).toBe(180);
  });

  it('formats a non-finite value as a dash', () => {
    expect(formatCpLength(Number.NaN, 'paper', SCALE)).toBe('-');
    expect(formatCpAngle(Number.POSITIVE_INFINITY)).toBe('-');
  });

  it('folds the kernel\'s directed angle onto the interior one you can see', () => {
    // Oriedita's angle() is directed 0-360, so the same 90-degree corner reads 90
    // or 270 depending on pick order. Both must read 90.
    expect(interiorCpAngle(90)).toBe(90);
    expect(interiorCpAngle(270)).toBe(90);
    expect(interiorCpAngle(180)).toBe(180);
    expect(interiorCpAngle(200)).toBe(160);
    expect(interiorCpAngle(0)).toBe(0);
    expect(interiorCpAngle(-90)).toBe(90);
    expect(interiorCpAngle(405)).toBe(45);
    expect(formatCpAngle(270)).toBe('90°');
    expect(formatCpAngle(292.5)).toBe('67.5°');
  });

  it('snaps float noise onto the exact origami angle, and leaves others alone', () => {
    expect(snapExactCpAngle(44.99999999999999)).toBe(45);
    expect(snapExactCpAngle(22.500000000000004)).toBe(22.5);
    expect(snapExactCpAngle(44.9)).toBe(44.9);
    expect(formatCpAngle(89.99999999999999)).toBe('90°');
  });
});

describe('exactCpLengthLabel', () => {
  it('recognises the constants a reference construction aims at', () => {
    expect(exactCpLengthLabel(200, SCALE)).toBe('1/2');
    expect(exactCpLengthLabel(Math.SQRT1_2 * 400, SCALE)).toBe('√2/2');
    expect(exactCpLengthLabel(400 / 3, SCALE)).toBe('1/3');
    expect(exactCpLengthLabel(Math.SQRT2 * 400, SCALE)).toBe('√2');
  });

  it('stays silent for a length that is not near one', () => {
    expect(exactCpLengthLabel(173, SCALE)).toBeNull();
    expect(exactCpLengthLabel(Number.NaN, SCALE)).toBeNull();
  });
});

describe('formatCpMeasurement / copyTextForCpMeasurement', () => {
  it('formats each kind in its own terms', () => {
    expect(
      formatCpMeasurement({ kind: 'distance', value: 200, points: [] }, 'paper', SCALE)
    ).toBe('0.5');
    expect(formatCpMeasurement({ kind: 'angle', value: 45, points: [] }, 'paper', SCALE)).toBe(
      '45°'
    );
  });

  it('copies the interior angle, not the kernel\'s directed one', () => {
    expect(copyTextForCpMeasurement({ kind: 'angle', value: 270, points: [] }, 'paper', SCALE)).toBe(
      '90'
    );
  });

  it('copies an angle in the chosen angle unit', () => {
    expect(
      copyTextForCpMeasurement({ kind: 'angle', value: 180, points: [] }, 'paper', SCALE, 'rad')
    ).toBe(String(Math.PI));
  });

  it('copies the converted value at full precision, not the rounded display', () => {
    const measurement = { kind: 'distance' as const, value: Math.SQRT1_2 * 400, points: [] };
    expect(formatCpMeasurement(measurement, 'paper', SCALE)).toBe('0.7071');
    expect(copyTextForCpMeasurement(measurement, 'paper', SCALE)).toBe(String(Math.SQRT1_2));
  });
});
