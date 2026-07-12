import { getBoxPleatExampleProject } from '../../../examples/catalog';
import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';
import { requestConfirmation } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import {
  addOristudioBpTreeLeaf as addRuntimeOristudioBpTreeLeaf,
  completeOristudioBpStretch as completeRuntimeOristudioBpStretch,
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
  updateOristudioBpTreeEdgeLength as updateRuntimeOristudioBpTreeEdgeLength,
  switchOristudioBpStretchConfig as switchRuntimeOristudioBpStretchConfig,
  switchOristudioBpStretchPattern as switchRuntimeOristudioBpStretchPattern,
} from '../oristudioBpRuntime';
import type { OristudioBpDocumentState } from '../../../engine/oristudioBpTypes';
import type { OristudioBpSlice, WorkspaceSliceCreator } from '../types';

/**
 * A new Box Pleating design is scaffolded with a root vertex and a single
 * unit-length leaf (the engine requires at least one edge for a valid tree).
 * The user builds outward from here by adding leaves.
 */
const BP_STARTER_PROJECT = JSON.stringify({
  version: '0.7',
  design: {
    title: '',
    mode: 'tree',
    layout: { sheet: { type: 'rect', width: 16, height: 16 }, flaps: [], stretches: [] },
    tree: {
      sheet: { type: 'rect', width: 20, height: 20 },
      nodes: [
        { id: 0, x: 10, y: 10, name: '' },
        { id: 1, x: 10, y: 9, name: '' },
      ],
      edges: [{ n1: 0, n2: 1, length: 1 }],
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
  const replaceActiveBpDocument = (document: OristudioBpDocumentState, message: string) => {
    set({
      oristudioBpDocument: document,
      oristudioBpBusy: false,
      oristudioBpError: null,
      dirty: true,
      projectMessage: message,
      error: null,
      oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
    });
  };

  const runBpTreeMutation = async (
    message: string,
    operation: (document: OristudioBpDocumentState) => Promise<OristudioBpDocumentState>
  ): Promise<boolean> => {
    const document = get().oristudioBpDocument;
    if (!document) return false;
    set({ oristudioBpBusy: true });
    try {
      const nextDocument = await operation(document);
      replaceActiveBpDocument(nextDocument, message);
      return true;
    } catch (error) {
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
      if (!document) return;
      set({ oristudioBpDocument: { ...document, activeSurface: surface } });
      // Packing lives in the BP Editor pane; tree in the design pane.
      useLayoutStore.getState().activatePanel(surface === 'packing' ? 'bp-editor' : 'design');
    },

    moveOristudioBpTreeVertex: async (id, loc, dragging = false) =>
      runBpTreeMutation('Moved BP vertex', (document) =>
        moveRuntimeOristudioBpTreeVertex(id, loc, {
          activeSurface: document.activeSurface,
          selection: { kind: 'bp-vertex', id },
          dragging,
        })
      ),

    moveOristudioBpTreeVertices: async (updates, dragging = false) => {
      if (updates.length === 0) return true;
      return runBpTreeMutation('Moved BP subtree', async (document) => {
        let next = document;
        for (const update of updates) {
          next = await moveRuntimeOristudioBpTreeVertex(update.id, update.loc, {
            activeSurface: next.activeSurface,
            selection: next.selection,
            dragging,
          });
        }
        return next;
      });
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

    setOristudioBpTreeEdgeLength: async (vertices, length) =>
      runBpTreeMutation('Set BP edge length', (document) =>
        updateRuntimeOristudioBpTreeEdgeLength(vertices, length, {
          activeSurface: 'tree',
          selection: document.selection,
        })
      ),

    moveOristudioBpLayoutFlap: async (id, loc, dragging = false) =>
      runBpTreeMutation('Moved BP flap', () =>
        moveRuntimeOristudioBpLayoutFlap(id, loc, {
          activeSurface: 'packing',
          selection: { kind: 'bp-flap', id },
          dragging,
        })
      ),

    moveOristudioBpLayoutFlaps: async (ids, loc, dragging = false) =>
      runBpTreeMutation('Moved BP flaps', () =>
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
        })
      ),

    moveOristudioBpDevice: async (id, index, loc, dragging = false) =>
      runBpTreeMutation('Moved BP device', () =>
        moveRuntimeOristudioBpDevice(id, index, loc, {
          activeSurface: 'packing',
          selection: { kind: 'bp-device', id: `${id}:device:${index}` },
          dragging,
        })
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
  };
};
