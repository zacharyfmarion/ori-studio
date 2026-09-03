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
import type {
  OristudioCpFoldDirectionHint,
  OristudioCpLineColor,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';

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
 * The fold-direction hint codes the compact transport carries in `seg_attr`'s
 * fifth slot. The TS mirror of `fold_direction_hint_code` in
 * `crates/oristudio-cp/src/geometry_transport.rs`.
 *
 * They live here, beside the rest of the fold-state mirror, rather than in the
 * renderer that first needed them: `engine/oristudioCpGeometry.ts` decodes this
 * slot and must not import from `cp-workspace/`.
 */
export const HINT_NONE = 0;
export const HINT_MOUNTAIN = 1;
export const HINT_VALLEY = 2;

/**
 * Decode a transport hint code, or `undefined` for "no hint".
 *
 * An unrecognised code reads as no hint rather than throwing, matching
 * `fold_direction_hint_from_code` on the Rust side: this is our own format on
 * both ends, and losing a hint is the safe misreading where inventing one — a
 * crease that claims to be a decided mountain — is not.
 */
export function foldDirectionHintFromCode(
  code: number | undefined
): OristudioCpFoldDirectionHint | undefined {
  if (code === HINT_MOUNTAIN) return 'Mountain';
  if (code === HINT_VALLEY) return 'Valley';
  return undefined;
}

/** Encode a hint back to its transport code. Inverse of {@link foldDirectionHintFromCode}. */
export function foldDirectionHintCode(
  hint: OristudioCpFoldDirectionHint | undefined
): number {
  if (hint === 'Mountain') return HINT_MOUNTAIN;
  if (hint === 'Valley') return HINT_VALLEY;
  return HINT_NONE;
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

/**
 * The direction a *signed* fold angle names — the sign half of
 * {@link foldAngleFromParts}, read backwards.
 *
 * `null` at zero, which agrees with neither: a crease that does not fold has no
 * direction. Mirrors `FoldDirection::of_signed_angle` in the kernel, so the two
 * ends of the wire read a sign the same way.
 */
export function foldDirectionOfSignedAngle(
  degrees: number
): OristudioCpFoldDirectionHint | null {
  if (!Number.isFinite(degrees) || degrees === 0) return null;
  return degrees < 0 ? 'Mountain' : 'Valley';
}

/**
 * The line colour that folds `direction` — the colour half of
 * {@link foldAngleFromParts}, read backwards.
 *
 * Written here rather than at the one call site because it *is* the convention
 * this module exists to hold: `Red1` is negative and `Blue2` positive, and a
 * second copy of that mapping is exactly how a UI ends up disagreeing with the
 * badge it draws.
 */
export function creaseColorForFoldDirection(
  direction: OristudioCpFoldDirectionHint
): OristudioCpLineColor {
  return direction === 'Mountain' ? 'Red1' : 'Blue2';
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
 * Decimal places a fold-angle readout keeps.
 *
 * Two, because the readout is a badge sitting on the crease itself, competing
 * for room with its neighbours — a solver's `-70.5288°` is wider than the fact
 * it carries, and on a dense pattern the extra digits collide into
 * unreadability. The stored magnitude keeps its full precision either way; this
 * is a display width, not a rounding of the model.
 */
const DISPLAY_DECIMALS = 2;

/**
 * Format a fold angle for display, e.g. `-90°`. Trims trailing zeros, and
 * rounds to {@link DISPLAY_DECIMALS} places.
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
  const rounded = Number(degrees.toFixed(DISPLAY_DECIMALS));
  return `${rounded}°`;
}

/**
 * {@link isClassicCrease} for a magnitude on its own — a tool candidate the
 * kernel solved, which is not a segment yet. Same rule, one definition.
 */
export function isClassicMagnitude(magnitudeUnits: number | undefined): boolean {
  return magnitudeUnits === undefined || magnitudeUnits === FOLD_MAGNITUDE_FULL;
}
