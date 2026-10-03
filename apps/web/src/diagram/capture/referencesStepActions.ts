/**
 * A diagram step's ways to References (D6): back to the sheet a step was sent
 * from, and From References…, which asks References for a step's picture.
 * References opens on the sheet once it has found it by its rim — a precrease
 * sheet and a Diagram region are the same border loop — and in the mode the
 * step came from. Nothing is planned again on the way: that costs seconds to
 * minutes and need not give the same step.
 */
import { trackDiagramSourceOpened } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepIndex } from '../document/diagramDocument';

/** Show the sheet a References step was sent from, in References. */
export function openDiagramStepInReferences(stepId: string): void {
  const store = useWorkspaceStore.getState();
  const step = store.diagram?.steps[stepIndex(store.diagram, stepId)];
  if (!step || step.unknown || step.source?.kind !== 'references-step') return;
  const { region, mode } = step.source;
  store.openReferencesWorkspace({ boundary: region.boundary, mode });
  trackDiagramSourceOpened('references');
}

/**
 * Ask References for a step's picture: References opens, and its next Send to
 * diagram fills this step — while it is still empty — rather than adding one.
 */
export function askReferencesForStep(stepId: string): void {
  const store = useWorkspaceStore.getState();
  if (!store.requestDiagramStepFromReferences(stepId)) return;
  store.openReferencesWorkspace();
}
