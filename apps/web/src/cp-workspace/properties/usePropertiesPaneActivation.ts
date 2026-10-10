import { useEffect } from 'react';
import { selectionPaneReveal } from '../../store/sidePaneReveal';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedCanvasObjectIdOf } from '../canvasObjects/canvasObjectKinds';

export const PROPERTIES_PANE_ID = 'cp-properties';

const properties = selectionPaneReveal(
  PROPERTIES_PANE_ID,
  () => selectedCanvasObjectIdOf(useWorkspaceStore.getState()) !== null
);

/** Bring the Properties tab forward, if it is docked and not already showing ({@link selectionPaneReveal}). */
export const revealPropertiesPane = properties.reveal;

/** Put back the tab {@link revealPropertiesPane} displaced, once nothing is selected. */
export const restoreDisplacedPane = properties.restore;

/**
 * Reveal the Properties pane when the canvas selection moves to a different
 * object, and give the displaced tab back when the selection is released.
 *
 * The reveal rule is a *transition* to a different non-null id: Properties is
 * selection-driven and View is a settings page, so a user who picked the View
 * tab keeps it until they click a new object. The release rule is the
 * converse, and only for a tab the reveal itself displaced — a Properties tab
 * the user chose stays. Mounted by the crease-pattern panel, not by the pane:
 * the rule is about the canvas's selection, and the pane is not always there
 * — under a coarse pointer it is not docked at all. (While View is on top,
 * dockview's `onlyWhenVisible` takes the pane's content out of the page; its
 * components stay mounted.)
 */
export function usePropertiesPaneActivation(): void {
  useEffect(() => {
    let previous = selectedCanvasObjectIdOf(useWorkspaceStore.getState());
    return useWorkspaceStore.subscribe((state) => {
      const next = selectedCanvasObjectIdOf(state);
      if (next === previous) return;
      previous = next;
      if (next !== null) revealPropertiesPane();
      else restoreDisplacedPane();
    });
  }, []);
}

/** Tests only. */
export const resetPropertiesPaneActivationForTests = properties.reset;
