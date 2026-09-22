/**
 * Where a flat figure's paper scene lives between draws.
 *
 * The kernel's `folded_figure_paper_scene(handle)` is what the flat figure's
 * aux creases are drawn from on the canvas (§9 of
 * `implementation-plans/unified-paper-style-and-export.md`): every face's
 * folded outline, every subface's stack and the document's aux lines carried
 * through the fold, in the render snapshot's coordinates. It is fetched only
 * while a figure's effective `auxCreases.visible` is on — it is a face-and-
 * stack description of the whole figure, not a ~2 KB picture — and it is never
 * persisted: the `.osf` carries the picture, and a reopened figure has no
 * handle to ask until it is rehydrated.
 *
 * Keyed by the wasm handle like the 3D render models (`folded3dRenderModels.ts`)
 * and released with it, so a figure that scrolls off the undo stack drops its
 * scene at the moment it drops its session. Within a handle's life the scene
 * is stale whenever the figure's kernel snapshot is replaced — a refold, another
 * solution, a side flip, a rehydrate — and current across everything that only
 * re-renders the picture (a selection marker, a display style), so the entry
 * remembers which snapshot it was fetched for and answers only for that one.
 *
 * An external store, read with `useSyncExternalStore`: the table is replaced,
 * never mutated, so a reader holding the table it was handed sees a landed
 * fetch as a new table.
 */

import type {
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';

export interface FoldedFlatSceneEntry {
  /** The figure's kernel snapshot the scene was fetched for; identity is the key. */
  snapshot: OristudioCpFoldedFigureSnapshot;
  scene: OristudioCpFoldedPaperScene;
}

export type FoldedFlatSceneTable = ReadonlyMap<number, FoldedFlatSceneEntry>;

let scenes: FoldedFlatSceneTable = new Map();
const listeners = new Set<() => void>();

function publish(next: FoldedFlatSceneTable): void {
  scenes = next;
  for (const listener of listeners) listener();
}

/** Remember the scene a handle's current snapshot folds to. */
export function setFoldedFlatScene(
  handle: number | null | undefined,
  snapshot: OristudioCpFoldedFigureSnapshot,
  scene: OristudioCpFoldedPaperScene
): void {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (handle == null) return;
  publish(new Map(scenes).set(handle, { snapshot, scene }));
}

/** The current table, for `useSyncExternalStore`. */
export function foldedFlatScenes(): FoldedFlatSceneTable {
  return scenes;
}

/** Be told when the table changes; returns the unsubscribe. */
export function subscribeFoldedFlatScenes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The scene fetched for exactly this snapshot of the handle, or `undefined`
 * when none has been — a figure loaded from a file, a handle since freed, or
 * a snapshot the kernel has replaced since the last fetch. `table` is the
 * one a reader was handed; the live table otherwise.
 */
export function foldedFlatScene(
  handle: number | null | undefined,
  snapshot: OristudioCpFoldedFigureSnapshot | null | undefined,
  table: FoldedFlatSceneTable = scenes
): OristudioCpFoldedPaperScene | undefined {
  if (handle == null || !snapshot) return undefined;
  const entry = table.get(handle);
  return entry?.snapshot === snapshot ? entry.scene : undefined;
}

/** Forget one handle's scene. Called from the handle release path. */
export function dropFoldedFlatScene(handle: number | null | undefined): void {
  if (handle == null || !scenes.has(handle)) return;
  const next = new Map(scenes);
  next.delete(handle);
  publish(next);
}

/** Drop everything — for closing a document, and for test isolation. */
export function resetFoldedFlatScenes(): void {
  if (scenes.size === 0) return;
  publish(new Map());
}

/** How many scenes are held. For tests and diagnostics. */
export function foldedFlatSceneCount(): number {
  return scenes.size;
}
