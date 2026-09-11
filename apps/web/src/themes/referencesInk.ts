/**
 * How faintly the References workspace draws what is already on the paper.
 *
 * A step's card and the canvas under it draw two kinds of context: the grey of
 * an earlier crease the pattern does not hold (a grid's own lines, an auxiliary
 * fold), and the pattern's own creases made by earlier steps, in their mountain
 * and valley inks turned down. Both were one fixed alpha, tuned on a white
 * canvas — and sRGB's transfer curve is steep near black, so the same alpha
 * over a dark ground is a different picture: the grey stood twice as far from
 * a dark ground as from a light one (a lightness step of 48 L* against 25) and
 * shouted over the dimmed mountains and valleys beside it, which sat at about
 * the light theme's step and so read as fainter than they were.
 *
 * So the alphas are derived per theme from the light theme's *outcome*, as
 * `paperBack.ts` does for the paper's other side: the step in CIE lightness
 * (L*) between the drawn line and the ground is held to what the reference
 * light theme produces, and the alpha that gets there on this theme's ground
 * is what the theme carries. On a white ground that is the original tuning to
 * the byte; on a dark one the grey comes down to about half its alpha and the
 * dimmed creases come up a little, with a deliberate extra lift for dark
 * themes: a thin dashed line loses its colour near black faster than its
 * lightness says, and the step that reads right on white reads faint there.
 */
import { relativeLuminance } from './paperBack';
import { mixHexColors } from '../lib/rgbColor';

/** The grey an earlier crease draws in: `--fold-unassigned`, the same on every theme. */
export const FOLD_UNASSIGNED = '#9aa4ad';

/** The reference light theme the tuning was made on: a white ground and its inks. */
const REFERENCE_GROUND = '#ffffff';
const REFERENCE_MOUNTAIN = '#d91f3a';
const REFERENCE_VALLEY = '#2563eb';
/** The tuning itself: an earlier crease at 0.75, a dimmed pattern crease at 0.26. */
const REFERENCE_CREASE_ALPHA = 0.75;
const REFERENCE_DIM_ALPHA = 0.26;
/**
 * How much further than the light theme's step a dark theme's dimmed creases
 * are set off their ground. The metrics — L*, and OKLab's distance with chroma
 * in it — put the old alpha at parity already; the eye does not, and a fifth
 * more is what it took for a dashed mountain to read as red rather than as a
 * darker dark.
 */
const DARK_DIM_LIFT = 1.2;
/** Nothing is drawn fainter than this, whatever the ground. */
const MIN_ALPHA = 0.1;

/** CIE L* of a hex colour, from its WCAG relative luminance. */
function lightness(hex: string): number {
  const y = relativeLuminance(hex);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** The lightness step a line drawn at `alpha` in `ink` takes off `ground`. */
function step(ink: string, ground: string, alpha: number): number {
  return Math.abs(lightness(mixHexColors(ink, ground, alpha)) - lightness(ground));
}

/**
 * The alpha at which `ink` over `ground` steps `target` L* off it: the step
 * grows with alpha, so a bisection finds it; `1` when even solid ink does not
 * get there.
 */
function alphaForStep(ink: string, ground: string, target: number): number {
  if (step(ink, ground, 1) <= target) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (step(ink, ground, mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.max(MIN_ALPHA, hi);
}

const CREASE_STEP = step(FOLD_UNASSIGNED, REFERENCE_GROUND, REFERENCE_CREASE_ALPHA);
const DIM_STEP =
  (step(REFERENCE_MOUNTAIN, REFERENCE_GROUND, REFERENCE_DIM_ALPHA) +
    step(REFERENCE_VALLEY, REFERENCE_GROUND, REFERENCE_DIM_ALPHA)) /
  2;

/** The alpha an earlier crease's grey draws at on `ground`. */
export function referencesCreaseAlpha(ground: string): number {
  return alphaForStep(FOLD_UNASSIGNED, ground, CREASE_STEP);
}

/**
 * The alpha a pattern crease made by an earlier step draws at on `ground`, in
 * the theme's `mountain` and `valley` inks — one alpha for both, held to the
 * mean of their steps.
 */
export function referencesDimAlpha(
  ground: string,
  mountain: string,
  valley: string,
  themeType: 'light' | 'dark'
): number {
  const target = DIM_STEP * (themeType === 'dark' ? DARK_DIM_LIFT : 1);
  const meanStep = (alpha: number) =>
    (step(mountain, ground, alpha) + step(valley, ground, alpha)) / 2;
  if (meanStep(1) <= target) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (meanStep(mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.max(MIN_ALPHA, hi);
}
