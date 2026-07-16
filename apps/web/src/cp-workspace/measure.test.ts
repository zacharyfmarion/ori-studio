import { describe, expect, it } from 'vitest';
import {
  CP_MEASUREMENT_SLOT_ORDER,
  cpMeasurementSlotForOperation,
  createEmptyCpMeasurementSlots,
  formatCpMeasurementValue,
  isCpMeasurementOperation,
} from './measure';

describe('cpMeasurementSlotForOperation', () => {
  it('maps the five measure ops to their slots, others to null', () => {
    expect(cpMeasurementSlotForOperation('DisplayLengthBetweenPoints1')).toBe('length1');
    expect(cpMeasurementSlotForOperation('DisplayLengthBetweenPoints2')).toBe('length2');
    expect(cpMeasurementSlotForOperation('DisplayAngleBetweenThreePoints1')).toBe('angle1');
    expect(cpMeasurementSlotForOperation('DisplayAngleBetweenThreePoints2')).toBe('angle2');
    expect(cpMeasurementSlotForOperation('DisplayAngleBetweenThreePoints3')).toBe('angle3');
    expect(cpMeasurementSlotForOperation('DrawCreaseFree')).toBeNull();
    expect(cpMeasurementSlotForOperation(null)).toBeNull();
  });

  it('every mapped slot is in the display order', () => {
    for (const slot of CP_MEASUREMENT_SLOT_ORDER) {
      expect(createEmptyCpMeasurementSlots()[slot]).toBeNull();
    }
    expect(CP_MEASUREMENT_SLOT_ORDER).toHaveLength(5);
  });
});

describe('isCpMeasurementOperation', () => {
  it('is true only for the measure ops', () => {
    expect(isCpMeasurementOperation('DisplayAngleBetweenThreePoints1')).toBe(true);
    expect(isCpMeasurementOperation('CreaseSelect')).toBe(false);
  });
});

describe('formatCpMeasurementValue', () => {
  it('formats lengths to 3 dp, angles to 2 dp with a deg unit, null as a dash', () => {
    expect(formatCpMeasurementValue('length1', null)).toBe('-');
    expect(formatCpMeasurementValue('length1', 1.23456)).toBe('1.235');
    expect(formatCpMeasurementValue('angle1', 44.999)).toBe('45 deg');
    expect(formatCpMeasurementValue('angle2', null)).toBe('-');
  });
});
