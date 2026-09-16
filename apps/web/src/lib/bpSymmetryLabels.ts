import type { TFunction } from 'i18next';
import type { OptimizerSymmetryProblem, SymmetryFold } from './bpOptimizerSymmetry';

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

/**
 * Why the drawing cannot be solved symmetrically, in the user's words.
 *
 * One place for the sentence, read by the packing pane's status line, the
 * optimize dialog and the refused run alike. The unpaired case names the verbs
 * that fix it: a flap is paired because the user paired it, so the answer to
 * "nothing is paired with this" is one of the Pair verbs, not a redraw.
 */
export function symmetryProblemLabel(t: TFunction, problem: OptimizerSymmetryProblem): string {
  switch (problem.kind) {
    case 'axis-off-centre':
      return t(
        'panels:bpSymmetry.problem.axisOffCentre',
        'The symmetry axis must pass through the centre of the sheet for the optimizer to keep the sheet symmetric.'
      );
    case 'unpaired':
      return t(
        'panels:bpSymmetry.problem.unpaired',
        'Nothing is paired with {{names}}. Select it and choose Pair with mirror, use Pair all mirrored, draw it with mirror draw on, or move it onto the mirror line.',
        { names: problem.names.join(', ') }
      );
    case 'not-a-mirror':
      return t(
        'panels:bpSymmetry.problem.notAMirror',
        'The pairing is not a mirror: some flaps do not pair back to each other. Every flap must pair with exactly one other flap, or with itself on the axis.'
      );
  }
}
