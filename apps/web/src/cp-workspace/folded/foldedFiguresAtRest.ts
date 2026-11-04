/**
 * Folded figures shown as `loading` while a press works on them, and what
 * each was before the press.
 *
 * Every press that folds marks its figure `loading` so its verbs wait: a
 * fold or a Duplicate by adding a placeholder, a Refold, an Apply, Another
 * solution (Oriedita's, or a step within a chosen order's constraints), a
 * step to a case, Layer order… on a figure reopened from a file, a 3D
 * figure's rehydrate on a press. Meanwhile the user can still undo, redo or
 * start another gesture, and each of those writes the live list into an
 * undo or redo entry. An entry that holds a `loading` figure puts back, on
 * undo or redo, a figure that waits forever: the press it waited on has
 * landed on nothing by then (`foldLanding.ts`).
 *
 * So history never stores a figure mid-press. Every place that writes the
 * live list into an entry — the folded layer's bracket
 * (`foldedFigureGesture.ts`), an overlay entry, a crease edit's entry, the
 * undo and redo swaps, the Diagram import's compound entries — reads it
 * through {@link foldedFiguresAtRest}: each figure a press is working on as it
 * was before the press, and a placeholder a press added not at all.
 *
 * A figure read at rest holds the same kernel handle as the one on screen (a
 * press keeps the figure's handle until its new fold lands, and a placeholder
 * has none), so history's handle counts are unchanged by the substitution
 * (`foldedFigureHandles.ts`).
 *
 * Module state, like the handle registry: a press marks a figure, and its end
 * lets go, however it ended.
 */
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';

/**
 * What a figure was before a press: an entry, or nothing, for a placeholder
 * the press added — with the figure selected before the press, which the
 * press may have handed to the placeholder.
 */
type AtRest =
  | { readonly entry: OristudioCpFoldedFigureEntry }
  | { readonly entry: null; readonly selectedBefore: string | null };

const atRest = new Map<string, AtRest>();

function hold(id: string, held: AtRest): () => void {
  atRest.set(id, held);
  return () => {
    if (atRest.get(id) === held) atRest.delete(id);
  };
}

/**
 * `entry` as it was before a press marks it `loading`. Returns the press's
 * end, which lets go; idempotent.
 */
export function holdFoldedFigureAtRest(entry: OristudioCpFoldedFigureEntry): () => void {
  return hold(entry.id, { entry });
}

/**
 * A `loading` placeholder a press adds as figure `id` (a fold, a Duplicate):
 * at rest it isn't there, so history never stores it, nor stores it as the
 * selected figure: `selectedBefore` is the figure selected before the press
 * ({@link foldedSelectionAtRest}). Returns the press's end, which lets go;
 * idempotent.
 */
export function holdFoldedPlaceholderAtRest(id: string, selectedBefore: string | null): () => void {
  return hold(id, { entry: null, selectedBefore });
}

/**
 * The selected figure as history stores it beside {@link foldedFiguresAtRest}
 * of the same `figures`: a placeholder a press selected, still `loading`,
 * reads as the figure selected before the press, since the placeholder is
 * left out of the figures.
 */
export function foldedSelectionAtRest(
  selected: string | null,
  figures: readonly OristudioCpFoldedFigureEntry[]
): string | null {
  if (selected === null) return null;
  const before = atRest.get(selected);
  if (!before || before.entry !== null) return selected;
  const waiting = figures.some((figure) => figure.id === selected && figure.status === 'loading');
  return waiting ? before.selectedBefore : selected;
}

/**
 * `figures` with each one a press is working on, still `loading`, read as it
 * was before the press, and each placeholder a press added left out; the
 * very list when there is none.
 */
export function foldedFiguresAtRest(figures: OristudioCpFoldedFigureEntry[]): OristudioCpFoldedFigureEntry[];
export function foldedFiguresAtRest(
  figures: readonly OristudioCpFoldedFigureEntry[]
): readonly OristudioCpFoldedFigureEntry[];
export function foldedFiguresAtRest(
  figures: readonly OristudioCpFoldedFigureEntry[]
): readonly OristudioCpFoldedFigureEntry[] {
  if (atRest.size === 0) return figures;
  let changed = false;
  const rested = figures.flatMap((figure) => {
    const before = figure.status === 'loading' ? atRest.get(figure.id) : undefined;
    if (!before) return [figure];
    if (before.entry === null) {
      changed = true;
      return [];
    }
    // Only the figure the press found, on the fold it holds: anything else is not that press's.
    if (before.entry.handle !== figure.handle) return [figure];
    changed = true;
    return [before.entry];
  });
  return changed ? rested : figures;
}

export function resetFoldedFiguresAtRestForTests(): void {
  atRest.clear();
}
