import { useWorkspaceStore } from '../../store/workspaceStore';

/**
 * The inline-simulation layer's verbs a surface outside the panel can call.
 * `removeOristudioCpInlineSimulation` pushes its own history entry, so there
 * is no bracket to open here; the layer's bracket
 * (`inlineSimulationGesture`) is for the box drags.
 */
export function deleteInlineSimulation(id: string): void {
  useWorkspaceStore.getState().removeOristudioCpInlineSimulation(id);
}
