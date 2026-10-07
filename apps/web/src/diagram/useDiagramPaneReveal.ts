import { useEffect } from 'react';
import { runAfterPointerGesture } from '../lib/pointerGesture';
import { isCoarsePointerSurface } from '../platform/pointerSurface';
import { useLayoutStore } from '../store/layoutStore';
import { selectionPaneReveal } from '../store/sidePaneReveal';
import { useWorkspaceStore } from '../store/workspaceStore';
import { layersSelectionId } from '../store/workspaceStore/diagramState';

export const DIAGRAM_STEP_PANE_ID = 'diagram-step';
export const DIAGRAM_PAGE_PANE_ID = 'diagram-page';
export const DIAGRAM_LAYERS_PANE_ID = 'diagram-layers';

type DiagramPaneId = typeof DIAGRAM_STEP_PANE_ID | typeof DIAGRAM_PAGE_PANE_ID | typeof DIAGRAM_LAYERS_PANE_ID;

/**
 * Bring the Step or Page tab forward (D13), as the Edit workspace brings its
 * Properties forward (`selectionPaneReveal`): on a fine pointer only — on
 * touch the panes are a modal drawer, which a selection never opens — and
 * after the gesture that asked, since activating a tab reflows its group;
 * then only while `wanted` still says so.
 */
export function revealDiagramPane(id: DiagramPaneId, wanted: () => boolean = () => true): void {
  if (isCoarsePointerSurface()) return;
  const docked = useLayoutStore.getState().dockviewApi?.getPanel(id);
  if (!docked || docked.api.isVisible) return;
  runAfterPointerGesture(() => {
    const panel = useLayoutStore.getState().dockviewApi?.getPanel(id);
    if (!panel || panel.api.isVisible || !wanted()) return;
    useLayoutStore.getState().activatePanel(id);
  });
}

/** Whether a mark or a frame is selected on the step open in Annotate: what Layers is brought forward for. */
const layerSelected = () => layersSelectionId(useWorkspaceStore.getState()) !== null;

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
 * Layers, brought forward by a mark selected — or an enlarged step's frame
 * (Revision 2) — and giving its tab back when it is let go, as Edit's
 * Properties is.
 */
const layers = selectionPaneReveal(DIAGRAM_LAYERS_PANE_ID, layerSelected);

/**
 * The reveal rules, on transitions only, so a tab the user picks stays until
 * the next one: switching to Pages brings Page forward and back to Steps
 * brings Step; selecting a different step brings Step, unless a mark there
 * is selected with it; selecting a different mark brings Layers, and
 * letting it go gives back the tab Layers covered —
 * unless the user changed the tab since, as Edit's Properties does. Mounted
 * by the Diagram panel, which is mounted whichever tab is on top of the side
 * column.
 */
export function useDiagramPaneReveal(): void {
  useEffect(() => {
    const initial = useWorkspaceStore.getState();
    let view = initial.diagramView;
    let selected = initial.diagramSelectedStepId;
    let layer = layersSelectionId(initial);
    return useWorkspaceStore.subscribe((state) => {
      const nextLayer = layersSelectionId(state);
      if (state.diagramView !== view) {
        view = state.diagramView;
        selected = state.diagramSelectedStepId;
        layer = nextLayer;
        revealDiagramPane(view === 'pages' ? DIAGRAM_PAGE_PANE_ID : DIAGRAM_STEP_PANE_ID);
        return;
      }
      if (state.diagramSelectedStepId !== selected) {
        selected = state.diagramSelectedStepId;
        // Not when the same gesture selects a mark or a frame there: a Go to verb in Layers keeps Layers.
        if (selected !== null) revealDiagramPane(DIAGRAM_STEP_PANE_ID, () => !layerSelected());
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
