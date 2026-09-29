/**
 * The References canvas's inks, from the workspace's tokens: the paper's two
 * faces, the overlay's colours and the folding flap's paint.
 *
 * Pure over a colour reader rather than a canvas, so which pen pair each line
 * takes — a crease of the pattern the fold pens, a step's own fold the
 * diagram-crease pens — can be tested apart from WebGL. The view hands in a
 * reader over its canvas's computed style.
 */
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { hexToUnitRgb } from '../../lib/paper/paperStyleResolve';
import type { Rgba } from '../renderer/types';
import { diagramDashSlot } from './diagram/diagramInk';
import { PAPER_TILT_SHADE, type FoldPaint } from './fold/foldPoseGeometry';
import type { ReferencesOverlayColors } from './referencesViewGeometry';

/** A token's colour, or `fallback` where it is unset. */
export type ReadTokenColor = (name: string, fallback: Rgba) => Rgba;

/**
 * The paper, filled as a shape under the creases: the paper style's two faces
 * (D13), which the workspace root carries and the step cards fill with too, so
 * the strip and the view agree about what the sheet is and which face is up.
 *
 * The clear colour is the ground the sheet lies on, not the sheet — tinting
 * the whole canvas to say "you are looking at the back" claims the table
 * turned over too. Outside the workspace the tokens are unset and the style's
 * defaults stand in.
 */
const PAPER_FRONT_VAR = '--references-paper-front';
const PAPER_BACK_VAR = '--references-paper-back';
const PAPER_FRONT_FALLBACK: Rgba = [...hexToUnitRgb(DEFAULT_PAPER_STYLE.paper.front), 1];
const PAPER_BACK_FALLBACK: Rgba = [...hexToUnitRgb(DEFAULT_PAPER_STYLE.paper.back), 1];

/** The fold pens' inks: a line of the crease pattern, which the crease channel draws. */
const FOLD_MOUNTAIN_VAR = '--fold-mountain';
const MOUNTAIN_FALLBACK: Rgba = [1, 0.302, 0.365, 1];
const FOLD_VALLEY_VAR = '--fold-valley';
const VALLEY_FALLBACK: Rgba = [0.376, 0.647, 0.98, 1];
/**
 * The diagram-crease pens' inks: a step's own fold, which the diagram channel
 * draws. Set on the workspace root alone; outside it, the fold inks.
 */
const DIAGRAM_MOUNTAIN_VAR = '--diagram-mountain';
const DIAGRAM_VALLEY_VAR = '--diagram-valley';
/** The ink the paper's edge is drawn in, which marks and arrows take too. */
export const INK_COLOR_VAR = '--fold-border';
export const INK_FALLBACK: Rgba = [0.067, 0.078, 0.09, 1];
/** The accent a picked or named input is drawn in. */
export const INPUT_COLOR_VAR = '--cp-reference-input';
export const INPUT_FALLBACK: Rgba = [0.949, 0.353, 0.722, 1];
export const FOLDED_COLOR_VAR = '--fold-unassigned';
export const FOLDED_FALLBACK: Rgba = [0.604, 0.643, 0.678, 1];
/** Ghosted "folded so far" lines sit back from the pattern. */
const FOLDED_ALPHA = 0.55;
/** The part of a fold that is not creased: present, but barely. */
const UNFOLDED_ALPHA = 0.22;

export function withAlpha(color: Rgba, alpha: number): Rgba {
  return [color[0], color[1], color[2], color[3] * alpha];
}

/**
 * The overlay's inks.
 *
 * A crease is drawn in the colour that says which way it folds — the one thing
 * the reader is looking for — so the overlay has no "new crease" hue of its
 * own. A crease of the pattern takes the fold pens' inks, as a crease
 * pattern's line does anywhere. Marks and arrows take the ink the paper's edge
 * is drawn in, the way a printed diagram does.
 */
export function referencesOverlayColors(read: ReadTokenColor): ReferencesOverlayColors {
  return {
    folded: withAlpha(read(FOLDED_COLOR_VAR, FOLDED_FALLBACK), FOLDED_ALPHA),
    input: read(INPUT_COLOR_VAR, INPUT_FALLBACK),
    mark: read(INK_COLOR_VAR, INK_FALLBACK),
    mountain: read(FOLD_MOUNTAIN_VAR, MOUNTAIN_FALLBACK),
    valley: read(FOLD_VALLEY_VAR, VALLEY_FALLBACK),
    unassigned: read(FOLDED_COLOR_VAR, FOLDED_FALLBACK),
    unfoldedAlpha: UNFOLDED_ALPHA,
  };
}

/** The paper's two faces as the workspace carries them, the one the reader is on first. */
export function referencesPaperFaces(
  read: ReadTokenColor,
  mirrored: boolean
): { up: Rgba; other: Rgba } {
  const front = read(PAPER_FRONT_VAR, PAPER_FRONT_FALLBACK);
  const back = read(PAPER_BACK_VAR, PAPER_BACK_FALLBACK);
  return mirrored ? { up: back, other: front } : { up: front, other: back };
}

/**
 * The flap's paper and inks. The face the reader is on is the one the sheet is
 * filled with — the back when the view is mirrored — and the other face the
 * paper's other colour. The direction pairs are the two a flap carries: the
 * step's own fold, in the diagram-crease inks and slots the diagram channel
 * gave it, and the pattern's creases, in the fold inks and slots
 * `referencesCreasePens` and `applyCreaseVisibility` gave them — so a swap on
 * the other face finds each in its own pair.
 */
export function referencesFoldPaint(
  read: ReadTokenColor,
  mirrored: boolean
): Omit<FoldPaint, 'modelToUser'> {
  const { up, other } = referencesPaperFaces(read, mirrored);
  const foldMountain = read(FOLD_MOUNTAIN_VAR, MOUNTAIN_FALLBACK);
  const foldValley = read(FOLD_VALLEY_VAR, VALLEY_FALLBACK);
  return {
    up,
    other,
    directions: [
      {
        mountain: read(DIAGRAM_MOUNTAIN_VAR, foldMountain),
        valley: read(DIAGRAM_VALLEY_VAR, foldValley),
        mountainSlot: diagramDashSlot('mountain'),
        valleySlot: diagramDashSlot('valley'),
      },
      {
        mountain: foldMountain,
        valley: foldValley,
        mountainSlot: diagramDashSlot('fold-mountain'),
        valleySlot: diagramDashSlot('fold-valley'),
      },
    ],
    // The paper's own colour, darkened as it tilts: see `PAPER_TILT_SHADE`.
    shade: PAPER_TILT_SHADE,
  };
}
