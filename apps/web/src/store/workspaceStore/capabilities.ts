import { bpSheetCanSubdivide, bpSheetCanUnsubdivide } from './bpSheetCapabilities';
import {
  activeDesignTab,
  selectOristudioBpDocument,
  selectProject,
  selectSelection,
  type DesignTab,
} from './designTabs';
import {
  getWorkspaceCapabilities,
  type WorkspaceCapabilities,
  type WorkspaceCapabilityInput,
} from '../../lib/workspaceCapabilities';
import i18n from '../../i18n';
import {
  designKind,
  designKindForContext,
  designKindRegistry,
  type DesignKindDescriptor,
} from '../../designKinds';
import type { EditingContext } from '../../workspaces/editingContext';
import type { WorkspaceState } from './types';

/** The undo/redo count for the active editing context's own history stack. */
/**
 * How deep the active context's undo stack is.
 *
 * The crease-pattern editor answers for itself — it is a workspace, not a design
 * kind — and every design kind answers through its descriptor. This used to list
 * the kinds it knew and return 0 for the rest, which *disabled* Undo and Redo
 * for a registered kind rather than merely leaving them unwired, and made the
 * dispatch behind them unreachable. Nothing here should know the kinds.
 */
export function historyCountForContext(
  context: EditingContext,
  tab: DesignTab,
  cpCount: number,
  which: 'past' | 'future',
  /** Parameterized for the same reason the registry is: so a stub kind can
   *  drive this consumer without mutating global state. */
  kinds?: readonly DesignKindDescriptor[],
): number {
  if (context === 'crease-pattern') return cpCount;
  const kind = kinds
    ? designKindRegistry(kinds).forContext(context)
    : designKindForContext(context);
  if (!kind) return 0;
  return kind.history(tab)[which];
}

/**
 * Whether the workspace holds anything worth writing to a file.
 *
 * Asked of *every* tab, not of the focused one. A save writes the whole
 * workspace — `saveActiveProject` keys off `designTabs.some(tab => tab.kind !==
 * null)` and its own comment says a lone untouched chooser is the only thing
 * that is not a design. Asking only the active tab meant clicking "+" for a
 * second design, or waiting on the box-pleat worker, made everything already
 * authored unsavable for as long as that tab was focused; and a context no kind
 * owns at all — the simulator — disabled Save permanently, with a reason about
 * the crease-pattern kernel that had nothing to do with it.
 */
function anyDesignIsSavable(state: WorkspaceState): boolean {
  return state.designTabs.some(
    (tab) => (tab.kind ? designKind(tab.kind)?.isSavable(tab) : false) ?? false,
  );
}

export function workspaceCapabilityInput(state: WorkspaceState): WorkspaceCapabilityInput {
  const context = state.activeEditingContext;
  const activeKind = designKindForContext(context);
  // The Edit menu's undo/redo count comes from the active context's history —
  // the CP editor's own stack, or whatever the active design kind reports.
  const tab = activeDesignTab(state);
  const historyPastCount = historyCountForContext(
    context,
    tab,
    state.oristudioCpDocument ? state.oristudioCpHistoryPast.length : 0,
    'past',
  );
  const historyFutureCount = historyCountForContext(
    context,
    tab,
    state.oristudioCpDocument ? state.oristudioCpHistoryFuture.length : 0,
    'future',
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
    boxPleatCanSubdivide: bpSheetCanSubdivide(selectOristudioBpDocument(state)),
    boxPleatCanUnsubdivide: bpSheetCanUnsubdivide(selectOristudioBpDocument(state)),
    hasSimulationModel: state.foldArtifacts?.simulation_model != null,
    oristudioCpSelectedLineCount: state.oristudioCpSelection.lines.length,
    oristudioCpSelectedPointCount: state.oristudioCpSelection.points.length,
    oristudioCpSelectedCircleCount: state.oristudioCpSelection.circles.length,
    hasDeletableDesignSelection: activeKind?.deletableTarget?.(activeDesignTab(state)) != null,
    canSaveDesign: anyDesignIsSavable(state),
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
