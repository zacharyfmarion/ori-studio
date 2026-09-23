/**
 * The pens a pattern thumbnail is drawn with: the paper style's.
 *
 * A thumbnail is a crease pattern on paper — what the References workspace
 * draws — so both rails see the style through the References policy: the
 * paper's front, the edge pen for the paper's edge, the fold pens by
 * direction (nothing is folded in a crease pattern), and the aux pen for a
 * crease with no direction and for the aux lines, which draw only while aux
 * creases are shown. Pens keep their on-screen weight (`penSvgStroke`), as the
 * canvas beside the rail draws them.
 */
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { penSvgStroke, type PenSvgStroke } from '../../lib/paper/penSvgStroke';
import type { SheetStrokeRole } from './sheetThumbnail';

export interface SheetThumbnailInk {
  /** The paper's front, which the sheet is filled with. */
  paper: string;
  /** The pen for each role; null for a role the style does not draw. */
  pens: Readonly<Record<SheetStrokeRole, PenSvgStroke | null>>;
  /** How far an aux line pulls back from the paper's edge, as a share of the sheet. */
  erode: number;
}

/**
 * The ink for `style`. `showAux` is a surface's own answer to whether aux
 * creases show — the References option — and null follows the style.
 */
export function sheetThumbnailInk(
  style: PaperStyle,
  showAux: boolean | null = null
): SheetThumbnailInk {
  const seen = applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references);
  const aux = penSvgStroke(seen.auxCreases.pen);
  return {
    paper: seen.paper.front,
    pens: {
      edge: penSvgStroke(seen.edges),
      mountain: penSvgStroke(seen.mountainFolds),
      valley: penSvgStroke(seen.valleyFolds),
      unassigned: aux,
      aux: (showAux ?? seen.auxCreases.visible) ? aux : null,
    },
    erode: seen.erode,
  };
}
