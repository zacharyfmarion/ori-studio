import { useWorkspaceStore } from '../../store/workspaceStore';
import { createGestureBracket } from '../canvasObjects/gestureBracket';
import type { InlineSimulation } from './inlineSimulation';

/**
 * The inline-simulation layer's undo bracket. Owners: `'canvas'` (the overlay
 * drag) and `'pane:<field>'`. Add, delete and refresh push their own entries
 * from the store and never open this.
 */
export const inlineSimulationGesture = createGestureBracket<readonly InlineSimulation[]>({
  layer: 'inline-simulations',
  snapshot: () => useWorkspaceStore.getState().oristudioCpInlineSimulations,
  unchanged: (before, now) => before === now,
  record: (before, label) =>
    useWorkspaceStore.getState().recordInlineSimulationHistory([...before], label),
});
