/**
 * The Huzita–Justin axioms as a folder names the move — "point onto point",
 * "edge onto edge" — for a label beside a step or a tool, not for a sentence.
 * Literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';

/** A Huzita–Justin axiom, by its number. */
export type FoldAxiom = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The axiom as a folder would name the move. */
export function axiomPhrase(t: TFunction, axiom: FoldAxiom): string {
  switch (axiom) {
    case 1:
      return t('common:foldSentences.axiom.o1', 'through two points');
    case 2:
      return t('common:foldSentences.axiom.o2', 'point onto point');
    case 3:
      return t('common:foldSentences.axiom.o3', 'edge onto edge');
    case 4:
      return t('common:foldSentences.axiom.o4', 'perpendicular through a point');
    case 5:
      return t('common:foldSentences.axiom.o5', 'point onto a line, through a point');
    case 6:
      return t('common:foldSentences.axiom.o6', 'two points onto two lines');
    case 7:
      return t('common:foldSentences.axiom.o7', 'point onto a line, perpendicular');
  }
}
