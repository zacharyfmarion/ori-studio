/**
 * Where a 3D folded figure's camera lives *while the pointer is down*.
 *
 * Deliberately outside the store, for the reason `inlineSimulationRuntime.ts`
 * records at length: a per-frame transport field must not share an object with
 * document provenance. `setOristudioCpFolded3dCamera` used to be called on every
 * pointermove of an orbit, and each call produced a new
 * `oristudioCpFoldedFigures` array — which invalidates `staleFoldedFigureIds`
 * (a walk over every crease in the document, per frame), `foldedFigureObjects`,
 * `canvasObjects`, and re-renders the whole crease-pattern panel. That is Cause 2
 * of `implementation-plans/inline-simulation-performance.md`, which cost 901 ms
 * of main-thread time there and produced the same visible stutter.
 *
 * So the *live* camera is here and the *stored* camera stays on the entry: one
 * store write per drag, on release, where the single undo entry already lands.
 * The store remains exactly what would be written to disk.
 *
 * A frame carries the projected picture beside the camera because Phase 1 still
 * draws a 3D figure through the CPU projector, and re-projecting in a render
 * pass would put `earcut` plus a BSP build inside React's commit. When the mesh
 * renderer takes over the live path (see
 * `implementation-plans/folded-figure-viewport.md` §3-4) the `snapshot` field
 * goes and the camera stays — the camera is the part that is transport.
 *
 * Lifetime is one pointer gesture: published by the first move that turns the
 * figure, dropped on release by the same code that writes the store. Nothing
 * here survives a document replace ({@link clearAllFolded3dOrbits}).
 */

import type { OristudioCpFoldedRenderSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldedFigureCamera } from './foldedFigure3dProjection';

/** One figure's live orbit state: where the eye is, and the picture from there. */
export interface Folded3dOrbitFrame {
  camera: FoldedFigureCamera;
  /**
   * The projection at {@link camera}, or `null` when the figure cannot be
   * re-projected at all — a figure reopened from a file has no render model, so
   * it keeps the picture it was saved with. The same answer
   * `reproject3dFigureAt` gives, and callers treat it the same way: keep what
   * you have rather than blanking the figure.
   */
  snapshot: OristudioCpFoldedRenderSnapshot | null;
}

/**
 * Replaced wholesale on every write rather than mutated, so
 * `useSyncExternalStore` can use it directly as the snapshot: identity changes
 * exactly when the contents do, and is stable in between. At most one figure is
 * ever in here (a pointer turns one figure), so copying costs nothing.
 */
let frames: ReadonlyMap<string, Folded3dOrbitFrame> = new Map();

const listeners = new Set<() => void>();

function commit(next: ReadonlyMap<string, Folded3dOrbitFrame>): void {
  frames = next;
  for (const listener of listeners) listener();
}

/** Subscribe to orbit frames appearing, changing or going away. */
export function subscribeFolded3dOrbit(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live frames, as one stable object. For `useSyncExternalStore`. */
export function folded3dOrbitFrames(): ReadonlyMap<string, Folded3dOrbitFrame> {
  return frames;
}

/** Where a figure is being turned to right now, or `null` when it is not. */
export function getFolded3dOrbit(id: string): Folded3dOrbitFrame | null {
  return frames.get(id) ?? null;
}

/** Publish the camera a drag has reached, with the picture from it. */
export function publishFolded3dOrbit(id: string, frame: Folded3dOrbitFrame): void {
  const next = new Map(frames);
  next.set(id, frame);
  commit(next);
}

/**
 * Drop a figure's live frame — the release half of a drag, after the store has
 * been written. A no-op (and no notification) when there was nothing live, so a
 * press that never turned anything wakes no subscriber.
 */
export function clearFolded3dOrbit(id: string): void {
  if (!frames.has(id)) return;
  const next = new Map(frames);
  next.delete(id);
  commit(next);
}

/** Drop everything — for a document replace, and for test isolation. */
export function clearAllFolded3dOrbits(): void {
  if (frames.size === 0) return;
  commit(new Map());
}

/** How many figures are being turned. For tests and diagnostics. */
export function folded3dOrbitCount(): number {
  return frames.size;
}
