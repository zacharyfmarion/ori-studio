/**
 * The letters a step's references go by — on the picture and in the sentence.
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

/**
 * What a reference is lettered as: a line (a crease or an edge of the sheet)
 * or a point (a mark or a corner).
 */
export type ReferenceKind = 'line' | 'point';

export interface InputLetters {
  /** The letter for each input, in input order. */
  byInput: string[];
  /** The next unused mark letter, for a point the picture adds itself. */
  nextPoint: string;
  /** The next unused line letter. */
  nextLine: string;
}

/** `P`–`Z`, then round again. */
const pointLetter = (n: number) => String.fromCharCode('P'.charCodeAt(0) + (n % 11));
/** `A`–`O`, then round again: the letters before the marks'. */
const lineLetter = (n: number) => String.fromCharCode('A'.charCodeAt(0) + (n % 15));

/** The letters for a step's inputs, given what each one is, in input order. */
export function letterInputs(kinds: readonly ReferenceKind[]): InputLetters {
  let points = 0;
  let lines = 0;
  const byInput = kinds.map((kind) =>
    kind === 'point' ? pointLetter(points++) : lineLetter(lines++)
  );
  return { byInput, nextPoint: pointLetter(points), nextLine: lineLetter(lines) };
}
