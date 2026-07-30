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
 * only.
 */
import type { Rgba } from '../renderer/types';
import { FOLD_MAGNITUDE_FULL } from '../../lib/foldAngle';

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
  anchor: Rgba
): Rgba {
  if (magnitudeUnits === undefined || magnitudeUnits >= FOLD_MAGNITUDE_FULL) return ink;
  const t = Math.max(0, Math.min(1, magnitudeUnits / FOLD_MAGNITUDE_FULL));
  const mix = 1 - t;
  return [
    ink[0] + (anchor[0] - ink[0]) * mix,
    ink[1] + (anchor[1] - ink[1]) * mix,
    ink[2] + (anchor[2] - ink[2]) * mix,
    ink[3],
  ];
}
