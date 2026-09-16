/**
 * The letters a step's references go by — on the card and in the sentence.
 *
 * ReferenceFinder's scheme: lines and edges are `A B C…`, marks and corners
 * are `P Q R…`, each in the order the axiom reads its inputs. That order is the
 * one the sentence reads them in too, so a letter means the same thing in both
 * places by construction — which is the whole point of lettering. A sentence
 * that says "the crease from step 3" instead is asking the reader to remember
 * step 3; a letter asks them to look at the picture.
 *
 * Assigned by position and kind alone, never by whether the picture managed to
 * draw the reference: a card that could not place one still lets the sentence
 * name it, rather than the two counting differently.
 */
import type { PrecreaseRef } from '../precreaseSequence';

export interface InputLetters {
  /** The letter for each input, in input order. */
  byInput: string[];
  /** The next unused mark letter, for a point the picture adds itself. */
  nextPoint: string;
  /** The next unused line letter. */
  nextLine: string;
}

const isMark = (ref: PrecreaseRef) => ref.kind === 'point' || ref.kind === 'corner';

const pointLetter = (n: number) => String.fromCharCode('P'.charCodeAt(0) + (n % 11));
const lineLetter = (n: number) => String.fromCharCode('A'.charCodeAt(0) + (n % 15));

export function inputLetters(inputs: readonly PrecreaseRef[]): InputLetters {
  let points = 0;
  let lines = 0;
  const byInput = inputs.map((ref) =>
    isMark(ref) ? pointLetter(points++) : lineLetter(lines++)
  );
  return { byInput, nextPoint: pointLetter(points), nextLine: lineLetter(lines) };
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
