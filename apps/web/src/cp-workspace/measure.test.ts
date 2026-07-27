import { describe, expect, it } from 'vitest';
import {
  CP_MEASURE_KINDS,
  CP_MEASURE_OPERATION_ID,
  cpMeasureOperationForKind,
  cpMeasurePointCount,
  cpMeasureStepKinds,
  formatCpMeasurementValue,
  isCpMeasurementOperation,
} from './measure';

describe('cpMeasureOperationForKind', () => {
  it('routes each kind to the upstream operation that computes it', () => {
    expect(cpMeasureOperationForKind('distance')).toBe('DisplayLengthBetweenPoints1');
    expect(cpMeasureOperationForKind('angle')).toBe('DisplayAngleBetweenThreePoints1');
  });

  it('activates as the length-1 operation, so one action owns the rail and shortcut', () => {
    expect(CP_MEASURE_OPERATION_ID).toBe('DisplayLengthBetweenPoints1');
    expect(cpMeasureOperationForKind('distance')).toBe(CP_MEASURE_OPERATION_ID);
  });
});

describe('cpMeasurePointCount / cpMeasureStepKinds', () => {
  it('collects 2 points for a distance and 3 for an angle', () => {
    expect(cpMeasurePointCount('distance')).toBe(2);
    expect(cpMeasurePointCount('angle')).toBe(3);
  });

  it('gives one free-point snap step per collected point', () => {
    for (const kind of CP_MEASURE_KINDS) {
      const steps = cpMeasureStepKinds(kind);
      expect(steps).toHaveLength(cpMeasurePointCount(kind));
      expect(steps.every((step) => step === 'point')).toBe(true);
    }
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

describe('formatCpMeasurementValue', () => {
  it('formats lengths to 3 dp, angles to 2 dp with a degree sign, null as a dash', () => {
    expect(formatCpMeasurementValue('distance', null)).toBe('-');
    expect(formatCpMeasurementValue('distance', 1.23456)).toBe('1.235');
    expect(formatCpMeasurementValue('angle', 44.999)).toBe('45°');
    expect(formatCpMeasurementValue('angle', null)).toBe('-');
    expect(formatCpMeasurementValue('distance', Number.NaN)).toBe('-');
  });
});
