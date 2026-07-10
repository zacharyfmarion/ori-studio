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
import type {
  AppStatus,
  CreaseColorMode,
  DocumentMode,
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
import type {
  OristudioBpDocumentState,
  OristudioBpEditingSurface,
  OristudioBpPortDescriptor,
  OristudioBpSelection,
  OristudioBpWorkspaceState,
} from '../../engine/oristudioBpTypes';

export interface OristudioCpHistoryEntry {
  document: OristudioCpDocumentSnapshot;
  selection: OristudioCpSelection;
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
  documentMode: DocumentMode;
  activeEditingSurface: DocumentMode;
  importedCreasePattern: ImportedCreasePatternDocument | null;
  oristudioCpDocument: OristudioCpDocumentState | null;
  oristudioCpLineage: OristudioCpLineage | null;
  oristudioCpOperationDescriptors: OristudioCpOperationDescriptor[];
  oristudioCpError: string | null;
  oristudioCpCamvResult: OristudioCpCommandResult | null;
  oristudioCpHistoryPast: OristudioCpHistoryEntry[];
  oristudioCpHistoryFuture: OristudioCpHistoryEntry[];
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
  createNewProject: () => Promise<void>;
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
  openProject: (fileService?: FileService) => Promise<boolean>;
  importAddCreasePattern: (fileService?: FileService) => Promise<boolean>;
  saveProject: (fileService?: FileService) => Promise<boolean>;
  saveProjectAs: (fileService?: FileService) => Promise<boolean>;
  exportV5: (fileService?: FileService) => Promise<boolean>;
  exportV4: (fileService?: FileService) => Promise<boolean>;
  exportCp: (fileService?: FileService) => Promise<boolean>;
  exportFold: (fileService?: FileService) => Promise<boolean>;
  exportOri: (fileService?: FileService) => Promise<boolean>;
  exportOrh: (fileService?: FileService) => Promise<boolean>;
  exportSvg: (fileService?: FileService, options?: CreaseExportOptions) => Promise<boolean>;
  exportPng: (fileService?: FileService, options?: CreaseExportOptions) => Promise<boolean>;
  loadExampleProject: (id: string) => Promise<void>;
  clearProjectMessage: () => void;
  setActiveEditingSurface: (surface: DocumentMode) => void;
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
  buildCreasePattern: () => Promise<void>;
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
  toggleOristudioCpVertexSelection: (id: string, additive?: boolean) => void;
  toggleOristudioCpPointSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpCircleSelection: (id: number, additive?: boolean) => void;
  toggleOristudioCpTextSelection: (id: number, additive?: boolean) => void;
  transformOristudioCpSelection: (transform: CpSelectionTransform) => Promise<boolean>;
}

export type CreasePatternSlice = CreasePatternSliceState & CreasePatternSliceActions;

export interface OristudioBpSliceState {
  oristudioBpDocument: OristudioBpDocumentState | null;
  oristudioBpWorkspace: OristudioBpWorkspaceState | null;
  oristudioBpPortDescriptors: OristudioBpPortDescriptor[];
  oristudioBpError: string | null;
  oristudioBpBusy: boolean;
}

export interface OristudioBpSliceActions {
  /** Create a fresh Box Pleating project and hold it in the store. */
  createOristudioBpProject: (options?: { confirmDiscard?: boolean }) => Promise<boolean>;
  /** Load a bundled Box Pleating example project. */
  loadOristudioBpExample: (id: string, options?: { confirmDiscard?: boolean }) => Promise<boolean>;
  /** Replace the active BP selection. */
  selectOristudioBp: (selection: OristudioBpSelection) => void;
  /** Switch the BP editing surface intent (tree vs packing) and focus its pane. */
  setOristudioBpActiveSurface: (surface: OristudioBpEditingSurface) => void;
  /** Move a BP tree vertex; `dragging` coalesces intermediate drag updates. */
  moveOristudioBpTreeVertex: (id: number, loc: Point, dragging?: boolean) => Promise<boolean>;
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
  /** Subdivide the BP sheet grid. */
  subdivideOristudioBpLayoutSheet: () => Promise<boolean>;
  /** Rotate the BP sheet clockwise/counter-clockwise. */
  rotateOristudioBpLayoutSheet: (clockwise: boolean) => Promise<boolean>;
  /** Flip the BP sheet horizontally/vertically. */
  flipOristudioBpLayoutSheet: (horizontal: boolean) => Promise<boolean>;
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
