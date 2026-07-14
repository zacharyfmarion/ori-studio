import { getBoxPleatExampleProject } from '../../../examples/catalog';
import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';
import { requestConfirmation } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import {
  addOristudioBpTreeLeaf as addRuntimeOristudioBpTreeLeaf,
  completeOristudioBpStretch as completeRuntimeOristudioBpStretch,
  deleteOristudioBpTreeLeaf as deleteRuntimeOristudioBpTreeLeaf,
  exportOristudioBpProjectAsBps,
  exportOristudioBpProjectAsCp,
  flipOristudioBpLayoutSheet as flipRuntimeOristudioBpLayoutSheet,
  getOristudioBpPortDescriptors,
  loadOristudioBpProjectFromText,
  moveOristudioBpDevice as moveRuntimeOristudioBpDevice,
  moveOristudioBpLayoutFlap as moveRuntimeOristudioBpLayoutFlap,
  moveOristudioBpLayoutFlaps as moveRuntimeOristudioBpLayoutFlaps,
  moveOristudioBpTreeVertex as moveRuntimeOristudioBpTreeVertex,
  oristudioBpError,
  rotateOristudioBpLayoutSheet as rotateRuntimeOristudioBpLayoutSheet,
  subdivideOristudioBpLayoutSheet as subdivideRuntimeOristudioBpLayoutSheet,
  updateOristudioBpLayoutSheet as updateRuntimeOristudioBpLayoutSheet,
  updateOristudioBpTreeEdgeLength as updateRuntimeOristudioBpTreeEdgeLength,
  switchOristudioBpStretchConfig as switchRuntimeOristudioBpStretchConfig,
  switchOristudioBpStretchPattern as switchRuntimeOristudioBpStretchPattern,
} from '../oristudioBpRuntime';
import { recordSnapshot, snapshotEntry } from '../snapshotHistory';
import type { SnapshotEntry } from '../snapshotHistory';
import type { OristudioBpDocumentState } from '../../../engine/oristudioBpTypes';
import type { BpHistorySnapshot, OristudioBpSlice, WorkspaceSliceCreator } from '../types';

/**
 * A new Box Pleating design is scaffolded like BP Studio's blank project: a root
 * with two unit-length leaves (three nodes, the engine's minimum tree size — so
 * deletion is refused until the tree grows, matching BP Studio). Node positions
 * follow our length-faithful convention (distance == length) rather than BP
 * Studio's fixed grid offsets; the leaves get default flaps just off-centre so
 * they don't overlap.
 */
const BP_STARTER_PROJECT = JSON.stringify({
  version: '0.7',
  design: {
    title: '',
    mode: 'tree',
    layout: {
      sheet: { type: 'rect', width: 16, height: 16 },
      flaps: [
        { id: 1, x: 8, y: 7, width: 0, height: 0 },
        { id: 2, x: 8, y: 9, width: 0, height: 0 },
      ],
      stretches: [],
    },
    tree: {
      sheet: { type: 'rect', width: 20, height: 20 },
      nodes: [
        { id: 0, x: 10, y: 10, name: '', isNew: true },
        { id: 1, x: 10, y: 9, name: '', isNew: true },
        { id: 2, x: 10, y: 11, name: '', isNew: true },
      ],
      edges: [
        { n1: 0, n2: 1, length: 1 },
        { n1: 0, n2: 2, length: 1 },
      ],
    },
  },
});

/**
 * Box Pleating workspace slice. Phase 3 is the runtime foundation: it can create
 * and hold a BP document. The tree/packing editing surfaces and file/optimizer
 * actions are wired up in later phases.
 */
export const createOristudioBpSlice: WorkspaceSliceCreator<OristudioBpSlice> = (set, get) => {
  const confirmDiscardDirty = async (dirty: boolean): Promise<boolean> => {
    if (!dirty) return true;
    return requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Your current project has unsaved changes. Start a new Box Pleat design and discard them?',
      confirmLabel: 'Discard',
      tone: 'danger',
    });
  };

  const setLoadedBpProject = (document: OristudioBpDocumentState, message: string) => {
    pendingHistory = null;
    set({
      workflowTarget: 'box-pleat',
      pendingDesignChoice: false,
      documentMode: 'tree',
      activeEditingSurface: 'tree',
      importedCreasePattern: null,
      oristudioCpDocument: null,
      oristudioCpLineage: null,
      oristudioCpError: null,
      oristudioCpCamvResult: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioBpDocument: document,
      oristudioBpWorkspace: null,
      oristudioBpError: null,
      oristudioBpBusy: false,
      oristudioBpHistoryPast: [],
      oristudioBpHistoryFuture: [],
      currentFileName: document.source.filename,
      currentFilePath: document.source.path,
      dirty: document.dirty,
      projectMessage: message,
      status: 'ready',
      engineReady: true,
      error: null,
    });
    const layout = useLayoutStore.getState();
    layout.activateWorkspace('design');
    layout.ensureDesignLayout();
  };

  // Replace the active BP document after an edit and mark any generated BP
  // crease pattern stale (tree/packing edits invalidate a prior CP export).
  const replaceActiveBpDocument = (
    document: OristudioBpDocumentState,
    message: string,
    history?: { past: SnapshotEntry<BpHistorySnapshot>[]; future: SnapshotEntry<BpHistorySnapshot>[] }
  ) => {
    set({
      oristudioBpDocument: document,
      oristudioBpBusy: false,
      oristudioBpError: null,
      dirty: true,
      projectMessage: message,
      error: null,
      oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
      ...(history
        ? {
            oristudioBpHistoryPast: history.past,
            oristudioBpHistoryFuture: history.future,
          }
        : {}),
    });
  };

  // The "before" snapshot for the in-progress gesture. Captured lazily on the
  // first mutation of a gesture and committed as one history entry when the
  // gesture ends (dragging=false). A drag's intermediate steps keep it pending so
  // the whole drag is a single undo; likewise a compound action (add-leaf =
  // add + reposition) runs inside one runBpTreeMutation and commits once.
  let pendingHistory: SnapshotEntry<BpHistorySnapshot> | null = null;

  const runBpTreeMutation = async (
    message: string,
    operation: (document: OristudioBpDocumentState) => Promise<OristudioBpDocumentState>,
    options: { dragging?: boolean } = {}
  ): Promise<boolean> => {
    const document = get().oristudioBpDocument;
    if (!document) return false;
    set({ oristudioBpBusy: true });
    try {
      if (!pendingHistory) {
        const bps = await exportOristudioBpProjectAsBps();
        pendingHistory = snapshotEntry({ bps, selection: document.selection }, message);
      }
      const nextDocument = await operation(document);
      if (options.dragging) {
        // Mid-gesture: apply the document but hold the pending snapshot open.
        replaceActiveBpDocument(nextDocument, message);
      } else {
        const entry = pendingHistory;
        pendingHistory = null;
        replaceActiveBpDocument(
          nextDocument,
          message,
          recordSnapshot(
            {
              past: get().oristudioBpHistoryPast,
              future: get().oristudioBpHistoryFuture,
            },
            entry
          )
        );
      }
      return true;
    } catch (error) {
      pendingHistory = null;
      const normalized = oristudioBpError(error);
      set({ oristudioBpError: normalized.message, oristudioBpBusy: false, error: normalized });
      return false;
    }
  };

  return {
    oristudioBpDocument: null,
    oristudioBpWorkspace: null,
    oristudioBpPortDescriptors: [],
    oristudioBpError: null,
    oristudioBpBusy: false,
    oristudioBpHistoryPast: [],
    oristudioBpHistoryFuture: [],

    createOristudioBpProject: async (options = {}) => {
      if (options.confirmDiscard !== false && !(await confirmDiscardDirty(get().dirty))) {
        return false;
      }
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        await get().clearOristudioCpDocument();
        const [document, portDescriptors] = await Promise.all([
          loadOristudioBpProjectFromText(BP_STARTER_PROJECT, {
            filename: 'Untitled.bps',
            format: 'generated',
            dirty: false,
          }),
          getOristudioBpPortDescriptors().catch(() => []),
        ]);
        set({ oristudioBpPortDescriptors: portDescriptors });
        setLoadedBpProject(document, 'Created Box Pleat project');
        return true;
      } catch (error) {
        const normalized = oristudioBpError(error);
        set({
          oristudioBpError: normalized.message,
          oristudioBpBusy: false,
          status: 'error',
          error: normalized,
        });
        return false;
      }
    },

    loadOristudioBpExample: async (id, options = {}) => {
      const example = getBoxPleatExampleProject(id);
      if (!example) return false;
      if (options.confirmDiscard !== false && !(await confirmDiscardDirty(get().dirty))) {
        return false;
      }
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        await get().clearOristudioCpDocument();
        const [document, portDescriptors] = await Promise.all([
          loadOristudioBpProjectFromText(example.text, {
            filename: example.filename,
            format: 'generated',
            dirty: false,
          }),
          getOristudioBpPortDescriptors().catch(() => []),
        ]);
        set({ oristudioBpPortDescriptors: portDescriptors });
        setLoadedBpProject(document, `Loaded ${example.title}`);
        return true;
      } catch (error) {
        const normalized = oristudioBpError(error);
        set({
          oristudioBpError: normalized.message,
          oristudioBpBusy: false,
          status: 'error',
          error: normalized,
        });
        return false;
      }
    },

    selectOristudioBp: (selection) => {
      const document = get().oristudioBpDocument;
      if (!document) return;
      set({ oristudioBpDocument: { ...document, selection } });
    },

    setOristudioBpActiveSurface: (surface) => {
      const document = get().oristudioBpDocument;
      if (!document || document.activeSurface === surface) return;
      // Only when the surface actually changes: mutating the document and
      // activating the Dockview panel on *every* pointerdown reflows the pane
      // mid-gesture, which makes toolbar mousedown land on a different element
      // than pointerdown so the browser never fires the click.
      set({ oristudioBpDocument: { ...document, activeSurface: surface } });
      // Defer the Dockview panel activation out of the pointerdown handler so the
      // reflow it causes can't drop the click that changed the surface. Packing
      // lives in the BP Editor pane; tree in the design pane.
      const panel = surface === 'packing' ? 'bp-editor' : 'design';
      requestAnimationFrame(() => useLayoutStore.getState().activatePanel(panel));
    },

    moveOristudioBpTreeVertex: async (id, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP vertex',
        (document) =>
          moveRuntimeOristudioBpTreeVertex(id, loc, {
            activeSurface: document.activeSurface,
            selection: { kind: 'bp-vertex', id },
            dragging,
          }),
        { dragging }
      ),

    moveOristudioBpTreeVertices: async (updates, dragging = false) => {
      if (updates.length === 0) return true;
      return runBpTreeMutation(
        'Moved BP subtree',
        async (document) => {
          let next = document;
          for (const update of updates) {
            next = await moveRuntimeOristudioBpTreeVertex(update.id, update.loc, {
              activeSurface: next.activeSurface,
              selection: next.selection,
              dragging,
            });
          }
          return next;
        },
        { dragging }
      );
    },

    addOristudioBpTreeLeaf: async (parentId, loc) => {
      return runBpTreeMutation('Added BP leaf', async (document) => {
        const before = new Set(document.snapshot.tree.vertices.map((vertex) => vertex.id));
        let next = await addRuntimeOristudioBpTreeLeaf(parentId, 1, {
          activeSurface: document.activeSurface,
          selection: { kind: 'bp-vertex', id: parentId },
        });
        const created = next.snapshot.tree.vertices.find((vertex) => !before.has(vertex.id));
        if (created && loc) {
          next = await moveRuntimeOristudioBpTreeVertex(created.id, loc, {
            activeSurface: next.activeSurface,
            selection: { kind: 'bp-vertex', id: created.id },
          });
        }
        return created ? { ...next, selection: { kind: 'bp-vertex', id: created.id } } : next;
      });
    },

    deleteOristudioBpTreeNode: async (id) =>
      // The engine removes the leaf (cascading down to a leaf and reseeding the
      // parent's flap), refusing below the minimum tree size. One undo entry.
      runBpTreeMutation('Deleted BP node', (document) =>
        deleteRuntimeOristudioBpTreeLeaf(id, {
          activeSurface: document.activeSurface,
          selection: { kind: 'bp-tree' },
        })
      ),

    // Send the BP design's crease pattern to the always-live Edit canvas: export
    // the BP CP and merge it in via Import(Add), then switch to the Edit workspace.
    sendOristudioBpToEdit: async () => {
      if (!get().oristudioBpDocument) return false;
      set({ oristudioBpBusy: true });
      try {
        // Match BP Studio's Export CP defaults: keep the sheet orientation and
        // include auxiliary hinge creases (dropping them yields a sparse CP that
        // doesn't match BP Studio's export).
        const cpText = await exportOristudioBpProjectAsCp({
          reorient: false,
          includeAuxiliaryHinges: true,
        });
        await get().ensureEditCreasePattern();
        const ok = await get().importAddOristudioCpText(
          cpText,
          'cp',
          'Sent BP to Edit',
          'box-pleat.cp'
        );
        set({ oristudioBpBusy: false });
        if (ok) useLayoutStore.getState().activatePanel('crease-pattern');
        return ok;
      } catch (error) {
        const normalized = oristudioBpError(error);
        set({ oristudioBpError: normalized.message, oristudioBpBusy: false, error: normalized });
        return false;
      }
    },

    setOristudioBpTreeEdgeLength: async (vertices, length, subtreeUpdates = []) =>
      // Length edit + length-faithful subtree reposition in one gesture, so it is
      // a single undo entry (the reposition keeps rendered edge length == length).
      runBpTreeMutation('Set BP edge length', async (document) => {
        let next = await updateRuntimeOristudioBpTreeEdgeLength(vertices, length, {
          activeSurface: 'tree',
          selection: document.selection,
        });
        for (const update of subtreeUpdates) {
          next = await moveRuntimeOristudioBpTreeVertex(update.id, update.loc, {
            activeSurface: 'tree',
            selection: next.selection,
          });
        }
        return next;
      }),

    moveOristudioBpLayoutFlap: async (id, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP flap',
        () =>
          moveRuntimeOristudioBpLayoutFlap(id, loc, {
            activeSurface: 'packing',
            selection: { kind: 'bp-flap', id },
            dragging,
          }),
        { dragging }
      ),

    moveOristudioBpLayoutFlaps: async (ids, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP flaps',
        () =>
          moveRuntimeOristudioBpLayoutFlaps(ids, loc, {
            activeSurface: 'packing',
            selection:
              ids.length === 1
                ? { kind: 'bp-flap', id: ids[0] }
                : {
                    kind: 'bp-multi',
                    vertices: [],
                    edges: [],
                    flaps: ids,
                    rivers: [],
                    stretches: [],
                    devices: [],
                    invalidJunctions: [],
                  },
            dragging,
          }),
        { dragging }
      ),

    moveOristudioBpDevice: async (id, index, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP device',
        () =>
          moveRuntimeOristudioBpDevice(id, index, loc, {
            activeSurface: 'packing',
            selection: { kind: 'bp-device', id: `${id}:device:${index}` },
            dragging,
          }),
        { dragging }
      ),

    completeOristudioBpStretch: async (id) =>
      runBpTreeMutation('Completed BP stretch', (document) =>
        completeRuntimeOristudioBpStretch(id, {
          activeSurface: 'packing',
          selection: document.selection,
        })
      ),

    switchOristudioBpStretchConfig: async (id, delta) =>
      runBpTreeMutation('Switched BP stretch configuration', (document) =>
        switchRuntimeOristudioBpStretchConfig(id, delta, {
          activeSurface: 'packing',
          selection: document.selection,
        })
      ),

    switchOristudioBpStretchPattern: async (id, delta) =>
      runBpTreeMutation('Switched BP stretch pattern', (document) =>
        switchRuntimeOristudioBpStretchPattern(id, delta, {
          activeSurface: 'packing',
          selection: document.selection,
        })
      ),

    subdivideOristudioBpLayoutSheet: async () =>
      runBpTreeMutation('Subdivided BP sheet', (document) =>
        subdivideRuntimeOristudioBpLayoutSheet({
          activeSurface: 'packing',
          selection: document.selection,
        })
      ),

    rotateOristudioBpLayoutSheet: async (clockwise) =>
      runBpTreeMutation(clockwise ? 'Rotated BP sheet right' : 'Rotated BP sheet left', (document) =>
        rotateRuntimeOristudioBpLayoutSheet(clockwise, {
          activeSurface: 'packing',
          selection: document.selection,
        })
      ),

    flipOristudioBpLayoutSheet: async (horizontal) =>
      runBpTreeMutation(
        horizontal ? 'Flipped BP sheet horizontal' : 'Flipped BP sheet vertical',
        (document) =>
          flipRuntimeOristudioBpLayoutSheet(horizontal, {
            activeSurface: 'packing',
            selection: document.selection,
          })
      ),

    setOristudioBpLayoutSheet: async (gridType, width, height) =>
      runBpTreeMutation('Resized BP sheet', (document) =>
        updateRuntimeOristudioBpLayoutSheet(gridType, width, height, {
          activeSurface: 'packing',
          selection: document.selection,
        })
      ),
  };
};
