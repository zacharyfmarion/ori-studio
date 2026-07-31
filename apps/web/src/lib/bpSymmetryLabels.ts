import type { TFunction } from 'i18next';
import type { OristudioBpSheetKind } from '../engine/oristudioBpTypes';
import type { OptimizerSymmetryAxis } from './bpOptimizerSymmetry';
import { optimizerSymmetryAxisForAngle } from './bpOptimizerSymmetry';

/**
 * Naming a mirror fold by what it does to the *paper*.
 *
 * A diagonal-grid sheet is the paper turned 45 degrees against the box-pleating
 * grid, so its corners point along the grid axes. A fold joining two of those
 * corners therefore runs along a grid line — it is a diagonal fold of the paper
 * that looks vertical or horizontal on screen. On a rectangular sheet the paper
 * and the grid share axes, so the two swap.
 *
 * Naming folds by their on-screen direction alone would tell someone working on
 * a diamond that their corner-to-corner fold is a book fold.
 */

export type SymmetryFoldKind = 'book' | 'diagonal';

/** Whether the fold line runs along the grid rather than at 45 degrees to it. */
function isAxisAligned(axis: OptimizerSymmetryAxis): boolean {
  return axis === 'verticalHalf' || axis === 'horizontalHalf';
}

export function symmetryFoldKind(
  sheetKind: OristudioBpSheetKind,
  axis: OptimizerSymmetryAxis
): SymmetryFoldKind {
  const alongGrid = isAxisAligned(axis);
  if (sheetKind === 'diagonal') return alongGrid ? 'diagonal' : 'book';
  return alongGrid ? 'book' : 'diagonal';
}

export function symmetryFoldKindLabel(t: TFunction, kind: SymmetryFoldKind): string {
  return kind === 'book'
    ? t('panels:bpSymmetry.fold.book', 'Book fold')
    : t('panels:bpSymmetry.fold.diagonal', 'Diagonal fold');
}

function orientationLabel(t: TFunction, axis: OptimizerSymmetryAxis): string {
  switch (axis) {
    case 'verticalHalf':
      return t('panels:bpSymmetry.orientation.vertical', 'vertical');
    case 'horizontalHalf':
      return t('panels:bpSymmetry.orientation.horizontal', 'horizontal');
    case 'mainDiagonal':
      return t('panels:bpSymmetry.orientation.rising', 'rising');
    default:
      return t('panels:bpSymmetry.orientation.falling', 'falling');
  }
}

/** e.g. "Book fold, vertical" — what the fold is, then where the line runs. */
export function symmetryAxisLabel(
  t: TFunction,
  sheetKind: OristudioBpSheetKind,
  axis: OptimizerSymmetryAxis
): string {
  return t('panels:bpSymmetry.axisLabel', '{{fold}}, {{orientation}}', {
    fold: symmetryFoldKindLabel(t, symmetryFoldKind(sheetKind, axis)),
    orientation: orientationLabel(t, axis),
  });
}

/** The same, from the authoring angle. Null when the angle is not one of the four. */
export function symmetryAxisLabelForAngle(
  t: TFunction,
  sheetKind: OristudioBpSheetKind,
  angle: number
): string | null {
  const axis = optimizerSymmetryAxisForAngle(angle);
  return axis ? symmetryAxisLabel(t, sheetKind, axis) : null;
}

/** The four axes, in the order the picker offers them. */
export const SYMMETRY_AXIS_ANGLES: { axis: OptimizerSymmetryAxis; angle: number }[] = [
  { axis: 'verticalHalf', angle: 90 },
  { axis: 'horizontalHalf', angle: 0 },
  { axis: 'mainDiagonal', angle: 45 },
  { axis: 'antiDiagonal', angle: 135 },
];
