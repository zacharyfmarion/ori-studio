import type { StoreApi } from 'zustand';
import {
  folded3dAuxKeyOf,
  folded3dAuxLinesOf,
  setFolded3dAuxLines,
} from '../../cp-workspace/folded/folded3dAuxLines';
import {
  askForAuxLines,
  cpAuxLinesKey,
  NO_AUX_LINES_KEY,
} from '../../cp-workspace/folded/foldedAuxSource';
import {
  foldedFigureHandleEpoch,
  foldedFigureHandleRefCount,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { getOristudioCpFolded3dAuxLines } from './oristudioCpRuntime';
import type { WorkspaceState } from './types';

const NO_LINES = { faces: [], points: [] };

/** What one ask is for: a figure's aux lines under the document's aux key. */
interface AuxRequest {
  documentHandle: number;
  auxKey: string;
  settled: Promise<void>;
}

/** The latest ask per handle; a newer one replaces it, and the older lands nothing. */
const latest = new Map<number, AuxRequest>();

/**
 * Keep every 3D figure's aux lines the document's own.
 *
 * A 3D figure shows the document's auxiliary lines carried onto its faces
 * (`folded3dAuxLines.ts`), and nothing folds one, so an aux line drawn on the
 * crease pattern after the fold should show on the figure without a refold —
 * the flat figure's paper scene does the same (`useFoldedFlatAux`). So when the
 * document's aux lines change, or a 3D figure gains a handle, each figure asks
 * the kernel again; when the answer lands, the stored pictures are rebuilt
 * (`refreshOristudioCpFolded3dScenes`), which is what the canvas draws for a
 * figure without a window and what the `.osf` keeps. A window rebuilds its
 * mesh from the table itself.
 *
 * Here rather than beside the canvas because the picture it keeps current is
 * the store's: an export or a save with no canvas mounted draws the same aux
 * lines the window does. A document with no aux lines asks nothing.
 */
export function installFolded3dAuxLinesSync(store: StoreApi<WorkspaceState>): () => void {
  const run = () => {
    const state = store.getState();
    const document = state.oristudioCpDocument;
    if (!document) return;
    const auxKey = cpAuxLinesKey(document.geometry);
    for (const figure of state.oristudioCpFoldedFigures) {
      // Handle 0 is a valid wasm slot; only null/undefined means "no kernel".
      if (!figure.folded3d || figure.handle == null) continue;
      if (folded3dAuxKeyOf(figure.handle) === auxKey) continue;
      void fetchFolded3dAuxLines(store, figure.handle, document.handle, auxKey);
    }
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (
      state.oristudioCpFoldedFigures !== previous.oristudioCpFoldedFigures ||
      state.oristudioCpDocument !== previous.oristudioCpDocument
    ) {
      run();
    }
  });
  run();
  return unsubscribe;
}

/**
 * Ask for a figure's aux lines under `auxKey`, and rebuild the stored pictures
 * when they land. One ask per (handle, key): asking again while it is in
 * flight waits on the same one.
 */
export function fetchFolded3dAuxLines(
  store: Pick<StoreApi<WorkspaceState>, 'getState'>,
  handle: number,
  documentHandle: number,
  auxKey: string
): Promise<void> {
  const current = latest.get(handle);
  if (current && current.auxKey === auxKey && current.documentHandle === documentHandle) {
    return current.settled;
  }
  const epoch = foldedFigureHandleEpoch();
  const request: AuxRequest = { documentHandle, auxKey, settled: Promise.resolve() };
  const wanted = () =>
    latest.get(handle) === request &&
    foldedFigureHandleEpoch() === epoch &&
    foldedFigureHandleRefCount(handle) > 0;
  // Registered before the ask starts: a key with nothing to carry answers
  // without waiting, and has to find itself the latest when it does.
  latest.set(handle, request);
  request.settled = (async () => {
    // Nothing to carry: the answer is known without asking.
    const lines =
      auxKey === NO_AUX_LINES_KEY
        ? NO_LINES
        : await askForAuxLines(
            () => getOristudioCpFolded3dAuxLines(handle, documentHandle),
            wanted,
            'folded-3d-aux'
          );
    if (lines && wanted()) {
      const before = folded3dAuxLinesOf(handle);
      setFolded3dAuxLines(handle, auxKey, lines);
      // A figure that had none and still has none draws what it drew.
      if ((before?.faces.length ?? 0) > 0 || lines.faces.length > 0) {
        store.getState().refreshOristudioCpFolded3dScenes();
      }
    }
    if (latest.get(handle) === request) latest.delete(handle);
  })();
  return request.settled;
}

/**
 * Wait for a figure's aux lines to be the document's: what an export awaits
 * before painting, so a line drawn a moment ago is on the page.
 */
export async function folded3dAuxLinesSettled(
  store: Pick<StoreApi<WorkspaceState>, 'getState'>,
  handle: number | null | undefined
): Promise<void> {
  if (handle == null) return;
  const document = store.getState().oristudioCpDocument;
  if (!document) return;
  const auxKey = cpAuxLinesKey(document.geometry);
  if (folded3dAuxKeyOf(handle) === auxKey) return;
  await fetchFolded3dAuxLines(store, handle, document.handle, auxKey);
}

/** Forget every ask in flight. For test isolation. */
export function resetFolded3dAuxLinesSync(): void {
  latest.clear();
}
