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
import type { SymmetryAuthoringPair } from '../../lib/symmetryAuthoring';
import type { BpTreeSymmetryPair } from '../../lib/bpTreeSymmetry';
import type { FileService } from '../../platform/fileService';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import type { CreaseExportOptions } from '../../lib/creaseExport';
import type { FoldArtifactStatus } from './foldArtifactResource';
import type {
  OristudioCpCommandPayload,
  OristudioCpCommandPreview,
  OristudioCpCommandResult,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpEstimationOrder,
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
import type { CpImage, CpImageUpdate } from '../../cp-workspace/images/cpImage';
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
  /** Reference-image layer at the captured moment (superset feature). */
  images: CpImage[];
  /**
   * True when the entry captures an image-layer-only change (add/move/resize/
   * rotate/crop/delete). Undo/redo then swaps images without reloading the
   * (unchanged) wasm document, keeping image edits cheap.
   */
  imageOnly?: boolean;
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
  loadExampleProject: (id: string) => Promise<void>;
  clearProjectMessage: () => void;
  setActivePanelId: (id: string | null) => void;
  setWorkflowTarget: (target: WorkflowTarget) => void;
  /** Enter the Design workspace on the method chooser without creating a document. */
  startNewDesign: () => void;
  /** Resolve the Design pane NUX chooser into a concrete design method. */
  chooseDesignMethod: (target: WorkflowTarget) => Promise<void>;
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
  oristudioCpActiveFoldedFigureId: string | null;
  oristudioCpViewport: OristudioCpViewportOptions;
  /**
   * Superset feature: reference images placed on the crease-pattern canvas.
   * Web-side layer, never in the kernel; persisted only in `.osf`. See
   * `apps/web/docs/superset-features.md`.
   */
  oristudioCpImages: CpImage[];
  oristudioCpSelectedImageId: string | null;
  foldArtifacts: FoldArtifacts | null;
  foldArtifactError: string | null;
  foldArtifactStatus: FoldArtifactStatus;
  foldArtifactRevision: number;
  foldArtifactResolvedRevision: number | null;
  foldArtifactRequestId: number;
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
  deleteOristudioCpFoldedFigure: (id: string) => Promise<void>;
  setOristudioCpActiveFoldedFigure: (id: string | null) => void;
  moveOristudioCpFoldedFigure: (id: string, displayDelta: Point) => void;
  clearOristudioCpFoldedFigures: () => Promise<void>;
  clearOristudioCpSelection: () => void;
  toggleOristudioCpLineSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpPointSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpCircleSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpTextSelection: (id: number, additive?: boolean) => void;
  transformOristudioCpSelection: (transform: CpSelectionTransform) => Promise<boolean>;
  /** Append a reference image to the crease-pattern image layer and select it. */
  addCpImage: (image: CpImage) => void;
  /** Patch an existing image (transform, crop, opacity, lock/hide, z). */
  updateCpImage: (id: string, patch: CpImageUpdate) => void;
  /** Remove an image; clears the selection if it was selected. */
  removeCpImage: (id: string) => void;
  /** Select an image (or clear with `null`). */
  setSelectedCpImage: (id: string | null) => void;
  /** Replace the whole image layer (used by load and snapshot restore). */
  setCpImages: (images: CpImage[]) => void;
  /**
   * Record an image-layer edit into the CP undo history. `previousImages` is the
   * layer state *before* the gesture (the store already holds the post-gesture
   * state). Pushes an `imageOnly` history entry and clears the redo stack.
   */
  recordCpImageHistory: (previousImages: CpImage[], label: string) => void;
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
  /** Move a single BP flap in the packing. */
  moveOristudioBpLayoutFlap: (id: number, loc: Point, dragging?: boolean) => Promise<boolean>;
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

export type WorkspaceState =
  ProjectSlice &
  HistorySlice &
  EditingSlice &
  ClipboardSlice &
  ConditionSlice &
  CreasePatternSlice &
  OristudioBpSlice;

export type WorkspaceSliceCreator<T> = StateCreator<
  WorkspaceState,
  [['zustand/devtools', never]],
  [],
  T
>;

export type { TreeEdit };
