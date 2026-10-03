import {
  createDiagram,
  createStep,
  defaultHanStyle,
  duplicateStep,
  insertLinkedStep,
  insertPictureSteps,
  insertReferencesSteps,
  insertSteps,
  insertionIndex,
  isLockedStep,
  moveStep,
  removeStepPicture,
  removeSteps,
  setDiagramTitle,
  setPageSetup,
  setReferencesSide,
  setStepPicture,
  setStepText,
  setUploadPose,
  stepHasContent,
  stepHasPicture,
  stepIndex,
  withReferencedAssets,
  type DiagramDocument,
} from '../../../diagram/document/diagramDocument';
import i18n from '../../../i18n';
import { requestConfirmation } from '../../commandDialogStore';
import { commitStepCapture, runDiagramCapture, stopDiagramCapture } from '../diagramCapture';
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
    const edited = edit(base);
    // An edit that changed nothing records nothing — and does not bring a
    // diagram into being just to leave it empty.
    if (edited === base) return null;
    // An asset nothing refers to any more goes as the edit lands. Each undo
    // snapshot keeps its own assets table, so undo still has the picture a
    // replace took away; and with the current diagram no longer holding it,
    // the history byte cap (`trimDiagramHistory`) sees what only history keeps.
    const next = withReferencedAssets(edited);
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

  /**
   * The selection to set, and the detail with it: a detail is open on the
   * selected step, so nothing selected closes it.
   */
  const selection = (stepId: string | null) => ({
    diagramSelectedStepId: stepId,
    // A detail is open on the selected step, and a picker chooses for one:
    // nothing selected closes the detail, and another step the picker.
    ...(stepId === null ? { diagramDetail: null } : {}),
    ...(get().diagramPatternPicker !== stepId ? { diagramPatternPicker: null } : {}),
  });

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
      ...selection(reconciledSelection(restored)),
      dirty: true,
    });
    return true;
  };

  const addAt = (index: (document: DiagramDocument) => number): string | null => {
    const step = createStep();
    const next = commit('Add step', (document) => insertSteps(document, [step], index(document)));
    if (!next) return null;
    set(selection(step.id));
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
        set(selection(neighbour?.id ?? null));
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
      set(selection(copyId));
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

    addDiagramPictures: (assets, { loadId, anchorStepId } = {}) => {
      if (assets.length === 0) return null;
      if (loadId !== undefined && loadId !== get().diagramLoadId) return null;
      const selected = anchorStepId !== undefined ? anchorStepId : get().diagramSelectedStepId;
      const current = get().diagram;
      const target = current && selected !== null ? current.steps[stepIndex(current, selected)] : undefined;
      // One picture onto a selected step that has none fills it (D2).
      if (assets.length === 1 && target && !isLockedStep(target) && !stepHasPicture(target)) {
        const filled = commit('Add picture', (document) => setStepPicture(document, target.id, assets[0]));
        return filled ? { stepIds: [target.id], filled: true } : null;
      }
      let stepIds: string[] = [];
      const next = commit(assets.length === 1 ? 'Add picture' : 'Add pictures', (document) => {
        const result = insertPictureSteps(document, assets, insertionIndex(document, selected));
        stepIds = result.stepIds;
        return result.document;
      });
      if (!next) return null;
      // The last of them, so the next add goes on after the batch.
      set(selection(stepIds[stepIds.length - 1]));
      return { stepIds, filled: false };
    },

    setDiagramStepPicture: (stepId, asset, { loadId } = {}) => {
      if (loadId !== undefined && loadId !== get().diagramLoadId) return false;
      return commit('Replace picture', (document) => setStepPicture(document, stepId, asset)) !== null;
    },

    removeDiagramStepPicture: (stepId) =>
      commit('Remove picture', (document) => removeStepPicture(document, stepId)) !== null,

    noteDiagramPictureChanges: (assetId, notices) => {
      const current = get().diagramPictureNotices;
      if (notices.length === 0 && !(assetId in current)) return;
      const next = { ...current };
      if (notices.length === 0) delete next[assetId];
      else next[assetId] = notices;
      set({ diagramPictureNotices: next });
    },

    setDiagramTitle: (title) =>
      commit('Rename diagram', (document) => setDiagramTitle(document, title)) !== null,

    setDiagramPage: (patch) =>
      commit('Change page setup', (document) => setPageSetup(document, patch)) !== null,

    selectDiagramStep: (stepId) => {
      const diagram = get().diagram;
      const next = stepId !== null && diagram && stepIndex(diagram, stepId) >= 0 ? stepId : null;
      if (next !== get().diagramSelectedStepId) set(selection(next));
    },

    openDiagramPatternPicker: (stepId) => {
      const { diagram, diagramReadOnly } = get();
      const step = diagram?.steps[stepIndex(diagram, stepId)];
      if (!step || diagramReadOnly || isLockedStep(step)) return false;
      set({ ...selection(stepId), diagramPatternPicker: stepId });
      return true;
    },

    closeDiagramPatternPicker: () => {
      if (get().diagramPatternPicker !== null) set({ diagramPatternPicker: null });
    },

    requestDiagramStepFromReferences: (stepId) => {
      const { diagram, diagramReadOnly } = get();
      const step = diagram?.steps[stepIndex(diagram, stepId)];
      if (!step || diagramReadOnly || isLockedStep(step)) return false;
      set({ ...selection(stepId), diagramReferencesTarget: stepId });
      return true;
    },

    cancelDiagramReferencesTarget: () => {
      if (get().diagramReferencesTarget !== null) set({ diagramReferencesTarget: null });
    },

    addReferencesDiagramSteps: (sent, { loadId, label }) => {
      if (loadId !== get().diagramLoadId || sent.length === 0) return null;
      const fill = get().diagramReferencesTarget;
      let stepIds: string[] = [];
      const next = commit(label, (document) => {
        const result = insertReferencesSteps(
          document,
          sent,
          insertionIndex(document, get().diagramSelectedStepId),
          { fill }
        );
        stepIds = result.stepIds;
        return result.document;
      });
      if (!next || stepIds.length === 0) return null;
      // Answered: the next send adds steps again.
      set({ ...selection(stepIds[stepIds.length - 1]!), diagramReferencesTarget: null });
      return stepIds;
    },

    setDiagramReferencesSide: (stepId, mirrored) =>
      commit('Adjust pose', (document) => setReferencesSide(document, stepId, mirrored)) !== null,

    openDiagramStep: (stepId, mode = 'pose') => {
      const diagram = get().diagram;
      if (!diagram || stepIndex(diagram, stepId) < 0) return false;
      set({ ...selection(stepId), diagramDetail: mode });
      return true;
    },

    closeDiagramStep: () => {
      if (get().diagramDetail !== null) set({ diagramDetail: null });
    },

    setDiagramStepPose: (stepId, pose) =>
      commit('Change pose', (document) => setUploadPose(document, stepId, pose)) !== null,

    setDiagramView: (view) => {
      if (view !== get().diagramView) set({ diagramView: view });
    },

    captureDiagramStep: (stepId, request) =>
      runDiagramCapture({ get, set }, commit, stepId, request),

    stopDiagramCapture: (stepId) => stopDiagramCapture({ get, set }, stepId),

    addLinkedDiagramStep: (link, { loadId, label }) => {
      if (loadId !== get().diagramLoadId) return null;
      let stepId: string | null = null;
      const next = commit(label, (document) => {
        const result = insertLinkedStep(document, link, insertionIndex(document, get().diagramSelectedStepId));
        stepId = result.stepId;
        return result.document;
      });
      if (!next || stepId === null) return null;
      set(selection(stepId));
      return stepId;
    },

    commitDiagramCapture: (start, captured, label) =>
      commitStepCapture({ get, set }, commit, start, captured, label),

    undoDiagram: () => travel('undo'),
    redoDiagram: () => travel('redo'),
  };
};
