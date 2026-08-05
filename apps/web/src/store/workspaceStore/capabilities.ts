import { selectHistoryFuture, selectHistoryPast, selectOristudioBpDocument, selectOristudioBpHistoryFuture, selectOristudioBpHistoryPast, selectOristudioBpSelection, selectProject, selectSelection } from './designTabs';
import {
  getWorkspaceCapabilities,
  type WorkspaceCapabilities,
  type WorkspaceCapabilityInput,
} from '../../lib/workspaceCapabilities';
import i18n from '../../i18n';
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
  const bpSelection = selectOristudioBpSelection(state);
  const bpRoot = selectOristudioBpDocument(state)?.snapshot?.tree?.rootVertexId;
  const hasDeletableBpSelection =
    (bpSelection?.kind === 'bp-vertex' && bpSelection.id !== bpRoot) ||
    bpSelection?.kind === 'bp-edge';
  // The Edit menu's undo/redo count comes from the active context's history:
  // BP snapshots, the CP editor's stack, or the TreeMaker tree stack.
  const historyPastCount = historyCountForContext(
    context,
    selectOristudioBpHistoryPast(state).length,
    state.oristudioCpDocument ? state.oristudioCpHistoryPast.length : 0,
    selectHistoryPast(state).length
  );
  const historyFutureCount = historyCountForContext(
    context,
    selectOristudioBpHistoryFuture(state).length,
    state.oristudioCpDocument ? state.oristudioCpHistoryFuture.length : 0,
    selectHistoryFuture(state).length
  );

  return {
    activeEditingContext: context,
    engineReady: state.engineReady,
    status: state.status,
    edgeCount: selectProject(state).edges.length,
    creaseCount: selectProject(state).creases.length,
    facetCount: selectProject(state).facets.length,
    hasEditableCreasePattern: state.oristudioCpDocument !== null,
    hasImportedCreasePattern: state.importedCreasePattern !== null,
    hasBoxPleatDocument: selectOristudioBpDocument(state) !== null,
    boxPleatTreeEdgeCount: selectOristudioBpDocument(state)?.snapshot?.tree?.edges?.length ?? 0,
    boxPleatBusy: state.oristudioBpBusy,
    hasSimulationModel: state.foldArtifacts?.simulation_model != null,
    oristudioCpSelectedLineCount: state.oristudioCpSelection.lines.length,
    oristudioCpSelectedPointCount: state.oristudioCpSelection.points.length,
    oristudioCpSelectedCircleCount: state.oristudioCpSelection.circles.length,
    hasDeletableBpSelection,
    historyPastCount,
    historyFutureCount,
    clipboard: state.clipboard,
    selection: selectSelection(state),
  };
}

export function selectWorkspaceCapabilities(state: WorkspaceState): WorkspaceCapabilities {
  // Imperative (non-reactive) read; use the current-language translator singleton.
  return getWorkspaceCapabilities(workspaceCapabilityInput(state), i18n.t.bind(i18n));
}
