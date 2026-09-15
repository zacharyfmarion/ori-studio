import { useWorkspaceStore } from '../../store/workspaceStore';
import { createGestureBracket } from '../canvasObjects/gestureBracket';
import { pendingFoldedModelWrites } from '../folded/foldedModelWriteQueue';
import type { CanvasAnnotation } from './annotation';

/**
 * The annotation layer's undo bracket — images, text boxes and regions share
 * one list and so one bracket. Owners today: `'canvas'` (the overlay drag and
 * the floating toolbars), `'text-session'` (an open text edit), `'verb'` (the
 * discrete verbs), `'chip'` (a region chip drag), and `'pane:<field>'` (the
 * Properties pane).
 *
 * Identity is the change test: every store write rebuilds the list, so a
 * gesture that wrote nothing is the only one that records nothing.
 *
 * Overlay entries capture every layer live, so this commit too waits for the
 * folded figures' kernel writes to land — see `gestureBracket.ts`.
 */
export const annotationGesture = createGestureBracket<readonly CanvasAnnotation[]>({
  layer: 'annotations',
  snapshot: () => useWorkspaceStore.getState().oristudioCpAnnotations,
  unchanged: (before, now) => before === now,
  record: (before, label) =>
    useWorkspaceStore.getState().recordAnnotationHistory([...before], label),
  beforeCommit: () => pendingFoldedModelWrites(),
});
