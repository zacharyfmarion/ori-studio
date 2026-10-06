import { useWorkspaceStore } from '../store/workspaceStore';
import { simulatorPinsFor } from '../store/workspaceStore/slices/simulatorSlice';
import type { WorkspaceState } from '../store/workspaceStore/types';
import type { SimulatorToolSnapshot, SimulatorToolState } from './tools/toolState';

/** What Simulate's pins are scoped to: the fold revision, and which source is simulated. */
export interface SimulateToolScope {
  revision: number;
  sourceKey: string;
}

let snapshot: SimulatorToolSnapshot | null = null;

/** The slice's tool and options, as the same object until either changes. */
function snapshotOf(state: WorkspaceState): SimulatorToolSnapshot {
  if (
    snapshot?.activeToolId !== state.simulatorActiveToolId ||
    snapshot.options !== state.simulatorToolOptions
  ) {
    snapshot = { activeToolId: state.simulatorActiveToolId, options: state.simulatorToolOptions };
  }
  return snapshot;
}

/**
 * Simulate's tool state: the workspace slice behind the tools' port.
 *
 * The slice keeps the tool in hand across a workspace switch, as Edit's tool
 * survives one, and keeps the pins per source until the fold revision moves on,
 * when `setSimulatorPins` drops every other source's (`simulatorSlice.ts`).
 */
export const SIMULATE_TOOL_STATE: SimulatorToolState<SimulateToolScope> = {
  subscribe: (listener) => useWorkspaceStore.subscribe(() => listener()),
  getSnapshot: () => snapshotOf(useWorkspaceStore.getState()),
  getPins: (scope) =>
    simulatorPinsFor(useWorkspaceStore.getState().simulatorPins, scope.revision, scope.sourceKey),
  setPins: (scope, faces) =>
    useWorkspaceStore.getState().setSimulatorPins(scope.revision, scope.sourceKey, faces),
  setActiveTool: (id) => useWorkspaceStore.getState().setSimulatorActiveTool(id),
  setOption: (id, value) => useWorkspaceStore.getState().setSimulatorToolOption(id, value),
};
