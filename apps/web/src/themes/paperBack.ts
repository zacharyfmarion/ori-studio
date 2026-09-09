/**
 * The colour of the paper's other side.
 *
 * The origami house's legend is "white side is the paper, colour side a 30%
 * grey against it", and mixing 30% of the theme's ink into its ground is a
 * faithful reading of that — on a light theme. On a dark one it is not, because
 * sRGB's transfer curve is steep near black and flat near white: the same 30%
 * move in bytes is a far larger move in *luminance* away from a dark ground
 * than towards a light one. Measured over the built-in themes, that one
 * unbranched line puts the back face at 1.43–1.88× the ground's luminance in
 * the five light themes and 1.57–2.57× in the eighteen dark ones — fourteen of
 * them above every light theme.
 *
 * That step is not a cosmetic difference. Crease-on-back contrast is exactly
 * crease-on-front ÷ the step, so a back face that jumps further from the ground
 * takes every crease drawn on it down with it: dracula's mountain red goes from
 * 4.39:1 on the front to 1.72:1 on the back.
 *
 * So the rule here is the light branch's *outcome* rather than its arithmetic —
 * as much of the legend's 30% as a theme can take without the back face
 * standing further from its ground than a light theme's does.
 */
import { mixHexColors } from '../lib/rgbColor';

/**
 * The legend's own mix: 30% ink into the ground, and the most any theme gets.
 *
 * `mixHexColors` weights its *first* argument, so this is passed as the share
 * of the ground that survives.
 */
const PAPER_BACK_INK = 0.3;

/**
 * The most a back face may stand off its own ground, as a WCAG ratio.
 *
 * Just above the light themes' own measured band, which runs 1.43
 * (solarized-light) to 1.88 (github-light) — so the rule that exists for the
 * dark themes cannot disturb the light ones it is copying, and does not hinge
 * on one preset's exact bytes. Four dark themes are already inside it
 * (solarized-dark, palenight, one-dark, tokyo-night) and keep the legend's
 * colour exactly.
 */
const PAPER_BACK_MAX_STEP = 1.9;

/** How finely the ink fraction is searched. A byte is coarser than this. */
const SEARCH_STEP = 0.002;

function channels(hex: string): [number, number, number] {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? [...s].map((c) => c + c).join('') : s;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) || 0) as [
    number,
    number,
    number,
  ];
}

/** WCAG relative luminance of an `#rgb`/`#rrggbb` hex. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex)
    .map((v) => v / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hexes, always ≥ 1. */
export function wcagContrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The paper's other side for a theme's ground and ink: as much of the legend's
 * 30% grey as fits inside {@link PAPER_BACK_MAX_STEP}.
 *
 * Always a flat `#rrggbb`. It has to be — a WebGL canvas reads this token
 * through `renderer/cssColor.ts`, which understands hex and `rgb()` and nothing
 * else, and a `color-mix()` there parses to nothing and leaves the back face
 * the colour of the ground, which is to say invisible. That has shipped before.
 *
 * The search runs downward from the full mix and stops at the first fraction
 * that fits, so a theme already inside the cap gets the legend's colour exactly
 * and nothing else is disturbed. It searches the *rounded* colour, which is the
 * one that ships.
 */
export function paperBackFor(background: string, ink: string): string {
  for (let inkShare = PAPER_BACK_INK; inkShare > 0; inkShare -= SEARCH_STEP) {
    const candidate = mixHexColors(background, ink, 1 - inkShare);
    if (wcagContrast(candidate, background) <= PAPER_BACK_MAX_STEP) return candidate;
  }
  // Unreachable for any real pair — a vanishing ink share is the ground itself,
  // whose step is 1 — but a theme is user-supplied data, so it has an answer
  // rather than a loop that can fall out of the bottom.
  return mixHexColors(background, ink, 1);
}
