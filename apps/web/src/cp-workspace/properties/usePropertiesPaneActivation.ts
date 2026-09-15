import { useEffect } from 'react';
import { runAfterPointerGesture } from '../../lib/pointerGesture';
import { isCoarsePointerSurface } from '../../platform/pointerSurface';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedCanvasObjectIdOf } from '../canvasObjects/canvasObjectKinds';

export const PROPERTIES_PANE_ID = 'cp-properties';

/**
 * Bring the Properties tab forward, if it is docked and not already showing.
 *
 * `setActive()` moves no DOM focus (verified against dockview 4.13), so the
 * only guard is the gesture deferral: activating a dock panel reflows its
 * group, and doing that inside the click or drag that made the selection
 * drops the rest of the gesture. Under a coarse pointer the pane is in the
 * drawer, which never opens on a tap-select (it is modal); nothing to do.
 */
export function revealPropertiesPane(): void {
  if (isCoarsePointerSurface()) return;
  const panel = useLayoutStore.getState().dockviewApi?.getPanel(PROPERTIES_PANE_ID);
  if (!panel || panel.api.isVisible) return;
  runAfterPointerGesture(() => useLayoutStore.getState().activatePanel(PROPERTIES_PANE_ID));
}

/**
 * Reveal the Properties pane when the canvas selection moves to a different
 * object.
 *
 * The rule is a *transition* to a different non-null id, never a release:
 * Properties is selection-driven and View is a settings page, so a user who
 * picked the View tab keeps it until they click a new object, and deselecting
 * flips nothing. Mounted by the crease-pattern panel, not by the pane: dockview
 * renders an inactive tab `onlyWhenVisible`, so the pane is unmounted exactly
 * while View is on top — the moment this has to run.
 */
export function usePropertiesPaneActivation(): void {
  useEffect(() => {
    let previous = selectedCanvasObjectIdOf(useWorkspaceStore.getState());
    return useWorkspaceStore.subscribe((state) => {
      const next = selectedCanvasObjectIdOf(state);
      if (next === previous) return;
      previous = next;
      if (next !== null) revealPropertiesPane();
    });
  }, []);
}
