import type { OristudioCpFoldedFigureState } from '../engine/oristudioCpTypes';

/**
 * The ways the product lets a folded figure be shown: front, or back.
 *
 * The kernel's state has two more members — `Both2` and `Transparent3`, front
 * and back drawn over each other, opaque or see-through — and files written by
 * Oriedita can carry either. Neither is offered anywhere in the UI: a folded
 * figure is a piece of paper, and the two views you get by turning it over are
 * the two views it has.
 *
 * A figure loaded in an overlay state still renders exactly as saved; only the
 * pickers are narrowed, so nothing about the file round-trips differently. The
 * side pickers simply show neither side as current until one is chosen — the
 * same case the folded-figure display-style choice already handles for a style
 * outside its quick list.
 */
export const FOLDED_FIGURE_SIDES = ['Front0', 'Back1'] as const;

export type FoldedFigureSide = (typeof FOLDED_FIGURE_SIDES)[number];

/** Whether a kernel state is one of the two sides the UI offers. */
export function isFoldedFigureSide(
  state: OristudioCpFoldedFigureState
): state is FoldedFigureSide {
  return state === 'Front0' || state === 'Back1';
}
