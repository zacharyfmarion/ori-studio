import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { registerCanvasSessionEnder } from '../canvasObjects/canvasSessions';
import { createGestureBracket } from '../canvasObjects/gestureBracket';
import {
  foldedFigureHandleEpoch,
  foldedFigureHandleRefCount,
  releaseFoldedFigureHandle,
  retainFoldedFigureHandle,
} from './foldedFigureHandles';
import { pendingFoldedModelWrites, supersedeFoldedModelWrites } from './foldedModelWriteQueue';
import { foldedFigureListsEqual } from './foldedFigureState';

interface FoldedFigureSnapshot {
  figures: readonly OristudioCpFoldedFigureEntry[];
  activeId: string | null;
  /** Which generation of handles `figures` hold (`foldedFigureHandleEpoch`). */
  epoch: number;
}

/** The handles an open gesture holds, by the snapshot it began with. */
const heldHandles = new WeakMap<FoldedFigureSnapshot, number[]>();

/**
 * The folded-figure layer's undo bracket. Owners: `'canvas'` (the overlay
 * drag), `'orbit'` and `'zoom'` (the 3D camera gestures), `'verb'` (every
 * discrete verb — fold, refold, duplicate, delete, style), `'scope:<name>'`
 * (a continuous control's run of model updates), `'pane:<field>'`.
 *
 * A verb that changed nothing earns no entry: a fold that is refused, fails
 * or is stopped puts the list back exactly as it found it, and would otherwise
 * leave a step that undoes nothing on a project it just marked dirty.
 *
 * A commit drains the flat figures' kernel writes first, so the entry it
 * records is the one the kernel has answered — and the token is held until
 * then, refusing every other gesture meanwhile.
 *
 * The figures' kernel handles are held from begin until the entry is
 * recorded, or nothing changed, or the gesture is aborted. A Delete or a
 * Refold lets go of the live list's reference inside the act, and the entry
 * that keeps the old fold for undo is recorded only after it: unheld, that
 * handle was freed in between, and an undo put back a figure whose kernel slot
 * was gone — or, once the next fold took the slot, another figure's.
 */
export const foldedFigureGesture = createGestureBracket<FoldedFigureSnapshot>({
  layer: 'folded-figures',
  snapshot: () => {
    const state = useWorkspaceStore.getState();
    return {
      figures: state.oristudioCpFoldedFigures,
      activeId: state.oristudioCpActiveFoldedFigureId,
      epoch: foldedFigureHandleEpoch(),
    };
  },
  unchanged: (before, now) =>
    foldedFigureListsEqual(before.figures, now.figures) && before.activeId === now.activeId,
  record: (before, label) =>
    useWorkspaceStore
      .getState()
      .recordFoldedFigureHistory([...before.figures], label, before.activeId),
  hold: (before) => {
    // Only a handle something already holds: one nothing owns is not the
    // bracket's to keep alive, or to free when it lets go.
    const handles = before.figures.flatMap((figure) =>
      figure.handle != null && foldedFigureHandleRefCount(figure.handle) > 0 ? [figure.handle] : []
    );
    for (const handle of handles) retainFoldedFigureHandle(handle);
    heldHandles.set(before, handles);
  },
  release: (before) => {
    const handles = heldHandles.get(before) ?? [];
    heldHandles.delete(before);
    // A document replaced meanwhile took every handle with it, and the slots
    // may already be the new document's.
    if (before.epoch !== foldedFigureHandleEpoch()) return;
    for (const handle of handles) releaseFoldedFigureHandle(handle);
  },
  beforeCommit: () => pendingFoldedModelWrites(),
});

// An undo taken while a flat figure's model write is still in flight: the
// queued patch is dropped, the write must not land on the restored list, and
// the kernel must be brought back to it once the write has answered.
// Unconditional — a discrete toggle's write can be in flight with no bracket
// open at all.
registerCanvasSessionEnder((reason) => {
  if (reason === 'history') supersedeFoldedModelWrites();
}, 'session');
