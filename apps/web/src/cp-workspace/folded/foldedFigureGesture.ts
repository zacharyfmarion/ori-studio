import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { registerCanvasSessionEnder } from '../canvasObjects/canvasSessions';
import { createGestureBracket } from '../canvasObjects/gestureBracket';
import { pendingFoldedModelWrites, supersedeFoldedModelWrites } from './foldedModelWriteQueue';
import { foldedFigureListsEqual } from './foldedFigureState';

interface FoldedFigureSnapshot {
  figures: readonly OristudioCpFoldedFigureEntry[];
  activeId: string | null;
}

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
 */
export const foldedFigureGesture = createGestureBracket<FoldedFigureSnapshot>({
  layer: 'folded-figures',
  snapshot: () => {
    const state = useWorkspaceStore.getState();
    return {
      figures: state.oristudioCpFoldedFigures,
      activeId: state.oristudioCpActiveFoldedFigureId,
    };
  },
  unchanged: (before, now) =>
    foldedFigureListsEqual(before.figures, now.figures) && before.activeId === now.activeId,
  record: (before, label) =>
    useWorkspaceStore
      .getState()
      .recordFoldedFigureHistory([...before.figures], label, before.activeId),
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
