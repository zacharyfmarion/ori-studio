import type { TFunction } from 'i18next';
import type { SymmetryFold } from './bpOptimizerSymmetry';

/**
 * Names for the folds, in origami terms rather than geometry.
 *
 * These are paper-relative and so do not depend on the sheet: a book fold is
 * folding the paper in half edge to edge whichever way the grid runs. Where that
 * fold lands in grid coordinates is the optimizer's problem — see
 * {@link ./bpOptimizerSymmetry.optimizerSymmetryAxisForFold}.
 */

/** The folds worth offering. */
export const SYMMETRY_FOLDS: SymmetryFold[] = ['book', 'diagonal'];

export function symmetryFoldLabel(t: TFunction, fold: SymmetryFold): string {
  return fold === 'book'
    ? t('panels:bpSymmetry.fold.book', 'Book fold')
    : t('panels:bpSymmetry.fold.diagonal', 'Diagonal fold');
}
