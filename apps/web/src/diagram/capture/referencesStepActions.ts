/**
 * A References step's way back to References (D6): the sheet it came from,
 * where it is now if it moved (`stepSheetNow`). References opens on the sheet
 * once it has found it by its rim — a precrease sheet and a Diagram region are
 * the same border loop — and in the mode the step came from; a sequence step,
 * on its own card, found by its line and number in the plan References shows.
 * Nothing is planned again on the way: that costs seconds to minutes and need
 * not give the same step.
 */
import { trackDiagramSourceOpened } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepById } from '../document/diagramDocument';
import { stepSheetNow } from './stepSheetNow';

/** Show the sheet a References step was sent from, in References. */
export function openDiagramStepInReferences(stepId: string): void {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (!step || step.unknown || step.source?.kind !== 'references-step') return;
  const { region, mode, card, line } = step.source;
  store.openReferencesWorkspace({
    boundary: stepSheetNow(step.source)?.boundary ?? region.boundary,
    mode,
    ...(mode === 'sequence' ? { card: { number: card, line } } : {}),
  });
  trackDiagramSourceOpened('references');
}
