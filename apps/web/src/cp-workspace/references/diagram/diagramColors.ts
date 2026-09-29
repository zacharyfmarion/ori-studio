/**
 * Which theme token each line style draws in.
 *
 * The card gets these from `theme.css` by class, which is where colour belongs.
 * The canvas cannot: its lines are uploaded to the GPU as RGBA, so the mapping
 * has to exist once in TypeScript as well. This is that copy, and it is the
 * whole of it — every other property of a style is geometry and lives in
 * `diagramInk.ts`.
 *
 * A colour changed in one place and not the other shows up the moment a card
 * and the view are on screen together, which is always.
 */
import { parseCssColor, readCssVarColor, readCssVarNumber } from '../../renderer/cssColor';
import type { Rgba } from '../../renderer/types';
import { referencesGroundInk } from '../../../themes/referencesInk';
import type {
  DiagramLineStyleName,
  DiagramPointStyleName,
} from '../referenceFinderDiagramToPrimitives';
import type { DiagramInkColors } from './diagramToScene';

/**
 * A step's fold is an instruction and takes the diagram-crease inks, pinches
 * included; a line of the finished pattern takes the fold inks a crease
 * pattern is drawn in.
 */
const TOKENS: Record<DiagramLineStyleName, string> = {
  crease: '--fold-unassigned',
  aux: '--fold-unassigned',
  edge: '--fold-border',
  highlight: '--cp-reference-input',
  valley: '--diagram-valley',
  mountain: '--diagram-mountain',
  'fold-valley': '--fold-valley',
  'fold-mountain': '--fold-mountain',
  arrow: '--references-arrow',
  dotted: '--fold-unassigned',
  pinch: '--fold-unassigned',
  'pinch-mountain': '--diagram-mountain',
  'pinch-valley': '--diagram-valley',
  unfolded: '--fold-unassigned',
};

/**
 * A token's own fallback where the stylesheet gives it one. The arrow pen and
 * the diagram-crease inks are the paper style's, set on the workspace root
 * alone, and a diagram drawn outside it keeps the theme's: the edge's ink for
 * an arrow (`var(--references-arrow, var(--fold-border))`), the fold inks for
 * a step's fold (`var(--diagram-valley, var(--fold-valley))`).
 */
const TOKEN_FALLBACKS: Readonly<Record<string, string>> = {
  '--references-arrow': '--fold-border',
  '--diagram-mountain': '--fold-mountain',
  '--diagram-valley': '--fold-valley',
};

/**
 * What a mark draws in off the paper, on screen: the theme's own edge ink, as
 * it drew before the paper style reached References. An alias declared on
 * `:root` in `theme.css`, because inside the workspace `--fold-border` is the
 * style's (X11 of the paper export plan).
 */
export const GROUND_INK_VAR = '--references-ground-ink';

/** Mid grey: visible on either ground, so a missing token is a wrong colour rather than an invisible line. */
const FALLBACK: Rgba = [0.6, 0.6, 0.6, 1];

/**
 * The alpha an earlier crease's grey draws at, derived against the paper it
 * sits on (`themes/referencesInk.ts`); the card takes it from the same
 * variable as `stroke-opacity`.
 */
const CREASE_ALPHA_VAR = '--references-crease-alpha';
/** The light theme's tuning, when nothing has set the variable. */
const CREASE_ALPHA_FALLBACK = 0.75;

/**
 * Resolve every style against an element in the References workspace, once
 * per theme and per paper style.
 *
 * `set` is the custom properties the workspace root sets from the paper style
 * (`usePaperStyleTokens`), by name: the render that changes them is the render
 * that repacks the lines, and it runs before the DOM carries them, so they are
 * taken as values and only what the theme alone sets is read off the element.
 */
export function diagramInkColors(
  element: Element,
  set: Readonly<Record<string, string>> = {}
): DiagramInkColors {
  const styles = getComputedStyle(element);
  const read = (token: string): Rgba | null => {
    const own = set[token] === undefined ? null : parseCssColor(set[token]);
    const found = own ?? parseCssColor(styles.getPropertyValue(token));
    if (found) return found;
    const fallback = TOKEN_FALLBACKS[token];
    return fallback === undefined ? null : read(fallback);
  };
  const resolved = {} as DiagramInkColors;
  for (const [style, token] of Object.entries(TOKENS)) {
    resolved[style as DiagramLineStyleName] = read(token) ?? FALLBACK;
  }
  // An earlier crease is context, and how far back it sits depends on the
  // paper under it: the workspace says, in the same variable the card's CSS
  // reads — as a value when the style sets it, like the inks.
  // The pattern's own aux lines are drawn in the same pen, so the same.
  const own = set[CREASE_ALPHA_VAR] === undefined ? NaN : Number(set[CREASE_ALPHA_VAR]);
  const alpha = Number.isFinite(own)
    ? own
    : readCssVarNumber(element, CREASE_ALPHA_VAR, CREASE_ALPHA_FALLBACK);
  for (const style of ['crease', 'aux'] as const) {
    const ink = resolved[style];
    resolved[style] = [ink[0], ink[1], ink[2], ink[3] * alpha];
  }
  return resolved;
}

/**
 * The ink an arrow-style line takes off the paper, on the canvas: the theme's,
 * read through {@link GROUND_INK_VAR}. Only the theme sets it, so it is always
 * read off the element; a browser hands back the alias resolved at `:root`.
 */
export function diagramGroundInk(element: Element): Rgba {
  return readCssVarColor(element, GROUND_INK_VAR, FALLBACK);
}

/**
 * Every token the card's classes read, for a drawing that goes into a file.
 *
 * A file carries no stylesheet, so the third reader of the colours — after the
 * card's classes and the canvas's uploads — takes them as attributes: the
 * paper style's tokens (`REFERENCES_PAPER_TOKENS`), and the two the theme
 * alone sets — the reference accent, which is also every letter's ink, and the ground —
 * the page's, in a file — which a letter off the paper has for its halo and a
 * mark off it is inked against.
 */
export const DIAGRAM_INLINE_TOKENS = [
  '--references-paper-front',
  '--references-paper-back',
  '--fold-mountain',
  '--fold-valley',
  '--diagram-mountain',
  '--diagram-valley',
  '--fold-border',
  '--fold-unassigned',
  '--references-arrow',
  '--references-crease-alpha',
  '--cp-reference-input',
  '--bg-primary',
] as const;

export type DiagramInlineToken = (typeof DIAGRAM_INLINE_TOKENS)[number];
export type DiagramInlineTokens = Readonly<Record<DiagramInlineToken, string>>;

/** A line style's stroke, and the opacity it draws at when that is not 1. */
export interface DiagramInlineStroke {
  color: string;
  opacity?: number;
}

/**
 * The colours a diagram is drawn in as attributes — what `theme.css` gives each
 * class, resolved once from a token record, for `diagramPrimitiveShape` to
 * write into a picture that no stylesheet will reach.
 */
export interface DiagramInlineInk {
  lines: Readonly<Record<DiagramLineStyleName, DiagramInlineStroke>>;
  /** The paper: the front, the back when the picture is mirrored, and its outline. */
  sheet: { front: string; back: string; stroke: string };
  arrowhead: string;
  /** The wash a band step works in, at the stylesheet's opacity. */
  region: { fill: string; opacity: number };
  /** The ring round a mark. */
  mark: string;
  /** A letter's ink by its style, and the ground its halo is painted in. */
  label: { fill: Readonly<Record<DiagramPointStyleName, string>>; halo: string };
  /**
   * What a mark that has left the paper draws in there: the arrow (its
   * strokes, its head and the turn-over glyph) and a ring, each its own ink
   * where that reads against the ground and black or white where it does not
   * (`referencesGroundInk`).
   */
  ground: { arrow: string; mark: string };
}

/** `.step-diagram__region`'s `fill-opacity`. */
const REGION_OPACITY = 0.12;

/**
 * The inline ink for a token record: the same style → token map the canvas
 * resolves through the DOM, read off values instead. The earlier crease's
 * alpha rides on its stroke, as it does in the canvas's colour and the card's
 * `stroke-opacity`.
 *
 * The arrow is the paper style's arrow pen colour (`--references-arrow`), for
 * the arrow's strokes, its head and the turn-over glyph, as on screen. Off the
 * paper, the arrow and the rings take the ground's rule against
 * `--bg-primary`, which in a file is the page.
 */
export function diagramInlineInk(tokens: DiagramInlineTokens): DiagramInlineInk {
  const lines = {} as Record<DiagramLineStyleName, DiagramInlineStroke>;
  for (const [style, token] of Object.entries(TOKENS)) {
    lines[style as DiagramLineStyleName] = { color: tokens[token as DiagramInlineToken] };
  }
  const alpha = Number(tokens['--references-crease-alpha']);
  for (const style of ['crease', 'aux'] as const) {
    lines[style] = {
      color: lines[style].color,
      opacity: Number.isFinite(alpha) ? alpha : CREASE_ALPHA_FALLBACK,
    };
  }
  const arrow = tokens['--references-arrow'];
  const mark = tokens['--fold-border'];
  const ground = tokens['--bg-primary'];
  return {
    lines,
    sheet: {
      front: tokens['--references-paper-front'],
      back: tokens['--references-paper-back'],
      stroke: tokens['--fold-border'],
    },
    arrowhead: arrow,
    region: { fill: tokens['--cp-reference-input'], opacity: REGION_OPACITY },
    mark,
    // Every letter in the reference colour, as `.step-diagram__label` draws
    // it; the halo here is the ground, and a letter on the paper takes the
    // paper's face instead (`diagramPrimitiveShape`).
    label: {
      fill: {
        normal: tokens['--cp-reference-input'],
        highlight: tokens['--cp-reference-input'],
        action: tokens['--cp-reference-input'],
      },
      halo: ground,
    },
    ground: {
      arrow: referencesGroundInk(arrow, ground),
      mark: referencesGroundInk(mark, ground),
    },
  };
}
