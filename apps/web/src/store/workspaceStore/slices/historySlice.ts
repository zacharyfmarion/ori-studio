import {
  engineError,
  ensureTreeHandle,
  getEngine,
  loadTreeFromText,
  projectStateFromSnapshot,
  statusFromSnapshot,
} from '../engineRuntime';
import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import {
  oristudioCpError,
  restoreOristudioCpDocumentInPlace,
} from '../oristudioCpRuntime';
import {
  exportOristudioBpProjectAsBps,
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
  OristudioCpHistoryEntry,
  WorkspaceSliceCreator,
} from '../types';
import type {
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
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

const MAX_HISTORY = 100;

function historyEntry(text: string, label = 'Edit'): HistoryEntry {
  return {
    text,
    label,
    timestamp: new Date().toISOString(),
  };
}

function cpHistoryEntry(
  document: OristudioCpDocumentSnapshot,
  selection: OristudioCpSelection,
  annotations: CanvasAnnotation[],
  foldedFigures: OristudioCpFoldedFigureEntry[],
  activeFoldedFigureId: string | null,
  inlineSimulations: InlineSimulation[],
  label = 'Edit',
  overlayOnly = false
): OristudioCpHistoryEntry {
  return {
    document,
    selection,
    annotations,
    foldedFigures,
    activeFoldedFigureId,
    inlineSimulations,
    overlayOnly,
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
 * Build a history entry that owns its figures' handles. Undo/redo move an entry
 * from one stack to the other; the entry leaving releases (via
 * {@link releasedFrom}) and the entry being pushed retains here, so a handle
 * stays alive exactly as long as some stack still refers to it.
 */
function retainedCpHistoryEntry(
  ...args: Parameters<typeof cpHistoryEntry>
): OristudioCpHistoryEntry {
  const entry = cpHistoryEntry(...args);
  retainFoldedFigureHandles(entry.foldedFigures);
  return entry;
}

/** Release the handles of an entry that has just left a stack. */
function releasedFrom<T extends OristudioCpHistoryEntry[]>(remaining: T, leaving: OristudioCpHistoryEntry): T {
  releaseFoldedFigureHandles(leaving.foldedFigures ?? []);
  return remaining;
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
    const document = get().oristudioBpDocument;
    if (!document || get().historyBusy) return false;
    const history: SnapshotHistory<BpHistorySnapshot> = {
      past: get().oristudioBpHistoryPast,
      future: get().oristudioBpHistoryFuture,
    };
    set({ historyBusy: true, error: null, oristudioBpError: null });
    try {
      const currentBps = await exportOristudioBpProjectAsBps();
      const current = snapshotEntry(
        {
          bps: currentBps,
          selection: get().oristudioBpSelection,
          symmetry: bpDocumentSymmetry(get().oristudioBpSymmetry),
        },
        document.history.activeLabel ?? 'edit'
      );
      const step = pick(history, current);
      if (!step) {
        set({ historyBusy: false });
        return false;
      }
      // A symmetry-only step carries no `bps`, because it did not touch the
      // design — rebuilding the project from the current text would be a
      // needless worker round-trip that also throws away the live handle.
      const restoredBps = step.restore.snapshot.bps;
      const restored =
        restoredBps === null ? document : await restoreOristudioBpProjectSnapshot(restoredBps);
      set({
        oristudioBpDocument: restored,
        // The axis stays derived; only the saved half of symmetry is restored.
        oristudioBpSymmetry: {
          ...get().oristudioBpSymmetry,
          ...step.restore.snapshot.symmetry,
        },
        // Restored as presentation — showing what the step touched — not because
        // the selection was stored as part of the document.
        oristudioBpSelection: step.restore.snapshot.selection,
        oristudioBpHistoryPast: step.history.past,
        oristudioBpHistoryFuture: step.history.future,
        dirty: true,
        historyBusy: false,
        error: null,
        oristudioBpError: null,
        projectMessage: `${verb} ${step.restore.label}`,
        oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
      });
    } catch (error) {
      const normalized = oristudioBpError(error);
      set({
        status: 'error',
        error: normalized,
        oristudioBpError: normalized.message,
        historyBusy: false,
      });
    }
    return true;
  };

  return {
  historyPast: [],
  historyFuture: [],
  historyBusy: false,

  beginHistoryCheckpoint: async () => {
    if (get().activeEditingContext !== 'treemaker-tree') return null;
    try {
      const { api, treeHandle } = await ensureTreeHandle();
      return api.saveTmd5(treeHandle);
    } catch {
      return null;
    }
  },

  commitHistoryCheckpoint: (beforeText, label = 'Edit') => {
    if (!beforeText || get().historyBusy) return;
    const past = get().historyPast;
    if (past.at(-1)?.text === beforeText) {
      set({ historyFuture: [] });
      return;
    }
    set({
      historyPast: [...past, historyEntry(beforeText, label)].slice(-MAX_HISTORY),
      historyFuture: [],
    });
  },

  clearHistory: () => {
    // Entries own their figures' wasm handles; dropping the stacks lets go.
    for (const entry of [...get().oristudioCpHistoryPast, ...get().oristudioCpHistoryFuture]) {
      releaseFoldedFigureHandles(entry.foldedFigures ?? []);
    }
    set({
      historyPast: [],
      historyFuture: [],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpActiveDiagnosticId: null,
      oristudioCpCamvResult: null,
    });
  },

  undo: async () => {
    const undoCreasePattern = async () => {
      const past = get().oristudioCpHistoryPast;
      const previous = past.at(-1);
      const current = get().oristudioCpDocument;
      if (!previous || !current || get().historyBusy) return false;
      const currentSelection = get().oristudioCpSelection;
      const currentAnnotations = get().oristudioCpAnnotations;
      const currentFoldedFigures = get().oristudioCpFoldedFigures;
      const currentActiveFoldedId = get().oristudioCpActiveFoldedFigureId;
      const currentInlineSimulations = get().oristudioCpInlineSimulations;
      set({ historyBusy: true, error: null, oristudioCpError: null });
      try {
        // Overlay-only edits (annotations, folded figures): swap those layers
        // without reloading the (unchanged) wasm document, so they stay cheap.
        if (previous.overlayOnly) {
          set({
            oristudioCpAnnotations: previous.annotations,
            oristudioCpSelectedAnnotationId: null,
            ...restoredFoldedFigureState(previous),
            ...restoredInlineSimulationState(previous),
            oristudioCpHistoryPast: releasedFrom(past.slice(0, -1), previous),
            oristudioCpHistoryFuture: [
              retainedCpHistoryEntry(
                current.document,
                currentSelection,
                currentAnnotations,
                currentFoldedFigures,
                currentActiveFoldedId,
                currentInlineSimulations,
                previous.label,
                true
              ),
              ...get().oristudioCpHistoryFuture,
            ].slice(0, MAX_HISTORY),
            dirty: true,
            historyBusy: false,
            projectMessage: `Undid ${previous.label}`,
          });
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
        const restored = await restoreOristudioCpDocumentInPlace(
          previous.document,
          current.source,
          null
        );
        // Apply immediately; the always-on CAMV overlay recomputes off the critical
        // path (keeps the previous result until the deferred refresh lands).
        set({
          ...setRestoredCreasePatternState(
            restored,
            previous.selection,
            get().oristudioCpCamvResult
          ),
          oristudioCpAnnotations: previous.annotations,
          oristudioCpSelectedAnnotationId: null,
          ...restoredFoldedFigureState(previous),
          ...restoredInlineSimulationState(previous),
          oristudioCpHistoryPast: releasedFrom(past.slice(0, -1), previous),
          oristudioCpHistoryFuture: [
            retainedCpHistoryEntry(
              current.document,
              currentSelection,
              currentAnnotations,
              currentFoldedFigures,
              currentActiveFoldedId,
              currentInlineSimulations,
              previous.label,
              false
            ),
            ...get().oristudioCpHistoryFuture,
          ].slice(0, MAX_HISTORY),
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          historyBusy: false,
          projectMessage: `Undid ${previous.label}`,
        });
        get().scheduleOristudioCamvRefresh();
        // Windows restored by a document-level undo need their folds too; see
        // the overlay branch above for why this is not awaited.
        void get().restoreOristudioCpInlineSimulationSources();
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({
          status: 'error',
          error: normalized,
          oristudioCpError: normalized.message,
          historyBusy: false,
        });
      }
      return true;
    };

    const undoTree = async () => {
      if (get().activeEditingContext !== 'treemaker-tree') return false;
      const past = get().historyPast;
      const previous = past.at(-1);
      if (!previous || get().historyBusy) return false;
      set({ historyBusy: true, error: null });
      try {
        const { api, treeHandle } = await ensureTreeHandle();
        const current = await api.saveTmd5(treeHandle);
        const engine = await getEngine();
        const snapshot = await loadTreeFromText(engine, previous.text);
        set({
          ...projectStateFromSnapshot(snapshot, get().project.title),
          historyPast: past.slice(0, -1),
          historyFuture: [historyEntry(current, previous.label), ...get().historyFuture].slice(
            0,
            MAX_HISTORY
          ),
          historyBusy: false,
          selection: { kind: 'tree' },
          symmetryAuthoringPairs: [],
          status: statusFromSnapshot(snapshot),
          dirty: true,
          projectMessage: `Undid ${previous.label}`,
          lastOptimization: null,
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
        });
      } catch (error) {
        set({ status: 'error', error: engineError(error), historyBusy: false });
      }
      return true;
    };

    const context = get().activeEditingContext;
    if (context === 'bp-tree' || context === 'bp-packing') {
      await navigateBpHistory(undoSnapshot, 'Undid');
      return;
    }
    if (context === 'design-nux' || context === 'simulate') return;

    if (get().activeEditingContext === 'crease-pattern') {
      if (await undoCreasePattern()) return;
      await undoTree();
    } else {
      if (await undoTree()) return;
      await undoCreasePattern();
    }
  },

  redo: async () => {
    const redoCreasePattern = async () => {
      const future = get().oristudioCpHistoryFuture;
      const next = future[0];
      const current = get().oristudioCpDocument;
      if (!next || !current || get().historyBusy) return false;
      const currentSelection = get().oristudioCpSelection;
      const currentAnnotations = get().oristudioCpAnnotations;
      const currentFoldedFigures = get().oristudioCpFoldedFigures;
      const currentActiveFoldedId = get().oristudioCpActiveFoldedFigureId;
      const currentInlineSimulations = get().oristudioCpInlineSimulations;
      set({ historyBusy: true, error: null, oristudioCpError: null });
      try {
        if (next.overlayOnly) {
          set({
            oristudioCpAnnotations: next.annotations,
            oristudioCpSelectedAnnotationId: null,
            ...restoredFoldedFigureState(next),
            ...restoredInlineSimulationState(next),
            oristudioCpHistoryPast: [
              ...get().oristudioCpHistoryPast,
              retainedCpHistoryEntry(
                current.document,
                currentSelection,
                currentAnnotations,
                currentFoldedFigures,
                currentActiveFoldedId,
                currentInlineSimulations,
                next.label,
                true
              ),
            ].slice(-MAX_HISTORY),
            oristudioCpHistoryFuture: releasedFrom(future.slice(1), next),
            dirty: true,
            historyBusy: false,
            projectMessage: `Redid ${next.label}`,
          });
          get().reconcileFoldedFigureModels(next.foldedFigures?.map((f) => f.id) ?? []);
          // A restored window's fold is rebuilt, not held by history — see
          // `restoreOristudioCpInlineSimulationSources`. Fire-and-forget after
          // the synchronous `set`, for the same reason as the reconcile above:
          // awaiting here would make `historyBusy` a real gate and silently drop
          // undos held down on the keyboard. No-ops when no fold is missing.
          void get().restoreOristudioCpInlineSimulationSources();
          return true;
        }
        const restored = await restoreOristudioCpDocumentInPlace(
          next.document,
          current.source,
          null
        );
        set({
          ...setRestoredCreasePatternState(restored, next.selection, get().oristudioCpCamvResult),
          oristudioCpAnnotations: next.annotations,
          oristudioCpSelectedAnnotationId: null,
          ...restoredFoldedFigureState(next),
          ...restoredInlineSimulationState(next),
          oristudioCpHistoryPast: [
            ...get().oristudioCpHistoryPast,
            retainedCpHistoryEntry(
              current.document,
              currentSelection,
              currentAnnotations,
              currentFoldedFigures,
              currentActiveFoldedId,
              currentInlineSimulations,
              next.label,
              false
            ),
          ].slice(-MAX_HISTORY),
          oristudioCpHistoryFuture: releasedFrom(future.slice(1), next),
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          historyBusy: false,
          projectMessage: `Redid ${next.label}`,
        });
        get().scheduleOristudioCamvRefresh();
        // Windows restored by a document-level undo need their folds too; see
        // the overlay branch above for why this is not awaited.
        void get().restoreOristudioCpInlineSimulationSources();
      } catch (error) {
        const normalized = oristudioCpError(error);
        set({
          status: 'error',
          error: normalized,
          oristudioCpError: normalized.message,
          historyBusy: false,
        });
      }
      return true;
    };

    const redoTree = async () => {
      if (get().activeEditingContext !== 'treemaker-tree') return false;
      const future = get().historyFuture;
      const next = future[0];
      if (!next || get().historyBusy) return false;
      set({ historyBusy: true, error: null });
      try {
        const { api, treeHandle } = await ensureTreeHandle();
        const current = await api.saveTmd5(treeHandle);
        const engine = await getEngine();
        const snapshot = await loadTreeFromText(engine, next.text);
        set({
          ...projectStateFromSnapshot(snapshot, get().project.title),
          historyPast: [...get().historyPast, historyEntry(current, next.label)].slice(-MAX_HISTORY),
          historyFuture: future.slice(1),
          historyBusy: false,
          selection: { kind: 'tree' },
          symmetryAuthoringPairs: [],
          status: statusFromSnapshot(snapshot),
          dirty: true,
          projectMessage: `Redid ${next.label}`,
          lastOptimization: null,
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
        });
      } catch (error) {
        set({ status: 'error', error: engineError(error), historyBusy: false });
      }
      return true;
    };

    const context = get().activeEditingContext;
    if (context === 'bp-tree' || context === 'bp-packing') {
      await navigateBpHistory(redoSnapshot, 'Redid');
      return;
    }
    if (context === 'design-nux' || context === 'simulate') return;

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
