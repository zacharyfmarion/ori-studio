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
 * Cost is small for a **flat** handle: roughly 0.6 KiB per crease-pattern
 * segment, and only *deleted* figures are retained beyond their live entry — an
 * ordinary edit mutates the existing handle rather than allocating a second one.
 *
 * A **3D** handle is a different cost class, and the flat figure is not a guide
 * to it. Measured with a counting allocator over the committed fixtures and the
 * admitted corpus: a `Fold3dSession` is 23.7 KiB at 23 segments, 596 KiB at 420,
 * 1.79 MiB at 941 and **10.7 MiB at 5,010** (`origamisimulator`, the largest
 * model the gate admits). Per-segment cost climbs with size rather than holding —
 * 885 B/segment at 5 segments, 2,237 B/segment at 5,010 — so no "N KiB per
 * segment" rule read off a small fixture is safe to extrapolate. The flat
 * control on the same harness reproduces the 0.6 KiB figure above (656 B/segment
 * on `solution_sample_1.cp`).
 *
 * The **render model is not the bulk of it**, which is worth stating because it
 * is the obvious thing to reach for: it is 7.8% of the session at every size
 * measured (145 KiB of 1.79 MiB, 849 KiB of 10.7 MiB). Dropping it from history
 * entries would recover a twelfth. The bulk is the arrangement, the census and
 * the per-component search state, and shedding those means dropping the session
 * and re-folding on restore — which 3D can do exactly, since its payload is
 * bit-identical across refolds of the same segments, but which is a behaviour
 * change rather than a bound. It is not done; the plan's Phase 8 records the
 * measurement so the decision is takeable rather than guessed.
 *
 * The exposure that number bounds is narrow: only *deleted* figures are retained
 * beyond their live entry, so it takes deleting many large 3D figures inside one
 * undo window (`MAX_CP_HISTORY`) to accumulate, and the largest corpus files are
 * refused by the admission gate before a session is ever allocated.
 */

import { dropFolded3dRenderModel, resetFolded3dRenderModels } from './folded3dRenderModels';
import { clearAllFolded3dOrbits } from './folded3dRuntime';

/** Live reference count per handle. Entries reaching 0 are freed and dropped. */
const counts = new Map<number, number>();

/**
 * How many times the handle space has been torn down wholesale.
 *
 * Bumped by {@link resetFoldedFigureHandles}, which is what closing or replacing
 * a document calls. An async caller holding a handle it obtained earlier — a
 * background rehydrate, say — compares this before adopting: the number changing
 * means every handle from before, including the one it is holding, belongs to a
 * kernel document that no longer exists.
 *
 * A counter rather than a flag because the question is "is this still the same
 * space", which two loads in a row would answer wrongly with a boolean.
 */
let handleEpoch = 0;

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
  // A 3D figure's geometry is reachable only through its handle, so it goes at
  // the same moment. Keeping it alive past the session it describes would leak
  // a quarter of a megabyte per figure that scrolled off the undo stack.
  dropFolded3dRenderModel(handle);
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

/** Which teardown generation the live handles belong to. See {@link handleEpoch}. */
export function foldedFigureHandleEpoch(): number {
  return handleEpoch;
}

/**
 * Drop all bookkeeping without freeing — for closing a document, where the
 * session's handles go away wholesale, and for test isolation.
 */
export function resetFoldedFigureHandles(): void {
  handleEpoch += 1;
  counts.clear();
  resetFolded3dRenderModels();
  // The other 3D side table, torn down at the same point and for the same
  // reason: a live orbit frame outliving its document would draw a figure at a
  // camera no entry in the store has.
  clearAllFolded3dOrbits();
}
