import type { OristudioCpFoldedFigureState } from '../engine/oristudioCpTypes';

/**
 * Toggle a folded figure between its front and back — turning the paper over.
 * This is the honest "Flip": Front ↔ Back.
 *
 * `Both` and `Transparent` are overlay view modes (front and back drawn together,
 * opaque or see-through), not sides, so a flip from either resolves to `Back` —
 * the reverse of the default `Front` view. Those overlay states are chosen from
 * the toolbar's "Side" control, which is the full four-way surface; the context
 * menu only offers the common front/back toggle.
 */
export function flipFoldedState(
  state: OristudioCpFoldedFigureState
): OristudioCpFoldedFigureState {
  return state === 'Back1' ? 'Front0' : 'Back1';
}
