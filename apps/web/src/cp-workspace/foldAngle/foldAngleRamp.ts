/**
 * How a non-180 fold angle changes a crease's ink.
 *
 * A shallower crease shifts its hue toward a shared anchor: red mountains run
 * toward magenta, blue valleys toward violet. Hue is the one channel a 1px line
 * carries well, and this is a **hue rotation at roughly constant lightness** —
 * which is the whole difference from the wash ramp it replaces.
 *
 * # Why not the obvious answers
 *
 * The first attempt washed each crease toward the canvas. It failed twice over:
 * too quiet to read as "this angle is different", yet strong enough that a
 * third of a pattern looked *thinner*, because a hairline loses apparent weight
 * before it loses apparent lightness. Anything that spends luminance is out.
 *
 * A red→yellow→blue ramp is the intuitive diverging choice and is wrong for
 * valleys specifically: blue and yellow are near-complementary, so the path
 * crosses the neutral axis. A 135° valley lands at Lab chroma 17 — grey, and
 * within ΔE 11 of the `unassigned` line colour. White fails the same way on both
 * halves. Magenta is the only anchor where red→anchor and blue→anchor both take
 * the *short* way round the wheel, so neither half desaturates.
 *
 * # The ramp converges, on purpose
 *
 * At 0° both halves reach the anchor and become the same colour. That is
 * correct rather than a limitation: a mountain at 0° and a valley at 0° are the
 * same physical thing — an unfolded crease — so they should look the same.
 *
 * The storage layer *does* keep `Red1+0` and `Blue2+0` distinct, but that is a
 * different question. It preserves the direction the user chose so the crease
 * remembers which way to go when the angle is dialled back up. The canvas shows
 * what the pattern *is*, not what it might become.
 *
 * Separation degrades smoothly and stays useful across the range that carries
 * real folds — ΔE 102 at 180°, 51 at 90°, 26 at 45° — and only collapses below
 * about 20°, where the two creases genuinely are near-identical.
 *
 * This is unconditional — there is no view in which a non-180 crease is allowed
 * to look like a full fold. The View panel's toggle governs the numeric badges
 * only, and its display dropdown chooses *which* channel carries the angle, not
 * whether one does. See {@link foldAngleInk}.
 */
import type { Rgba } from '../renderer/types';
import { FOLD_MAGNITUDE_FULL } from '../../lib/foldAngle';
import type { OristudioCpFoldAngleDisplay } from '../../lib/creasePatternViewport';

/**
 * Blend `ink` toward `anchor` according to a stored fold magnitude.
 *
 * `undefined` is a classic crease and returns `ink` **by identity**, so the
 * common path allocates nothing and a document with no fold angles renders
 * byte-identically to before this feature existed.
 */
export function applyFoldAngleRamp(
  ink: Rgba,
  magnitudeUnits: number | undefined,
  anchor: Rgba,
): Rgba {
  const fraction = nonClassicFoldFraction(magnitudeUnits);
  if (fraction === null) return ink;
  const mix = 1 - fraction;
  return [
    ink[0] + (anchor[0] - ink[0]) * mix,
    ink[1] + (anchor[1] - ink[1]) * mix,
    ink[2] + (anchor[2] - ink[2]) * mix,
    ink[3],
  ];
}

/**
 * Alpha a crease fades to at |ρ| = 0, and the alpha *any* non-180 crease starts
 * from.
 *
 * The gap between {@link FOLD_ANGLE_MAX_OPACITY} and full opacity is the point:
 * a linear ramp down from 1.0 puts 135° at α 0.87, which is invisible on a
 * hairline. Stepping down the moment a crease stops being a full fold makes
 * "this is not flat" categorical, and the ramp within says how shallow — the
 * same two-part shape the midpoint badge uses (classic creases never get one).
 *
 * The floor is set so a near-flat crease reads as *faint*, matching how little
 * a few degrees of fold actually shows in the folded model. It is the weaker
 * half of a deliberate trade: the canvas is an editing surface, so a 5° crease
 * still has to be findable when you go looking for it. Hit-testing is what makes
 * that affordable — it is geometric, so a crease stays selectable at full
 * hit-radius no matter how faint its ink.
 *
 * "Perceptible on every canvas" is therefore the bar, not "clearly visible". The
 * floor used to be 0.4, which cleared that bar so comfortably that the whole
 * 0–45° band collapsed into ten points of alpha and nothing down there looked
 * shallow.
 *
 * Both numbers are measured, not picked, against every bundled theme canvas
 * (`foldAngleOpacity.test.ts`):
 *
 * - at the floor a crease keeps ≥15% of its full-opacity Lab ΔE from the canvas,
 *   and ≥10 ΔE absolute — worst case 15.9% / 11.1, on `cobalt2` and
 *   `catppuccin-latte` respectively. ΔE 11 is roughly 5× the ~2.3 just-noticeable
 *   difference, so the floor is quiet rather than borderline;
 * - the classic→ceiling step is ≥8 ΔE everywhere — worst case 11.0, on
 *   `gruvbox-light`.
 *
 * ΔE rather than WCAG contrast ratio, for a concrete reason: on light themes a
 * *fully opaque* valley is only 2.25:1, so any absolute contrast bar worth
 * having is unreachable before alpha is even involved. Contrast ratio is also
 * super-linear on dark canvases, which ranks a dark theme as the worst case when
 * perceptually it is the roomiest. ΔE is the yardstick the hue ramp's own tests
 * already use.
 */
export const FOLD_ANGLE_MIN_OPACITY = 0.2;
/** Alpha at |ρ| just under 180°. See {@link FOLD_ANGLE_MIN_OPACITY}. */
export const FOLD_ANGLE_MAX_OPACITY = 0.8;

/**
 * Fade `ink` according to a stored fold magnitude, leaving **RGB untouched**.
 *
 * The mirror of {@link applyFoldAngleRamp}: one function per channel, each
 * pinned by a test to stay in its own. That separation is what keeps the two
 * modes genuine alternatives rather than a blend — `opacity` exists so that
 * `Red1` reads as plain mountain red at 20° the way it does at 180°.
 *
 * Classic creases return `ink` **by identity**, same as the hue ramp.
 */
export function applyFoldAngleOpacity(ink: Rgba, magnitudeUnits: number | undefined): Rgba {
  const fraction = nonClassicFoldFraction(magnitudeUnits);
  if (fraction === null) return ink;
  const scale =
    FOLD_ANGLE_MIN_OPACITY + (FOLD_ANGLE_MAX_OPACITY - FOLD_ANGLE_MIN_OPACITY) * fraction;
  // Multiply rather than assign, so an ink that already carries alpha composes
  // instead of being overridden. Every crease ink is opaque today.
  return [ink[0], ink[1], ink[2], ink[3] * scale];
}

/**
 * Resolve a crease's ink for the active display mode — the one entry point the
 * stroke builders call.
 *
 * An unrecognised `display` falls through to the default mode rather than
 * throwing or rendering flat. `.osf` casts `viewState.viewport` without
 * validating it (`nativeProjectFile.ts`), so an unknown string is reachable from
 * a file, and the one thing that must never happen is a non-180 crease rendering
 * as a full fold. The `default:` arm is pinned to the declared default mode by
 * test, so changing that constant cannot silently leave this behind.
 */
export function foldAngleInk(
  ink: Rgba,
  magnitudeUnits: number | undefined,
  options: { display: OristudioCpFoldAngleDisplay; anchor: Rgba },
): Rgba {
  switch (options.display) {
    case 'opacity':
      return applyFoldAngleOpacity(ink, magnitudeUnits);
    case 'color':
    default:
      return applyFoldAngleRamp(ink, magnitudeUnits, options.anchor);
  }
}

/**
 * |ρ| as a 0..1 fraction of a full fold, or `null` for a classic crease —
 * `undefined` or ≥180°, which every mode returns by identity.
 */
function nonClassicFoldFraction(magnitudeUnits: number | undefined): number | null {
  if (magnitudeUnits === undefined || magnitudeUnits >= FOLD_MAGNITUDE_FULL) return null;
  return Math.max(0, magnitudeUnits / FOLD_MAGNITUDE_FULL);
}
