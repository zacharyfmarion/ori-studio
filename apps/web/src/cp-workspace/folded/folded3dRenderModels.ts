/**
 * Where a 3D figure's geometry lives between projections.
 *
 * A 3D fold produces two things: a ~2 KB snapshot, which goes on the entry and
 * into the `.osf`, and a render model of up to ~235 KB of packed arrays, which
 * does neither — the `.osf` writer pretty-prints, so 29,376 numbers would become
 * roughly 590 KB per figure. But the render model is what every *re*-projection
 * needs: a colour change, a style change, a camera change, the next solution.
 *
 * So it is kept here, keyed by the wasm handle it was folded with, and released
 * with that handle. That is deliberate rather than convenient: handle lifetime
 * is already reachability-based (`foldedFigureHandles.ts`), so a figure that
 * scrolls off the undo stack drops its geometry at exactly the moment it drops
 * its session, and a figure that comes back through undo still has both.
 *
 * The consequence a caller has to respect: a figure reopened from a file has
 * `handle: null` and therefore **no render model**. It draws — the stored
 * `renderSnapshot` is the picture — but it cannot be re-projected. That is the
 * same shape as "draws but cannot cycle", and it is a predicate to gate the
 * colour, style and camera controls on rather than a call that quietly does
 * nothing. {@link folded3dRenderModel} returning `undefined` is that predicate.
 */

import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';

const models = new Map<number, OristudioCpFolded3dRenderModel>();

/** Remember the geometry a 3D fold produced, against its handle. */
export function setFolded3dRenderModel(
  handle: number | null | undefined,
  model: OristudioCpFolded3dRenderModel,
): void {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (handle == null) return;
  models.set(handle, model);
}

/**
 * The geometry a figure can be re-projected from, or `undefined` when it has
 * none — a figure loaded from a file, or one whose handle has been freed.
 */
export function folded3dRenderModel(
  handle: number | null | undefined,
): OristudioCpFolded3dRenderModel | undefined {
  if (handle == null) return undefined;
  return models.get(handle);
}

/** Forget one handle's geometry. Called from the handle release path. */
export function dropFolded3dRenderModel(handle: number | null | undefined): void {
  if (handle == null) return;
  models.delete(handle);
}

/** Drop everything — for closing a document, and for test isolation. */
export function resetFolded3dRenderModels(): void {
  models.clear();
}

/** How many models are held. For tests and diagnostics. */
export function folded3dRenderModelCount(): number {
  return models.size;
}
