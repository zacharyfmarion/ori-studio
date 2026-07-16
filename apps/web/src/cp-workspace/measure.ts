import { formatNumber } from '../lib/geometry';
import type { OristudioCpCommandDefinition } from '../lib/oristudioCpCommands';

/**
 * Measure-tool slots: the five display values (2 lengths + 3 angles) the measure tools
 * surface into the bottom-right panel. The values themselves come from the **kernel**
 * (`preview.measurement`, exact Oriedita parity) on the WebGL surface — this module is
 * just the slot mapping/formatting. Extracted from `CreasePatternPanel` (Phase 8
 * decompose).
 *
 * (The frontend recompute `computeCpMeasurementValue` is the SVG-only path and is not
 * here — it dies with the SVG surface.)
 */
export type CpMeasurementSlotId = 'length1' | 'length2' | 'angle1' | 'angle2' | 'angle3';
export type CpMeasurementSlots = Record<CpMeasurementSlotId, number | null>;

export const CP_MEASUREMENT_SLOT_LABELS: Record<CpMeasurementSlotId, string> = {
  length1: 'L1',
  length2: 'L2',
  angle1: 'A1',
  angle2: 'A2',
  angle3: 'A3',
};

export const CP_MEASUREMENT_SLOT_ORDER: readonly CpMeasurementSlotId[] = [
  'length1',
  'length2',
  'angle1',
  'angle2',
  'angle3',
];

export function createEmptyCpMeasurementSlots(): CpMeasurementSlots {
  return {
    length1: null,
    length2: null,
    angle1: null,
    angle2: null,
    angle3: null,
  };
}

export function cpMeasurementSlotForOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): CpMeasurementSlotId | null {
  switch (operationId) {
    case 'DisplayLengthBetweenPoints1':
      return 'length1';
    case 'DisplayLengthBetweenPoints2':
      return 'length2';
    case 'DisplayAngleBetweenThreePoints1':
      return 'angle1';
    case 'DisplayAngleBetweenThreePoints2':
      return 'angle2';
    case 'DisplayAngleBetweenThreePoints3':
      return 'angle3';
    default:
      return null;
  }
}

export function isCpMeasurementOperation(
  operationId: OristudioCpCommandDefinition['operationId'] | null | undefined
): boolean {
  return cpMeasurementSlotForOperation(operationId) !== null;
}

export function formatCpMeasurementValue(slot: CpMeasurementSlotId, value: number | null): string {
  if (value === null) return '-';
  const precision = slot.startsWith('angle') ? 2 : 3;
  const unit = slot.startsWith('angle') ? ' deg' : '';
  return `${formatNumber(value, precision)}${unit}`;
}
