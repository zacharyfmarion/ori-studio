import type { StateCreator } from 'zustand';
import type {
  ConditionKind,
  FoldArtifacts,
  OptimizationReport,
  SequencePlan,
  SequenceTargetState,
  TreeEdit,
  WasmErrorEnvelope,
} from '../../engine/types';
import type { Point } from '../../lib/geometry';
import type { DesignLayoutVariant } from '../layoutStore';
import type { EditingContext } from '../../workspaces/editingContext';
import type { ImportedCreasePatternFormat } from '../../lib/creasePatternImport';
import type { SnapshotEntry } from './snapshotHistory';
import type {
  AppStatus,
  CreaseColorMode,
  Selection,
  ToolMode,
  TreeProject,
  WorkflowTarget,
} from '../../lib/sampleProject';
import type {
  OristudioCpSelection,
  OristudioCpViewportOptionKey,
  OristudioCpViewportOptions,
} from '../../lib/creasePatternViewport';
import type { SelectablePartKind } from '../../lib/selection';
import type { SimulatorSettings, SimulatorSettingKey } from '../../lib/simulatorSettings';
import type { SymmetryAuthoringPair } from '../../lib/symmetryAuthoring';
import type { BpTreeSymmetryPair } from '../../lib/bpTreeSymmetry';
import type { FileService } from '../../platform/fileService';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import type { CreaseExportOptions } from '../../lib/creaseExport';
import type { SegmentExportFormat } from '../../lib/creaseSegmentExport';
import type { FoldedFigureExportFormat } from '../../cp-workspace/folded/foldedFigureExport';
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
import type {
  OristudioBpDocumentState,
  OristudioBpEditingSurface,
  OristudioBpPortDescriptor,
  OristudioBpSelection,
  OristudioBpSheetKind,
  OristudioBpWorkspaceState,
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

export interface ProjectSliceState {
  project: TreeProject;
  workflowTarget: WorkflowTarget;
  /**
   * True while the Design workspace is waiting for the user to pick a design
   * method (Circle-packed vs Box-pleated). Drives the Design pane NUX chooser.
   */
  pendingDesignChoice: boolean;
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
  oristudioCpDocumentExtensions: Record<string, unknown>;
  projectLoadId: number;
  currentFilePath: string | null;
  currentFileName: string;
  projectMessage: string | null;
  status: AppStatus;
  dirty: boolean;
  engineReady: boolean;
  error: WasmErrorEnvelope | null;
  lastOptimization: OptimizationReport | null;
  designViewportFitRequestId: number;
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
  openProject: (fileService?: FileService) => Promise<boolean>;
  importAddCreasePattern: (fileService?: FileService) => Promise<boolean>;
  /** Merge crease-pattern text into the Edit canvas (in-memory Import(Add)). */
  importAddOristudioCpText: (
    text: string,
    format: ImportedCreasePatternFormat,
    label: string,
    filename?: string
  ) => Promise<boolean>;
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
   * Save one folded figure as a standalone image, serialized from the snapshot
   * already on screen rather than re-folded. See `lib/foldedFigureExport.ts`.
   */
  exportOristudioCpFoldedFigure: (
    format: FoldedFigureExportFormat,
    figureId: string,
    fileService?: FileService
  ) => Promise<boolean>;
  loadExampleProject: (id: string) => Promise<void>;
  clearProjectMessage: () => void;
  setActivePanelId: (id: string | null) => void;
  setWorkflowTarget: (target: WorkflowTarget) => void;
  /** Enter the Design workspace on the method chooser without creating a document. */
  startNewDesign: () => void;
  /** Resolve the Design pane NUX chooser into a concrete design method. */
  chooseDesignMethod: (target: WorkflowTarget) => Promise<void>;
  /**
   * Reflect a Design sub-route (`/design`, `/design/treemaker`, `/design/bp`)
   * into the design state so the layout variant matches the URL. Sets the
   * variant fields only; establishing a document is the caller's concern.
   */
  applyDesignRoute: (variant: DesignLayoutVariant) => void;
}

export type ProjectSlice = ProjectSliceState & ProjectSliceActions;

export interface HistoryEntry {
  text: string;
  label: string;
  timestamp: string;
}

export interface HistorySliceState {
  historyPast: HistoryEntry[];
  historyFuture: HistoryEntry[];
  historyBusy: boolean;
}

export interface HistorySliceActions {
  beginHistoryCheckpoint: () => Promise<string | null>;
  commitHistoryCheckpoint: (beforeText: string | null, label?: string) => void;
  clearHistory: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export type HistorySlice = HistorySliceState & HistorySliceActions;

export interface EditingSliceState {
  selection: Selection;
  toolMode: ToolMode;
  symmetryAuthoringPairs: SymmetryAuthoringPair[];
}

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

export type EditingSlice = EditingSliceState & EditingSliceActions;

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
   * Superset feature: annotations (reference images, rich-text boxes) placed on
   * the crease-pattern canvas. Web-side layer, never in the kernel; the full
   * model persists only in `.osf`. A single array so z-order and selection are
   * shared across kinds. See `apps/web/docs/superset-features.md`.
   */
  oristudioCpAnnotations: CanvasAnnotation[];
  oristudioCpSelectedAnnotationId: string | null;
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
   */
  sendTreeCreasePatternToEdit: () => Promise<boolean>;
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
  setSequenceSimulationFocus: (focus: SequenceSimulationFocus) => void;
  setOristudioCpViewportOption: <K extends OristudioCpViewportOptionKey>(
    key: K,
    value: OristudioCpViewportOptions[K]
  ) => void;
  setOristudioCpSelection: (selection: OristudioCpSelection) => void;
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
}

export type CreasePatternSlice = CreasePatternSliceState & CreasePatternSliceActions;

/**
 * A BP undo/redo snapshot: the serialized project (bps text) plus the selection
 * to restore. BP history is snapshot-based (restore a whole previous state)
 * rather than engine command-replay — see `snapshotHistory`.
 */
export interface BpHistorySnapshot {
  bps: string;
  selection: OristudioBpSelection;
}

/**
 * Ephemeral BP-tree symmetry authoring state. Not persisted to the document/.bps —
 * it lives only in the store for the current editing session (mirror-draw axis +
 * paired vertices). `angle`/`loc` describe the mirror axis in tree coordinates.
 */
export interface OristudioBpSymmetryState {
  enabled: boolean;
  angle: number;
  loc: Point;
  pairs: BpTreeSymmetryPair[];
}

export interface OristudioBpSliceState {
  oristudioBpDocument: OristudioBpDocumentState | null;
  /**
   * What the user has selected in the BP surfaces. Session state, not document
   * state — see the doc comment on {@link OristudioBpSelection}. It sits beside
   * the document rather than inside it so its lifetime is visible, and so
   * replacing the document after an edit doesn't have to carry it.
   */
  oristudioBpSelection: OristudioBpSelection;
  oristudioBpWorkspace: OristudioBpWorkspaceState | null;
  oristudioBpPortDescriptors: OristudioBpPortDescriptor[];
  oristudioBpError: string | null;
  oristudioBpBusy: boolean;
  oristudioBpHistoryPast: SnapshotEntry<BpHistorySnapshot>[];
  oristudioBpHistoryFuture: SnapshotEntry<BpHistorySnapshot>[];
  oristudioBpSymmetry: OristudioBpSymmetryState;
}

export interface OristudioBpSliceActions {
  /** Create a fresh Box Pleating project and hold it in the store. */
  createOristudioBpProject: (options?: {
    confirmDiscard?: boolean;
    preserveEditCanvas?: boolean;
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
    source: { filename: string; path?: string | null }
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
  /** Send the BP design's crease pattern to the Edit canvas (Import(Add) merge). */
  sendOristudioBpToEdit: () => Promise<boolean>;
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
  /** Set the BP sheet grid type and dimensions (flaps re-map to stay in range). */
  setOristudioBpLayoutSheet: (
    gridType: OristudioBpSheetKind,
    width: number,
    height: number
  ) => Promise<boolean>;
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
}

export type SimulatorSlice = SimulatorSliceState & SimulatorSliceActions;

export type WorkspaceState =
  ProjectSlice &
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
