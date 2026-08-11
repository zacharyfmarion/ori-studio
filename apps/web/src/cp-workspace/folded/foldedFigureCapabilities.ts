/**
 * Which verbs a folded figure actually offers, by kind.
 *
 * A 3D figure is not a flat figure with extra fields: several of the flat
 * verbs route through kernel commands that take `CpSession::flat(handle)` and
 * answer `folded_figure_kind_mismatch` on a spatial one. Gating them here is
 * **not** belt-and-braces, and it is worth stating exactly why, because the
 * cases fail different ways:
 *
 * - **The folded-model controls** (colours, alpha, side) never reach the kernel
 *   at all. `updateOristudioCpFoldedFigureModel` rejects any figure with
 *   `snapshot == null`, and a 3D figure is exactly that, so the user gets "No
 *   folded model is ready" — a message that is neither true nor about kinds.
 *   This gate is the only thing between them and that toast.
 * - **Display style** does reach `folded_figure_render_snapshot`. Left ungated
 *   its rejection is caught and written onto the entry as `status: 'error'`, so
 *   a style click would destroy a perfectly good figure. It is not gated away
 *   here — a 3D figure has real styles — and the store re-projects locally
 *   instead of asking the kernel.
 * - **Fold to case** has no 3D command by design: `discovered_fold_cases` is a
 *   high-water mark over an odometer with no knowable product, so there is no
 *   "case N of M" to batch to.
 *
 * Pure, React-free and store-free, so a store test can assert that the disabled
 * verb is never dispatched and a catalog test can assert it is never offered.
 */

import type {
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
} from '../../engine/oristudioCpTypes';

/** Whether this entry is the 3D kind. The one witness the UI branches on. */
export function isFolded3dFigure(
  figure: Pick<OristudioCpFoldedFigureEntry, 'folded3d'> | null | undefined
): boolean {
  return (figure?.folded3d ?? null) !== null;
}

export interface FoldedFigureCapabilities {
  /**
   * Show the paper's other side.
   *
   * The same verb, two mechanisms, because "the other side" means two things.
   * A flat figure turns the *paper* over — a kernel model write on
   * `model.state`. A 3D figure moves the *eye* to the antipodal camera, since in
   * three dimensions the other side is somewhere to stand and not a colour, and
   * that is a pure re-projection needing no kernel at all.
   */
  flip: boolean;
  /**
   * Colours, side and alpha — the folded-model menu.
   *
   * True for both kinds now. A flat figure writes its model through the kernel;
   * a 3D one keeps the model on `folded3d` and re-projects, which is a pure
   * function and needs no round trip. It was false for 3D while that write path
   * did not exist, which left the whole menu greyed out on a 3D figure.
   */
  editModel: boolean;
  /** Batch to a numbered solution. Deliberately absent in 3D. */
  foldToCase: boolean;
  /** Display styles offered, in the order the surfaces present them. */
  styleChoices: readonly OristudioCpFoldedFigureDisplayStyle[];
}

/**
 * The style quick list, shared by both kinds.
 *
 * `Transparent3` was withheld from a 3D figure on the grounds that the kernel's
 * transparent development needs the whole-document *flat* arrangement
 * (`needs_subfaces`). True of the flat path and irrelevant here: a 3D figure's
 * picture is never asked of the kernel — `project3dRenderSnapshot` makes it in
 * TypeScript, where `Transparent3` means every cell translucent.
 *
 * Withholding it also cost the one thing that makes solution cycling visible.
 * Measured on `penguin_freeform` (8 solutions): the eight `renderSnapshot`s hash
 * identically under `Paper5` **and** under `Wire2`, because swapping two buried
 * layers of a stack changes nothing an opaque render shows, and only under
 * `Transparent3` do distinct pictures appear. So the figure that made "Another
 * solution" look like a dead button was the style list, not the enumerator.
 */
export const FOLDED_FIGURE_STYLE_CHOICES: readonly OristudioCpFoldedFigureDisplayStyle[] = [
  'Paper5',
  'Wire2',
  'Transparent3',
];

export function foldedFigureCapabilities(
  figure: Pick<OristudioCpFoldedFigureEntry, 'folded3d'> | null | undefined
): FoldedFigureCapabilities {
  if (isFolded3dFigure(figure)) {
    return {
      flip: true,
      editModel: true,
      foldToCase: false,
      styleChoices: FOLDED_FIGURE_STYLE_CHOICES,
    };
  }
  return {
    flip: true,
    editModel: true,
    foldToCase: true,
    styleChoices: FOLDED_FIGURE_STYLE_CHOICES,
  };
}
