import { useEffect } from 'react';
import { runAfterPointerGesture } from '../lib/pointerGesture';
import { isCoarsePointerSurface } from '../platform/pointerSurface';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';

export const DIAGRAM_STEP_PANE_ID = 'diagram-step';
export const DIAGRAM_PAGE_PANE_ID = 'diagram-page';

type DiagramPaneId = typeof DIAGRAM_STEP_PANE_ID | typeof DIAGRAM_PAGE_PANE_ID;

/**
 * Bring the Step or Page tab forward (D13), as the Edit workspace brings its
 * Properties forward (`revealPropertiesPane`): on a fine pointer only — on
 * touch the panes are a modal drawer, which a selection never opens — and
 * after the gesture that asked, since activating a tab reflows its group.
 */
export function revealDiagramPane(id: DiagramPaneId): void {
  if (isCoarsePointerSurface()) return;
  const docked = useLayoutStore.getState().dockviewApi?.getPanel(id);
  if (!docked || docked.api.isVisible) return;
  runAfterPointerGesture(() => {
    const panel = useLayoutStore.getState().dockviewApi?.getPanel(id);
    if (!panel || panel.api.isVisible) return;
    useLayoutStore.getState().activatePanel(id);
  });
}

/**
 * Bring the Step or Page tab forward because the reader asked for it (Edit
 * page setup): from any workspace, which switches to the Diagram, and on
 * touch in the drawer, which a reveal never opens. After the gesture that
 * asked, as a reveal is.
 */
export function showDiagramPane(id: DiagramPaneId): void {
  runAfterPointerGesture(() => useLayoutStore.getState().activatePanel(id));
}

/**
 * The reveal rules, on transitions only, so a tab the user picks stays until
 * the next one: switching to Pages brings Page forward and back to Steps
 * brings Step; selecting a different step brings Step. Mounted by the Diagram
 * panel, which is mounted whichever tab is on top of the side column.
 */
export function useDiagramPaneReveal(): void {
  useEffect(() => {
    const initial = useWorkspaceStore.getState();
    let view = initial.diagramView;
    let selected = initial.diagramSelectedStepId;
    return useWorkspaceStore.subscribe((state) => {
      if (state.diagramView !== view) {
        view = state.diagramView;
        selected = state.diagramSelectedStepId;
        revealDiagramPane(view === 'pages' ? DIAGRAM_PAGE_PANE_ID : DIAGRAM_STEP_PANE_ID);
        return;
      }
      if (state.diagramSelectedStepId === selected) return;
      selected = state.diagramSelectedStepId;
      if (selected !== null) revealDiagramPane(DIAGRAM_STEP_PANE_ID);
    });
  }, []);
}
