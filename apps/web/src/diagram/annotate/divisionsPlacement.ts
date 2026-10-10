/**
 * Where equal divisions' line goes as the pointer puts it (Revision 2, ED2):
 * a drag of the mark — anywhere on its ink, or the handle at the middle of
 * its line — slides the line nearer to or farther from the line it measures,
 * square to it, and over to its other side when dragged across it. Kept to a
 * tenth of a millimetre as it prints, or with Shift to a half. The side a new
 * mark is laid on is `createAnnotation`'s, which lays every default
 * (`divisionsAwayFromMiddle`).
 *
 * Pure: no DOM, no store.
 */
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { divisionsOffsetOf, divisionsOffsetWithin, withDivisionsOffset, type PicturePoint } from './annotationModel';
import { mmInPictureUnits } from './canvasInk';

/**
 * Where equal divisions' line stands, signed: its offset in mm, positive to
 * the right of the way their measured line runs, negative to its left — so a
 * drag across the measured line is one number passing through none.
 */
export function divisionsSignedOffset(annotation: Pick<KnownDiagramAnnotation, 'offset' | 'mirrored'>): number {
  const offset = divisionsOffsetOf(annotation);
  return annotation.mirrored === true ? -offset : offset;
}

/** The unit normal to the right of the way a mark's measured line runs, as the picture shows it (y down); null when its ends meet. */
function rightOf({ from, to }: Pick<KnownDiagramAnnotation, 'from' | 'to'>): PicturePoint | null {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(length > 0)) return null;
  return [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
}

/**
 * Equal divisions `original` with their line where a drag from `start` to
 * `at` (picture units, as the canvas draws the frame) puts it: moved square
 * to the line they measure by as far as the pointer went that way, its side
 * the one it ends on — the side it had where it ends on the line itself —
 * kept to a tenth of a millimetre, or a half with `halves` (Shift).
 */
export function draggedDivisions(
  original: KnownDiagramAnnotation,
  start: PicturePoint,
  at: PicturePoint,
  { halves = false }: { halves?: boolean } = {}
): KnownDiagramAnnotation {
  const right = rightOf(original);
  if (!right) return original;
  const travel = (at[0] - start[0]) * right[0] + (at[1] - start[1]) * right[1];
  const signed = divisionsSignedOffset(original) + travel / mmInPictureUnits(1);
  const offset = divisionsOffsetWithin(Math.abs(signed), halves);
  // On the line itself, as kept, it has no side of its own: the one it had.
  const mirrored = offset === 0 ? original.mirrored === true : signed < 0;
  return withDivisionsOffset(original, offset, { halves, mirrored });
}
