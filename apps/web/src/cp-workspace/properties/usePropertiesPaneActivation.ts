import { useEffect } from 'react';
import type { IDockviewPanel } from 'dockview';
import { runAfterPointerGesture } from '../../lib/pointerGesture';
import { isCoarsePointerSurface } from '../../platform/pointerSurface';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedCanvasObjectIdOf } from '../canvasObjects/canvasObjectKinds';

export const PROPERTIES_PANE_ID = 'cp-properties';

/**
 * A reveal this module made, and what it displaced: the tab that was on top
 * of the Properties tab's group. Held until the selection is released, when
 * that tab comes back — or until the user changes that group's tab
 * themselves, after which their choice stands and a release flips nothing.
 */
interface AutoReveal {
  /** The panel as activated; a rebuilt dock hands out a different object. */
  panel: IDockviewPanel;
  displaced: string;
  dispose: () => void;
}

let autoReveal: AutoReveal | null = null;

function disarm(): void {
  autoReveal?.dispose();
  autoReveal = null;
}

function propertiesPanel(): IDockviewPanel | null {
  return useLayoutStore.getState().dockviewApi?.getPanel(PROPERTIES_PANE_ID) ?? null;
}

/**
 * Bring the Properties tab forward, if it is docked and not already showing.
 *
 * `setActive()` moves no DOM focus (verified against dockview 4.13), so the
 * only guard is the gesture deferral: activating a dock panel reflows its
 * group, and doing that inside the click or drag that made the selection
 * drops the rest of the gesture. Under a coarse pointer the pane is in the
 * drawer, which never opens on a tap-select (it is modal); nothing to do.
 *
 * A tab the user already had on top is left alone, and is then theirs: the
 * release that follows leaves it too. A tab this reveal displaced is
 * remembered for {@link restoreDisplacedPane}.
 */
export function revealPropertiesPane(): void {
  if (isCoarsePointerSurface()) return;
  const docked = propertiesPanel();
  if (!docked || docked.api.isVisible) return;
  runAfterPointerGesture(() => {
    // Re-resolved: the gesture may have outlived the selection, or the dock.
    const panel = propertiesPanel();
    if (!panel || panel.api.isVisible) return;
    if (selectedCanvasObjectIdOf(useWorkspaceStore.getState()) === null) return;
    const displaced = panel.group.activePanel?.id ?? null;
    disarm();
    useLayoutStore.getState().activatePanel(PROPERTIES_PANE_ID);
    if (displaced === null || displaced === PROPERTIES_PANE_ID) return;
    // Subscribed after the activation, whose own change has already fired:
    // the next change of this group's tab is the user's, and ends the reveal.
    const subscription = panel.group.api.onDidActivePanelChange(disarm);
    autoReveal = { panel, displaced, dispose: () => subscription.dispose() };
  });
}

/**
 * Put back the tab {@link revealPropertiesPane} displaced, once nothing is
 * selected and the pane would show its empty line. Only while the reveal is
 * still the reason Properties is on top — the same panel, still showing, its
 * group's tab untouched since — and only if the displaced tab is still
 * docked. Deferred like the reveal: a deselect is a press on empty canvas.
 */
export function restoreDisplacedPane(): void {
  const armed = autoReveal;
  if (!armed) return;
  disarm();
  runAfterPointerGesture(() => {
    if (selectedCanvasObjectIdOf(useWorkspaceStore.getState()) !== null) return;
    const api = useLayoutStore.getState().dockviewApi;
    const panel = api?.getPanel(PROPERTIES_PANE_ID);
    if (!panel || panel !== armed.panel || !panel.api.isVisible) return;
    if (!api?.getPanel(armed.displaced)) return;
    useLayoutStore.getState().activatePanel(armed.displaced);
  });
}

/**
 * Reveal the Properties pane when the canvas selection moves to a different
 * object, and give the displaced tab back when the selection is released.
 *
 * The reveal rule is a *transition* to a different non-null id: Properties is
 * selection-driven and View is a settings page, so a user who picked the View
 * tab keeps it until they click a new object. The release rule is the
 * converse, and only for a tab the reveal itself displaced — a Properties tab
 * the user chose stays. Mounted by the crease-pattern panel, not by the pane:
 * dockview renders an inactive tab `onlyWhenVisible`, so the pane is
 * unmounted exactly while View is on top — the moment this has to run.
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
export function resetPropertiesPaneActivationForTests(): void {
  disarm();
}
