/**
 * Fold-angle semantics — the TypeScript mirror of the kernel's
 * `crease_fold_angle` / `is_classic_crease`.
 *
 * A crease's fold state is split across two things, orthogonal by construction:
 *
 * - **direction** lives in the line colour (`Red1` = mountain = negative,
 *   `Blue2` = valley = positive), and
 * - **magnitude** (`|ρ|`) lives in `fold_magnitude`, which is absent for a
 *   classic ±180 crease.
 *
 * Splitting it this way makes a contradictory state — a mountain with a positive
 * angle — unrepresentable, and it means flipping mountain/valley negates ρ with
 * no extra work.
 *
 * **Use {@link creaseFoldAngle} rather than reading `color` to decide fold
 * semantics.** Colour alone is only half the answer.
 *
 * Sign convention is the FOLD spec's, which this repo already follows:
 * negative is mountain, positive is valley, 0 is unfolded.
 */
import type { OristudioCpLineSegment } from '../engine/oristudioCpTypes';

/** Kernel storage units per degree (`FoldMagnitude::UNITS_PER_DEGREE`). */
export const FOLD_MAGNITUDE_UNITS_PER_DEGREE = 10_000_000;

/** Transport sentinel for a classic ±180 crease (`FoldMagnitude::TRANSPORT_CLASSIC`). */
export const FOLD_MAGNITUDE_CLASSIC = 0xffffffff;

/** Full fold, in storage units. */
export const FOLD_MAGNITUDE_FULL = 180 * FOLD_MAGNITUDE_UNITS_PER_DEGREE;

export function foldMagnitudeToDegrees(units: number): number {
  return units / FOLD_MAGNITUDE_UNITS_PER_DEGREE;
}

/** `null` when `degrees` is outside `0..=180` or not finite. */
export function degreesToFoldMagnitude(degrees: number): number | null {
  if (!Number.isFinite(degrees) || degrees < 0 || degrees > 180) return null;
  return Math.round(degrees * FOLD_MAGNITUDE_UNITS_PER_DEGREE);
}

/** Whether this colour is a crease at all (as opposed to a border or aux line). */
export function isFoldingCrease(color: OristudioCpLineSegment['color']): boolean {
  return color === 'Red1' || color === 'Blue2';
}

/**
 * Signed fold angle in degrees, or `null` when the segment is not a crease.
 *
 * This is the sanctioned way to ask what a crease does.
 */
export function creaseFoldAngle(segment: OristudioCpLineSegment): number | null {
  return foldAngleFromParts(segment.color, segment.fold_magnitude);
}

/**
 * {@link creaseFoldAngle} for a crease that is not (yet) a segment — a tool's
 * candidate, whose colour and magnitude the kernel solved but which nothing has
 * committed. Same rule, so the two can never drift apart.
 */
export function foldAngleFromParts(
  color: string,
  magnitudeUnits: number | undefined
): number | null {
  if (!isFoldingCrease(color as OristudioCpLineSegment['color'])) return null;
  const magnitude = magnitudeUnits === undefined ? 180 : foldMagnitudeToDegrees(magnitudeUnits);
  return color === 'Red1' ? -magnitude : magnitude;
}

/** `|ρ|` in degrees for a crease, or `null` when the segment is not a crease. */
export function creaseFoldMagnitudeDegrees(segment: OristudioCpLineSegment): number | null {
  const angle = creaseFoldAngle(segment);
  return angle === null ? null : Math.abs(angle);
}

/**
 * Whether this segment is representable by Oriedita and the flat pipeline.
 *
 * True for a full ±180 crease, and trivially true for anything that is not a
 * crease. False only for a crease given an explicit non-180 angle — precisely
 * the set that blocks `.cp` export and the 2D folded view.
 */
export function isClassicCrease(segment: OristudioCpLineSegment): boolean {
  return isClassicMagnitude(segment.fold_magnitude);
}

/**
 * Format a fold angle for display, e.g. `-90°`. Trims trailing zeros.
 *
 * Signed, because the sign is what makes the crease colour learnable — a red
 * crease reading `-90°` teaches the convention, where an unsigned `90°` on a red
 * and a blue crease implies they are the same fold.
 *
 * An unfolded mountain formats as `0°`, not `-0°`: template coercion of `-0`
 * gives `"0"`, which is the wanted answer rather than a lucky one, since an
 * unfolded mountain and an unfolded valley are the same physical thing.
 */
export function formatFoldAngle(degrees: number): string {
  const rounded = Number(degrees.toFixed(4));
  return `${rounded}°`;
}

/**
 * {@link isClassicCrease} for a magnitude on its own — a tool candidate the
 * kernel solved, which is not a segment yet. Same rule, one definition.
 */
export function isClassicMagnitude(magnitudeUnits: number | undefined): boolean {
  return magnitudeUnits === undefined || magnitudeUnits === FOLD_MAGNITUDE_FULL;
}
