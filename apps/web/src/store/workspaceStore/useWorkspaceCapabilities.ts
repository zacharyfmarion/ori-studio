import { bpSheetCanSubdivide, bpSheetCanUnsubdivide } from './bpSheetCapabilities';
import { selectOristudioBpDocument, selectProject, selectSelection } from './designTabs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getWorkspaceCapabilities } from '../../lib/workspaceCapabilities';
import { designKind, designKindForContext } from '../../designKinds';
import { activeDesignTab } from './designTabs';
import { historyCountForContext } from './capabilities';
import { useWorkspaceStore } from './store';

export function useWorkspaceCapabilities() {
  const { t } = useTranslation();
  const activeEditingContext = useWorkspaceStore((state) => state.activeEditingContext);
  const engineReady = useWorkspaceStore((state) => state.engineReady);
  const status = useWorkspaceStore((state) => state.status);
  const edgeCount = useWorkspaceStore((state) => selectProject(state).edges.length);
  const creaseCount = useWorkspaceStore((state) => selectProject(state).creases.length);
  const facetCount = useWorkspaceStore((state) => selectProject(state).facets.length);
  const hasEditableCreasePattern = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const hasImportedCreasePattern = useWorkspaceStore(
    (state) => state.importedCreasePattern !== null,
  );
  const hasBoxPleatDocument = useWorkspaceStore(
    (state) => selectOristudioBpDocument(state) !== null,
  );
  const boxPleatTreeEdgeCount = useWorkspaceStore(
    (state) => selectOristudioBpDocument(state)?.snapshot?.tree?.edges?.length ?? 0,
  );
  const boxPleatBusy = useWorkspaceStore((state) => state.oristudioBpBusy);
  const boxPleatCanSubdivide = useWorkspaceStore((state) =>
    bpSheetCanSubdivide(selectOristudioBpDocument(state)),
  );
  const boxPleatCanUnsubdivide = useWorkspaceStore((state) =>
    bpSheetCanUnsubdivide(selectOristudioBpDocument(state)),
  );
  const hasSimulationModel = useWorkspaceStore(
    (state) => state.foldArtifacts?.simulation_model != null,
  );
  const oristudioCpSelectedLineCount = useWorkspaceStore(
    (state) => state.oristudioCpSelection.lines.length,
  );
  const oristudioCpSelectedPointCount = useWorkspaceStore(
    (state) => state.oristudioCpSelection.points.length,
  );
  const oristudioCpSelectedCircleCount = useWorkspaceStore(
    (state) => state.oristudioCpSelection.circles.length,
  );
  const cpHistoryPastCount = useWorkspaceStore((state) => state.oristudioCpHistoryPast.length);
  const cpHistoryFutureCount = useWorkspaceStore((state) => state.oristudioCpHistoryFuture.length);
  // Asked of the active design kind rather than of box-pleat: one flag, every
  // kind, answered by the descriptor that knows.
  const hasDeletableDesignSelection = useWorkspaceStore((state) => {
    const kind = designKindForContext(state.activeEditingContext);
    return kind?.deletableTarget?.(activeDesignTab(state)) != null;
  });
  // Every tab, not the focused one — a save writes the whole workspace.
  const canSaveDesign = useWorkspaceStore((state) =>
    state.designTabs.some(
      (tab) => (tab.kind ? designKind(tab.kind)?.isSavable(tab) : false) ?? false,
    ),
  );
  // Subscribed to the tab itself, which is what carries every design kind's
  // undo stack. An edit replaces the tab object, so this re-renders — the
  // per-kind history subscriptions this replaced were only ever reading the
  // same arrays through named selectors.
  const activeDesign = useWorkspaceStore(activeDesignTab);
  const clipboard = useWorkspaceStore((state) => state.clipboard);
  const selection = useWorkspaceStore((state) => selectSelection(state));
  const historyPastCount = historyCountForContext(
    activeEditingContext,
    activeDesign,
    hasEditableCreasePattern ? cpHistoryPastCount : 0,
    'past',
  );
  const historyFutureCount = historyCountForContext(
    activeEditingContext,
    activeDesign,
    hasEditableCreasePattern ? cpHistoryFutureCount : 0,
    'future',
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
          boxPleatTreeEdgeCount,
          boxPleatBusy,
          boxPleatCanSubdivide,
          boxPleatCanUnsubdivide,
          hasSimulationModel,
          oristudioCpSelectedLineCount,
          oristudioCpSelectedPointCount,
          oristudioCpSelectedCircleCount,
          hasDeletableDesignSelection,
          canSaveDesign,
          historyPastCount,
          historyFutureCount,
          clipboard,
          selection,
        },
        t,
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
      boxPleatTreeEdgeCount,
      boxPleatBusy,
      boxPleatCanSubdivide,
      boxPleatCanUnsubdivide,
      hasSimulationModel,
      oristudioCpSelectedCircleCount,
      oristudioCpSelectedLineCount,
      oristudioCpSelectedPointCount,
      hasDeletableDesignSelection,
      canSaveDesign,
      historyFutureCount,
      historyPastCount,
      selection,
      status,
      t,
    ],
  );
}
