/**
 * What a sentence calls a reference: the sheet's own edges, corners and
 * diagonals by description ("the bottom edge", "the top-left corner"), and
 * anything else by its letter ("line B", "point Q").
 *
 * Named as the reader sees the sheet, so a caller names a reference in the
 * frame its picture is drawn in. Literal `t()` keys so the extractor sees
 * them.
 */
import type { TFunction } from 'i18next';
import type { ReferenceKind } from './inputLetters';

/** An edge of the sheet, by the side it is on. */
export type SheetSide = 'bottom' | 'top' | 'left' | 'right';

/** A corner of the sheet, by compass: `sw` is the bottom-left. */
export type SheetCorner = 'sw' | 'se' | 'nw' | 'ne';

/** A diagonal of the sheet, by the corners it joins. */
export type SheetDiagonal = 'sw_ne' | 'nw_se';

/** "The bottom edge." */
export function edgeName(t: TFunction, side: SheetSide): string {
  switch (side) {
    case 'bottom':
      return t('common:foldSentences.ref.bottomEdge', 'the bottom edge');
    case 'top':
      return t('common:foldSentences.ref.topEdge', 'the top edge');
    case 'left':
      return t('common:foldSentences.ref.leftEdge', 'the left edge');
    case 'right':
      return t('common:foldSentences.ref.rightEdge', 'the right edge');
  }
}

/** "The bottom-left corner." */
export function cornerName(t: TFunction, corner: SheetCorner): string {
  switch (corner) {
    case 'sw':
      return t('common:foldSentences.ref.cornerSw', 'the bottom-left corner');
    case 'se':
      return t('common:foldSentences.ref.cornerSe', 'the bottom-right corner');
    case 'nw':
      return t('common:foldSentences.ref.cornerNw', 'the top-left corner');
    case 'ne':
      return t('common:foldSentences.ref.cornerNe', 'the top-right corner');
  }
}

/** "The bottom-left to top-right diagonal." */
export function diagonalName(t: TFunction, diagonal: SheetDiagonal): string {
  switch (diagonal) {
    case 'sw_ne':
      return t('common:foldSentences.ref.diagonalSwNe', 'the bottom-left to top-right diagonal');
    case 'nw_se':
      return t('common:foldSentences.ref.diagonalNwSe', 'the top-left to bottom-right diagonal');
  }
}

/** A reference that is not the sheet's own, by its letter: "line B", "point Q". */
export function letteredName(t: TFunction, kind: ReferenceKind, letter: string): string {
  return kind === 'line'
    ? t('common:foldSentences.ref.line', 'line {{name}}', { name: letter })
    : t('common:foldSentences.ref.point', 'point {{name}}', { name: letter });
}
