/**
 * The active crease angle — the `|ρ|` a newly drawn mountain or valley inherits.
 *
 * The pen half of the fold-angle model, and the sibling of the selection-scoped
 * verbs in `foldAngleActions.ts`: that file answers "set this on what I have
 * selected", this one answers "give this to what I draw next". Both are about a
 * magnitude only — direction stays in the line colour, so the pen never has to
 * know whether the user is drawing a mountain or a valley.
 *
 * React-free and store-free (AGENTS.md > "Panel components"): the toolbar field,
 * the popover, the payload builder and the tool-preview ink all resolve through
 * here, so none of them has to agree on the valid range or the classic
 * normalisation by hand.
 */
import { degreesToFoldMagnitude } from '../../lib/foldAngle';

/**
 * The pen at rest.
 *
 * 180 rather than "unset", because a crease *has* a fold angle whether or not
 * anyone chose one, and a full fold is what every existing document and every
 * upstream tool means by a crease. Starting anywhere else would silently change
 * what drawing does for someone who never opens this control.
 */
export const DEFAULT_CREASE_ANGLE_DEGREES = 180;

/**
 * Whether `degrees` is a fold magnitude the kernel will accept.
 *
 * The same `0..=180` the kernel enforces in `FoldMagnitude::from_degrees`.
 * Stated here as well, rather than relying on the round trip, so the field can
 * refuse an entry before it becomes a command — a rejected command surfaces as
 * a failed draw, which reads as a broken tool rather than a bad number.
 */
export function isValidCreaseAngle(degrees: number): boolean {
  return Number.isFinite(degrees) && degrees >= 0 && degrees <= 180;
}

/**
 * Parse a typed angle, or `null` when it is not one.
 *
 * Blank is `null` rather than a default: a field the user has emptied has not
 * told us anything, and guessing 180 for it would silently discard a pen they
 * had set. The caller reverts to the live value instead.
 */
export function parseCreaseAngle(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return isValidCreaseAngle(parsed) ? parsed : null;
}

/**
 * The payload value for `active_fold_magnitude_degrees`, or `undefined` to omit
 * the field.
 *
 * 180 is omitted rather than sent. The kernel normalises a full fold to
 * "classic" anyway, so the two are the same state — but omitting it keeps the
 * payload of an ordinary classic draw byte-identical to what it was before the
 * pen existed, which is what makes this feature invisible until it is used.
 */
export function creaseAnglePayloadDegrees(degrees: number): number | undefined {
  if (!isValidCreaseAngle(degrees)) return undefined;
  return degrees === DEFAULT_CREASE_ANGLE_DEGREES ? undefined : degrees;
}

/** Whether the pen is at a full fold, and so changes nothing about drawing. */
export function isClassicCreaseAngle(degrees: number): boolean {
  return creaseAnglePayloadDegrees(degrees) === undefined;
}

/**
 * The pen in the kernel's storage units, for `foldAngleInk` — or `undefined`
 * for a classic crease, which every display mode returns by identity.
 *
 * Defined *through* {@link creaseAnglePayloadDegrees} rather than beside it, and
 * that is the whole point: the tool preview shades a fold exactly when the
 * command payload sends one. Two independent expressions of "is the pen doing
 * anything" is how a preview and its commit drift apart, which is the bug this
 * is here to prevent rather than a style preference.
 */
export function creaseAnglePreviewMagnitude(degrees: number): number | undefined {
  const payload = creaseAnglePayloadDegrees(degrees);
  if (payload === undefined) return undefined;
  return degreesToFoldMagnitude(payload) ?? undefined;
}

/** Decimal places a crease-angle readout keeps. Matches `formatFoldAngle`. */
const DISPLAY_DECIMALS = 2;

/**
 * The pen as it appears on the toolbar, e.g. `90°`.
 *
 * Unsigned, unlike `formatFoldAngle`, and that difference is deliberate: a
 * *crease's* angle is signed because the sign is what makes the colour
 * learnable, while the pen has no direction to show — the same 90 draws a
 * mountain or a valley depending on the active line type beside it.
 */
export function formatCreaseAngle(degrees: number): string {
  return `${formatCreaseAngleValue(degrees)}°`;
}

/** The same number without its degree sign, for the field while it is edited. */
export function formatCreaseAngleValue(degrees: number): string {
  return `${Number(degrees.toFixed(DISPLAY_DECIMALS))}`;
}
