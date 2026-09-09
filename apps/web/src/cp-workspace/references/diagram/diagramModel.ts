/**
 * Which way a crease folds *from the face you are looking at*.
 *
 * A mountain seen from the front is a valley seen from the back — it is one
 * crease, and the two names are the two points of view. The pattern states its
 * assignment from the front, so a picture of the back has to say the other
 * thing, or it tells the folder to press every crease the wrong way at exactly
 * the moment they have turned the paper over and cannot check.
 *
 * One implementation, used by both surfaces and by the creases the crease
 * pattern itself draws under them, because a card and the view beside it
 * disagreeing about this would be worse than either being wrong alone.
 */
import type { DiagramLineStyleName } from '../referenceFinderDiagramToPrimitives';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import type { PrecreaseDirection } from '../precreaseSequence';

const OTHER_FACE: Partial<Record<DiagramLineStyleName, DiagramLineStyleName>> = {
  mountain: 'valley',
  valley: 'mountain',
  'pinch-mountain': 'pinch-valley',
  'pinch-valley': 'pinch-mountain',
};

/** The same crease, named from the other face. */
export function flipDirection<D extends PrecreaseDirection>(direction: D): D {
  if (direction === 'mountain') return 'valley' as D;
  if (direction === 'valley') return 'mountain' as D;
  return direction;
}

/**
 * The same picture, seen from the paper's other side.
 *
 * Only the directions change: where every line is, and which references the
 * step names, are properties of the paper rather than of the side you are on.
 */
export function seenFromTheBack(
  primitives: readonly StepDiagramPrimitive[]
): StepDiagramPrimitive[] {
  return primitives.map((primitive) => {
    if (primitive.kind !== 'line') return primitive;
    const other = OTHER_FACE[primitive.style];
    return other ? { ...primitive, style: other } : primitive;
  });
}
