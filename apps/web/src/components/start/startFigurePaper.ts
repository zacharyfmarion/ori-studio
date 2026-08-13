import type { SimulatorSettings } from '../../lib/simulatorSettings';

/**
 * Paper colours for the start figure, taken from the theme's **accent** rather
 * than from the simulator's paper tokens.
 *
 * Everywhere else in the app, `--sim-paper-front` is the right answer: the
 * Simulate workspace and inline simulations are showing *paper*, and origami
 * paper is its own colour, not the UI's. Every preset therefore sets it to some
 * yellow, and a figure that reads as paper is exactly what those surfaces want.
 *
 * The start screen is not showing paper. It is showing the product's hero, and
 * it sits beside the accent-coloured buttons and icons of whichever theme the
 * user picked — so it should be that colour. Switching to Nord should give a
 * blue penguin, not the same yellow one on a different background.
 *
 * Only the front changes. `--sim-paper-back` is already a pale theme-derived
 * tone and is what makes the two-tone read as folded-over paper; replacing it
 * as well would flatten the figure into one colour.
 */
export function startFigurePaperSettings(
  styles: CSSStyleDeclaration
): Pick<SimulatorSettings, 'paperFront'> {
  const accent = styles.getPropertyValue('--accent-primary').trim();
  // `null` means "follow the theme's own paper token", which is the honest
  // fallback if a theme ever ships without an accent.
  return { paperFront: accent === '' ? null : accent };
}
