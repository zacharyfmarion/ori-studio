import type { SimulatorSettings } from '../../lib/simulatorSettings';
import { parseCssRgb } from '../../simulator/simulatorPalette';

/**
 * Paper and crease colours for the start figure, both derived from the theme's
 * **accent** rather than from the simulator's own tokens.
 *
 * Everywhere else in the app, `--sim-paper-front` and `--text-primary` are the
 * right answers: the Simulate workspace and inline simulations are showing
 * *paper*, and origami paper is its own colour rather than the UI's. Every
 * preset therefore sets the paper to some yellow, and a figure that reads as
 * paper is exactly what those surfaces want.
 *
 * The start screen is not showing paper. It is showing the product's hero, and
 * it sits beside the accent-coloured buttons and icons of whichever theme the
 * user picked — so it should be that colour. Switching to Nord should give a
 * blue penguin, not the same yellow one on a different background.
 */

/**
 * How far the crease ink is darkened from the paper it sits on.
 *
 * The creases are the *same hue* as the front face, just darker, so the linework
 * reads as folds in one sheet rather than as ink drawn over it. A neutral ink
 * (`--text-primary`, which is what `mono` uses by default) is legible but reads
 * as a wireframe laid on top; this keeps the figure feeling like one object.
 *
 * 0.45 is dark enough to hold at 320px against a saturated accent, and light
 * enough not to collapse to black on a dark one.
 */
const CREASE_DARKEN = 0.45;

function darken(color: string, factor: number): string {
  const [r, g, b] = parseCssRgb(color, [0, 0, 0]);
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value * factor)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/**
 * The colours the figure draws with, or an empty override when the theme has no
 * accent — in which case everything falls back to the simulator's own tokens,
 * which is the honest answer rather than a guess.
 *
 * Only the paper's *front* is recoloured. `--sim-paper-back` is already a pale
 * theme-derived tone and is what makes the two-tone read as folded-over paper;
 * replacing it as well would flatten the figure into one colour.
 *
 * `borderColor` is the crease ink here because the figure draws in `mono`, and
 * `resolveRenderSettings` feeds that one colour to mountains, valleys and the
 * paper edge alike — so setting it is setting all three, and setting
 * `mountainColor` / `valleyColor` alongside it would be dead weight.
 */
export function startFigurePaperSettings(
  styles: CSSStyleDeclaration
): Partial<Pick<SimulatorSettings, 'paperFront' | 'borderColor'>> {
  const accent = styles.getPropertyValue('--accent-primary').trim();
  if (accent === '') return {};
  return { paperFront: accent, borderColor: darken(accent, CREASE_DARKEN) };
}
