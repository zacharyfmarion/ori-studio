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
import type {
  DiagramLineStyleName,
  DiagramPointStyleName,
} from '../referenceFinderDiagramToPrimitives';
import type { DiagramInkColors } from './diagramToScene';

const TOKENS: Record<DiagramLineStyleName, string> = {
  crease: '--fold-unassigned',
  aux: '--fold-unassigned',
  edge: '--fold-border',
  highlight: '--cp-reference-input',
  valley: '--fold-valley',
  mountain: '--fold-mountain',
  arrow: '--fold-border',
  dotted: '--fold-unassigned',
  pinch: '--fold-unassigned',
  'pinch-mountain': '--fold-mountain',
  'pinch-valley': '--fold-valley',
  unfolded: '--fold-unassigned',
};

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
  const resolved = {} as DiagramInkColors;
  for (const [style, token] of Object.entries(TOKENS)) {
    const own = set[token] === undefined ? null : parseCssColor(set[token]);
    resolved[style as DiagramLineStyleName] = own ?? readCssVarColor(element, token, FALLBACK);
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
 * Every token the card's classes read, for a drawing that goes into a file.
 *
 * A file carries no stylesheet, so the third reader of the colours — after the
 * card's classes and the canvas's uploads — takes them as attributes. The
 * eight the paper style sets on the workspace root (`REFERENCES_PAPER_TOKENS`)
 * and the three the theme alone sets: the reference accent, the letter's ink
 * and the ground its halo is painted in.
 */
export const DIAGRAM_INLINE_TOKENS = [
  '--references-paper-front',
  '--references-paper-back',
  '--fold-mountain',
  '--fold-valley',
  '--fold-border',
  '--fold-unassigned',
  '--references-crease-alpha',
  '--cp-reference-input',
  '--text-primary',
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
}

/** `.step-diagram__region`'s `fill-opacity`. */
const REGION_OPACITY = 0.12;

/**
 * The inline ink for a token record: the same style → token map the canvas
 * resolves through the DOM, read off values instead. The earlier crease's
 * alpha rides on its stroke, as it does in the canvas's colour and the card's
 * `stroke-opacity`.
 *
 * `arrow` is the paper style's arrow pen colour, for the arrow's strokes, its
 * head and the turn-over glyph. On screen those are the edge's ink through
 * `--fold-border` — a diagram draws the motion in the paper's own black — but
 * the style has a pen for arrows, and a file is drawn with the style's pens.
 */
export function diagramInlineInk(tokens: DiagramInlineTokens, arrow: string): DiagramInlineInk {
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
  lines.arrow = { color: arrow };
  return {
    lines,
    sheet: {
      front: tokens['--references-paper-front'],
      back: tokens['--references-paper-back'],
      stroke: tokens['--fold-border'],
    },
    arrowhead: arrow,
    region: { fill: tokens['--cp-reference-input'], opacity: REGION_OPACITY },
    mark: tokens['--fold-border'],
    label: {
      fill: {
        normal: tokens['--text-primary'],
        highlight: tokens['--cp-reference-input'],
        action: tokens['--fold-border'],
      },
      halo: tokens['--bg-primary'],
    },
  };
}
