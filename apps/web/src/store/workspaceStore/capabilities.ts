import { canCopyDiagramAnnotation, canPasteDiagramAnnotations, diagramDeleteTarget, isDiagramAnnotating } from './diagramState';
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
import { isSuppressionRegionAnnotation } from '../../cp-workspace/annotations/annotation';
import { hasAttachedSolveInput } from '../../cp-workspace/annotations/suppressionRegion';
import type { EditingContext } from '../../workspaces/editingContext';
import { stepById, turnById } from '../../diagram/document/diagramDocument';
import { hasProjectDocument } from './projectDocuments';
import type { FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { foldStepTree, pathTo, type FoldStepTree } from '../../fold/document/foldStepTree';
import { foldStartingFigure } from '../../fold/io/foldEditFigure';
import { isTurnStep } from '../../fold/sequence/foldSequencePath';
import { isShownFoldSequenceReadOnly, shownFoldSequence } from './foldState';
import type { WorkspaceState } from './types';

/**
 * The depth of each history stack that belongs to a workspace rather than to a
 * design kind, in the direction being asked about.
 */
export interface WorkspaceHistoryCounts {
  /** The crease-pattern editor's stack, or 0 with no editable crease pattern. */
  cp: number;
  diagram: number;
  fold: number;
}

/**
 * How deep the active context's undo stack is.
 *
 * The crease-pattern editor, the Diagram and Fold answer for themselves — they
 * are workspaces, not design kinds — and every design kind answers through its
 * descriptor. This used to list the kinds it knew and return 0 for the rest,
 * which *disabled* Undo and Redo for a registered kind rather than merely
 * leaving them unwired, and made the dispatch behind them unreachable. Nothing
 * here should know the kinds.
 */
export function historyCountForContext(
  context: EditingContext,
  tab: DesignTab,
  counts: WorkspaceHistoryCounts,
  which: 'past' | 'future',
  /** Parameterized for the same reason the registry is: so a stub kind can
   *  drive this consumer without mutating global state. */
  kinds?: readonly DesignKindDescriptor[]
): number {
  if (context === 'crease-pattern') return counts.cp;
  if (context === 'diagram') return counts.diagram;
  if (context === 'fold') return counts.fold;
  const kind = kinds ? designKindRegistry(kinds).forContext(context) : designKindForContext(context);
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
  return state.designTabs.some((tab) => (tab.kind ? designKind(tab.kind)?.isSavable(tab) : false) ?? false);
}

/**
 * Whether Delete has something in the Diagram to act on, on a diagram this
 * build may change: in Annotate, the selected annotation; anywhere else, the
 * selected step. One predicate for both capability builders.
 */
export function hasDeletableDiagramSelection(state: WorkspaceState): boolean {
  const { diagram, diagramSelectedStepId } = state;
  if (state.activeEditingContext !== 'diagram' || state.diagramReadOnly || diagram === null) return false;
  if (diagramSelectedStepId === null) return false;
  // A turn goes with Delete as a step does (D22).
  if (turnById(diagram, diagramSelectedStepId)) return true;
  const step = stepById(diagram, diagramSelectedStepId);
  if (!step) return false;
  if (!isDiagramAnnotating(state)) return true;
  const annotationId = state.diagramSelectedAnnotationId;
  return annotationId !== null && step.annotations.some((annotation) => annotation.id === annotationId);
}

/**
 * How many patterns in this document can be exact-solved right now.
 *
 * v1 offers Solve only where an `ExactSolveInput` is *attached* — the warm tier.
 * That attachment arrives on the suppression region a detection import places,
 * so counting regions that carry one counts solvable patterns: one region per
 * added candidate, by construction.
 *
 * Data, never a geometric "does this box contain a solvable pattern" test. One of
 * those would run on every edit and could flicker mid-drag, which is exactly when
 * a menu item must not change state under the cursor. It is also why the count is
 * of *attachments* rather than of paper squares: a hand-drawn CP has no input to
 * solve from until the cold-rebuild tier lands, and offering the command for it
 * would be offering a refusal.
 */
export function cpSolvablePatternCount(state: WorkspaceState): number {
  let count = 0;
  for (const annotation of state.oristudioCpAnnotations) {
    if (isSuppressionRegionAnnotation(annotation) && hasAttachedSolveInput(annotation)) count += 1;
  }
  return count;
}

/** Whether the Fold reader is on a step of the shown sequence, not its flat sheet. */
export function foldStepAtCursor(state: Pick<WorkspaceState, 'foldReader' | 'foldSequences'>): boolean {
  const cursor = state.foldReader?.cursor ?? null;
  return cursor !== null && state.foldSequences[0]?.document.steps.some((node) => node.id === cursor) === true;
}

/** Each sequence's step tree, built once per edit: the selector below runs on every change to the store. */
const foldTrees = new WeakMap<readonly FoldStepNode[], FoldStepTree>();

/**
 * Whether a numbered step is at the Fold reader's cursor or before it on its
 * path: the page Export Step opens on. Not with the sheet on screen, nor on
 * a turn before the first step, which takes no number and gets no page.
 */
export function foldPageAtCursor(state: Pick<WorkspaceState, 'foldReader' | 'foldSequences'>): boolean {
  const cursor = state.foldReader?.cursor ?? null;
  const steps = state.foldSequences[0]?.document.steps;
  if (cursor === null || !steps) return false;
  let tree = foldTrees.get(steps);
  if (!tree) {
    tree = foldStepTree(steps);
    foldTrees.set(steps, tree);
  }
  return pathTo(tree, cursor)?.some((node) => !isTurnStep(node)) === true;
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
    {
      cp: state.oristudioCpDocument ? state.oristudioCpHistoryPast.length : 0,
      diagram: state.diagramHistory.past.length,
      fold: state.foldHistory.past.length,
    },
    'past'
  );
  const historyFutureCount = historyCountForContext(
    context,
    tab,
    {
      cp: state.oristudioCpDocument ? state.oristudioCpHistoryFuture.length : 0,
      diagram: state.diagramHistory.future.length,
      fold: state.foldHistory.future.length,
    },
    'future'
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
    oristudioCpSolvablePatternCount: cpSolvablePatternCount(state),
    hasDeletableDesignSelection:
      activeKind?.deletableTarget?.(activeDesignTab(state)) != null,
    canSaveDesign: anyDesignIsSavable(state),
    hasProjectDocument: hasProjectDocument(state),
    diagramStepCount: state.diagram?.steps.length ?? 0,
    hasDeletableDiagramSelection: hasDeletableDiagramSelection(state),
    diagramDeleteTarget: diagramDeleteTarget(state),
    canCopyDiagramAnnotation: canCopyDiagramAnnotation(state),
    canPasteDiagramAnnotations: canPasteDiagramAnnotations(state),
    foldStepAtCursor: foldStepAtCursor(state),
    historyPastCount,
    historyFutureCount,
    clipboard: state.clipboard,
    selection: selectSelection(state),
    foldSequence: foldSequenceCapabilityInput(state),
    hasFoldStartingFigure: foldStartingFigure(state) !== null,
  };
}

/** The Fold sequence on screen, as its imports and hand-offs are gated by it. */
function foldSequenceCapabilityInput(state: WorkspaceState): WorkspaceCapabilityInput['foldSequence'] {
  const shown = shownFoldSequence(state);
  return {
    stepCount: shown?.document.steps.length ?? 0,
    polygon: shown?.document.paper.shape.kind === 'polygon',
    readOnly: isShownFoldSequenceReadOnly(state),
    pageAtCursor: foldPageAtCursor(state),
  };
}

export function selectWorkspaceCapabilities(state: WorkspaceState): WorkspaceCapabilities {
  // Imperative (non-reactive) read; use the current-language translator singleton.
  return getWorkspaceCapabilities(workspaceCapabilityInput(state), i18n.t.bind(i18n));
}
