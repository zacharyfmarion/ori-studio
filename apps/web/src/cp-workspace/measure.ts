import { formatNumber } from '../lib/geometry';
import type { OristudioCpOperationId } from '../lib/oristudioCpCommands';

/**
 * The measure tool's model.
 *
 * Upstream Oriedita ships *five* measure tools (`l1`, `l2`, `a1`, `a2`, `a3`) whose
 * only difference is which of five `MeasuresModel` registers they write to. That is
 * a storage detail, and putting it in the tool rail forces the user to pick a
 * register before they can ask a question. Ori Studio exposes **one** Measure tool
 * whose *kind* (distance / angle) is a tool option; the five upstream operations
 * stay in the kernel and command registry for parity, with `l1`/`a1` doing the work.
 *
 * Values always come from the **kernel** (`preview.measurement`, exact Oriedita
 * parity). This module owns kind ↔ operation mapping and formatting only; picks are
 * resolved to points frontend-side, exactly as every other point-sequence tool does.
 *
 * See implementation-plans/measure-system-redesign.md.
 */

/** What the measure tool is currently measuring. */
export type CpMeasureKind = 'distance' | 'angle';

export const CP_MEASURE_KINDS: readonly CpMeasureKind[] = ['distance', 'angle'];

/**
 * The operation the Measure tool is activated as, and therefore its rail button,
 * shortcut (`Shift+M`), and upstream identity (`l1Action`).
 */
export const CP_MEASURE_OPERATION_ID = 'DisplayLengthBetweenPoints1' satisfies OristudioCpOperationId;

/** Every operation that measures rather than mutates. */
const CP_MEASUREMENT_OPERATION_IDS: readonly OristudioCpOperationId[] = [
  'DisplayLengthBetweenPoints1',
  'DisplayLengthBetweenPoints2',
  'DisplayAngleBetweenThreePoints1',
  'DisplayAngleBetweenThreePoints2',
  'DisplayAngleBetweenThreePoints3',
];

/**
 * The kernel operation that computes a given kind. The tool is always *activated*
 * as {@link CP_MEASURE_OPERATION_ID}; only the preview/commit request switches, so
 * the rail highlight and tool state stay on one action.
 */
export function cpMeasureOperationForKind(kind: CpMeasureKind): OristudioCpOperationId {
  return kind === 'angle' ? 'DisplayAngleBetweenThreePoints1' : 'DisplayLengthBetweenPoints1';
}

/** Points a kind collects before it can be measured. */
export function cpMeasurePointCount(kind: CpMeasureKind): number {
  return kind === 'angle' ? 3 : 2;
}

/** Per-step snap kinds for the canvas sequence engine (all free-point steps). */
export function cpMeasureStepKinds(kind: CpMeasureKind): ('point' | 'crease' | 'candidate')[] {
  return Array.from({ length: cpMeasurePointCount(kind) }, () => 'point' as const);
}

export function isCpMeasurementOperation(
  operationId: OristudioCpOperationId | null | undefined
): boolean {
  return operationId != null && CP_MEASUREMENT_OPERATION_IDS.includes(operationId);
}

/** A measurement the tool has taken, live for the duration of the tool session. */
export interface CpMeasurement {
  kind: CpMeasureKind;
  /** Kernel-computed length (model units) or angle (degrees). */
  value: number;
  /** The points it was taken from — 2 for a distance, 3 (rays about [1]) for an angle. */
  points: readonly { x: number; y: number }[];
}

export function formatCpMeasurementValue(kind: CpMeasureKind, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return kind === 'angle'
    ? `${formatNumber(value, 2)}°`
    : formatNumber(value, 3);
}
