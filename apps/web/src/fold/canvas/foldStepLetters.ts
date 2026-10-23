/**
 * The letters a step's sentence names its references by, where the folded
 * pane shows them (plan D14, Sentences): "bringing point P onto point Q"
 * asks the reader to look at the picture, so the picture has to say which is
 * P. The references' letters and which of them the sentence names by letter
 * are the sentence's own (`sentenceInputLetters`, `referenceOf`, from the
 * frame the sentence reads them in), so a letter on the pane is the letter
 * in the sentence by construction; the sheet's own corners, edges and
 * diagonals, which a sentence names by description, carry none.
 *
 * Pure: no React, no store, no engine.
 */
import type { Point } from '../../lib/geometry';
import type { FoldOp, FoldRef, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldScene } from '../engine/foldEngineWire';
import { anchorOf, referenceOf } from '../sequence/foldSentenceStep';
import type { FoldStateFrame } from '../sequence/foldStateFrame';
import { sentenceInputLetters } from '../stepSentence';
import { sheetToScene } from './foldPicking';

/** A reference the sentence names by its letter, where the pane's scene shows it. */
export interface FoldLetteredReference {
  letter: string;
  /** A point (a mark, a vertex, a crossing) is ringed as well; a line carries its letter alone. */
  kind: 'point' | 'line';
  /** In the scene frame of the state shown: the point, or a line's middle. */
  at: Point;
}

/**
 * The lettered references of a step whose line an axiom finds — and a
 * partial precrease's points along its line, whatever found it — placed on the
 * scene of the state shown: the step's parent while it is being folded,
 * where its picks are, or its own landed state once it is on screen, where
 * what the sentence says it did can be seen (P lying on Q). `parent` is the
 * frame the step's sentence names its references in, the state it folds
 * from; null while it is not in, when every reference goes by its letter, as
 * the sentence then names them. None for any other step.
 *
 * `place` puts a reference's sheet point where the pane draws it: on the
 * shown scene by default, or where a spread pane draws it.
 */
export function foldStepLetters(
  op: FoldOp,
  parent: FoldStateFrame | null,
  shown: FoldScene,
  place: (sheet: SheetPoint) => Point | null = (sheet) => sheetToScene(shown, sheet)
): FoldLetteredReference[] {
  // An axiom's inputs, then a partial precrease's points along its line,
  // lettered after them as its sentence letters them (`sentenceExtentLetters`).
  const axiom: readonly FoldRef[] = 'line' in op && op.line.via === 'axiom' ? op.line.inputs : [];
  const extent: readonly FoldRef[] =
    op.kind === 'precrease' && op.extent
      ? op.extent.kind === 'pinch'
        ? [op.extent.at]
        : [op.extent.from, op.extent.to]
      : [];
  const inputs = [...axiom, ...extent];
  if (inputs.length === 0) return [];
  const references = inputs.map((input) => referenceOf(input, parent));
  const letters = sentenceInputLetters(references).byInput;
  return inputs.flatMap((input, index): FoldLetteredReference[] => {
    const reference = references[index];
    const letter = letters[index];
    if (!letter || (reference?.kind !== 'point' && reference?.kind !== 'line')) return [];
    const at = place(anchorOf(input));
    return at ? [{ letter, kind: reference.kind, at }] : [];
  });
}
