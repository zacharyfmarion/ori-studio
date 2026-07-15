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
  const treeHistoryPastCount = state.documentMode === 'tree' ? state.historyPast.length : 0;
  const treeHistoryFutureCount = state.documentMode === 'tree' ? state.historyFuture.length : 0;
  const cpHistoryPastCount = state.oristudioCpDocument
    ? state.oristudioCpHistoryPast.length
    : 0;
  const cpHistoryFutureCount = state.oristudioCpDocument
    ? state.oristudioCpHistoryFuture.length
    : 0;

  return {
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
    oristudioCpSelectedPointCount: state.oristudioCpSelection.points.length,
    oristudioCpSelectedCircleCount: state.oristudioCpSelection.circles.length,
    historyPastCount: activeOrFallbackHistoryCount(
      state.activeEditingSurface,
      treeHistoryPastCount,
      cpHistoryPastCount
    ),
    historyFutureCount: activeOrFallbackHistoryCount(
      state.activeEditingSurface,
      treeHistoryFutureCount,
      cpHistoryFutureCount
    ),
    clipboard: state.clipboard,
    selection: state.selection,
  };
}

export function selectWorkspaceCapabilities(state: WorkspaceState): WorkspaceCapabilities {
  return getWorkspaceCapabilities(workspaceCapabilityInput(state));
}
