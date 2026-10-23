/**
 * The vocabulary step sentences share, whichever workspace writes them.
 *
 * Words and rules only, never a whole sentence: each workspace keeps full
 * sentence keys of its own (References' `referencesStepSentences`, Fold's
 * builder), because a sentence joined from clauses breaks word order in ja and
 * ko. What is shared is what has to agree across them:
 *
 * - what the sheet's edges, corners and diagonals are called, and a lettered
 *   reference ("line B");
 * - the letters a step's references go by, on the picture and in the text;
 * - the axioms by the move a folder makes ("point onto point");
 * - the rule that a sentence names the input that swings first, the one the
 *   arrow and the animation move.
 *
 * Its words live under `common:foldSentences.*`, with the other strings more
 * than one surface shares, rather than under one workspace's panel keys.
 *
 * React-free and store-free.
 */
export { axiomPhrase, type FoldAxiom } from './axiomPhrases';
export { letterInputs, type InputLetters, type ReferenceKind } from './inputLetters';
export { moverFirst } from './moverFirst';
export {
  cornerName,
  diagonalName,
  edgeName,
  letteredName,
  type SheetCorner,
  type SheetDiagonal,
  type SheetSide,
} from './referenceNames';
