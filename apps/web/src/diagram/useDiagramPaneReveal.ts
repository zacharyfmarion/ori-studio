import { useEffect } from 'react';
import { runAfterPointerGesture } from '../lib/pointerGesture';
import { isCoarsePointerSurface } from '../platform/pointerSurface';
import { useLayoutStore } from '../store/layoutStore';
import { selectionPaneReveal } from '../store/sidePaneReveal';
import { useWorkspaceStore } from '../store/workspaceStore';
import { annotatingSelectionId } from '../store/workspaceStore/diagramState';

export const DIAGRAM_STEP_PANE_ID = 'diagram-step';
export const DIAGRAM_PAGE_PANE_ID = 'diagram-page';
export const DIAGRAM_LAYERS_PANE_ID = 'diagram-layers';

type DiagramPaneId = typeof DIAGRAM_STEP_PANE_ID | typeof DIAGRAM_PAGE_PANE_ID | typeof DIAGRAM_LAYERS_PANE_ID;

/**
 * Bring the Step or Page tab forward (D13), as the Edit workspace brings its
 * Properties forward (`selectionPaneReveal`): on a fine pointer only — on
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

/** Layers, brought forward by a mark selected and giving its tab back when it is let go, as Edit's Properties is. */
const layers = selectionPaneReveal(DIAGRAM_LAYERS_PANE_ID, () => annotatingSelectionId(useWorkspaceStore.getState()) !== null);

/**
 * The reveal rules, on transitions only, so a tab the user picks stays until
 * the next one: switching to Pages brings Page forward and back to Steps
 * brings Step; selecting a different step brings Step; selecting a different
 * mark brings Layers, and letting it go gives back the tab Layers covered —
 * unless the user changed the tab since, as Edit's Properties does. Mounted
 * by the Diagram panel, which is mounted whichever tab is on top of the side
 * column.
 */
export function useDiagramPaneReveal(): void {
  useEffect(() => {
    const initial = useWorkspaceStore.getState();
    let view = initial.diagramView;
    let selected = initial.diagramSelectedStepId;
    let layer = annotatingSelectionId(initial);
    return useWorkspaceStore.subscribe((state) => {
      const nextLayer = annotatingSelectionId(state);
      if (state.diagramView !== view) {
        view = state.diagramView;
        selected = state.diagramSelectedStepId;
        layer = nextLayer;
        revealDiagramPane(view === 'pages' ? DIAGRAM_PAGE_PANE_ID : DIAGRAM_STEP_PANE_ID);
        return;
      }
      if (state.diagramSelectedStepId !== selected) {
        selected = state.diagramSelectedStepId;
        if (selected !== null) revealDiagramPane(DIAGRAM_STEP_PANE_ID);
      }
      if (nextLayer === layer) return;
      layer = nextLayer;
      if (layer !== null) layers.reveal();
      else layers.restore();
    });
  }, []);
}

/** Tests only. */
export const resetDiagramPaneRevealForTests = layers.reset;
