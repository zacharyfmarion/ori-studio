/**
 * How faintly the References workspace draws what is already on the paper.
 *
 * A step's card and the canvas under it draw an earlier crease the step does
 * not make — a crease an earlier step made, a grid's own lines, an auxiliary
 * fold — in a grey held back from the surface. That was one fixed alpha, tuned
 * on a white canvas — and sRGB's transfer curve is steep near black, so the
 * same alpha over a dark ground is a different picture: the grey stood twice
 * as far from a dark ground as from a light one (a lightness step of 48 L*
 * against 25).
 *
 * So the alpha is derived from the light theme's *outcome*, as `paperBack.ts`
 * does for the paper's other side: the step in CIE lightness (L*) between the
 * drawn line and the surface under it is held to what the reference light
 * theme produces, and the alpha that gets there on this surface is what is
 * carried. On white that is the original tuning to the byte; on a dark
 * surface the grey comes down to about half its alpha.
 *
 * The surface is whatever the line is drawn on. On `:root` the theme derives
 * it against its ground, where the workspace has no paper yet; inside the
 * References workspace the paper style sets the same name against its own
 * paper (`usePaperStyleTokens`), because that is what the sheet is filled
 * with (D13), and the ink is the style's aux pen.
 */
import { relativeLuminance, wcagContrast } from './paperBack';
import { mixHexColors } from '../lib/rgbColor';

/** The grey an earlier crease draws in: `--fold-unassigned`, the same on every theme. */
export const FOLD_UNASSIGNED = '#9aa4ad';

/** The reference light theme the tuning was made on: a white ground, and an earlier crease at 0.75 on it. */
const REFERENCE_GROUND = '#ffffff';
const REFERENCE_CREASE_ALPHA = 0.75;
/** Nothing is drawn fainter than this, whatever the surface. */
const MIN_ALPHA = 0.1;

/** CIE L* of a hex colour, from its WCAG relative luminance. */
function lightness(hex: string): number {
  const y = relativeLuminance(hex);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}

/** The lightness step a line drawn at `alpha` in `ink` takes off `surface`. */
function step(ink: string, surface: string, alpha: number): number {
  return Math.abs(lightness(mixHexColors(ink, surface, alpha)) - lightness(surface));
}

/**
 * The alpha at which `ink` over `surface` steps `target` L* off it: the step
 * grows with alpha, so a bisection finds it; `1` when even solid ink does not
 * get there.
 */
function alphaForStep(ink: string, surface: string, target: number): number {
  if (step(ink, surface, 1) <= target) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (step(ink, surface, mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.max(MIN_ALPHA, hi);
}

const CREASE_STEP = step(FOLD_UNASSIGNED, REFERENCE_GROUND, REFERENCE_CREASE_ALPHA);

/**
 * The alpha an earlier crease draws at on `surface`, in `ink` — the theme's
 * grey on `:root`, the paper style's aux pen inside the workspace.
 */
export function referencesCreaseAlpha(surface: string, ink: string = FOLD_UNASSIGNED): number {
  return alphaForStep(ink, surface, CREASE_STEP);
}

/**
 * The contrast a mark off the paper keeps against the ground it lies on: WCAG's
 * floor for graphics, which a ring or an arrowhead is.
 */
export const GROUND_INK_CONTRAST = 3;

/**
 * What a References mark draws in where it has left the paper, on `ground`:
 * its own `ink` wherever that reads there, and otherwise black or white,
 * whichever reads better.
 *
 * For a file, whose ground is the page's (X11 of the paper export plan). A
 * mark is drawn in the style's ink because the style's paper is what it sits
 * on; an arrow that arcs off the sheet lies on the page instead, and a black
 * pen on a dark page is no mark at all. On screen the ground is the theme's
 * and so is the ink off the paper (`--references-ground-ink`), so nothing is
 * decided here.
 */
export function referencesGroundInk(ink: string, ground: string): string {
  if (wcagContrast(ink, ground) >= GROUND_INK_CONTRAST) return ink;
  return wcagContrast('#000000', ground) >= wcagContrast('#ffffff', ground) ? '#000000' : '#ffffff';
}
