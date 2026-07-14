import {
  getWorkspaceCapabilities,
  type WorkspaceCapabilities,
  type WorkspaceCapabilityInput,
} from '../../lib/workspaceCapabilities';
import type { EditingContext } from '../../workspaces/editingContext';
import type { WorkspaceState } from './types';

/** The undo/redo count for the active editing context's own history stack. */
export function historyCountForContext(
  context: EditingContext,
  bpCount: number,
  cpCount: number,
  treeCount: number
): number {
  if (context === 'bp-tree' || context === 'bp-packing') return bpCount;
  if (context === 'crease-pattern') return cpCount;
  if (context === 'treemaker-tree') return treeCount;
  return 0;
}

export function workspaceCapabilityInput(state: WorkspaceState): WorkspaceCapabilityInput {
  const context = state.activeEditingContext;
  const bpSelection = state.oristudioBpDocument?.selection;
  const bpRoot = state.oristudioBpDocument?.snapshot?.tree?.rootVertexId;
  const hasDeletableBpSelection =
    (bpSelection?.kind === 'bp-vertex' && bpSelection.id !== bpRoot) ||
    bpSelection?.kind === 'bp-edge';
  // The Edit menu's undo/redo count comes from the active context's history:
  // BP snapshots, the CP editor's stack, or the TreeMaker tree stack.
  const historyPastCount = historyCountForContext(
    context,
    state.oristudioBpHistoryPast.length,
    state.oristudioCpDocument ? state.oristudioCpHistoryPast.length : 0,
    state.historyPast.length
  );
  const historyFutureCount = historyCountForContext(
    context,
    state.oristudioBpHistoryFuture.length,
    state.oristudioCpDocument ? state.oristudioCpHistoryFuture.length : 0,
    state.historyFuture.length
  );

  return {
    activeEditingContext: context,
    engineReady: state.engineReady,
    status: state.status,
    edgeCount: state.project.edges.length,
    creaseCount: state.project.creases.length,
    facetCount: state.project.facets.length,
    hasEditableCreasePattern: state.oristudioCpDocument !== null,
    hasImportedCreasePattern: state.importedCreasePattern !== null,
    hasSimulationModel: state.foldArtifacts?.simulation_model != null,
    oristudioCpSelectedLineCount: state.oristudioCpSelection.lines.length,
    oristudioCpSelectedVertexCount: state.oristudioCpSelection.vertices?.length ?? 0,
    oristudioCpSelectedPointCount: state.oristudioCpSelection.points.length,
    oristudioCpSelectedCircleCount: state.oristudioCpSelection.circles.length,
    hasDeletableBpSelection,
    historyPastCount,
    historyFutureCount,
    clipboard: state.clipboard,
    selection: state.selection,
  };
}

export function selectWorkspaceCapabilities(state: WorkspaceState): WorkspaceCapabilities {
  return getWorkspaceCapabilities(workspaceCapabilityInput(state));
}
