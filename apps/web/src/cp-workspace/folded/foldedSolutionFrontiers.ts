import {
  advanceSolutionFrontier,
  UNSEARCHED_FRONTIER,
  type ReportedSolutions,
  type SolutionFrontier,
} from '../../lib/layerOrderPlace';

/**
 * How far the search for each folded figure's layer orders has reached, by
 * kernel handle (`lib/layerOrderPlace.ts`).
 *
 * A side table of the handle registry, as the flat paper scenes and the 3D
 * render models are (`foldedFigureHandles.ts`), for the same reasons:
 *
 * - **Not on the figure entry.** Entries are undo state, and the search's
 *   reach is not: what the kernel has found on a handle stays found whichever
 *   entry an undo puts back, so the readout never shrinks on undo. The
 *   Diagram's capture session keeps its frontier outside its document for the
 *   same reason.
 * - **Keyed by handle, dropped with it.** The enumeration lives on the
 *   handle. When the last reference goes, the kernel may hand the slot to a
 *   new fold, and that fold has found nothing yet (`releaseFoldedFigureHandle`
 *   drops the entry). A refold takes a new handle and starts fresh
 *   (`startSolutionFrontier`); a duplicate copies its original's session, so
 *   it starts where the original stood (`seedSolutionFrontier`).
 * - **Never in the file.** A reopened figure has no handle, and no search.
 *
 * Writers note a frontier before the store update that shows the step, so a
 * render that reads the new entry reads the frontier with it.
 */
const frontiers = new Map<number, SolutionFrontier>();

/** How far the search on `handle` has reached; nothing for no handle, or one never stepped. */
export function solutionFrontierOf(handle: number | null | undefined): SolutionFrontier {
  if (handle == null) return UNSEARCHED_FRONTIER;
  return frontiers.get(handle) ?? UNSEARCHED_FRONTIER;
}

/** What the kernel reported for `handle`, laid over what its search had reached. */
export function noteSolutionFrontier(handle: number, reported: ReportedSolutions): SolutionFrontier {
  const next = advanceSolutionFrontier(solutionFrontierOf(handle), reported);
  frontiers.set(handle, next);
  return next;
}

/** A handle just folded: its search has reached only what the fold reports. */
export function startSolutionFrontier(handle: number): void {
  frontiers.delete(handle);
}

/** A duplicate's handle, whose session is a copy of `from`'s: it has reached as far. */
export function seedSolutionFrontier(handle: number, from: number | null | undefined): void {
  const original = from == null ? undefined : frontiers.get(from);
  if (original) frontiers.set(handle, original);
  else frontiers.delete(handle);
}

/** Forget a handle the kernel is free to reuse. */
export function dropSolutionFrontier(handle: number): void {
  frontiers.delete(handle);
}

/** Forget every handle, as a document closes. */
export function resetSolutionFrontiers(): void {
  frontiers.clear();
}
