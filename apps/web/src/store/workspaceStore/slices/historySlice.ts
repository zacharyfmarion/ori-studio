import { compoundImportTravel } from '../diagramBatchImport';
import { patchBoxPleatDesign, patchTreemakerDesign, selectHistoryFuture, selectHistoryPast, selectOristudioBpDocument, selectOristudioBpHistoryFuture, selectOristudioBpHistoryPast, selectOristudioBpSelection, selectOristudioBpSymmetry, selectProject } from '../designTabs';
import {
  engineError,
  ensureTreeHandle,
  getEngine,
  loadTreeFromText,
  projectStateFromSnapshot,
  statusFromSnapshot,
} from '../engineRuntime';
import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import { oristudioCpError, setOristudioCpSelectedLines } from '../oristudioCpRuntime';
import { cpHistoryDocumentOf, restoreCpHistoryDocument } from '../cpHistory';
import { documentStateAfterSelection } from '../cpSelectedLines';
import {
  exportOristudioBpProjectAsSessionBps,
  oristudioBpError,
  restoreOristudioBpProjectSnapshot,
} from '../oristudioBpRuntime';
import {
  redoSnapshot,
  snapshotEntry,
  undoSnapshot,
  type SnapshotEntry,
  type SnapshotHistory,
} from '../snapshotHistory';
import type {
  HistoryEntry,
  HistorySlice,
  OristudioCpHistoryDocument,
  OristudioCpHistoryEntry,
  WorkspaceSliceCreator,
} from '../types';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentState,
  OristudioCpSelectedLines,
} from '../../../engine/oristudioCpTypes';
import type { OristudioCpSelection } from '../../../lib/creasePatternViewport';
import { bpDocumentSymmetry } from '../../../lib/bpTreeSymmetry';
import type { BpHistorySnapshot } from '../types';
import type { OristudioCpFoldedFigureEntry } from '../../../engine/oristudioCpTypes';
import type { CanvasAnnotation } from '../../../cp-workspace/annotations/annotation';
import type { InlineSimulation } from '../../../cp-workspace/inlineSimulation/inlineSimulation';
import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';
import {
  releaseFoldedFigureHandles,
  retainFoldedFigureHandles,
} from '../../../cp-workspace/folded/foldedFigureHandles';
import { foldedFiguresAtRest, foldedSelectionAtRest } from '../../../cp-workspace/folded/foldedFiguresAtRest';

const MAX_HISTORY = 100;

function historyEntry(text: string, label = 'Edit'): HistoryEntry {
  return {
    text,
    label,
    timestamp: new Date().toISOString(),
  };
}

/**
 * What an entry records of the crease pattern: nothing for an overlay step,
 * the selected lines for a selection step, which leave the document alone, and
 * the document to put back (its compact geometry) for any other.
 */
type CpHistoryContent =
  | { kind: 'overlay' }
  | { kind: 'selection'; replacedLines: OristudioCpSelectedLines }
  | { kind: 'document'; document: OristudioCpHistoryDocument };

function cpHistoryEntry(
  content: CpHistoryContent,
  selection: OristudioCpSelection,
  annotations: CanvasAnnotation[],
  foldedFigures: OristudioCpFoldedFigureEntry[],
  activeFoldedFigureId: string | null,
  inlineSimulations: InlineSimulation[],
  label = 'Edit'
): OristudioCpHistoryEntry {
  return {
    ...(content.kind === 'document' ? { document: content.document } : {}),
    ...(content.kind === 'selection' ? { selectedLines: content.replacedLines } : {}),
    selection,
    annotations,
    // As they were before any press still running: never a figure that waits on
    // a fold an undo or a redo will have taken from it (`foldedFiguresAtRest.ts`).
    foldedFigures: foldedFiguresAtRest(foldedFigures),
    activeFoldedFigureId: foldedSelectionAtRest(activeFoldedFigureId, foldedFigures),
    inlineSimulations,
    overlayOnly: content.kind === 'overlay',
    label,
    timestamp: new Date().toISOString(),
  };
}

/**
 * The folded-figure state a history entry restores. Entries written before
 * folded figures joined the undo stack have no `foldedFigures`, and restoring
 * `undefined` over the live list would wipe the user's figures — so an entry
 * that never captured them leaves them alone.
 */
function restoredFoldedFigureState(entry: OristudioCpHistoryEntry) {
  if (!entry.foldedFigures) return {};
  return {
    oristudioCpFoldedFigures: entry.foldedFigures,
    oristudioCpActiveFoldedFigureId: entry.activeFoldedFigureId ?? null,
  };
}

/**
 * The inline-simulation state a history entry restores. Same rule and same
 * reason as {@link restoredFoldedFigureState}: entries written before windows
 * joined the stack have no `inlineSimulations`, and restoring `undefined` over
 * the live list would wipe the user's windows.
 *
 * Focus is deliberately not restored, matching how undo drops the annotation
 * selection: history restores content, not what was selected. A window that
 * comes back unfocused is also one whose solver is not running, which is the
 * right default for a window the user is only just seeing again.
 */
function restoredInlineSimulationState(entry: OristudioCpHistoryEntry) {
  if (!entry.inlineSimulations) return {};
  return { oristudioCpInlineSimulations: entry.inlineSimulations };
}

/**
 * The annotation selection after a history step: kept when the restored list
 * still holds the selected annotation, dropped when the step removed it.
 *
 * History restores content, not what was selected — but a selection whose
 * object survives the step is not something the step touched. Dropping it made
 * every undo of an image's opacity leave the image unselected and its
 * properties gone from view; a folded figure already kept its selection
 * through undo for the same reason. Window focus is still dropped (see
 * {@link restoredInlineSimulationState}): focus is a running solver and the
 * app-wide `simulator` shortcut scope, which history must not resurrect.
 */
function restoredAnnotationSelection(
  entry: OristudioCpHistoryEntry,
  selectedAnnotationId: string | null
): string | null {
  if (selectedAnnotationId === null) return null;
  return entry.annotations.some((annotation) => annotation.id === selectedAnnotationId)
    ? selectedAnnotationId
    : null;
}

/**
 * The entry an undo or redo pushes onto the other stack, holding what was live,
 * when `restoring` is the entry it takes off.
 *
 * A figure's handle is held once by the live list and once by each entry that
 * refers to it (`foldedFigureHandles.ts`). A step swaps the two: the restored
 * entry's figures become the live list and the live figures become the pushed
 * entry, so each handle keeps the references it had and nothing is retained or
 * released. Counting it as a release of the restored entry and a retain of the
 * pushed one balanced only when both held the same handle; a step between two
 * folds — a refold, an Apply of a layer order, a delete — freed the fold it was
 * putting back on screen. An entry that never captured figures leaves the live
 * ones live, so the pushed entry takes a reference of its own.
 */
function swappedCpHistoryEntry(
  restoring: OristudioCpHistoryEntry,
  ...args: Parameters<typeof cpHistoryEntry>
): OristudioCpHistoryEntry {
  const entry = cpHistoryEntry(...args);
  if (!restoring.foldedFigures) retainFoldedFigureHandles(entry.foldedFigures);
  return entry;
}

/**
 * Put back the crease pattern a history entry recorded. Answers the document
 * state to install and, for a selection entry, the selected lines it replaced,
 * which the entry for the opposite direction records in turn.
 *
 * A selection entry (`selectedLines`) changed nothing but which lines are
 * selected, so only those go back into the kernel, and the store keeps its
 * snapshot and geometry (`mirrorSelectedLines`). Any other entry restores its
 * whole document, from the compact geometry it holds.
 */
async function restoreEntryDocument(
  entry: OristudioCpHistoryEntry,
  current: OristudioCpDocumentState,
  live: () => OristudioCpDocumentState | null
): Promise<{
  restored: OristudioCpDocumentState;
  replacedLines: OristudioCpSelectedLines | undefined;
}> {
  if (!entry.selectedLines) {
    if (!entry.document) throw new Error(`The undo step "${entry.label}" holds no crease pattern`);
    return {
      restored: await restoreCpHistoryDocument(entry.document, current.source, null),
      replacedLines: undefined,
    };
  }
  const replacedLines = await setOristudioCpSelectedLines(entry.selectedLines);
  return {
    restored: await documentStateAfterSelection(
      current,
      live(),
      replacedLines,
      entry.selectedLines,
      null
    ),
    replacedLines,
  };
}

/**
 * What the entry for the opposite direction records of `current`, once a
 * document step has put back `replacedLines` (a selection) or a whole document.
 */
function oppositeContent(
  current: OristudioCpDocumentState,
  replacedLines: OristudioCpSelectedLines | undefined
): CpHistoryContent {
  return replacedLines
    ? { kind: 'selection', replacedLines }
    : { kind: 'document', document: cpHistoryDocumentOf(current) };
}

function setRestoredCreasePatternState(
  restored: OristudioCpDocumentState,
  selection: OristudioCpSelection,
  camvResult: OristudioCpCommandResult | null
) {
  return {
    oristudioCpDocument: restored,
    oristudioCpOperationDescriptors: restored.operationDescriptors,
    oristudioCpSelection: selection,
    oristudioCpActiveDiagnosticId: null,
    oristudioCpCamvResult: camvResult,
    oristudioCpError: null,
    error: null,
    dirty: true,
    status: 'crease_pattern_ready' as const,
  };
}

export const createHistorySlice: WorkspaceSliceCreator<HistorySlice> = (set, get) => {
  // BP undo/redo is snapshot-based (like the CP editor): each user action records
  // the previous serialized project, and undo/redo restore a whole snapshot. This
  // sidesteps the ported engine command-history (which mis-restores structural
  // adds) and gives exactly one undo per user action. Returns false when there is
  // nothing to navigate.
  const navigateBpHistory = async (
    pick: (
      history: SnapshotHistory<BpHistorySnapshot>,
      current: SnapshotEntry<BpHistorySnapshot>
    ) => { restore: SnapshotEntry<BpHistorySnapshot>; history: SnapshotHistory<BpHistorySnapshot> } | null,
    verb: 'Undid' | 'Redid'
  ): Promise<boolean> => {
    // Captured before the first await. Restoring a snapshot is a worker round
    // trip, and a tab switch during it would otherwise write this design's
    // document over whichever design the user landed on.
    const designId = get().activeDesignId;
    const document = selectOristudioBpDocument(get(), designId);
    if (!document || get().oristudioBpHistoryBusy) return false;
    const history: SnapshotHistory<BpHistorySnapshot> = {
      past: selectOristudioBpHistoryPast(get(), designId),
      future: selectOristudioBpHistoryFuture(get(), designId),
    };
    set({ oristudioBpHistoryBusy: true, error: null, oristudioBpError: null });
    try {
      const currentBps = await exportOristudioBpProjectAsSessionBps();
      const current = snapshotEntry(
        {
          bps: currentBps,
          selection: selectOristudioBpSelection(get(), designId),
          symmetry: bpDocumentSymmetry(selectOristudioBpSymmetry(get(), designId)),
        },
        document.history.activeLabel ?? 'edit'
      );
      const step = pick(history, current);
      if (!step) {
        set({ oristudioBpHistoryBusy: false });
        return false;
      }
      // A symmetry-only step carries no `bps`, because it did not touch the
      // design — rebuilding the project from the current text would be a
      // needless worker round-trip that also throws away the live handle.
      const restoredBps = step.restore.snapshot.bps;
      const restored =
        restoredBps === null ? document : await restoreOristudioBpProjectSnapshot(restoredBps);
      set({
        ...patchBoxPleatDesign(
          get(),
          {
            document: restored,
            // The axis stays derived; only the saved half of symmetry is restored.
            symmetry: {
              ...selectOristudioBpSymmetry(get(), designId),
              ...step.restore.snapshot.symmetry,
            },
            historyPast: step.history.past,
            historyFuture: step.history.future,
            // Restored as presentation — showing what the step touched — not
            // because the selection was stored as part of the document.
            selection: step.restore.snapshot.selection,
          },
          designId
        ),
        oristudioBpHistoryBusy: false,
        dirty: true,
        error: null,
        oristudioBpError: null,
        projectMessage: `${verb} ${step.restore.label}`,
        oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage)});
    } catch (error) {
      const normalized = oristudioBpError(error);
      set({
      oristudioBpHistoryBusy: false,
        status: 'error',
        error: normalized,
        oristudioBpError: normalized.message});
    }
    return true;
  };

  return {
    // The three undo guards. Stacks live per design (see `TreemakerDesignState`);
    // the guards are per *surface*, because tree, crease-pattern and box-pleat
    // undo run independently and must not gate each other.
    historyBusy: false,
    oristudioCpHistoryBusy: false,
    oristudioBpHistoryBusy: false,

    beginHistoryCheckpoint: async () => {
    if (get().activeEditingContext !== 'treemaker-tree') return null;
    // Captured before the await, and carried through to the commit: the edit
    // between them is an engine round trip, and the user can switch tabs during
    // it. See `mapDesignTab`.
    const designId = get().activeDesignId;
    try {
      const { api, treeHandle } = await ensureTreeHandle();
      return { text: await api.saveTmd5(treeHandle), designId };
    } catch {
      return null;
    }
  },

  commitHistoryCheckpoint: (checkpoint, label = 'Edit') => {
    if (!checkpoint || get().historyBusy) return;
    const { text, designId } = checkpoint;
    const past = selectHistoryPast(get(), designId);
    if (past.at(-1)?.text === text) {
      set({
      ...patchTreemakerDesign(get(), { historyFuture: [] }, designId),});
      return;
    }
    set({
      ...patchTreemakerDesign(get(), {
      historyPast: [...past, historyEntry(text, label)].slice(-MAX_HISTORY),
      historyFuture: []
      }, designId),});
  },

  clearHistory: () => {
    // Entries own their figures' wasm handles; dropping the stacks lets go.
    for (const entry of [...get().oristudioCpHistoryPast, ...get().oristudioCpHistoryFuture]) {
      releaseFoldedFigureHandles(entry.foldedFigures ?? []);
    }
    set({
      ...patchTreemakerDesign(get(), {
      historyPast: [],
      historyFuture: []
      }),
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpActiveDiagnosticId: null,
      oristudioCpCamvResult: null});
  },

  undo: async () => {
    if (get().diagramImportBusy) return;
    const undoCreasePattern = async () => {
      if (get().oristudioCpHistoryPast.at(-1)?.compoundId) return await compoundImportTravel('undo') ?? false;
      const past = get().oristudioCpHistoryPast;
      const previous = past.at(-1);
      const current = get().oristudioCpDocument;
      if (!previous || !current || get().oristudioCpHistoryBusy) return false;
      const currentSelection = get().oristudioCpSelection;
      const currentAnnotations = get().oristudioCpAnnotations;
      const currentFoldedFigures = get().oristudioCpFoldedFigures;
      const currentActiveFoldedId = get().oristudioCpActiveFoldedFigureId;
      const currentInlineSimulations = get().oristudioCpInlineSimulations;
      set({
      oristudioCpHistoryBusy: true, error: null, oristudioCpError: null });
      try {
        // Overlay-only edits (annotations, folded figures): swap those layers
        // without reloading the (unchanged) wasm document, so they stay cheap.
        if (previous.overlayOnly) {
          set({
      oristudioCpHistoryBusy: false,
            oristudioCpAnnotations: previous.annotations,
            oristudioCpSelectedAnnotationId: restoredAnnotationSelection(
              previous,
              get().oristudioCpSelectedAnnotationId
            ),
            ...restoredFoldedFigureState(previous),
            ...restoredInlineSimulationState(previous),
            oristudioCpHistoryPast: past.slice(0, -1),
            oristudioCpHistoryFuture: [
              swappedCpHistoryEntry(
                previous,
                { kind: 'overlay' },
                currentSelection,
                currentAnnotations,
                currentFoldedFigures,
                currentActiveFoldedId,
                currentInlineSimulations,
                previous.label
              ),
              ...get().oristudioCpHistoryFuture,
            ].slice(0, MAX_HISTORY),
            dirty: true,
            projectMessage: `Undid ${previous.label}`});
          // The state swap above is web-side only, so the kernel still holds the
          // model this step just undid. Reconcile after the synchronous `set`,
          // never awaited: making the branch async would make `historyBusy` a
          // real gate and silently drop undos held down on the keyboard.
          get().reconcileFoldedFigureModels(previous.foldedFigures?.map((f) => f.id) ?? []);
          // A restored window's fold is rebuilt, not held by history — see
          // `restoreOristudioCpInlineSimulationSources`. Fire-and-forget after
          // the synchronous `set`, for the same reason as the reconcile above:
          // awaiting here would make `historyBusy` a real gate and silently drop
          // undos held down on the keyboard. No-ops when no fold is missing.
          void get().restoreOristudioCpInlineSimulationSources();
          return true;
        }
        const { restored, replacedLines } = await restoreEntryDocument(previous, current, () =>
          get().oristudioCpDocument
        );
        // Apply immediately; the always-on CAMV overlay recomputes off the critical
        // path (keeps the previous result until the deferred refresh lands).
        set({
      oristudioCpHistoryBusy: false,
          ...setRestoredCreasePatternState(
            restored,
            previous.selection,
            get().oristudioCpCamvResult
          ),
          oristudioCpAnnotations: previous.annotations,
          oristudioCpSelectedAnnotationId: restoredAnnotationSelection(
            previous,
            get().oristudioCpSelectedAnnotationId
          ),
          ...restoredFoldedFigureState(previous),
          ...restoredInlineSimulationState(previous),
          oristudioCpHistoryPast: past.slice(0, -1),
          oristudioCpHistoryFuture: [
            swappedCpHistoryEntry(
              previous,
              oppositeContent(current, replacedLines),
              currentSelection,
              currentAnnotations,
              currentFoldedFigures,
              currentActiveFoldedId,
              currentInlineSimulations,
              previous.label
            ),
            ...get().oristudioCpHistoryFuture,
          ].slice(0, MAX_HISTORY),
          ...(replacedLines ? {} : staleFoldArtifactResourceState(get().foldArtifactRevision)),
          projectMessage: `Undid ${previous.label}`});
        if (!replacedLines) get().scheduleOristudioCamvRefresh();
        // Windows restored by a document-level undo need their folds too; see
        // the overlay branch above for why this is not awaited.
        void get().restoreOristudioCpInlineSimulationSources();
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({
      oristudioCpHistoryBusy: false,
          status: 'error',
          error: normalized,
          oristudioCpError: normalized.message});
      }
      return true;
    };

    const undoTree = async () => {
      if (get().activeEditingContext !== 'treemaker-tree') return false;
      // Addressed write: an undo round-trips the tree through `.tmd5`, and the
      // user can switch tabs while the engine reloads it. See `mapDesignTab`.
      const designId = get().activeDesignId;
      const past = selectHistoryPast(get(), designId);
      const previous = past.at(-1);
      if (!previous || get().historyBusy) return false;
      set({
      historyBusy: true, error: null });
      try {
        const { api, treeHandle } = await ensureTreeHandle();
        const current = await api.saveTmd5(treeHandle);
        const engine = await getEngine();
        const snapshot = await loadTreeFromText(engine, previous.text);
        set({
          // The restored history rides *inside* the install rather than beside
          // it: both write `designTabs`, so a sibling spread would simply be
          // overwritten by whichever came second.
          ...projectStateFromSnapshot(
            get(),
            snapshot,
            selectProject(get(), designId).title,
            {
              historyPast: past.slice(0, -1),
              historyFuture: [
                historyEntry(current, previous.label),
                ...selectHistoryFuture(get(), designId),
              ].slice(0, MAX_HISTORY),
              selection: { kind: 'tree' },
              symmetryAuthoringPairs: [],
              lastOptimization: null,
            },
            designId
          ),
          historyBusy: false,
          status: statusFromSnapshot(snapshot),
          dirty: true,
          projectMessage: `Undid ${previous.label}`,
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage)});
      } catch (error) {
        set({
      historyBusy: false, status: 'error', error: engineError(error)});
      }
      return true;
    };

    const context = get().activeEditingContext;
    if (context === 'bp-tree' || context === 'bp-packing') {
      await navigateBpHistory(undoSnapshot, 'Undid');
      return;
    }
    if (context === 'explori-tree' || context === 'explori-results') {
      await get().undoExplori();
      return;
    }
    // The Diagram's own stack. Never the tree's or the crease pattern's: the
    // diagram is what is on screen, and running theirs would change a document
    // that is not.
    if (context === 'diagram') {
      get().undoDiagram();
      return;
    }
    // Fold's own stack, for the same reason: the sequence is on screen.
    if (context === 'fold') {
      get().undoFold();
      return;
    }
    // Neither Simulate nor References has a history stack of its own, and
    // falling through would run the undo against a document that is not on
    // screen.
    if (context === 'design-nux' || context === 'simulate' || context === 'references') return;

    if (get().activeEditingContext === 'crease-pattern') {
      if (await undoCreasePattern()) return;
      await undoTree();
    } else {
      if (await undoTree()) return;
      await undoCreasePattern();
    }
  },

  redo: async () => {
    if (get().diagramImportBusy) return;
    const redoCreasePattern = async () => {
      if (get().oristudioCpHistoryFuture[0]?.compoundId) return await compoundImportTravel('redo') ?? false;
      const future = get().oristudioCpHistoryFuture;
      const next = future[0];
      const current = get().oristudioCpDocument;
      if (!next || !current || get().oristudioCpHistoryBusy) return false;
      const currentSelection = get().oristudioCpSelection;
      const currentAnnotations = get().oristudioCpAnnotations;
      const currentFoldedFigures = get().oristudioCpFoldedFigures;
      const currentActiveFoldedId = get().oristudioCpActiveFoldedFigureId;
      const currentInlineSimulations = get().oristudioCpInlineSimulations;
      set({
      oristudioCpHistoryBusy: true, error: null, oristudioCpError: null });
      try {
        if (next.overlayOnly) {
          set({
      oristudioCpHistoryBusy: false,
            oristudioCpAnnotations: next.annotations,
            oristudioCpSelectedAnnotationId: restoredAnnotationSelection(
              next,
              get().oristudioCpSelectedAnnotationId
            ),
            ...restoredFoldedFigureState(next),
            ...restoredInlineSimulationState(next),
            oristudioCpHistoryPast: [
              ...get().oristudioCpHistoryPast,
              swappedCpHistoryEntry(
                next,
                { kind: 'overlay' },
                currentSelection,
                currentAnnotations,
                currentFoldedFigures,
                currentActiveFoldedId,
                currentInlineSimulations,
                next.label
              ),
            ].slice(-MAX_HISTORY),
            oristudioCpHistoryFuture: future.slice(1),
            dirty: true,
            projectMessage: `Redid ${next.label}`});
          get().reconcileFoldedFigureModels(next.foldedFigures?.map((f) => f.id) ?? []);
          // A restored window's fold is rebuilt, not held by history — see
          // `restoreOristudioCpInlineSimulationSources`. Fire-and-forget after
          // the synchronous `set`, for the same reason as the reconcile above:
          // awaiting here would make `historyBusy` a real gate and silently drop
          // undos held down on the keyboard. No-ops when no fold is missing.
          void get().restoreOristudioCpInlineSimulationSources();
          return true;
        }
        const { restored, replacedLines } = await restoreEntryDocument(next, current, () =>
          get().oristudioCpDocument
        );
        set({
      oristudioCpHistoryBusy: false,
          ...setRestoredCreasePatternState(restored, next.selection, get().oristudioCpCamvResult),
          oristudioCpAnnotations: next.annotations,
          oristudioCpSelectedAnnotationId: restoredAnnotationSelection(
            next,
            get().oristudioCpSelectedAnnotationId
          ),
          ...restoredFoldedFigureState(next),
          ...restoredInlineSimulationState(next),
          oristudioCpHistoryPast: [
            ...get().oristudioCpHistoryPast,
            swappedCpHistoryEntry(
              next,
              oppositeContent(current, replacedLines),
              currentSelection,
              currentAnnotations,
              currentFoldedFigures,
              currentActiveFoldedId,
              currentInlineSimulations,
              next.label
            ),
          ].slice(-MAX_HISTORY),
          oristudioCpHistoryFuture: future.slice(1),
          ...(replacedLines ? {} : staleFoldArtifactResourceState(get().foldArtifactRevision)),
          projectMessage: `Redid ${next.label}`});
        if (!replacedLines) get().scheduleOristudioCamvRefresh();
        // Windows restored by a document-level undo need their folds too; see
        // the overlay branch above for why this is not awaited.
        void get().restoreOristudioCpInlineSimulationSources();
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({
      oristudioCpHistoryBusy: false,
          status: 'error',
          error: normalized,
          oristudioCpError: normalized.message});
      }
      return true;
    };

    const redoTree = async () => {
      if (get().activeEditingContext !== 'treemaker-tree') return false;
      // Addressed write; see the note in `undoTree`.
      const designId = get().activeDesignId;
      const future = selectHistoryFuture(get(), designId);
      const next = future[0];
      if (!next || get().historyBusy) return false;
      set({
      historyBusy: true, error: null });
      try {
        const { api, treeHandle } = await ensureTreeHandle();
        const current = await api.saveTmd5(treeHandle);
        const engine = await getEngine();
        const snapshot = await loadTreeFromText(engine, next.text);
        set({
          // See the note in `undoTree`: the history must be installed with the
          // tree, not spread next to it.
          ...projectStateFromSnapshot(
            get(),
            snapshot,
            selectProject(get(), designId).title,
            {
              historyPast: [
                ...selectHistoryPast(get(), designId),
                historyEntry(current, next.label),
              ].slice(-MAX_HISTORY),
              historyFuture: future.slice(1),
              selection: { kind: 'tree' },
              symmetryAuthoringPairs: [],
              lastOptimization: null,
            },
            designId
          ),
          historyBusy: false,
          status: statusFromSnapshot(snapshot),
          dirty: true,
          projectMessage: `Redid ${next.label}`,
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage)});
      } catch (error) {
        set({
      historyBusy: false, status: 'error', error: engineError(error)});
      }
      return true;
    };

    const context = get().activeEditingContext;
    if (context === 'bp-tree' || context === 'bp-packing') {
      await navigateBpHistory(redoSnapshot, 'Redid');
      return;
    }
    if (context === 'explori-tree' || context === 'explori-results') {
      await get().redoExplori();
      return;
    }
    // The Diagram's own stack. Never the tree's or the crease pattern's: the
    // diagram is what is on screen, and running theirs would change a document
    // that is not.
    if (context === 'diagram') {
      get().redoDiagram();
      return;
    }
    // Fold's own stack, for the same reason: the sequence is on screen.
    if (context === 'fold') {
      get().redoFold();
      return;
    }
    // Neither Simulate nor References has a history stack of its own, and
    // falling through would run the undo against a document that is not on
    // screen.
    if (context === 'design-nux' || context === 'simulate' || context === 'references') return;

    if (get().activeEditingContext === 'crease-pattern') {
      if (await redoCreasePattern()) return;
      await redoTree();
    } else {
      if (await redoTree()) return;
      await redoCreasePattern();
    }
  },
  };
};
