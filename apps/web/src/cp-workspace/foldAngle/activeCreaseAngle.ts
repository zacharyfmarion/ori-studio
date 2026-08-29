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
import {
  degreesToFoldMagnitude,
  foldAngleFromParts,
  foldDirectionOfSignedAngle,
} from '../../lib/foldAngle';
import type { OristudioCpFoldDirectionHint } from '../../engine/oristudioCpTypes';

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
 *
 * A *magnitude*, so unsigned. A typed `-45` is split by {@link parseCreaseAngle}
 * before it reaches here.
 */
export function isValidCreaseAngle(degrees: number): boolean {
  return Number.isFinite(degrees) && degrees >= 0 && degrees <= 180;
}

/** A typed angle, split into the two things a crease's fold state is made of. */
export interface ParsedCreaseAngle {
  /** `|ρ|` in degrees, `0..=180`. */
  degrees: number;
  /**
   * The direction the sign named, or `null` when the entry carried no sign.
   *
   * **Only an explicit sign decides a direction**, which is the whole reason
   * this is nullable rather than defaulting to valley for a bare `45`. Reading
   * "no sign" as positive would mean every keystroke that sets an angle also
   * flips you to valley, so there would be no way to change the angle while
   * staying on mountain — the common case by far.
   */
  direction: OristudioCpFoldDirectionHint | null;
}

/**
 * Parse a typed angle into its magnitude and, when signed, its direction.
 *
 * `-45` is "a 45° mountain" and `+45` is "a 45° valley", following the sign
 * convention the rest of the app already reads — see
 * {@link foldDirectionOfSignedAngle}, and the badges, which draw a mountain as
 * `-45°`. So what you type is what the crease will be labelled.
 *
 * `null` for anything unusable. Blank is `null` rather than a default: a field
 * the user has emptied has not told us anything, and guessing 180 for it would
 * silently discard a pen they had set. The caller reverts to the live value.
 */
export function parseCreaseAngle(input: string): ParsedCreaseAngle | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;

  const degrees = Math.abs(parsed);
  if (!isValidCreaseAngle(degrees)) return null;

  // The *text* decides whether a direction was stated, not the number: `-0`
  // parses to a signless zero, and `Math.sign` cannot tell a typed `45` from a
  // typed `+45` at all.
  const signed = trimmed.startsWith('-') || trimmed.startsWith('+');
  return { degrees, direction: signed ? foldDirectionOfSignedAngle(parsed) : null };
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
 * The pen as a signed angle — what the crease drawn next would be badged — or
 * `null` when the active line type cannot fold at all.
 *
 * Through `foldAngleFromParts`, the function that already answers "what angle
 * does this colour and magnitude mean", rather than a second reading of the
 * sign convention. So the field, the crease it draws and the badge on that
 * crease cannot disagree about which way `-45` points.
 */
export function signedCreaseAngle(degrees: number, lineColor: string): number | null {
  const units = degreesToFoldMagnitude(degrees);
  if (units === null) return null;
  return foldAngleFromParts(lineColor, units);
}

/**
 * The pen as it appears on the toolbar, e.g. `-90°` while drawing mountains.
 *
 * Signed when `lineColor` names a crease, because the sign is half of what the
 * pen sets and is now something you can type: a field that accepts `-45` and
 * then displays `45` has quietly dropped the more surprising half of the entry.
 * Unsigned without a colour, and on a line type that cannot fold — an edge has
 * no direction to show.
 */
export function formatCreaseAngle(degrees: number, lineColor?: string): string {
  return `${formatCreaseAngleValue(degrees, lineColor)}°`;
}

/** The same number without its degree sign, for the field while it is edited. */
export function formatCreaseAngleValue(degrees: number, lineColor?: string): string {
  const signed = lineColor === undefined ? null : signedCreaseAngle(degrees, lineColor);
  return `${Number((signed ?? degrees).toFixed(DISPLAY_DECIMALS))}`;
}
