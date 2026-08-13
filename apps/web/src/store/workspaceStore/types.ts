import type { StateCreator } from 'zustand';
import type {
  ConditionKind,
  FoldArtifacts,
  FoldDocument,
  SequencePlan,
  SequenceTargetState,
  TreeEdit,
  WasmErrorEnvelope,
} from '../../engine/types';
import type { Point } from '../../lib/geometry';
import type { SerializedDockview } from 'dockview';
import type { DesignTab } from './designTabs';
import type { EditingContext } from '../../workspaces/editingContext';
import type { SendToEditPayload } from '../../designKinds/types';
import type {
  AppStatus,
  CreaseColorMode,
  Selection,
  ToolMode,
  WorkflowTarget,
} from '../../lib/sampleProject';
import type {
  OristudioCpSelection,
  OristudioCpViewportOptionKey,
  OristudioCpViewportOptions,
} from '../../lib/creasePatternViewport';
import type { SelectablePartKind } from '../../lib/selection';
import type { ExploriSendSource } from '../../analytics/events';
import type { ExploriDbConfig, ExploriResult } from '../../explori/types';
import type { TreeSelectionTarget, TreeVertexUpdate } from '../../tree-editor/model';
import type { SimulatorSettings, SimulatorSettingKey } from '../../lib/simulatorSettings';
import type { BpDocumentSymmetry } from '../../lib/bpTreeSymmetry';
import type { FileService } from '../../platform/fileService';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import type {
  CreaseExportFoldedFigureSettings,
  CreaseExportOptions,
} from '../../lib/creaseExport';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { CreaseExportFoldResult } from '../../lib/creaseExportFold';
import type { SegmentExportFormat } from '../../lib/creaseSegmentExport';
import type { FoldedFigureExportFormat } from '../../cp-workspace/folded/foldedFigureExport';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/foldedFigure3dProjection';
import type { FoldArtifactStatus } from './foldArtifactResource';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpEstimationOrder,
  FoldedFigurePlacement,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpGridMetadata,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import type { OristudioCpActionId } from '../../lib/oristudioCpActions';
import type { CpLineClipboardPayload, CpSelectionTransform } from '../../lib/creasePatternClipboard';
import type { OristudioCpLineage } from '../../lib/oristudioCpLineage';
import type { CanvasAnnotation, AnnotationUpdate } from '../../cp-workspace/annotations/annotation';
import type { UserCamera } from '../../cp-workspace/renderer/camera';
import type {
  AddInlineSimulationResult,
  InlineSimulation,
  InlineSimulationRegion,
} from '../../cp-workspace/inlineSimulation/inlineSimulation';
import type {
  OristudioBpEditingSurface,
  OristudioBpSelection,
  OristudioBpOptimizerOutcome,
  OristudioBpOptimizerProgress,
  OristudioBpOptimizerRunOptions,
  OristudioBpSheetKind,
} from '../../engine/oristudioBpTypes';

export interface OristudioCpHistoryEntry {
  document: OristudioCpDocumentSnapshot;
  selection: OristudioCpSelection;
  /** Annotation layer (images + text boxes) at the captured moment. */
  annotations: CanvasAnnotation[];
  /**
   * Folded figures at the captured moment. Entries carry their own
   * `renderSnapshot`, which is all that is needed to draw them, so restoring is
   * a plain assignment — no re-fold and no kernel replay. (The wasm handle is
   * only needed to run *further* kernel operations on a figure; a reopened
   * `.osf` draws its figures with `handle: null` for exactly this reason.)
   *
   * Entries are immutable and the slice `.map()`s, so an unchanged figure's
   * `renderSnapshot` is the *same object* across every history entry. That
   * structural sharing is what keeps history memory bounded — the retained
   * count is the number of rendering-changing actions, not the history depth.
   */
  foldedFigures: OristudioCpFoldedFigureEntry[];
  activeFoldedFigureId: string | null;
  /**
   * Inline simulation windows at the captured moment.
   *
   * Only the descriptors — plain JSON, and the same objects across entries that
   * did not change one, so the structural sharing that bounds folded-figure
   * memory applies here too. The fold each window's solver runs is *not* here and
   * must not be: it is 240KB-2.9MB, and history would keep one alive per
   * undoable deletion. It is rebuilt on restore instead — see
   * `restoreOristudioCpInlineSimulationSources`.
   */
  inlineSimulations?: InlineSimulation[];
  /**
   * True when the entry captures an *overlay-layer-only* change: annotations
   * (add/move/resize/rotate/crop/edit/delete) and/or folded figures (place,
   * recolour, refold, duplicate, delete). Folding never mutates the CP document,
   * so every folded action qualifies. Undo/redo then swaps the overlay layers
   * without reloading the (unchanged) wasm document, keeping edits cheap.
   */
  overlayOnly?: boolean;
  label: string;
  timestamp: string;
}

export interface OristudioCpActionRequest {
  id: number;
  operationId: OristudioCpOperationId;
}


/**
 * What the share modal is working on: one crease pattern, resolved to a codec payload
 * and ready to publish. Held in the store rather than in the toolbar that started it,
 * because every selection-toolbar action clears the selection as it runs and would
 * unmount anything the toolbar owned.
 */
export interface OristudioCpShareDraft {
  /** Segment being shared, so the preview can re-render it under new options. */
  segmentId: number;
  /** Codec output, already encoded — the Worker stores this verbatim. */
  payload: string;
  /**
   * Document fold and its segments — the same pair the export dialog takes, so the
   * card preview runs through `buildCreaseExportArtwork` unchanged rather than needing
   * its own extraction path.
   */
  fold: FoldDocument;
  segments: CpSegment[];
  /** The published link, once created. */
  url: string | null;
}

/**
 * A share waiting to be opened on the Edit surface.
 *
 * Two shapes because a link can arrive two ways. `payload` is the common case: the
 * server inlines the crease pattern into the page it serves for `/s/<id>`, so opening a
 * link needs no request at all. `id` is the fallback — a hand-typed URL, or a link
 * opened inside the ~60s KV takes to propagate globally — and is the only case that
 * fetches.
 */
export type PendingSharedCp =
  | { kind: 'payload'; payload: string }
  | { kind: 'id'; shareId: string };

/**
 * A file the editable kernel would not open, kept so the Edit surface can say so
 * instead of silently showing a blank canvas in its place.
 *
 * `readOnly` records whether the JS importer still managed to parse it. When it
 * did, the document is genuinely on screen — just not editable — and that is
 * worth telling the user rather than presenting the same dead end either way.
 */
export interface CpLoadFailure {
  filename: string;
  reason: string;
  readOnly: boolean;
}

export interface ProjectSliceState {
  /**
   * The designs open in the Design workspace, in tab order.
   *
   * **Never empty**, and {@link activeDesignId} always names one of them. Closing
   * the last tab re-provisions a fresh chooser tab rather than leaving none, which
   * is what keeps `activeDesignId` a plain `string` and removes "no design open"
   * as a representable state.
   *
   * Replaces the single `designMethod` scalar: the authoring method belongs to the
   * design, not to the workspace, and a workspace-level field cannot say which of
   * several open designs it describes. Read the active design's method with
   * `selectDesignMethod`.
   */
  designTabs: DesignTab[];
  /** The tab being authored. Always the id of a member of {@link designTabs}. */
  activeDesignId: string;
  /**
   * The project's name — one project, one title, however many designs it holds.
   *
   * Split out of `project.title` in phase 2b. That field was doing double duty:
   * the *tree's* name and the *project's* name. Fine while a workspace was one
   * tree; incoherent once a project can hold a box-pleat design and no tree at
   * all, or several designs with different names. The tree keeps its own title;
   * this is what names the file, the save dialog, and the export defaults.
   */
  workspaceTitle: string;
  /**
   * True once the user has created, opened, or chosen a project this session.
   * A fresh page load starts false, so deep-linked workspace routes redirect to
   * `/welcome` instead of showing an empty editor. Set by the create/open/choose
   * actions and by a document-presence subscription.
   */
  projectEstablished: boolean;
  /**
   * The id of the Dockview panel the user last focused. Source of truth for the
   * active editing context (below); updated from `onDidActivePanelChange`.
   */
  activePanelId: string | null;
  /**
   * Derived from `activePanelId` + design state (see `resolveEditingContext`).
   * Kept in sync by a store subscription; the single value the shell reads for
   * menus, capabilities, history, and shortcut routing.
   */
  activeEditingContext: EditingContext;
  importedCreasePattern: ImportedCreasePatternDocument | null;
  oristudioCpDocument: OristudioCpDocumentState | null;
  oristudioCpLineage: OristudioCpLineage | null;
  oristudioCpOperationDescriptors: OristudioCpOperationDescriptor[];
  oristudioCpError: string | null;
  /**
   * Why the Edit workspace has no editable document, when the reason is that a
   * file was *refused* rather than that nothing has been opened yet.
   *
   * Deliberately separate from `oristudioCpError`, which 50-odd sites use for
   * any CP failure (a command that would not run, "no document is loaded", a
   * dead kernel). Gating provisioning on that would let a stale command error
   * block the blank canvas forever; this field means one specific thing and is
   * cleared the moment a document exists again.
   *
   * Set by the load path, read by `ensureEditCreasePattern` so self-provisioning
   * cannot paper over a failure, and by the UI so the user is told which file
   * failed and why.
   */
  cpLoadFailure: CpLoadFailure | null;
  oristudioCpCamvResult: OristudioCpCommandResult | null;
  oristudioCpHistoryPast: OristudioCpHistoryEntry[];
  oristudioCpHistoryFuture: OristudioCpHistoryEntry[];
  /**
   * Extension bags carried forward from a loaded `.osf` and re-emitted on save,
   * so forward-compat data written by a newer app version survives a round-trip
   * through this one (see `nativeProjectFile` extensions notes). File-level and
   * crease-pattern-document-level respectively; `{}` when none.
   */
  nativeProjectExtensions: Record<string, unknown>;
  /**
   * Design documents from the loaded `.osf` whose kind this build does not
   * recognize, kept verbatim and re-emitted on save.
   *
   * A project written by a build with a design kind this one lacks opens, shows
   * the tabs it understands, and does not destroy the rest the next time the
   * user presses Save.
   */
  nativeUnknownDesigns: unknown[];
  oristudioCpDocumentExtensions: Record<string, unknown>;
  projectLoadId: number;
  currentFilePath: string | null;
  currentFileName: string;
  projectMessage: string | null;
  /**
   * The generated share link, while the share modal is open.
   *
   * Held in the store rather than in the toolbar because every toolbar action
   * clears the selection as it runs (`runAndDismiss`), which unmounts the
   * toolbar — the modal has to outlive that, exactly as the export modal does.
   */
  oristudioCpShareDraft: OristudioCpShareDraft | null;
  /**
   * A share captured by `/s`, waiting for the Edit surface to provision from it
   * instead of creating a blank document. Raw and unresolved: the route captures
   * intent, `ensureEditCreasePattern` does the work.
   */
  pendingSharedCp: PendingSharedCp | null;
  /**
   * True while a shared crease pattern is being fetched by id. Only the `id` shape of
   * `pendingSharedCp` is asynchronous -- the common case arrives inlined in the page -- and
   * without this the Edit surface would show an ordinary blank canvas for up to a minute
   * while the eventual-consistency retry runs.
   */
  openingSharedCp: boolean;
  status: AppStatus;
  dirty: boolean;
  engineReady: boolean;
  error: WasmErrorEnvelope | null;
}

export interface ProjectSliceActions {
  initEngine: () => Promise<void>;
  createNewProject: (options?: { preserveEditCanvas?: boolean }) => Promise<void>;
  createNewCreasePattern: () => Promise<void>;
  loadStarterProject: () => Promise<void>;
  loadProjectText: (
    text: string,
    source?: { title?: string; filename?: string; path?: string | null; dirty?: boolean }
  ) => Promise<void>;
  loadCreasePatternText: (
    text: string,
    source: { filename: string; path?: string | null }
  ) => Promise<void>;
  executeOristudioCpCommand: (
    operationId: OristudioCpOperationId,
    payload?: OristudioCpCommandPayload
  ) => Promise<boolean>;
  insertOristudioCpLineSegments: (
    segments: OristudioCpLineSegment[],
    label?: string
  ) => Promise<boolean>;
  replaceOristudioCpLineSegments: (
    lineIds: number[],
    segments: OristudioCpLineSegment[],
    label?: string
  ) => Promise<boolean>;
  setOristudioCpGridSize: (gridSize: number) => Promise<boolean>;
  updateOristudioCpGrid: (
    patch: Partial<OristudioCpGridMetadata>,
    label?: string
  ) => Promise<boolean>;
  previewOristudioCpCommand: (
    operationId: OristudioCpOperationId,
    payload?: OristudioCpCommandPayload
  ) => Promise<OristudioCpCommandPreview | null>;
  clearOristudioCpDocument: () => Promise<void>;
  /**
   * Recompute the always-on CAMV diagnostics off the edit critical path: debounced,
   * runs `CheckCamv` for its result only (no full-document snapshot), and updates
   * `oristudioCpCamvResult` when it lands — dropped if the document changed meanwhile.
   */
  scheduleOristudioCamvRefresh: () => void;
  /**
   * Open a document, replacing the current one. Prompts before discarding
   * unsaved changes unless `confirmDiscard` is false — which only a caller that
   * has already asked in its own prompt may pass.
   */
  openProject: (
    fileService?: FileService,
    options?: { confirmDiscard?: boolean }
  ) => Promise<boolean>;
  importAddCreasePattern: (fileService?: FileService) => Promise<boolean>;
  /**
   * Merge a design's crease pattern into the Edit canvas (in-memory Import(Add)).
   *
   * Takes the descriptor's payload whole rather than spreading it: every caller
   * has one, and the fields travel together — circles are meaningless without
   * the bounds that place them.
   */
  importAddOristudioCpText: (payload: SendToEditPayload) => Promise<boolean>;
  saveProject: (fileService?: FileService) => Promise<boolean>;
  saveProjectAs: (fileService?: FileService) => Promise<boolean>;
  exportV5: (fileService?: FileService) => Promise<boolean>;
  exportV4: (fileService?: FileService) => Promise<boolean>;
  exportCp: (fileService?: FileService) => Promise<boolean>;
  exportFold: (fileService?: FileService) => Promise<boolean>;
  exportBps: (fileService?: FileService) => Promise<boolean>;
  exportOri: (fileService?: FileService) => Promise<boolean>;
  exportOrh: (fileService?: FileService) => Promise<boolean>;
  exportSvg: (fileService?: FileService, options?: CreaseExportOptions) => Promise<boolean>;
  exportPng: (fileService?: FileService, options?: CreaseExportOptions) => Promise<boolean>;
  /** Export the simulator's current folded geometry. */
  exportFoldedFold: (fileService?: FileService) => Promise<boolean>;
  exportObj: (fileService?: FileService) => Promise<boolean>;
  exportStl: (fileService?: FileService) => Promise<boolean>;
  /**
   * Export a single crease-pattern segment. File formats (cp/fold/ori/orh)
   * download directly; image formats (svg/png) open the export-image modal
   * pre-scoped to the segment.
   */
  exportOristudioCpSegment: (
    format: SegmentExportFormat,
    segmentId: number,
    fileService?: FileService
  ) => Promise<boolean>;
  /**
   * Encode one crease-pattern segment as a share link and open the share modal.
   *
   * Scoped to a segment rather than the whole document: a segment is a region
   * enclosed by border creases, which is exactly "one crease pattern" and is the
   * same unit the sibling Fold / Export / Simulate verbs operate on.
   */
  shareOristudioCpSegment: (segmentId: number) => Promise<boolean>;
  publishOristudioCpShare: (args: {
    title: string;
    author: string | null;
    renderCard: () => Promise<Uint8Array | null>;
  }) => Promise<boolean>;
  /**
   * Fold the drafted share's pattern for its card preview. Injected through the store
   * rather than imported so the modal stays free of the kernel runtime, exactly as the
   * export dialog's `foldSegment` is.
   */
  foldOristudioCpShareFigure: (
    settings: CreaseExportFoldedFigureSettings
  ) => Promise<CreaseExportFoldResult>;
  /** Close the share modal and drop the generated link. */
  dismissOristudioCpShare: () => void;
  /** Record a share payload for the Edit surface to open. Set by `/s` only. */
  setPendingSharedCp: (pending: PendingSharedCp) => void;
  /**
   * Save one folded figure as a standalone image, serialized from the snapshot
   * already on screen rather than re-folded. See `lib/foldedFigureExport.ts`.
   */
  exportOristudioCpFoldedFigure: (
    format: FoldedFigureExportFormat,
    figureId: string,
    fileService?: FileService
  ) => Promise<boolean>;
  /**
   * Load a bundled example. False when nothing was established — an unknown id, a
   * declined discard prompt, or a load that failed — so the caller can tell an
   * opened project from a no-op, the way {@link openProject} does.
   */
  loadExampleProject: (id: string) => Promise<boolean>;
  clearProjectMessage: () => void;
  setActivePanelId: (id: string | null) => void;
  /** Enter the Design workspace on the method chooser without creating a document. */
  startNewDesign: () => void;
  /**
   * Open a new design tab, on the method chooser, and make it active.
   *
   * Every tab starts the same way — see the "Startup" row of the design-pane-tabs
   * plan — so this is also what the tab strip's `+` does.
   */
  addDesignTab: () => void;
  /** Make a tab active, parking the outgoing design's engine handle. */
  activateDesignTab: (designId: string) => void;
  /**
   * Close a tab.
   *
   * Closing the last one re-provisions a fresh chooser tab rather than leaving
   * none, so `designTabs` is never empty and `activeDesignId` never dangles.
   */
  closeDesignTab: (designId: string) => void;
  /**
   * Close a tab, confirming first when the design has been worked on.
   *
   * The entry point every user-facing close goes through — the tab strip's ×, its
   * context menu, and any future shortcut — so the prompt cannot depend on which
   * one was used. {@link closeDesignTab} stays the unconditional primitive, for
   * the paths that have already asked (File ▸ New Project) or must not ask at all
   * (loading a file replaces every tab).
   */
  requestCloseDesignTab: (designId: string) => Promise<void>;
  renameDesignTab: (designId: string, title: string) => void;
  /**
   * Record how a design's panes are arranged. Written by the design's dock as the
   * user drags a splitter, and persisted with the design in the `.osf`.
   */
  setDesignPaneLayout: (designId: string, paneLayout: SerializedDockview | null) => void;
  /**
   * Read a design's content back from its serialized text, once.
   *
   * Opening a file installs only the active design into the store; the rest are
   * registry text until visited. The canvas renders the store, so a background
   * tab has to be filled in before it can be looked at.
   */
  hydrateDesignTab: (designId: string) => Promise<void>;
  /** Move a tab to a new index, for drag-reorder. */
  reorderDesignTab: (designId: string, toIndex: number) => void;
  /** Copy a design into a new tab beside it. Fresh history; nothing inherited. */
  duplicateDesignTab: (designId: string) => Promise<void>;
  /** Resolve the Design pane NUX chooser into a concrete design method. */
  chooseDesignMethod: (target: WorkflowTarget) => Promise<void>;
}

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

/**
 * A tree's state captured before an edit, and the design it belongs to.
 *
 * The design id rides along because the two halves are separated by the engine
 * round trip the edit itself makes: capture, edit, commit. A commit that resolved
 * "the active design" would push the *other* design's undo entry onto whichever
 * tab the user had switched to — and, because the close prompt keys off undo
 * depth, would arm it on the wrong design too.
 */
export interface TreeHistoryCheckpoint {
  text: string;
  designId: string;
}

export interface HistoryEntry {
  text: string;
  label: string;
  timestamp: string;
}

/**
 * Tree undo/redo *stacks* moved onto the active design tab in phase 2b
 * (`TreemakerDesignState.historyPast` / `historyFuture`), so each design owns its
 * own history and undo cannot reach across tabs. Read them with
 * `selectHistoryPast` / `selectHistoryFuture`.
 *
 * `historyBusy` deliberately did **not** move. It is a re-entrancy guard shared
 * by all three history subsystems — tree, crease pattern, and box-pleat — and
 * scoping it to the TreeMaker design would have left the other two ungated
 * whenever a design of another kind was active.
 */
export interface HistorySliceState {
  /**
   * Re-entrancy guard for **tree** undo/redo.
   *
   * One guard per surface, not one shared by all three. Phase 2b briefly moved a
   * single `historyBusy` onto the TreeMaker design arm, which broke both
   * directions at once: with a design of another kind active the crease-pattern
   * and box-pleat guards read a frozen `false` and stopped gating at all, and
   * with a TreeMaker design active a crease-pattern undo took the *tree's* guard
   * and blocked tree undo. Three independent histories need three flags.
   *
   * Still flat rather than on the design arm. Harmless today — undo only ever
   * runs against the active design, so a per-workspace flag can only over-block,
   * never under-block. Phase 2d should move it onto the arm along with addressed
   * writes, at which point two designs can have undo in flight independently.
   */
  historyBusy: boolean;
  /** Re-entrancy guard for crease-pattern undo/redo. See {@link historyBusy}. */
  oristudioCpHistoryBusy: boolean;
  /** Re-entrancy guard for box-pleat undo/redo. See {@link historyBusy}. */
  oristudioBpHistoryBusy: boolean;
}

export interface HistorySliceActions {
  beginHistoryCheckpoint: () => Promise<TreeHistoryCheckpoint | null>;
  commitHistoryCheckpoint: (checkpoint: TreeHistoryCheckpoint | null, label?: string) => void;
  clearHistory: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export type HistorySlice = HistorySliceState & HistorySliceActions;

// Tree selection and authoring mode moved onto the active design tab in phase 2b
// (`TreemakerDesignState`). Read them with `selectSelection` / `selectToolMode` /
// `selectSymmetryAuthoringPairs`. The slice is now actions only.

export interface EditingSliceActions {
  addNodeAt: (loc: Point, connectTo?: number) => Promise<void>;
  addNodeWithSymmetry: (loc: Point, connectTo?: number) => Promise<void>;
  moveNode: (id: number, loc: Point) => Promise<void>;
  moveNodeWithSymmetry: (id: number, loc: Point) => Promise<void>;
  addEdge: (node1: number, node2: number) => Promise<void>;
  updateNodeLabel: (id: number, label: string) => Promise<void>;
  updateEdge: (
    id: number,
    update: { label?: string; length?: number; strain?: number; stiffness?: number }
  ) => Promise<void>;
  makeSelectedNodeRoot: () => Promise<void>;
  splitSelectedEdge: (distance: number) => Promise<void>;
  setSelectedEdgeLengths: (length: number) => Promise<void>;
  scaleSelectedEdgeLengths: (factor: number) => Promise<void>;
  renormalizeToSelectedEdge: () => Promise<void>;
  renormalizeToUnitScale: () => Promise<void>;
  absorbSelectedNodes: () => Promise<void>;
  absorbRedundantNodes: () => Promise<void>;
  absorbSelectedEdges: () => Promise<void>;
  perturbSelectedNodes: () => Promise<void>;
  perturbAllNodes: () => Promise<void>;
  removeSelectionStrain: () => Promise<void>;
  removeAllStrain: () => Promise<void>;
  relieveSelectionStrain: () => Promise<void>;
  relieveAllStrain: () => Promise<void>;
  addLargestStubForSelectedNodes: () => Promise<void>;
  addLargestStubForSelectedPoly: () => Promise<void>;
  triangulateTree: () => Promise<void>;
  deleteSelection: () => Promise<void>;
  select: (selection: Selection) => void;
  selectAll: () => void;
  selectNone: () => void;
  selectByIndex: (kind: SelectablePartKind, id: number) => void;
  selectMovableParts: () => void;
  selectCorridorFacets: () => void;
  selectPathBetweenSelectedNodes: () => void;
  setToolMode: (toolMode: ToolMode) => void;
}

export type EditingSlice = EditingSliceActions;

export interface ConditionSliceActions {
  updatePaper: (update: { width?: number; height?: number }) => Promise<void>;
  setSymmetry: (update: {
    hasSymmetry?: boolean;
    symLoc?: Point;
    symAngle?: number;
  }) => Promise<void>;
  addCondition: (kind: ConditionKind) => Promise<void>;
  updateCondition: (id: number, kind: ConditionKind) => Promise<void>;
  deleteCondition: (id: number) => Promise<void>;
  deleteConditionsForSelectedNodes: () => Promise<void>;
  deleteConditionsForSelectedEdges: () => Promise<void>;
  deleteConditionsForSelectedPaths: () => Promise<void>;
  clearConditions: () => Promise<void>;
}

export type ConditionSlice = ConditionSliceActions;

export interface ClipboardNode {
  sourceId: number;
  label: string;
  loc: Point;
}

export interface ClipboardEdge {
  sourceId: number;
  sourceNodes: [number, number];
  label: string;
  length: number;
  strain: number;
  stiffness: number;
}

export interface TreeClipboardPayload {
  kind: 'tree';
  nodes: ClipboardNode[];
  edges: ClipboardEdge[];
}

export type WorkspaceClipboardPayload = TreeClipboardPayload | CpLineClipboardPayload;

export interface ClipboardSliceState {
  clipboard: WorkspaceClipboardPayload | null;
  clipboardPasteCount: number;
}

export interface ClipboardSliceActions {
  copySelection: () => void;
  cutSelection: () => Promise<void>;
  pasteClipboard: () => Promise<void>;
}

export type ClipboardSlice = ClipboardSliceState & ClipboardSliceActions;

export interface CreasePatternSliceState {
  creaseColorMode: CreaseColorMode;
  oristudioCpSelection: OristudioCpSelection;
  oristudioCpActionRequest: OristudioCpActionRequest | null;
  /**
   * The crease-pattern tool the user last selected, persisted so it survives
   * panel remounts (e.g. switching to the Simulate workspace and back).
   */
  oristudioCpActiveToolId: OristudioCpActionId | null;
  oristudioCpActiveDiagnosticId: string | null;
  oristudioCpRevision: number;
  oristudioCpFoldedFigures: OristudioCpFoldedFigureEntry[];
  /**
   * How many fold operations are in flight. A count, not a flag, so overlapping
   * folds cannot clear each other's indicator. Drives the delayed progress toast.
   */
  oristudioCpFoldsInFlight: number;
  oristudioCpActiveFoldedFigureId: string | null;
  oristudioCpViewport: OristudioCpViewportOptions;
  /**
   * The Edit canvas camera — centre, zoom, rotation — as document state, so a
   * save/reopen round-trip returns the canvas the user left. Null means "no
   * saved view", i.e. auto-fit.
   *
   * Written on *settle* by the canvas (not per frame) and read at save time.
   * Moving the camera deliberately does not mark the document dirty: panning
   * around while reading a pattern is not an edit.
   */
  oristudioCpCamera: UserCamera | null;
  /**
   * Superset feature: annotations (reference images, rich-text boxes) placed on
   * the crease-pattern canvas. Web-side layer, never in the kernel; the full
   * model persists only in `.osf`. A single array so z-order and selection are
   * shared across kinds. See `apps/web/docs/superset-features.md`.
   */
  oristudioCpAnnotations: CanvasAnnotation[];
  oristudioCpSelectedAnnotationId: string | null;
  /**
   * Superset feature: live simulations of individual crease-pattern regions,
   * placed on the Edit canvas. Session-only — deliberately not persisted, since
   * a window is a scratch tool rather than document content. The heavy half (the
   * captured fold) lives outside the store, in `inlineSimulationRuntime`.
   */
  oristudioCpInlineSimulations: InlineSimulation[];
  /**
   * The window that currently owns the solver. At most one runs at a time: the
   * rest hold their last rendered frame, which costs nothing, and keeps the
   * worker to a single live session.
   */
  oristudioCpFocusedInlineSimulationId: string | null;
  /**
   * The 3D folded figure whose body is taking canvas drags as **orbit** rather
   * than as a move.
   *
   * Selection and focus are two different presses, exactly as they are for an
   * inline simulation: the first selects (so the figure can still be nudged,
   * which is what someone who only wanted to reposition it expects), and the
   * second focuses. Only a focused figure goes inert to the canvas-object
   * overlay.
   *
   * Never holds a **flat** figure. A flat folded form has no third dimension to
   * turn, so focusing one would be a state the user can reach and find inert —
   * `focusOristudioCpFoldedFigure` refuses it rather than admitting it.
   */
  oristudioCpFocusedFoldedFigureId: string | null;
  foldArtifacts: FoldArtifacts | null;
  foldArtifactError: string | null;
  foldArtifactStatus: FoldArtifactStatus;
  foldArtifactRevision: number;
  foldArtifactResolvedRevision: number | null;
  selectedSegmentId: number | null;
  sequenceTarget: SequenceTargetState | null;
  sequencePlan: SequencePlan | null;
  sequenceSimulationFocus: SequenceSimulationFocus;
  sequencePlanning: boolean;
  sequenceError: string | null;
}

export type SequenceSimulationFocus =
  | { kind: 'whole' }
  | { kind: 'sequence_step'; stepId: string };

export interface CreasePatternSliceActions {
  optimizeScale: () => Promise<void>;
  optimizeEdges: () => Promise<void>;
  optimizeStrain: () => Promise<void>;
  /** Seed a blank editable CP when the Edit workspace is entered with none loaded. */
  ensureEditCreasePattern: () => Promise<void>;
  buildCreasePattern: () => Promise<void>;
  /**
   * Generate the tree's crease pattern and merge it into the always-live Edit
   * canvas via Import(Add), rather than replacing the Edit surface. This is the
   * TreeMaker analogue of {@link sendOristudioBpToEdit}, backing the toolbar's
   * "Send to Edit" action.
   *
   * With `includeCircles`, the leaf circles come too, as Oriedita circle
   * annotations on the merged pattern.
   */
  sendTreeCreasePatternToEdit: (includeCircles?: boolean) => Promise<boolean>;
  markFoldSourceChanged: () => void;
  ensureFoldArtifacts: () => Promise<FoldArtifacts | null>;
  refreshFoldArtifacts: () => Promise<FoldArtifacts | null>;
  analyzeSequenceTarget: () => Promise<SequenceTargetState | null>;
  planFoldingSequence: () => Promise<SequencePlan | null>;
  setCreaseColorMode: (mode: CreaseColorMode) => void;
  setSelectedSegment: (id: number | null) => void;
  /**
   * Scope the simulator to one crease-pattern segment and switch to the Simulate
   * workspace. Ensures the full fold artifacts first (the simulator needs the
   * simulation mesh). Resolves false when the id no longer resolves to a segment.
   */
  simulateOristudioCpSegment: (segmentId: number) => Promise<boolean>;
  /**
   * Open a simulation of one crease-pattern region as a window on the Edit
   * canvas.
   *
   * Reports why rather than resolving a boolean: hitting the window cap is a
   * normal outcome worth telling the user about, and the caller is where a
   * translated message can be produced.
   */
  addOristudioCpInlineSimulation: (
    region: InlineSimulationRegion
  ) => Promise<AddInlineSimulationResult>;
  updateOristudioCpInlineSimulation: (
    id: string,
    // No fold percentage: that is per-frame transport and lives in
    // `inlineSimulationRuntime`, not in document-shaped store state.
    patch: Partial<Pick<InlineSimulation, 'box' | 'view' | 'z'>>
  ) => void;
  removeOristudioCpInlineSimulation: (id: string) => void;
  /** Hand the solver to a window, or to none. */
  focusOristudioCpInlineSimulation: (id: string | null) => void;
  /**
   * Give canvas drags over a 3D folded figure to its camera, or take them back.
   *
   * A no-op on a figure that is not 3D, so a caller does not have to ask first
   * — see {@link WorkspaceState.oristudioCpFocusedFoldedFigureId}.
   */
  focusOristudioCpFoldedFigure: (id: string | null) => void;
  /** Rebuild a stale window's fold from the current creases, keeping its placement. */
  refreshOristudioCpInlineSimulation: (id: string) => Promise<boolean>;
  /**
   * Give every window restored from a file the fold it draws.
   *
   * Distinct from calling refresh per window, in the two ways that matter: fold
   * artifacts are computed once for the document rather than per window, and the
   * *saved* provenance is left alone. Recomputing it would make every loaded
   * window read as up to date forever, however far the creases had moved since.
   *
   * Resolves the number of windows that found their region.
   */
  hydrateOristudioCpInlineSimulations: () => Promise<number>;
  /**
   * Give back the fold of any window that has none — the shape undo needs after
   * restoring a window whose fold was dropped when it was deleted.
   *
   * Rebuilds rather than having the history stacks hold folds alive: a
   * triangulated segment fold measures 240KB at 500 vertices and 2.9MB at 8,000,
   * so a hundred undoable deletions would retain tens to hundreds of MB for
   * windows the user threw away. Uses cached fold artifacts, which deleting a
   * window does not invalidate, so the common delete-then-undo path recomputes
   * nothing.
   *
   * Like hydrate and unlike refresh, it leaves saved provenance alone: a
   * restored window that was out of date is still out of date.
   *
   * Resolves the number of windows that got a fold back.
   */
  restoreOristudioCpInlineSimulationSources: () => Promise<number>;
  setSequenceSimulationFocus: (focus: SequenceSimulationFocus) => void;
  /**
   * Record the settled Edit-canvas camera so a save persists the view. Does not
   * touch `dirty` — see {@link WorkspaceState.oristudioCpCamera}.
   */
  setOristudioCpCamera: (camera: UserCamera | null) => void;
  setOristudioCpViewportOption: <K extends OristudioCpViewportOptionKey>(
    key: K,
    value: OristudioCpViewportOptions[K]
  ) => void;
  setOristudioCpSelection: (selection: OristudioCpSelection) => void;
  /**
   * Hand the canvas to the creases after a selection made by the kernel.
   *
   * Executing a CP operation writes `oristudioCpSelection` straight from the
   * document it returns, so that path cannot go through the usual setter. Call
   * this immediately after; it is a no-op unless a canvas object is holding the
   * selection the creases have just taken.
   */
  claimCanvasForCreaseSelection: () => void;
  requestOristudioCpAction: (operationId: OristudioCpOperationId) => void;
  setOristudioCpActiveToolId: (id: OristudioCpActionId | null) => void;
  clearOristudioCpActionRequest: (id: number) => void;
  setOristudioCpActiveDiagnostic: (id: string | null) => void;
  foldOristudioCpDocument: (options?: {
    startingFaceId?: number;
    order?: OristudioCpEstimationOrder;
    model?: OristudioCpFoldedFigureModel;
    lineIds?: number[];
  }) => Promise<boolean>;
  foldAnotherOristudioCpFigure: (id?: string) => Promise<boolean>;
  foldOristudioCpFigureToCase: (id: string, objective: number) => Promise<boolean>;
  setOristudioCpFoldedFigureDisplayStyle: (
    id: string,
    displayStyle: OristudioCpFoldedFigureDisplayStyle
  ) => Promise<boolean>;
  /**
   * Move a 3D figure's eye and re-project it.
   *
   * Synchronous work behind an async signature, like its display-style sibling:
   * a 3D figure's picture is made in the frontend from the render model beside
   * its handle, so nothing is asked of the kernel. A figure reopened from a file
   * has no render model and keeps the picture it was saved with — the camera is
   * still recorded, so a refold shows the chosen view.
   *
   * Rejects a flat figure: there is no viewpoint to move.
   */
  setOristudioCpFolded3dCamera: (id: string, camera: FoldedFigureCamera) => Promise<boolean>;
  updateOristudioCpFoldedFigureModel: (
    id: string,
    update: Partial<OristudioCpFoldedFigureModel>
  ) => Promise<boolean>;
  duplicateOristudioCpFoldedFigure: (id?: string) => Promise<boolean>;
  /**
   * Re-fold a figure from its recorded source region, in place — same id,
   * placement, style and model, fresh geometry. See
   * `lib/foldedFigureStaleness.ts` for how that region is recorded and how a
   * figure is judged out of date.
   */
  refoldOristudioCpFoldedFigure: (id: string) => Promise<boolean>;
  /**
   * Give a 3D figure reopened from a file its geometry back, so it can be turned
   * again — without changing what it draws.
   *
   * The render model a 3D figure is re-projected from is deliberately not
   * persisted, so a reopened figure draws its stored picture and nothing more.
   * This refolds from the same source region and adopts the result **only if it
   * reproduces that picture**: same solution index, same frame. It records no
   * undo entry, sets no `dirty`, takes no selection and raises no error, because
   * from the user's side nothing happened except that the figure became live.
   *
   * A **stale** figure is refused outright: refolding one would replace what is
   * on screen with a different fold, which is what the explicit **Refold** verb
   * is for. See `folded/folded3dRehydrate.ts` for the full set of conditions.
   *
   * `pending` shows the ordinary `loading` status while it runs — for the
   * on-demand case, where someone pressed the figure and is waiting. The
   * background pass leaves the status alone.
   *
   * Resolves `true` only when the figure was adopted.
   */
  rehydrateOristudioCpFolded3dFigure: (
    id: string,
    options?: { pending?: boolean }
  ) => Promise<boolean>;
  deleteOristudioCpFoldedFigure: (id: string) => Promise<void>;
  setOristudioCpActiveFoldedFigure: (id: string | null) => void;
  /**
   * Patch a folded figure's display placement (move / scale / rotate). Purely
   * web-side and synchronous, so it is safe to call on every frame of a drag —
   * see {@link FoldedFigurePlacement} for why placement does not go through the
   * kernel model.
   */
  setOristudioCpFoldedFigurePlacement: (
    id: string,
    patch: Partial<FoldedFigurePlacement>
  ) => void;
  /**
   * Open an inline simulation of the region these creases enclose, falling back
   * to the Simulate panel when they are not one whole region.
   *
   * The store-level door onto the same helper the refused 3D fold uses, so a
   * verdict that offers "simulate instead" reaches exactly the path a refusal
   * does — including its region constraint and its fallback.
   */
  simulateOristudioCpCreaseRegion: (lineIds: readonly number[]) => Promise<void>;
  clearOristudioCpFoldedFigures: () => Promise<void>;
  clearOristudioCpSelection: () => void;
  toggleOristudioCpLineSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpPointSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpCircleSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpTextSelection: (id: number, additive?: boolean) => void;
  transformOristudioCpSelection: (transform: CpSelectionTransform) => Promise<boolean>;
  /** Append an annotation to the layer and select it. */
  addAnnotation: (annotation: CanvasAnnotation) => void;
  /** Patch an existing annotation (transform, opacity, lock/hide, z, payload). */
  updateAnnotation: (id: string, patch: AnnotationUpdate) => void;
  /** Remove an annotation; clears the selection if it was selected. */
  removeAnnotation: (id: string) => void;
  /** Select an annotation (or clear with `null`). */
  setSelectedAnnotation: (id: string | null) => void;
  /**
   * Update a text box's measured auto-height without dirtying the project or
   * recording history — a pure layout sync driven by content reflow, so the
   * selection handles match the rendered box.
   */
  syncAnnotationHeight: (id: string, height: number) => void;
  /** Replace the whole annotation layer (used by load and snapshot restore). */
  setAnnotations: (annotations: CanvasAnnotation[]) => void;
  /**
   * Record an annotation-layer edit into the CP undo history. `previous` is the
   * layer state *before* the gesture (the store already holds the post-gesture
   * state). Pushes an `annotationsOnly` history entry and clears the redo stack.
   */
  recordAnnotationHistory: (previous: CanvasAnnotation[], label: string) => void;
  /**
   * Record a folded-figure change into the CP undo history. `previous` is the
   * figure list *before* the action (the store already holds the result).
   * Pushes an `overlayOnly` entry and clears the redo stack — the counterpart of
   * {@link recordAnnotationHistory} for the other overlay layer.
   */
  /**
   * Re-push each figure's stored model into its kernel handle. Fire-and-forget;
   * safe to call repeatedly, since redundant reconciles are skipped.
   */
  reconcileFoldedFigureModels: (ids: readonly string[]) => void;
  recordFoldedFigureHistory: (
    previous: OristudioCpFoldedFigureEntry[],
    label: string,
    previousActiveId?: string | null
  ) => void;
  /**
   * Record a simulation-window change into the CP undo history. `previous` is the
   * window list *before* the action; the store already holds the result. The
   * third overlay layer's counterpart to {@link recordAnnotationHistory}.
   *
   * Windows never mutate the wasm document — the fold runs entirely web-side — so
   * like the other two this is always an `overlayOnly` entry, which is the branch
   * of undo that swaps state without reloading the kernel.
   */
  recordInlineSimulationHistory: (previous: InlineSimulation[], label: string) => void;
}

export type CreasePatternSlice = CreasePatternSliceState & CreasePatternSliceActions;

/**
 * A BP undo/redo snapshot: the serialized project (bps text), the selection to
 * restore, and the mirror-draw state that went with them. BP history is
 * snapshot-based (restore a whole previous state) rather than engine
 * command-replay — see `snapshotHistory`.
 *
 * `bps` is null for a step that changed only the symmetry, which is how a
 * symmetry edit records an undo entry without a worker round-trip to serialize a
 * design it did not touch. Restoring such a step leaves the document alone.
 */
export interface BpHistorySnapshot {
  bps: string | null;
  selection: OristudioBpSelection;
  symmetry: BpDocumentSymmetry;
}

/**
 * BP-tree symmetry authoring state: the mirror-draw axis and what is paired
 * across it.
 *
 * Split in two. {@link BpDocumentSymmetry} — `enabled`, `fold`, `pairs` — is part
 * of the design and is saved into `.osf`; no Box Pleating Studio format can
 * carry it, so every BP export drops it (see `lib/supersetFeatures.ts`).
 * `angle`/`loc` describe the axis in tree coordinates and are *derived*: the
 * angle is always {@link BP_TREE_SYMMETRY_ANGLE}, because a tree is not drawn on
 * the paper and so has nothing to orient a mirror against, and `loc` is the
 * centre of whatever sheet is loaded. Which fold of the *paper* the mirror
 * becomes is `fold`, and that does travel with the design.
 */
export interface OristudioBpSymmetryState extends BpDocumentSymmetry {
  angle: number;
  loc: Point;
}

/**
 * What is left of the Box-Pleat slice's state after phase 2c.
 *
 * The document, its selection, its undo stacks, its symmetry and its viewport-fit
 * counter all moved onto the active design tab (`BoxPleatDesignState`) — read
 * them with `selectOristudioBpDocument` and friends. What stays here is genuinely
 * workspace-scoped:
 *
 * - `oristudioBpError` and `oristudioBpBusy` mirror the singleton BP worker.
 *   Per-design would be more precise, but the optimizer is a single worker with a
 *   single cancel token (see R2b in the design-pane-tabs plan), so a per-workspace
 *   flag matches what is actually true of the engine. Over-blocking, never under.
 *
 * `oristudioBpWorkspace` is gone: it was only ever assigned `null`, and the `.bpz`
 * multi-project loader it was built for had no callers.
 */
export interface OristudioBpSliceState {
  oristudioBpError: string | null;
  oristudioBpBusy: boolean;
}

export interface OristudioBpSliceActions {
  /** Create a fresh Box Pleating project and hold it in the store. */
  createOristudioBpProject: (options?: {
    confirmDiscard?: boolean;
    preserveEditCanvas?: boolean;
    /**
     * The design to seed, when the caller captured it before an await of its own.
     * Defaults to the active design, which is right for a user-initiated "new
     * project" and wrong for a self-provision that had to hydrate first.
     */
    designId?: string;
  }) => Promise<boolean>;
  /**
   * Seed a starter box-pleat project when the Design/box-pleat surface is entered
   * without one (self-provision), so `/design/bp` is reachable directly. Idempotent
   * and deduped against concurrent callers; a no-op when a BP document exists.
   */
  ensureBoxPleatProject: () => Promise<void>;
  /** Load a bundled Box Pleating example project. */
  loadOristudioBpExample: (id: string, options?: { confirmDiscard?: boolean }) => Promise<boolean>;
  /**
   * Load a Box Pleating Studio `.bps` project from file text into the workspace,
   * mirroring {@link loadOristudioBpExample} but for user-supplied content.
   */
  loadOristudioBpProjectFromFile: (
    text: string,
    source: { filename: string; path?: string | null },
    /**
     * Mirror-draw state to restore alongside the design. Only an `.osf` has any
     * — a bare `.bps` cannot carry symmetry — so this is absent for plain
     * Box Pleating Studio files and the design opens with the default.
     */
    options?: {
      symmetry?: BpDocumentSymmetry | null;
      /**
       * Keep the Edit canvas rather than clearing it. Set by the `.osf` loader
       * when the bundle also carries a crease pattern to install right after, so
       * the load never publishes an empty canvas for the Edit surface to
       * self-provision into and then discard.
       */
      preserveEditCanvas?: boolean;
    }
  ) => Promise<boolean>;
  /** Replace the active BP selection. */
  selectOristudioBp: (selection: OristudioBpSelection) => void;
  /** Select nothing. The one way for a surface to clear the BP selection. */
  clearOristudioBpSelection: () => void;
  /** Switch the BP editing surface intent (tree vs packing) and focus its pane. */
  setOristudioBpActiveSurface: (surface: OristudioBpEditingSurface) => void;
  /** Move a BP tree vertex; `dragging` coalesces intermediate drag updates. */
  moveOristudioBpTreeVertex: (id: number, loc: Point, dragging?: boolean) => Promise<boolean>;
  /** Move several BP tree vertices at once (e.g. a rigidly-rotated subtree). */
  moveOristudioBpTreeVertices: (
    updates: { id: number; loc: Point }[],
    dragging?: boolean
  ) => Promise<boolean>;
  /** Add a unit-length leaf to a parent vertex, optionally at a target location. */
  addOristudioBpTreeLeaf: (parentId: number, loc?: Point) => Promise<boolean>;
  /** Patch the ephemeral BP-tree symmetry authoring state (mirror-draw). */
  setOristudioBpSymmetry: (update: Partial<OristudioBpSymmetryState>) => void;
  /**
   * Add a leaf and, when mirror-draw is on and the parent has a mirror, also add the
   * reflected leaf on the other side — recording the new pair. One undo entry. A leaf
   * whose tip lands within `axisTolerance` (tree units) of the axis snaps onto it as a
   * single centred leaf instead of mirroring; the panel sizes this to the visible
   * axis band so a click anywhere inside the line makes one centred leaf.
   */
  addOristudioBpTreeLeafWithSymmetry: (
    parentId: number,
    loc?: Point,
    axisTolerance?: number
  ) => Promise<boolean>;
  /**
   * Move vertices and, when mirror-draw is on, also move their paired counterparts to
   * the reflected positions (partial mirror). One undo entry / coalesced drag.
   */
  moveOristudioBpTreeVerticesWithSymmetry: (
    updates: { id: number; loc: Point }[],
    dragging?: boolean
  ) => Promise<boolean>;
  /** Delete a tree node (leaf-cascade; the engine refuses below the minimum size). */
  deleteOristudioBpTreeNode: (id: number) => Promise<boolean>;
  /**
   * Send the BP design's crease pattern to the Edit canvas (Import(Add) merge).
   *
   * With `includeCircles`, the flap circles come too — but only for flaps that
   * *are* circles; one with a width or a height has no honest representation
   * there. See `boxPleatPackingCircles`.
   */
  sendOristudioBpToEdit: (includeCircles?: boolean) => Promise<boolean>;
  /**
   * Set the length of the tree edge between two vertices (min 1). `subtreeUpdates`
   * repositions the child subtree so the rendered edge stays length-faithful;
   * doing it here keeps the length edit + reposition as one undo entry.
   */
  setOristudioBpTreeEdgeLength: (
    vertices: [number, number],
    length: number,
    subtreeUpdates?: { id: number; loc: Point }[]
  ) => Promise<boolean>;
  /**
   * Rename a BP tree vertex by id. A flap has no name of its own — its name is
   * the name of its dual leaf vertex — so this serves both the tree (vertex)
   * and packing (flap) surfaces; pass the flap's `vertexId` from the packing
   * side. Empty and duplicate names are allowed, matching Box Pleating Studio.
   * Recorded as a single undo entry.
   */
  renameOristudioBpVertex: (id: number, name: string) => Promise<boolean>;
  /** Move a single BP flap in the packing. */
  moveOristudioBpLayoutFlap: (id: number, loc: Point, dragging?: boolean) => Promise<boolean>;
  /**
   * Resize a BP flap's rectangular footprint (width/height, both >= 0). The
   * engine re-packs and rejects a size that would push more than one flap
   * corner off the sheet. Recorded as a single undo entry.
   */
  resizeOristudioBpLayoutFlap: (id: number, width: number, height: number) => Promise<boolean>;
  /** Move a group of BP flaps in the packing. */
  moveOristudioBpLayoutFlaps: (ids: number[], loc: Point, dragging?: boolean) => Promise<boolean>;
  /**
   * Move a BP flap, carrying its mirror partner to the reflected position.
   *
   * The two sides of a symmetric design are one shape, so a move that left the
   * partner behind would break the symmetry the user drew — the same reasoning
   * that already makes a resize and a delete apply to both. Delegates to
   * {@link moveOristudioBpLayoutFlap} when mirror draw is off.
   */
  moveOristudioBpLayoutFlapWithSymmetry: (
    id: number,
    loc: Point,
    dragging?: boolean
  ) => Promise<boolean>;
  /** {@link moveOristudioBpLayoutFlapWithSymmetry} for a whole selection. */
  moveOristudioBpLayoutFlapsWithSymmetry: (
    ids: number[],
    loc: Point,
    dragging?: boolean
  ) => Promise<boolean>;
  /** Move a BP device handle in the packing. */
  moveOristudioBpDevice: (
    id: string,
    index: number,
    loc: Point,
    dragging?: boolean
  ) => Promise<boolean>;
  /** Cycle a stretch's GOPS configuration (delta ±1) to pick a valid crease pattern. */
  switchOristudioBpStretchConfig: (id: string, delta: number) => Promise<boolean>;
  /** Cycle a stretch's pattern within the current configuration (delta ±1). */
  switchOristudioBpStretchPattern: (id: string, delta: number) => Promise<boolean>;
  /** Compute a stretch's configurations/patterns (BP Studio completes on select). */
  completeOristudioBpStretch: (id: string) => Promise<boolean>;
  /** Subdivide the BP sheet grid. */
  subdivideOristudioBpLayoutSheet: () => Promise<boolean>;
  /** Un-subdivide (halve) the BP sheet grid. No-ops if it can't halve cleanly. */
  unsubdivideOristudioBpLayoutSheet: () => Promise<boolean>;
  /** Rotate the BP sheet clockwise/counter-clockwise. */
  rotateOristudioBpLayoutSheet: (clockwise: boolean) => Promise<boolean>;
  /** Flip the BP sheet horizontally/vertically. */
  flipOristudioBpLayoutSheet: (horizontal: boolean) => Promise<boolean>;
  /**
   * Set the BP sheet grid type and dimensions (flaps re-map to stay in range).
   *
   * A `null` dimension keeps whatever the engine's sheet has when the call
   * lands. Pass `null` for every dimension the caller is not editing: a caller
   * that restates the other dimension restates the one it rendered with, and
   * two edits issued back to back then undo each other.
   */
  setOristudioBpLayoutSheet: (
    gridType: OristudioBpSheetKind,
    width: number | null,
    height: number | null
  ) => Promise<boolean>;
  /**
   * Forget that this vertex mirrors another. The two stay where they are; they
   * simply stop being each other's mirror, and the optimizer will fall back to
   * whatever their positions imply.
   */
  unpairOristudioBpTreeSymmetry: (vertexId: number) => void;
  /**
   * Run the BP layout optimizer and apply its result as one undoable step.
   * Cancelling leaves the document and history untouched.
   */
  optimizeOristudioBpLayout: (
    options: OristudioBpOptimizerRunOptions,
    onProgress?: (progress: OristudioBpOptimizerProgress) => void
  ) => Promise<OristudioBpOptimizerOutcome>;
}

export type OristudioBpSlice = OristudioBpSliceState & OristudioBpSliceActions;

export interface SimulatorSliceState {
  /**
   * Render, material, and solver settings for the Simulate workspace. Shared
   * store state rather than panel-local because the simulator canvas and its
   * options pane are sibling panels; persisted so choices survive a reload.
   */
  simulatorSettings: SimulatorSettings;
}

export interface SimulatorSliceActions {
  /** Set one setting, clamped to its range for numeric keys. */
  setSimulatorSetting: <K extends SimulatorSettingKey>(key: K, value: SimulatorSettings[K]) => void;
  /** Restore the paper's material properties (stiffness, damping) to defaults. */
  resetSimulatorMaterial: () => void;
  /** Paper and crease appearance back to the theme / origami-convention defaults. */
  resetSimulatorStyle: () => void;
}

export type SimulatorSlice = SimulatorSliceState & SimulatorSliceActions;

/**
 * The ExplOri design's actions.
 *
 * Every one is addressed and asynchronous — even the ones that only touch local
 * JSON — because they all acquire the design's handle first, and that acquire
 * can hydrate a parked document.
 */
export interface ExploriSlice {
  createExploriDesign: () => Promise<boolean>;
  ensureExploriDocument: () => Promise<boolean>;
  setExploriTreeSelection: (selection: TreeSelectionTarget | null) => void;
  addExploriLeaf: (parentId: number, loc: Point, axisTolerance: number) => Promise<boolean>;
  moveExploriNodes: (updates: readonly TreeVertexUpdate[]) => Promise<boolean>;
  deleteExploriNode: (nodeId: number) => Promise<boolean>;
  renameExploriNode: (nodeId: number, name: string) => Promise<boolean>;
  setExploriEdgeLength: (
    edgeId: number,
    length: number,
    updates: readonly TreeVertexUpdate[]
  ) => Promise<boolean>;
  toggleExploriSymmetry: () => Promise<boolean>;
  unpairExploriNode: (nodeId: number) => Promise<boolean>;
  setExploriDbConfigs: (dbConfigs: ExploriDbConfig[]) => Promise<boolean>;
  setExploriResultLimit: (resultLimit: number) => Promise<boolean>;
  selectExploriResult: (result: ExploriResult | null, detailIndex: number | null) => Promise<boolean>;
  runExploriQuery: () => Promise<boolean>;
  sendExploriToEdit: (source?: ExploriSendSource) => Promise<boolean>;
  undoExplori: () => Promise<boolean>;
  redoExplori: () => Promise<boolean>;
  resetExploriDesign: () => Promise<boolean>;
}

export type WorkspaceState =
  ProjectSlice &
  ExploriSlice &
  HistorySlice &
  EditingSlice &
  ClipboardSlice &
  ConditionSlice &
  CreasePatternSlice &
  OristudioBpSlice &
  SimulatorSlice;

export type WorkspaceSliceCreator<T> = StateCreator<
  WorkspaceState,
  [['zustand/devtools', never]],
  [],
  T
>;

export type { TreeEdit };
