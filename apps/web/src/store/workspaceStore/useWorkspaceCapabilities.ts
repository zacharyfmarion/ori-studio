import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getWorkspaceCapabilities } from '../../lib/workspaceCapabilities';
import { historyCountForContext } from './capabilities';
import { useWorkspaceStore } from './store';

export function useWorkspaceCapabilities() {
  const { t } = useTranslation();
  const activeEditingContext = useWorkspaceStore((state) => state.activeEditingContext);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const status = useWorkspaceStore((state) => state.status);
  const edgeCount = useWorkspaceStore((state) => state.project.edges.length);
  const creaseCount = useWorkspaceStore((state) => state.project.creases.length);
  const facetCount = useWorkspaceStore((state) => state.project.facets.length);
  const hasEditableCreasePattern = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const hasImportedCreasePattern = useWorkspaceStore((state) => state.importedCreasePattern !== null);
  const hasBoxPleatDocument = useWorkspaceStore((state) => state.oristudioBpDocument !== null);
  const hasSimulationModel = useWorkspaceStore((state) => state.foldArtifacts?.simulation_model != null);
  const oristudioCpSelectedLineCount = useWorkspaceStore(
    (state) => state.oristudioCpSelection.lines.length
  );
  const oristudioCpSelectedPointCount = useWorkspaceStore(
    (state) => state.oristudioCpSelection.points.length
  );
  const oristudioCpSelectedCircleCount = useWorkspaceStore(
    (state) => state.oristudioCpSelection.circles.length
  );
  const treeHistoryPastCount = useWorkspaceStore((state) => state.historyPast.length);
  const treeHistoryFutureCount = useWorkspaceStore((state) => state.historyFuture.length);
  const cpHistoryPastCount = useWorkspaceStore((state) => state.oristudioCpHistoryPast.length);
  const cpHistoryFutureCount = useWorkspaceStore((state) => state.oristudioCpHistoryFuture.length);
  const bpHistoryPastCount = useWorkspaceStore((state) => state.oristudioBpHistoryPast.length);
  const bpHistoryFutureCount = useWorkspaceStore((state) => state.oristudioBpHistoryFuture.length);
  const hasDeletableBpSelection = useWorkspaceStore((state) => {
    const selection = state.oristudioBpSelection;
    const root = state.oristudioBpDocument?.snapshot?.tree?.rootVertexId;
    return (
      (selection?.kind === 'bp-vertex' && selection.id !== root) ||
      selection?.kind === 'bp-edge'
    );
  });
  const clipboard = useWorkspaceStore((state) => state.clipboard);
  const selection = useWorkspaceStore((state) => state.selection);
  const historyPastCount = historyCountForContext(
    activeEditingContext,
    bpHistoryPastCount,
    hasEditableCreasePattern ? cpHistoryPastCount : 0,
    treeHistoryPastCount
  );
  const historyFutureCount = historyCountForContext(
    activeEditingContext,
    bpHistoryFutureCount,
    hasEditableCreasePattern ? cpHistoryFutureCount : 0,
    treeHistoryFutureCount
  );

  return useMemo(
    () =>
      getWorkspaceCapabilities(
        {
          activeEditingContext,
          engineReady,
          status,
          edgeCount,
          creaseCount,
          facetCount,
          hasEditableCreasePattern,
          hasImportedCreasePattern,
          hasBoxPleatDocument,
          hasSimulationModel,
          oristudioCpSelectedLineCount,
          oristudioCpSelectedPointCount,
          oristudioCpSelectedCircleCount,
          hasDeletableBpSelection,
          historyPastCount,
          historyFutureCount,
          clipboard,
          selection,
        },
        t
      ),
    [
      clipboard,
      creaseCount,
      activeEditingContext,
      edgeCount,
      engineReady,
      facetCount,
      hasEditableCreasePattern,
      hasImportedCreasePattern,
      hasBoxPleatDocument,
      hasSimulationModel,
      oristudioCpSelectedCircleCount,
      oristudioCpSelectedLineCount,
      oristudioCpSelectedPointCount,
      hasDeletableBpSelection,
      historyFutureCount,
      historyPastCount,
      selection,
      status,
      t,
    ]
  );
}
