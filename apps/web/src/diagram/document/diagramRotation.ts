/**
 * A Diagram rotation's angle of the author's own (Custom): the range the
 * Angle field takes, and the one way a rotation becomes such an angle. The
 * rotation itself is the shared turn type's (`lib/steps/turn`), which also
 * changes its preset (`withTurnPreset`) and its direction
 * (`withTurnDirection`), so a preset is always written as every build has
 * written one and the two shapes never mix.
 *
 * Unlike Fold's Rotate tool, an angle here is printed as typed: 270°
 * clockwise stays so, and 90° stays an angle rather than becoming 1/4.
 *
 * Pure: no DOM, no store.
 */
import { TURN_PRESET_DEGREES } from '../../lib/steps/turn';
import type { DiagramRotation } from './diagramDocument';

/**
 * The angles a rotation of the author's own can be given, in degrees: more
 * than none and less than a whole turn, to a tenth. The Angle field's stepper
 * moves a whole degree.
 */
export const ROTATION_DEGREES = { min: 0.1, max: 359.9, step: 1 } as const;

/** An angle a rotation can be given: `value` to a tenth of a degree, within (0°, 360°). */
export function rotationDegrees(value: number): number {
  const tenth = Math.round(value * 10) / 10;
  if (!Number.isFinite(tenth)) return TURN_PRESET_DEGREES.quarter;
  return Math.min(ROTATION_DEGREES.max, Math.max(ROTATION_DEGREES.min, tenth));
}

/** Whether a rotation is an angle of the author's own rather than a preset. */
export function isCustomRotation(rotation: DiagramRotation): rotation is Extract<DiagramRotation, { amount: 'degrees' }> {
  return rotation.amount === 'degrees';
}

/** The rotation as an angle of its own, kept within what one may be given; any preset it was dropped. */
export function withRotationDegrees(rotation: DiagramRotation, degrees: number): DiagramRotation {
  return { amount: 'degrees', degrees: rotationDegrees(degrees), direction: rotation.direction };
}
