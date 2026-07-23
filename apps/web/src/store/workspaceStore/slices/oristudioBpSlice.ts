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
  renameOristudioBpTreeVertex as renameRuntimeOristudioBpTreeVertex,
  oristudioBpError,
  rotateOristudioBpLayoutSheet as rotateRuntimeOristudioBpLayoutSheet,
  subdivideOristudioBpLayoutSheet as subdivideRuntimeOristudioBpLayoutSheet,
  unsubdivideOristudioBpLayoutSheet as unsubdivideRuntimeOristudioBpLayoutSheet,
  updateOristudioBpLayoutSheet as updateRuntimeOristudioBpLayoutSheet,
  updateOristudioBpTreeEdgeLength as updateRuntimeOristudioBpTreeEdgeLength,
  switchOristudioBpStretchConfig as switchRuntimeOristudioBpStretchConfig,
  switchOristudioBpStretchPattern as switchRuntimeOristudioBpStretchPattern,
} from '../oristudioBpRuntime';
import { recordSnapshot, snapshotEntry } from '../snapshotHistory';
import {
  addBpTreeSymmetryPair,
  buildMirroredBpTreeUpdates,
  bpTreeSymmetryDefaultLoc,
  filterBpTreeSymmetryPairs,
  mirrorBpTreeVertexId,
  BP_TREE_SYMMETRY_TOLERANCE,
} from '../../../lib/bpTreeSymmetry';
import {
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  type SymmetryAxis,
} from '../../../lib/symmetryGeometry';
import { normalizeOrieditaGridSize } from '../../../lib/creasePatternViewport';
import type { SnapshotEntry } from '../snapshotHistory';
import type { Point } from '../../../lib/geometry';
import {
  emptyOristudioBpSelection,
  type OristudioBpDocumentState,
  type OristudioBpSelection,
} from '../../../engine/oristudioBpTypes';
import { bpFlapSelection, bpSelectionSize } from '../../../lib/oristudioBpSelection';
import { runAfterPointerGesture } from '../../../lib/pointerGesture';
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
        { id: 0, x: 10, y: 10, name: '' },
        { id: 1, x: 10, y: 9, name: '' },
        { id: 2, x: 10, y: 11, name: '' },
      ],
      edges: [
        { n1: 0, n2: 1, length: 1 },
        { n1: 0, n2: 2, length: 1 },
      ],
    },
  },
});

/**
 * BP Studio numbers `.cp` crease types Mountain=2, Valley=3 (ORIPA style); our
 * Oriedita-based CP editor reads 2=valley, 3=mountain. The two are faithful ports
 * of tools that genuinely use opposite `.cp` conventions, so bridge them at the
 * hand-off: swap the per-line type token (2↔3) so a BP design's mountains and
 * valleys render correctly on the Edit canvas. Border(1)/Auxiliary(4) are shared.
 */
function bpCpToEditorConvention(cpText: string): string {
  return cpText
    .split('\n')
    .map((line) => {
      const parts = line.split(' ');
      if (parts[0] === '2') parts[0] = '3';
      else if (parts[0] === '3') parts[0] = '2';
      return parts.join(' ');
    })
    .join('\n');
}

/**
 * Box Pleating workspace slice. Phase 3 is the runtime foundation: it can create
 * and hold a BP document. The tree/packing editing surfaces and file/optimizer
 * actions are wired up in later phases.
 */
// Dedupe concurrent `ensureBoxPleatProject` calls (e.g. React StrictMode
// double-invoking the seeding effect) so only one starter project is created.
let ensureBpInFlight: Promise<void> | null = null;

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

  const setLoadedBpProject = (
    document: OristudioBpDocumentState,
    message: string,
    options: { preserveEditCanvas?: boolean } = {}
  ) => {
    pendingHistory = null;
    set({
      workflowTarget: 'box-pleat',
      pendingDesignChoice: false,
      // Every entry point but the design-method chooser clears the Edit canvas.
      // The chooser preserves it (its CP wasm handle is never released), so it
      // omits the CP resets and leaves the live document untouched.
      ...(options.preserveEditCanvas
        ? {}
        : {
            importedCreasePattern: null,
            oristudioCpDocument: null,
            oristudioCpLineage: null,
            oristudioCpError: null,
            oristudioCpCamvResult: null,
            oristudioCpHistoryPast: [],
            oristudioCpHistoryFuture: [],
          }),
      oristudioBpDocument: document,
      // A tree opens with nothing selected: the add-anchor is always a vertex
      // the user picked, never an implicit default.
      oristudioBpSelection: emptyOristudioBpSelection(),
      oristudioBpWorkspace: null,
      oristudioBpError: null,
      oristudioBpBusy: false,
      oristudioBpHistoryPast: [],
      oristudioBpHistoryFuture: [],
      // Ephemeral mirror-draw state is project-specific — reset it on every load.
      // Symmetry defaults ON with the axis centred on the sheet (angle 90 =
      // vertical book axis), so box-pleat authoring is symmetric out of the box.
      oristudioBpSymmetry: {
        enabled: true,
        angle: 90,
        loc: bpTreeSymmetryDefaultLoc(document.snapshot.tree.sheet),
        pairs: [],
      },
      currentFileName: document.source.filename,
      currentFilePath: document.source.path,
      dirty: document.dirty,
      projectMessage: message,
      status: 'ready',
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
    history?: { past: SnapshotEntry<BpHistorySnapshot>[]; future: SnapshotEntry<BpHistorySnapshot>[] },
    // Selection the edit leaves behind. Applied in the same `set` as the document
    // so a render never sees the new document beside the old selection.
    selection?: OristudioBpSelection
  ) => {
    set({
      oristudioBpDocument: document,
      ...(selection ? { oristudioBpSelection: selection } : {}),
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
    options: { dragging?: boolean; selection?: OristudioBpSelection } = {}
  ): Promise<boolean> => {
    const document = get().oristudioBpDocument;
    if (!document) return false;
    set({ oristudioBpBusy: true });
    try {
      if (!pendingHistory) {
        const bps = await exportOristudioBpProjectAsBps();
        pendingHistory = snapshotEntry({ bps, selection: get().oristudioBpSelection }, message);
      }
      const nextDocument = await operation(document);
      // Prune ephemeral symmetry pairs to vertices that still exist after the edit,
      // so deletes/reseeds can't leave a dangling pair behind.
      const symmetry = get().oristudioBpSymmetry;
      if (symmetry.pairs.length > 0) {
        const prunedPairs = filterBpTreeSymmetryPairs(nextDocument.snapshot.tree, symmetry.pairs);
        if (prunedPairs.length !== symmetry.pairs.length) {
          set({ oristudioBpSymmetry: { ...symmetry, pairs: prunedPairs } });
        }
      }
      if (options.dragging) {
        // Mid-gesture: apply the document but hold the pending snapshot open.
        replaceActiveBpDocument(nextDocument, message, undefined, options.selection);
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
          ),
          options.selection
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
    oristudioBpSelection: emptyOristudioBpSelection(),
    oristudioBpWorkspace: null,
    oristudioBpPortDescriptors: [],
    oristudioBpError: null,
    oristudioBpBusy: false,
    oristudioBpHistoryPast: [],
    oristudioBpHistoryFuture: [],
    // Ephemeral mirror-draw state (never persisted). Defaults ON; `loc` is
    // re-centred on the sheet on every document load (see createOristudioBpProject),
    // so this pre-load {0,0} is a placeholder. `angle` 90 is a vertical (book) axis.
    oristudioBpSymmetry: { enabled: true, angle: 90, loc: { x: 0, y: 0 }, pairs: [] },

    ensureBoxPleatProject: async () => {
      if (get().oristudioBpDocument || get().oristudioBpBusy) return;
      if (ensureBpInFlight) return ensureBpInFlight;
      ensureBpInFlight = (async () => {
        try {
          // Preserve the always-live Edit canvas; this is a passive seed, not a
          // user-initiated "new project", so it must not prompt to discard.
          await get().createOristudioBpProject({ preserveEditCanvas: true, confirmDiscard: false });
        } finally {
          ensureBpInFlight = null;
        }
      })();
      return ensureBpInFlight;
    },

    createOristudioBpProject: async (options = {}) => {
      if (options.confirmDiscard !== false && !(await confirmDiscardDirty(get().dirty))) {
        return false;
      }
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        // The design-method chooser preserves the always-live Edit canvas, so it
        // must not release the CP handle; other entry points clear it as before.
        if (!options.preserveEditCanvas) await get().clearOristudioCpDocument();
        const [document, portDescriptors] = await Promise.all([
          loadOristudioBpProjectFromText(BP_STARTER_PROJECT, {
            filename: 'Untitled.bps',
            format: 'generated',
            dirty: false,
          }),
          getOristudioBpPortDescriptors().catch(() => []),
        ]);
        set({ oristudioBpPortDescriptors: portDescriptors });
        setLoadedBpProject(document, 'Created Box Pleat project', {
          preserveEditCanvas: options.preserveEditCanvas,
        });
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

    loadOristudioBpProjectFromFile: async (text, source) => {
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        await get().clearOristudioCpDocument();
        const [document, portDescriptors] = await Promise.all([
          loadOristudioBpProjectFromText(text, {
            filename: source.filename,
            path: source.path ?? null,
            format: 'bps',
            dirty: false,
          }),
          getOristudioBpPortDescriptors().catch(() => []),
        ]);
        set({ oristudioBpPortDescriptors: portDescriptors });
        setLoadedBpProject(document, `Loaded ${source.filename}`);
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
      set({ oristudioBpSelection: selection });
    },

    clearOristudioBpSelection: () => {
      if (bpSelectionSize(get().oristudioBpSelection) === 0) return;
      set({ oristudioBpSelection: emptyOristudioBpSelection() });
    },

    setOristudioBpActiveSurface: (surface) => {
      const document = get().oristudioBpDocument;
      if (!document || document.activeSurface === surface) return;
      // Only when the surface actually changes: mutating the document and
      // activating the Dockview panel on *every* pointerdown reflows the pane
      // mid-gesture, which makes toolbar mousedown land on a different element
      // than pointerdown so the browser never fires the click.
      set({ oristudioBpDocument: { ...document, activeSurface: surface } });
      // Hold the Dockview panel activation until the pointer comes up. It
      // reflows the pane, which swaps the DOM out from under an in-flight
      // gesture — so activating here would drop the very first click or drag on
      // an unfocused pane. Packing lives in the BP Editor pane; tree in design.
      const panel = surface === 'packing' ? 'bp-editor' : 'design';
      runAfterPointerGesture(() => useLayoutStore.getState().activatePanel(panel));
    },

    moveOristudioBpTreeVertex: async (id, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP vertex',
        (document) =>
          moveRuntimeOristudioBpTreeVertex(id, loc, {
            activeSurface: document.activeSurface,
            dragging,
          }),
        { dragging, selection: { kind: 'bp-vertex', id } }
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
        });
        const created = next.snapshot.tree.vertices.find((vertex) => !before.has(vertex.id));
        if (created && loc) {
          next = await moveRuntimeOristudioBpTreeVertex(created.id, loc, {
            activeSurface: next.activeSurface,
          });
        }
        // Selection stays on the parent, not the new leaf: real trees branch like
        // stars, so the common gesture is "give this node another child", and
        // re-anchoring to the leaf would turn every click into a chain instead.
        // Moving to a new branch node is an explicit click.
        return next;
      }, { selection: { kind: 'bp-vertex', id: parentId } });
    },

    setOristudioBpSymmetry: (update) => {
      set({ oristudioBpSymmetry: { ...get().oristudioBpSymmetry, ...update } });
    },

    addOristudioBpTreeLeafWithSymmetry: async (parentId, loc, axisTolerance) => {
      const symmetry = get().oristudioBpSymmetry;
      if (!symmetry.enabled) return get().addOristudioBpTreeLeaf(parentId, loc);
      const axis: SymmetryAxis = { loc: symmetry.loc, angle: symmetry.angle };
      // Snap-onto-axis zone: the panel passes a tolerance matching the visible axis
      // band; fall back to the tight geometric tolerance when unset.
      const axisSnapTolerance = axisTolerance ?? BP_TREE_SYMMETRY_TOLERANCE;
      // Add a unit leaf to `on` and reposition it to `at`; returns the doc + new id.
      const addLeafAt = async (
        document: OristudioBpDocumentState,
        on: number,
        at: Point | undefined
      ): Promise<{ document: OristudioBpDocumentState; createdId: number | null }> => {
        const before = new Set(document.snapshot.tree.vertices.map((vertex) => vertex.id));
        let next = await addRuntimeOristudioBpTreeLeaf(on, 1, {
          activeSurface: document.activeSurface,
        });
        const created = next.snapshot.tree.vertices.find((vertex) => !before.has(vertex.id));
        if (created && at) {
          next = await moveRuntimeOristudioBpTreeVertex(created.id, at, {
            activeSurface: next.activeSurface,
          });
        }
        return { document: next, createdId: created?.id ?? null };
      };
      return runBpTreeMutation('Added mirrored BP leaf', async (document) => {
        const tree = document.snapshot.tree;
        const parent = tree.vertices.find((vertex) => vertex.id === parentId);
        if (!parent) return document;
        // Snap the target onto the axis when inside the band; an axial leaf gets no
        // mirror (a single centred leaf).
        const snap = loc
          ? snapPointToSymmetryAxis(loc, axis, axisSnapTolerance)
          : { point: undefined as Point | undefined, snapped: false };
        const targetLoc = snap.point ?? loc;

        const primary = await addLeafAt(document, parentId, targetLoc);
        const mirrorParentId = mirrorBpTreeVertexId(
          tree,
          symmetry.pairs,
          axis,
          parentId,
          BP_TREE_SYMMETRY_TOLERANCE
        );
        const shouldMirror = Boolean(
          primary.createdId != null && targetLoc && !snap.snapped && mirrorParentId != null
        );
        if (!shouldMirror || primary.createdId == null || mirrorParentId == null || !targetLoc) {
          // Keep the parent selected so the next click adds another sibling —
          // see addOristudioBpTreeLeaf.
          return primary.document;
        }
        const mirror = await addLeafAt(
          primary.document,
          mirrorParentId,
          reflectPointAcrossSymmetryAxis(targetLoc, axis)
        );
        if (mirror.createdId != null) {
          const pairs = addBpTreeSymmetryPair(
            get().oristudioBpSymmetry.pairs,
            primary.createdId,
            mirror.createdId
          );
          set({ oristudioBpSymmetry: { ...get().oristudioBpSymmetry, pairs } });
        }
        return mirror.document;
      }, { selection: { kind: 'bp-vertex', id: parentId } });
    },

    moveOristudioBpTreeVerticesWithSymmetry: async (updates, dragging = false) => {
      const symmetry = get().oristudioBpSymmetry;
      if (!symmetry.enabled || updates.length === 0) {
        return get().moveOristudioBpTreeVertices(updates, dragging);
      }
      const axis: SymmetryAxis = { loc: symmetry.loc, angle: symmetry.angle };
      return runBpTreeMutation(
        'Moved mirrored BP subtree',
        async (document) => {
          const mirrored = buildMirroredBpTreeUpdates(
            document.snapshot.tree,
            symmetry.pairs,
            axis,
            updates,
            BP_TREE_SYMMETRY_TOLERANCE
          );
          let next = document;
          for (const update of [...updates, ...mirrored]) {
            next = await moveRuntimeOristudioBpTreeVertex(update.id, update.loc, {
              activeSurface: next.activeSurface,
              dragging,
            });
          }
          return next;
        },
        { dragging }
      );
    },

    deleteOristudioBpTreeNode: async (id) =>
      // The engine removes the leaf (cascading down to a leaf and reseeding the
      // parent's flap), refusing below the minimum tree size. One undo entry.
      runBpTreeMutation('Deleted BP node', (document) =>
        deleteRuntimeOristudioBpTreeLeaf(id, {
          activeSurface: document.activeSurface,
        }),
        { selection: emptyOristudioBpSelection() }
      ),

    // Send the BP design's crease pattern to the always-live Edit canvas: export
    // the BP CP and merge it in via Import(Add), then switch to the Edit workspace.
    sendOristudioBpToEdit: async () => {
      const bpDocument = get().oristudioBpDocument;
      if (!bpDocument) return false;
      set({ oristudioBpBusy: true });
      try {
        // Ensure the Edit CP exists first so we can read its grid divisions.
        await get().ensureEditCreasePattern();
        // Scale the export so one BP grid cell maps onto one Edit grid cell —
        // without changing the Edit grid. Both use the same paper convention, so
        // the scale is just bpSheetMaxCells / editGridDivisions (the paper width
        // cancels). When the two match the design fills the paper as before.
        const sheet = bpDocument.snapshot.packing.sheet;
        const bpCells = Math.max(sheet.width, sheet.height);
        const editDivisions = normalizeOrieditaGridSize(
          get().oristudioCpDocument?.document.crease_pattern.grid.grid_size ?? bpCells
        );
        const cpScale = editDivisions > 0 ? bpCells / editDivisions : 1;
        // Match BP Studio's Export CP defaults: keep the sheet orientation and
        // include auxiliary hinge creases (dropping them yields a sparse CP that
        // doesn't match BP Studio's export).
        const cpText = bpCpToEditorConvention(
          await exportOristudioBpProjectAsCp({
            reorient: false,
            includeAuxiliaryHinges: true,
            cpScale,
          })
        );
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

    setOristudioBpTreeEdgeLength: async (vertices, length, subtreeUpdates = []) => {
      // Length edit + length-faithful subtree reposition in one gesture, so it is
      // a single undo entry (the reposition keeps rendered edge length == length).
      // When symmetry is enabled, the same length is applied to the mirror partner
      // edge and its subtree is reflected across the axis, so a length edit on one
      // side updates both sides — reusing the same mirroring the drag path uses.
      const symmetry = get().oristudioBpSymmetry;
      const label = symmetry.enabled ? 'Set mirrored BP edge length' : 'Set BP edge length';
      return runBpTreeMutation(label, async (document) => {
        const applyEdge = async (
          next: OristudioBpDocumentState,
          edgeVertices: [number, number],
          updates: readonly { id: number; loc: Point }[]
        ) => {
          let current = await updateRuntimeOristudioBpTreeEdgeLength(edgeVertices, length, {
            activeSurface: 'tree',
          });
          for (const update of updates) {
            current = await moveRuntimeOristudioBpTreeVertex(update.id, update.loc, {
              activeSurface: 'tree',
              });
          }
          return current;
        };

        let next = await applyEdge(document, vertices, subtreeUpdates);
        if (!symmetry.enabled) return next;

        // Resolve the mirror edge from the pre-edit tree so pair inference sees the
        // symmetric configuration. A vertex on the axis mirrors to itself.
        const tree = document.snapshot.tree;
        const axis: SymmetryAxis = { loc: symmetry.loc, angle: symmetry.angle };
        const [a, b] = vertices;
        const mirrorA = mirrorBpTreeVertexId(tree, symmetry.pairs, axis, a, BP_TREE_SYMMETRY_TOLERANCE);
        const mirrorB = mirrorBpTreeVertexId(tree, symmetry.pairs, axis, b, BP_TREE_SYMMETRY_TOLERANCE);
        const mirroredUpdates = buildMirroredBpTreeUpdates(
          tree,
          symmetry.pairs,
          axis,
          subtreeUpdates,
          BP_TREE_SYMMETRY_TOLERANCE
        );

        // Only mirror onto a genuinely distinct partner edge: skip when the edge
        // lies on the axis (mirrors onto itself) or a partner can't be resolved.
        const partnerIsSameEdge =
          (mirrorA === a && mirrorB === b) || (mirrorA === b && mirrorB === a);
        if (mirrorA != null && mirrorB != null && mirrorA !== mirrorB && !partnerIsSameEdge) {
          next = await applyEdge(next, [mirrorA, mirrorB], mirroredUpdates);
        } else if (mirroredUpdates.length > 0) {
          // Partner subtree still reflects even when the shared edge isn't mirrored.
          for (const update of mirroredUpdates) {
            next = await moveRuntimeOristudioBpTreeVertex(update.id, update.loc, {
              activeSurface: 'tree',
            });
          }
        }
        return next;
      });
    },

    renameOristudioBpVertex: async (id, name) =>
      // The name lives on the tree vertex; a flap just reuses its dual leaf
      // vertex's name. The engine no-ops on an unchanged name, so this won't add
      // an empty history entry.
      runBpTreeMutation('Renamed BP node', (document) =>
        renameRuntimeOristudioBpTreeVertex(id, name, {
          activeSurface: document.activeSurface,
        })
      ),

    moveOristudioBpLayoutFlap: async (id, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP flap',
        () =>
          moveRuntimeOristudioBpLayoutFlap(id, loc, {
            activeSurface: 'packing',
            dragging,
          }),
        { dragging, selection: { kind: 'bp-flap', id } }
      ),

    moveOristudioBpLayoutFlaps: async (ids, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP flaps',
        () =>
          moveRuntimeOristudioBpLayoutFlaps(ids, loc, {
            activeSurface: 'packing',
            dragging,
          }),
        { dragging, selection: bpFlapSelection(ids) }
      ),

    moveOristudioBpDevice: async (id, index, loc, dragging = false) =>
      runBpTreeMutation(
        'Moved BP device',
        () =>
          moveRuntimeOristudioBpDevice(id, index, loc, {
            activeSurface: 'packing',
            dragging,
          }),
        { dragging, selection: { kind: 'bp-device', id: `${id}:device:${index}` } }
      ),

    completeOristudioBpStretch: async (id) =>
      runBpTreeMutation('Completed BP stretch', () =>
        completeRuntimeOristudioBpStretch(id, {
          activeSurface: 'packing',
        })
      ),

    switchOristudioBpStretchConfig: async (id, delta) =>
      runBpTreeMutation('Switched BP stretch configuration', () =>
        switchRuntimeOristudioBpStretchConfig(id, delta, {
          activeSurface: 'packing',
        })
      ),

    switchOristudioBpStretchPattern: async (id, delta) =>
      runBpTreeMutation('Switched BP stretch pattern', () =>
        switchRuntimeOristudioBpStretchPattern(id, delta, {
          activeSurface: 'packing',
        })
      ),

    subdivideOristudioBpLayoutSheet: async () =>
      runBpTreeMutation('Subdivided BP sheet', () =>
        subdivideRuntimeOristudioBpLayoutSheet({
          activeSurface: 'packing',
        })
      ),

    unsubdivideOristudioBpLayoutSheet: async () =>
      // The engine no-ops (leaving the sheet unchanged) when the grid can't
      // halve cleanly — dimensions not even, below the minimum, or a flap off an
      // even line — so the button is also disabled in those cases (see the
      // packing panel's canUnsubdivide).
      runBpTreeMutation('Un-subdivided BP sheet', () =>
        unsubdivideRuntimeOristudioBpLayoutSheet({
          activeSurface: 'packing',
        })
      ),

    rotateOristudioBpLayoutSheet: async (clockwise) =>
      runBpTreeMutation(clockwise ? 'Rotated BP sheet right' : 'Rotated BP sheet left', () =>
        rotateRuntimeOristudioBpLayoutSheet(clockwise, {
          activeSurface: 'packing',
        })
      ),

    flipOristudioBpLayoutSheet: async (horizontal) =>
      runBpTreeMutation(
        horizontal ? 'Flipped BP sheet horizontal' : 'Flipped BP sheet vertical',
        () =>
          flipRuntimeOristudioBpLayoutSheet(horizontal, {
            activeSurface: 'packing',
            })
      ),

    setOristudioBpLayoutSheet: async (gridType, width, height) =>
      runBpTreeMutation('Resized BP sheet', () =>
        updateRuntimeOristudioBpLayoutSheet(gridType, width, height, {
          activeSurface: 'packing',
        })
      ),
  };
};
