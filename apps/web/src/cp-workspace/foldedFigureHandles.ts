/**
 * Ownership of folded-figure wasm handles.
 *
 * A folded figure's *drawing* needs only its `renderSnapshot`, which is plain
 * data — that is why a reopened `.osf` renders its figures with `handle: null`.
 * The handle is needed to run *further* kernel operations on a figure: recolour,
 * change display style, advance the fold case, duplicate.
 *
 * That distinction is what makes handle lifetime interesting once folded figures
 * are undoable. Freeing on delete would make delete/undo silently downgrade a
 * figure: it comes back and draws correctly, but its kernel-backed menu items
 * are dead until it is re-folded. So freeing becomes a function of
 * *reachability* rather than of the delete action — a handle lives as long as
 * any live entry or any history entry still refers to it, and is freed when the
 * last reference goes (typically when the entry scrolls off the undo stack).
 *
 * Cost is small: a handle measures roughly 0.6 KiB per crease-pattern segment,
 * and only *deleted* figures are retained beyond their live entry — an ordinary
 * edit mutates the existing handle rather than allocating a second one.
 */

/** Live reference count per handle. Entries reaching 0 are freed and dropped. */
const counts = new Map<number, number>();

/**
 * The actual free. Injected so the store can supply its runtime binding without
 * this module importing the wasm layer (and so tests can observe frees).
 */
export type FreeFoldedFigureHandle = (handle: number) => Promise<void> | void;

let freeHandle: FreeFoldedFigureHandle = () => {};

/** Install the free implementation. Called once, from the store slice. */
export function setFoldedFigureHandleFree(free: FreeFoldedFigureHandle): void {
  freeHandle = free;
}

/** Take a reference to `handle`. No-op for a figure that has none yet. */
export function retainFoldedFigureHandle(handle: number | null | undefined): void {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (handle == null) return;
  counts.set(handle, (counts.get(handle) ?? 0) + 1);
}

/** Retain every handle in a figure list (a history entry taking ownership). */
export function retainFoldedFigureHandles(
  figures: readonly { handle: number | null }[]
): void {
  for (const figure of figures) retainFoldedFigureHandle(figure.handle);
}

/**
 * Drop a reference. Frees the handle when the last one goes. Releasing a handle
 * that is not held is ignored — the same figure object can legitimately appear
 * in several history entries, and a double release would free it early.
 */
export function releaseFoldedFigureHandle(handle: number | null | undefined): void {
  if (handle == null) return;
  const count = counts.get(handle);
  if (count === undefined) return;
  if (count > 1) {
    counts.set(handle, count - 1);
    return;
  }
  counts.delete(handle);
  void freeHandle(handle);
}

/** Release every handle in a figure list (a history entry being evicted). */
export function releaseFoldedFigureHandles(
  figures: readonly { handle: number | null }[]
): void {
  for (const figure of figures) releaseFoldedFigureHandle(figure.handle);
}

/** Current reference count, for tests and diagnostics. */
export function foldedFigureHandleRefCount(handle: number): number {
  return counts.get(handle) ?? 0;
}

/**
 * Drop all bookkeeping without freeing — for closing a document, where the
 * session's handles go away wholesale, and for test isolation.
 */
export function resetFoldedFigureHandles(): void {
  counts.clear();
}
