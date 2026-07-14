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
  executeOristudioCpCommand as executeRuntimeOristudioCpCommand,
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
import type { BpHistorySnapshot } from '../types';
import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';

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
  label = 'Edit'
): OristudioCpHistoryEntry {
  return {
    document,
    selection,
    label,
    timestamp: new Date().toISOString(),
  };
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

async function refreshAlwaysOnCamvDiagnostics(
  restored: OristudioCpDocumentState
): Promise<{
  restored: OristudioCpDocumentState;
  camvResult: OristudioCpCommandResult | null;
}> {
  try {
    const checkedDocument = await executeRuntimeOristudioCpCommand('CheckCamv');
    return {
      restored: {
        ...checkedDocument,
        lastCommandResult: restored.lastCommandResult,
      },
      camvResult:
        checkedDocument.lastCommandResult?.operation === 'CheckCamv'
          ? checkedDocument.lastCommandResult
          : null,
    };
  } catch {
    return { restored, camvResult: null };
  }
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
        { bps: currentBps, selection: document.selection },
        document.history.activeLabel ?? 'edit'
      );
      const step = pick(history, current);
      if (!step) {
        set({ historyBusy: false });
        return false;
      }
      const restored = await restoreOristudioBpProjectSnapshot(step.restore.snapshot.bps);
      set({
        oristudioBpDocument: { ...restored, selection: step.restore.snapshot.selection },
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

  clearHistory: () =>
    set({
      historyPast: [],
      historyFuture: [],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpActiveDiagnosticId: null,
      oristudioCpCamvResult: null,
    }),

  undo: async () => {
    const undoCreasePattern = async () => {
      const past = get().oristudioCpHistoryPast;
      const previous = past.at(-1);
      const current = get().oristudioCpDocument;
      if (!previous || !current || get().historyBusy) return false;
      const currentSelection = get().oristudioCpSelection;
      set({ historyBusy: true, error: null, oristudioCpError: null });
      try {
        const restored = await restoreOristudioCpDocumentInPlace(
          previous.document,
          current.source,
          null
        );
        const checked = await refreshAlwaysOnCamvDiagnostics(restored);
        set({
          ...setRestoredCreasePatternState(
            checked.restored,
            previous.selection,
            checked.camvResult
          ),
          oristudioCpHistoryPast: past.slice(0, -1),
          oristudioCpHistoryFuture: [
            cpHistoryEntry(current.document, currentSelection, previous.label),
            ...get().oristudioCpHistoryFuture,
          ].slice(0, MAX_HISTORY),
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          activeEditingSurface: 'crease-pattern',
          historyBusy: false,
          projectMessage: `Undid ${previous.label}`,
        });
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
          activeEditingSurface: 'tree',
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
      set({ historyBusy: true, error: null, oristudioCpError: null });
      try {
        const restored = await restoreOristudioCpDocumentInPlace(
          next.document,
          current.source,
          null
        );
        const checked = await refreshAlwaysOnCamvDiagnostics(restored);
        set({
          ...setRestoredCreasePatternState(checked.restored, next.selection, checked.camvResult),
          oristudioCpHistoryPast: [
            ...get().oristudioCpHistoryPast,
            cpHistoryEntry(current.document, currentSelection, next.label),
          ].slice(-MAX_HISTORY),
          oristudioCpHistoryFuture: future.slice(1),
          ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          activeEditingSurface: 'crease-pattern',
          historyBusy: false,
          projectMessage: `Redid ${next.label}`,
        });
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
          activeEditingSurface: 'tree',
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
