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


/* ---------------------------------------------------------------------------
 * Units
 *
 * Kernel values are Oriedita model units: the paper frame spans
 * (-200,-200)–(200,200), so the paper edge is 400 and the square's diagonal
 * reads 565.685. Upstream displays exactly that, at full double precision. We
 * keep the *value* at parity and convert only for display, defaulting to a
 * fraction of the paper edge — the reading origami instructions actually use.
 * ------------------------------------------------------------------------- */

export type CpMeasureUnit = 'paper' | 'grid' | 'mm' | 'cm' | 'in' | 'model';

export const CP_MEASURE_UNITS: readonly CpMeasureUnit[] = ['paper', 'grid', 'mm', 'cm', 'in', 'model'];

/** Units that need a physical paper size to mean anything. */
export function cpMeasureUnitIsPhysical(unit: CpMeasureUnit): boolean {
  return unit === 'mm' || unit === 'cm' || unit === 'in';
}

/** What one model unit is worth, for the document being measured. */
export interface CpMeasureScale {
  /** Model-space length of one paper edge (400 for an Oriedita frame). */
  paperEdge: number;
  /** Model-space width of one grid square. */
  gridWidth: number;
  /** Physical length of the paper edge, in millimetres. */
  paperEdgeMm: number;
}

export const DEFAULT_CP_MEASURE_PAPER_EDGE_MM = 150;

const MM_PER_INCH = 25.4;

export function convertCpLength(
  modelValue: number,
  unit: CpMeasureUnit,
  scale: CpMeasureScale
): number {
  const paperEdge = scale.paperEdge > 0 ? scale.paperEdge : 1;
  switch (unit) {
    case 'paper':
      return modelValue / paperEdge;
    case 'grid':
      return scale.gridWidth > 0 ? modelValue / scale.gridWidth : modelValue;
    case 'mm':
      return (modelValue / paperEdge) * scale.paperEdgeMm;
    case 'cm':
      return ((modelValue / paperEdge) * scale.paperEdgeMm) / 10;
    case 'in':
      return ((modelValue / paperEdge) * scale.paperEdgeMm) / MM_PER_INCH;
    case 'model':
      return modelValue;
  }
}

/**
 * Decimals a unit reads well at. Paper fractions carry four (0.7071 is the
 * recognisable diagonal); physical and model units carry fewer, since their
 * numbers are already large.
 */
function precisionForUnit(unit: CpMeasureUnit): number {
  switch (unit) {
    case 'paper':
      return 4;
    case 'grid':
      return 3;
    case 'in':
      return 3;
    case 'mm':
    case 'cm':
      return 2;
    case 'model':
      return 3;
  }
}

/** Suffix after the number. Physical units carry theirs; the rest are named by the unit control. */
function suffixForUnit(unit: CpMeasureUnit): string {
  return cpMeasureUnitIsPhysical(unit) ? ` ${unit}` : '';
}

export function formatCpLength(
  modelValue: number,
  unit: CpMeasureUnit,
  scale: CpMeasureScale
): string {
  if (!Number.isFinite(modelValue)) return '-';
  const converted = convertCpLength(modelValue, unit, scale);
  return `${formatNumber(converted, precisionForUnit(unit))}${suffixForUnit(unit)}`;
}

/**
 * Common origami angles. A kernel angle lands a float-epsilon away from these
 * (44.99999999999999 for a folded diagonal), so snap the *display* onto the exact
 * value rather than showing the noise. It never snaps a genuinely different angle:
 * the window is far tighter than any angle a user could place by hand.
 */
const EXACT_ANGLES = [
  15, 22.5, 30, 36, 45, 60, 67.5, 72, 75, 90, 105, 112.5, 120, 135, 150, 157.5, 180,
];
const ANGLE_EPSILON = 1e-6;

export function snapExactCpAngle(degrees: number): number {
  for (const exact of EXACT_ANGLES) {
    if (Math.abs(degrees - exact) <= ANGLE_EPSILON) return exact;
  }
  return degrees;
}

export function formatCpAngle(degrees: number): string {
  if (!Number.isFinite(degrees)) return '-';
  return `${formatNumber(snapExactCpAngle(degrees), 2)}°`;
}

/**
 * Exact forms worth recognising in *paper* units — the lengths a reference-point
 * construction is actually aiming at. Shown as a secondary note ("≈ √2/2") so the
 * number stays the source of truth and the label is a hint, never a claim of
 * exactness beyond the tolerance.
 */
const EXACT_PAPER_LENGTHS: readonly { label: string; value: number }[] = [
  { label: '1/8', value: 1 / 8 },
  { label: '1/6', value: 1 / 6 },
  { label: '1/5', value: 1 / 5 },
  { label: '1/4', value: 1 / 4 },
  { label: '1/3', value: 1 / 3 },
  { label: '3/8', value: 3 / 8 },
  { label: '2/5', value: 2 / 5 },
  { label: '1/2', value: 1 / 2 },
  { label: '√2/2', value: Math.SQRT1_2 },
  { label: '3/5', value: 3 / 5 },
  { label: '5/8', value: 5 / 8 },
  { label: '2/3', value: 2 / 3 },
  { label: '3/4', value: 3 / 4 },
  { label: '√3/2', value: Math.sqrt(3) / 2 },
  { label: '4/5', value: 4 / 5 },
  { label: '7/8', value: 7 / 8 },
  { label: '1', value: 1 },
  { label: '5/4', value: 5 / 4 },
  { label: '√2', value: Math.SQRT2 },
  { label: '3/2', value: 3 / 2 },
  { label: '√3', value: Math.sqrt(3) },
  { label: '2', value: 2 },
  { label: '√5', value: Math.sqrt(5) },
  { label: '2√2', value: 2 * Math.SQRT2 },
];

const EXACT_LENGTH_TOLERANCE = 5e-5;

/** The exact form this length is within tolerance of, in paper units, or null. */
export function exactCpLengthLabel(modelValue: number, scale: CpMeasureScale): string | null {
  if (!Number.isFinite(modelValue)) return null;
  const paper = convertCpLength(modelValue, 'paper', scale);
  for (const candidate of EXACT_PAPER_LENGTHS) {
    if (Math.abs(paper - candidate.value) <= EXACT_LENGTH_TOLERANCE) return candidate.label;
  }
  return null;
}

/** The unit-aware display string for a measurement. */
export function formatCpMeasurement(
  measurement: CpMeasurement,
  unit: CpMeasureUnit,
  scale: CpMeasureScale
): string {
  return measurement.kind === 'angle'
    ? formatCpAngle(measurement.value)
    : formatCpLength(measurement.value, unit, scale);
}

/**
 * What lands on the clipboard: the converted value at full precision, unrounded,
 * so a measurement can be pasted into a numeric field without losing anything the
 * display rounded away.
 */
export function copyTextForCpMeasurement(
  measurement: CpMeasurement,
  unit: CpMeasureUnit,
  scale: CpMeasureScale
): string {
  return measurement.kind === 'angle'
    ? String(snapExactCpAngle(measurement.value))
    : String(convertCpLength(measurement.value, unit, scale));
}
