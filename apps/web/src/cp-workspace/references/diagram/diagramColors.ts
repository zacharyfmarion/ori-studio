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
import { readCssVarColor, readCssVarNumber } from '../../renderer/cssColor';
import type { Rgba } from '../../renderer/types';
import type { DiagramLineStyleName } from '../referenceFinderDiagramToPrimitives';
import type { DiagramInkColors } from './diagramToScene';

const TOKENS: Record<DiagramLineStyleName, string> = {
  crease: '--fold-unassigned',
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
 * The alpha an earlier crease's grey draws at, per theme (`themes/referencesInk.ts`);
 * the card takes it from the same variable as `stroke-opacity`.
 */
const CREASE_ALPHA_VAR = '--references-crease-alpha';
/** The light theme's tuning, when the theme has not set the variable. */
const CREASE_ALPHA_FALLBACK = 0.75;

/** Resolve every style against an element in the document, once per theme. */
export function diagramInkColors(element: Element): DiagramInkColors {
  const resolved = {} as DiagramInkColors;
  for (const [style, token] of Object.entries(TOKENS)) {
    resolved[style as DiagramLineStyleName] = readCssVarColor(element, token, FALLBACK);
  }
  // An earlier crease is context, and how far back it sits depends on the
  // ground: the theme says, in the same variable the card's CSS reads.
  const crease = resolved.crease;
  resolved.crease = [
    crease[0],
    crease[1],
    crease[2],
    crease[3] * readCssVarNumber(element, CREASE_ALPHA_VAR, CREASE_ALPHA_FALLBACK),
  ];
  return resolved;
}
