/**
 * Which verbs a folded figure actually offers, by kind.
 *
 * A 3D figure is not a flat figure with extra fields: several of the flat
 * verbs route through kernel commands that take `CpSession::flat(handle)` and
 * answer `folded_figure_kind_mismatch` on a spatial one. Gating them here is
 * **not** belt-and-braces, and it is worth stating exactly why, because the
 * three cases fail three different ways:
 *
 * - **Flip and every folded-model control** (side, colours, alpha) never reach
 *   the kernel at all. `updateOristudioCpFoldedFigureModel` rejects any figure
 *   with `snapshot == null`, and a 3D figure is exactly that, so the user gets
 *   "No folded model is ready" — a message that is neither true nor about kinds.
 *   This gate is the only thing between them and that toast.
 * - **Display style** does reach `folded_figure_render_snapshot`. Left ungated
 *   its rejection is caught and written onto the entry as `status: 'error'`, so
 *   a style click would destroy a perfectly good figure. It is not gated away
 *   here — a 3D figure has real styles — but the *set* is narrowed, and the
 *   store re-projects locally instead of asking the kernel.
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
  /** Turn the paper over. Kernel model write; 3D has no such command. */
  flip: boolean;
  /** Colours, alpha, side — the folded-model menu. Same command, same answer. */
  editModel: boolean;
  /** Batch to a numbered solution. Deliberately absent in 3D. */
  foldToCase: boolean;
  /** Display styles offered, in the order the surfaces present them. */
  styleChoices: readonly OristudioCpFoldedFigureDisplayStyle[];
}

/**
 * Styles a flat figure offers — the shipped quick list, unchanged.
 */
export const FLAT_FIGURE_STYLE_CHOICES: readonly OristudioCpFoldedFigureDisplayStyle[] = [
  'Paper5',
  'Wire2',
  'Transparent3',
];

/**
 * Styles a 3D figure offers.
 *
 * `Transparent3` is deliberately absent, and it is not a projector gap: the
 * kernel's transparent development needs the whole-document *flat* arrangement
 * (`needs_subfaces`), which a spatial fold never computes. Offering it would
 * promise the flat figure's x-ray and deliver something else with the same name.
 */
export const FOLDED_3D_STYLE_CHOICES: readonly OristudioCpFoldedFigureDisplayStyle[] = [
  'Paper5',
  'Wire2',
];

export function foldedFigureCapabilities(
  figure: Pick<OristudioCpFoldedFigureEntry, 'folded3d'> | null | undefined
): FoldedFigureCapabilities {
  if (isFolded3dFigure(figure)) {
    return {
      flip: false,
      editModel: false,
      foldToCase: false,
      styleChoices: FOLDED_3D_STYLE_CHOICES,
    };
  }
  return {
    flip: true,
    editModel: true,
    foldToCase: true,
    styleChoices: FLAT_FIGURE_STYLE_CHOICES,
  };
}
