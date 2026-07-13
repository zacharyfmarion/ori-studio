import {
  getWorkspaceCapabilities,
  type WorkspaceCapabilities,
  type WorkspaceCapabilityInput,
} from '../../lib/workspaceCapabilities';
import type { WorkspaceState } from './types';

export function activeOrFallbackHistoryCount(
  activeSurface: WorkspaceState['activeEditingSurface'],
  treeCount: number,
  cpCount: number
): number {
  const activeCount = activeSurface === 'crease-pattern' ? cpCount : treeCount;
  if (activeCount > 0) return activeCount;
  return activeSurface === 'crease-pattern' ? treeCount : cpCount;
}

export function workspaceCapabilityInput(state: WorkspaceState): WorkspaceCapabilityInput {
  const context = state.activeEditingContext;
  const isBpContext = context === 'bp-tree' || context === 'bp-packing';
  const treeHistoryPastCount = state.documentMode === 'tree' ? state.historyPast.length : 0;
  const treeHistoryFutureCount = state.documentMode === 'tree' ? state.historyFuture.length : 0;
  const cpHistoryPastCount = state.oristudioCpDocument
    ? state.oristudioCpHistoryPast.length
    : 0;
  const cpHistoryFutureCount = state.oristudioCpDocument
    ? state.oristudioCpHistoryFuture.length
    : 0;

  // BP undo/redo tracks its own snapshot history, so the Edit menu must read that
  // count in a BP context rather than the (empty) TreeMaker/CP stacks.
  const historyPastCount = isBpContext
    ? state.oristudioBpHistoryPast.length
    : activeOrFallbackHistoryCount(
        state.activeEditingSurface,
        treeHistoryPastCount,
        cpHistoryPastCount
      );
  const historyFutureCount = isBpContext
    ? state.oristudioBpHistoryFuture.length
    : activeOrFallbackHistoryCount(
        state.activeEditingSurface,
        treeHistoryFutureCount,
        cpHistoryFutureCount
      );

  return {
    activeEditingContext: context,
    documentMode: state.documentMode,
    activeEditingSurface: state.activeEditingSurface,
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
    historyPastCount,
    historyFutureCount,
    clipboard: state.clipboard,
    selection: state.selection,
  };
}

export function selectWorkspaceCapabilities(state: WorkspaceState): WorkspaceCapabilities {
  return getWorkspaceCapabilities(workspaceCapabilityInput(state));
}
