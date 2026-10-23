/**
 * The Rotate tool: the model turned round in its plane by a part of a turn —
 * 1/8, 1/4 or 1/2 — or by an exact angle, clockwise or counterclockwise. It
 * is taken in hand like any tool: the folded pane shows the model turned as
 * it will be (the session's pending step, `useFoldToolPreview`), the window
 * sets how far and which way (`rotateToolWindow`), and Enter or the window's
 * Rotate adds the turn as a step of its own; Escape puts it down.
 *
 * What it holds is the shared turn type's rotation (`lib/steps/turn`) — what a
 * Fold rotate step stores and a Diagram turn carries — so the amount chosen
 * here is the one the step, its sentence and the Diagram's glyph say.
 *
 * Pure.
 */
import {
  turnRotationOfDegrees,
  type TurnRotation,
} from '../../../lib/steps/turn';
import type { FoldRotateOp } from '../../document/foldSequenceDocument';

/** Where the tool starts: a quarter turn clockwise, as the rotation the rail added at once used to be. */
export const FOLD_ROTATION_DEFAULT: TurnRotation = { amount: 'quarter', direction: 'cw' };

/** How far the angle field's arrows and its − / + step it: a twenty-fourth of a turn. */
export const FOLD_ROTATE_DEGREES_STEP = 15;

/** The step the tool adds. */
export function rotateStepOp(rotation: TurnRotation): FoldRotateOp {
  return { kind: 'rotate', rotate: rotation };
}

/**
 * The rotation with an exact angle typed into the window's field: turned the
 * way the direction chosen says, normalised (`turnRotationOfDegrees`) — a
 * negative angle turns the other way, one past a half turn is the rest of the
 * turn the other way, a preset's angle is that preset. Null when the field
 * names no rotation: not a number, or no turn at all (0, a whole turn).
 */
export function rotationWithDegrees(rotation: TurnRotation, typed: number): TurnRotation | null {
  return turnRotationOfDegrees(typed, rotation.direction);
}

/** Whether the angle field takes a number: one that names a rotation. Any other leaves the field as it was. */
export function acceptsRotationDegrees(typed: number): boolean {
  return turnRotationOfDegrees(typed, 'cw') !== null;
}

/**
 * How far a rotation turns, as `fold step added` buckets it: its preset, or
 * `other` for an exact angle — never the angle itself.
 */
export type FoldRotationBucket = 'eighth' | 'quarter' | 'half' | 'other';

export function rotationBucket(rotation: TurnRotation): FoldRotationBucket {
  return rotation.amount === 'degrees' ? 'other' : rotation.amount;
}
