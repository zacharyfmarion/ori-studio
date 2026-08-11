/**
 * Which reopened 3D figures can be made live again, and in what order.
 *
 * A reopened figure is not blank: it draws its stored `renderSnapshot`, which is
 * a correct picture of the fold. What it has lost is the *render model* — the
 * packed geometry every re-projection needs — because that is deliberately not
 * persisted (~235 KB of arrays into a pretty-printing `.osf` writer). So the job
 * is not "load something", it is **make an existing picture live**, and the bar
 * is therefore higher than for a load: whatever comes back has to be the picture
 * that is already on screen.
 *
 * That bar is what every predicate below is for. Each condition excludes a
 * figure whose refold could produce something *different* from what the user is
 * looking at, and an excluded figure keeps today's behaviour in full — the
 * stored picture, and the explicit **Refold** verb where it is offered.
 *
 * Pure and React-free, so the rules can be asserted without a store, a kernel or
 * a canvas. The scheduling lives in `useFolded3dRehydration`, and the fold
 * itself in `rehydrateOristudioCpFolded3dFigure`.
 */

import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { isFoldedFromCurrentCpSourceKind } from '../../engine/oristudioCpTypes';
import { isFolded3dFigure } from './foldedFigureCapabilities';
import { foldedFigureCycling } from './foldedFigureState';

/**
 * How many solutions forward a rehydrate will step to land back on the one the
 * figure was saved showing.
 *
 * A fresh 3D session always opens at solution 1, so a figure saved at a later
 * one has to be walked back to it — see {@link folded3dSolutionReplaySteps}. The
 * cap is here because each step is a real ordering search, and this runs in the
 * background on load: a figure whose owner held the "another solution" button
 * down is not worth spending a hundred solves on before the app is idle.
 *
 * Past the cap the figure is simply not rehydrated, which is exactly today's
 * behaviour for it.
 */
export const FOLDED_3D_REPLAY_STEP_LIMIT = 32;

/**
 * Whether this figure is one a rehydrate could make live, judged from the entry
 * alone.
 *
 * Six conditions. The first three say there is something to do and something to
 * do it from; the last three are the ones that keep the picture still:
 *
 * - **It is a 3D figure.** The flat figure does not change, in any respect, and
 *   a flat figure reopened from a file has never needed a handle to draw.
 * - **It has no handle.** A figure folded in this session already has its render
 *   model beside its handle; there is nothing to rebuild.
 * - **It is `ready`.** A figure that failed, or that is mid-fold, has no settled
 *   picture to reproduce.
 * - **It was folded from this document's creases**, and it recorded which ones.
 *   Without `sourceBounds` there is no source region to refold from — the same
 *   condition the Refold verb has, and the reason a figure imported from a FOLD
 *   file is left alone.
 * - **It has a frame.** `frameRadius` is what a 3D figure's box is derived from;
 *   a figure written before frames existed falls back to the bounds of its last
 *   projection, and giving it a frame now would resize its box on screen. It is
 *   also the same condition `canWindowFolded3dFigure` has, so a rehydrated
 *   figure is one that can immediately be drawn as a window.
 * - **It is showing a solution we can get back to.** See
 *   {@link folded3dSolutionReplaySteps}.
 */
export function canRehydrateFolded3dFigure(figure: OristudioCpFoldedFigureEntry): boolean {
  if (!isFolded3dFigure(figure)) return false;
  if (figure.handle != null) return false;
  if (figure.status !== 'ready') return false;
  if (!isFoldedFromCurrentCpSourceKind(figure.sourceKind)) return false;
  if (figure.sourceBounds == null) return false;
  if (figure.frameRadius == null || figure.frameRadius <= 0) return false;
  return folded3dSolutionReplaySteps(figure) !== null;
}

/**
 * How many times a fresh session has to be advanced to show what this figure was
 * saved showing, or `null` when it cannot be reached.
 *
 * The kernel's solution stream is an odometer over the constraint components
 * (`Fold3dOrderStream::advance`): deterministic, and always starting at solution
 * 1. So a figure saved at solution *k* needs *k − 1* steps, and a figure saved
 * at solution 1 — which is every figure nobody pressed "Show another solution"
 * on — needs none at all.
 *
 * `null` above {@link FOLDED_3D_REPLAY_STEP_LIMIT}, and `null` for a figure with
 * no recorded case at all, which is a file old enough that the index was not
 * written and so cannot be checked afterwards.
 */
export function folded3dSolutionReplaySteps(
  figure: OristudioCpFoldedFigureEntry
): number | null {
  const current = figure.folded3d?.current_fold_case ?? null;
  if (current === null || !Number.isInteger(current) || current < 1) return null;
  const steps = current - 1;
  return steps <= FOLDED_3D_REPLAY_STEP_LIMIT ? steps : null;
}

/** The solution index a rehydrate has to land on, 1-based. */
export function folded3dTargetSolution(figure: OristudioCpFoldedFigureEntry): number {
  return foldedFigureCycling(figure).current;
}

/**
 * How far the refolded geometry's frame may sit from the stored one and still
 * count as the same fold.
 *
 * A refold of the same creases is deterministic, so the honest expectation is
 * bit-equality; the window exists only so that a build which reassociates a
 * floating-point sum somewhere does not make every figure in every saved file
 * permanently un-turnable. It is far tighter than any change a user could see —
 * a part in a billion of the model's own radius.
 */
const FOLDED_3D_FRAME_AGREEMENT = 1e-9;

/**
 * Whether refolded geometry produces the frame the figure is already drawn in.
 *
 * The cheapest single witness that a rehydrate reproduced the fold rather than
 * replacing it: the frame is half the model's bounding sphere, so two folds that
 * agree on it agree on the paper's extent at every orientation. It does **not**
 * check the layer order, which is why the solution index is checked separately.
 */
export function sameFolded3dFrame(
  refolded: number,
  stored: number | null | undefined
): boolean {
  if (stored == null || !(stored > 0) || !Number.isFinite(refolded)) return false;
  return Math.abs(refolded - stored) <= FOLDED_3D_FRAME_AGREEMENT * stored;
}

/**
 * The figures to rehydrate, in the order to do it — one at a time, so this is a
 * queue and not a set.
 *
 * `priorityId` is the figure the user just pressed. It goes first because the
 * press is the moment the wait becomes visible: everything else is happening
 * while nobody is looking at it.
 *
 * Stale figures are excluded by the caller, not here, because staleness needs
 * the live document and this module deliberately has no access to one. Leaving a
 * stale figure alone is the whole rule: refolding one would silently replace the
 * picture the user is looking at with a different one, which is the thing the
 * explicit **Refold** verb exists to ask permission for.
 */
export function folded3dRehydrationQueue(
  figures: readonly OristudioCpFoldedFigureEntry[],
  options: {
    /** Figures the caller has judged out of date. Left alone. */
    staleIds: ReadonlySet<string>;
    /**
     * Entries already tried and not adopted. Takes the **entry**, not its id, so
     * a caller can hold the answer in a `WeakSet` and have a figure that was
     * rewritten since — refolded, restored by undo, or belonging to a document
     * that has been replaced under the same id — tried again rather than written
     * off for the life of the session.
     */
    skip?: (figure: OristudioCpFoldedFigureEntry) => boolean;
    /** The figure the user is looking at, if any. */
    priorityId?: string | null;
  }
): readonly string[] {
  const { staleIds, skip, priorityId } = options;
  const queue: string[] = [];
  for (const figure of figures) {
    if (staleIds.has(figure.id)) continue;
    if (skip?.(figure)) continue;
    if (!canRehydrateFolded3dFigure(figure)) continue;
    queue.push(figure.id);
  }
  if (priorityId == null) return queue;
  const at = queue.indexOf(priorityId);
  if (at <= 0) return queue;
  return [priorityId, ...queue.slice(0, at), ...queue.slice(at + 1)];
}
