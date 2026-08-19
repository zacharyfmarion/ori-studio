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

/**
 * The side a newly computed folded figure faces.
 *
 * Upstream, this is the `FoldedFigure` field `ip4`, which every new figure
 * constructs at `State.FRONT_0`. Note which way it then flows: Oriedita's
 * `FoldingServiceImpl.initFoldedFigure` calls `getData(foldedFigureModel)`,
 * seeding the *shared model* from the new figure — the opposite direction from
 * the colours, scale and rotation, which flow model → figure via `setData`. So
 * an `.ori` file's saved side is overwritten the moment a fold runs, while the
 * rest of its saved appearance carries over.
 *
 * That asymmetry is the whole reason this constant exists. A file saved in an
 * overlay state (`Both2`/`Transparent3`) would otherwise hand a fresh fold a
 * side the pickers do not offer, drawing the front and back over each other
 * with nothing in the UI showing which state is current.
 */
export const NEW_FOLDED_FIGURE_SIDE: FoldedFigureSide = 'Front0';

/** Whether a kernel state is one of the two sides the UI offers. */
export function isFoldedFigureSide(state: OristudioCpFoldedFigureState): state is FoldedFigureSide {
  return state === 'Front0' || state === 'Back1';
}
