/**
 * Where a 3D figure's aux lines live between draws.
 *
 * The document's auxiliary (`Cyan3`) lines, carried onto a 3D figure's faces
 * by the kernel (`folded_figure_3d_aux_lines`). Nothing folds an aux line, so
 * they are the document's as they stand now rather than a fold's: the store
 * asks again whenever they change (`folded3dAuxLinesSync.ts`), and the mesh
 * splits them among the layers that show them (`folded3dMesh`).
 *
 * Keyed by the wasm handle like the render models (`folded3dRenderModels.ts`)
 * and released with it. An external store, read with `useSyncExternalStore`:
 * the table is replaced, never mutated, so a window holding the lines it was
 * handed rebuilds its mesh when new ones land.
 */
import { useSyncExternalStore } from 'react';
import type { OristudioCpFolded3dAuxLines } from '../../engine/oristudioCpTypes';

export interface Folded3dAuxEntry {
  /** The document's aux lines these are (`cpAuxLinesKey`). */
  auxKey: string;
  lines: OristudioCpFolded3dAuxLines;
}

export type Folded3dAuxTable = ReadonlyMap<number, Folded3dAuxEntry>;

let table: Folded3dAuxTable = new Map();
const listeners = new Set<() => void>();

function publish(next: Folded3dAuxTable): void {
  table = next;
  for (const listener of listeners) listener();
}

/** Remember a handle's aux lines under the document's aux key. */
export function setFolded3dAuxLines(
  handle: number | null | undefined,
  auxKey: string,
  lines: OristudioCpFolded3dAuxLines
): void {
  // Handle 0 is a valid wasm slot index; only null/undefined means "not ready".
  if (handle == null) return;
  publish(new Map(table).set(handle, { auxKey, lines }));
}

/** The handle's aux lines, or `null` when none have landed. */
export function folded3dAuxLinesOf(
  handle: number | null | undefined
): OristudioCpFolded3dAuxLines | null {
  if (handle == null) return null;
  return table.get(handle)?.lines ?? null;
}

/** Which of the document's aux lines the handle holds, or `undefined` for none yet. */
export function folded3dAuxKeyOf(handle: number | null | undefined): string | undefined {
  if (handle == null) return undefined;
  return table.get(handle)?.auxKey;
}

/** The current table, for `useSyncExternalStore`. */
export function folded3dAuxTable(): Folded3dAuxTable {
  return table;
}

/** Be told when the table changes; returns the unsubscribe. */
export function subscribeFolded3dAuxLines(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The handle's aux lines, live: a window's mesh is rebuilt when they land. */
export function useFolded3dAuxLines(
  handle: number | null | undefined
): OristudioCpFolded3dAuxLines | null {
  const current = useSyncExternalStore(subscribeFolded3dAuxLines, folded3dAuxTable, folded3dAuxTable);
  return handle == null ? null : (current.get(handle)?.lines ?? null);
}

/** Forget one handle's aux lines. Called from the handle release path. */
export function dropFolded3dAuxLines(handle: number | null | undefined): void {
  if (handle == null || !table.has(handle)) return;
  const next = new Map(table);
  next.delete(handle);
  publish(next);
}

/** Drop everything — for closing a document, and for test isolation. */
export function resetFolded3dAuxLines(): void {
  if (table.size === 0) return;
  publish(new Map());
}
