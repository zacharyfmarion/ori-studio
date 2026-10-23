/**
 * The letters a planner step's references go by — on the card and in the
 * sentence — in the shared scheme (`lib/foldSentences/inputLetters`): a mark
 * or a corner letters as a point, a crease or an edge as a line.
 */
import { letterInputs, type InputLetters, type ReferenceKind } from '../../../lib/foldSentences';
import type { PrecreaseRef } from '../precreaseSequence';

export type { InputLetters };

const kindOf = (ref: PrecreaseRef): ReferenceKind =>
  ref.kind === 'point' || ref.kind === 'corner' ? 'point' : 'line';

export function inputLetters(inputs: readonly PrecreaseRef[]): InputLetters {
  return letterInputs(inputs.map(kindOf));
}

/**
 * The letters for a second witness on the same card — the mirror image of
 * the first (`PrecreaseStep.also`) — carrying on from the first's: its marks
 * after the first's marks (and the corner the first lettered, when it drew
 * one), its lines after the first's lines, so no letter appears twice.
 */
export function alsoLetters(
  first: readonly PrecreaseRef[],
  firstLettersACorner: boolean,
  also: readonly PrecreaseRef[]
): InputLetters {
  const corner: PrecreaseRef[] = firstLettersACorner ? [{ kind: 'point', id: -1 }] : [];
  // A reference both name — the mark at the centre both corners fold onto,
  // the line both marks sit on — keeps the letter the first gave it: one
  // thing, one name, however many folds use it.
  const shared = (r: PrecreaseRef) => first.findIndex((f) => sameRef(f, r));
  const fresh = also.filter((r) => shared(r) < 0);
  const all = inputLetters([...first, ...corner, ...fresh]);
  const freshLetters = all.byInput.slice(first.length + corner.length);
  let next = 0;
  return {
    byInput: also.map((r) => {
      const at = shared(r);
      return at >= 0 ? all.byInput[at]! : freshLetters[next++]!;
    }),
    nextPoint: all.nextPoint,
    nextLine: all.nextLine,
  };
}

/** The same reference: the same kind of thing with the same state id. */
export function sameRef(a: PrecreaseRef, b: PrecreaseRef): boolean {
  return a.kind === b.kind && a.id === b.id;
}
