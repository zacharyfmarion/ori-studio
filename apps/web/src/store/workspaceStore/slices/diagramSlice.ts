import {
  createDiagram,
  createStep,
  defaultHanStyle,
  duplicateStep,
  insertSteps,
  insertionIndex,
  moveStep,
  removeSteps,
  setDiagramTitle,
  setPageSetup,
  setStepText,
  stepIndex,
  type DiagramDocument,
} from '../../../diagram/document/diagramDocument';
import { discardDiagramState, trimDiagramHistory } from '../diagramState';
import {
  emptySnapshotHistory,
  recordSnapshot,
  redoSnapshot,
  snapshotEntry,
  undoSnapshot,
} from '../snapshotHistory';
import type { DiagramSlice, WorkspaceSliceCreator } from '../types';

/**
 * The language the author is working in, for a new diagram's Han style. Read
 * from the document's `lang` — which the locale store keeps in step with the
 * interface — rather than from i18n, so the store does not import it.
 */
function authorLocale(): string | null {
  return typeof document === 'undefined' ? null : document.documentElement.lang || null;
}

/**
 * The Diagram workspace's document and view state.
 *
 * Every document edit goes through {@link commit}: it creates the diagram on
 * first use, records one undo entry, and marks the project dirty — and does
 * nothing at all for an edit that changes nothing, so a no-op never costs an
 * undo step. View state (which view, which step is selected) is set directly:
 * it is neither history nor a reason to save.
 */
export const createDiagramSlice: WorkspaceSliceCreator<DiagramSlice> = (set, get) => {
  /**
   * Apply one edit. Returns the new diagram, or `null` when nothing changed or
   * the diagram is read-only.
   */
  const commit = (
    label: string,
    edit: (document: DiagramDocument) => DiagramDocument
  ): DiagramDocument | null => {
    const state = get();
    if (state.diagramReadOnly) return null;
    const before = state.diagram;
    const base = before ?? createDiagram({ hanStyle: defaultHanStyle(authorLocale()) });
    const next = edit(base);
    // An edit that changed nothing records nothing — and does not bring a
    // diagram into being just to leave it empty.
    if (next === base) return null;
    set({
      diagram: next,
      diagramHistory: trimDiagramHistory(
        recordSnapshot(state.diagramHistory, snapshotEntry(before, label)),
        next
      ),
      dirty: true,
    });
    return next;
  };

  /** Keep the selection only while the step it names still exists. */
  const reconciledSelection = (document: DiagramDocument | null): string | null => {
    const selected = get().diagramSelectedStepId;
    if (!document || selected === null) return null;
    return stepIndex(document, selected) >= 0 ? selected : null;
  };

  const travel = (direction: 'undo' | 'redo'): boolean => {
    const state = get();
    if (state.diagramReadOnly) return false;
    const current = snapshotEntry(state.diagram, direction);
    const result =
      direction === 'undo'
        ? undoSnapshot(state.diagramHistory, current)
        : redoSnapshot(state.diagramHistory, current);
    if (!result) return false;
    const restored = result.restore.snapshot;
    set({
      diagram: restored,
      diagramHistory: result.history,
      diagramSelectedStepId: reconciledSelection(restored),
      dirty: true,
    });
    return true;
  };

  const addAt = (index: (document: DiagramDocument) => number): string | null => {
    const step = createStep();
    const next = commit('Add step', (document) => insertSteps(document, [step], index(document)));
    if (!next) return null;
    set({ diagramSelectedStepId: step.id });
    return step.id;
  };

  return {
    ...discardDiagramState(),

    installDiagram: (read) => {
      set({
        ...discardDiagramState(),
        diagram: read?.document ?? null,
        diagramReadOnly: read?.readOnly ?? false,
        diagramRaw: read?.readOnly ? read.raw : null,
        diagramHistory: emptySnapshotHistory(),
      });
    },

    addDiagramStep: () =>
      addAt((document) => insertionIndex(document, get().diagramSelectedStepId)),

    insertDiagramStep: (stepId, where) =>
      addAt((document) => {
        const index = stepIndex(document, stepId);
        if (index < 0) return document.steps.length;
        return where === 'before' ? index : index + 1;
      }),

    deleteDiagramSteps: (stepIds) => {
      const before = get().diagram;
      if (!before || stepIds.length === 0) return false;
      const removing = new Set(stepIds);
      const firstIndex = before.steps.findIndex((step) => removing.has(step.id));
      const next = commit(
        stepIds.length === 1 ? 'Delete step' : 'Delete steps',
        (document) => removeSteps(document, stepIds)
      );
      if (!next) return false;
      const selected = get().diagramSelectedStepId;
      if (selected === null || removing.has(selected)) {
        const neighbour = next.steps[Math.min(firstIndex, next.steps.length - 1)];
        set({ diagramSelectedStepId: neighbour?.id ?? null });
      }
      return true;
    },

    moveDiagramStep: (stepId, toIndex) =>
      commit('Move step', (document) => moveStep(document, stepId, toIndex)) !== null,

    duplicateDiagramStep: (stepId) => {
      let copyId: string | null = null;
      const next = commit('Duplicate step', (document) => {
        const result = duplicateStep(document, stepId);
        if (!result) return document;
        copyId = result.stepId;
        return result.document;
      });
      if (!next || copyId === null) return null;
      set({ diagramSelectedStepId: copyId });
      return copyId;
    },

    setDiagramStepText: (stepId, text, loadId) => {
      if (loadId !== undefined && loadId !== get().diagramLoadId) return false;
      return commit('Edit instruction', (document) => setStepText(document, stepId, text)) !== null;
    },

    setDiagramTitle: (title) =>
      commit('Rename diagram', (document) => setDiagramTitle(document, title)) !== null,

    setDiagramPage: (patch) =>
      commit('Change page setup', (document) => setPageSetup(document, patch)) !== null,

    selectDiagramStep: (stepId) => {
      const diagram = get().diagram;
      const next = stepId !== null && diagram && stepIndex(diagram, stepId) >= 0 ? stepId : null;
      if (next !== get().diagramSelectedStepId) set({ diagramSelectedStepId: next });
    },

    setDiagramView: (view) => {
      if (view !== get().diagramView) set({ diagramView: view });
    },

    undoDiagram: () => travel('undo'),
    redoDiagram: () => travel('redo'),
  };
};
