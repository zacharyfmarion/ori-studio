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
