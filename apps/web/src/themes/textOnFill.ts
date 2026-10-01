import { wcagContrast } from './paperBack';

/** WCAG AA for body text. */
export const TEXT_ON_FILL_MIN_CONTRAST = 4.5;

/**
 * The text to set on a solid fill of `fill`, in a theme whose ground is
 * `ground`: a highlighted menu row on the accent, a destructive one on danger.
 *
 * The ground itself when it reads at AA. A dark theme's accents are light, so
 * its dark ground is what reads on them, and the other way round in a light
 * theme; the ground also keeps the text in the theme's own palette. Where it
 * falls short, black or white, whichever reads better.
 *
 * Not `--text-inverse`, which is the inverse of the *ground* — white in a dark
 * theme — and reads at under 4.5:1 on the accent of 22 of the 23 presets
 * (One Dark 2.36:1; the yellow and green accents under 1.6:1).
 *
 * Always a flat `#rrggbb`, like every other token `applyTheme` derives.
 */
export function textOnFill(fill: string, ground: string): string {
  if (wcagContrast(fill, ground) >= TEXT_ON_FILL_MIN_CONTRAST) return ground;
  return wcagContrast(fill, '#000000') >= wcagContrast(fill, '#ffffff') ? '#000000' : '#ffffff';
}
