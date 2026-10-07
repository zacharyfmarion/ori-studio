import {
  createDiagram,
  createStep,
  defaultHanStyle,
  duplicateStep,
  editStepAnnotations,
  keepStepAnnotations,
  insertPictureSteps,
  pullReferencesSteps,
  insertSteps,
  insertionIndex,
  isLockedStep,
  moveStep,
  removeStepPicture,
  removeSteps,
  setDiagramStyle,
  setDiagramTitle,
  setHanStyle,
  setPageSetup,
  setStepBreakBefore,
  setReferencesSide,
  setStepPicture,
  setStepText,
  setUploadPose,
  stepHasContent,
  stepHasPicture,
  stepIndex,
  withReferencedAssets,
  type DiagramDocument,
  stepById,
  createTurn,
  canBecomeTurn,
  setTurn,
  stepToTurn,
  isStep,
  stepNumber,
  turnById,
  type DiagramEntry,
  setReferencesWay,
  anchorTakesCard,
} from '../../../diagram/document/diagramDocument';
import i18n from '../../../i18n';
import { requestConfirmation } from '../../commandDialogStore';
import { commitStepCapture, runDiagramCapture, stopDiagramCapture } from '../diagramCapture';
import { discardDiagramState, selectedDiagramAnnotation, trimDiagramHistory } from '../diagramState';
import { pathNodesOf } from '../../../diagram/annotate/annotationPath';
import { showsFrame } from '../../../diagram/zoom/zoomActions';
import {
  landSeededFrame,
  seedNewSteps,
  type LandedFirstFrame,
  type SeededStep,
} from '../../../diagram/zoom/zoomFrames';
import { ZOOM_FRAME_ID } from '../../../diagram/zoom/zoomModel';
import {
  enlargeInStore,
  storePaperFacesBackfill,
  trackSeeded,
  trackSeededSteps,
  unenlargeInStore,
  updateInStore,
  withPaperFaces,
} from '../diagramZoom';
import { lacksPaperFaces } from '../../../diagram/capture/stepPaperFaces';
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
 * What is selected after a delete: the entry that took the first deleted one's
 * place, or the one before it at the end. With the detail open, which shows
 * steps only (D22), the nearest step: one that took the place, else one before.
 */
function deletedNeighbour(entries: readonly DiagramEntry[], firstIndex: number, detailOpen: boolean): DiagramEntry | undefined {
  if (!detailOpen) return entries[Math.min(firstIndex, entries.length - 1)];
  return entries.slice(firstIndex).find(isStep) ?? entries.slice(0, firstIndex).filter(isStep).at(-1);
}

/**
 * Whether the step has the annotation — or, for `ZOOM_FRAME_ID`, shows an
 * enlarged step's frame, which is selected beside its marks (Revision 2).
 */
function hasAnnotation(document: DiagramDocument | null, stepId: string | null, annotationId: string): boolean {
  if (!document || stepId === null) return false;
  if (annotationId === ZOOM_FRAME_ID) return showsFrame(document, stepId);
  const step = stepById(document, stepId);
  return step?.annotations.some((annotation) => annotation.id === annotationId) ?? false;
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
   * The edit session whose undo entry is the newest one, if any: a sitting at
   * an instruction's field, or a label's. `key` names the field. Every other
   * recorded edit, undo, redo and install clears it, so a session only ever
   * extends the entry it made itself.
   */
  let openSession: { key: string; session: number; loadId: number } | null = null;

  /** The References browser's openings, counted: what a pull names its browser by. */
  let browserOpenings = 0;

  /** Whether an edit in `session` at `key` extends the newest entry, and the session to remember after it. */
  const sessionFor = (key: string, session: number | undefined) => {
    const loadId = get().diagramLoadId;
    const extend =
      session !== undefined &&
      openSession !== null &&
      openSession.key === key &&
      openSession.session === session &&
      openSession.loadId === loadId;
    return { extend, remember: () => (openSession = session === undefined ? null : { key, session, loadId }) };
  };

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
    if (!extend) openSession = null;
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
   * The anchor's pick mode put down (Revision 2) unless it is still for the
   * area or frame `annotationId` names, selected on its step open in Annotate:
   * once what armed it is not, it stays down, and does not come back when that
   * is selected again. What every change of the selection passes through.
   */
  const pickPutDown = (annotationId: string | null = null, detail = get().diagramDetail) => {
    const pick = get().diagramAnchorPick;
    const held = pick !== null && pick.target === annotationId && pick.stepId === get().diagramSelectedStepId && detail === 'annotate';
    return pick === null || held ? {} : { diagramAnchorPick: null };
  };

  /**
   * The selection to set, and the detail with it: a detail is open on the
   * selected step, so nothing selected closes it.
   */
  const selection = (stepId: string | null) => ({
    diagramSelectedStepId: stepId,
    // An annotation is selected on its step: another step, or none, selects none.
    ...(stepId !== get().diagramSelectedStepId ? { diagramSelectedAnnotationId: null, ...pickPutDown() } : {}),
    // A detail is open on the selected step, and a picker chooses for one:
    // nothing selected — or a turn, which has no detail (D22) — closes the
    // detail, and another step the picker.
    ...(stepId === null || isTurnId(stepId) ? { diagramDetail: null } : {}),
    ...(get().diagramPatternPicker !== stepId ? { diagramPatternPicker: null } : {}),
  });

  /** Whether an id names a turn in the diagram as it is now. */
  const isTurnId = (id: string): boolean => {
    const diagram = get().diagram;
    return diagram !== null && turnById(diagram, id) !== null;
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
    openSession = null;
    const current = snapshotEntry(state.diagram, direction);
    const result =
      direction === 'undo'
        ? undoSnapshot(state.diagramHistory, current)
        : redoSnapshot(state.diagramHistory, current);
    if (!result) return false;
    const restored = result.restore.snapshot;
    const stepId = reconciledSelection(restored);
    set({
      diagram: restored,
      diagramHistory: result.history,
      ...selection(stepId),
      dirty: true,
    });
    // The selected annotation, while it is still on the selected step.
    const annotationId = get().diagramSelectedAnnotationId;
    if (annotationId !== null && !hasAnnotation(restored, stepId, annotationId)) {
      set({ diagramSelectedAnnotationId: null });
    }
    return true;
  };

  const addAt = (
    index: (document: DiagramDocument) => number,
    entry: DiagramEntry = createStep(),
    label = 'Add step'
  ): string | null => {
    // A step added after an enlarged step starts enlarged (Revision 2, Z2), captured as it is made.
    let seeded: SeededStep[] = [];
    const next = commit(label, (document) => {
      const inserted = insertSteps(document, [entry], index(document));
      const seeding = seedNewSteps(inserted, [entry.id], inserted.assets);
      seeded = seeding.seeded;
      return seeding.document;
    });
    if (!next) return null;
    // Empty, it places its frame on its first picture, which counts it.
    trackSeededSteps(next, seeded);
    set(selection(entry.id));
    return entry.id;
  };

  /**
   * One edit that makes steps — an upload, a References pull — as one undo
   * step, each new step starting enlarged after an enlarged one (Revision 2,
   * Z2), and a step given its first picture landing the frame it was enlarged
   * with; each counted as its frame is placed. `edit` returns the diagram and
   * the steps it made and filled; null when the edit changed nothing.
   */
  const commitMade = (
    label: string,
    edit: (document: DiagramDocument) => { document: DiagramDocument; made: readonly string[]; filled?: string }
  ): DiagramDocument | null => {
    let seeded: SeededStep[] = [];
    let landed = null as (LandedFirstFrame & { stepId: string }) | null;
    const next = commit(label, (document) => {
      const result = edit(document);
      if (result.document === document) return document;
      let edited = result.document;
      if (result.filled !== undefined) {
        // Filled first, so the steps made after it are seeded from the frame it lands.
        const first = landSeededFrame(document, edited, result.filled);
        landed = { ...first, stepId: result.filled };
        edited = first.document;
      }
      const seeding = seedNewSteps(edited, result.made, edited.assets);
      seeded = seeding.seeded;
      return seeding.document;
    });
    if (!next) return null;
    if (landed) trackSeeded(next, landed.stepId, landed);
    trackSeededSteps(next, seeded);
    return next;
  };
  /** Where an add beside an entry lands, or where an add lands at all (after the selection, or at the end). */
  const besideOrSelection = (at?: { stepId: string; where: 'before' | 'after' }) => (document: DiagramDocument) => {
    if (!at) return insertionIndex(document, get().diagramSelectedStepId);
    const index = stepIndex(document, at.stepId);
    if (index < 0) return document.steps.length;
    return at.where === 'before' ? index : index + 1;
  };

  /** The selected annotation kept while it is still selectable, after an edit that may have taken it away. */
  const keepSelectable = (document: DiagramDocument) => {
    const selected = get().diagramSelectedAnnotationId;
    if (selected !== null && !hasAnnotation(document, get().diagramSelectedStepId, selected)) {
      set({ diagramSelectedAnnotationId: null, ...pickPutDown() });
    }
  };

  const paperFacesBackfill = storePaperFacesBackfill({ get, set });

  return {
    ...discardDiagramState(),

    installDiagram: (read) => {
      openSession = null;
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

    insertDiagramStep: (stepId, where) => addAt(besideOrSelection({ stepId, where })),

    insertDiagramTurn: (kind, at) => addAt(besideOrSelection(at), createTurn(kind), 'Add turn'),

    setDiagramTurn: (turnId, kind) =>
      commit('Change turn', (document) => setTurn(document, turnId, kind)) !== null,

    makeDiagramStepTurn: (stepId, kind) => {
      let turnId: string | null = null;
      const next = commit('Make turn', (document) => {
        const made = stepToTurn(document, stepId, kind);
        turnId = made?.turnId ?? null;
        return made?.document ?? document;
      });
      if (!next || turnId === null) return null;
      set(selection(turnId));
      return turnId;
    },

    confirmMakeDiagramStepTurn: async (stepId, kind) => {
      const { diagram, diagramReadOnly, diagramLoadId } = get();
      const step = diagram && !diagramReadOnly ? stepById(diagram, stepId) : null;
      if (!diagram || !step || !canBecomeTurn(step)) return null;
      if (stepHasContent(step)) {
        const t = i18n.t;
        const number = stepNumber(diagram, stepId);
        const confirmed = await requestConfirmation({
          title:
            kind.kind === 'turn-over'
              ? t('dialogs:diagram.makeTurnOverTitle', 'Make step {{number}} a turn-over?', { number })
              : t('dialogs:diagram.makeRotateTitle', 'Make step {{number}} a rotation?', { number }),
          message: t(
            'dialogs:diagram.makeTurnMessage',
            'A turn has no instruction or marks, so the step’s go with it. You can undo this.'
          ),
          confirmLabel: t('dialogs:diagram.makeTurnConfirm', 'Make Turn'),
          cancelLabel: t('dialogs:common.cancel', 'Cancel'),
        });
        // The question can stay up while a file is opened over it.
        if (!confirmed || get().diagramLoadId !== diagramLoadId) return null;
      }
      return get().makeDiagramStepTurn(stepId, kind);
    },

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
        set(selection(deletedNeighbour(next.steps, firstIndex, get().diagramDetail !== null)?.id ?? null));
      }
      return true;
    },

    confirmDeleteDiagramSteps: async (stepIds) => {
      const { diagram, diagramReadOnly, diagramLoadId } = get();
      if (!diagram || diagramReadOnly) return false;
      const removing = new Set(stepIds);
      const entries = diagram.steps.filter((entry) => removing.has(entry.id));
      if (entries.length === 0) return false;
      // A turn holds no work, and goes without asking (D22): the question counts steps.
      const steps = entries.filter(isStep);
      if (steps.some(stepHasContent)) {
        const t = i18n.t;
        const one = steps.length === 1;
        const confirmed = await requestConfirmation({
          title: one
            ? t('dialogs:diagram.deleteStepTitle', 'Delete step {{number}}?', {
                number: stepNumber(diagram, steps[0]!.id),
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
      return get().deleteDiagramSteps(entries.map((entry) => entry.id));
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
      if (loadId !== undefined && loadId !== get().diagramLoadId) return false;
      const { extend, remember } = sessionFor(`text:${stepId}`, session);
      const next = commit('Edit instruction', (document) => setStepText(document, stepId, text), extend);
      if (!next) return false;
      remember();
      return true;
    },

    editDiagramAnnotations: (stepId, label, edit, { select, selectPathNode, session, loadId } = {}) => {
      if (loadId !== undefined && loadId !== get().diagramLoadId) return false;
      const { extend, remember } = sessionFor(`annotations:${stepId}`, session);
      const next = commit(label, (document) => editStepAnnotations(document, stepId, edit), extend);
      if (!next) return false;
      remember();
      const selected = select !== undefined ? select : get().diagramSelectedAnnotationId;
      const kept = selected !== null && hasAnnotation(next, get().diagramSelectedStepId, selected) ? selected : null;
      set({ diagramSelectedAnnotationId: kept, ...pickPutDown(kept) });
      if (selectPathNode !== undefined) get().selectDiagramPathNode(selectPathNode);
      return true;
    },

    keepDiagramAnnotations: (stepId) =>
      commit('Keep annotations', (document) => keepStepAnnotations(document, stepId)) !== null,

    setDiagramAnnotateTool: (tool) => {
      if (tool !== get().diagramAnnotateTool) set({ diagramAnnotateTool: tool });
    },

    selectDiagramPathNode: (node) => {
      const annotation = node === null ? null : selectedDiagramAnnotation(get());
      const nodes = annotation ? pathNodesOf(annotation) : null;
      const next =
        annotation && nodes && node !== null && node >= 0 && node < nodes.length
          ? { annotationId: annotation.id, node, nodes: nodes.length }
          : null;
      const current = get().diagramSelectedPathNode;
      const same =
        current === next ||
        (current !== null &&
          next !== null &&
          current.annotationId === next.annotationId &&
          current.node === next.node &&
          current.nodes === next.nodes);
      if (!same) set({ diagramSelectedPathNode: next });
    },

    selectDiagramAnnotation: (annotationId) => {
      const { diagram, diagramSelectedStepId } = get();
      const next = annotationId !== null && hasAnnotation(diagram, diagramSelectedStepId, annotationId) ? annotationId : null;
      if (next !== get().diagramSelectedAnnotationId) set({ diagramSelectedAnnotationId: next, ...pickPutDown(next) });
    },

    addDiagramPictures: (assets, { loadId, anchorStepId } = {}) => {
      if (assets.length === 0) return null;
      if (loadId !== undefined && loadId !== get().diagramLoadId) return null;
      const selected = anchorStepId !== undefined ? anchorStepId : get().diagramSelectedStepId;
      const current = get().diagram;
      const target = current && selected !== null ? stepById(current, selected) : undefined;
      // One picture onto a selected step that has none fills it (D2).
      if (assets.length === 1 && target && !isLockedStep(target) && !stepHasPicture(target)) {
        // A step enlarged before it had a picture lands its frame on its first (Revision 2).
        const filled = commitMade('Add picture', (document) => ({
          document: setStepPicture(document, target.id, assets[0]),
          made: [],
          filled: target.id,
        }));
        return filled ? { stepIds: [target.id], filled: true } : null;
      }
      let stepIds: string[] = [];
      // Each new step after an enlarged one starts enlarged, the run through (Revision 2, Z2).
      const next = commitMade(assets.length === 1 ? 'Add picture' : 'Add pictures', (document) => {
        const result = insertPictureSteps(document, assets, insertionIndex(document, selected));
        stepIds = result.stepIds;
        return { document: result.document, made: result.stepIds };
      });
      if (!next) return null;
      // The last of them, so the next add goes on after the batch.
      set(selection(stepIds[stepIds.length - 1]));
      return { stepIds, filled: false };
    },

    setDiagramStepPicture: (stepId, asset, { loadId } = {}) => {
      if (loadId !== undefined && loadId !== get().diagramLoadId) return false;
      const next = commitMade('Replace picture', (document) => ({
        document: setStepPicture(document, stepId, asset),
        made: [],
        filled: stepId,
      }));
      return next !== null;
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

    setDiagramPage: (patch, { session } = {}) => {
      const { extend, remember } = sessionFor('page', session);
      const next = commit('Change page setup', (document) => setPageSetup(document, patch), extend);
      if (!next) return false;
      remember();
      return true;
    },

    setDiagramStepBreakBefore: (stepId, breakBefore) =>
      commit(breakBefore ? 'Start a new page' : 'Continue the page', (document) =>
        setStepBreakBefore(document, stepId, breakBefore)
      ) !== null,

    setDiagramStyle: (style) =>
      commit('Change diagram style', (document) => setDiagramStyle(document, style)) !== null,

    setDiagramHanStyle: (hanStyle) =>
      commit('Change Han characters', (document) => setHanStyle(document, hanStyle)) !== null,

    selectDiagramStep: (stepId) => {
      const diagram = get().diagram;
      const next = stepId !== null && diagram && stepIndex(diagram, stepId) >= 0 ? stepId : null;
      if (next !== get().diagramSelectedStepId) set(selection(next));
    },

    openDiagramPatternPicker: (stepId) => {
      const { diagram, diagramReadOnly } = get();
      const step = diagram ? stepById(diagram, stepId) : null;
      if (!step || diagramReadOnly || isLockedStep(step)) return false;
      set({ ...selection(stepId), diagramPatternPicker: stepId });
      return true;
    },

    closeDiagramPatternPicker: () => {
      if (get().diagramPatternPicker !== null) set({ diagramPatternPicker: null });
    },

    setDiagramReferencesWay: (stepId, way) =>
      commit('Choose way', (document) => setReferencesWay(document, stepId, way)) !== null,

    setDiagramReferencesSide: (stepId, mirrored) =>
      commit('Adjust pose', (document) => setReferencesSide(document, stepId, mirrored)) !== null,

    openDiagramReferencesBrowser: (anchor, options = {}) => {
      const { diagram, diagramReadOnly } = get();
      if (diagramReadOnly) return false;
      set({
        // The step it was opened for is the one the Step pane shows meanwhile.
        ...(anchor.kind !== 'end' && diagram && stepIndex(diagram, anchor.stepId) >= 0 ? selection(anchor.stepId) : {}),
        diagramReferencesBrowser: {
          mode: 'sequence',
          pattern: null,
          shown: null,
          ...options,
          anchor,
          opening: (browserOpenings += 1),
        },
        // A modal over the Diagram: a step's detail stays open behind it; the
        // pattern picker, the other way to give a step its picture, closes.
        diagramPatternPicker: null,
      });
      return true;
    },

    setDiagramReferencesBrowser: (patch) => {
      const open = get().diagramReferencesBrowser;
      if (open) set({ diagramReferencesBrowser: { ...open, ...patch } });
    },

    closeDiagramReferencesBrowser: () => {
      if (get().diagramReferencesBrowser !== null) set({ diagramReferencesBrowser: null });
    },

    pullReferencesDiagramSteps: (sent, anchor, { loadId, label, opening }) => {
      if (loadId !== get().diagramLoadId || sent.length === 0) return null;
      // Pressed in a browser that has closed since: it adds nothing, and closes nothing.
      if (opening !== undefined && get().diagramReferencesBrowser?.opening !== opening) return null;
      let pulled: { stepIds: string[]; turnIds: string[] } = { stepIds: [], turnIds: [] };
      // A filled step lands the frame it was enlarged with, and each card made a step after an enlarged one starts enlarged (Revision 2).
      const next = commitMade(label, (document) => {
        // The step a card fills or replaces is not a new one; a filled one gets its first picture.
        const taking = anchor.kind !== 'end' && anchorTakesCard(document, anchor) ? anchor.stepId : undefined;
        const { document: pulledInto, ...ids } = pullReferencesSteps(document, sent, anchor);
        pulled = ids;
        return {
          document: pulledInto,
          made: ids.stepIds.filter((id) => id !== taking),
          ...(taking !== undefined && ids.stepIds.includes(taking) ? { filled: taking } : {}),
        };
      });
      const last = pulled.stepIds.at(-1) ?? pulled.turnIds.at(-1);
      if (!next || last === undefined) return null;
      set({ ...selection(last), diagramReferencesBrowser: null });
      return pulled;
    },

    openDiagramStep: (stepId, mode = 'pose') => {
      const diagram = get().diagram;
      // A turn has no picture to pose or annotate (D22).
      if (!diagram || !stepById(diagram, stepId)) return false;
      // A step opened from the list starts with Select in hand; switching
      // between Pose and Annotate keeps the tool, as walking the steps does.
      const opening = get().diagramDetail === null;
      set({
        ...pickPutDown(get().diagramSelectedAnnotationId, mode),
        ...selection(stepId),
        diagramDetail: mode,
        diagramReferencesBrowser: null,
        ...(opening ? { diagramAnnotateTool: null } : {}),
      });
      return true;
    },

    closeDiagramStep: () => {
      if (get().diagramDetail !== null) set({ diagramDetail: null, diagramSelectedAnnotationId: null, ...pickPutDown() });
    },

    setDiagramStepPose: (stepId, pose) =>
      commit('Change pose', (document) => setUploadPose(document, stepId, pose)) !== null,

    setDiagramView: (view) => {
      if (view !== get().diagramView) set({ diagramView: view });
    },

    captureDiagramStep: (stepId, request) =>
      runDiagramCapture({ get, set }, commit, stepId, request),

    stopDiagramCapture: (stepId) => stopDiagramCapture({ get, set }, stepId),

    commitDiagramCapture: (start, captured, label) =>
      commitStepCapture({ get, set }, commit, start, captured, label),

    undoDiagram: () => travel('undo'),
    redoDiagram: () => travel('redo'),

    enlargeDiagramStep: async (stepId) => {
      const changed = await enlargeInStore({ get, set }, commit, paperFacesBackfill, stepId);
      // Its own areas went with it: one selected there is no longer.
      if (changed && get().diagram) keepSelectable(get().diagram!);
      return changed;
    },

    unenlargeDiagramStep: (stepId) => {
      const changed = unenlargeInStore({ get, set }, commit, stepId);
      if (changed && get().diagram) keepSelectable(get().diagram!);
      return changed;
    },

    updateEnlargedDiagramSteps: (areaId) => updateInStore({ get, set }, commit, paperFacesBackfill, areaId),

    editDiagramStepZoom: (stepId, label, edit, { loadId } = {}) => {
      if (loadId !== undefined && loadId !== get().diagramLoadId) return false;
      const next = commit(label, (document) => (stepById(document, stepId) ? edit(document) : document));
      if (!next) return false;
      keepSelectable(next);
      return true;
    },

    giveDiagramStepPaperFaces: async (stepId) => {
      const { diagram, diagramReadOnly, diagramLoadId, diagramHistory } = get();
      const step = diagram && !diagramReadOnly ? stepById(diagram, stepId) : null;
      if (!step || !lacksPaperFaces(step)) return false;
      const newest = diagramHistory.past.at(-1);
      const faced = await paperFacesBackfill([step]);
      const now = get();
      // Only into the edit that made it a source: anything recorded since keeps its own undo step.
      if (faced.size === 0 || now.diagramLoadId !== diagramLoadId || newest === undefined || now.diagramHistory.past.at(-1) !== newest) {
        return false;
      }
      return commit('Enlarge area', (document) => withPaperFaces(document, faced), true) !== null;
    },

    setDiagramAnchorPick: (pick) => {
      const current = get().diagramAnchorPick;
      const same = current === pick || (current && pick && current.stepId === pick.stepId && current.target === pick.target);
      if (!same) set({ diagramAnchorPick: pick });
    },
  };
};
