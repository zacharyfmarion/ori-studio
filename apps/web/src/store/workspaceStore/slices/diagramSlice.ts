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
  stepHasContent,
  stepIndex,
  type DiagramDocument,
} from '../../../diagram/document/diagramDocument';
import i18n from '../../../i18n';
import { requestConfirmation } from '../../commandDialogStore';
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
   * The instruction edit session whose undo entry is the newest one, if any.
   * Every other recorded edit, undo, redo and install clears it, so a session
   * only ever extends the entry it made itself.
   */
  let openTextSession: { session: number; stepId: string; loadId: number } | null = null;

  /**
   * Apply one edit. Returns the new diagram, or `null` when nothing changed or
   * the diagram is read-only. `extend` folds the edit into the newest undo
   * entry instead of recording one.
   */
  const commit = (
    label: string,
    edit: (document: DiagramDocument) => DiagramDocument,
    extend = false
  ): DiagramDocument | null => {
    const state = get();
    if (state.diagramReadOnly) return null;
    const before = state.diagram;
    const base = before ?? createDiagram({ hanStyle: defaultHanStyle(authorLocale()) });
    const next = edit(base);
    // An edit that changed nothing records nothing — and does not bring a
    // diagram into being just to leave it empty.
    if (next === base) return null;
    if (!extend) openTextSession = null;
    set({
      diagram: next,
      diagramHistory: extend
        ? state.diagramHistory
        : trimDiagramHistory(
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
    openTextSession = null;
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
      openTextSession = null;
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

    confirmDeleteDiagramSteps: async (stepIds) => {
      const { diagram, diagramReadOnly, diagramLoadId } = get();
      if (!diagram || diagramReadOnly) return false;
      const removing = new Set(stepIds);
      const steps = diagram.steps.filter((step) => removing.has(step.id));
      if (steps.length === 0) return false;
      if (steps.some(stepHasContent)) {
        const t = i18n.t;
        const one = steps.length === 1;
        const confirmed = await requestConfirmation({
          title: one
            ? t('dialogs:diagram.deleteStepTitle', 'Delete step {{number}}?', {
                number: stepIndex(diagram, steps[0].id) + 1,
              })
            : t('dialogs:diagram.deleteStepsTitle', 'Delete {{total}} steps?', {
                total: steps.length,
              }),
          message: one
            ? t(
                'dialogs:diagram.deleteStepMessage',
                'Its picture and instruction go with it. You can undo this.'
              )
            : t(
                'dialogs:diagram.deleteStepsMessage',
                'Their pictures and instructions go with them. You can undo this.'
              ),
          confirmLabel: t('dialogs:diagram.deleteStepConfirm', 'Delete'),
          cancelLabel: t('dialogs:common.cancel', 'Cancel'),
          tone: 'danger',
        });
        // The question can stay up while a file is opened over it.
        if (!confirmed || get().diagramLoadId !== diagramLoadId) return false;
      }
      return get().deleteDiagramSteps(steps.map((step) => step.id));
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

    setDiagramStepText: (stepId, text, { loadId, session } = {}) => {
      const currentLoadId = get().diagramLoadId;
      if (loadId !== undefined && loadId !== currentLoadId) return false;
      const extend =
        session !== undefined &&
        openTextSession !== null &&
        openTextSession.session === session &&
        openTextSession.stepId === stepId &&
        openTextSession.loadId === currentLoadId;
      const next = commit(
        'Edit instruction',
        (document) => setStepText(document, stepId, text),
        extend
      );
      if (!next) return false;
      if (session !== undefined) openTextSession = { session, stepId, loadId: currentLoadId };
      return true;
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
