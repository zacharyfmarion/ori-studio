import {
  applyCreaseStyle,
  DEFAULT_PAPER_STYLE,
  parseHex,
  type PaperStyle,
} from '../../lib/paper/paperStyle';
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
  return toHex([r * factor, g * factor, b * factor]);
}

function toHex([r, g, b]: readonly [number, number, number]): string {
  const channel = (value: number) =>
    Math.round(Math.max(0, Math.min(255, value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** A theme token as `#rrggbb`, or the fallback when the token is unset or unreadable. */
function tokenHex(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const value = styles.getPropertyValue(token).trim();
  if (value === '') return fallback;
  return parseHex(value) ?? toHex(parseCssRgb(value, parseCssRgb(fallback, [0, 0, 0])));
}

/**
 * The style the figure draws with: the theme's paper tones under one ink, and
 * — when the theme has an accent — that accent on the paper with a darker cut
 * of it as the ink. Without an accent everything falls back to the theme's own
 * paper tokens and text colour, which is the honest answer rather than a guess.
 *
 * One ink (`mono`) rather than the editor's mountain/valley red and blue:
 * colour is the right default in the Simulate workspace, where the direction
 * of each crease is information, but here the figure is 320px of decoration
 * beside a heading, and at that size 246 creases in two saturated colours read
 * as noise over the form — and the form is the whole point.
 *
 * The accent is on the **back** of the paper, not the front. Which side is which
 * is arbitrary here — the figure is a decoration, not a fold anyone is reading —
 * and this way round the pale side leads. On the penguin that puts the light
 * tone on the face and belly with the accent behind it, which reads as a
 * subject on a background rather than as a coloured object outlined in white.
 *
 * Both sides are set explicitly. Setting one and letting the other take the
 * style's default would leave the two tones deciding themselves from
 * different places, so a theme that moved one would tilt the figure's balance
 * without anyone touching this file.
 *
 * The edge pen is the crease ink because the figure draws in `mono`, which
 * writes that one colour to the mountain and valley pens too — so setting it
 * is setting all three.
 */
export function startFigurePaperStyle(styles: CSSStyleDeclaration): PaperStyle {
  const pale = tokenHex(styles, '--sim-paper-back', DEFAULT_PAPER_STYLE.paper.back);
  const accent = styles.getPropertyValue('--accent-primary').trim();
  const ink = tokenHex(styles, '--text-primary', DEFAULT_PAPER_STYLE.edges.color);
  const style: PaperStyle = {
    ...DEFAULT_PAPER_STYLE,
    paper:
      accent === ''
        ? {
            front: tokenHex(styles, '--sim-paper-front', DEFAULT_PAPER_STYLE.paper.front),
            back: pale,
          }
        : { front: pale, back: tokenHex(styles, '--accent-primary', ink) },
    edges: {
      ...DEFAULT_PAPER_STYLE.edges,
      color: accent === '' ? ink : darken(accent, CREASE_DARKEN),
    },
  };
  return applyCreaseStyle(style, 'mono');
}
