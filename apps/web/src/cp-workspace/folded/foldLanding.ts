/**
 * Whether a fold a press made may still land on the figure it was made for.
 *
 * A fold, a Refold or a Duplicate marks a figure `loading` — a fold and a
 * Duplicate by adding a placeholder that is — and waits for the kernel. In that
 * time an undo, a redo or a Delete can take the figure away or put another in
 * its place, and the figure the press marked may then be held only by a
 * history entry: an undo moves the live list's references into the entry it
 * pushes rather than counting them (`historySlice.ts`). Landing anyway wrote
 * the new fold onto nothing, so it was never freed, and let go of the old one,
 * which the entry still held: an undo then put back a figure whose kernel slot
 * was gone, or, once the next fold took the slot, another figure's.
 *
 * So a fold lands only on the figure the press marked: the same id, still
 * `loading`, still holding the fold the press found — null for a placeholder.
 * A figure an undo put back is history's, even one holding the same fold, and
 * the press's fold is then freed with nothing released. Store-free: the store
 * adds the handle generation (`foldedFigureHandleEpoch`), since a document
 * replaced meanwhile takes every handle with it.
 */
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';

/** Whether `figure` is still the one a press marked `loading` on `figureId`, holding `holding`. */
export function isAwaitingFold(
  figure: OristudioCpFoldedFigureEntry | undefined,
  figureId: string,
  holding: number | null
): boolean {
  return (
    figure !== undefined &&
    figure.id === figureId &&
    figure.status === 'loading' &&
    figure.handle === holding
  );
}

/** Whether `figures` still hold that figure. */
export function figuresAwaitFold(
  figures: readonly OristudioCpFoldedFigureEntry[],
  figureId: string,
  holding: number | null
): boolean {
  return figures.some((figure) => isAwaitingFold(figure, figureId, holding));
}

/**
 * Thrown where a fold would land once its figure has moved on. It carries the
 * fold, which nothing has adopted yet, for the press to free.
 */
export class FoldMovedOn extends Error {
  readonly handle: number;

  constructor(handle: number) {
    super('The folded model this fold was made for has moved on');
    this.name = 'FoldMovedOn';
    this.handle = handle;
  }
}
