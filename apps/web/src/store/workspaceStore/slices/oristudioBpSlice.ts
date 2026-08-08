import { installBoxPleatDesign, patchBoxPleatDesign, selectOristudioBpDocument, selectOristudioBpHistoryFuture, selectOristudioBpHistoryPast, selectOristudioBpSelection, selectOristudioBpSymmetry, selectOristudioBpViewportFitRequestId } from '../designTabs';
import { getBoxPleatExampleProject } from '../../../examples/catalog';

import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';
import { requestConfirmation } from '../../commandDialogStore';
import { useLayoutStore } from '../../layoutStore';
import {
  addOristudioBpTreeLeaf as addRuntimeOristudioBpTreeLeaf,
  completeOristudioBpStretch as completeRuntimeOristudioBpStretch,
  deleteOristudioBpTreeLeaves as deleteRuntimeOristudioBpTreeLeaves,
  exportOristudioBpProjectAsBps,
  flipOristudioBpLayoutSheet as flipRuntimeOristudioBpLayoutSheet,
  isOptimizerCancellation,
  loadOristudioBpProjectFromText,
  moveOristudioBpDevice as moveRuntimeOristudioBpDevice,
  moveOristudioBpLayoutFlap as moveRuntimeOristudioBpLayoutFlap,
  moveOristudioBpLayoutFlaps as moveRuntimeOristudioBpLayoutFlaps,
  moveOristudioBpTreeVertex as moveRuntimeOristudioBpTreeVertex,
  optimizeOristudioBpLayout as optimizeRuntimeOristudioBpLayout,
  renameOristudioBpTreeVertex as renameRuntimeOristudioBpTreeVertex,
  resizeOristudioBpLayoutFlap as resizeRuntimeOristudioBpLayoutFlap,
  oristudioBpError,
  rotateOristudioBpLayoutSheet as rotateRuntimeOristudioBpLayoutSheet,
  subdivideOristudioBpLayoutSheet as subdivideRuntimeOristudioBpLayoutSheet,
  unsubdivideOristudioBpLayoutSheet as unsubdivideRuntimeOristudioBpLayoutSheet,
  updateOristudioBpLayoutSheet as updateRuntimeOristudioBpLayoutSheet,
  updateOristudioBpTreeEdgeLength as updateRuntimeOristudioBpTreeEdgeLength,
  requireActiveBpHandle,
  switchOristudioBpStretchConfig as switchRuntimeOristudioBpStretchConfig,
  switchOristudioBpStretchPattern as switchRuntimeOristudioBpStretchPattern,
} from '../oristudioBpRuntime';
import { designKind } from '../../../designKinds/registry';
import { recordSnapshot, snapshotEntry } from '../snapshotHistory';
import {
  addBpTreeSymmetryPair,
  removeBpTreeSymmetryPair,
  buildMirroredBpTreeUpdates,
  bpTreeDeleteIdsWithSymmetry,
  bpTreeSymmetryDefaultLoc,
  bpDocumentSymmetry,
  defaultBpDocumentSymmetry,
  type BpDocumentSymmetry,
  filterBpTreeSymmetryPairs,
  mirrorBpTreeVertexId,
  BP_TREE_SYMMETRY_ANGLE,
  BP_TREE_SYMMETRY_TOLERANCE,
  type SymmetryFold,
} from '../../../lib/bpTreeSymmetry';
import {
  optimizerSymmetryAxisForFold,
  optimizerSymmetryAxisSwapsDimensions,
  resolveOptimizerSymmetry,
  type OptimizerSymmetryPayload,
} from '../../../lib/bpOptimizerSymmetry';
import {
  buildMirroredBpFlapMoves,
  constrainBpFlapGroupToAxisSides,
  constrainBpFlapMoveToAxis,
} from '../../../lib/bpPackingSymmetry';
import { seedBpFlapAnchor, seedBpPartnerFlapAnchor } from '../../../lib/bpFlapSeeding';
import {
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  type SymmetryAxis,
} from '../../../lib/symmetryGeometry';

import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import type { SnapshotEntry } from '../snapshotHistory';
import type { Point } from '../../../lib/geometry';
import {
  emptyOristudioBpSelection,
  type OristudioBpDocumentState,
  type OristudioBpSelection,
} from '../../../engine/oristudioBpTypes';
import { bpFlapSelection, bpSelectionSize } from '../../../lib/oristudioBpSelection';
import { runAfterPointerGesture } from '../../../lib/pointerGesture';
import type {
  BpHistorySnapshot,
  OristudioBpSlice,
  OristudioBpSymmetryState,
  WorkspaceSliceCreator,
} from '../types';

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
 * Box Pleating workspace slice. Phase 3 is the runtime foundation: it can create
 * and hold a BP document. The tree/packing editing surfaces and file/optimizer
 * actions are wired up in later phases.
 */
/**
 * Dedupe concurrent `ensureBoxPleatProject` calls (e.g. React StrictMode
 * double-invoking the seeding effect) so only one starter project is created.
 *
 * Keyed by design id: with tabs, two box-pleat designs can each be waiting for
 * their own starter project, and a single in-flight promise would make the
 * second silently inherit the first's result.
 */
const ensureBpInFlight = new Map<string, Promise<void>>();

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
    options: {
      preserveEditCanvas?: boolean;
      /** Mirror-draw state the file carried, when it was an `.osf`. */
      symmetry?: BpDocumentSymmetry | null;
      /**
       * The design this document belongs to, captured before the engine call
       * that produced it.
       *
       * The runtime half already addresses its handle that way, so without the
       * same treatment here a tab switch mid-create put the *document* on one tab
       * and its *engine handle* on another — a design that renders one tree and
       * edits a different one.
       */
      designId?: string;
    } = {}
  ) => {
    // Pairs name vertices by id. The ids are explicit in the `.bps` text so they
    // survive the round trip, but the file's design and its symmetry are still
    // two separately-written things — drop any pair naming a vertex this tree
    // does not have rather than carrying a dangling reference.
    const symmetry = options.symmetry
      ? {
          ...options.symmetry,
          pairs: filterBpTreeSymmetryPairs(document.snapshot.tree, options.symmetry.pairs),
        }
      : null;
    // Only this design's open gesture. `clear()` dropped every design's pending
    // undo entry, so loading a file into one tab silently discarded the undo
    // step a drag in another tab was still holding open.
    pendingHistory.delete(options.designId ?? get().activeDesignId);
    const bpTitle = document.snapshot.summary.title || document.source.filename;
    set({
      // Kind and content in one call: loading a `.bps` *is* the design, so the
      // tab claims box-pleat and takes the document at the same moment.
      ...installBoxPleatDesign(get(), {
        document,
        // A tree opens with nothing selected: the add-anchor is always a vertex
        // the user picked, never an implicit default.
        selection: emptyOristudioBpSelection(),
        historyPast: [],
        historyFuture: [],
        // Mirror-draw state is per-design. `symmetry` carries what the file said,
        // if the loader read any; otherwise a new design starts symmetric, which
        // is how box-pleat authoring wants to begin. The axis itself is always
        // derived here rather than restored: vertical, centred on the loaded sheet.
        symmetry: {
          ...(symmetry ?? defaultBpDocumentSymmetry()),
          angle: BP_TREE_SYMMETRY_ANGLE,
          loc: bpTreeSymmetryDefaultLoc(document.snapshot.tree.sheet),
        },
      }, options.designId),
      // A box-pleat design has no tree, so it cannot borrow `project.title` to
      // name the project the way a TreeMaker design used to. It names it directly.
      workspaceTitle: bpTitle,
      // Every entry point but the design-method chooser replaces the open
      // document: the Edit canvas, the tree, and everything derived from them.
      // The chooser instead layers a BP design onto the project already being
      // authored (its CP wasm handle is never released), so it keeps them.
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
            // A BP project has no crease pattern until one is generated, so the
            // Simulate workspace must have nothing to fall back on. Left in
            // place, the previous file's crease pattern kept simulating under
            // the new project's name.
            ...staleFoldArtifactResourceState(get().foldArtifactRevision),
          }),
      oristudioBpError: null,
      oristudioBpBusy: false,
      currentFileName: document.source.filename,
      currentFilePath: document.source.path,
      dirty: document.dirty,
      projectMessage: message,
      status: 'ready',
      error: null});
  };

  /**
   * Show the Design workspace for a BP document that was just installed.
   *
   * Kept out of {@link setLoadedBpProject} so installing a document and deciding
   * which view to show stay separable. Loading a native `.osf` installs every
   * document the file holds and then lands once, from the finished project — a BP
   * design in that bundle must not drag the workspace to Design on its way past,
   * because the crease pattern that would have chosen Edit has not been installed
   * yet. Only the entry points that mean "make a box-pleat design and show it"
   * call this.
   */
  const flapAnchor = (document: OristudioBpDocumentState, id: number): Point | null =>
    document.snapshot.packing.flaps.find((flap) => flap.id === id)?.anchor ?? null;

  /**
   * The mirror partner of a vertex — equivalently of its dual flap — or null
   * when it has none, including when it is its own and sits on the mirror line.
   *
   * **Pairing does not depend on mirror draw.** That toggle decides one thing:
   * whether a *new* node is drawn with a twin. A pair, once it exists, is part of
   * the design, so every edit to an existing one — move, delete, edge length,
   * flap resize — asks this rather than the flag. Reading the flag here is what
   * made the whole feature vanish when the user stopped drawing symmetrically.
   */
  const bpMirrorPartnerId = (vertexId: number, designId: string): number | null => {
    const document = selectOristudioBpDocument(get(), designId);
    if (!document) return null;
    const symmetry = selectOristudioBpSymmetry(get(), designId);
    const partner = mirrorBpTreeVertexId(
      document.snapshot.tree,
      symmetry.pairs,
      { loc: symmetry.loc, angle: symmetry.angle },
      vertexId,
      BP_TREE_SYMMETRY_TOLERANCE
    );
    return partner === null || partner === vertexId ? null : partner;
  };

  /**
   * Whether a vertex — equivalently its dual flap — is its *own* mirror, sitting
   * on the tree's mirror line.
   *
   * Asked instead of looking at where the flap happens to be on the paper. A
   * flap that merely drifted onto the paper's mirror is not self-mirrored, and
   * treating it as such pinned it there with no way back off.
   */
  const bpIsSelfMirrored = (vertexId: number, designId: string): boolean => {
    const document = selectOristudioBpDocument(get(), designId);
    if (!document) return false;
    const symmetry = selectOristudioBpSymmetry(get(), designId);
    return (
      mirrorBpTreeVertexId(
        document.snapshot.tree,
        symmetry.pairs,
        { loc: symmetry.loc, angle: symmetry.angle },
        vertexId,
        BP_TREE_SYMMETRY_TOLERANCE
      ) === vertexId
    );
  };

  /**
   * Put a freshly added leaf's flap where the leaf was drawn.
   *
   * The engine seeds the flap when `add_leaf` runs — from the arbitrary spot it
   * parked the new vertex at, before the caller repositions it. That spot is
   * chosen against tree-node occupancy, which repositioning then vacates, so
   * without this every leaf added to a design lands its flap on the same cell.
   * The engine path is a faithful upstream port and is left alone; this reseeds
   * on top of it, inside the same mutation, so it stays one undo entry.
   */
  const seedFlapFromDrawing = async (
    document: OristudioBpDocumentState,
    leafId: number,
    treeLoc: Point,
    fold: SymmetryFold | null,
    selfMirrored = false
  ): Promise<OristudioBpDocumentState> => {
    if (!flapAnchor(document, leafId)) return document;
    return moveRuntimeOristudioBpLayoutFlap(
      leafId,
      seedBpFlapAnchor({
        treeLoc,
        treeSheet: document.snapshot.tree.sheet,
        layoutSheet: document.snapshot.packing.sheet,
        fold,
        selfMirrored,
      }),
      { activeSurface: document.activeSurface }
    );
  };

  /**
   * The length a leaf drawn at `at` should have, in whole grid cells.
   *
   * The engine mints a leaf at a length the caller chooses and the caller then
   * repositions it. Passing 1 and moving the vertex three cells out is how a
   * flap came to be *drawn* at three and *labelled* one — the geometry and the
   * number are two different facts and only one of them was being set.
   *
   * Rounded because box-pleat lengths are whole cells, and floored at one
   * because that is the engine's own minimum. The tree pane already quantizes
   * the click, so this recovers the length it drew rather than inventing one.
   */
  const drawnLeafLength = (parent: Point | undefined, at: Point | undefined): number => {
    if (!parent || !at) return 1;
    return Math.max(1, Math.round(Math.hypot(at.x - parent.x, at.y - parent.y)));
  };

  /** Put the mirror partner's flap at the reflection of where the primary's landed. */
  const seedPartnerFlap = async (
    document: OristudioBpDocumentState,
    primaryId: number,
    partnerId: number,
    fold: SymmetryFold
  ): Promise<OristudioBpDocumentState> => {
    const primary = flapAnchor(document, primaryId);
    if (!primary || !flapAnchor(document, partnerId)) return document;
    const anchor = seedBpPartnerFlapAnchor(primary, document.snapshot.packing.sheet, fold);
    if (!anchor) return document;
    return moveRuntimeOristudioBpLayoutFlap(partnerId, anchor, {
      activeSurface: document.activeSurface,
    });
  };

  const showBpDesignWorkspace = () => {
    const layout = useLayoutStore.getState();
    layout.activateWorkspace('design');
  };

  // Replace a BP document after an edit and mark any generated BP crease pattern
  // stale (tree/packing edits invalidate a prior CP export).
  const replaceBpDocument = (
    // The design this edit started on. Required rather than defaulted, because
    // every caller reaches here *after* an await: defaulting to the active design
    // is precisely the bug, and a caller that has to name the design cannot
    // forget to.
    designId: string,
    document: OristudioBpDocumentState,
    message: string,
    history?: { past: SnapshotEntry<BpHistorySnapshot>[]; future: SnapshotEntry<BpHistorySnapshot>[] },
    // Selection the edit leaves behind. Applied in the same `set` as the document
    // so a render never sees the new document beside the old selection.
    selection?: OristudioBpSelection
  ) => {
    // One design-tab writer: document, selection and history all ride the same
    // patch. Two spreads would write `designTabs` twice and the later would win.
    set({
      ...patchBoxPleatDesign(
        get(),
        {
          document,
          ...(selection ? { selection } : {}),
          ...(history ? { historyPast: history.past, historyFuture: history.future } : {}),
        },
        designId
      ),
      oristudioBpBusy: false,
      oristudioBpError: null,
      dirty: true,
      projectMessage: message,
      error: null,
      oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
    });
  };

  /**
   * Record an undo entry for a change that touches only the mirror-draw state.
   *
   * `bps: null` says the design itself is untouched, which is what lets this
   * stay synchronous — serializing the project is a worker round-trip, and
   * awaiting one here would let two quick toggles record their entries out of
   * order. Called *before* the change, so it captures the state to go back to.
   */
  const recordSymmetryHistory = (label: string) => {
    if (!selectOristudioBpDocument(get())) return;
    const entry = snapshotEntry(
      {
        bps: null,
        selection: selectOristudioBpSelection(get()),
        symmetry: bpDocumentSymmetry(selectOristudioBpSymmetry(get())),
      },
      label
    );
    const history = recordSnapshot(
      { past: selectOristudioBpHistoryPast(get()), future: selectOristudioBpHistoryFuture(get()) },
      entry
    );
    set({
      ...patchBoxPleatDesign(get(), { historyPast: history.past, historyFuture: history.future 
      }),});
  };

  /** What the undo menu should call a mirror-draw change. */
  const symmetryEditLabel = (update: Partial<OristudioBpSymmetryState>): string => {
    if (update.fold !== undefined) return 'Mirror fold';
    if (update.enabled !== undefined) return update.enabled ? 'Mirror draw on' : 'Mirror draw off';
    return 'Mirror symmetry';
  };

  // The "before" snapshot for the in-progress gesture. Captured lazily on the
  // first mutation of a gesture and committed as one history entry when the
  // gesture ends (dragging=false). A drag's intermediate steps keep it pending so
  // the whole drag is a single undo; likewise a compound action (add-leaf =
  // add + reposition) runs inside one runBpTreeMutation and commits once.
  /**
   * The undo entry a gesture is holding open, keyed by design.
   *
   * A drag opens one and commits it when the gesture ends. One variable for the
   * whole store meant a drag begun in design A and released after a tab switch
   * committed A's snapshot — its `.bps`, its selection, its symmetry — onto B's
   * undo stack.
   */
  const pendingHistory = new Map<string, SnapshotEntry<BpHistorySnapshot>>();

  const runBpTreeMutation = async (
    message: string,
    operation: (document: OristudioBpDocumentState) => Promise<OristudioBpDocumentState>,
    options: { dragging?: boolean; selection?: OristudioBpSelection } = {}
  ): Promise<boolean> => {
    const document = selectOristudioBpDocument(get());
    if (!document) return false;
    // Not for a mid-gesture step. `busy` disables the actions that must not run
    // against a half-solved design — Optimize, chiefly — and a drag step settles
    // within a frame, so the gate buys nothing there. What it costs is a store
    // write per step, which re-renders every subscriber and strobes the toolbar's
    // disabled styling; a 1.9 s flap drag flipped it about 250 times. The
    // gesture's final commit runs with `dragging` false and still raises it.
    if (!options.dragging) set({ oristudioBpBusy: true });
    // Captured before the first await: the gesture's snapshot belongs to the
    // design it started on, whatever the user does with the tabs meanwhile.
    const designId = get().activeDesignId;
    try {
      if (!pendingHistory.has(designId)) {
        const bps = await exportOristudioBpProjectAsBps();
        pendingHistory.set(designId, snapshotEntry(
          {
            bps,
            selection: selectOristudioBpSelection(get(), designId),
            symmetry: bpDocumentSymmetry(selectOristudioBpSymmetry(get(), designId)),
          },
          message
        ));
      }
      const nextDocument = await operation(document);
      // Prune ephemeral symmetry pairs to vertices that still exist after the edit,
      // so deletes/reseeds can't leave a dangling pair behind.
      const symmetry = selectOristudioBpSymmetry(get(), designId);
      if (symmetry.pairs.length > 0) {
        const prunedPairs = filterBpTreeSymmetryPairs(nextDocument.snapshot.tree, symmetry.pairs);
        if (prunedPairs.length !== symmetry.pairs.length) {
          set(
            patchBoxPleatDesign(
              get(),
              { symmetry: { ...symmetry, pairs: prunedPairs } },
              designId
            )
          );
        }
      }
      if (options.dragging) {
        // Mid-gesture: apply the document but hold the pending snapshot open.
        replaceBpDocument(designId, nextDocument, message, undefined, options.selection);
      } else {
        const entry = pendingHistory.get(designId);
        pendingHistory.delete(designId);
        replaceBpDocument(
          designId,
          nextDocument,
          message,
          entry
            ? recordSnapshot(
                {
                  past: selectOristudioBpHistoryPast(get(), designId),
                  future: selectOristudioBpHistoryFuture(get(), designId),
                },
                entry
              )
            : undefined,
          options.selection
        );
      }
      return true;
    } catch (error) {
      pendingHistory.delete(designId);
      if (isOptimizerCancellation(error)) {
        // Aborting the optimizer is a user action, not a failure. Drop the
        // pending snapshot and clear busy without recording history or
        // surfacing an error — the document is exactly as it was.
        set({ oristudioBpBusy: false });
        return false;
      }
      const normalized = oristudioBpError(error);
      set({ oristudioBpError: normalized.message, oristudioBpBusy: false, error: normalized });
      return false;
    }
  };

  return {
    oristudioBpError: null,
    oristudioBpBusy: false,
    // The document, its selection, its undo stacks, its symmetry and its
    // viewport-fit counter live on the active design tab (`BoxPleatDesignState`).
    // What is left here mirrors the singleton BP worker, not any one design.

    ensureBoxPleatProject: async () => {
      // Deliberately not gated on `oristudioBpBusy`. That flag mirrors the single
      // BP worker, so an optimize running in *another* design would otherwise
      // make this one give up — and nothing re-runs the effect when that optimize
      // finishes, leaving the tab on "Preparing the box-pleat editor…" forever.
      const designId = get().activeDesignId;
      // A tab opened from a file holds only its serialized text until it is
      // visited, so "no document" here does not mean "empty design" — it can mean
      // "not read yet". Seeding a starter project over one would replace the
      // design the user opened with a blank sample and delete its saved text.
      await get().hydrateDesignTab(designId);
      if (selectOristudioBpDocument(get(), designId)) return;
      const inFlight = ensureBpInFlight.get(designId);
      if (inFlight) return inFlight;
      const started = (async () => {
        try {
          // Preserve the always-live Edit canvas; this is a passive seed, not a
          // user-initiated "new project", so it must not prompt to discard.
          await get().createOristudioBpProject({
            preserveEditCanvas: true,
            confirmDiscard: false,
            // The design that asked, not whichever one the user has since
            // switched to: seeding a starter over *that* one would replace a
            // real design with a blank sample, and `confirmDiscard: false`
            // means it would do so without asking.
            designId,
          });
        } finally {
          ensureBpInFlight.delete(designId);
        }
      })();
      ensureBpInFlight.set(designId, started);
      return started;
    },

    createOristudioBpProject: async (options = {}) => {
      // Captured before any await, and handed to the install below, so the
      // document lands on the same design the runtime hands its handle to. A
      // caller that already awaited — `ensureBoxPleatProject` hydrates first —
      // passes the design it captured *before* that await, because by now the
      // active one may be a different design entirely.
      const designId = options.designId ?? get().activeDesignId;
      if (options.confirmDiscard !== false && !(await confirmDiscardDirty(get().dirty))) {
        return false;
      }
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        // The design-method chooser preserves the always-live Edit canvas, so it
        // must not release the CP handle; other entry points clear it as before.
        if (!options.preserveEditCanvas) await get().clearOristudioCpDocument();
        const document = await loadOristudioBpProjectFromText(BP_STARTER_PROJECT, {
          filename: 'Untitled.bps',
          format: 'generated',
          dirty: false,
        });
        setLoadedBpProject(document, 'Created Box Pleat project', {
          preserveEditCanvas: options.preserveEditCanvas,
          designId,
        });
        // "New Box Pleat" means show it: the BP Editor's empty state offers this
        // while the variant is still TreeMaker, so the layout has to rebuild.
        showBpDesignWorkspace();
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
      const designId = get().activeDesignId;
      const example = getBoxPleatExampleProject(id);
      if (!example) return false;
      if (options.confirmDiscard !== false && !(await confirmDiscardDirty(get().dirty))) {
        return false;
      }
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        await get().clearOristudioCpDocument();
        const document = await loadOristudioBpProjectFromText(example.text, {
            filename: example.filename,
            format: 'generated',
            dirty: false,
          });
        setLoadedBpProject(document, `Loaded ${example.title}`, { designId });
        showBpDesignWorkspace();
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

    loadOristudioBpProjectFromFile: async (text, source, options = {}) => {
      const designId = get().activeDesignId;
      set({ oristudioBpBusy: true, oristudioBpError: null });
      try {
        // A bare `.bps` carries no crease pattern, so opening one clears the Edit
        // canvas. Inside a native `.osf` the caller owns the canvas — the bundle
        // may hold a crease pattern to install right after — so it opts out, and
        // the load never publishes an empty canvas mid-flight.
        if (!options.preserveEditCanvas) await get().clearOristudioCpDocument();
        const document = await loadOristudioBpProjectFromText(text, {
            filename: source.filename,
            path: source.path ?? null,
            format: 'bps',
            dirty: false,
          });
        setLoadedBpProject(document, `Loaded ${source.filename}`, {
          symmetry: options.symmetry ?? null,
          preserveEditCanvas: options.preserveEditCanvas,
          designId,
        });
        // No workspace activation: this is a loader. Its callers land once, from
        // the finished project (`applyLandingWorkspace`).
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
      set({
      ...patchBoxPleatDesign(get(), { selection: selection 
      }),});
    },

    clearOristudioBpSelection: () => {
      if (bpSelectionSize(selectOristudioBpSelection(get())) === 0) return;
      set({
      ...patchBoxPleatDesign(get(), { selection: emptyOristudioBpSelection() 
      }),});
    },

    setOristudioBpActiveSurface: (surface) => {
      const document = selectOristudioBpDocument(get());
      if (!document || document.activeSurface === surface) return;
      // Only when the surface actually changes: mutating the document and
      // activating the Dockview panel on *every* pointerdown reflows the pane
      // mid-gesture, which makes toolbar mousedown land on a different element
      // than pointerdown so the browser never fires the click.
      set({
      ...patchBoxPleatDesign(get(), { document: { ...document, activeSurface: surface } 
      }),});
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
        const parent = document.snapshot.tree.vertices.find((vertex) => vertex.id === parentId);
        let next = await addRuntimeOristudioBpTreeLeaf(
          parentId,
          drawnLeafLength(parent?.loc, loc),
          { activeSurface: document.activeSurface }
        );
        const created = next.snapshot.tree.vertices.find((vertex) => !before.has(vertex.id));
        if (created && loc) {
          next = await moveRuntimeOristudioBpTreeVertex(created.id, loc, {
            activeSurface: next.activeSurface,
          });
          next = await seedFlapFromDrawing(next, created.id, loc, null);
        }
        // Selection stays on the parent, not the new leaf: real trees branch like
        // stars, so the common gesture is "give this node another child", and
        // re-anchoring to the leaf would turn every click into a chain instead.
        // Moving to a new branch node is an explicit click.
        return next;
      }, { selection: { kind: 'bp-vertex', id: parentId } });
    },

    setOristudioBpSymmetry: (update) => {
      const current = selectOristudioBpSymmetry(get());
      // An update that changes nothing must not leave an undo step that appears
      // to do nothing, nor claim the project has unsaved work.
      const changed = (Object.keys(update) as (keyof OristudioBpSymmetryState)[]).some(
        (key) => update[key] !== current[key]
      );
      if (!changed) return;
      recordSymmetryHistory(symmetryEditLabel(update));
      // Saved with the design, so changing it leaves unsaved work — with no
      // `dirty` the close prompt would let it go silently.
      set({
      ...patchBoxPleatDesign(get(), { symmetry: { ...current, ...update }
      }), dirty: true });
    },

    addOristudioBpTreeLeafWithSymmetry: async (parentId, loc, axisTolerance) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      const symmetry = selectOristudioBpSymmetry(get(), designId);
      if (!symmetry.enabled) return get().addOristudioBpTreeLeaf(parentId, loc);
      const axis: SymmetryAxis = { loc: symmetry.loc, angle: symmetry.angle };
      // Snap-onto-axis zone: the panel passes a tolerance matching the visible axis
      // band; fall back to the tight geometric tolerance when unset.
      const axisSnapTolerance = axisTolerance ?? BP_TREE_SYMMETRY_TOLERANCE;
      // Add a leaf to `on` at the length `at` implies, then place it there.
      const addLeafAt = async (
        document: OristudioBpDocumentState,
        on: number,
        at: Point | undefined
      ): Promise<{ document: OristudioBpDocumentState; createdId: number | null }> => {
        const before = new Set(document.snapshot.tree.vertices.map((vertex) => vertex.id));
        const anchor = document.snapshot.tree.vertices.find((vertex) => vertex.id === on);
        let next = await addRuntimeOristudioBpTreeLeaf(on, drawnLeafLength(anchor?.loc, at), {
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

        const added = await addLeafAt(document, parentId, targetLoc);
        // Seed the flap from where the leaf was *drawn*, and the partner's from
        // the reflection of where this one landed — see `seedFlapFromDrawing`.
        const primaryDocument =
          added.createdId != null && targetLoc
            ? await seedFlapFromDrawing(
                added.document,
                added.createdId,
                targetLoc,
                symmetry.fold,
                snap.snapped
              )
            : added.document;
        const primary = { document: primaryDocument, createdId: added.createdId };
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
        let next = mirror.document;
        if (mirror.createdId != null) {
          const pairs = addBpTreeSymmetryPair(
            selectOristudioBpSymmetry(get(), designId).pairs,
            primary.createdId,
            mirror.createdId
          );
          set(
            patchBoxPleatDesign(
              get(),
              { symmetry: { ...selectOristudioBpSymmetry(get(), designId), pairs } },
              designId
            )
          );
          next = await seedPartnerFlap(next, primary.createdId, mirror.createdId, symmetry.fold);
        }
        return next;
      }, { selection: { kind: 'bp-vertex', id: parentId } });
    },

    moveOristudioBpTreeVerticesWithSymmetry: async (updates, dragging = false) => {
      const designId = get().activeDesignId;
      const symmetry = selectOristudioBpSymmetry(get(), designId);
      if (updates.length === 0) return get().moveOristudioBpTreeVertices(updates, dragging);
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

    deleteOristudioBpTreeNode: async (id) => {
      // The engine removes the leaf (cascading down to a leaf and reseeding the
      // parent's flap), refusing below the minimum tree size. One undo entry.
      //
      // Under symmetry the mirror partner goes with it, for the same reason a
      // length edit applies to both: the two sides are one shape, and leaving a
      // widowed flap behind is never what the gesture meant. Resolved the same
      // way `setOristudioBpTreeEdgeLength` resolves it, and passed as one batch
      // so the engine settles the cascade and the minimum-size floor across both
      // ids at once rather than deleting one and then refusing the other.
      const symmetry = selectOristudioBpSymmetry(get());
      const tree = selectOristudioBpDocument(get())?.snapshot.tree;
      const ids =
        tree
          ? bpTreeDeleteIdsWithSymmetry(
              tree,
              symmetry.pairs,
              { loc: symmetry.loc, angle: symmetry.angle },
              id,
              BP_TREE_SYMMETRY_TOLERANCE
            )
          : [id];
      return runBpTreeMutation(
        ids.length > 1 ? 'Deleted mirrored BP nodes' : 'Deleted BP node',
        (document) =>
          deleteRuntimeOristudioBpTreeLeaves(ids, {
            activeSurface: document.activeSurface,
          }),
        { selection: emptyOristudioBpSelection() }
      );
    },

    // Send the BP design's crease pattern to the always-live Edit canvas: export
    // the BP CP and merge it in via Import(Add), then switch to the Edit workspace.
    sendOristudioBpToEdit: async () => {
      const bpDocument = selectOristudioBpDocument(get());
      if (!bpDocument) return false;
      const kind = designKind('box-pleat');
      if (!kind) return false;
      set({ oristudioBpBusy: true });
      try {
        // Ensure the Edit CP exists first so the descriptor can scale its export
        // against the Edit grid's divisions.
        await get().ensureEditCreasePattern();
        // The conversion — the cpScale that maps one BP cell onto one Edit cell,
        // BP Studio's Export CP defaults, the ORIPA convention swap — belongs to
        // the *descriptor*, which is what its `sendToEdit` is for. Doing it here
        // as well is what let this and the TreeMaker path drift into two
        // spellings of one operation.
        const payload = await kind.sendToEdit(await requireActiveBpHandle(), {
          editGridDivisions:
            get().oristudioCpDocument?.document.crease_pattern.grid.grid_size ?? 0,
          title: 'box-pleat',
        });
        const ok = await get().importAddOristudioCpText(
          payload.text,
          payload.format,
          payload.label,
          payload.filename
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
      const designId = get().activeDesignId;
      // Length edit + length-faithful subtree reposition in one gesture, so it is
      // a single undo entry (the reposition keeps rendered edge length == length).
      // The same length is applied to the mirror partner edge and its subtree is
      // reflected across the axis, so a length edit on one side updates both —
      // reusing the same mirroring the drag path uses.
      const symmetry = selectOristudioBpSymmetry(get(), designId);
      const mirrorsEdge =
        bpMirrorPartnerId(vertices[0], designId) !== null || bpMirrorPartnerId(vertices[1], designId) !== null;
      const label = mirrorsEdge ? 'Set mirrored BP edge length' : 'Set BP edge length';
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

    resizeOristudioBpLayoutFlap: async (id, width, height) => {
      const designId = get().activeDesignId;
      // Discrete commit (not a drag): one solve, one undo entry. The engine
      // no-ops an unchanged size and rejects one that pushes more than one flap
      // corner off the sheet (surfaced as an error by runBpTreeMutation, which
      // leaves the document — and the field's rendered value — unchanged).
      //
      // The partner is resized to match, the same way an edge length edit already
      // mirrors. A pair whose boxes are not mirror images is rejected outright by
      // the optimizer (`validate_dimensions`), so leaving the partner behind would
      // quietly break the symmetry the design carries.
      //
      // A flap is its tree leaf, so the pairing is resolved on the tree. Resolved
      // here rather than inside the mutation because the undo entry has to say
      // whether one flap or two were resized, which is the same question.
      const symmetry = selectOristudioBpSymmetry(get(), designId);
      const partnerId = bpMirrorPartnerId(id, designId);
      const label = partnerId === null ? 'Resized BP flap' : 'Resized mirrored BP flaps';
      return runBpTreeMutation(
        label,
        async (document) => {
          const next = await resizeRuntimeOristudioBpLayoutFlap(id, width, height, {
            activeSurface: 'packing',
          });
          if (partnerId === null) return next;
          const mirrorId = partnerId;
          const swaps = optimizerSymmetryAxisSwapsDimensions(
            optimizerSymmetryAxisForFold(document.snapshot.tree.sheet.kind, symmetry.fold)
          );
          return resizeRuntimeOristudioBpLayoutFlap(
            mirrorId,
            swaps ? height : width,
            swaps ? width : height,
            { activeSurface: 'packing' }
          );
        },
        { selection: { kind: 'bp-flap', id } }
      );
    },

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

    moveOristudioBpLayoutFlapWithSymmetry: async (id, loc, dragging = false) =>
      get().moveOristudioBpLayoutFlapsWithSymmetry([id], loc, dragging),

    moveOristudioBpLayoutFlapsWithSymmetry: async (ids, loc, dragging = false) => {
      const designId = get().activeDesignId;
      const symmetry = selectOristudioBpSymmetry(get(), designId);
      if (ids.length === 0) return get().moveOristudioBpLayoutFlaps(ids, loc, dragging);
      // The undo entry names what happened, not which mode the editor is in: how
      // many flaps were grabbed, and whether any of them brought a partner.
      const mirrors = ids.some((id) => bpMirrorPartnerId(id, designId) !== null);
      const plural = ids.length > 1;
      const label = mirrors
        ? plural
          ? 'Moved mirrored BP flaps'
          : 'Moved mirrored BP flap'
        : plural
          ? 'Moved BP flaps'
          : 'Moved BP flap';
      return runBpTreeMutation(
        label,
        async (document) => {
          const before = document.snapshot.packing;
          // The reference flap is the one the engine measures the group's single
          // translation from, so it is also the one an on-axis constraint has to
          // act on: sliding it along the mirror slides the whole group with it.
          const reference = before.flaps.find((flap) => flap.id === ids[0]);
          const onAxis =
            reference && bpIsSelfMirrored(reference.id, designId)
              ? constrainBpFlapMoveToAxis(reference, loc, before.sheet, symmetry.fold) ?? loc
              : loc;
          // A paired flap stays in its own half: crossing the mirror would put it
          // on top of its own reflection. Only the component across the axis is
          // clamped, so the flap slides along the mirror instead of stopping.
          const moving = ids.flatMap((id) => {
            const flap = before.flaps.find((candidate) => candidate.id === id);
            return flap ? [flap] : [];
          });
          const target = constrainBpFlapGroupToAxisSides({
            moving,
            target: onAxis,
            sheet: before.sheet,
            fold: symmetry.fold,
            pairedIds: new Set(ids.filter((id) => bpMirrorPartnerId(id, designId) !== null)),
          });
          const moved = await moveRuntimeOristudioBpLayoutFlaps(ids, target, {
            activeSurface: 'packing',
            dragging,
          });
          // Mirror where the flaps *landed*, not where they were asked to go: the
          // engine clamps the group's translation against the sheet, and a mirror
          // built from the request would drift from the drawing by whatever the
          // clamp took off.
          const landed = new Map(moved.snapshot.packing.flaps.map((flap) => [flap.id, flap.anchor]));
          const mirrored = buildMirroredBpFlapMoves({
            tree: document.snapshot.tree,
            pairs: symmetry.pairs,
            treeAxis: { loc: symmetry.loc, angle: symmetry.angle },
            sheet: before.sheet,
            fold: symmetry.fold,
            flaps: before.flaps,
            moves: ids.flatMap((id) => {
              const at = landed.get(id);
              return at ? [{ id, loc: at }] : [];
            }),
          });
          // One call each: a pair moves in opposite directions along the axis
          // normal, and the group move applies one translation to everything it
          // is given, so partners cannot ride along with the primaries.
          //
          // Nothing checks that a partner lands exactly where it was sent. The
          // sheet is symmetric about an axis through its centre, so the mirror of
          // an on-sheet box is on-sheet and the clamp cannot bite; if the engine
          // ever refused one anyway it would throw, and the mutation would revert
          // the primary move with it rather than leave a lopsided pair.
          let next = moved;
          for (const move of mirrored) {
            next = await moveRuntimeOristudioBpLayoutFlap(move.id, move.loc, {
              activeSurface: 'packing',
              dragging,
            });
          }
          return next;
        },
        { dragging, selection: bpFlapSelection(ids) }
      );
    },

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

    optimizeOristudioBpLayout: async (options, onProgress) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      const document = selectOristudioBpDocument(get(), designId);
      if (!document) return 'failed';

      // Symmetry is resolved here rather than carried in the dialog options,
      // because it is read from the tree as it stands right now.
      const symmetryState = selectOristudioBpSymmetry(get(), designId);
      let symmetry: OptimizerSymmetryPayload | null = null;
      if (options.respectSymmetry) {
        const resolved = resolveOptimizerSymmetry(document.snapshot.tree, symmetryState, {
          fold: symmetryState.fold,
        });
        if (!resolved.ok) {
          // Falling back to an unconstrained solve would hand back a layout the
          // user did not ask for, so refuse and say why.
          set({ oristudioBpError: resolved.reason });
          return 'failed';
        }
        symmetry = resolved.payload;
      }

      // `runBpTreeMutation` captures the pre-run .bps snapshot before the
      // operation and commits exactly one history entry on success, so the whole
      // optimize — new sheet size, every flap, and the stretches it clears — is
      // one undo. It also holds `oristudioBpBusy` for the duration, which is what
      // keeps a mid-run tree edit from being clobbered by the result.
      let cancelled = false;
      const applied = await runBpTreeMutation('Optimized BP layout', async () => {
        try {
          const summary = await optimizeRuntimeOristudioBpLayout(
            { ...options, openNew: false, seed: null, symmetry },
            { activeSurface: 'packing' },
            onProgress
          );
          return summary.document;
        } catch (error) {
          cancelled = isOptimizerCancellation(error);
          throw error;
        }
      });
      if (applied) {
        // The sheet resized and every flap moved, so the old camera is framing
        // nothing useful. Ask the packing pane to re-fit.
        set({
      ...patchBoxPleatDesign(get(), { viewportFitRequestId: selectOristudioBpViewportFitRequestId(get(), designId) + 1 
      }, designId),});
        return 'applied';
      }
      return cancelled ? 'cancelled' : 'failed';
    },

    unpairOristudioBpTreeSymmetry: (vertexId) => {
      const symmetry = selectOristudioBpSymmetry(get());
      const pairs = removeBpTreeSymmetryPair(symmetry.pairs, vertexId);
      if (pairs.length === symmetry.pairs.length) return;
      recordSymmetryHistory('Unpair from mirror');
      set({
      ...patchBoxPleatDesign(get(), { symmetry: { ...symmetry, pairs }
      }), dirty: true });
    },

    setOristudioBpLayoutSheet: async (gridType, width, height) =>
      runBpTreeMutation('Resized BP sheet', () =>
        updateRuntimeOristudioBpLayoutSheet(gridType, width, height, {
          activeSurface: 'packing',
        })
      ),
  };
};
