// @vitest-environment jsdom
import { patchBoxPleatDesign, singleBoxPleatDesignTab } from './designTabs';
import { selectDesignMethod, selectDesignViewportFitRequestId, selectHistoryFuture, selectHistoryPast, selectLastOptimization, selectOristudioBpDocument, selectOristudioBpHistoryPast, selectOristudioBpSymmetry, selectOristudioBpViewportFitRequestId, selectProject, selectSelection, selectSymmetryAuthoringPairs, selectToolMode, singleDesignTab, singleTreemakerDesignTab } from './designTabs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConditionKind,
  ConditionSnapshot,
  EditReport,
  EdgeSnapshot,
  FoldArtifacts,
  FoldDocument,
  NodeSnapshot,
  OptimizationReport,
  PaperSettings,
  PathSnapshot,
  TreeEdit,
  TreeSnapshot,
  TreeSummary,
} from '../../engine/types';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpFold3dVerdict,
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dSnapshot,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpFoldSource,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
} from '../../engine/oristudioCpTypes';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type { InlineSimulation } from '../../cp-workspace/inlineSimulation/inlineSimulation';
import {
  inlineSimulationSourceCount,
  setInlineSimulationSource,
} from '../../cp-workspace/inlineSimulation/inlineSimulationRuntime';
import { CP_DOCUMENT_SCOPED_KEYS, discardCpDocumentState } from './cpDocumentState';
import { DIAGRAM_SCOPED_KEYS, discardDiagramState, isDiagramAnnotating } from './diagramState';
import { FOLD_SCOPED_KEYS, discardFoldState, pickFoldState } from './foldState';
import { valleyAt, writtenSequence } from '../../fold/document/foldSequence.fixtures';
import { FOLD_SEQUENCE_FORMAT_VERSION } from '../../fold/document/foldSequenceDocument';
import { readFoldSequences } from '../../fold/document/foldSequenceFile';
import { registerPendingEditFlush, resetPendingEditsForTests } from '../../lib/pendingEdits';
import { readDiagram } from '../../diagram/document/diagramFile';
import {
  annotationsOutOfStep,
  createDiagram,
  insertSteps,
  PAGE_SETTINGS,
  setPageSetup,
  stepAsset,
  stepIndex,
  type DiagramDocument,
  type KnownDiagramAnnotation,
  type KnownDiagramAsset,
} from '../../diagram/document/diagramDocument';
import { FIXTURE_FONTS } from '../../diagram/fonts/diagramFonts.fixtures';
import { layoutDiagram } from '../../diagram/pages/diagramPages';
import { fontTextSetter } from '../../diagram/pages/fontTextSetter';
import { sanitizeSvg } from '../../diagram/upload/svgSanitize';
import { foldCancellationBuffer } from '../../lib/foldCancellation';
import { registerCpCamera } from '../../cp-workspace/renderer/cpCameraRegistry';
import { projectFromSnapshot } from '../../engine/snapshotMapper';
import type { FileService, SaveBinaryFileOptions, SaveTextFileOptions } from '../../platform/fileService';
import { DEFAULT_CREASE_COLOR_MODE } from '../../lib/sampleProject';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  cpSelectionSize,
  emptyOristudioCpSelection,
} from '../../lib/creasePatternViewport';
import {
  activeNativeDesign,
  createNativeBoxPleatProjectFile,
  createNativeCreasePatternProjectFile,
  createNativeProjectFile,
  createNativeTreeProjectFile,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../../lib/nativeProjectFile';
import { importedCpLineage } from '../../lib/oristudioCpLineage';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { createCpImage } from '../../cp-workspace/images/cpImage';
import {
  cpUserAnchorForLineIds,
  foldedFigureUserBounds,
} from '../../cp-workspace/adapters/cpFoldedToScene';
import type { TFunction } from 'i18next';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  isFoldedFigureStale,
  reselectFoldableLineIds,
} from '../../cp-workspace/folded/foldedFigureStaleness';
import {
  foldedFigureCurrentCase,
  foldedFigureFrontier,
} from '../../cp-workspace/folded/foldedFigureState';
import {
  deleteFoldedFigure,
  dismissFoldedFigureDetachedLayerOrder,
  setFoldedFigurePlacementAsEntry,
  showAnotherFoldedSolution,
  showPreviousFoldedSolution,
} from '../../cp-workspace/folded/foldedFigureVerbs';
import { endOpenCanvasSessions } from '../../cp-workspace/canvasObjects/canvasSessions';
import { solutionFrontierOf } from '../../cp-workspace/folded/foldedSolutionFrontiers';
import {
  FOLDED_FIGURE_LAYER_ORDERS_KEY,
  detachedFoldedFigureLayerOrders,
  foldedFigureRefoldKey,
  withFoldedFigureLayerOrders,
} from '../../cp-workspace/folded/foldedFigureLayerOrders';
import { resetFoldedFigureIds } from '../../cp-workspace/folded/foldedFigureIds';
import { foldedFigureNotice } from '../../cp-workspace/folded/foldedFigureNotice';
import { foldedFigureLayerOrder } from '../../lib/layerOrder/foldedFigureLayerOrder';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import { twoConstraintRecord } from '../../lib/layerOrder/layerOrderRecord.fixtures';
import type { LayerOrderApplied, LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import type { FoldedFigureLayerOrderRefold } from '../../cp-workspace/folded/foldedFigureLayerOrderState';
import { sayFoldedFigureLayerOrderRefold } from '../../cp-workspace/folded/foldedFigureLayerOrderToasts';
import { foldedFigureGesture } from '../../cp-workspace/folded/foldedFigureGesture';
import { layerOrderSourceOf } from '../../lib/layerOrder/layerOrderSource';
import type { LayerOrderResolution } from '../../layer-order/host/hostEngineGateway';
import {
  applyFoldedFigureLayerOrder,
  openFoldedFigureLayerOrder,
} from '../../cp-workspace/folded/openFoldedFigureLayerOrder';
import { markFoldPress } from '../../cp-workspace/folded/foldPress';
import { buildFoldedFigureActions, layerOrderCommand } from '../../cp-workspace/folded/foldedFigureActions';
import { buildFoldedFigureProperties } from '../../cp-workspace/folded/foldedFigureProperties';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { toast } from 'sonner';
import { foldedFigureOtherSideCamera } from '../../cp-workspace/folded/folded3dCamera';
import {
  foldedFigureHandleRefCount,
  releaseFoldedFigureHandle,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { cancelOristudioCamvRefresh } from './slices/projectSlice';
import {
  dropFolded3dRenderModel,
  folded3dRenderModel,
} from '../../cp-workspace/folded/folded3dRenderModels';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import { useLayoutStore } from '../layoutStore';
import { workspaceForPanelId } from '../../workspaces/workspaces';
import {
  handleShortcutRuntimeKeyDown,
  registerCpActionShortcutExecutor,
} from '../../keyboard/shortcutRuntime';
import { currentWorkspacePath } from '../../routing/landing';
import {
  registerCommandDialogHost,
  resolveCommandDialog,
  useCommandDialogStore,
} from '../commandDialogStore';

const engineMocks = vi.hoisted(() => ({
  createBlankTree: vi.fn(),
  createStarterTree: vi.fn(),
  ensureTreeHandle: vi.fn(),
  getEngine: vi.fn(),
  initializeBlankTree: vi.fn(),
  loadTreeFromText: vi.fn(),
}));

const oristudioCpMocks = vi.hoisted(() => ({
  createBlankOristudioCpDocument: vi.fn(),
  duplicateOristudioCpFoldedFigure: vi.fn(),
  executeOristudioCpCommand: vi.fn(),
  executeOristudioCpSelectionCommand: vi.fn(),
  exportOristudioCpDocumentAsCp: vi.fn(),
  exportOristudioCpDocumentAsFold: vi.fn(),
  exportOristudioCpLinesAsFold: vi.fn(),
  exportOristudioCpDocumentAsOri: vi.fn(),
  fetchOristudioCpSheetIndex: vi.fn(),
  exportOristudioCpDocumentAsOrh: vi.fn(),
  fold3dOristudioCpDocument: vi.fn(),
  fold3dOristudioCpFigureAnother: vi.fn(),
  duplicateOristudioCp3dFoldedFigure: vi.fn(),
  foldOristudioCpDocument: vi.fn(),
  foldOristudioCpFigureAnother: vi.fn(),
  foldOristudioCpFigureToCase: vi.fn(),
  foldOristudioCpWithOrder: vi.fn(),
  freeOristudioCpFoldedFigure: vi.fn(),
  getOristudioCpFoldedFigureDigest: vi.fn(),
  getOristudioCpFoldedFigurePaperScene: vi.fn(),
  getOristudioCpFoldedFigureRenderSnapshot: vi.fn(),
  getOristudioCpFoldedFigureSnapshot: vi.fn(),
  getOristudioCpFoldedFigureSource: vi.fn(),
  getOristudioCpSelectionFoldSource: vi.fn(),
  getOristudioCpOperationDescriptors: vi.fn(),
  insertOristudioCpLineSegments: vi.fn(),
  importAddOristudioCpDocumentFromText: vi.fn(),
  loadOristudioCpDocumentFromText: vi.fn(),
  previewOristudioCpCommand: vi.fn(),
  releaseOristudioCpDocument: vi.fn(),
  replaceOristudioCpLineSegments: vi.fn(),
  restoreOristudioCpDocument: vi.fn(),
  restoreOristudioCpDocumentInPlace: vi.fn(),
  runOristudioCpCheckCommand: vi.fn(),
  setOristudioCpDocumentSource: vi.fn(),
  setOristudioCpFoldedFigureModel: vi.fn(),
}));

const exportMocks = vi.hoisted(() => ({
  renderCreasePatternPng: vi.fn(async () => new Uint8Array([1, 2, 3])),
  serializeCreasePatternSvg: vi.fn(() => '<svg role="img"></svg>'),
  creaseExportGridSource: vi.fn(() => null),
  EMPTY_CREASE_EXPORT_CAPTION: { title: '', subtitle: '', description: '' },
  EMPTY_CREASE_EXPORT_CONTENT: { foldedFigure: null },
  DEFAULT_CREASE_EXPORT_OPTIONS: {
    segmentId: null,
    lineStyle: 'color',
    lineWidth: 1,
    pointSize: 0,
    includeUnassigned: true,
    showBackgroundColor: true,
    showGrid: false,
    theme: 'light',
    includeFoldedFigure: false,
    caption: { title: '', subtitle: '', description: '' },
  },
}));

const bpMocks = vi.hoisted(() => ({
  createSampleOristudioBpProject: vi.fn(),
  loadOristudioBpProjectFromText: vi.fn(),
  getOristudioBpPortDescriptors: vi.fn(),
  exportOristudioBpProjectAsBps: vi.fn(),
  exportOristudioBpProjectAsSessionBps: vi.fn(),
  optimizeOristudioBpLayout: vi.fn(),
}));

const analyticsMocks = vi.hoisted(() => ({ track: vi.fn() }));

/**
 * The Layer order host engine (H2), stood in for by default; `actual` is the
 * real gateway, for the test that watches which workers it starts.
 */
const hostEngineMocks = vi.hoisted(() => ({
  resolveLayerOrder: vi.fn(),
  actual: null as null | ((...args: never[]) => Promise<unknown>),
}));

vi.mock('../../layer-order/host/hostEngineGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../layer-order/host/hostEngineGateway')>();
  hostEngineMocks.actual = actual.resolveLayerOrder as never;
  return {
    ...actual,
    resolveLayerOrder: (...args: Parameters<typeof actual.resolveLayerOrder>) =>
      hostEngineMocks.resolveLayerOrder(...args),
  };
});

/** The Layer order dialog's one door (U4): its answer is the test's to give. */
const dialogGatewayMocks = vi.hoisted(() => ({ openLayerOrderDialog: vi.fn() }));

vi.mock('../../layer-order/dialog/layerOrderDialogGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../layer-order/dialog/layerOrderDialogGateway')>();
  return {
    ...actual,
    openLayerOrderDialog: (...args: Parameters<typeof actual.openLayerOrderDialog>) =>
      dialogGatewayMocks.openLayerOrderDialog(...args),
  };
});

vi.mock('../../lib/creaseExport', () => exportMocks);

// Folding is the one flow whose events are hand-placed: `G` reaches neither the
// `handleMenuAction` nor the `executeOristudioCpCommand` chokepoint, so nothing
// counts a fold unless these call sites do.
vi.mock('../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics')>();
  return {
    ...actual,
    track: analyticsMocks.track,
    // A typed wrapper over the runtime's `track`, which the line above can't reach.
    trackLayerConstraintsNeedAttention: (properties: Record<string, unknown>) =>
      analyticsMocks.track(actual.ANALYTICS_EVENTS.layerConstraintsNeedAttention, properties),
    trackLayerConstraintsDismissed: (properties: Record<string, unknown>) =>
      analyticsMocks.track(actual.ANALYTICS_EVENTS.layerConstraintsDismissed, properties),
  };
});

vi.mock('./engineRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./engineRuntime')>();
  return {
    ...actual,
    createBlankTree: engineMocks.createBlankTree,
    createStarterTree: engineMocks.createStarterTree,
    ensureTreeHandle: engineMocks.ensureTreeHandle,
    getEngine: engineMocks.getEngine,
    initializeBlankTree: engineMocks.initializeBlankTree,
    loadTreeFromText: engineMocks.loadTreeFromText,
  };
});

vi.mock('./oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioBpRuntime')>();
  return {
    ...actual,
    createSampleOristudioBpProject: bpMocks.createSampleOristudioBpProject,
    loadOristudioBpProjectFromText: bpMocks.loadOristudioBpProjectFromText,
    getOristudioBpPortDescriptors: bpMocks.getOristudioBpPortDescriptors,
    exportOristudioBpProjectAsBps: bpMocks.exportOristudioBpProjectAsBps,
    exportOristudioBpProjectAsSessionBps: bpMocks.exportOristudioBpProjectAsSessionBps,
    optimizeOristudioBpLayout: bpMocks.optimizeOristudioBpLayout,
  };
});

/**
 * The run id every fold wrapper now carries. Its *value* is the store's business
 * — minted per fold, never reused — so these assertions check that one was
 * passed at all, and `foldStop.test.ts` checks that it is the one a Stop names.
 */
const A_RUN_ID = expect.any(Number);

vi.mock('./oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioCpRuntime')>();
  return {
    ...actual,
    createBlankOristudioCpDocument: oristudioCpMocks.createBlankOristudioCpDocument,
    duplicateOristudioCpFoldedFigure: oristudioCpMocks.duplicateOristudioCpFoldedFigure,
    executeOristudioCpCommand: oristudioCpMocks.executeOristudioCpCommand,
    executeOristudioCpSelectionCommand: oristudioCpMocks.executeOristudioCpSelectionCommand,
    exportOristudioCpDocumentAsCp: oristudioCpMocks.exportOristudioCpDocumentAsCp,
    exportOristudioCpDocumentAsFold: oristudioCpMocks.exportOristudioCpDocumentAsFold,
    exportOristudioCpLinesAsFold: oristudioCpMocks.exportOristudioCpLinesAsFold,
    exportOristudioCpDocumentAsOri: oristudioCpMocks.exportOristudioCpDocumentAsOri,
    fetchOristudioCpSheetIndex: oristudioCpMocks.fetchOristudioCpSheetIndex,
    exportOristudioCpDocumentAsOrh: oristudioCpMocks.exportOristudioCpDocumentAsOrh,
    fold3dOristudioCpDocument: oristudioCpMocks.fold3dOristudioCpDocument,
    fold3dOristudioCpFigureAnother: oristudioCpMocks.fold3dOristudioCpFigureAnother,
    duplicateOristudioCp3dFoldedFigure: oristudioCpMocks.duplicateOristudioCp3dFoldedFigure,
    foldOristudioCpDocument: oristudioCpMocks.foldOristudioCpDocument,
    foldOristudioCpFigureAnother: oristudioCpMocks.foldOristudioCpFigureAnother,
    foldOristudioCpFigureToCase: oristudioCpMocks.foldOristudioCpFigureToCase,
    foldOristudioCpWithOrder: oristudioCpMocks.foldOristudioCpWithOrder,
    freeOristudioCpFoldedFigure: oristudioCpMocks.freeOristudioCpFoldedFigure,
    getOristudioCpFoldedFigureDigest: oristudioCpMocks.getOristudioCpFoldedFigureDigest,
    getOristudioCpFoldedFigurePaperScene: oristudioCpMocks.getOristudioCpFoldedFigurePaperScene,
    getOristudioCpFoldedFigureRenderSnapshot:
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot,
    getOristudioCpFoldedFigureSnapshot: oristudioCpMocks.getOristudioCpFoldedFigureSnapshot,
    getOristudioCpFoldedFigureSource: oristudioCpMocks.getOristudioCpFoldedFigureSource,
    getOristudioCpSelectionFoldSource: oristudioCpMocks.getOristudioCpSelectionFoldSource,
    getOristudioCpOperationDescriptors: oristudioCpMocks.getOristudioCpOperationDescriptors,
    insertOristudioCpLineSegments: oristudioCpMocks.insertOristudioCpLineSegments,
    importAddOristudioCpDocumentFromText: oristudioCpMocks.importAddOristudioCpDocumentFromText,
    loadOristudioCpDocumentFromText: oristudioCpMocks.loadOristudioCpDocumentFromText,
    previewOristudioCpCommand: oristudioCpMocks.previewOristudioCpCommand,
    releaseOristudioCpDocument: oristudioCpMocks.releaseOristudioCpDocument,
    replaceOristudioCpLineSegments: oristudioCpMocks.replaceOristudioCpLineSegments,
    restoreOristudioCpDocument: oristudioCpMocks.restoreOristudioCpDocument,
    restoreOristudioCpDocumentInPlace: oristudioCpMocks.restoreOristudioCpDocumentInPlace,
    runOristudioCpCheckCommand: oristudioCpMocks.runOristudioCpCheckCommand,
    setOristudioCpDocumentSource: oristudioCpMocks.setOristudioCpDocumentSource,
    setOristudioCpFoldedFigureModel: oristudioCpMocks.setOristudioCpFoldedFigureModel,
    // Every call that changes the document is mocked here and answers at once,
    // so no change is ever in flight and the store's snapshot is always the
    // kernel's. `cpSelectionCommands.wasm.test.ts` covers the in-flight case.
    isCurrentOristudioCpDocumentState: () => true,
  };
});

import { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { EngineClient } from './engineRuntime';
import { hasDeletableDiagramSelection, selectWorkspaceCapabilities } from './capabilities';
import { useWorkspaceStore } from './store';
import { cpStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';

type SnapshotOptions = Partial<
  Pick<
    TreeSnapshot,
    'nodes' | 'edges' | 'paths' | 'vertices' | 'creases' | 'facets' | 'conditions'
  >
> & {
  paper?: Partial<PaperSettings>;
  summary?: Partial<TreeSummary>;
};

const savedSnapshots = new Map<string, TreeSnapshot>();

const initialWorkspaceState = useWorkspaceStore.getInitialState();
const initialLayoutState = useLayoutStore.getInitialState();
const cpOperationDescriptors = [
  {
    id: 'DrawCreaseFree',
    upstream: 'MouseHandlerDrawCreaseFree',
    target: 'operations::construction::draw_crease_segment',
    category: 'Kernel',
    stage: 7,
    status: 'OracleTested',
    origin: 'Oriedita',
  },
] satisfies OristudioCpOperationDescriptor[];

function cloneSnapshot(snapshot: TreeSnapshot): TreeSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as TreeSnapshot;
}

function nodeSnapshot(
  id: number,
  loc = { x: id / 10, y: id / 10 },
  overrides: Partial<NodeSnapshot> = {}
): NodeSnapshot {
  return {
    id,
    label: `n${id}`,
    loc,
    is_leaf: id !== 1,
    is_pinned: false,
    is_conditioned: false,
    owner: 'Tree',
    ...overrides,
  };
}

function edgeSnapshot(
  id: number,
  nodes: [number, number],
  overrides: Partial<EdgeSnapshot> = {}
): EdgeSnapshot {
  return {
    id,
    label: `e${id}`,
    nodes,
    length: 1,
    strain: 0,
    stiffness: 1,
    is_conditioned: false,
    ...overrides,
  };
}

function pathSnapshot(id: number, nodes: [number, number]): PathSnapshot {
  return {
    id,
    nodes,
    is_leaf: true,
    is_active: true,
    is_feasible: true,
    is_border: false,
    is_polygon: false,
    is_conditioned: false,
  };
}

function nodeFixedCondition(node = 1): ConditionKind {
  return {
    type: 'node_fixed',
    node,
    x_fixed: true,
    y_fixed: false,
    x_fix_value: 0.25,
    y_fix_value: 0,
  };
}

function conditionSnapshot(index: number, kind = nodeFixedCondition()): ConditionSnapshot {
  return {
    index,
    is_feasible: true,
    kind,
  };
}

function makeSnapshot(options: SnapshotOptions = {}): TreeSnapshot {
  const paper: PaperSettings = {
    width: 1,
    height: 1,
    scale: 0.1,
    has_symmetry: false,
    sym_loc: { x: 0.5, y: 0.5 },
    sym_angle: 90,
    ...options.paper,
  };
  const nodes = options.nodes ?? [];
  const edges = options.edges ?? [];
  const paths = options.paths ?? [];
  const vertices = options.vertices ?? [];
  const creases = options.creases ?? [];
  const facets = options.facets ?? [];
  const conditions = options.conditions ?? [];
  const summary: TreeSummary = {
    scale: paper.scale,
    is_feasible: true,
    cp_status: creases.length > 0 ? 'built' : 'ok',
    nodes: nodes.length,
    edges: edges.length,
    paths: paths.length,
    vertices: vertices.length,
    creases: creases.length,
    facets: facets.length,
    leaf_nodes: nodes.filter((node) => node.is_leaf).length,
    conditions: conditions.length,
    conditioned_nodes: nodes.filter((node) => node.is_conditioned).length,
    conditioned_edges: edges.filter((edge) => edge.is_conditioned).length,
    conditioned_paths: paths.filter((path) => path.is_conditioned).length,
    ...options.summary,
  };
  return {
    summary,
    cp_status_report: {
      status: summary.cp_status,
      bad_edges: [],
      bad_polys: [],
      bad_vertices: [],
      bad_creases: [],
      bad_facets: [],
    },
    paper,
    nodes,
    edges,
    paths,
    vertices,
    creases,
    facets,
    conditions,
  };
}

function seedSnapshot(): TreeSnapshot {
  return makeSnapshot({
    nodes: [
      nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'root', is_leaf: false }),
      nodeSnapshot(2, { x: 0.2, y: 0.2 }, { label: 'tip' }),
    ],
    edges: [edgeSnapshot(1, [1, 2])],
    paths: [pathSnapshot(1, [1, 2])],
  });
}

function foldArtifactsFromSnapshot(snapshot: TreeSnapshot): FoldArtifacts {
  if (snapshot.vertices.length === 0 || snapshot.creases.length === 0 || snapshot.facets.length === 0) {
    throw { code: 'invalid_operation', message: 'build a crease pattern before exporting FOLD artifacts' };
  }

  const fold = {
    file_spec: 1.2,
    file_creator: 'store-test',
    frame_title: 'Test crease pattern',
    frame_classes: ['creasePattern'],
    vertices_coords: snapshot.vertices.map((vertex) => [vertex.loc.x, vertex.loc.y]),
    edges_vertices: snapshot.creases.map(
      (crease) => [crease.vertices[0] - 1, crease.vertices[1] - 1] as [number, number]
    ),
    edges_assignment: snapshot.creases.map(() => 'M' as const),
    edges_foldAngle: snapshot.creases.map(() => -180),
    faces_vertices: snapshot.facets.map((facet) => facet.vertices.map((vertex) => vertex - 1)),
  };

  return {
    fold,
    folded_base: {
      vertices: snapshot.vertices.map((vertex) => ({
        id: vertex.id,
        source_vertex: vertex.id,
        loc: vertex.loc,
        paper_loc: vertex.loc,
        depth: 0,
        elevation: 0,
        is_border: false,
      })),
      creases: snapshot.creases.map((crease) => ({
        id: crease.id,
        source_crease: crease.id,
        vertices: [crease.vertices[0], crease.vertices[1]] as [number, number],
        kind: crease.kind,
        fold: crease.fold,
      })),
      facets: snapshot.facets.map((facet) => ({
        id: facet.id,
        source_facet: facet.id,
        vertices: facet.vertices,
        color: facet.color,
        order: 0,
      })),
    },
    simulation_model: {
      fold,
      crease_params: [],
    },
  };
}

function foldArtifactsFromFold(fold: FoldDocument): FoldArtifacts {
  return {
    fold,
    folded_base: {
      vertices: fold.vertices_coords.map((coord, index) => ({
        id: index,
        source_vertex: index,
        loc: { x: coord[0] ?? 0, y: coord[1] ?? 0 },
        paper_loc: { x: coord[0] ?? 0, y: coord[1] ?? 0 },
        depth: 0,
        elevation: 0,
        is_border: fold.edges_vertices.some(
          (edge, edgeIndex) =>
            fold.edges_assignment?.[edgeIndex] === 'B' &&
            (edge[0] === index || edge[1] === index)
        ),
      })),
      creases: fold.edges_vertices.map((vertices, index) => ({
        id: index,
        source_crease: index,
        vertices,
        kind: 0,
        fold: fold.edges_assignment?.[index] === 'M' ? 1 : fold.edges_assignment?.[index] === 'V' ? 2 : 3,
      })),
      facets: fold.faces_vertices.map((vertices, index) => ({
        id: index,
        source_facet: index,
        vertices,
        color: index % 2 === 0 ? 1 : 2,
        order: index,
      })),
    },
    simulation_model:
      fold.faces_vertices.length > 0
        ? {
            fold,
            crease_params: [],
          }
        : null,
    simulation_model_error: fold.faces_vertices.length > 0 ? null : 'Simulation requires faces',
  };
}

const editableCpFoldText = JSON.stringify({
  file_spec: 1.2,
  frame_classes: ['creasePattern'],
  vertices_coords: [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [0, 2],
  ],
  edges_assignment: ['B', 'B', 'B', 'B', 'M'],
  edges_foldAngle: [null, null, null, null, -180],
  faces_vertices: [
    [0, 1, 2],
    [0, 2, 3],
  ],
});

/**
 * The sheet index the kernel would build for the unit square these tests draw
 * in: one sheet, holding every line of the open document whose midpoint lies in
 * it. `editableCpFoldText` is that sheet's FOLD.
 */
function unitSquareSheetIndex(): CpSheetIndex {
  const lines = useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.line_segments ?? [];
  const lineSheet = lines.map((line) => {
    const x = (line.a.x + line.b.x) / 2;
    const y = (line.a.y + line.b.y) / 2;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? 0 : -1;
  });
  return new CpSheetIndex({
    bounds: new Float64Array([0, 0, 1, 1]),
    outlineOffsets: new Uint32Array([0, 4]),
    outlineCoords: new Float64Array([0, 0, 1, 0, 1, 1, 0, 1]),
    lineCounts: new Uint32Array([lineSheet.filter((sheet) => sheet === 0).length]),
    lineSheet: new Int32Array(lineSheet),
  });
}

function nextId<T extends { id: number }>(items: T[]): number {
  return Math.max(0, ...items.map((item) => item.id)) + 1;
}

function deleteNodeFromSnapshot(snapshot: TreeSnapshot, deletedId: number): TreeSnapshot {
  const nodeMap = new Map<number, number>();
  snapshot.nodes.forEach((node) => {
    if (node.id !== deletedId) nodeMap.set(node.id, nodeMap.size + 1);
  });
  const nodes = snapshot.nodes
    .filter((node) => nodeMap.has(node.id))
    .map((node) => ({ ...node, id: nodeMap.get(node.id)! }));
  const edges = snapshot.edges
    .filter((edge) => edge.nodes.every((node) => nodeMap.has(node)))
    .map((edge, index) => ({
      ...edge,
      id: index + 1,
      nodes: edge.nodes.map((node) => nodeMap.get(node)!) as [number, number],
    }));
  const paths = snapshot.paths
    .filter((path) => path.nodes.every((node) => nodeMap.has(node)))
    .map((path, index) => ({
      ...path,
      id: index + 1,
      nodes: path.nodes.map((node) => nodeMap.get(node)!),
    }));
  return makeSnapshot({ ...snapshot, nodes, edges, paths });
}

function refreshMockTopology(snapshot: TreeSnapshot): TreeSnapshot {
  const degree = new Map(snapshot.nodes.map((node) => [node.id, 0]));
  for (const edge of snapshot.edges) {
    degree.set(edge.nodes[0], (degree.get(edge.nodes[0]) ?? 0) + 1);
    degree.set(edge.nodes[1], (degree.get(edge.nodes[1]) ?? 0) + 1);
  }
  const nodes = snapshot.nodes.map((node) => ({
    ...node,
    is_leaf: snapshot.nodes.length > 1 && (degree.get(node.id) ?? 0) <= 1,
  }));
  const leafIds = new Set(nodes.filter((node) => node.is_leaf).map((node) => node.id));
  const conditions = snapshot.conditions
    .filter((condition) => {
      switch (condition.kind.type) {
        case 'node_symmetric':
          return leafIds.has(condition.kind.node);
        case 'nodes_paired':
          return leafIds.has(condition.kind.node1) && leafIds.has(condition.kind.node2);
        default:
          return true;
      }
    })
    .map((condition, index) => ({ ...condition, index: index + 1 }));
  return makeSnapshot({ ...snapshot, nodes, conditions });
}

function createMockEngineApi(initialSnapshot: TreeSnapshot) {
  let snapshotState = cloneSnapshot(initialSnapshot);
  let saveCount = 0;
  let nextConditionId = Math.max(0, ...snapshotState.conditions.map((condition) => condition.index)) + 1;

  const setSnapshot = (snapshot: TreeSnapshot) => {
    snapshotState = cloneSnapshot(snapshot);
    return cloneSnapshot(snapshotState);
  };

  const api = {
    replaceSnapshot: setSnapshot,
    get snapshotState() {
      return cloneSnapshot(snapshotState);
    },
    newDesign: vi.fn(async () => 1),
    loadTmd: vi.fn(async () => 1),
    freeTree: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => cloneSnapshot(snapshotState)),
    saveTmd5: vi.fn(async () => {
      const text = `saved-${++saveCount}`;
      savedSnapshots.set(text, cloneSnapshot(snapshotState));
      return text;
    }),
    exportV4: vi.fn(async () => 'exported-v4'),
    exportFold: vi.fn(async () => JSON.stringify(foldArtifactsFromSnapshot(snapshotState).fold)),
    foldArtifacts: vi.fn(async () => foldArtifactsFromSnapshot(snapshotState)),
    flatFoldArtifacts: vi.fn(async (foldJson: string) =>
      foldArtifactsFromFold(JSON.parse(foldJson) as FoldDocument)
    ),
    optimizeScale: vi.fn(async (): Promise<OptimizationReport> => {
      const oldScale = snapshotState.paper.scale;
      snapshotState = makeSnapshot({
        ...snapshotState,
        paper: { ...snapshotState.paper, scale: oldScale + 0.05 },
        summary: { ...snapshotState.summary, is_feasible: true },
      });
      return {
        kind: 'scale',
        converged: true,
        old_scale: oldScale,
        new_scale: snapshotState.paper.scale,
        is_feasible: true,
        message: 'scale optimized',
      };
    }),
    optimizeEdges: vi.fn(async (): Promise<OptimizationReport> => ({
      kind: 'edges',
      converged: true,
      old_scale: snapshotState.paper.scale,
      new_scale: snapshotState.paper.scale,
      is_feasible: true,
      message: 'edges optimized',
    })),
    optimizeStrain: vi.fn(async (): Promise<OptimizationReport> => ({
      kind: 'strain',
      converged: true,
      old_scale: snapshotState.paper.scale,
      new_scale: snapshotState.paper.scale,
      is_feasible: true,
      message: 'strain optimized',
    })),
    buildCreasePattern: vi.fn(async () => {
      snapshotState = makeSnapshot({
        ...snapshotState,
        vertices: [
          { id: 1, loc: { x: 0, y: 0 } },
          { id: 2, loc: { x: 1, y: 0 } },
          { id: 3, loc: { x: 1, y: 1 } },
        ],
        creases: [{ id: 1, kind: 0, vertices: [1, 2], fold: 3 }],
        facets: [{ id: 1, vertices: [1, 2, 3], color: 1 }],
      });
      return cloneSnapshot(snapshotState);
    }),
    applyEdit: vi.fn(async (_handle: number, edit: TreeEdit): Promise<EditReport> => {
      let createdNode: number | undefined;
      let createdEdge: number | undefined;

      switch (edit.type) {
        case 'add_node': {
          createdNode = nextId(snapshotState.nodes);
          const nodes = [
            ...snapshotState.nodes,
            nodeSnapshot(createdNode, edit.loc, { label: edit.label ?? `n${createdNode}` }),
          ];
          const edges = [...snapshotState.edges];
          if (edit.connect_to !== undefined) {
            createdEdge = nextId(edges);
            edges.push(
              edgeSnapshot(createdEdge, [edit.connect_to, createdNode], {
                length: edit.edge_length ?? 1,
              })
            );
          }
          snapshotState = refreshMockTopology(makeSnapshot({ ...snapshotState, nodes, edges }));
          break;
        }
        case 'move_node':
          snapshotState = makeSnapshot({
            ...snapshotState,
            nodes: snapshotState.nodes.map((node) =>
              node.id === edit.id ? { ...node, loc: edit.loc } : node
            ),
          });
          break;
        case 'delete_node':
          snapshotState = refreshMockTopology(deleteNodeFromSnapshot(snapshotState, edit.id));
          break;
        case 'update_node_label':
          snapshotState = makeSnapshot({
            ...snapshotState,
            nodes: snapshotState.nodes.map((node) =>
              node.id === edit.id ? { ...node, label: edit.label } : node
            ),
          });
          break;
        case 'add_edge':
          createdEdge = nextId(snapshotState.edges);
          snapshotState = refreshMockTopology(makeSnapshot({
            ...snapshotState,
            edges: [
              ...snapshotState.edges,
              edgeSnapshot(createdEdge, [edit.node1, edit.node2], {
                label: edit.label ?? `e${createdEdge}`,
                length: edit.length ?? 1,
              }),
            ],
          }));
          break;
        case 'delete_edge':
          snapshotState = refreshMockTopology(makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.filter((edge) => edge.id !== edit.id),
          }));
          break;
        case 'update_edge':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) =>
              edge.id === edit.id
                ? {
                    ...edge,
                    label: edit.label ?? edge.label,
                    length: edit.length ?? edge.length,
                    strain: edit.strain ?? edge.strain,
                    stiffness: edit.stiffness ?? edge.stiffness,
                  }
                : edge
            ),
          });
          break;
        case 'update_paper':
          snapshotState = makeSnapshot({
            ...snapshotState,
            paper: {
              ...snapshotState.paper,
              width: edit.width,
              height: edit.height,
              scale: edit.scale ?? snapshotState.paper.scale,
            },
          });
          break;
        case 'set_symmetry':
          snapshotState = makeSnapshot({
            ...snapshotState,
            paper: {
              ...snapshotState.paper,
              has_symmetry: edit.has_symmetry,
              sym_loc: edit.sym_loc ?? snapshotState.paper.sym_loc,
              sym_angle: edit.sym_angle ?? snapshotState.paper.sym_angle,
            },
          });
          break;
        case 'add_condition':
          snapshotState = makeSnapshot({
            ...snapshotState,
            conditions: [
              ...snapshotState.conditions,
              { index: nextConditionId++, is_feasible: true, kind: edit.kind },
            ],
          });
          break;
        case 'update_condition':
          snapshotState = makeSnapshot({
            ...snapshotState,
            conditions: snapshotState.conditions.map((condition) =>
              condition.index === edit.id ? { ...condition, kind: edit.kind } : condition
            ),
          });
          break;
        case 'delete_condition':
          snapshotState = makeSnapshot({
            ...snapshotState,
            conditions: snapshotState.conditions.filter((condition) => condition.index !== edit.id),
          });
          break;
        case 'make_root':
          snapshotState = makeSnapshot({
            ...snapshotState,
            nodes: snapshotState.nodes.map((node) =>
              node.id === edit.node ? { ...node, id: 1 } : { ...node, id: node.id + 1 }
            ),
          });
          break;
        case 'split_edge': {
          const edge = snapshotState.edges.find((candidate) => candidate.id === edit.edge);
          if (!edge) break;
          createdNode = nextId(snapshotState.nodes);
          createdEdge = nextId(snapshotState.edges);
          const newNode = createdNode;
          const newEdge = createdEdge;
          snapshotState = refreshMockTopology(makeSnapshot({
            ...snapshotState,
            nodes: [
              ...snapshotState.nodes,
              nodeSnapshot(newNode, { x: 0.5, y: 0.5 }),
            ],
            edges: [
              ...snapshotState.edges.map((candidate) =>
                candidate.id === edit.edge
                  ? { ...candidate, nodes: [candidate.nodes[0], newNode], length: edit.distance }
                  : candidate
              ),
              edgeSnapshot(newEdge, [newNode, edge.nodes[1]], { length: edge.length - edit.distance }),
            ],
          }));
          break;
        }
        case 'set_edge_lengths':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) =>
              edit.edges.includes(edge.id) ? { ...edge, length: edit.length, strain: 0 } : edge
            ),
          });
          break;
        case 'scale_edge_lengths':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) =>
              edit.edges.includes(edge.id) ? { ...edge, length: edge.length * edit.factor } : edge
            ),
          });
          break;
        case 'renormalize_to_edge': {
          const edge = snapshotState.edges.find((candidate) => candidate.id === edit.edge);
          const factor = edge ? 1 / edge.length : 1;
          snapshotState = makeSnapshot({
            ...snapshotState,
            paper: { ...snapshotState.paper, scale: snapshotState.paper.scale / factor },
            edges: snapshotState.edges.map((candidate) => ({
              ...candidate,
              length: candidate.length * factor,
            })),
          });
          break;
        }
        case 'renormalize_to_unit_scale':
          snapshotState = makeSnapshot({
            ...snapshotState,
            paper: { ...snapshotState.paper, scale: 1 },
            edges: snapshotState.edges.map((edge) => ({
              ...edge,
              length: edge.length * snapshotState.paper.scale,
            })),
          });
          break;
        case 'absorb_nodes':
        case 'absorb_redundant_nodes':
        case 'absorb_edges':
          snapshotState = makeSnapshot({ ...snapshotState });
          break;
        case 'perturb_nodes':
          snapshotState = makeSnapshot({
            ...snapshotState,
            nodes: snapshotState.nodes.map((node) =>
              edit.nodes.includes(node.id)
                ? { ...node, loc: { x: node.loc.x + 0.01, y: node.loc.y + 0.01 } }
                : node
            ),
          });
          break;
        case 'perturb_all_nodes':
          snapshotState = makeSnapshot({
            ...snapshotState,
            nodes: snapshotState.nodes.map((node) => ({
              ...node,
              loc: { x: node.loc.x + 0.01, y: node.loc.y + 0.01 },
            })),
          });
          break;
        case 'remove_strain':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) =>
              edit.edges.includes(edge.id) ? { ...edge, strain: 0 } : edge
            ),
          });
          break;
        case 'remove_all_strain':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) => ({ ...edge, strain: 0 })),
          });
          break;
        case 'relieve_strain':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) =>
              edit.edges.includes(edge.id)
                ? { ...edge, length: edge.length * (1 + edge.strain), strain: 0 }
                : edge
            ),
          });
          break;
        case 'relieve_all_strain':
          snapshotState = makeSnapshot({
            ...snapshotState,
            edges: snapshotState.edges.map((edge) => ({
              ...edge,
              length: edge.length * (1 + edge.strain),
              strain: 0,
            })),
          });
          break;
        case 'add_largest_stub_for_nodes':
        case 'add_largest_stub_for_poly':
        case 'triangulate_tree':
          throw { code: 'unsupported_operation', message: 'Stub finder port is pending' };
      }

      return {
        snapshot: cloneSnapshot(snapshotState),
        created_node: createdNode,
        created_edge: createdEdge,
      };
    }),
  };

  return api;
}

type TestEngineApi = ReturnType<typeof createMockEngineApi>;

function configureEngine(api: TestEngineApi) {
  const engine = api as unknown as EngineClient;
  engineMocks.getEngine.mockReset().mockResolvedValue(engine);
  engineMocks.ensureTreeHandle.mockReset().mockResolvedValue({ api: engine, treeHandle: 1 });
  engineMocks.initializeBlankTree.mockReset().mockImplementation(async () => api.snapshot());
  engineMocks.createBlankTree.mockReset().mockImplementation(async () => {
    const snapshot = makeSnapshot();
    api.replaceSnapshot(snapshot);
    return cloneSnapshot(snapshot);
  });
  engineMocks.createStarterTree.mockReset().mockImplementation(async () => {
    const snapshot = seedSnapshot();
    api.replaceSnapshot(snapshot);
    return cloneSnapshot(snapshot);
  });
  engineMocks.loadTreeFromText.mockReset().mockImplementation(async (_engine: EngineClient, text: string) => {
    const snapshot = savedSnapshots.get(text) ?? api.snapshotState;
    api.replaceSnapshot(snapshot);
    return cloneSnapshot(snapshot);
  });
}

function loadSnapshotIntoStore(snapshot: TreeSnapshot, title = 'Seed project') {
  // A loaded tree claims the design, exactly as `loadText` does in production —
  // `singleTreemakerDesignTab` installs the kind and the tree together.
  useWorkspaceStore.setState({
      ...singleTreemakerDesignTab({
    project: projectFromSnapshot(snapshot, title),
    lastOptimization: null,
    viewportFitRequestId: 0,
    historyPast: [],
    historyFuture: [],
    selection: { kind: 'tree' },
    toolMode: 'select',
    symmetryAuthoringPairs: []
      }),
    importedCreasePattern: null,
    oristudioCpDocument: null,
    oristudioCpOperationDescriptors: [],
    oristudioCpError: null,
    oristudioCpCamvResult: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    projectLoadId: useWorkspaceStore.getState().projectLoadId + 1,
    currentFileName: 'seed.tmd5',
    currentFilePath: null,
    projectMessage: null,
    status: snapshot.creases.length > 0 ? 'crease_pattern_ready' : 'optimized',
    dirty: false,
    engineReady: true,
    error: null,
    clipboard: null,
    clipboardPasteCount: 0,
    creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    foldArtifacts: null,
    foldArtifactError: null});
}

function sampleBpDocument(): import('../../engine/oristudioBpTypes').OristudioBpDocumentState {
  // Only the fields read by the BP slice are needed; the rest are irrelevant to
  // these store-level tests, so a minimal cast keeps the fixture small.
  return {
    workflowTarget: 'box-pleat',
    kind: 'box-pleat-project',
    handle: 9,
    source: { format: 'generated', filename: 'Untitled.bps', path: null },
    activeSurface: 'tree',
    dirty: true,
    // The slice centres the default symmetry axis on the tree sheet on load,
    // titles the replaced project from the summary, and resolves optimizer
    // symmetry against the tree, so the fixture needs a sheet, a title, and a
    // small tree. Leaves 1 and 2 are mirror images across the sheet centre.
    snapshot: {
      summary: { title: 'Sample BP' },
      tree: {
        sheet: { width: 20, height: 20 },
        vertices: [
          { id: 0, name: 'root', loc: { x: 10, y: 10 }, isLeaf: false },
          { id: 1, name: 'a', loc: { x: 6, y: 10 }, isLeaf: true },
          { id: 2, name: 'b', loc: { x: 14, y: 10 }, isLeaf: true },
        ],
        edges: [
          { id: 0, vertices: [0, 1], length: 4 },
          { id: 1, vertices: [0, 2], length: 4 },
        ],
      },
    },
  } as import('../../engine/oristudioBpTypes').OristudioBpDocumentState;
}

function blankCpDocumentState(): OristudioCpDocumentState {
  const document = createStarterOristudioCpDocument();
  return {
    handle: 4,
    loadSerial: 1,
    document,
    geometry: null,
    summary: {
      title: 'Untitled CP',
      line_segments: document.crease_pattern.line_segments.length,
      circles: 0,
      points: 0,
      aux_line_segments: 0,
      texts: 0,
      can_save_as_cp: true,
      is_empty: false,
    },
    source: {
      format: 'cp',
      filename: 'Untitled.cp',
      path: null,
    },
    operationDescriptors: cpOperationDescriptors,
    lastCommandResult: null,
  };
}

function cpLine(
  a: { x: number; y: number },
  b: { x: number; y: number },
  overrides: Partial<OristudioCpLineSegment> = {}
): OristudioCpLineSegment {
  return {
    a,
    b,
    color: 'Red1',
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...overrides,
  };
}

function editableCpState(lines: OristudioCpLineSegment[]): OristudioCpDocumentState {
  const base = blankCpDocumentState();
  return {
    ...base,
    document: {
      ...base.document,
      crease_pattern: {
        ...base.document.crease_pattern,
        line_segments: lines,
      },
    },
    summary: {
      ...base.summary,
      line_segments: lines.length,
      is_empty: lines.length === 0,
    },
  };
}

/**
 * Make the next `insertOristudioCpLineSegments` append to the live document
 * rather than returning the blank one the default mock hands back. Needed by
 * any test that reads the document *after* an edit — folded-figure staleness
 * reselects creases from it, so a blank document would look like "every crease
 * deleted".
 */
function insertAppendsToDocument(): void {
  oristudioCpMocks.insertOristudioCpLineSegments.mockImplementationOnce(
    async (segments: OristudioCpLineSegment[]) =>
      editableCpState([
        ...(useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern
          .line_segments ?? []),
        ...segments,
      ])
  );
}

/** Let the fire-and-forget reconcile chain drain. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function inlineSimulationFixture(): InlineSimulation {
  return {
    id: 'inline-sim-1',
    box: { center: { x: 0, y: 0 }, width: 100, height: 100, rotation: 0 },
    z: 1,
    view: { yaw: 0, pitch: 0, zoom: 1 },
    sourceBoundary: null,
    sourceBounds: null,
    sourceFingerprint: null,
    segmentIdHint: null,
  };
}

/** The two creases the Layer order tests fold: an X, mountain and valley. */
const LAYER_ORDER_LINES: OristudioCpLineSegment[] = [
  cpLine({ x: 0, y: 0 }, { x: 1, y: 1 }),
  cpLine({ x: 1, y: 0 }, { x: 0, y: 1 }, { color: 'Blue2' }),
];

/** The face-ring digest the kernel answers for {@link LAYER_ORDER_LINES}. */
const LAYER_ORDER_DIGEST = '00000000c0ffee01';

/** What the kernel answers a figure folded from {@link LAYER_ORDER_LINES} was folded from. */
function layerOrderKernelSource(): OristudioCpFoldSource {
  return { segments: LAYER_ORDER_LINES, starting_face_id: 1, aux_segments: [], digest: LAYER_ORDER_DIGEST };
}

function foldedFigureSnapshot(): OristudioCpFoldedFigureSnapshot {
  return {
    model: {
      front_color: { red: 255, green: 255, blue: 50 },
      back_color: { red: 233, green: 233, blue: 233 },
      line_color: { red: 0, green: 0, blue: 0 },
      scale: 1,
      rotation: 0,
      anti_alias: true,
      display_shadows: false,
      state: 'Front0',
      folded_cases: 1,
      transparent_transparency: 16,
      transparency_color: false,
    },
    estimation_step: 'Step5',
    display_style: 'Paper5',
    discovered_fold_cases: 1,
    find_another_overlap_valid: false,
    text_result: 'Number of found solutions = 1  ',
    wireframe: {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
      ],
      lines: [
        { begin: 0, end: 1, color: 'Black0' },
        { begin: 1, end: 2, color: 'Red1' },
      ],
      faces: [[0, 1, 2]],
      starting_face: 0,
      face_positions: [1],
      next_faces: [null],
      associated_lines: [null],
    },
  };
}

/**
 * The smallest render model that draws: one triangular face, one plane, one
 * cell whose stack is that face, no edges.
 *
 * Real enough to build a picture from — the store runs the scene producer for
 * real, with no mock in between, so a route that reached it would produce a
 * genuinely empty picture if this were fabricated badly.
 */
function folded3dRenderModelFixture(): OristudioCpFolded3dRenderModel {
  const triangle = [0, 0, 0, 100, 0, 0, 0, 100, 0];
  return {
    schema_version: 1,
    span: 400,
    face_count: 1,
    plane_count: 1,
    cell_count: 1,
    edge_count: 0,
    ring_points: [...triangle],
    // [plane, ring_start, ring_len, facing]
    face_attr: [0, 0, 3, 0],
    face_normals: [0, 0, 1],
    // up(3), origin(3), u(3), v(3)
    plane_frames: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0],
    cell_points: [...triangle],
    // [plane, ring_start, ring_len, stack_start, stack_len, determinacy, draw_rank]
    cell_attr: [0, 0, 3, 0, 1, 0, 0],
    cell_stack: [0],
    edge_points: [],
    edge_attr: [],
    edge_fold_degrees: [],
    undetermined_cells: 0,
  };
}

function folded3dSnapshot(
  overrides: Partial<OristudioCpFolded3dSnapshot> = {}
): OristudioCpFolded3dSnapshot {
  return {
    schema_version: 1,
    model: foldedFigureSnapshot().model,
    discovered_fold_cases: 1,
    current_fold_case: 1,
    find_another_overlap_valid: false,
    has_next_solution: false,
    verdict: { verdict: 'folded' },
    diagnostics: {
      tolerances: {
        angle_radians: 1e-7,
        distance_relative: 1e-6,
        flat_snap_degrees: 1e-6,
        overlap_area_relative: 1e-9,
      },
      span: 400,
      snapped_creases: 0,
      spatial_vertices: 1,
      worst_closure_residual_degrees: 0,
      loop_gap_radians: 0,
      loop_gap_offset_relative: 0,
      loop_gap_non_tree_edges: 1,
      worst_vertex_cycle_radians: 0,
      vertex_cycles: 1,
      local_crossings: [],
      local_crossing_count: 0,
      separation_bins: [0, 0, 0, 0, 0],
      worst_intra_normal_radians: 0,
      worst_intra_offset_relative: 0,
      min_inter_separation_relative: null,
      tolerance_alarms: 0,
    },
    census: {
      plane_count: 1,
      patch_count: 1,
      face_count: 1,
      overlapping_pair_count: 0,
      non_adjacent_pair_count: 0,
      faces_in_overlap: 0,
      full_fold_creases: 0,
      full_fold_pairs: 0,
      min_accepted_area_relative: null,
      max_rejected_area_relative: 0,
      cell_count: 1,
      subface_count: 1,
    },
    planes: [],
    components: [],
    undetermined_pairs: 0,
    undetermined_cells: 0,
    couplings: 0,
    crossings: [],
    crossing_count: 0,
    ...overrides,
  };
}

/** A placed 3D fold result, optionally carrying a non-`folded` verdict. */
function folded3dPlaced(handle = 11, verdict?: OristudioCpFold3dVerdict) {
  return {
    status: 'placed' as const,
    handle,
    snapshot: folded3dSnapshot(verdict ? { verdict } : {}),
    render: folded3dRenderModelFixture(),
  };
}

function foldedRenderSnapshot(): OristudioCpFoldedRenderSnapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: 'paper-front-full',
    primitives: [
      {
        sequence: 0,
        kind: 'fill_path',
        style: {
          paint: { kind: 'color', color: { red: 255, green: 255, blue: 50, alpha: 255 } },
          stroke: { kind: 'basic', width: 1, end_cap: 2, line_join: 0, miter_limit: 10 },
          antialias: 'off',
        },
        geometry: {
          kind: 'path',
          commands: [
            { command: 'move_to', point: { x: 20, y: 20 } },
            { command: 'line_to', point: { x: 40, y: 20 } },
            { command: 'line_to', point: { x: 20, y: 40 } },
            { command: 'close' },
          ],
        },
      },
    ],
  };
}

function resetStores(snapshot = makeSnapshot()) {
  localStorage.clear();
  savedSnapshots.clear();
  analyticsMocks.track.mockReset();
  // Handle ownership is module-level; isolate it between tests.
  resetFoldedFigureHandles();
  // So is the debounced CAMV refresh. One an edit in an earlier test left
  // pending would run against this test's document when its 120ms come round,
  // and replace the CAMV result the test seeded with the mock's empty one.
  cancelOristudioCamvRefresh();
  useWorkspaceStore.setState(initialWorkspaceState, true);
  useLayoutStore.setState(initialLayoutState, true);
  const api = createMockEngineApi(snapshot);
  configureEngine(api);
  bpMocks.createSampleOristudioBpProject.mockReset().mockImplementation(async () => sampleBpDocument());
  bpMocks.loadOristudioBpProjectFromText.mockReset().mockImplementation(async () => sampleBpDocument());
  bpMocks.getOristudioBpPortDescriptors.mockReset().mockResolvedValue([]);
  bpMocks.exportOristudioBpProjectAsBps
    .mockReset()
    .mockResolvedValue('{"title":"Untitled","tree":{}}');
  bpMocks.exportOristudioBpProjectAsSessionBps
    .mockReset()
    .mockResolvedValue('{"title":"Untitled","tree":{}}');
  bpMocks.optimizeOristudioBpLayout.mockReset();
  oristudioCpMocks.getOristudioCpOperationDescriptors
    .mockReset()
    .mockResolvedValue(cpOperationDescriptors);
  oristudioCpMocks.createBlankOristudioCpDocument
    .mockReset()
    .mockImplementation(async () => blankCpDocumentState());
  oristudioCpMocks.releaseOristudioCpDocument.mockReset().mockResolvedValue(undefined);
  oristudioCpMocks.exportOristudioCpDocumentAsCp
    .mockReset()
    .mockResolvedValue('1 0 0 1 0\n');
  oristudioCpMocks.exportOristudioCpDocumentAsFold
    .mockReset()
    .mockResolvedValue(editableCpFoldText);
  // The kernel's sheet index and one sheet's lines, for the same unit square.
  oristudioCpMocks.fetchOristudioCpSheetIndex.mockReset().mockImplementation(async () => unitSquareSheetIndex());
  oristudioCpMocks.exportOristudioCpLinesAsFold.mockReset().mockResolvedValue(editableCpFoldText);
  oristudioCpMocks.exportOristudioCpDocumentAsOri
    .mockReset()
    .mockResolvedValue('{"@version":"v1.1","title":"square"}\n');
  oristudioCpMocks.exportOristudioCpDocumentAsOrh
    .mockReset()
    .mockResolvedValue('<タイトル>\nタイトル,square\n');
  oristudioCpMocks.foldOristudioCpDocument
    .mockReset()
    .mockResolvedValue({ handle: 7, snapshot: foldedFigureSnapshot() });
  // A 3D fold that places, by default: a refusal is what a test opts into, not
  // what it gets for forgetting to say.
  oristudioCpMocks.fold3dOristudioCpDocument.mockReset().mockResolvedValue(folded3dPlaced());
  oristudioCpMocks.fold3dOristudioCpFigureAnother.mockReset().mockResolvedValue({
    snapshot: folded3dSnapshot({ discovered_fold_cases: 2, current_fold_case: 2 }),
    render: folded3dRenderModelFixture(),
    advanced: true,
  });
  oristudioCpMocks.duplicateOristudioCp3dFoldedFigure
    .mockReset()
    .mockResolvedValue(folded3dPlaced(12));
  // Default: no flat-foldability violations, so the pre-fold warning gate folds
  // straight through. Reset here so its call count / queued results don't leak
  // between tests now that folding runs CheckCamv up front.
  oristudioCpMocks.runOristudioCpCheckCommand
    .mockReset()
    .mockResolvedValue({
      operation: 'CheckCamv',
      status: 'OracleTested',
      diagnostics: [],
      diagnostic_entries: [],
    });
  oristudioCpMocks.foldOristudioCpFigureAnother
    .mockReset()
    .mockResolvedValue({ ...foldedFigureSnapshot(), discovered_fold_cases: 2 });
  oristudioCpMocks.foldOristudioCpFigureToCase
    .mockReset()
    .mockResolvedValue({
      snapshot: { ...foldedFigureSnapshot(), discovered_fold_cases: 3 },
      discovered_case_numbers: [1, 2, 3],
    });
  oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot
    .mockReset()
    .mockResolvedValue(foldedRenderSnapshot());
  oristudioCpMocks.setOristudioCpFoldedFigureModel
    .mockReset()
    .mockImplementation(async (_handle: number, model: OristudioCpFoldedFigureSnapshot['model']) => ({
      ...foldedFigureSnapshot(),
      model,
    }));
  oristudioCpMocks.duplicateOristudioCpFoldedFigure
    .mockReset()
    .mockResolvedValue({ handle: 8, snapshot: foldedFigureSnapshot() });
  oristudioCpMocks.freeOristudioCpFoldedFigure.mockReset().mockResolvedValue(undefined);
  // The Layer order calls (H3): a fold with a given order lands, on its
  // source's faces; the source and the paper scene are the test's to say.
  oristudioCpMocks.foldOristudioCpWithOrder.mockReset().mockResolvedValue({
    status: 'folded',
    handle: 9,
    snapshot: { ...foldedFigureSnapshot(), outcome: 'Solved', shown_order: 'given' },
  });
  oristudioCpMocks.getOristudioCpFoldedFigureDigest.mockReset().mockResolvedValue(LAYER_ORDER_DIGEST);
  oristudioCpMocks.getOristudioCpFoldedFigurePaperScene.mockReset().mockResolvedValue(null);
  oristudioCpMocks.getOristudioCpFoldedFigureSource.mockReset().mockResolvedValue(layerOrderKernelSource());
  // The kernel shows what the figure on that handle says, unless a test says otherwise.
  oristudioCpMocks.getOristudioCpFoldedFigureSnapshot.mockReset().mockImplementation(async (handle: number) => {
    const shown = useWorkspaceStore.getState().oristudioCpFoldedFigures.find((figure) => figure.handle === handle);
    return shown?.snapshot ?? foldedFigureSnapshot();
  });
  oristudioCpMocks.getOristudioCpSelectionFoldSource.mockReset().mockResolvedValue(layerOrderKernelSource());
  hostEngineMocks.resolveLayerOrder.mockReset();
  dialogGatewayMocks.openLayerOrderDialog.mockReset().mockResolvedValue({ kind: 'cancelled' });
  oristudioCpMocks.setOristudioCpDocumentSource.mockReset();
  oristudioCpMocks.loadOristudioCpDocumentFromText
    .mockReset()
    .mockImplementation(async (_text: string, source: { format: 'cp' | 'fold' | 'ori' | 'orh'; filename: string; path?: string | null; title?: string }) => ({
      handle: 2,
      loadSerial: 1,
      document: {
        title: source.title ?? (source.format === 'ori' ? 'native ori' : source.format === 'orh' ? 'orh model' : 'square'),
        crease_pattern: {
          line_segments: [],
          circles: [],
          points: [],
          aux_line_segments: [],
          texts: [],
          grid: {
            interval_grid_size: 4,
            grid_size: 8,
            grid_xa: 1,
            grid_xb: 0,
            grid_xc: 1,
            grid_ya: 1,
            grid_yb: 0,
            grid_yc: 1,
            grid_angle: 90,
            base_state: 'WithinPaper',
            vertical_scale_position: 0,
            horizontal_scale_position: 0,
            draw_diagonal_gridlines: false,
          },
        },
        metadata: {},
      },
      summary: {
        title: source.title ?? (source.format === 'ori' ? 'native ori' : source.format === 'orh' ? 'orh model' : 'square'),
        line_segments: 5,
        circles: 0,
        points: 0,
        aux_line_segments: 0,
        texts: 0,
        can_save_as_cp: true,
        is_empty: false,
      },
      source: {
        format: source.format,
        filename: source.filename,
        path: source.path ?? null,
      },
      operationDescriptors: cpOperationDescriptors,
      lastCommandResult: null,
    }));
  oristudioCpMocks.importAddOristudioCpDocumentFromText
    .mockReset()
    .mockImplementation(async () =>
      editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })])
    );
  oristudioCpMocks.restoreOristudioCpDocument
    .mockReset()
    .mockImplementation(
      async (
        document: OristudioCpDocumentSnapshot,
        source: OristudioCpDocumentState['source']
      ) => ({
        handle: 3,
        loadSerial: 2,
        document,
        summary: {
          title: document.title ?? 'square',
          line_segments: document.crease_pattern.line_segments.length,
          circles: document.crease_pattern.circles.length,
          points: document.crease_pattern.points.length,
          aux_line_segments: document.crease_pattern.aux_line_segments.length,
          texts: document.crease_pattern.texts.length,
          can_save_as_cp: true,
          is_empty:
            document.crease_pattern.line_segments.length +
              document.crease_pattern.circles.length +
              document.crease_pattern.points.length +
              document.crease_pattern.aux_line_segments.length +
              document.crease_pattern.texts.length ===
            0,
        },
        source,
        operationDescriptors: cpOperationDescriptors,
        lastCommandResult: null,
      })
    );
  oristudioCpMocks.restoreOristudioCpDocumentInPlace
    .mockReset()
    .mockImplementation(
      async (
        document: OristudioCpDocumentSnapshot,
        source?: OristudioCpDocumentState['source'],
        lastCommandResult: OristudioCpCommandResult | null = null
      ) => {
        // In-place restore keeps the current handle and load serial: only the
        // document content changes.
        const current = useWorkspaceStore.getState().oristudioCpDocument;
        return {
          handle: current?.handle ?? 3,
          loadSerial: current?.loadSerial ?? 1,
          document,
          summary: {
            title: document.title ?? 'square',
            line_segments: document.crease_pattern.line_segments.length,
            circles: document.crease_pattern.circles.length,
            points: document.crease_pattern.points.length,
            aux_line_segments: document.crease_pattern.aux_line_segments.length,
            texts: document.crease_pattern.texts.length,
            can_save_as_cp: true,
            is_empty:
              document.crease_pattern.line_segments.length +
                document.crease_pattern.circles.length +
                document.crease_pattern.points.length +
                document.crease_pattern.aux_line_segments.length +
                document.crease_pattern.texts.length ===
              0,
          },
          source: source ?? current?.source ?? { format: 'cp', filename: 'Untitled.cp', path: null },
          operationDescriptors: cpOperationDescriptors,
          lastCommandResult,
        };
      }
    );
  oristudioCpMocks.executeOristudioCpCommand.mockReset().mockRejectedValue({
    code: 'not_implemented',
    message: 'Oriedita operation DrawCreaseFree is not implemented yet',
  });
  oristudioCpMocks.executeOristudioCpSelectionCommand.mockReset().mockRejectedValue({
    code: 'not_implemented',
    message: 'no selection command is expected',
  });
  oristudioCpMocks.insertOristudioCpLineSegments
    .mockReset()
    .mockImplementation(async () => blankCpDocumentState());
  oristudioCpMocks.replaceOristudioCpLineSegments
    .mockReset()
    .mockImplementation(async () => blankCpDocumentState());
  oristudioCpMocks.previewOristudioCpCommand
    .mockReset()
    .mockResolvedValue({ segments: [], circles: [], points: [], diagnostics: [] });
  return api;
}

function camvErrorResult(id = 'CheckCamv-1'): OristudioCpCommandResult {
  return {
    operation: 'CheckCamv',
    status: 'OracleTested',
    diagnostics: ['Check CAMV found 1 issue(s)'],
    diagnostic_entries: [
      {
        id,
        kind: 'CheckCamv',
        severity: 'error',
        message: 'Maekawa violation',
        point: { x: 0, y: 0 },
        rule: 'Maekawa',
      },
    ],
  };
}

function createFileService(
  file: { text: string; name: string; path: string | null } | null = null
): FileService & {
  openTextFile: ReturnType<typeof vi.fn>;
  openBinaryFile: ReturnType<typeof vi.fn>;
  openBinaryFiles: ReturnType<typeof vi.fn>;
  saveTextFile: ReturnType<typeof vi.fn>;
  saveBinaryFile: ReturnType<typeof vi.fn>;
} {
  return {
    surface: 'web',
    supportsNativeDialogs: false,
    openTextFile: vi.fn(async () => file),
    openBinaryFile: vi.fn(async () => null),
    openBinaryFiles: vi.fn(async () => null),
    saveTextFile: vi.fn(async (options: SaveTextFileOptions) => ({
      name: options.suggestedName,
      path: options.path ?? `/tmp/${options.suggestedName}`,
    })),
    saveBinaryFile: vi.fn(async (options: SaveBinaryFileOptions) => ({
      name: options.suggestedName,
      path: null,
    })),
  };
}

// Past the slice's 25 MB "this may have run out of memory" threshold. Trailing
// whitespace is ignored by JSON.parse, so this grows the source without
// building a second copy of a huge document.
function padToLargeSource(text: string): string {
  return `${text}${' '.repeat(26 * 1024 * 1024 - text.length)}`;
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('workspace store slices', () => {
  // Set by the tests that stand a fake camera in front of the store.
  let unregisterCamera: (() => void) | null = null;

  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  afterEach(async () => {
    unregisterCamera?.();
    unregisterCamera = null;
    vi.useRealTimers();
    await flushAsyncWork();
  });

  it('composes project, history, editing, clipboard, conditions, and crease-pattern state', () => {
    const state = useWorkspaceStore.getState();

    expect(selectProject(state).nodes).toEqual([]);
    expect(state.importedCreasePattern).toBeNull();
    expect(state.oristudioCpDocument).toBeNull();
    expect(state.oristudioCpOperationDescriptors).toEqual([]);
    expect(state.oristudioCpError).toBeNull();
    expect(state.oristudioCpCamvResult).toBeNull();
    expect(state.oristudioCpHistoryPast).toEqual([]);
    expect(state.oristudioCpHistoryFuture).toEqual([]);
    expect(state.status).toBe('loading_engine');
    expect(selectSelection(state)).toEqual({ kind: 'tree' });
    expect(selectToolMode(state)).toBe('select');
    expect(selectSymmetryAuthoringPairs(state)).toEqual([]);
    expect(state.creaseColorMode).toBe(DEFAULT_CREASE_COLOR_MODE);
    expect(state.oristudioCpSelection).toEqual(emptyOristudioCpSelection());
    expect(state.oristudioCpViewport).toEqual(DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS);
    expect(state.foldArtifacts).toBeNull();
    expect(selectDesignViewportFitRequestId(state)).toBe(0);
    expect(selectHistoryPast(state)).toEqual([]);
    expect(state.clipboard).toBeNull();
    expect(state.projectLoadId).toBe(0);
    expect(state.currentFileName).toBe('Untitled.osf');
    expect(state.createNewProject).toBeTypeOf('function');
    expect(state.createNewCreasePattern).toBeTypeOf('function');
    expect(state.openProject).toBeTypeOf('function');
    expect(state.loadCreasePatternText).toBeTypeOf('function');
    expect(state.executeOristudioCpCommand).toBeTypeOf('function');
    expect(state.insertOristudioCpLineSegments).toBeTypeOf('function');
    expect(state.replaceOristudioCpLineSegments).toBeTypeOf('function');
    expect(state.saveProject).toBeTypeOf('function');
    expect(state.exportCp).toBeTypeOf('function');
    expect(state.exportFold).toBeTypeOf('function');
    expect(state.exportOri).toBeTypeOf('function');
    expect(state.exportOrh).toBeTypeOf('function');
    expect(state.undo).toBeTypeOf('function');
    expect(state.copySelection).toBeTypeOf('function');
    expect(state.updatePaper).toBeTypeOf('function');
    expect(state.addCondition).toBeTypeOf('function');
    expect(state.addNodeAt).toBeTypeOf('function');
    expect(state.addNodeWithSymmetry).toBeTypeOf('function');
    expect(state.optimizeEdges).toBeTypeOf('function');
    expect(state.buildCreasePattern).toBeTypeOf('function');
    expect(state.toggleOristudioCpLineSelection).toBeTypeOf('function');
    expect(state.transformOristudioCpSelection).toBeTypeOf('function');
  });

  it('initEngine preserves an editable CP provisioned while the engine was loading', async () => {
    resetStores(seedSnapshot());
    // Simulate the Edit surface seeding its own CP (via the CP worker) before the
    // treemaker engine finished loading — initEngine must not clobber it.
    const doc = editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]);
    useWorkspaceStore.setState({ oristudioCpDocument: doc });

    await useWorkspaceStore.getState().initEngine();

    expect(useWorkspaceStore.getState().engineReady).toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(doc);
  });

  it('initializes projects, loads text, saves, and exports', async () => {
    const api = resetStores(seedSnapshot());
    const fileService = createFileService({
      text: 'opened text',
      name: 'opened.tmd5',
      path: '/tmp/opened.tmd5',
    });

    await useWorkspaceStore.getState().initEngine();
    expect(useWorkspaceStore.getState().engineReady).toBe(true);
    // Booting seeds an engine *handle*, not a design: a cold start lands on the
    // method chooser, so nothing has claimed the tab yet.
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
    const initializedLoadId = useWorkspaceStore.getState().projectLoadId;

    await useWorkspaceStore.getState().loadProjectText('loaded text', {
      title: 'Loaded design',
      filename: 'loaded.tmd5',
      path: '/tmp/loaded.tmd5',
    });
    expect(useWorkspaceStore.getState().projectLoadId).toBe(initializedLoadId + 1);
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'loaded.tmd5',
      currentFilePath: '/tmp/loaded.tmd5',
      dirty: false,
      projectMessage: 'Loaded loaded.tmd5',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);
    expect(fileService.openTextFile).toHaveBeenCalledWith({
      title: 'Open Ori Studio Project or Crease Pattern',
      extensions: ['osf', 'tmd', 'tmd4', 'tmd5', 'fold', 'cp', 'ori', 'orh', 'bps'],
    });

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);
    expect(fileService.saveTextFile).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Save Ori Studio Project',
        path: null,
        extensions: ['osf'],
      })
    );
    const savedNativeTreeOptions = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
      | SaveTextFileOptions
      | undefined;
    const savedNativeTree = parseNativeProjectFile(savedNativeTreeOptions?.contents ?? '');
    expect(activeNativeDesign(savedNativeTree)).toMatchObject({
      payload: { kind: 'treemaker', format: 'tmd5' },
    });
    expect(useWorkspaceStore.getState().dirty).toBe(false);

    await expect(useWorkspaceStore.getState().saveProjectAs(fileService)).resolves.toBe(true);
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Save Ori Studio Project As',
        path: null,
      })
    );

    await expect(useWorkspaceStore.getState().exportV5(fileService)).resolves.toBe(true);
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Export TreeMaker 5 Project', extensions: ['tmd5'] })
    );

    await expect(useWorkspaceStore.getState().exportV4(fileService)).resolves.toBe(true);
    expect(api.exportV4).toHaveBeenCalledWith(1);

    await useWorkspaceStore.getState().buildCreasePattern();
    await expect(useWorkspaceStore.getState().exportFold(fileService)).resolves.toBe(true);
    expect(api.exportFold).toHaveBeenCalledWith(1);
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: 'Export FOLD Document', extensions: ['fold'] })
    );

    await expect(useWorkspaceStore.getState().exportSvg(fileService)).resolves.toBe(true);
    expect(exportMocks.serializeCreasePatternSvg).toHaveBeenCalledWith(
      expect.objectContaining({ edges_vertices: expect.any(Array) }),
      expect.any(Array),
      expect.objectContaining({ segmentId: null, includeUnassigned: true, showBackgroundColor: true }),
      { foldedFigure: null, grid: null }
    );

    await expect(useWorkspaceStore.getState().exportPng(fileService)).resolves.toBe(true);
    expect(exportMocks.renderCreasePatternPng).toHaveBeenCalledWith(
      expect.objectContaining({ edges_vertices: expect.any(Array) }),
      expect.any(Array),
      expect.objectContaining({ segmentId: null, includeUnassigned: true, showBackgroundColor: true }),
      { foldedFigure: null, grid: null }
    );
    expect(fileService.saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ['png'], mimeType: 'image/png' })
    );

    useWorkspaceStore.getState().clearProjectMessage();
    expect(useWorkspaceStore.getState().projectMessage).toBeNull();
  });

  it('creates a blank editable CP document', async () => {
    resetStores(seedSnapshot());
    // A delegating spy, not a stub: `activateWorkspace` is also what settles
    // which pane is active, so replacing it outright hides the very disagreement
    // that killed the Edit shortcuts after an open.
    const activateWorkspace = vi.fn(useLayoutStore.getState().activateWorkspace);
    useLayoutStore.setState({ activateWorkspace });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });

    await useWorkspaceStore.getState().createNewCreasePattern();

    expect(oristudioCpMocks.releaseOristudioCpDocument).toHaveBeenCalledOnce();
    expect(oristudioCpMocks.createBlankOristudioCpDocument).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'Untitled-CP.osf',
      currentFilePath: null,
      status: 'crease_pattern_ready',
      dirty: false,
      projectMessage: null,
    });
    expect(useWorkspaceStore.getState().workspaceTitle).toBe('Untitled CP');
    expect(useWorkspaceStore.getState().oristudioCpDocument?.summary).toMatchObject({
      is_empty: false,
      line_segments: 4,
      can_save_as_cp: true,
    });
    expect(
      useWorkspaceStore
        .getState()
        .oristudioCpDocument?.document.crease_pattern.line_segments.every(
          (line) => line.color === 'Black0'
        )
    ).toBe(true);
    expect(useWorkspaceStore.getState().importedCreasePattern).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpSelection).toEqual(emptyOristudioCpSelection());
    expect(activateWorkspace).toHaveBeenCalledWith('edit');
    // A bare CP establishes no design, so the Design workspace keeps the chooser.
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
  });

  // The compiler catches a per-document field whose *discard value* nobody
  // supplied. It cannot catch a `set` that hand-rolls its own field list instead
  // of spreading the discard, which is what every bug of this shape has actually
  // been. This asserts the whole scoped set at once, and takes its field list
  // from the same constant the type is built from — so a field added later is
  // covered here without anyone remembering to come back.
  it('leaves nothing of a document behind when it is closed', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [inlineSimulationFixture()],
      oristudioCpFocusedInlineSimulationId: 'inline-sim-1',
      oristudioCpAnnotations: [
        createCpImage({
          src: 'data:image/png;base64,AAAA',
          naturalWidth: 10,
          naturalHeight: 10,
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
        }),
      ],
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2] },
      oristudioCpRevision: 7,
      oristudioCpDocumentExtensions: { leftover: true },
    });
    setInlineSimulationSource('inline-sim-1', { fold: {} as never, modelKey: 'k' });

    await useWorkspaceStore.getState().clearOristudioCpDocument();

    const state = useWorkspaceStore.getState();
    const discarded = discardCpDocumentState();
    for (const key of CP_DOCUMENT_SCOPED_KEYS) {
      expect(state[key], key).toEqual(discarded[key]);
    }
    // And the half of a window that is not in the store at all.
    expect(inlineSimulationSourceCount()).toBe(0);
  });

  // Opening a `.cp` kept the previous document's windows, which then reported
  // themselves merely "out of date" over a crease pattern they had never been
  // built from. The path cleared the folded figures two lines above and simply
  // did not know about windows — the same miss as undo, in a different place.
  it('drops inline simulation windows when a crease pattern is opened over them', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [inlineSimulationFixture()],
      oristudioCpFocusedInlineSimulationId: 'inline-sim-1',
    });
    setInlineSimulationSource('inline-sim-1', { fold: {} as never, modelKey: 'k' });

    const fileService = createFileService({
      text: '{"@version":"v1.1","title":"native ori","lineSegments":[]}',
      name: 'native.ori',
      path: '/tmp/native.ori',
    });
    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBeNull();
    // The descriptor is only half of a window. Its captured fold lives outside
    // the store and is hundreds of KB to megabytes; window ids are never reused,
    // so a fold left behind is unreachable for the rest of the session.
    expect(inlineSimulationSourceCount()).toBe(0);
  });

  it('drops inline simulation windows when the document is replaced', async () => {
    // Windows name a region of the document they were opened over. Leaving them
    // behind parks a live simulation of the old paper on top of the new one —
    // the same reason folded figures and annotations are cleared here.
    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({
      engineReady: true,
      status: 'ready',
      oristudioCpInlineSimulations: [inlineSimulationFixture()],
      oristudioCpFocusedInlineSimulationId: 'inline-sim-1',
    });

    await useWorkspaceStore.getState().createNewCreasePattern();

    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBeNull();
  });

  it('keeps a refused load visible instead of self-provisioning over it', async () => {
    // The editable kernel refusing a file is a *result*, not a starting state.
    // `loadCreasePattern` handles it correctly — read-only import kept, reason
    // recorded — and then the Edit workspace's self-provisioning replaced all of
    // it with a blank canvas and a cleared error, so the user saw an empty sheet
    // named after their file with nothing anywhere saying it had failed.
    resetStores(seedSnapshot());
    oristudioCpMocks.loadOristudioCpDocumentFromText
      .mockReset()
      .mockRejectedValue(new Error('invalid Oriedita field vertices_coords'));

    await useWorkspaceStore.getState().loadCreasePatternText(editableCpFoldText, {
      filename: 'MyDesign.fold',
      path: '/Users/me/MyDesign.fold',
    });

    const afterLoad = useWorkspaceStore.getState();
    expect(afterLoad.oristudioCpDocument).toBeNull();
    expect(afterLoad.oristudioCpError).toContain('vertices_coords');
    expect(afterLoad.importedCreasePattern).not.toBeNull();

    // The Edit workspace mounts and seeds a blank CP when it has no document.
    await useWorkspaceStore.getState().ensureEditCreasePattern();

    const afterProvision = useWorkspaceStore.getState();
    expect(afterProvision.oristudioCpError).toContain('vertices_coords');
    expect(afterProvision.importedCreasePattern).not.toBeNull();
    // And it must not have manufactured a blank document to show instead.
    expect(oristudioCpMocks.createBlankOristudioCpDocument).not.toHaveBeenCalled();
  });

  it('recovers from a refused load: File > New seeds a canvas again', async () => {
    // Refusing to self-provision is only safe if something still can. Blocking
    // it unconditionally would trade a silent blank canvas for a dead end,
    // which is the worse of the two.
    resetStores(seedSnapshot());
    oristudioCpMocks.loadOristudioCpDocumentFromText
      .mockReset()
      .mockRejectedValue(new Error('invalid Oriedita field vertices_coords'));
    await useWorkspaceStore.getState().loadCreasePatternText(editableCpFoldText, {
      filename: 'MyDesign.fold',
      path: '/Users/me/MyDesign.fold',
    });
    expect(useWorkspaceStore.getState().cpLoadFailure).not.toBeNull();

    await useWorkspaceStore.getState().createNewCreasePattern();

    const state = useWorkspaceStore.getState();
    expect(state.oristudioCpDocument).not.toBeNull();
    expect(state.cpLoadFailure).toBeNull();
    // …and the Edit surface can seed freely again afterwards.
    useWorkspaceStore.setState({ oristudioCpDocument: null });
    await useWorkspaceStore.getState().ensureEditCreasePattern();
    expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
  });

  it('a stale CP command error does not block seeding a blank canvas', async () => {
    // `oristudioCpError` carries every kind of CP failure (a command that would
    // not run, "no document is loaded", a dead kernel), so gating provisioning
    // on it would let an unrelated error strand the user on an empty workspace.
    // Only a recorded *load* failure may block.
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: null,
      oristudioCpError: 'DrawCreaseFree could not be applied',
      cpLoadFailure: null,
    });

    await useWorkspaceStore.getState().ensureEditCreasePattern();

    expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
  });

  it('ensureEditCreasePattern never touches the design tabs', async () => {
    // It used to clear the active design when that design had no edges and no BP
    // document — a test for "nothing authored yet" that a *freshly created*
    // Circle-packed design also passes, because a blank tree is zero edges. So
    // visiting Edit threw away the design the user had just made.
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: null,
      ...singleDesignTab('treemaker'),
    });
    const before = useWorkspaceStore.getState().designTabs;

    await useWorkspaceStore.getState().ensureEditCreasePattern();

    expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
    expect(useWorkspaceStore.getState().designTabs).toEqual(before);
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('treemaker');
    // The CP editor must report ready (not the initial 'loading_engine'), else
    // `isBusy` disables undo/redo and every engine-gated command on this canvas.
    expect(useWorkspaceStore.getState().status).toBe('crease_pattern_ready');

    // And an authored tree is left alone for the same reason.
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().initEngine();
    loadSnapshotIntoStore(seedSnapshot());
    expect(selectProject(useWorkspaceStore.getState()).edges.length).toBeGreaterThan(0);
    useWorkspaceStore.setState({ oristudioCpDocument: null });
    await useWorkspaceStore.getState().ensureEditCreasePattern();
    expect(selectDesignMethod(useWorkspaceStore.getState())).not.toBe('none');
  });

  it('leaves the chooser alone when no design has been started', async () => {
    // The case the clear was written for. Nothing to clear: a workspace with no
    // design is already a workspace of chooser tabs.
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({ oristudioCpDocument: null, ...singleDesignTab(null) });

    await useWorkspaceStore.getState().ensureEditCreasePattern();

    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
  });

  it('a Circle-packed design started over an opened crease pattern is editable', async () => {
    // Opening a `.fold` leaves a read-only import on the always-live Edit
    // canvas; `chooseDesignMethod` deliberately preserves it. Tree editing then
    // read that workspace-level flag as a statement about the *design* and
    // rejected every edit with "Imported crease patterns are read-only" — the
    // rule from when one workspace held one document. A bare crease pattern now
    // establishes no design at all (`discardAllDesigns`), so reaching a tree
    // edit means the user made a tree, and it is theirs to edit.
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText(editableCpFoldText, {
      filename: 'Untitled CP.fold',
    });
    expect(useWorkspaceStore.getState().importedCreasePattern).not.toBeNull();

    await useWorkspaceStore.getState().chooseDesignMethod('treemaker');
    const before = selectProject(useWorkspaceStore.getState()).nodes.length;

    await useWorkspaceStore.getState().addNodeAt({ x: 0.4, y: 0.4 });

    expect(useWorkspaceStore.getState().error).toBeNull();
    expect(selectProject(useWorkspaceStore.getState()).nodes.length).toBe(before + 1);
    // And the import it was authored beside is still on the Edit canvas.
    expect(useWorkspaceStore.getState().importedCreasePattern).not.toBeNull();
  });

  it('conditions on a design started over an opened crease pattern are editable', async () => {
    // Same conflation, second guard: `addCondition` rejected with "Conditions
    // require an editable tree document" for the same workspace-level reason.
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText(editableCpFoldText, {
      filename: 'Untitled CP.fold',
    });
    await useWorkspaceStore.getState().chooseDesignMethod('treemaker');

    await useWorkspaceStore.getState().updatePaper({ width: 2 });

    expect(useWorkspaceStore.getState().error).toBeNull();
    expect(selectProject(useWorkspaceStore.getState()).paper.width).toBe(2);
  });

  it('opens native tree projects and keeps Save on the native file path', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const nativeText = serializeNativeProjectFile(
      createNativeTreeProjectFile({
        title: 'Native tree',
        filename: 'legacy.tmd5',
        path: '/tmp/legacy.tmd5',
        tmd5Text: 'native tree tmd5',
        appVersion: '0.1.1',
        now: new Date('2026-05-26T12:00:00.000Z'),
      })
    );
    const fileService = createFileService({
      text: nativeText,
      name: 'native-tree.osf',
      path: '/tmp/native-tree.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(engineMocks.loadTreeFromText).toHaveBeenCalledWith(api, 'native tree tmd5');
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'native-tree.osf',
      currentFilePath: '/tmp/native-tree.osf',
      dirty: false,
    });

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Save Ori Studio Project',
        suggestedName: 'native-tree.osf',
        path: '/tmp/native-tree.osf',
        extensions: ['osf'],
      })
    );
  });

  /**
   * In the browser the save target is a handle token, not a path. It has to
   * survive in the store — that is what lets the next ⌘S overwrite instead of
   * downloading a second copy — but it must never be written *into* the file,
   * because it resolves nowhere outside the page that minted it.
   */
  it('round-trips a web save target without writing it into the saved file', async () => {
    resetStores(seedSnapshot());
    // Opened in a browser, so the file arrived with no path — the save target is
    // whatever the first save establishes.
    await useWorkspaceStore.getState().loadCreasePatternText(
      JSON.stringify({
        file_spec: 1.1,
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
      }),
      { filename: 'line.fold', path: null }
    );
    const fileService = createFileService();
    fileService.saveTextFile.mockImplementation(async (options: SaveTextFileOptions) => ({
      name: options.suggestedName,
      path: options.path ?? 'web-save:1',
    }));

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);
    expect(useWorkspaceStore.getState().currentFilePath).toBe('web-save:1');
    // The document's own source is the other half, and the one a browser run
    // caught: it is written into the file and read back, so it records a real
    // path or nothing. Only `currentFilePath` carries the token.
    expect(useWorkspaceStore.getState().oristudioCpDocument?.source).toEqual({
      format: 'osf',
      filename: 'line.osf',
      path: null,
    });

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    const secondSave = fileService.saveTextFile.mock.lastCall?.[0] as SaveTextFileOptions;
    // Handed back to the service, so it can write over the same file...
    expect(secondSave.path).toBe('web-save:1');
    expect(secondSave.reusableTarget).toBe(true);
    // ...but absent from the bytes that land on disk.
    expect(secondSave.contents).not.toContain('web-save:');
  });

  /**
   * Save writes the workspace, not the pane in focus, so a crease-pattern-only
   * project stays savable after the user leaves Edit. It used to be refused from
   * References, Simulate and the Design chooser — "Editable crease-pattern kernel
   * is unavailable" — and came back only on returning to Edit.
   */
  it('saves a crease-pattern-only project from every workspace, not just Edit', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText(
      JSON.stringify({
        file_spec: 1.1,
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
      }),
      { filename: 'line.fold', path: null }
    );
    // Opening a crease pattern lands on Edit, which is why Save worked there.
    expect(useWorkspaceStore.getState().activeEditingContext).toBe('crease-pattern');

    for (const [workspace, context] of [
      ['references', 'references'],
      ['simulate', 'simulate'],
      ['design', 'design-nux'],
      ['edit', 'crease-pattern'],
    ] as const) {
      useLayoutStore.getState().activateWorkspace(workspace);
      expect(useWorkspaceStore.getState().activeEditingContext).toBe(context);

      const fileService = createFileService();
      await expect(useWorkspaceStore.getState().saveProject(fileService), workspace).resolves.toBe(
        true
      );
      await expect(useWorkspaceStore.getState().saveProjectAs(fileService), workspace).resolves.toBe(
        true
      );
      expect(fileService.saveTextFile, workspace).toHaveBeenCalledTimes(2);
      expect(fileService.saveTextFile, workspace).toHaveBeenLastCalledWith(
        expect.objectContaining({ title: 'Save Ori Studio Project As', extensions: ['osf'] })
      );
      expect(useWorkspaceStore.getState().error, workspace).toBeNull();
      // The crease pattern is what was written, whichever workspace saved it.
      const saved = parseNativeProjectFile(
        (fileService.saveTextFile.mock.lastCall?.[0] as SaveTextFileOptions).contents
      );
      expect(saved.workspace.designs, workspace).toEqual([]);
      expect(saved.workspace.creasePattern, workspace).not.toBeNull();
    }
  });

  /**
   * Save writes over the file that was opened, whichever workspace it is pressed
   * in — never a new file. A null `path` is what makes the file service ask where
   * to put it, so that is the thing to pin.
   */
  describe('saves over the opened file from every workspace', () => {
    const workspaces = [
      ['edit', 'crease-pattern'],
      ['references', 'references'],
      ['simulate', 'simulate'],
      ['design', 'design-nux'],
    ] as const;

    it('for a native .osf', async () => {
      resetStores(seedSnapshot());
      loadSnapshotIntoStore(seedSnapshot());
      const fileService = createFileService({
        text: serializeNativeProjectFile(
          createNativeCreasePatternProjectFile({
            title: 'Existing',
            filename: 'existing.osf',
            path: '/tmp/existing.osf',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: { format: 'osf', filename: 'existing.osf', path: '/tmp/existing.osf' },
            foldProjection: JSON.parse(editableCpFoldText),
            sourceFold: null,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
            appVersion: '0.5.2',
          })
        ),
        name: 'existing.osf',
        path: '/tmp/existing.osf',
      });
      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      for (const [workspace, context] of workspaces) {
        useLayoutStore.getState().activateWorkspace(workspace);
        expect(useWorkspaceStore.getState().activeEditingContext).toBe(context);
        useWorkspaceStore.setState({ dirty: true });

        await expect(useWorkspaceStore.getState().saveProject(fileService), workspace).resolves.toBe(
          true
        );
        expect(fileService.saveTextFile, workspace).toHaveBeenLastCalledWith(
          expect.objectContaining({
            title: 'Save Ori Studio Project',
            suggestedName: 'existing.osf',
            path: '/tmp/existing.osf',
            extensions: ['osf'],
          })
        );
        expect(useWorkspaceStore.getState(), workspace).toMatchObject({
          currentFileName: 'existing.osf',
          currentFilePath: '/tmp/existing.osf',
          dirty: false,
        });
      }
    });

    it('for an Oriedita .ori, which saves back as .ori', async () => {
      resetStores(seedSnapshot());
      loadSnapshotIntoStore(seedSnapshot());
      const fileService = createFileService({
        text: '{"@version":"v1.1","title":"existing","lineSegments":[]}',
        name: 'existing.ori',
        path: '/tmp/existing.ori',
      });
      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      for (const [workspace, context] of workspaces) {
        useLayoutStore.getState().activateWorkspace(workspace);
        expect(useWorkspaceStore.getState().activeEditingContext).toBe(context);
        useWorkspaceStore.setState({ dirty: true });

        await expect(useWorkspaceStore.getState().saveProject(fileService), workspace).resolves.toBe(
          true
        );
        expect(fileService.saveTextFile, workspace).toHaveBeenLastCalledWith(
          expect.objectContaining({
            title: 'Save Oriedita ORI Document',
            suggestedName: 'existing.ori',
            path: '/tmp/existing.ori',
            extensions: ['ori'],
          })
        );
        expect(useWorkspaceStore.getState(), workspace).toMatchObject({
          currentFileName: 'existing.ori',
          currentFilePath: '/tmp/existing.ori',
          dirty: false,
        });
      }
    });
  });

  /**
   * A save through the File System Access API writes the file and shows the user
   * nothing — no dialog on the repeat, no download for the browser to announce.
   * The toast is the only confirmation, so the store has to raise one.
   */
  it('announces a save the user has no other way of noticing', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText(
      JSON.stringify({
        file_spec: 1.1,
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
      }),
      { filename: 'line.fold', path: null }
    );
    const fileService = createFileService();
    fileService.saveTextFile.mockImplementation(async (options: SaveTextFileOptions) => ({
      name: options.suggestedName,
      path: options.path ?? 'web-save:1',
    }));

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    expect(useWorkspaceStore.getState().savedNotice).toBe('line.osf');
  });

  it('says nothing about a download, which the browser reports itself', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText(
      JSON.stringify({
        file_spec: 1.1,
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
      }),
      { filename: 'line.fold', path: null }
    );
    const fileService = createFileService();
    // The Firefox/Safari fallback: a download, with no target to write to again.
    fileService.saveTextFile.mockImplementation(async (options: SaveTextFileOptions) => ({
      name: options.suggestedName,
      path: null,
    }));

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    expect(useWorkspaceStore.getState().savedNotice).toBeNull();
  });

  // A file we rejected on its own terms already carries the whole reason; the
  // size hint would send the user chasing a memory problem they do not have.
  it('does not blame file size for a project the reader definitively rejected', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const fileService = createFileService({
      text: padToLargeSource(JSON.stringify({ format: 'oristudio.project', schemaVersion: 99 })),
      name: 'future.osf',
      path: '/tmp/future.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(false);

    const { status, error } = useWorkspaceStore.getState();
    expect(status).toBe('error');
    expect(error?.message).toBe('Unsupported Ori Studio project schemaVersion 99');
    // The code is what the toast layer translates; the message stays raw for
    // diagnostics and never reaches the user as-is.
    expect(error?.code).toBe('project_file_too_new');
  });

  it('still blames file size when a large project fails for an unexplained reason', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    engineMocks.loadTreeFromText.mockRejectedValueOnce(new Error('engine load failed'));
    const nativeText = serializeNativeProjectFile(
      createNativeTreeProjectFile({
        title: 'Native tree',
        filename: 'legacy.tmd5',
        path: '/tmp/legacy.tmd5',
        tmd5Text: 'native tree tmd5',
        appVersion: '0.1.1',
        now: new Date('2026-05-26T12:00:00.000Z'),
      })
    );
    const fileService = createFileService({
      text: padToLargeSource(nativeText),
      name: 'huge.osf',
      path: '/tmp/huge.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(false);

    expect(useWorkspaceStore.getState().error?.message).toMatch(
      /^engine load failed — this file is very large \(~26 MB\)/
    );
  });

  it('opens native editable CP projects through the CP runtime', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const document = blankCpDocumentState().document;
    const nativeText = serializeNativeProjectFile(
      createNativeCreasePatternProjectFile({
        title: 'Native CP',
        filename: 'source.cp',
        path: '/tmp/source.cp',
        document,
        source: { format: 'cp', filename: 'source.cp', path: '/tmp/source.cp' },
        foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
        foldArtifacts: null,
        creaseColorMode: 'agrh',
        selection: { ...emptyOristudioCpSelection(), lines: [1] },
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [
          {
            id: 'generated-1',
            title: 'Folded model 1',
            handle: 99,
            sourceKind: 'generated-from-current-cp',
            sourceCpRevision: 0,
            startingFaceId: 1,
            displayStyle: 'Paper5',
            status: 'ready',
            placement: IDENTITY_FOLDED_PLACEMENT,
            snapshot: foldedFigureSnapshot(),
            renderSnapshot: foldedRenderSnapshot(),
            error: null,
          },
        ],
        activeFoldedFigureId: 'generated-1',
        lineage: importedCpLineage(),
        appVersion: '0.1.1',
        now: new Date('2026-05-26T12:00:00.000Z'),
      })
    );
    const fileService = createFileService({
      text: nativeText,
      name: 'native-cp.osf',
      path: '/tmp/native-cp.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(oristudioCpMocks.restoreOristudioCpDocument).toHaveBeenCalledWith(
      document,
      {
        format: 'osf',
        filename: 'native-cp.osf',
        path: '/tmp/native-cp.osf',
      }
    );
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'native-cp.osf',
      currentFilePath: '/tmp/native-cp.osf',
      creaseColorMode: 'agrh',
      dirty: false,
    });
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toMatchObject([
      {
        id: 'generated-1',
        handle: null,
        displayStyle: 'Paper5',
        renderSnapshot: foldedRenderSnapshot(),
      },
    ]);
    // The file carries both a crease selection and an active figure. The canvas
    // has one holder, so the creases win at the boundary and the figure is not
    // selected — the same rule `takeCanvasSelection` keeps everywhere else.
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    expect(useWorkspaceStore.getState().foldArtifacts?.simulation_model).not.toBeNull();
  });

  it('attaches a saved layer order to its figure on open, and saves it back to the crease pattern’s bag', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const held = foldedFigureLayerOrder({
      faces: [
        { at: [0.25, 0.5], area: 0.5 },
        { at: [0.75, 0.5], area: 0.5 },
      ],
      constraints: [[0, 1, 1]],
      order: [],
    });
    if (!held.ok) throw new Error(held.reason);
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 99,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: { ...foldedFigureSnapshot(), shown_order: 'given' },
      renderSnapshot: foldedRenderSnapshot(),
      sourceFingerprint: 'cs1:folded',
      error: null,
      layerOrder: held.layerOrder,
    };
    const nativeText = serializeNativeProjectFile(
      createNativeCreasePatternProjectFile({
        title: 'Native CP',
        filename: 'layers.osf',
        path: '/tmp/layers.osf',
        document: blankCpDocumentState().document,
        source: null,
        foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [figure],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
        extensions: { futureDocFeature: { a: 1 } },
        appVersion: '0.1.1',
      })
    );
    const savedBag = JSON.parse(nativeText).workspace.creasePattern.extensions;
    expect(Object.keys(savedBag)).toEqual(['futureDocFeature', FOLDED_FIGURE_LAYER_ORDERS_KEY]);

    await expect(
      useWorkspaceStore
        .getState()
        .openProject(createFileService({ text: nativeText, name: 'layers.osf', path: '/tmp/layers.osf' }))
    ).resolves.toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.layerOrder).toEqual(held.layerOrder);

    const fileService = createFileService();
    await expect(useWorkspaceStore.getState().saveProjectAs(fileService)).resolves.toBe(true);
    const written = JSON.parse(
      (fileService.saveTextFile.mock.calls.at(-1)?.[0] as SaveTextFileOptions).contents
    );
    expect(written.workspace.creasePattern.extensions).toEqual(savedBag);
    expect(written.workspace.creasePattern.viewState.foldedFigures[0]).not.toHaveProperty('layerOrder');
  });

  it('restores reference images from a native CP project', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const document = blankCpDocumentState().document;
    const image = {
      kind: 'image' as const,
      id: 'image-load-1',
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 100,
      naturalHeight: 80,
      center: { x: 0.5, y: 0.5 },
      width: 0.8,
      height: 0.64,
      rotation: 0,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      opacity: 1,
      locked: false,
      hidden: false,
      z: 1,
    };
    const nativeText = serializeNativeProjectFile(
      createNativeCreasePatternProjectFile({
        title: 'CP with image',
        filename: 'imaged.cp',
        path: null,
        document,
        source: null,
        foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
        images: [image],
        appVersion: '0.1.1',
        now: new Date('2026-05-26T12:00:00.000Z'),
      })
    );
    const fileService = createFileService({
      text: nativeText,
      name: 'imaged.osf',
      path: '/tmp/imaged.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpAnnotations).toEqual([image]);
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBeNull();
  });

  it('loads CP-only documents and gates tree-only persistence', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    // A delegating spy, not a stub: `activateWorkspace` is also what settles
    // which pane is active, so replacing it outright hides the very disagreement
    // that killed the Edit shortcuts after an open.
    const activateWorkspace = vi.fn(useLayoutStore.getState().activateWorkspace);
    useLayoutStore.setState({ activateWorkspace });
    const cpText = [
      '1 0 0 1 0',
      '1 1 0 1 1',
      '1 1 1 0 1',
      '1 0 1 0 0',
      '2 0 0 1 1',
    ].join('\n');
    const fileService = createFileService({
      text: cpText,
      name: 'square.cp',
      path: '/tmp/square.cp',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'square.cp',
      currentFilePath: '/tmp/square.cp',
      dirty: false,
      status: 'crease_pattern_ready',
    });
    expect(useWorkspaceStore.getState().importedCreasePattern?.source.format).toBe('cp');
    expect(oristudioCpMocks.loadOristudioCpDocumentFromText).toHaveBeenCalledWith(
      cpText,
      expect.objectContaining({
        format: 'cp',
        filename: 'square.cp',
        path: '/tmp/square.cp',
        title: 'square',
      })
    );
    expect(useWorkspaceStore.getState().oristudioCpDocument).toMatchObject({
      handle: 2,
      summary: {
        line_segments: 5,
        can_save_as_cp: true,
      },
      source: {
        format: 'cp',
        filename: 'square.cp',
      },
    });
    expect(useWorkspaceStore.getState().oristudioCpOperationDescriptors).toEqual(
      cpOperationDescriptors
    );
    // A crease pattern is not a design: opening a bare `.cp` establishes no tree,
    // so the pattern lives in the CP document rather than in a phantom project.
    expect(useWorkspaceStore.getState().importedCreasePattern).not.toBeNull();
    expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
    // Simulation faces are inferred in JS (no flat-folding). Derived on demand:
    // a kernel-backed document's artifacts come from the kernel export, so the
    // load leaves the resource stale rather than installing the importer's.
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('stale');
    await useWorkspaceStore.getState().ensureFoldArtifacts();
    expect(
      useWorkspaceStore.getState().foldArtifacts?.simulation_model?.fold.faces_vertices.length
    ).toBeGreaterThan(0);
    expect(activateWorkspace).toHaveBeenCalledWith('edit');

    useWorkspaceStore.setState({
      dirty: true,
      oristudioCpFoldedFigures: [
        {
          id: 'generated-save',
          title: 'Folded model saved',
          handle: 7,
          sourceKind: 'generated-from-current-cp',
          sourceCpRevision: 0,
          startingFaceId: 1,
          displayStyle: 'Transparent3',
          status: 'ready',
          placement: IDENTITY_FOLDED_PLACEMENT,
          snapshot: foldedFigureSnapshot(),
          renderSnapshot: foldedRenderSnapshot(),
          error: null,
        },
      ],
      oristudioCpActiveFoldedFigureId: 'generated-save',
    });
    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);
    expect(oristudioCpMocks.exportOristudioCpDocumentAsCp).not.toHaveBeenCalled();
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Save Ori Studio Project',
        suggestedName: 'square.osf',
        path: null,
        extensions: ['osf'],
      })
    );
    const savedNativeCpOptions = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
      | SaveTextFileOptions
      | undefined;
    const savedNativeCp = parseNativeProjectFile(savedNativeCpOptions?.contents ?? '');
    expect(savedNativeCp.workspace.creasePattern).toMatchObject({
      creasePattern: {
        engine: 'oristudio-cp',
        foldProjection: expect.objectContaining({ frame_classes: ['creasePattern'] }),
      },
      viewState: {
        foldedFigures: [
          expect.objectContaining({
            id: 'generated-save',
            handle: null,
            displayStyle: 'Transparent3',
            renderSnapshot: foldedRenderSnapshot(),
          }),
        ],
        activeFoldedFigureId: 'generated-save',
      },
    });
    expect(oristudioCpMocks.setOristudioCpDocumentSource).toHaveBeenCalledWith({
      format: 'osf',
      filename: 'square.osf',
      path: '/tmp/square.osf',
    });
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'square.osf',
      currentFilePath: '/tmp/square.osf',
      dirty: false,
    });

    await expect(useWorkspaceStore.getState().exportCp(fileService)).resolves.toBe(true);
    expect(oristudioCpMocks.exportOristudioCpDocumentAsCp).toHaveBeenCalledOnce();
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Export CP Document',
        contents: '1 0 0 1 0\n',
        suggestedName: 'square.cp',
        path: null,
        extensions: ['cp'],
      })
    );

    await expect(useWorkspaceStore.getState().exportFold(fileService)).resolves.toBe(true);
    // Three: the export above, this one, and the `ensureFoldArtifacts` that now
    // derives the artifacts from the kernel instead of taking the importer's.
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalledTimes(3);
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Export FOLD Document',
        contents: editableCpFoldText,
        extensions: ['fold'],
      })
    );

    await expect(useWorkspaceStore.getState().exportOri(fileService)).resolves.toBe(true);
    expect(oristudioCpMocks.exportOristudioCpDocumentAsOri).toHaveBeenCalledOnce();
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Export Oriedita ORI Document',
        contents: '{"@version":"v1.1","title":"square"}\n',
        extensions: ['ori'],
      })
    );

    const unregisterDialogHost = registerCommandDialogHost();
    try {
      const exportOrh = useWorkspaceStore.getState().exportOrh(fileService);
      const dialog = useCommandDialogStore.getState().dialog;
      expect(dialog).toMatchObject({
        type: 'confirm',
        title: 'Export legacy ORH?',
        confirmLabel: 'Export ORH',
      });
      if (!dialog) throw new Error('expected ORH export confirmation');
      resolveCommandDialog(dialog.id, true);
      await expect(exportOrh).resolves.toBe(true);
    } finally {
      unregisterDialogHost();
    }
    expect(oristudioCpMocks.exportOristudioCpDocumentAsOrh).toHaveBeenCalledOnce();
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Export Oriedita ORH Document',
        contents: '<タイトル>\nタイトル,square\n',
        extensions: ['orh'],
      })
    );
  });

  it('prompts before File > New discards unsaved work, and aborts when refused', async () => {
    // File > New starts a new *project*, and tabs belong to one project — so it
    // replaces the whole workspace. Nothing may be discarded without asking.
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({ dirty: true });
    const before = selectProject(useWorkspaceStore.getState());

    const unregisterDialogHost = registerCommandDialogHost();
    try {
      const creating = useWorkspaceStore.getState().createNewProject();
      const dialog = useCommandDialogStore.getState().dialog;
      expect(dialog).toMatchObject({ type: 'confirm', title: 'Discard unsaved changes?' });
      if (!dialog) throw new Error('expected a discard confirmation');
      resolveCommandDialog(dialog.id, false);
      await creating;
    } finally {
      unregisterDialogHost();
    }

    // Refused: the project is untouched.
    expect(selectProject(useWorkspaceStore.getState())).toBe(before);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('does not prompt on File > New when there is nothing unsaved', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({ dirty: false });

    const unregisterDialogHost = registerCommandDialogHost();
    try {
      await useWorkspaceStore.getState().createNewProject();
      expect(useCommandDialogStore.getState().dialog).toBeNull();
    } finally {
      unregisterDialogHost();
    }
  });

  it('prompts before opening over unsaved changes, and aborts when refused', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({ dirty: true });
    const fileService = createFileService({
      text: 'opened text',
      name: 'opened.tmd5',
      path: '/tmp/opened.tmd5',
    });

    const unregisterDialogHost = registerCommandDialogHost();
    try {
      const opening = useWorkspaceStore.getState().openProject(fileService);
      const dialog = useCommandDialogStore.getState().dialog;
      expect(dialog).toMatchObject({ type: 'confirm', title: 'Discard unsaved changes?' });
      if (!dialog) throw new Error('expected a discard confirmation');
      resolveCommandDialog(dialog.id, false);
      await expect(opening).resolves.toBe(false);
    } finally {
      unregisterDialogHost();
    }

    expect(fileService.openTextFile).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  // The drop flow states the discard consequence in its own choice dialog, so a
  // second prompt here would be the user answering the same question twice.
  it('skips the discard prompt when the caller has already asked', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({ dirty: true });
    const fileService = createFileService({
      text: 'opened text',
      name: 'opened.tmd5',
      path: '/tmp/opened.tmd5',
    });

    const unregisterDialogHost = registerCommandDialogHost();
    try {
      await expect(
        useWorkspaceStore.getState().openProject(fileService, { confirmDiscard: false })
      ).resolves.toBe(true);
      expect(useCommandDialogStore.getState().dialog).toBeNull();
    } finally {
      unregisterDialogHost();
    }

    expect(fileService.openTextFile).toHaveBeenCalledOnce();
  });

  it('opens native Oriedita ORI documents and saves back as ORI', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const oriText = '{"@version":"v1.1","title":"native ori","lineSegments":[]}';
    const fileService = createFileService({
      text: oriText,
      name: 'native.ori',
      path: '/tmp/native.ori',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(oristudioCpMocks.loadOristudioCpDocumentFromText).toHaveBeenCalledWith(
      oriText,
      expect.objectContaining({
        format: 'ori',
        filename: 'native.ori',
        path: '/tmp/native.ori',
      })
    );
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalledOnce();
    // The file's own `title` names the project, which is what the window title
    // and every save/export default read. A crease pattern establishes no tree,
    // so the tree's title stays at the empty design's default — asserted here so
    // nobody re-points a project-level read at it (see `useWindowTitle`).
    expect(useWorkspaceStore.getState().workspaceTitle).toBe('native ori');
    expect(selectProject(useWorkspaceStore.getState()).title).toBe('Untitled');
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'native.ori',
      currentFilePath: '/tmp/native.ori',
      dirty: false,
      status: 'crease_pattern_ready',
    });
    expect(useWorkspaceStore.getState().importedCreasePattern?.source).toMatchObject({
      format: 'ori',
      filename: 'native.ori',
      path: '/tmp/native.ori',
    });
    expect(useWorkspaceStore.getState().oristudioCpDocument?.source).toMatchObject({
      format: 'ori',
      filename: 'native.ori',
      path: '/tmp/native.ori',
    });

    useWorkspaceStore.setState({ dirty: true });
    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    expect(oristudioCpMocks.exportOristudioCpDocumentAsOri).toHaveBeenCalledOnce();
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Save Oriedita ORI Document',
        contents: '{"@version":"v1.1","title":"square"}\n',
        suggestedName: 'native.ori',
        path: '/tmp/native.ori',
        extensions: ['ori'],
      })
    );
    expect(oristudioCpMocks.setOristudioCpDocumentSource).toHaveBeenCalledWith({
      format: 'ori',
      filename: 'native.ori',
      path: '/tmp/native.ori',
    });
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'native.ori',
      currentFilePath: '/tmp/native.ori',
      dirty: false,
    });
  });

  it('does not save the FOLD projection a second time as the source FOLD', async () => {
    // A project with no source FOLD of its own carries only its projection. The
    // open used to adopt that projection as `sourceFold`, so the next save wrote
    // the same FOLD twice — and every save after carried the copy forward.
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const nativeProject = createNativeCreasePatternProjectFile({
      title: 'Projection only',
      filename: 'projection.osf',
      path: '/tmp/projection.osf',
      document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Red1' })]).document,
      source: { format: 'cp', filename: 'projection.cp', path: null },
      foldProjection: JSON.parse(editableCpFoldText),
      sourceFold: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.2',
    });
    const fileService = createFileService({
      text: serializeNativeProjectFile(nativeProject),
      name: 'projection.osf',
      path: '/tmp/projection.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);
    useWorkspaceStore.setState({ dirty: true });
    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    const savedOptions = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
      | SaveTextFileOptions
      | undefined;
    const saved = parseNativeProjectFile(savedOptions?.contents ?? '');
    expect(saved.workspace.creasePattern?.creasePattern.foldProjection).not.toBeNull();
    expect(saved.workspace.creasePattern?.creasePattern.sourceFold).toBeNull();
  });

  it('preserves original Oriedita source identity when reopening and resaving OSF', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const sourceDocument = editableCpState([
      cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Red1' }),
    ]).document;
    sourceDocument.metadata = {
      'oriedita:ori:canvasModel': { lineColor: 'BLUE_2' },
    };
    const nativeProject = createNativeCreasePatternProjectFile({
      title: 'Native ORI project',
      filename: 'native.osf',
      path: '/tmp/native.osf',
      document: sourceDocument,
      source: { format: 'ori', filename: 'native.ori', path: '/tmp/native.ori' },
      foldProjection: JSON.parse(editableCpFoldText),
      sourceFold: null,
      foldArtifacts: null,
      creaseColorMode: 'mvf',
      selection: emptyOristudioCpSelection(),
      viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
      foldedFigures: [],
      activeFoldedFigureId: null,
      lineage: importedCpLineage(),
      appVersion: '0.1.2',
    });
    const fileService = createFileService({
      text: serializeNativeProjectFile(nativeProject),
      name: 'native.osf',
      path: '/tmp/native.osf',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(useWorkspaceStore.getState().importedCreasePattern?.source).toEqual({
      format: 'ori',
      filename: 'native.ori',
      path: '/tmp/native.ori',
    });
    expect(useWorkspaceStore.getState().oristudioCpDocument?.source).toEqual({
      format: 'osf',
      filename: 'native.osf',
      path: '/tmp/native.osf',
    });

    useWorkspaceStore.setState({ dirty: true });
    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    const savedOptions = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
      | SaveTextFileOptions
      | undefined;
    const savedProject = parseNativeProjectFile(savedOptions?.contents ?? '');
    expect(savedProject.workspace.creasePattern).toMatchObject({
      creasePattern: {
        source: {
          format: 'ori',
          filename: 'native.ori',
          path: '/tmp/native.ori',
        },
        document: {
          metadata: {
            'oriedita:ori:canvasModel': { lineColor: 'BLUE_2' },
          },
        },
      },
    });

    await expect(useWorkspaceStore.getState().exportOri(fileService)).resolves.toBe(true);
    expect(oristudioCpMocks.exportOristudioCpDocumentAsOri).toHaveBeenCalledOnce();
    await expect(useWorkspaceStore.getState().exportFold(fileService)).resolves.toBe(true);
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalledTimes(2);
  });

  it('opens legacy ORH documents and warns before saving back as ORH', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const orhText = '<タイトル>\nタイトル,orh model\n<線分集合>\n番号,1\n色,1\n座標,0,0,1,0\n';
    const fileService = createFileService({
      text: orhText,
      name: 'legacy.orh',
      path: '/tmp/legacy.orh',
    });

    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

    expect(oristudioCpMocks.loadOristudioCpDocumentFromText).toHaveBeenCalledWith(
      orhText,
      expect.objectContaining({
        format: 'orh',
        filename: 'legacy.orh',
        path: '/tmp/legacy.orh',
      })
    );
    expect(useWorkspaceStore.getState().importedCreasePattern?.source).toMatchObject({
      format: 'orh',
      filename: 'legacy.orh',
      path: '/tmp/legacy.orh',
    });

    useWorkspaceStore.setState({ dirty: true });
    const unregisterDialogHost = registerCommandDialogHost();
    try {
      const saveOrh = useWorkspaceStore.getState().saveProject(fileService);
      const dialog = useCommandDialogStore.getState().dialog;
      expect(dialog).toMatchObject({
        type: 'confirm',
        title: 'Export legacy ORH?',
        confirmLabel: 'Export ORH',
      });
      if (!dialog) throw new Error('expected ORH save confirmation');
      resolveCommandDialog(dialog.id, true);
      await expect(saveOrh).resolves.toBe(true);
    } finally {
      unregisterDialogHost();
    }

    expect(oristudioCpMocks.exportOristudioCpDocumentAsOrh).toHaveBeenCalledOnce();
    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Save Oriedita ORH Document',
        contents: '<タイトル>\nタイトル,square\n',
        suggestedName: 'legacy.orh',
        path: '/tmp/legacy.orh',
        extensions: ['orh'],
      })
    );
    expect(oristudioCpMocks.setOristudioCpDocumentSource).toHaveBeenCalledWith({
      format: 'orh',
      filename: 'legacy.orh',
      path: '/tmp/legacy.orh',
    });
  });

  it('surfaces typed Oristudio CP command errors without mutating the imported document', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });

    await expect(useWorkspaceStore.getState().executeOristudioCpCommand('DrawCreaseFree')).resolves.toBe(
      false
    );

    expect(oristudioCpMocks.executeOristudioCpCommand).toHaveBeenCalledWith('DrawCreaseFree', {});
    expect(useWorkspaceStore.getState().oristudioCpDocument?.source.filename).toBe('line.cp');
    expect(useWorkspaceStore.getState().oristudioCpError).toContain('DrawCreaseFree');
    expect(useWorkspaceStore.getState().error).toMatchObject({
      code: 'not_implemented',
    });
  });

  it('imports (adds) a crease pattern into the loaded editable document', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'base.cp',
      path: '/tmp/base.cp',
    });
    const historyBefore = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    const fileService = createFileService({
      text: '2 0 0 5 5',
      name: 'import.cp',
      path: '/tmp/import.cp',
    });

    await expect(
      useWorkspaceStore.getState().importAddCreasePattern(fileService)
    ).resolves.toBe(true);

    expect(fileService.openTextFile).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ['fold', 'cp', 'ori', 'orh'] })
    );
    expect(oristudioCpMocks.importAddOristudioCpDocumentFromText).toHaveBeenCalledWith(
      '2 0 0 5 5',
      { format: 'cp', filename: 'import.cp' }
    );
    // The merge is recorded so undo can revert the import.
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(historyBefore + 1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Import (add)');
  });

  it('rejects import (add) when the chosen file is not a crease pattern', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'base.cp',
      path: '/tmp/base.cp',
    });
    const fileService = createFileService({
      text: 'not a crease pattern',
      name: 'notes.txt',
      path: '/tmp/notes.txt',
    });

    await expect(
      useWorkspaceStore.getState().importAddCreasePattern(fileService)
    ).resolves.toBe(false);
    expect(oristudioCpMocks.importAddOristudioCpDocumentFromText).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().error).toMatchObject({ code: 'invalid_operation' });
  });

  it('disables import (add) without an editable crease pattern', async () => {
    resetStores(seedSnapshot());
    const fileService = createFileService({
      text: '2 0 0 5 5',
      name: 'import.cp',
      path: '/tmp/import.cp',
    });

    await expect(
      useWorkspaceStore.getState().importAddCreasePattern(fileService)
    ).resolves.toBe(false);
    expect(fileService.openTextFile).not.toHaveBeenCalled();
    expect(oristudioCpMocks.importAddOristudioCpDocumentFromText).not.toHaveBeenCalled();
  });

  it('passes selected editable CP line IDs into kernel commands and keeps stable color selections', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    useWorkspaceStore.setState({
      oristudioCpSelection: {
        lines: [1, 2],
        points: [],
        circles: [],
        texts: [],
        faces: [],
      },
    });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...currentDocument,
      document: {
        ...currentDocument.document,
        crease_pattern: {
          ...currentDocument.document.crease_pattern,
          line_segments: [
            {
              a: { x: 0, y: 0 },
              b: { x: 1, y: 0 },
              active: 'Inactive0',
              color: 'Red1',
              selected: 0,
              customized: 0,
              customized_color: { red: 100, green: 200, blue: 200 },
            },
            {
              a: { x: 0, y: 0 },
              b: { x: 0, y: 1 },
              active: 'Inactive0',
              color: 'Red1',
              selected: 0,
              customized: 0,
              customized_color: { red: 100, green: 200, blue: 200 },
            },
          ],
        },
      },
      lastCommandResult: {
        operation: 'CreaseMakeMountain',
        status: 'OracleTested',
        diagnostics: ['Changed 2 line(s)'],
      },
    });

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('CreaseMakeMountain', {
        line_ids: [1, 2],
      })
    ).resolves.toBe(true);

    expect(oristudioCpMocks.executeOristudioCpCommand).toHaveBeenCalledWith(
      'CreaseMakeMountain',
      { line_ids: [1, 2] }
    );
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1, 2]);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('stale');
    expect(useWorkspaceStore.getState().foldArtifacts).toBeNull();
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).not.toHaveBeenCalled();

    await expect(useWorkspaceStore.getState().ensureFoldArtifacts()).resolves.toBeTruthy();

    // Editable-CP simulation faces are inferred in JS from the exported fold.
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalledOnce();
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('ready');
    expect(
      useWorkspaceStore.getState().foldArtifacts?.simulation_model?.fold.faces_vertices
    ).toHaveLength(2);
  });

  it('tracks generated folded figures and records the region they were folded from', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });

    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

    const foldedFigure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
    expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(
      1,
      'Order5',
      undefined,
      [1],
      A_RUN_ID
    );
    // A fresh fold is neither selected on the canvas nor marked selected by the
    // kernel renderer, so it doesn't steal delete-key focus the moment it lands.
    expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).toHaveBeenCalledWith(
      7,
      'Paper5',
      {
        display_mark: false,
        selected: false,
        index: 1,
      }
    );
    expect(foldedFigure).toMatchObject({
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      renderSnapshot: foldedRenderSnapshot(),
    });
    // Parked clear of the creases it was folded from — not the nominal paper
    // square — since the kernel folds into roughly the flat CP's own coords and
    // an unplaced figure covers the pattern it came from.
    const anchor = cpUserAnchorForLineIds(
      useWorkspaceStore.getState().oristudioCpDocument!.document,
      [1]
    );
    const placedBounds = foldedFigureUserBounds([foldedFigure])[0].bounds;
    expect(placedBounds.minX).toBeGreaterThanOrEqual(anchor.right);
    expect(placedBounds.minY).toBeCloseTo(anchor.top);
    expect(foldedFigure.placement.scale).toBe(1);
    expect(foldedFigure.placement.rotation).toBe(0);
    // Not selected on arrival, so the delete key doesn't retarget to it.
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    // ...and the creases it was folded from are deselected, so a delete right
    // after folding doesn't take them with it.
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);

    // The fold records where its creases were, so it can later be compared
    // against a fresh reselect of that region (Oriedita's refold check, ported
    // per figure — see lib/foldedFigureStaleness.ts).
    expect(foldedFigure.sourceBounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 0 });
    expect(foldedFigure.sourceLineIds).toEqual([1]);
    expect(foldedFigure.sourceFingerprint).toEqual(expect.any(String));

    // An edit clear of that region leaves the figure alone. The flag this
    // replaced marked *every* figure stale on *any* edit, which is both wrong
    // and useless for deciding whether a refold is warranted.
    insertAppendsToDocument();
    await expect(
      useWorkspaceStore.getState().insertOristudioCpLineSegments([
        cpLine({ x: 5, y: 5 }, { x: 6, y: 6 }),
      ])
    ).resolves.toBe(true);
    expect(
      isFoldedFigureStale(
        useWorkspaceStore.getState().oristudioCpDocument!.document,
        useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!
      )
    ).toBe(false);

    // An edit touching the region does mark it out of date.
    insertAppendsToDocument();
    await expect(
      useWorkspaceStore.getState().insertOristudioCpLineSegments([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 1 }),
      ])
    ).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpRevision).toBe(2);
    expect(
      isFoldedFigureStale(
        useWorkspaceStore.getState().oristudioCpDocument!.document,
        useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!
      )
    ).toBe(true);
    // Status stays `ready`: the kernel handle is still valid, it was just folded
    // from creases that have since moved. Upstream likewise keeps folding the
    // handle it has (FoldingServiceImpl holds its own lineSegmentsForFolding).
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]).toMatchObject({
      id: foldedFigure.id,
      handle: 7,
      status: 'ready',
    });
    await expect(useWorkspaceStore.getState().foldAnotherOristudioCpFigure()).resolves.toBe(true);
  });

  // The toolbar's Simulate names a sheet of the index by position; the Simulate
  // workspace keeps it by outline, so an edit that renumbers the sheets keeps it.
  describe('simulating one sheet in the Simulate workspace', () => {
    function seedUnitSquare() {
      const activatePanel = vi.fn();
      useLayoutStore.setState({ activatePanel });
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine({ x: 1, y: 0 }, { x: 1, y: 1 }, { color: 'Black0' }),
          cpLine({ x: 1, y: 1 }, { x: 0, y: 1 }, { color: 'Black0' }),
          cpLine({ x: 0, y: 1 }, { x: 0, y: 0 }, { color: 'Black0' }),
          cpLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { color: 'Red1' }),
        ]),
      });
      return { activatePanel };
    }

    it('keeps the sheet by its outline and opens the simulator, meshing nothing yet', async () => {
      resetStores(seedSnapshot());
      const { activatePanel } = seedUnitSquare();

      await expect(useWorkspaceStore.getState().simulateOristudioCpSheet(0)).resolves.toBe(true);

      expect(useWorkspaceStore.getState().oristudioCpSimulateSheet).toEqual({
        boundary: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]],
        bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
        segmentIdHint: 0,
      });
      expect(activatePanel).toHaveBeenCalledWith('simulator');
      // The workspace builds the one sheet's mesh when it shows it; nothing here
      // segments the canvas.
      expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).not.toHaveBeenCalled();
    });

    it('refuses a sheet the index does not have, and stays put', async () => {
      resetStores(seedSnapshot());
      const { activatePanel } = seedUnitSquare();

      await expect(useWorkspaceStore.getState().simulateOristudioCpSheet(1)).resolves.toBe(false);

      expect(activatePanel).not.toHaveBeenCalled();
    });
  });

  // `G` routes on the creases it is scoped to. A selection carrying a non-180
  // fold angle goes to the computed 3D folder; one that does not goes to the
  // flat folder, whatever the rest of the document looks like. A 3D fold that is
  // refused offers the simulator instead — unconditionally, and inline.
  describe('routing a press of G between the flat and 3D folders', () => {
    const BORDER = [
      cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
      cpLine({ x: 1, y: 0 }, { x: 1, y: 1 }, { color: 'Black0' }),
      cpLine({ x: 1, y: 1 }, { x: 0, y: 1 }, { color: 'Black0' }),
      cpLine({ x: 0, y: 1 }, { x: 0, y: 0 }, { color: 'Black0' }),
    ];

    const diagonal = (magnitude?: number) =>
      cpLine(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        magnitude === undefined
          ? { color: 'Red1' }
          : { color: 'Red1', fold_magnitude: magnitude }
      );

    /** The unit square of `editableCpFoldText`, with its diagonal folded to 90°. */
    function nonFlatSquare() {
      return editableCpState([
        ...BORDER,
        diagonal(90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE),
      ]);
    }

    const WHOLE_REGION = [1, 2, 3, 4, 5];

    function seedDocument(state: OristudioCpDocumentState, lines: number[]) {
      const activatePanel = vi.fn();
      useLayoutStore.setState({ activatePanel });
      useWorkspaceStore.setState({
        oristudioCpDocument: state,
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
      });
      return { activatePanel };
    }

    /**
     * The next dialog the store raises, or null.
     *
     * Polled rather than read synchronously: the 3D refusal dialog opens *after*
     * the kernel answers, which is the whole point of the branch — no draft
     * figure is written and nothing is asked until there is something to ask
     * about.
     */
    async function nextDialog() {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const dialog = useCommandDialogStore.getState().dialog;
        if (dialog) return dialog;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return null;
    }

    /** Fold `lines`, answer the refusal dialog, and report what the panel saw. */
    async function foldAndAnswer(lines: number[], simulate: boolean) {
      const { activatePanel } = seedDocument(nonFlatSquare(), lines);
      oristudioCpMocks.fold3dOristudioCpDocument.mockResolvedValueOnce({
        status: 'refused',
        refusal: { code: 'faces_unresolved' },
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = await nextDialog();
        expect(dialog).toMatchObject({
          type: 'confirm',
          title: 'This pattern can’t be folded in 3D',
          confirmLabel: 'Simulate',
        });
        if (!dialog) throw new Error('expected the 3D refusal confirmation');
        resolveCommandDialog(dialog.id, simulate);
        // False either way: no figure was produced.
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }
      return { activatePanel };
    }

    it('folds a wholly classic selection flat even when the document is not', async () => {
      // Row (b), and the one easiest to break: the arrangement is built only
      // from the scoped segments, so the 90° diagonal elsewhere in this document
      // is not in it. A document-wide predicate gets exactly this wrong.
      resetStores(seedSnapshot());
      seedDocument(editableCpState([...BORDER, diagonal()]), [1, 2, 3, 4]);

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      expect(oristudioCpMocks.fold3dOristudioCpDocument).not.toHaveBeenCalled();
      expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(
        1,
        'Order5',
        undefined,
        [1, 2, 3, 4],
        A_RUN_ID
      );
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.folded3d ?? null).toBeNull();
    });

    it('folds a mixed selection in 3D', async () => {
      // Row (d). The classic creases are ±180 within the same placement walk —
      // a box with flat-folded flaps is an ordinary design, not an edge case.
      resetStores(seedSnapshot());
      seedDocument(nonFlatSquare(), WHOLE_REGION);

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      expect(oristudioCpMocks.foldOristudioCpDocument).not.toHaveBeenCalled();
      expect(oristudioCpMocks.fold3dOristudioCpDocument).toHaveBeenCalledWith(
        WHOLE_REGION,
        1,
        undefined,
        A_RUN_ID
      );
      const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      // Exactly one witness. Both non-null is the state the whole UI would then
      // read two ways.
      expect(figure?.folded3d).not.toBeNull();
      expect(figure?.snapshot).toBeNull();
      expect(figure?.status).toBe('ready');
      // Built here, not fetched from the kernel: the 3D door has no render
      // command, and asking the flat one is a kind mismatch. A scene, not a
      // render snapshot — that field is the flat figure's now.
      expect(figure?.scene?.items.length).toBeGreaterThan(0);
      expect(figure?.renderSnapshot).toBeNull();
      expect(figure?.camera).toBeTruthy();
    });

    it('routes a black crease carrying a fold angle to the 3D folder', async () => {
      // The kernel's `is_classic_crease` is colour-blind, so this must be too.
      // Constructors normalise a magnitude off a non-crease colour, but the
      // field is deserialized and the share codec copies it without consulting
      // the colour — so it survives a file. Under the old `isFoldingCrease`
      // conjunct this routed flat and the kernel answered `fold_needs_3d`.
      resetStores(seedSnapshot());
      seedDocument(
        editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine(
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { color: 'Black0', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
          ),
        ]),
        [1, 2]
      );

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      expect(oristudioCpMocks.fold3dOristudioCpDocument).toHaveBeenCalled();
      expect(oristudioCpMocks.foldOristudioCpDocument).not.toHaveBeenCalled();
    });

    it('asks for a selection when nothing foldable is scoped', async () => {
      // Row (e), reached here through the colour filter rather than an empty
      // selection: an aux-coloured line is selected and is not foldable.
      resetStores(seedSnapshot());
      seedDocument(
        editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Cyan3' })]),
        [1]
      );

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(false);

      expect(useWorkspaceStore.getState().oristudioCpError).toBe(
        'Select one or more foldable crease-pattern lines first'
      );
      expect(oristudioCpMocks.fold3dOristudioCpDocument).not.toHaveBeenCalled();
      expect(oristudioCpMocks.foldOristudioCpDocument).not.toHaveBeenCalled();
    });

    it('simulates inline instead of sending the user to the Simulate panel', async () => {
      resetStores(seedSnapshot());
      const { activatePanel } = await foldAndAnswer(WHOLE_REGION, true);

      const simulations = useWorkspaceStore.getState().oristudioCpInlineSimulations;
      expect(simulations).toHaveLength(1);
      // Built from the region that was being folded — the whole square, not just
      // the creases the fold would have consumed.
      expect(simulations[0]?.sourceBounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
      expect(simulations[0]?.sourceBoundary?.length).toBeGreaterThan(0);
      // The new window takes the canvas selection, as it does from the toolbar.
      expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBe(
        simulations[0]?.id
      );
      expect(activatePanel).not.toHaveBeenCalled();
      // No figure was produced.
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    });

    it('does nothing when the dialog is dismissed', async () => {
      resetStores(seedSnapshot());
      const { activatePanel } = await foldAndAnswer(WHOLE_REGION, false);

      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toEqual([]);
      expect(activatePanel).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    });

    it('leaves no error and no debris behind a refusal', async () => {
      // A refusal is a *result*. Writing `error` would raise a global error
      // toast, and a draft figure would have taken the canvas selection — so
      // declining would silently destroy the creases the user still has picked.
      resetStores(seedSnapshot());
      await foldAndAnswer(WHOLE_REGION, false);

      expect(useWorkspaceStore.getState().error).toBeNull();
      expect(useWorkspaceStore.getState().oristudioCpError).toBeNull();
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual(WHOLE_REGION);
    });

    /**
     * A refusal at a vertex the always-on overlay is already reporting on — the
     * `solve/failure_case.osf` shape, minimised.
     *
     * The two numbers are the measured ones from that file, and they disagree on
     * purpose: 70.53 is the folder's, taken after `selected_folding_segments`
     * dropped the undecided crease, and 65.96 is the document's own. The dialog
     * must publish neither and hand over the row that owns the second.
     */
    const CLOSURE_UNREACHABLE_ROW: OristudioCpDiagnosticEntry = {
      id: 'SpatialClosureUnreachable-10',
      kind: 'SpatialClosure',
      severity: 'error',
      message: 'No angle for the undecided crease here closes this vertex',
      rule: 'ClosureUnreachable',
      residual_degrees: 65.9579,
      point: { x: 0.5, y: 0.5 },
    };

    function seedRefusalAtAReportedVertex(entry = CLOSURE_UNREACHABLE_ROW) {
      seedDocument(nonFlatSquare(), WHOLE_REGION);
      useWorkspaceStore.setState({
        oristudioCpCamvResult: {
          operation: 'CheckCamv',
          status: 'OracleTested',
          diagnostics: [],
          diagnostic_entries: [entry],
        },
      });
      oristudioCpMocks.fold3dOristudioCpDocument.mockResolvedValueOnce({
        status: 'refused',
        refusal: {
          code: 'vertex_closure',
          point: { x: 0.5, y: 0.5 },
          residual_degrees: 70.5288,
        },
      });
    }

    it('offers the vertex the refusal named instead of a number nobody can place', async () => {
      resetStores(seedSnapshot());
      const frameModelBounds = vi.fn();
      unregisterCamera = registerCpCamera({
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        fit: vi.fn(),
        setZoomPercent: vi.fn(),
        rotateBy: vi.fn(),
        rotateTo: vi.fn(),
        rotateReset: vi.fn(),
        frameModelBounds,
      });
      seedRefusalAtAReportedVertex();
      // The overlay hidden, which is the case that would have found no entry if
      // the offer were built from what is visible right now.
      useWorkspaceStore.getState().setOristudioCpViewportOption('camvIssuesVisible', false);

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = await nextDialog();
        expect(dialog).toMatchObject({
          type: 'choice',
          title: 'This pattern can’t be folded in 3D',
          // The fact, and not the folder's residual measured on a fan the
          // document does not have.
          message: 'The creases at one vertex do not close up.',
        });
        if (!dialog || dialog.type !== 'choice') throw new Error('expected the refusal choice');
        expect(dialog.options.map((option) => option.id)).toEqual(['locate', 'simulate']);
        expect(dialog.options[0]?.label).toBe('Show me the vertex');
        expect(dialog.message).not.toContain('70');
        resolveCommandDialog(dialog.id, 'locate');
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }

      const state = useWorkspaceStore.getState();
      expect(state.oristudioCpActiveDiagnosticId).toBe('SpatialClosureUnreachable-10');
      // Revealed *and* framed. Activating without revealing first resolves the
      // entry through the same visibility rule and jumps nowhere.
      expect(state.oristudioCpViewport.camvIssuesVisible).toBe(true);
      expect(frameModelBounds).toHaveBeenCalledTimes(1);
      // Still a refusal: no figure, no simulation, no error.
      expect(state.oristudioCpFoldedFigures).toEqual([]);
      expect(state.oristudioCpInlineSimulations).toEqual([]);
      expect(state.error).toBeNull();
      // Its own verdict, not a `cancelled`: this user went to fix the pattern,
      // and folding the two together makes the offer unmeasurable.
      expect(
        analyticsMocks.track.mock.calls
          .filter(([name]) => name === 'fold completed')
          .map(([, properties]) => properties)
      ).toMatchObject([{ verdict: 'located', refusal: 'vertex_closure', located_by: 'row' }]);
    });

    it('warns the reader when the row it hands over reads the vertex differently', async () => {
      // The refusal is measured on a fan `selected_folding_segments` built after
      // dropping the undecided crease; the row is measured on the document with
      // that crease in it, and it has the answer. Two claims about one vertex,
      // so the offer says which one is waiting on the other side rather than
      // letting the user find out by clicking — and it is still offered, because
      // withholding it puts "which vertex?" back where it started.
      resetStores(seedSnapshot());
      seedRefusalAtAReportedVertex({
        id: 'SpatialUndecided-4',
        kind: 'SpatialUndecided',
        severity: 'info',
        message: 'Undecided: setting this crease to -70.5288 degrees closes this vertex',
        rule: 'Undecided',
        fold_angle_degrees: -70.5288,
        point: { x: 0.5, y: 0.5 },
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = await nextDialog();
        if (!dialog || dialog.type !== 'choice') throw new Error('expected the refusal choice');
        expect(dialog.options[0]).toMatchObject({
          id: 'locate',
          label: 'Show me the vertex',
          // The disagreement is a *prefix*: the sentence describing the action
          // itself is the same one the agreeing branch shows, from the same key.
          description:
            'The foldability check reads it differently: Set this crease to -70.53° and this vertex closes. ' +
            'Zooms to it on the crease pattern and turns on the foldability issues.',
        });
        resolveCommandDialog(dialog.id, 'locate');
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }

      expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe('SpatialUndecided-4');
    });

    it('still simulates from the choice dialog', async () => {
      resetStores(seedSnapshot());
      seedRefusalAtAReportedVertex();

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = await nextDialog();
        if (!dialog) throw new Error('expected the refusal choice');
        resolveCommandDialog(dialog.id, 'simulate');
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }

      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(1);
      expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBeNull();
    });

    it('shows the place itself when the refusal names one nothing reports on', async () => {
      // Measured, this is the *common* case for a scoped fold, not the margin:
      // over 5,100 region-shaped refusals across the Tier A corpus the overlay
      // had a row at the named place 121 times, and three quarters of the misses
      // were in documents it reports nothing about at all. Withholding the offer
      // here put those users back on a dialog that says a vertex is broken and
      // not which — the complaint the offer exists to answer.
      resetStores(seedSnapshot());
      const frameModelBounds = vi.fn();
      unregisterCamera = registerCpCamera({
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        fit: vi.fn(),
        setZoomPercent: vi.fn(),
        rotateBy: vi.fn(),
        rotateTo: vi.fn(),
        rotateReset: vi.fn(),
        frameModelBounds,
      });
      seedDocument(nonFlatSquare(), WHOLE_REGION);
      oristudioCpMocks.fold3dOristudioCpDocument.mockResolvedValueOnce({
        status: 'refused',
        refusal: { code: 'vertex_closure', point: { x: 0.5, y: 0.5 }, residual_degrees: 70.5288 },
      });
      // Hidden, so "did not turn it on" is a statement the assertion can make.
      useWorkspaceStore.getState().setOristudioCpViewportOption('camvIssuesVisible', false);

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = await nextDialog();
        if (!dialog || dialog.type !== 'choice') throw new Error('expected the refusal choice');
        // The residual is still gone, which is a property of the sentence and not
        // of which dialog carries it.
        expect(dialog.message).toBe('The creases at one vertex do not close up.');
        expect(dialog.options[0]).toMatchObject({
          id: 'locate',
          label: 'Show me the vertex',
          description:
            'Zooms to it on the crease pattern. The foldability check lists no issue there.',
        });
        resolveCommandDialog(dialog.id, 'locate');
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }

      const state = useWorkspaceStore.getState();
      // Framed, on the point the kernel named.
      expect(frameModelBounds).toHaveBeenCalledTimes(1);
      expect(frameModelBounds.mock.calls[0][0]).toMatchObject({ minX: 0.5, minY: 0.5 });
      // And nothing else touched: there is no row to activate, and switching on
      // an overlay with nothing to draw here is a state change the user did not
      // ask for and cannot see the point of.
      expect(state.oristudioCpActiveDiagnosticId).toBeNull();
      expect(state.oristudioCpViewport.camvIssuesVisible).toBe(false);
      expect(
        analyticsMocks.track.mock.calls
          .filter(([name]) => name === 'fold completed')
          .map(([, properties]) => properties)
      ).toMatchObject([{ verdict: 'located', refusal: 'vertex_closure', located_by: 'point' }]);
    });

    it('falls back to the Simulate panel when the fold is not scoped to one region', async () => {
      // The folded-figure inspector folds whatever creases are selected, which
      // need not be a closed piece of paper — and only a closed one can be
      // simulated inline. The button still has to do something.
      resetStores(seedSnapshot());
      const { activatePanel } = await foldAndAnswer([5], true);

      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toEqual([]);
      expect(activatePanel).toHaveBeenCalledWith('simulator');
    });

    it('splits the pre-fold warning copy by regime', async () => {
      // Same check, same scope, same toggle — but "errors in flat foldability"
      // is a false description of a document whose creases are not flat.
      resetStores(seedSnapshot());
      seedDocument(nonFlatSquare(), WHOLE_REGION);
      oristudioCpMocks.runOristudioCpCheckCommand.mockResolvedValueOnce({
        operation: 'CheckCamv',
        status: 'OracleTested',
        diagnostics: [],
        diagnostic_entries: [
          { id: 'v1', severity: 'error', message: 'nope', rule: 'Closure', kind: 'SpatialClosure' },
        ],
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = await nextDialog();
        expect(dialog).toMatchObject({
          message: 'Detected errors in how these creases fold. Continue to fold?',
        });
        if (!dialog) throw new Error('expected the fold warning');
        resolveCommandDialog(dialog.id, { confirmed: false, optionChecked: false });
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }
    });
  });

  describe('the folded-figure verbs on a 3D figure', () => {
    async function fold3dFigure() {
      resetStores(seedSnapshot());
      useLayoutStore.setState({ activatePanel: vi.fn() });
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine(
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
          ),
        ]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2] },
      });
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
      const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      if (!figure) throw new Error('expected a 3D folded figure');
      return figure;
    }

    it('advances through the 3D solution stream, not the flat one', async () => {
      const figure = await fold3dFigure();

      await expect(
        useWorkspaceStore.getState().foldAnotherOristudioCpFigure(figure.id)
      ).resolves.toBe(true);

      expect(oristudioCpMocks.fold3dOristudioCpFigureAnother).toHaveBeenCalledWith(11, A_RUN_ID);
      expect(oristudioCpMocks.foldOristudioCpFigureAnother).not.toHaveBeenCalled();
      const advanced = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(advanced?.folded3d?.current_fold_case).toBe(2);
      expect(advanced?.snapshot).toBeNull();
    });

    it('records the scoped ids beside the folded ones, unfiltered', async () => {
      // Two lists, because neither derives from the other. The kernel is handed
      // foldable colours only and reports crossings as indices into *that*
      // list; a region is matched by every crease inside it, aux lines
      // included, so only the unfiltered list can resolve one. Feeding the
      // filtered list to `resolveInlineSimulationRegion` is what sent the
      // verdict chip's "Simulate instead" to the Simulate panel.
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine(
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
          ),
          // A construction line inside the same region. Not foldable, so the
          // kernel never sees it — but the region does not exist without it.
          cpLine({ x: 0, y: 1 }, { x: 1, y: 1 }, { color: 'Cyan3' }),
        ]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2, 3] },
      });

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(figure?.folded3d).not.toBeNull();
      expect(figure?.sourceLineIds).toEqual([1, 2]);
      expect(figure?.sourceScopedLineIds).toEqual([1, 2, 3]);
    });

    it('duplicates through the 3D command', async () => {
      const figure = await fold3dFigure();

      await expect(
        useWorkspaceStore.getState().duplicateOristudioCpFoldedFigure(figure.id)
      ).resolves.toBe(true);

      expect(oristudioCpMocks.duplicateOristudioCp3dFoldedFigure).toHaveBeenCalledWith(11);
      expect(oristudioCpMocks.duplicateOristudioCpFoldedFigure).not.toHaveBeenCalled();
      const copy = useWorkspaceStore.getState().oristudioCpFoldedFigures[1];
      expect(copy?.handle).toBe(12);
      expect(copy?.folded3d).not.toBeNull();
      expect(copy?.snapshot).toBeNull();
    });

    it('re-projects a display-style change instead of asking the kernel', async () => {
      const figure = await fold3dFigure();
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockClear();

      await expect(
        useWorkspaceStore.getState().setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Wire2')
      ).resolves.toBe(true);

      // `folded_figure_render_snapshot` takes `flat(handle)`; reaching it would
      // be caught below and written onto the entry as `status: 'error'`,
      // destroying a good figure over a style click.
      expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).not.toHaveBeenCalled();
      const styled = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(styled?.displayStyle).toBe('Wire2');
      expect(styled?.status).toBe('ready');
    });

    it('moves the eye to the other side and re-projects, without the kernel', async () => {
      // The 3D reading of Flip. `antipodalCamera` was written and tested in
      // Phase 6 and then left unreachable, so the reverse of the paper could
      // never be looked at; this is the verb that reaches it.
      const figure = await fold3dFigure();
      const before = figure.camera;
      if (!before) throw new Error('expected a folded camera');
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockClear();

      await expect(
        useWorkspaceStore
          .getState()
          .setOristudioCpFolded3dCamera(figure.id, foldedFigureOtherSideCamera(before))
      ).resolves.toBe(true);

      const turned = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(turned?.camera?.yaw).toBeCloseTo(before.yaw + Math.PI, 12);
      expect(turned?.camera?.pitch).toBeCloseTo(Math.PI - before.pitch, 12);
      // A 3D figure's picture is made in the frontend, so nothing is asked of
      // the kernel — the flat command would reject a spatial handle anyway.
      expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).not.toHaveBeenCalled();
      expect(turned?.scene).not.toEqual(figure.scene);
      expect(turned?.status).toBe('ready');
    });

    it('refuses to move a flat figure’s eye', async () => {
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      });
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
      const flat = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
      expect(flat.snapshot).not.toBeNull();

      await expect(
        useWorkspaceStore
          .getState()
          .setOristudioCpFolded3dCamera(flat.id, { yaw: 1, pitch: 1, zoom: 1 })
      ).resolves.toBe(false);
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.camera ?? null).toBeNull();
    });

    it('refuses to batch a 3D figure to a numbered case', async () => {
      const figure = await fold3dFigure();

      await expect(
        useWorkspaceStore.getState().foldOristudioCpFigureToCase(figure.id, 3)
      ).resolves.toBe(false);

      expect(oristudioCpMocks.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().oristudioCpError).toBe(
        'A 3D folded model has no numbered solutions to batch to'
      );
    });

    it('swaps kind in place when a refold changes what the creases are', async () => {
      const figure = await fold3dFigure();
      // Take the fold angle away: the same region now folds flat.
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { color: 'Red1' }),
        ]),
      });

      await expect(
        useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(figure.id)
      ).resolves.toBe(true);

      const flat = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(flat?.snapshot).not.toBeNull();
      // Both non-null is the state that would leave the UI reading the figure
      // two ways at once.
      expect(flat?.folded3d ?? null).toBeNull();
    });

    it('swaps a flat figure to 3D when its creases gain an angle', async () => {
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      });
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
      const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
      expect(figure.snapshot).not.toBeNull();

      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine(
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
          ),
        ]),
      });

      await expect(
        useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(figure.id)
      ).resolves.toBe(true);

      const spatial = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(spatial?.folded3d).not.toBeNull();
      expect(spatial?.snapshot).toBeNull();
    });

    /**
     * A wrap is reported as a wrap on either kind of figure.
     *
     * The store reads the direction from the figure's cycling state *before* the
     * press, through `foldedFigureCycling` — the one place that knows a figure
     * has two kinds — so the label the user saw, the branch the kernel takes and
     * the event we record all agree about which of the two a press was. Reading
     * it after would report the direction of the press *following* this one.
     */
    it('calls the last press a wrap, on a 3D figure exactly as on a flat one', async () => {
      const exhausted = {
        find_another_overlap_valid: false,
        discovered_fold_cases: 4,
        current_fold_case: 4,
      };

      const figure = await fold3dFigure();
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: useWorkspaceStore
          .getState()
          .oristudioCpFoldedFigures.map((candidate) =>
            candidate.id === figure.id
              ? { ...candidate, folded3d: { ...candidate.folded3d!, ...exhausted } }
              : candidate
          ),
      });
      oristudioCpMocks.fold3dOristudioCpFigureAnother.mockResolvedValueOnce({
        snapshot: folded3dSnapshot({ discovered_fold_cases: 4, current_fold_case: 1 }),
        render: folded3dRenderModelFixture(),
        advanced: false,
      });

      await expect(
        useWorkspaceStore.getState().foldAnotherOristudioCpFigure(figure.id)
      ).resolves.toBe(true);
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.folded3d?.current_fold_case)
        .toBe(1);
      const cycled = () =>
        analyticsMocks.track.mock.calls
          .filter(([name]) => name === 'fold solution cycled')
          .map(([, properties]) => properties);
      const spatialEvents = cycled();

      // The same state on a flat figure, through the same action.
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      });
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
      const flat = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [
          { ...flat, snapshot: { ...flat.snapshot!, ...exhausted } },
        ],
      });
      await expect(
        useWorkspaceStore.getState().foldAnotherOristudioCpFigure(flat.id)
      ).resolves.toBe(true);

      expect(spatialEvents).toEqual([{ direction: 'wrap', solution_count_bucket: '<=5' }]);
      expect(cycled()).toEqual(spatialEvents);
    });

    it('simulates the region a verdict names, with the same region rule', async () => {
      // The 'Simulate instead' a `no_layer_order` verdict offers goes through
      // the same helper the refusal does, so it inherits the border-enclosed
      // region constraint and the Simulate-panel fallback rather than getting a
      // second, looser path of its own.
      resetStores(seedSnapshot());
      const activatePanel = vi.fn();
      useLayoutStore.setState({ activatePanel });
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine({ x: 1, y: 0 }, { x: 1, y: 1 }, { color: 'Black0' }),
          cpLine({ x: 1, y: 1 }, { x: 0, y: 1 }, { color: 'Black0' }),
          cpLine({ x: 0, y: 1 }, { x: 0, y: 0 }, { color: 'Black0' }),
          cpLine(
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
          ),
        ]),
      });

      await useWorkspaceStore.getState().simulateOristudioCpCreaseRegion([1, 2, 3, 4, 5]);
      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(1);
      expect(activatePanel).not.toHaveBeenCalled();

      // Not one whole region: the panel, not silence.
      await useWorkspaceStore.getState().simulateOristudioCpCreaseRegion([5]);
      expect(activatePanel).toHaveBeenCalledWith('simulator');
    });

    it('sends every live 3D figure to the FOLD export, and never a detached one', async () => {
      const figure = await fold3dFigure();
      const fileService = createFileService();
      // `resetStores` leaves the engine mid-load; the export capability is
      // gated on that, and this test is about which handles cross, not about
      // the gate.
      useWorkspaceStore.setState({ status: 'ready' });
      await expect(useWorkspaceStore.getState().exportFold(fileService)).resolves.toBe(true);
      expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenLastCalledWith(
        expect.anything(),
        [figure.handle]
      );

      // A figure reopened from an `.osf` has no kernel session to describe it,
      // so it is left out rather than sent as a null handle — and the user is
      // told, rather than the figure going quietly.
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [{ ...figure, handle: null }],
      });
      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const pending = useWorkspaceStore.getState().exportFold(fileService);
        const dialog = useCommandDialogStore.getState().dialog;
        if (!dialog || dialog.type !== 'confirm') {
          throw new Error('expected an export-loss confirmation');
        }
        expect(dialog.message).toContain('3D folded figures needing a refold');
        resolveCommandDialog(dialog.id, true);
        await expect(pending).resolves.toBe(true);
      } finally {
        unregisterDialogHost();
      }
      expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenLastCalledWith(
        expect.anything(),
        []
      );
    });

    it('keeps the old figure and raises no dialog when a refold is refused', async () => {
      const figure = await fold3dFigure();
      oristudioCpMocks.fold3dOristudioCpDocument.mockResolvedValueOnce({
        status: 'refused',
        refusal: { code: 'disconnected', reached: 1, unreached: 1 },
      });
      const unregisterDialogHost = registerCommandDialogHost();
      try {
        await expect(
          useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(figure.id)
        ).resolves.toBe(false);
        // A stale refold can run in the background; a background action must
        // never raise a modal.
        expect(useCommandDialogStore.getState().dialog).toBeNull();
      } finally {
        unregisterDialogHost();
      }
      const kept = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
      expect(kept?.folded3d).not.toBeNull();
      expect(kept?.status).toBe('ready');
    });

    describe('rehydrating a reopened 3D figure', () => {
      /**
       * A figure as a file gives it back: the picture, the camera and the frame,
       * with no kernel session and no geometry behind them. Produced by folding
       * one and then taking those away, so the entry is exactly what the app
       * would have written and read back.
       */
      async function reopened3dFigure(
        overrides: Partial<OristudioCpFoldedFigureEntry> = {}
      ) {
        const folded = await fold3dFigure();
        dropFolded3dRenderModel(folded.handle);
        const entry: OristudioCpFoldedFigureEntry = {
          ...folded,
          handle: null,
          ...overrides,
        };
        useWorkspaceStore.setState({
          oristudioCpFoldedFigures: [entry],
          oristudioCpHistoryPast: [],
          dirty: false,
        });
        oristudioCpMocks.fold3dOristudioCpDocument.mockClear();
        oristudioCpMocks.fold3dOristudioCpFigureAnother.mockClear();
        oristudioCpMocks.freeOristudioCpFoldedFigure.mockClear();
        return entry;
      }

      const figureNow = () => useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

      it('makes a reopened figure live without touching what it draws', async () => {
        const before = await reopened3dFigure();
        expect(folded3dRenderModel(before.handle)).toBeUndefined();

        await expect(
          useWorkspaceStore.getState().rehydrateOristudioCpFolded3dFigure(before.id)
        ).resolves.toBe(true);

        const after = figureNow();
        // The point of the whole phase: geometry to re-project from.
        expect(after.handle).not.toBeNull();
        expect(folded3dRenderModel(after.handle)).toBeDefined();
        // And the point of doing it quietly: everything the user can see is the
        // same object it was.
        expect(after.renderSnapshot).toBe(before.renderSnapshot);
        expect(after.camera).toBe(before.camera);
        expect(after.placement).toBe(before.placement);
        expect(after.frameRadius).toBe(before.frameRadius);
        expect(after.displayStyle).toBe(before.displayStyle);
        expect(after.status).toBe('ready');
        // Nothing happened, as far as the document is concerned. A rehydrate
        // that dirtied the file would make opening one a reason to save it, and
        // an undo entry would make it a thing to undo past.
        expect(useWorkspaceStore.getState().dirty).toBe(false);
        expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(0);
        expect(useWorkspaceStore.getState().oristudioCpError).toBeNull();
      });

      it('leaves a stale figure alone', async () => {
        const figure = await reopened3dFigure({
          // The fingerprint no longer matches the creases the reselect finds,
          // which is exactly what staleness means.
          sourceFingerprint: 'folded-from-creases-that-have-since-moved',
        });
        expect(
          isFoldedFigureStale(
            useWorkspaceStore.getState().oristudioCpDocument!.document,
            figure
          )
        ).toBe(true);

        await expect(
          useWorkspaceStore.getState().rehydrateOristudioCpFolded3dFigure(figure.id)
        ).resolves.toBe(false);
        // Not "folded and then discarded" — never folded at all. Refolding a
        // stale figure is what the explicit Refold verb is for, and it replaces
        // the picture on purpose.
        expect(oristudioCpMocks.fold3dOristudioCpDocument).not.toHaveBeenCalled();
        expect(figureNow().handle).toBeNull();
      });

      it('steps a fresh session back to the solution the figure was saved showing', async () => {
        const figure = await reopened3dFigure({
          folded3d: folded3dSnapshot({ discovered_fold_cases: 3, current_fold_case: 3 }),
        });
        oristudioCpMocks.fold3dOristudioCpFigureAnother
          .mockResolvedValueOnce({
            snapshot: folded3dSnapshot({ discovered_fold_cases: 2, current_fold_case: 2 }),
            render: folded3dRenderModelFixture(),
            advanced: true,
          })
          .mockResolvedValueOnce({
            snapshot: folded3dSnapshot({ discovered_fold_cases: 3, current_fold_case: 3 }),
            render: folded3dRenderModelFixture(),
            advanced: true,
          });

        await expect(
          useWorkspaceStore.getState().rehydrateOristudioCpFolded3dFigure(figure.id)
        ).resolves.toBe(true);

        // A fresh session always opens at solution 1, so a figure saved at 3
        // takes two steps to get back to the layer order it is drawn with.
        expect(oristudioCpMocks.fold3dOristudioCpFigureAnother).toHaveBeenCalledTimes(2);
        expect(figureNow().folded3d?.current_fold_case).toBe(3);
      });

      it('refuses geometry that would land on a different solution', async () => {
        const figure = await reopened3dFigure({
          folded3d: folded3dSnapshot({ discovered_fold_cases: 2, current_fold_case: 2 }),
        });
        // The stream wrapped instead of advancing — which is what a build whose
        // solver enumerates differently looks like from here.
        oristudioCpMocks.fold3dOristudioCpFigureAnother.mockResolvedValueOnce({
          snapshot: folded3dSnapshot({ discovered_fold_cases: 2, current_fold_case: 1 }),
          render: folded3dRenderModelFixture(),
          advanced: true,
        });

        await expect(
          useWorkspaceStore.getState().rehydrateOristudioCpFolded3dFigure(figure.id)
        ).resolves.toBe(false);
        expect(figureNow().handle).toBeNull();
        // Not left behind in the kernel: a 3D session is megabytes.
        expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(11);
      });

      it('refuses geometry whose frame is not the one the figure is drawn in', async () => {
        const figure = await reopened3dFigure();
        const doubled = folded3dRenderModelFixture();
        oristudioCpMocks.fold3dOristudioCpDocument.mockResolvedValueOnce({
          status: 'placed',
          handle: 11,
          snapshot: folded3dSnapshot(),
          render: {
            ...doubled,
            ring_points: doubled.ring_points.map((value) => value * 2),
            cell_points: doubled.cell_points.map((value) => value * 2),
          },
        });

        await expect(
          useWorkspaceStore.getState().rehydrateOristudioCpFolded3dFigure(figure.id)
        ).resolves.toBe(false);
        expect(figureNow().handle).toBeNull();
        expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(11);
      });

      it('shows a pending status only when asked to', async () => {
        const figure = await reopened3dFigure();
        let release = () => {};
        oristudioCpMocks.fold3dOristudioCpDocument.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(folded3dPlaced());
            })
        );

        const quiet = useWorkspaceStore
          .getState()
          .rehydrateOristudioCpFolded3dFigure(figure.id);
        // The background pass must not put "Folding…" under a figure nobody
        // touched: that is a change to what the user sees, on load.
        expect(figureNow().status).toBe('ready');
        release();
        await expect(quiet).resolves.toBe(true);

        const second = await reopened3dFigure();
        oristudioCpMocks.fold3dOristudioCpDocument.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(folded3dPlaced());
            })
        );
        const pressed = useWorkspaceStore
          .getState()
          .rehydrateOristudioCpFolded3dFigure(second.id, { pending: true });
        expect(figureNow().status).toBe('loading');
        release();
        await expect(pressed).resolves.toBe(true);
        expect(figureNow().status).toBe('ready');
      });

      it('folds once when the background pass and a press name the same figure', async () => {
        const figure = await reopened3dFigure();
        let release = () => {};
        oristudioCpMocks.fold3dOristudioCpDocument.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(folded3dPlaced());
            })
        );

        const first = useWorkspaceStore
          .getState()
          .rehydrateOristudioCpFolded3dFigure(figure.id);
        // The second caller is refused rather than queued: two folds of one
        // figure allocate two sessions, and only one of them can be adopted.
        await expect(
          useWorkspaceStore
            .getState()
            .rehydrateOristudioCpFolded3dFigure(figure.id, { pending: true })
        ).resolves.toBe(false);
        release();
        await expect(first).resolves.toBe(true);
        expect(oristudioCpMocks.fold3dOristudioCpDocument).toHaveBeenCalledTimes(1);
      });
    });
  });

  it('refolds a stale figure in place, keeping its placement and identity', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

    // Move the figure, then edit one of its creases.
    useWorkspaceStore.getState().setOristudioCpFoldedFigurePlacement(before.id, {
      offset: { x: 12, y: 34 },
    });
    insertAppendsToDocument();
    await expect(
      useWorkspaceStore.getState().insertOristudioCpLineSegments([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 1 }),
      ])
    ).resolves.toBe(true);

    await expect(
      useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(before.id)
    ).resolves.toBe(true);

    const after = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
    // Same figure, where the user left it — upstream discards on a changed CP,
    // but here a folded figure is a placed canvas object, not a transient view.
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(1);
    expect(after.id).toBe(before.id);
    expect(after.placement.offset).toEqual({ x: 12, y: 34 });
    expect(after.displayStyle).toBe(before.displayStyle);
    expect(after.status).toBe('ready');
    // Re-baselined, so it reads as up to date until the creases move again.
    expect(
      isFoldedFigureStale(
        useWorkspaceStore.getState().oristudioCpDocument!.document,
        after
      )
    ).toBe(false);
  });

  // A refold that fails is a no-op: the figure on the canvas is still valid, it
  // is the crease pattern that cannot be folded. Destroying it would lose the
  // user's placement and styling over a problem elsewhere.
  it('keeps the figure when a refold throws', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

    oristudioCpMocks.foldOristudioCpDocument.mockRejectedValueOnce({
      code: 'invalid_operation',
      message: 'two faces meet with the same orientation across a crease',
    });
    await expect(
      useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(before.id)
    ).resolves.toBe(false);

    const after = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
    expect(after).toEqual(before);
    expect(after.status).toBe('ready');
    expect(after.renderSnapshot).not.toBeNull();
    // The old kernel handle is untouched: it is released only after a success.
    expect(after.handle).toBe(before.handle);
    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).not.toHaveBeenCalledWith(before.handle);
    expect(useWorkspaceStore.getState().oristudioCpError).toContain('same orientation');
  });

  // The subtler half: a fold can *return* having found nothing. A global
  // flat-foldability contradiction concludes at the transparent development with
  // no layer ordering, so swapping the result in would blank the figure.
  it('keeps the figure when a refold returns nothing drawable', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

    oristudioCpMocks.foldOristudioCpDocument.mockResolvedValueOnce({
      handle: 21,
      snapshot: { ...foldedFigureSnapshot(), wireframe: null, discovered_fold_cases: 0 },
    });
    oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce({
      ...foldedRenderSnapshot(),
      primitives: [],
    });

    await expect(
      useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(before.id)
    ).resolves.toBe(false);

    const after = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
    expect(after).toEqual(before);
    expect(after.handle).toBe(before.handle);
    // The handle the failed fold allocated is freed rather than leaked.
    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(21);
    expect(useWorkspaceStore.getState().oristudioCpError).toContain('folded flat');
  });

  // The refold path has made this check since it shipped; the *first* fold never
  // did, so a selection the kernel's Euler gate rejects came back as a `ready`
  // figure that drew nothing and said nothing. There is no earlier figure on
  // this path to compare it against, which is what made it invisible.
  it('keeps no figure when the first fold produces nothing to draw', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });

    oristudioCpMocks.foldOristudioCpDocument.mockResolvedValueOnce({
      handle: 31,
      snapshot: { ...foldedFigureSnapshot(), wireframe: null, discovered_fold_cases: 0 },
    });
    oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce({
      ...foldedRenderSnapshot(),
      primitives: [],
    });

    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(false);

    // No placeholder left behind, in any status: an empty `ready` figure is the
    // bug, and a permanently errored one is just different debris.
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpError).toBeTruthy();
    // The handle the fold allocated is freed rather than leaked.
    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(31);
  });

  // The sibling of the case above, and it had the same debris with a different
  // cause: a fold that *throws* left the draft behind as a permanent `error`
  // row, kept the folded-figure verbs aimed at it, and took the user's crease
  // selection with it. A failed fold costs the fold, not the selection.
  it('keeps no figure and gives the selection back when the first fold throws', async () => {
    resetStores(seedSnapshot());
    const selection = { ...emptyOristudioCpSelection(), lines: [1] };
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: selection,
    });

    oristudioCpMocks.foldOristudioCpDocument.mockRejectedValueOnce({
      code: 'fold_interior_cut',
      message: 'segment 7 at (100, 50) is a border with paper on both sides',
    });

    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(false);

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    // The engine's own code survives, so `humanizeError` can pick its sentence
    // rather than falling back to the raw kernel string.
    expect(useWorkspaceStore.getState().error?.code).toBe('fold_interior_cut');
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
  });

  it('refuses to refold a figure whose source creases are gone', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

    // Empty the crease pattern out from under it.
    useWorkspaceStore.setState({ oristudioCpDocument: editableCpState([]) });

    await expect(
      useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(figure.id)
    ).resolves.toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]).toMatchObject({
      id: figure.id,
      status: 'ready',
    });
    expect(useWorkspaceStore.getState().oristudioCpError).toContain('gone');
  });

  /**
   * Stopping a fold, from the store's side.
   *
   * The kernel is mocked here, so what these prove is the half a mocked kernel
   * can prove and the half that has been wrong before: that a live run is
   * *nameable*, that a Stop reaches the transport with the right id, and that
   * when the fold comes back rejected with `fold_cancelled` nothing on screen
   * calls it a failure. The kernel's own half — that a bound run actually
   * unwinds — is `crates/oristudio-cp`'s and the wasm bridge's.
   */
  describe('stopping a fold', () => {
    /** A fold whose promise the test decides when, and how, to settle. */
    function pendingFold() {
      let settle!: (result: unknown) => void;
      let fail!: (error: unknown) => void;
      oristudioCpMocks.foldOristudioCpDocument.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            settle = resolve;
            fail = reject;
          })
      );
      return {
        finish: (result: unknown) => settle(result),
        cancel: () => fail({ code: 'fold_cancelled', message: 'fold cancelled' }),
      };
    }

    function seedFoldableCp(lines = [1]) {
      useWorkspaceStore.setState({
        activePanelId: 'crease-pattern',
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
      });
    }

    /** Drain the microtasks between the store's `await`s. */
    async function settle() {
      for (let attempt = 0; attempt < 20; attempt += 1) await Promise.resolve();
    }

    beforeEach(() => {
      // Cancellation is a property of the transport: in a browser it needs
      // shared memory, which needs cross-origin isolation. jsdom reports neither
      // by default, and without this every run would be born un-stoppable and
      // every assertion below would pass for the wrong reason.
      Object.defineProperty(globalThis, 'crossOriginIsolated', {
        value: true,
        configurable: true,
      });
    });

    it('names the live run, so a Stop has something to aim at', async () => {
      resetStores(seedSnapshot());
      seedFoldableCp();
      const fold = pendingFold();

      const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();

      const runs = Object.values(useWorkspaceStore.getState().oristudioCpFoldRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ kind: 'fold', cancellable: true, stopping: false });
      expect(runs[0]!.runId).toBeGreaterThan(0);
      expect(runs[0]!.startedAt).toBeGreaterThan(0);
      // The id the kernel was handed is the id the map records — otherwise a
      // Stop names a run nothing is folding under.
      expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(
        1,
        'Order5',
        undefined,
        [1],
        runs[0]!.runId
      );

      fold.finish({ handle: 7, snapshot: foldedFigureSnapshot() });
      await expect(folding).resolves.toBe(true);
      expect(useWorkspaceStore.getState().oristudioCpFoldRuns).toEqual({});
    });

    it('selects nothing while the fold runs, since the figure lands unselected', async () => {
      // The draft entry used to take the canvas selection for exactly as long
      // as the kernel took, so every selection-driven surface flashed for a
      // figure that was never going to be selected. The creases still let go.
      resetStores(seedSnapshot());
      seedFoldableCp();
      const fold = pendingFold();

      const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();

      const state = useWorkspaceStore.getState();
      expect(state.oristudioCpFoldedFigures.map((figure) => figure.status)).toEqual(['loading']);
      expect(state.oristudioCpActiveFoldedFigureId).toBeNull();
      expect(state.oristudioCpSelection.lines).toEqual([]);

      fold.cancel();
      await expect(folding).resolves.toBe(false);
      // A stopped fold hands the creases back, and still selects no figure.
      expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
    });

    it('writes the exact run id where the running kernel reads it', async () => {
      resetStores(seedSnapshot());
      seedFoldableCp();
      const fold = pendingFold();
      const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();
      const runId = Object.values(useWorkspaceStore.getState().oristudioCpFoldRuns)[0]!.runId;

      expect(useWorkspaceStore.getState().stopOristudioCpFolds()).toBe(true);

      // Slot 0 of the real shared buffer, which is what the worker polls.
      const view = new Int32Array(foldCancellationBuffer()!);
      expect(Atomics.load(view, 0)).toBe(runId);
      // Still listed, and now saying so: the fold is in the kernel until it
      // unwinds, and an indicator that vanished at the press would lie.
      expect(
        Object.values(useWorkspaceStore.getState().oristudioCpFoldRuns)[0]
      ).toMatchObject({ runId, stopping: true });

      fold.cancel();
      await expect(folding).resolves.toBe(false);
      expect(useWorkspaceStore.getState().oristudioCpFoldRuns).toEqual({});
    });

    it('aims the one cancel slot at the fold that is actually running', async () => {
      resetStores(seedSnapshot());
      seedFoldableCp();
      const first = pendingFold();
      const firstFolding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();
      seedFoldableCp();
      const second = pendingFold();
      const secondFolding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();

      const runIds = Object.values(useWorkspaceStore.getState().oristudioCpFoldRuns)
        .map((run) => run.runId)
        .sort((a, b) => a - b);
      expect(runIds).toHaveLength(2);
      const [older, newer] = runIds as [number, number];

      expect(useWorkspaceStore.getState().stopOristudioCpFolds()).toBe(true);

      // One slot, matched exactly. Writing both ids would leave the *newer*
      // standing — while the CP worker is single-threaded and executing the
      // older, which would then run to completion with its Stop already spent.
      const view = new Int32Array(foldCancellationBuffer()!);
      expect(Atomics.load(view, 0)).toBe(older);

      first.cancel();
      await expect(firstFolding).resolves.toBe(false);
      await settle();

      // Re-aimed as the executing run left, so a single press really does stop
      // every run it claimed to.
      expect(Atomics.load(view, 0)).toBe(newer);
      expect(
        Object.values(useWorkspaceStore.getState().oristudioCpFoldRuns)[0]
      ).toMatchObject({ runId: newer, stopping: true });

      second.cancel();
      await expect(secondFolding).resolves.toBe(false);
      expect(useWorkspaceStore.getState().oristudioCpFoldRuns).toEqual({});
    });

    it('declines when nothing stoppable is running, so Escape falls through', () => {
      resetStores(seedSnapshot());
      expect(useWorkspaceStore.getState().stopOristudioCpFolds()).toBe(false);
    });

    it('offers nothing to stop for a run the transport cannot reach', () => {
      // The un-isolated browser: the CP engine runs fine there (its memory is
      // unshared) but there is nowhere to write a stop. Which pages that is, is
      // `foldCancellation.test.ts`'s question — it can reload the module, and
      // the buffer is deliberately allocated once per session. What matters here
      // is that the store honours the answer instead of offering a dead button.
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        oristudioCpFoldRuns: {
          5: { runId: 5, kind: 'fold', startedAt: Date.now(), cancellable: false, stopping: false },
        },
      });

      expect(useWorkspaceStore.getState().stopOristudioCpFolds()).toBe(false);
      expect(
        Object.values(useWorkspaceStore.getState().oristudioCpFoldRuns)[0]
      ).toMatchObject({ stopping: false });
    });

    it('leaves no error, no debris and the selection intact', async () => {
      resetStores(seedSnapshot());
      seedFoldableCp();
      const fold = pendingFold();
      const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();
      // The draft figure is on the canvas and has taken the selection, which is
      // exactly the state a stop has to unwind.
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(1);

      useWorkspaceStore.getState().stopOristudioCpFolds();
      fold.cancel();
      await expect(folding).resolves.toBe(false);

      const state = useWorkspaceStore.getState();
      // `error` is what `GlobalToasts` turns into an error toast; a stop is not
      // a failure and must reach neither.
      expect(state.error).toBeNull();
      expect(state.oristudioCpError).toBeNull();
      expect(state.oristudioCpFoldedFigures).toEqual([]);
      expect(state.oristudioCpActiveFoldedFigureId).toBeNull();
      // Handed back, so the user can press G again rather than reselect.
      // Upstream drops the selection at dispatch; keeping it is deliberate.
      expect(state.oristudioCpSelection.lines).toEqual([1]);
    });

    it('leaves a refold showing the figure it already had', async () => {
      resetStores(seedSnapshot());
      seedFoldableCp();
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
      const before = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

      const fold = pendingFold();
      const refolding = useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(before.id);
      await settle();
      useWorkspaceStore.getState().stopOristudioCpFolds();
      fold.cancel();
      await expect(refolding).resolves.toBe(false);

      const state = useWorkspaceStore.getState();
      expect(state.oristudioCpFoldedFigures[0]).toEqual(before);
      expect(state.oristudioCpFoldedFigures[0]?.status).toBe('ready');
      expect(state.error).toBeNull();
      expect(state.oristudioCpError).toBeNull();
    });

    it('reports a halt as its own verdict, with how long it ran', async () => {
      resetStores(seedSnapshot());
      seedFoldableCp();
      const fold = pendingFold();
      const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
      await settle();
      useWorkspaceStore.getState().stopOristudioCpFolds();
      fold.cancel();
      await expect(folding).resolves.toBe(false);

      // Not `cancelled`: that means the user declined a dialog before any work
      // happened, and merging the two destroys the only signal this feature
      // exists to produce.
      expect(
        analyticsMocks.track.mock.calls
          .filter(([name]) => name === 'fold completed')
          .map(([, properties]) => properties)
      ).toEqual([
        {
          mode: 'flat',
          verdict: 'halted',
          solution_count_bucket: '<=1',
          elapsed_ms_bucket: '<=1000',
        },
      ]);
    });

  });

  /**
   * The fold events, which are hand-placed because `G` reaches neither
   * chokepoint: `handleCpShortcutAction` short-circuits to the fold before
   * `handleCpToolAction` (so no `cp tool used`), and the toolbar button calls
   * the store action directly (so no `command invoked`).
   *
   * The privacy contract (`docs/analytics.md`) allows enums and bucketed
   * numbers only, which for a fold means: never a crease count, never an angle,
   * never a residual, never a face index.
   */
  describe('fold analytics', () => {
    const foldEvents = (name: string) =>
      analyticsMocks.track.mock.calls
        .filter(([called]) => called === name)
        .map(([, properties]) => properties);

    /** The dialog once the awaits before it have drained. */
    async function settledDialog() {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const dialog = useCommandDialogStore.getState().dialog;
        if (dialog) return dialog;
        await Promise.resolve();
      }
      return null;
    }

    function seedFlatSquare(lines = [1]) {
      useWorkspaceStore.setState({
        activePanelId: 'crease-pattern',
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
      });
    }

    it('pairs one completion with every attempt, and buckets both counts', async () => {
      resetStores(seedSnapshot());
      seedFlatSquare();

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      expect(foldEvents('fold attempted')).toEqual([
        { mode: 'flat', crease_count_bucket: '<=1', non_classic_count_bucket: '<=1' },
      ]);
      expect(foldEvents('fold completed')).toEqual([
        {
          mode: 'flat',
          verdict: 'folded',
          solution_count_bucket: '<=1',
          // On its own ladder, which starts at a second: the shared duration one
          // tops out at ten, where a fold is only starting to be interesting.
          elapsed_ms_bucket: '<=1000',
        },
      ]);
    });

    it('reports the pre-fold foldability check and the warning the user answered', async () => {
      resetStores(seedSnapshot());
      seedFlatSquare();
      oristudioCpMocks.runOristudioCpCheckCommand.mockResolvedValueOnce({
        operation: 'CheckCamv',
        status: 'OracleTested',
        diagnostics: [],
        diagnostic_entries: [
          { id: 'CheckCamv-1', kind: 'CheckCamv', severity: 'error', message: 'Maekawa' },
        ],
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        // The warning opens only after the check resolves, unlike the non-flat
        // intercept, which fires before any await.
        const dialog = await settledDialog();
        if (!dialog) throw new Error('expected the flat-foldability warning');
        resolveCommandDialog(dialog.id, { confirmed: true, optionChecked: false });
        await expect(folding).resolves.toBe(true);
      } finally {
        unregisterDialogHost();
      }

      expect(foldEvents('foldability checked')).toEqual([
        { source: 'pre-fold', had_violations: true, violation_count_bucket: '<=1' },
      ]);
      expect(foldEvents('fold warning shown')).toEqual([{ source: 'pre-fold' }]);
      expect(foldEvents('fold warning accepted')).toEqual([
        { source: 'pre-fold', accepted: true, suppressed_future_warnings: false },
      ]);
    });

    it('does not raise the flat-foldability warning over a warning-severity entry', async () => {
      // `SpatialInteriorBorder` is the only warning `CheckCamv` emits, and it
      // says the closure check declined to examine the vertices on a border with
      // paper on both sides. Its own copy calls it "not a violation". A document
      // whose only entry is this one has nothing wrong with it, so the fold must
      // proceed without a modal — and `foldability checked` must not claim
      // otherwise.
      resetStores(seedSnapshot());
      seedFlatSquare();
      oristudioCpMocks.runOristudioCpCheckCommand.mockResolvedValueOnce({
        operation: 'CheckCamv',
        status: 'OracleTested',
        diagnostics: [],
        diagnostic_entries: [
          {
            id: 'SpatialInteriorBorder-1',
            kind: 'SpatialInteriorBorder',
            severity: 'warning',
            rule: 'InteriorBorder',
            message: 'Border with paper on both sides: the vertices on it are not checked',
          },
        ],
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
        expect(useCommandDialogStore.getState().dialog).toBeNull();
      } finally {
        unregisterDialogHost();
      }

      expect(foldEvents('foldability checked')).toEqual([
        { source: 'pre-fold', had_violations: false, violation_count_bucket: '<=1' },
      ]);
      expect(foldEvents('fold warning shown')).toEqual([]);
    });

    it('separates a simulated 3D refusal from a cancelled one', async () => {
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        oristudioCpDocument: editableCpState([
          cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
          cpLine({ x: 1, y: 0 }, { x: 1, y: 1 }, { color: 'Black0' }),
          cpLine({ x: 1, y: 1 }, { x: 0, y: 1 }, { color: 'Black0' }),
          cpLine({ x: 0, y: 1 }, { x: 0, y: 0 }, { color: 'Black0' }),
          cpLine(
            { x: 0, y: 0 },
            { x: 1, y: 1 },
            { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
          ),
        ]),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2, 3, 4, 5] },
      });
      oristudioCpMocks.fold3dOristudioCpDocument.mockResolvedValueOnce({
        status: 'refused',
        refusal: { code: 'faces_unresolved' },
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        let dialog = useCommandDialogStore.getState().dialog;
        for (let attempt = 0; attempt < 50 && !dialog; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          dialog = useCommandDialogStore.getState().dialog;
        }
        if (!dialog) throw new Error('expected the 3D refusal confirmation');
        resolveCommandDialog(dialog.id, false);
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }

      // `mode` is decided from the selection, so it is known before the fold
      // runs; `refusal` is the bounded code that says why there is no figure,
      // and it is the only thing about the refusal that leaves the app.
      expect(foldEvents('fold attempted')).toEqual([
        { mode: 'spatial', crease_count_bucket: '<=5', non_classic_count_bucket: '<=1' },
      ]);
      expect(foldEvents('fold completed')).toEqual([
        {
          mode: 'spatial',
          verdict: 'cancelled',
          solution_count_bucket: '<=1',
          elapsed_ms_bucket: '<=1000',
          refusal: 'faces_unresolved',
        },
      ]);
      expect(foldEvents('fold simulation run')).toEqual([]);
    });

    it('reports a kernel refusal as a completion, not as silence', async () => {
      resetStores(seedSnapshot());
      seedFlatSquare();
      oristudioCpMocks.foldOristudioCpDocument.mockRejectedValueOnce({
        code: 'fold_disconnected',
        message: 'the fold graph is disconnected',
      });

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(false);

      expect(foldEvents('fold completed')).toEqual([
        {
          mode: 'flat',
          verdict: 'error',
          solution_count_bucket: '<=1',
          elapsed_ms_bucket: '<=1000',
        },
      ]);
    });

    it('says which way the one solution verb moved', async () => {
      resetStores(seedSnapshot());
      seedFlatSquare();
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      await expect(
        useWorkspaceStore.getState().foldAnotherOristudioCpFigure()
      ).resolves.toBe(true);

      // The seeded snapshot has another solution waiting, which is exactly the
      // predicate the button labels itself from.
      expect(foldEvents('fold solution cycled')).toEqual([
        { direction: 'next', solution_count_bucket: '<=5' },
      ]);
    });

    describe('‹, back one layer order (the Properties pane’s)', () => {
      const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;

      /** A flat figure showing the third of three solutions found. */
      async function onThirdOfThree() {
        resetStores(seedSnapshot());
        seedFlatSquare();
        await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
        const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
        const third = {
          ...figure,
          snapshot: {
            ...figure.snapshot!,
            discovered_fold_cases: 3,
            current_fold_case: 3,
            find_another_overlap_valid: false,
          },
        };
        useWorkspaceStore.setState({ oristudioCpFoldedFigures: [third] });
        return third;
      }

      it('goes back one fold case as one entry, keeps what it found past it, and says so', async () => {
        const figure = await onThirdOfThree();
        // The kernel restarts the enumeration and replays it to the second,
        // forgetting the third it found on the way out.
        oristudioCpMocks.foldOristudioCpFigureToCase.mockResolvedValueOnce({
          snapshot: {
            ...figure.snapshot,
            discovered_fold_cases: 2,
            current_fold_case: 2,
            find_another_overlap_valid: true,
          },
          discovered_case_numbers: [1, 2],
        });
        const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;

        await expect(showPreviousFoldedSolution(figure.id, t)).resolves.toBe(true);

        expect(oristudioCpMocks.foldOristudioCpFigureToCase).toHaveBeenCalledWith(
          figure.handle,
          2,
          'Order5',
          expect.any(Number)
        );
        const landed = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
        expect(foldedFigureCurrentCase(landed)).toBe(2);
        expect(foldedFigureFrontier(landed)).toEqual({ cases: 3, complete: true });
        const past = useWorkspaceStore.getState().oristudioCpHistoryPast;
        expect(past).toHaveLength(before + 1);
        expect(past.at(-1)?.label).toBe('Show previous solution');
        expect(foldEvents('fold solution cycled')).toEqual([
          { direction: 'previous', solution_count_bucket: '<=5' },
        ]);
      });

      it('goes no further back than the first, and records nothing', async () => {
        const third = await onThirdOfThree();
        const first = { ...third, snapshot: { ...third.snapshot, current_fold_case: 1 } };
        useWorkspaceStore.setState({ oristudioCpFoldedFigures: [first] });
        const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;

        await expect(showPreviousFoldedSolution(first.id, t)).resolves.toBe(false);

        expect(oristudioCpMocks.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
        expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(before);
        expect(foldEvents('fold solution cycled')).toEqual([]);
      });
    });

    describe('how far a figure’s layer-order search has reached, kept by handle outside undo', () => {
      const t = ((_key: string, fallback: string) => fallback) as unknown as TFunction;
      const at = (discovered: number, current: number, more: boolean) => ({
        ...foldedFigureSnapshot(),
        discovered_fold_cases: discovered,
        current_fold_case: current,
        find_another_overlap_valid: more,
      });
      const figure = () => useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;

      /** Folded on handle 7, then › twice, to the third and last of three solutions. */
      async function steppedToThird() {
        resetStores(seedSnapshot());
        seedFlatSquare();
        oristudioCpMocks.foldOristudioCpDocument.mockResolvedValueOnce({ handle: 7, snapshot: at(1, 1, true) });
        await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
        oristudioCpMocks.foldOristudioCpFigureAnother
          .mockResolvedValueOnce(at(2, 2, true))
          .mockResolvedValueOnce(at(3, 3, false));
        await showAnotherFoldedSolution(figure().id, t);
        await showAnotherFoldedSolution(figure().id, t);
        expect(foldedFigureFrontier(figure())).toEqual({ cases: 3, complete: true });
      }

      it('counts the stored total in fold solution cycled, both ways', async () => {
        await steppedToThird();
        oristudioCpMocks.foldOristudioCpFigureToCase.mockResolvedValueOnce({
          snapshot: at(2, 2, true),
          discovered_case_numbers: [1, 2],
        });
        await showPreviousFoldedSolution(figure().id, t);
        // Back on the second, the kernel has found two again; the search had found three.
        expect(foldEvents('fold solution cycled')).toEqual([
          { direction: 'next', solution_count_bucket: '<=5' },
          { direction: 'next', solution_count_bucket: '<=5' },
          { direction: 'previous', solution_count_bucket: '<=5' },
        ]);
        expect(solutionFrontierOf(7)).toEqual({ cases: 3, complete: true });
      });

      it('never shrinks on undo, after ‹ or after ›', async () => {
        await steppedToThird();
        oristudioCpMocks.foldOristudioCpFigureToCase.mockResolvedValueOnce({
          snapshot: at(2, 2, true),
          discovered_case_numbers: [1, 2],
        });
        await showPreviousFoldedSolution(figure().id, t);
        expect(foldedFigureFrontier(figure())).toEqual({ cases: 3, complete: true });

        // Undo the ‹, then each › back to the fold: the entries put back reported
        // fewer, and the handle's search has still reached three.
        for (let undo = 0; undo < 3; undo += 1) {
          await useWorkspaceStore.getState().undo();
          expect(foldedFigureFrontier(figure()), `undo ${undo + 1}`).toEqual({ cases: 3, complete: true });
        }
        expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.handle).toBe(7);
      });

      it('starts a refold’s new handle fresh', async () => {
        await steppedToThird();
        oristudioCpMocks.foldOristudioCpDocument.mockResolvedValueOnce({ handle: 11, snapshot: at(1, 1, true) });
        await expect(useWorkspaceStore.getState().refoldOristudioCpFoldedFigure(figure().id)).resolves.toBe(true);
        expect(figure().handle).toBe(11);
        expect(foldedFigureFrontier(figure())).toEqual({ cases: 1, complete: false });
      });

      it('shows nothing of another fold on a handle the kernel reuses', async () => {
        await steppedToThird();
        // The slot freed and given to a new fold, as the kernel may.
        useWorkspaceStore.setState({ oristudioCpFoldedFigures: [] });
        seedFlatSquare();
        oristudioCpMocks.foldOristudioCpDocument.mockResolvedValueOnce({ handle: 7, snapshot: at(1, 1, true) });
        await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
        expect(figure().handle).toBe(7);
        expect(foldedFigureFrontier(figure())).toEqual({ cases: 1, complete: false });
      });

      it('carries what the original had found to a duplicate', async () => {
        await steppedToThird();
        oristudioCpMocks.duplicateOristudioCpFoldedFigure.mockResolvedValueOnce({
          handle: 8,
          snapshot: at(3, 3, false),
        });
        await expect(
          useWorkspaceStore.getState().duplicateOristudioCpFoldedFigure(figure().id)
        ).resolves.toBe(true);
        expect(solutionFrontierOf(8)).toEqual({ cases: 3, complete: true });
      });
    });

    it('sends no count, angle or geometry as a property value', async () => {
      // Enums and bucketed numbers only. A raw crease count is the easy mistake
      // here — it is right there, it looks harmless, and on a distinctive design
      // it is identifying.
      const ENUMS = new Set([
        'flat',
        'spatial',
        'folded',
        'no-solutions',
        'contradiction',
        'not-drawable',
        'simulated',
        'located',
        'cancelled',
        'halted',
        'error',
        'local-crossing',
        'transversal-crossing',
        'no-layer-order',
        'next',
        'wrap',
        'pre-fold',
        'fold-3d-refused',
        'fold-3d-no-layer-order',
        // `Fold3dRefusal` / `Fold3dOrderReason` codes: bounded kernel enums, ten
        // and eight of them, never a measurement.
        'no_faces',
        'faces_unresolved',
        'disconnected',
        'non_crease_join',
        'interior_cut',
        'flat_foldability',
        'vertex_indeterminate',
        'vertex_closure',
        'loop_not_closed',
        'tolerance_window_closed',
        'overlap_without_cell',
        'cell_without_overlap',
        'arrangement_refused',
        'contradictory_seeds',
        'no_layer_order',
        'face_id_out_of_range',
        'search_failed',
      ]);

      resetStores(seedSnapshot());
      seedFlatSquare();
      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
      await expect(
        useWorkspaceStore.getState().foldAnotherOristudioCpFigure()
      ).resolves.toBe(true);

      const values = analyticsMocks.track.mock.calls
        .filter(([name]) => String(name).startsWith('fold'))
        .flatMap(([, properties]) => Object.values(properties ?? {}));
      expect(values.length).toBeGreaterThan(0);
      for (const value of values) {
        const allowed =
          typeof value === 'boolean' ||
          (typeof value === 'string' && (ENUMS.has(value) || /^(<=|>)\d+$/u.test(value)));
        expect(allowed, `unexpected property value: ${String(value)}`).toBe(true);
      }
    });
  });

  it('passes active editable CP line selection into folded figure folding', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'selected-lines.cp',
      path: '/tmp/selected-lines.cp',
    });
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
        cpLine({ x: 0, y: 0 }, { x: 0, y: 1 }, { color: 'Red1' }),
      ]),
    });
    useWorkspaceStore.getState().setOristudioCpSelection({
      ...emptyOristudioCpSelection(),
      lines: [2, 1],
    });

    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

    expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(
      1,
      'Order5',
      undefined,
      [2, 1],
      A_RUN_ID
    );
  });

  it('uses imported Oriedita folded model metadata when folding selected CP lines', async () => {
    resetStores(seedSnapshot());
    const documentState = editableCpState([
      cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Red1' }),
    ]);
    useWorkspaceStore.setState({
      oristudioCpDocument: {
        ...documentState,
        document: {
          ...documentState.document,
          metadata: {
            'oriedita:ori:foldedFigureModel': {
              frontColor: 'ff010203',
              backColor: 'ff040506',
              lineColor: 'ff070809',
              state: 'BACK_1',
              scale: 2,
              rotation: 90,
            },
          },
        },
      },
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });

    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

    expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(
      1,
      'Order5',
      expect.objectContaining({
        front_color: { red: 1, green: 2, blue: 3 },
        back_color: { red: 4, green: 5, blue: 6 },
        line_color: { red: 7, green: 8, blue: 9 },
        scale: 2,
        rotation: 90,
      }),
      [1],
      A_RUN_ID
    );
  });

  // The saved side is the one part of an Oriedita folded model a fresh fold does
  // not inherit -- upstream resets it (see NEW_FOLDED_FIGURE_SIDE). A file saved
  // in an overlay state used to hand the fold `Transparent3`, which draws the
  // front and back over each other and shows no current side in the pickers.
  it.each(['FRONT_0', 'BACK_1', 'BOTH_2', 'TRANSPARENT_3'])(
    'folds facing front whatever side the Oriedita file saved (%s)',
    async (savedState) => {
      resetStores(seedSnapshot());
      const documentState = editableCpState([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Red1' }),
      ]);
      useWorkspaceStore.setState({
        oristudioCpDocument: {
          ...documentState,
          document: {
            ...documentState.document,
            metadata: {
              'oriedita:ori:foldedFigureModel': { frontColor: 'ff010203', state: savedState },
            },
          },
        },
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      });

      await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);

      expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(
        1,
        'Order5',
        // Appearance still carries over; only the side is reset.
        expect.objectContaining({ front_color: { red: 1, green: 2, blue: 3 }, state: 'Front0' }),
        [1],
        A_RUN_ID
      );
    }
  );

  it('does not fold editable CP documents without selected foldable lines', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Red1' }),
      ]),
      oristudioCpSelection: emptyOristudioCpSelection(),
    });

    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(false);

    expect(oristudioCpMocks.foldOristudioCpDocument).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpError).toBe(
      'Select one or more foldable crease-pattern lines first'
    );
  });

  it('updates folded figure view state and manages duplicates', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await useWorkspaceStore.getState().foldOristudioCpDocument({ startingFaceId: 2 });
    const foldedFigure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0];
    if (!foldedFigure) throw new Error('Folded figure was not created');
    oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockClear();

    await expect(
      useWorkspaceStore
        .getState()
        .setOristudioCpFoldedFigureDisplayStyle(foldedFigure.id, 'Transparent3')
    ).resolves.toBe(true);

    expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).toHaveBeenCalledWith(
      7,
      'Transparent3',
      {
        display_mark: false,
        selected: true,
        index: 1,
      }
    );
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]).toMatchObject({
      startingFaceId: 2,
      displayStyle: 'Transparent3',
    });
    useWorkspaceStore
      .getState()
      .setOristudioCpFoldedFigurePlacement(foldedFigure.id, { offset: { x: 12, y: -8 } });
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.placement).toEqual({
      offset: { x: 12, y: -8 },
      scale: 1,
      rotation: 0,
    });
    // Placement patches are partial: setting a scale leaves the offset alone.
    useWorkspaceStore.getState().setOristudioCpFoldedFigurePlacement(foldedFigure.id, { scale: 2 });
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.placement).toEqual({
      offset: { x: 12, y: -8 },
      scale: 2,
      rotation: 0,
    });

    await expect(
      useWorkspaceStore
        .getState()
        .updateOristudioCpFoldedFigureModel(foldedFigure.id, { state: 'Back1' })
    ).resolves.toBe(true);

    expect(oristudioCpMocks.setOristudioCpFoldedFigureModel).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ state: 'Back1' })
    );
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model.state).toBe(
      'Back1'
    );

    await expect(
      useWorkspaceStore.getState().duplicateOristudioCpFoldedFigure(foldedFigure.id)
    ).resolves.toBe(true);

    expect(oristudioCpMocks.duplicateOristudioCpFoldedFigure).toHaveBeenCalledWith(7);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(2);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[1]).toMatchObject({
      handle: 8,
      displayStyle: 'Transparent3',
      startingFaceId: 2,
      // A duplicate inherits the source's placement, so it lands on top of it.
      placement: { offset: { x: 12, y: -8 }, scale: 2, rotation: 0 },
    });

    const duplicateId = useWorkspaceStore.getState().oristudioCpFoldedFigures[1]?.id;
    if (!duplicateId) throw new Error('Duplicate folded figure was not created');
    await useWorkspaceStore.getState().deleteOristudioCpFoldedFigure(duplicateId);

    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(8);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(1);
    // Deleting the selected figure selects nothing — no advance to the next
    // one, which put the selection on a figure nobody clicked.
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
  });

  it('undoes and redoes a folded figure placement without touching the wasm document', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    });

    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    useWorkspaceStore
      .getState()
      .setOristudioCpFoldedFigurePlacement(figure.id, { offset: { x: 40, y: 5 }, scale: 3 });
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Move folded form');

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].placement).toMatchObject({
      offset: { x: 40, y: 5 },
      scale: 3,
    });

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].placement).toEqual(
      IDENTITY_FOLDED_PLACEMENT
    );
    // Overlay-only: the wasm document is never reloaded to restore a placement.
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).not.toHaveBeenCalled();

    await useWorkspaceStore.getState().redo();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].placement).toMatchObject({
      offset: { x: 40, y: 5 },
      scale: 3,
    });
  });

  it('pins a paper-style field on a folded figure, and clears it, as an overlay edit', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: null,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpActiveFoldedFigureId: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      dirty: false,
    });
    const store = useWorkspaceStore.getState();

    expect(store.setOristudioCpFoldedFigureAppearance('missing', 'erode', 0.1)).toBe(false);

    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    expect(store.setOristudioCpFoldedFigureAppearance(figure.id, 'paper.front', '#ff0000')).toBe(
      true
    );
    // A document edit, and one that selects the figure, as editing its model does.
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].appearance).toEqual({
      'paper.front': '#ff0000',
    });
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe(figure.id);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    // No history push of its own: that is the caller's bracket.
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change paper style', null);

    // Re-pinning the same value changes nothing.
    const pinned = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    store.setOristudioCpFoldedFigureAppearance(figure.id, 'paper.front', '#ff0000');
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toBe(pinned);

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].appearance).toBeUndefined();
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    // Overlay-only: the wasm document is never reloaded to restore a pin.
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).not.toHaveBeenCalled();

    await useWorkspaceStore.getState().redo();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].appearance).toEqual({
      'paper.front': '#ff0000',
    });

    // Clearing the last pin drops the record altogether.
    store.setOristudioCpFoldedFigureAppearance(figure.id, 'paper.front', undefined);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].appearance).toBeUndefined();
  });

  it('pins a paper-style field on an inline simulation window, undoably', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpInlineSimulations: [inlineSimulationFixture()],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      dirty: false,
    });
    setInlineSimulationSource('inline-sim-1', { fold: {} as never, modelKey: 'k' });
    const store = useWorkspaceStore.getState();

    expect(store.setOristudioCpInlineSimulationAppearance('missing', 'erode', 0.1)).toBe(false);

    const before = useWorkspaceStore.getState().oristudioCpInlineSimulations;
    expect(store.setOristudioCpInlineSimulationAppearance('inline-sim-1', 'erode', 0.1)).toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations[0].appearance).toEqual({
      erode: 0.1,
    });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toEqual([]);
    useWorkspaceStore.getState().recordInlineSimulationHistory([...before], 'Change paper style');

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations[0].appearance).toBeUndefined();
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).not.toHaveBeenCalled();

    await useWorkspaceStore.getState().redo();
    expect(useWorkspaceStore.getState().oristudioCpInlineSimulations[0].appearance).toEqual({
      erode: 0.1,
    });
  });

  // --- Kernel/cache reconciliation on overlay undo -------------------------
  //
  // A figure's appearance lives in the kernel behind its handle, and every
  // history entry for that figure points at the same mutable handle. Overlay
  // undo swaps only the web entries, so without a reconcile the kernel keeps the
  // undone model and the next kernel re-render (a reselect is the cheapest one)
  // brings it back.

  // A fresh handle per test. The kernel hands out a new slot for every fold, and
  // the slice remembers what it last wrote per *handle* — so reusing one across
  // tests would let one test's belief silently satisfy the next test's reconcile.
  let nextTestHandle = 100;

  function seedFoldedFigureForModelTests(model?: Partial<OristudioCpFoldedFigureModel>) {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const snapshot = foldedFigureSnapshot();
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: (nextTestHandle += 1),
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: { ...snapshot, model: { ...snapshot.model, ...model } },
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    });
    return figure;
  }

  /** The model each `setOristudioCpFoldedFigureModel` call pushed, in order. */
  function kernelModelWrites(): OristudioCpFoldedFigureModel[] {
    return oristudioCpMocks.setOristudioCpFoldedFigureModel.mock.calls.map(
      (call) => call[1] as OristudioCpFoldedFigureModel
    );
  }

  // Re-pinned for the paper style (Phase 1): the observable is a model field
  // the paper-style mirror does not own. A figure's model colours follow its
  // effective paper style since then, so a colour written to the model alone
  // is written straight back — `transparent_transparency` is not.
  const RED = 10;
  const BLUE = 20;
  const GREEN = 30;

  it('pushes the restored model back into the kernel after an overlay undo', async () => {
    const figure = seedFoldedFigureForModelTests();
    const original = figure.snapshot!.model;
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      async (_handle: number, model: OristudioCpFoldedFigureModel) => ({
        ...foldedFigureSnapshot(),
        model,
      })
    );

    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    await useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: RED });
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change folded model');

    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockClear();
    await useWorkspaceStore.getState().undo();
    await flushMicrotasks();

    // The web state reverted, and the kernel was told about it.
    expect(
      useWorkspaceStore.getState().oristudioCpFoldedFigures[0].snapshot?.model
        .transparent_transparency
    ).toEqual(original.transparent_transparency);
    expect(kernelModelWrites().at(-1)?.transparent_transparency).toEqual(
      original.transparent_transparency
    );
  });

  it('leaves undo synchronous, so a burst is never dropped by historyBusy', async () => {
    const figure = seedFoldedFigureForModelTests();
    let resolveWrite: null | (() => void) = null;
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      (_handle: number, model: OristudioCpFoldedFigureModel) =>
        new Promise<OristudioCpFoldedFigureSnapshot>((resolve) => {
          resolveWrite = () => resolve({ ...foldedFigureSnapshot(), model });
        })
    );

    // Three recorded model steps.
    for (const alpha of [RED, BLUE, GREEN]) {
      const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [
          {
            ...useWorkspaceStore.getState().oristudioCpFoldedFigures[0],
            snapshot: {
              ...figure.snapshot!,
              model: { ...figure.snapshot!.model, transparent_transparency: alpha },
            },
          },
        ],
      });
      useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change folded model');
    }
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(3);

    // Undo three times without yielding — the kernel write is still pending, so
    // if the branch had become async, historyBusy would swallow calls 2 and 3.
    const results = [
      useWorkspaceStore.getState().undo(),
      useWorkspaceStore.getState().undo(),
      useWorkspaceStore.getState().undo(),
    ];
    await Promise.all(results);
    // Each call consumed an entry. If the overlay branch awaited the kernel,
    // historyBusy would still be set for calls 2 and 3 and they would no-op.
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(0);
    expect(useWorkspaceStore.getState().historyBusy).toBe(false);
    (resolveWrite as (() => void) | null)?.();
  });

  it('settles the kernel on the final state after a burst of undos', async () => {
    const figure = seedFoldedFigureForModelTests();
    const original = figure.snapshot!.model;
    // Resolve out of order: each write takes longer than the one after it, so a
    // design that let writes race would leave the kernel on an intermediate.
    let delay = 30;
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      (_handle: number, model: OristudioCpFoldedFigureModel) => {
        const wait = (delay -= 10);
        return new Promise((resolve) =>
          setTimeout(() => resolve({ ...foldedFigureSnapshot(), model }), Math.max(wait, 0))
        );
      }
    );

    for (const alpha of [RED, BLUE]) {
      const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [
          {
            ...useWorkspaceStore.getState().oristudioCpFoldedFigures[0],
            snapshot: {
              ...figure.snapshot!,
              model: { ...figure.snapshot!.model, transparent_transparency: alpha },
            },
          },
        ],
      });
      useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change folded model');
    }

    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockClear();
    await Promise.all([
      useWorkspaceStore.getState().undo(),
      useWorkspaceStore.getState().undo(),
    ]);
    // Whatever order the round-trips completed in, the kernel ends on the state
    // the burst settled on — never on the intermediate it passed through.
    await vi.waitFor(() =>
      expect(kernelModelWrites().at(-1)?.transparent_transparency).toEqual(
        original.transparent_transparency
      )
    );
    expect(kernelModelWrites().some((m) => m.transparent_transparency === BLUE)).toBe(false);
  });

  it('skips a reconcile that would not change the kernel', async () => {
    const figure = seedFoldedFigureForModelTests();
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      async (_handle: number, model: OristudioCpFoldedFigureModel) => ({
        ...foldedFigureSnapshot(),
        model,
      })
    );
    // The alpha first, so the kernel holds it...
    await useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: RED });
    // ...then a placement-only step on top of it. Undoing that step restores a
    // model identical to what the kernel already has.
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    useWorkspaceStore
      .getState()
      .setOristudioCpFoldedFigurePlacement(figure.id, { offset: { x: 4, y: 0 } });
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Move folded form');
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockClear();

    await useWorkspaceStore.getState().undo();
    await flushMicrotasks();

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].placement).toEqual(
      IDENTITY_FOLDED_PLACEMENT
    );
    // Nothing kernel-held changed, so the reconcile cost a comparison and no
    // round-trip. This is what keeps a held-down undo cheap.
    expect(oristudioCpMocks.setOristudioCpFoldedFigureModel).not.toHaveBeenCalled();
  });

  it('surfaces a failed reconcile instead of drifting silently', async () => {
    const figure = seedFoldedFigureForModelTests();
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      async (_handle: number, model: OristudioCpFoldedFigureModel) => ({
        ...foldedFigureSnapshot(),
        model,
      })
    );
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    await useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: RED });
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change folded model');

    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockRejectedValue(new Error('kernel gone'));
    await useWorkspaceStore.getState().undo();
    await vi.waitFor(() =>
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0].status).toBe('error')
    );
    expect(useWorkspaceStore.getState().oristudioCpError).toContain('kernel gone');
  });

  it('does not reconcile a figure the undo removed', async () => {
    const figure = seedFoldedFigureForModelTests();
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      async (_handle: number, model: OristudioCpFoldedFigureModel) => ({
        ...foldedFigureSnapshot(),
        model,
      })
    );
    // Undoing "add figure": the previous state had no figures at all.
    useWorkspaceStore.getState().recordFoldedFigureHistory([], 'Fold model');
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockClear();

    await useWorkspaceStore.getState().undo();
    await flushMicrotasks();

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(0);
    expect(oristudioCpMocks.setOristudioCpFoldedFigureModel).not.toHaveBeenCalled();
    expect(figure.id).toBe('generated-1');
  });

  it('shares renderSnapshot objects across history entries so undo memory stays bounded', () => {
    resetStores(seedSnapshot());
    const untouched: OristudioCpFoldedFigureEntry = {
      id: 'generated-untouched',
      title: 'Untouched',
      handle: 9,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    const moved: OristudioCpFoldedFigureEntry = { ...untouched, id: 'generated-moved', handle: 10 };
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [untouched, moved] });

    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    useWorkspaceStore
      .getState()
      .setOristudioCpFoldedFigurePlacement(moved.id, { offset: { x: 1, y: 1 } });
    const after = useWorkspaceStore.getState().oristudioCpFoldedFigures;

    // The untouched figure is the *same object* before and after, so its (large)
    // renderSnapshot is retained once rather than once per history entry.
    expect(after[0]).toBe(before[0]);
    expect(after[0].renderSnapshot).toBe(before[0].renderSnapshot);
    // Only the changed figure is a new object, and even it reuses the snapshot.
    expect(after[1]).not.toBe(before[1]);
    expect(after[1].renderSnapshot).toBe(before[1].renderSnapshot);
  });

  it('keeps a deleted folded figure kernel-editable while undo can still reach it', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    });
    // The live list holds the handle (as fold/duplicate would have arranged).
    retainFoldedFigureHandle(figure.handle);

    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Delete folded model');
    await useWorkspaceStore.getState().deleteOristudioCpFoldedFigure(figure.id);

    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(0);
    // The history entry still refers to it, so the wasm slot must survive —
    // otherwise undo would restore a figure that draws but cannot be recoloured.
    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).not.toHaveBeenCalled();

    await useWorkspaceStore.getState().undo();
    const restored = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    expect(restored).toHaveLength(1);
    expect(restored[0].handle).toBe(7);

    // And it really is editable again: a model update reaches the kernel.
    await expect(
      useWorkspaceStore.getState().updateOristudioCpFoldedFigureModel(figure.id, { state: 'Back1' })
    ).resolves.toBe(true);
    expect(oristudioCpMocks.setOristudioCpFoldedFigureModel).toHaveBeenCalled();
  });

  it('hands each fold over on an undo and a redo between two of them, freeing neither', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    });
    retainFoldedFigureHandle(7);
    // A step that put a new fold in the old one's place, as a refold does: the
    // entry takes the old fold, the live list the new one.
    useWorkspaceStore.getState().recordFoldedFigureHistory([figure], 'Refold folded model');
    retainFoldedFigureHandle(8);
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [{ ...figure, handle: 8 }] });
    releaseFoldedFigureHandle(7);
    const holders = () => [foldedFigureHandleRefCount(7), foldedFigureHandleRefCount(8)];
    expect(holders()).toEqual([1, 1]);

    // Each step swaps what is live with what the entry holds: one holder each, nothing freed.
    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.handle).toBe(7);
    expect(holders()).toEqual([1, 1]);
    await useWorkspaceStore.getState().redo();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.handle).toBe(8);
    expect(holders()).toEqual([1, 1]);
    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).not.toHaveBeenCalled();
  });

  // Windows were saved to `.osf` but left out of history entirely, so deleting
  // one and pressing undo did nothing at all.
  describe('simulation windows in undo', () => {
    function seedWindow() {
      resetStores(seedSnapshot());
      useWorkspaceStore.setState({
        // Installing a crease pattern focuses the CP editor, as every production
        // install path does (see `freshEditableCpState`).
        activePanelId: 'crease-pattern',
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
        oristudioCpInlineSimulations: [inlineSimulationFixture()],
        oristudioCpHistoryPast: [],
        oristudioCpHistoryFuture: [],
      });
      return useWorkspaceStore.getState().oristudioCpInlineSimulations;
    }

    it('restores a deleted window', async () => {
      // The reported bug: delete, undo, nothing happened. Deleting records its
      // own entry, so no test-side bookkeeping — this is the real path.
      seedWindow();
      useWorkspaceStore.getState().removeOristudioCpInlineSimulation('inline-sim-1');
      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(0);

      await useWorkspaceStore.getState().undo();
      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(1);
      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations[0].id).toBe(
        'inline-sim-1'
      );
    });

    it('takes the window away again on redo', async () => {
      seedWindow();
      useWorkspaceStore.getState().removeOristudioCpInlineSimulation('inline-sim-1');
      await useWorkspaceStore.getState().undo();
      await useWorkspaceStore.getState().redo();
      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(0);
    });

    it('undoes a move as one step, not one per pointermove', async () => {
      seedWindow();
      const moved = { center: { x: 40, y: 40 }, width: 100, height: 100, rotation: 0 };
      // What a drag looks like: one checkpoint, many updates, one commit.
      useWorkspaceStore.getState().recordInlineSimulationHistory(
        useWorkspaceStore.getState().oristudioCpInlineSimulations,
        'Move simulation window'
      );
      for (let x = 10; x <= 40; x += 10) {
        useWorkspaceStore.getState().updateOristudioCpInlineSimulation('inline-sim-1', {
          box: { ...moved, center: { x, y: x } },
        });
      }
      expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);

      await useWorkspaceStore.getState().undo();
      expect(
        useWorkspaceStore.getState().oristudioCpInlineSimulations[0].box.center
      ).toEqual({ x: 0, y: 0 });
    });

    it('leaves focus, scrubbing and playback out of history', () => {
      // Transport, not content. A fold percentage moves ~15 times a second, so an
      // entry per change would bury every real edit under it.
      seedWindow();
      useWorkspaceStore.getState().focusOristudioCpInlineSimulation('inline-sim-1');
      useWorkspaceStore.getState().focusOristudioCpInlineSimulation(null);
      expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(0);
    });

    it('brings a restored window back unfocused', async () => {
      // History restores content, not what was selected — the same reason undo
      // drops the annotation selection. An unfocused window is also one whose
      // solver is not running, which is right for one just reappearing.
      seedWindow();
      useWorkspaceStore.getState().focusOristudioCpInlineSimulation('inline-sim-1');
      useWorkspaceStore.getState().removeOristudioCpInlineSimulation('inline-sim-1');

      await useWorkspaceStore.getState().undo();
      expect(
        useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId
      ).toBeNull();
    });

    it('leaves live windows alone for an entry that never captured them', async () => {
      // Entries written before windows joined the stack have no
      // `inlineSimulations`; restoring `undefined` over the live list would wipe
      // the user's windows. Same rule, same reason, as folded figures.
      seedWindow();
      const legacyEntry = {
        document: useWorkspaceStore.getState().oristudioCpDocument!.document,
        selection: emptyOristudioCpSelection(),
        annotations: [],
        foldedFigures: [],
        activeFoldedFigureId: null,
        overlayOnly: true,
        label: 'Move image',
        timestamp: '2026-01-01T00:00:00.000Z',
      };
      useWorkspaceStore.setState({ oristudioCpHistoryPast: [legacyEntry as never] });

      await useWorkspaceStore.getState().undo();
      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toHaveLength(1);
    });
  });

  it('marks the project dirty for folded figure edits so they cannot be lost silently', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };

    for (const act of [
      () =>
        useWorkspaceStore
          .getState()
          .updateOristudioCpFoldedFigureModel(figure.id, { state: 'Back1' }),
      () =>
        useWorkspaceStore
          .getState()
          .setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Wire2'),
      () => useWorkspaceStore.getState().deleteOristudioCpFoldedFigure(figure.id),
    ]) {
      useWorkspaceStore.setState({ oristudioCpFoldedFigures: [figure], dirty: false });
      await act();
      expect(useWorkspaceStore.getState().dirty).toBe(true);
    }
  });

  it('drops a stale folded model response so a fast slider drag lands its last value', async () => {
    resetStores(seedSnapshot());
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [figure] });

    // Two overlapping requests where the FIRST resolves last — without
    // sequencing, the stale response would win and the slider would snap back.
    const resolvers: Array<(value: OristudioCpFoldedFigureSnapshot) => void> = [];
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      () => new Promise((resolve) => resolvers.push(resolve))
    );

    const first = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: 10 });
    const second = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: 200 });

    resolvers[1]({ ...foldedFigureSnapshot(), model: { ...foldedFigureSnapshot().model, transparent_transparency: 200 } });
    await second;
    resolvers[0]({ ...foldedFigureSnapshot(), model: { ...foldedFigureSnapshot().model, transparent_transparency: 10 } });
    await first;

    expect(
      useWorkspaceStore.getState().oristudioCpFoldedFigures[0].snapshot?.model
        .transparent_transparency
    ).toBe(200);
  });

  it('keeps the canvas selection exclusive between annotations and folded figures', () => {
    resetStores(seedSnapshot());
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    const annotation = createCpImage({
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 10,
      naturalHeight: 10,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
    });
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpAnnotations: [annotation],
    });

    // Selecting the folded figure drops any annotation selection...
    useWorkspaceStore.getState().setSelectedAnnotation(annotation.id);
    useWorkspaceStore.getState().setOristudioCpActiveFoldedFigure(figure.id);
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe(figure.id);

    // ...and selecting the annotation drops the folded one.
    useWorkspaceStore.getState().setSelectedAnnotation(annotation.id);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe(annotation.id);

    // Clearing one leaves the other alone rather than forcing a deselect.
    useWorkspaceStore.getState().setSelectedAnnotation(null);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
  });

  // The crease selection is the fourth holder of the same single selection, and
  // used to be outside the rule entirely. That is what let a focused simulation
  // window and a selected crease both be live, so one Delete deleted both.
  it('keeps the canvas selection exclusive between creases and every object kind', () => {
    resetStores(seedSnapshot());
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    const annotation = createCpImage({
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 10,
      naturalHeight: 10,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
    });
    const selectCreases = () =>
      useWorkspaceStore.getState().toggleOristudioCpLineSelection(3);
    const state = () => useWorkspaceStore.getState();

    for (const [name, select] of [
      ['annotation', () => state().setSelectedAnnotation(annotation.id)],
      ['folded figure', () => state().setOristudioCpActiveFoldedFigure(figure.id)],
      [
        'inline simulation',
        () => state().focusOristudioCpInlineSimulation('inline-sim-1'),
      ],
    ] as const) {
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [figure],
        oristudioCpAnnotations: [annotation],
        oristudioCpInlineSimulations: [inlineSimulationFixture()],
        oristudioCpSelectedAnnotationId: null,
        oristudioCpActiveFoldedFigureId: null,
        oristudioCpFocusedInlineSimulationId: null,
        oristudioCpSelection: emptyOristudioCpSelection(),
      });

      // Selecting a crease first, then the object: the creases go.
      selectCreases();
      expect(state().oristudioCpSelection.lines, name).toEqual([3]);
      select();
      expect(state().oristudioCpSelection.lines, name).toEqual([]);

      // And the other way round: clicking a crease gives up the object.
      select();
      selectCreases();
      expect(state().oristudioCpSelectedAnnotationId, name).toBeNull();
      expect(state().oristudioCpActiveFoldedFigureId, name).toBeNull();
      expect(state().oristudioCpFocusedInlineSimulationId, name).toBeNull();
      expect(state().oristudioCpSelection.lines, name).toEqual([3]);
    }
  });

  // The setters are not the only way creases get selected: executing a CP
  // operation writes the selection straight from the document it returns. That
  // path bypassed the invariant, so a select tool left a focused simulation
  // window highlighted *and* creases selected — the two-selections state the
  // invariant exists to prevent, reachable by the most ordinary route there is.
  it('applies the canvas rule to a selection that came from the kernel', () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [inlineSimulationFixture()],
      oristudioCpFocusedInlineSimulationId: 'inline-sim-1',
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [2, 4] },
    });

    useWorkspaceStore.getState().claimCanvasForCreaseSelection();

    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBeNull();
    // The creases the command selected are untouched — this only moves the claim.
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([2, 4]);
  });

  it('costs nothing when the creases already hold the canvas', () => {
    // It runs after every CP operation, so the ordinary case must not write.
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    const before = useWorkspaceStore.getState();

    useWorkspaceStore.getState().claimCanvasForCreaseSelection();

    expect(useWorkspaceStore.getState()).toBe(before);
  });

  it('lets an empty crease selection release the canvas rather than claim it', () => {
    // Tools clear the selection as they start; that must not also drop the
    // reference image or folded figure the user is working next to.
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpInlineSimulations: [inlineSimulationFixture()],
      oristudioCpFocusedInlineSimulationId: 'inline-sim-1',
    });

    useWorkspaceStore.getState().setOristudioCpSelection(emptyOristudioCpSelection());
    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBe(
      'inline-sim-1'
    );

    useWorkspaceStore.getState().clearOristudioCpSelection();
    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBe(
      'inline-sim-1'
    );
  });

  it('rerenders folded figure selected markers when the active figure changes', async () => {
    resetStores(seedSnapshot());
    const first: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 7,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    const second: OristudioCpFoldedFigureEntry = {
      ...first,
      id: 'generated-2',
      title: 'Folded model 2',
      handle: 8,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [first, second],
      oristudioCpActiveFoldedFigureId: first.id,
    });
    oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockClear();

    useWorkspaceStore.getState().setOristudioCpActiveFoldedFigure(second.id);
    await Promise.resolve();
    await Promise.resolve();

    expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).toHaveBeenCalledWith(
      7,
      'Paper5',
      {
        display_mark: false,
        selected: false,
        index: 1,
      }
    );
    expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).toHaveBeenCalledWith(
      8,
      'Paper5',
      {
        display_mark: false,
        selected: true,
        index: 2,
      }
    );
  });

  it('treats folded figure handle 0 as valid (wasm slot indices start at 0)', async () => {
    // Regression: the first folded figure gets wasm handle 0, and truthy guards
    // (`!figure.handle`) wrongly rejected it as "No folded model is ready", so
    // every action except Delete failed on the first model.
    resetStores(seedSnapshot());
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 0,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: foldedFigureSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpActiveFoldedFigureId: figure.id,
      oristudioCpError: null,
    });

    await useWorkspaceStore.getState().setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Wire2');
    expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).toHaveBeenCalledWith(
      0,
      'Wire2',
      expect.anything()
    );

    await useWorkspaceStore.getState().updateOristudioCpFoldedFigureModel(figure.id, {
      state: 'Back1',
    });
    expect(oristudioCpMocks.setOristudioCpFoldedFigureModel).toHaveBeenCalledWith(
      0,
      expect.objectContaining({ state: 'Back1' })
    );

    await useWorkspaceStore.getState().duplicateOristudioCpFoldedFigure(figure.id);
    expect(oristudioCpMocks.duplicateOristudioCpFoldedFigure).toHaveBeenCalledWith(0);

    // None of the handle-0 actions tripped the "not ready" guard.
    expect(useWorkspaceStore.getState().oristudioCpError).toBeNull();
  });

  it('releases folded figure handles when clearing the editable CP document', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    useWorkspaceStore.setState({
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await useWorkspaceStore.getState().foldOristudioCpDocument();

    await useWorkspaceStore.getState().clearOristudioCpDocument();

    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(7);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
  });

  it('normalizes nullable CP command payloads and rejects invalid payload shapes before runtime', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...currentDocument,
      lastCommandResult: {
        operation: 'CreaseMakeMountain',
        status: 'OracleTested',
        diagnostics: [],
      },
    });

    await expect(
      useWorkspaceStore
        .getState()
        .executeOristudioCpCommand('CreaseMakeMountain', null as never)
    ).resolves.toBe(true);

    expect(oristudioCpMocks.executeOristudioCpCommand).toHaveBeenCalledWith(
      'CreaseMakeMountain',
      {}
    );

    oristudioCpMocks.executeOristudioCpCommand.mockClear();
    await expect(
      useWorkspaceStore
        .getState()
        .executeOristudioCpCommand('CreaseMakeMountain', ['bad'] as never)
    ).resolves.toBe(false);

    expect(oristudioCpMocks.executeOristudioCpCommand).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpError).toContain(
      'Invalid crease-pattern command payload'
    );
  });

  it('surfaces demand-refresh fold export errors without leaving artifacts loading', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...currentDocument,
      lastCommandResult: {
        operation: 'CreaseMakeMountain',
        status: 'OracleTested',
        diagnostics: ['Changed 1 line'],
      },
    });

    await expect(useWorkspaceStore.getState().executeOristudioCpCommand('CreaseMakeMountain')).resolves.toBe(
      true
    );
    oristudioCpMocks.exportOristudioCpDocumentAsFold.mockRejectedValueOnce({
      code: 'export_failed',
      message: 'Fold export failed',
    });

    await expect(useWorkspaceStore.getState().ensureFoldArtifacts()).resolves.toBeNull();

    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('error');
    expect(useWorkspaceStore.getState().foldArtifactError).toBe('Fold export failed');
    expect(useWorkspaceStore.getState().foldArtifacts).toBeNull();
  });

  it('refreshes always-on CAMV diagnostics (deferred) after editable CP mutations', async () => {
    // CAMV recompute is deferred off the edit's critical path: the mutation applies +
    // renders immediately, then a debounced CheckCamv updates the overlay. Fake timers
    // let us flush that deferred pass before asserting the overlay result.
    vi.useFakeTimers();
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    useWorkspaceStore.setState({ dirty: false, oristudioCpCamvResult: null });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    const commandResult: OristudioCpCommandResult = {
      operation: 'CreaseMakeMountain',
      status: 'OracleTested',
      diagnostics: ['Changed 2 line(s)'],
    };
    const camvResult = camvErrorResult();
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...currentDocument,
      lastCommandResult: commandResult,
    });
    oristudioCpMocks.runOristudioCpCheckCommand.mockResolvedValueOnce(camvResult);

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('CreaseMakeMountain', {
        line_ids: [1, 2],
      })
    ).resolves.toBe(true);

    // The edit applied + rendered immediately, without awaiting CAMV.
    expect(oristudioCpMocks.executeOristudioCpCommand).toHaveBeenCalledWith(
      'CreaseMakeMountain',
      { line_ids: [1, 2] }
    );
    expect(useWorkspaceStore.getState().oristudioCpDocument?.lastCommandResult).toEqual(
      commandResult
    );
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    // CAMV has not run yet — it is debounced off the critical path.
    expect(oristudioCpMocks.runOristudioCpCheckCommand).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpCamvResult).toBeNull();

    // Flush the deferred recompute; the overlay result now lands.
    await vi.advanceTimersByTimeAsync(200);
    expect(oristudioCpMocks.runOristudioCpCheckCommand).toHaveBeenCalledWith('CheckCamv');
    expect(useWorkspaceStore.getState().oristudioCpCamvResult).toEqual(camvResult);
  });

  it('keeps editable CP diagnostic checks out of undo history', async () => {
    resetStores(seedSnapshot());
    const frameModelBounds = vi.fn();
    unregisterCamera = registerCpCamera({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fit: vi.fn(),
      setZoomPercent: vi.fn(),
      rotateBy: vi.fn(),
      rotateTo: vi.fn(),
      rotateReset: vi.fn(),
      frameModelBounds,
    });
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    useWorkspaceStore.setState({ dirty: false });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...currentDocument,
      lastCommandResult: {
        operation: 'Check1',
        status: 'OracleTested',
        diagnostics: ['Check1 found 1 issue(s)'],
        diagnostic_entries: [
          {
            id: 'Check1-1',
            kind: 'Check1',
            severity: 'error',
            message: 'Overlapping or contained non-auxiliary creases',
            point: { x: 120, y: 240 },
            segments: currentDocument.document.crease_pattern.line_segments,
            rule: 'Check1',
          },
        ],
      },
    });

    await expect(useWorkspaceStore.getState().executeOristudioCpCommand('Check1')).resolves.toBe(
      true
    );

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(0);
    expect(useWorkspaceStore.getState().oristudioCpHistoryFuture).toHaveLength(0);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe('Check1-1');
    // Adopting the issue also frames it. Asserted here, at the store action, because
    // that is the only point every way of running a check goes through — the tool
    // rail, the menu (which never touches the CP panel), and the CP-detect import
    // loop all land on this action.
    expect(frameModelBounds).toHaveBeenCalledTimes(1);
    expect(frameModelBounds.mock.calls[0][0]).toMatchObject({ minX: 120, minY: 240 });
    expect(
      useWorkspaceStore.getState().oristudioCpDocument?.lastCommandResult?.diagnostic_entries
    ).toHaveLength(1);

    const checkedDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!checkedDocument) throw new Error('expected checked CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...checkedDocument,
      lastCommandResult: {
        operation: 'FlatFoldableCheck',
        status: 'OracleTested',
        diagnostics: ['Flat-foldable boundary check passed'],
        diagnostic_entries: [
          {
            id: 'FlatFoldableCheck-1',
            kind: 'FlatFoldableCheck',
            severity: 'info',
            message: 'Boundary crossing order is flat-foldable',
            segments: [],
            rule: 'FlatFoldableBoundary',
          },
        ],
      },
    });

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('FlatFoldableCheck')
    ).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(0);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe(
      'FlatFoldableCheck-1'
    );
    // Adopted, but it reports no geometry, so there is nothing to frame and the
    // count stays where the Check1 jump left it.
    expect(frameModelBounds).toHaveBeenCalledTimes(1);

    const flatCheckedDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!flatCheckedDocument) throw new Error('expected flat-checked CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...flatCheckedDocument,
      lastCommandResult: {
        operation: 'Fix1',
        status: 'OracleTested',
        diagnostics: ['Changed 0 line(s)'],
      },
    });

    await expect(useWorkspaceStore.getState().executeOristudioCpCommand('Fix1')).resolves.toBe(
      true
    );

    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBeNull();
    // An edit has no issue to look at, so it frames nothing.
    expect(frameModelBounds).toHaveBeenCalledTimes(1);
  });

  it('frames a diagnostic when it is activated, and at no other time', async () => {
    resetStores(seedSnapshot());
    const frameModelBounds = vi.fn();
    unregisterCamera = registerCpCamera({
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      fit: vi.fn(),
      setZoomPercent: vi.fn(),
      rotateBy: vi.fn(),
      rotateTo: vi.fn(),
      rotateReset: vi.fn(),
      frameModelBounds,
    });
    useWorkspaceStore.setState({
      oristudioCpCamvResult: {
        operation: 'CheckCamv',
        status: 'OracleTested',
        diagnostics: [],
        diagnostic_entries: [
          {
            id: 'CheckCamv-1',
            kind: 'CheckCamv',
            severity: 'error',
            message: 'Maekawa violated',
            point: { x: 40, y: 60 },
          },
        ],
      },
    });
    const { setOristudioCpActiveDiagnostic, setOristudioCpViewportOption } =
      useWorkspaceStore.getState();

    setOristudioCpActiveDiagnostic('CheckCamv-1');
    expect(frameModelBounds).toHaveBeenCalledTimes(1);

    // The reported bug: hiding and re-showing the overlay re-derives the entry
    // list, which must not read as a fresh instruction to jump. The diagnostic
    // stays selected throughout — only the framing is one-shot.
    setOristudioCpViewportOption('camvIssuesVisible', false);
    setOristudioCpViewportOption('camvIssuesVisible', true);
    expect(frameModelBounds).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBe('CheckCamv-1');

    // Activating it again is a new instruction, so it frames again — clicking the
    // same row after panning away should bring you back.
    setOristudioCpActiveDiagnostic('CheckCamv-1');
    expect(frameModelBounds).toHaveBeenCalledTimes(2);

    // Hidden issues are not jumped to.
    setOristudioCpViewportOption('camvIssuesVisible', false);
    setOristudioCpActiveDiagnostic('CheckCamv-1');
    expect(frameModelBounds).toHaveBeenCalledTimes(2);

    // Deselecting frames nothing.
    setOristudioCpViewportOption('camvIssuesVisible', true);
    setOristudioCpActiveDiagnostic(null);
    expect(frameModelBounds).toHaveBeenCalledTimes(2);
  });

  it('clears editable CP selection after destructive kernel commands', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    useWorkspaceStore.setState({
      oristudioCpSelection: {
        lines: [1],
        points: [],
        circles: [],
        texts: [],
        faces: [],
      },
    });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...currentDocument,
      document: {
        ...currentDocument.document,
        crease_pattern: {
          ...currentDocument.document.crease_pattern,
          line_segments: currentDocument.document.crease_pattern.line_segments.slice(1),
        },
      },
      summary: {
        ...currentDocument.summary,
        line_segments: Math.max(0, currentDocument.summary.line_segments - 1),
      },
    });

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('LineSegmentDelete', {
        line_ids: [1],
      })
    ).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpSelection).toEqual(
      emptyOristudioCpSelection()
    );
  });

  it('syncs editable CP selection from kernel line selection commands', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    const revision = useWorkspaceStore.getState().oristudioCpRevision;
    // The kernel answers a selection with the selected lines, not a document.
    oristudioCpMocks.executeOristudioCpSelectionCommand.mockResolvedValueOnce({
      result: {
        operation: 'SelectLineIntersecting',
        status: 'OracleTested',
        diagnostics: ['Changed 2 line(s)'],
      },
      before: { ids: new Uint32Array(0), values: new Int32Array(0) },
      after: { ids: Uint32Array.of(1, 2), values: Int32Array.of(2, 2) },
    });

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('SelectLineIntersecting', {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      })
    ).resolves.toBe(true);

    const state = useWorkspaceStore.getState();
    expect(oristudioCpMocks.executeOristudioCpCommand).not.toHaveBeenCalledWith(
      'SelectLineIntersecting',
      expect.anything()
    );
    expect(state.oristudioCpSelection).toEqual({
      ...emptyOristudioCpSelection(),
      lines: [1, 2],
    });
    // The same snapshot (its flags are written in place, which
    // `cpSelectionCommands.wasm.test.ts` checks against the real kernel).
    expect(state.oristudioCpDocument?.document).toBe(currentDocument.document);
    expect(state.oristudioCpDocument?.lastCommandResult?.operation).toBe('SelectLineIntersecting');
    expect(state.oristudioCpRevision).toBe(revision);
    expect(state.dirty).toBe(true);
    expect(state.oristudioCpHistoryPast.at(-1)).toMatchObject({
      label: 'SelectLineIntersecting',
      selectedLines: { ids: new Uint32Array(0), values: new Int32Array(0) },
    });
    // It leaves the document alone, so it keeps none of it.
    expect(state.oristudioCpHistoryPast.at(-1)?.document).toBeUndefined();
  });

  it('restores editable CP snapshots and selections through undo and redo', async () => {
    // The always-on CAMV recompute is now deferred (debounced, off the edit critical
    // path), so fake timers let us flush it before asserting the overlay result.
    vi.useFakeTimers();
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    useWorkspaceStore.setState({
      oristudioCpSelection: {
        ...emptyOristudioCpSelection(),
        lines: [1],
      },
    });
    const loadedDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!loadedDocument) throw new Error('expected editable CP document');
    const changedDocument = {
      ...loadedDocument.document,
      crease_pattern: {
        ...loadedDocument.document.crease_pattern,
        line_segments: [
          {
            a: { x: 0, y: 0 },
            b: { x: 1, y: 0 },
            active: 'Inactive0',
            color: 'Red1',
            selected: 0,
            customized: 0,
            customized_color: { red: 100, green: 200, blue: 200 },
          },
        ],
      },
    };
    oristudioCpMocks.executeOristudioCpCommand.mockResolvedValueOnce({
      ...loadedDocument,
      document: changedDocument,
      summary: {
        ...loadedDocument.summary,
        line_segments: 1,
      },
    });

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('CreaseMakeMountain', {
        line_ids: [1],
      })
    ).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpHistoryPast[0]).toMatchObject({
      document: { snapshot: loadedDocument.document },
      selection: { lines: [1] },
      label: 'CreaseMakeMountain',
    });

    expect(selectWorkspaceCapabilities(useWorkspaceStore.getState())['edit.undo'].enabled).toBe(
      true
    );

    const undoCamvResult = camvErrorResult('CheckCamv-undo');
    oristudioCpMocks.runOristudioCpCheckCommand.mockResolvedValueOnce(undoCamvResult);
    await useWorkspaceStore.getState().undo();
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).toHaveBeenLastCalledWith(
      loadedDocument.document,
      loadedDocument.source,
      null
    );
    // Undo restores in place: the handle and load serial are unchanged, so the
    // editor viewport is not re-fit (regression for the undo canvas jump).
    expect(useWorkspaceStore.getState().oristudioCpDocument?.handle).toBe(loadedDocument.handle);
    expect(useWorkspaceStore.getState().oristudioCpDocument?.loadSerial).toBe(
      loadedDocument.loadSerial
    );
    expect(useWorkspaceStore.getState().oristudioCpDocument?.document).toEqual(
      loadedDocument.document
    );
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
    // CAMV is recomputed off the critical path — flush the debounce, then assert.
    await vi.advanceTimersByTimeAsync(200);
    expect(useWorkspaceStore.getState().oristudioCpCamvResult).toEqual(undoCamvResult);
    expect(useWorkspaceStore.getState().oristudioCpHistoryFuture).toHaveLength(1);
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('stale');
    expect(useWorkspaceStore.getState().foldArtifacts).toBeNull();
    expect(useWorkspaceStore.getState().projectMessage).toBe('Undid CreaseMakeMountain');

    await expect(useWorkspaceStore.getState().ensureFoldArtifacts()).resolves.toBeTruthy();
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('ready');

    expect(selectWorkspaceCapabilities(useWorkspaceStore.getState())['edit.redo'].enabled).toBe(
      true
    );

    const redoCamvResult = camvErrorResult('CheckCamv-redo');
    oristudioCpMocks.runOristudioCpCheckCommand.mockResolvedValueOnce(redoCamvResult);
    await useWorkspaceStore.getState().redo();
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).toHaveBeenLastCalledWith(
      changedDocument,
      loadedDocument.source,
      null
    );
    expect(useWorkspaceStore.getState().oristudioCpDocument?.document).toEqual(changedDocument);
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
    await vi.advanceTimersByTimeAsync(200);
    expect(useWorkspaceStore.getState().oristudioCpCamvResult).toEqual(redoCamvResult);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('stale');
    expect(useWorkspaceStore.getState().foldArtifacts).toBeNull();
    expect(useWorkspaceStore.getState().projectMessage).toBe('Redid CreaseMakeMountain');

    await expect(useWorkspaceStore.getState().ensureFoldArtifacts()).resolves.toBeTruthy();
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('ready');
  });

  it('saves imported FOLD documents as native projects without overwriting the source FOLD path', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText(
      JSON.stringify({
        file_spec: 1.1,
        vertices_coords: [
          [0, 0],
          [1, 0],
        ],
        edges_vertices: [[0, 1]],
        edges_assignment: ['B'],
      }),
      {
        filename: 'line.fold',
        path: '/tmp/line.fold',
      }
    );
    const fileService = createFileService();

    await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

    expect(fileService.saveTextFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Save Ori Studio Project',
        suggestedName: 'line.osf',
        path: null,
        extensions: ['osf'],
      })
    );
    expect(useWorkspaceStore.getState()).toMatchObject({
      currentFileName: 'line.osf',
      currentFilePath: '/tmp/line.osf',
    });
    expect(useWorkspaceStore.getState().oristudioCpDocument?.source).toEqual({
      format: 'osf',
      filename: 'line.osf',
      path: '/tmp/line.osf',
    });
  });

  it('tracks editable CP viewport options and selection independently from tree selection', () => {
    resetStores(seedSnapshot());

    useWorkspaceStore.getState().toggleOristudioCpLineSelection(2);
    expect(useWorkspaceStore.getState().oristudioCpSelection).toMatchObject({ lines: [2] });
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'tree' });

    useWorkspaceStore.getState().toggleOristudioCpPointSelection(1, true);
    expect(useWorkspaceStore.getState().oristudioCpSelection).toMatchObject({
      lines: [2],
      points: [1],
    });

    useWorkspaceStore.getState().setOristudioCpViewportOption('snapToGrid', false);
    expect(useWorkspaceStore.getState().oristudioCpViewport).toMatchObject({
      snapToGrid: false,
      snapToVertices: true,
    });

    useWorkspaceStore.getState().setOristudioCpViewportOption('camvIssuesVisible', false);
    expect(useWorkspaceStore.getState().oristudioCpViewport).toMatchObject({
      camvIssuesVisible: false,
    });

    useWorkspaceStore.getState().clearOristudioCpSelection();
    expect(useWorkspaceStore.getState().oristudioCpSelection).toEqual(
      emptyOristudioCpSelection()
    );
  });

  it('unselects one crease without touching the rest of the selection', () => {
    resetStores(seedSnapshot());
    const state = () => useWorkspaceStore.getState();

    state().toggleOristudioCpLineSelection(2);
    state().toggleOristudioCpLineSelection(5, true);
    state().toggleOristudioCpPointSelection(1, true);

    // The deselect tools' click. A crease that is not selected is left alone,
    // where the toggle above would have added it.
    state().unselectOristudioCpLine(4);
    expect(state().oristudioCpSelection).toMatchObject({ lines: [2, 5], points: [1] });

    state().unselectOristudioCpLine(2);
    expect(state().oristudioCpSelection).toMatchObject({ lines: [5], points: [1] });
  });

  it('updates editable CP grid size as undoable document metadata', async () => {
    resetStores(seedSnapshot());
    const documentState = blankCpDocumentState();
    const selection = { ...emptyOristudioCpSelection(), lines: [1] };
    useWorkspaceStore.setState({
      oristudioCpDocument: documentState,
      // Installing a crease pattern focuses the CP editor, as every production
      // install path does (see `freshEditableCpState`).
      activePanelId: 'crease-pattern',
      oristudioCpSelection: selection,
      status: 'crease_pattern_ready',
      dirty: false,
    });

    await expect(useWorkspaceStore.getState().setOristudioCpGridSize(32.8)).resolves.toBe(
      true
    );

    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).toHaveBeenLastCalledWith(
      expect.objectContaining({
        crease_pattern: expect.objectContaining({
          grid: expect.objectContaining({ grid_size: 32 }),
        }),
      }),
      documentState.source,
      null
    );
    expect(
      useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.grid.grid_size
    ).toBe(32);
    expect(useWorkspaceStore.getState().oristudioCpSelection).toEqual(selection);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Set grid size to 32');
    // A fixture state has no geometry, so the entry keeps its snapshot; every
    // state read from the kernel has geometry (`cpSelectionCommands.wasm.test.ts`).
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast[0]).toMatchObject({
      document: { snapshot: documentState.document },
      selection,
      label: 'Set grid size to 32',
    });

    await useWorkspaceStore.getState().undo();
    expect(
      useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.grid.grid_size
    ).toBe(8);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Undid Set grid size to 32');

    await useWorkspaceStore.getState().redo();
    expect(
      useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.grid.grid_size
    ).toBe(32);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Redid Set grid size to 32');
  });

  it('normalizes advanced grid metadata using Oriedita validation rules', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: blankCpDocumentState(),
      status: 'crease_pattern_ready',
      dirty: false,
    });

    await expect(
      useWorkspaceStore.getState().updateOristudioCpGrid(
        {
          grid_angle: 400,
          interval_grid_size: 0,
          grid_xa: 0,
          grid_xb: 0,
          grid_xc: 1,
          draw_diagonal_gridlines: true,
        },
        'Configure grid'
      )
    ).resolves.toBe(true);

    const grid = useWorkspaceStore.getState().oristudioCpDocument?.document.crease_pattern.grid;
    // Angle clamps to [1, 179]; interval floors to 1; the degenerate X axis
    // (length 0) resets to 1 + 0*sqrt(1); the diagonal flag is applied.
    expect(grid).toMatchObject({
      grid_angle: 179,
      interval_grid_size: 1,
      grid_xa: 1,
      grid_xb: 0,
      grid_xc: 1,
      draw_diagonal_gridlines: true,
    });
    expect(useWorkspaceStore.getState().projectMessage).toBe('Configure grid');

    // Re-applying identical metadata is a no-op that neither reloads the kernel
    // nor pushes another undo entry.
    oristudioCpMocks.restoreOristudioCpDocumentInPlace.mockClear();
    const historyDepth = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    await expect(
      useWorkspaceStore.getState().updateOristudioCpGrid({ grid_angle: 400 })
    ).resolves.toBe(true);
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(historyDepth);
  });

  it('applies editing and condition actions through the engine', async () => {
    const api = resetStores(
      makeSnapshot({
        ...seedSnapshot(),
        conditions: [conditionSnapshot(1)],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().addNodeAt({ x: 0.75, y: 0.75 }, 1);
    expect(selectProject(useWorkspaceStore.getState()).nodes.map((node) => node.id)).toEqual([1, 2, 3]);
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'node', id: 3 });
    expect(useWorkspaceStore.getState().status).toBe('needs_optimization');
    expect(selectHistoryPast(useWorkspaceStore.getState()).at(-1)?.label).toBe('Add node');

    await useWorkspaceStore.getState().moveNode(3, { x: 0.8, y: 0.7 });
    expect(selectProject(useWorkspaceStore.getState()).nodes.find((node) => node.id === 3)?.loc).toEqual({
      x: 0.8,
      y: 0.7,
    });

    await useWorkspaceStore.getState().updateNodeLabel(3, 'new tip');
    expect(selectProject(useWorkspaceStore.getState()).nodes.find((node) => node.id === 3)?.label).toBe(
      'new tip'
    );

    await useWorkspaceStore.getState().addEdge(2, 3);
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'edge', id: 3 });

    await useWorkspaceStore
      .getState()
      .updateEdge(3, { label: 'span', length: 2, strain: 0.1, stiffness: 4 });
    expect(selectProject(useWorkspaceStore.getState()).edges.find((edge) => edge.id === 3)).toMatchObject({
      label: 'span',
      length: 2,
      strain: 0.1,
      stiffness: 4,
    });

    useWorkspaceStore.getState().select({ kind: 'multi', nodes: [1, 2], edges: [], paths: [], creases: [], facets: [], conditions: [] });
    useWorkspaceStore.getState().selectPathBetweenSelectedNodes();
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'path', id: 1 });

    useWorkspaceStore.getState().selectAll();
    expect(selectSelection(useWorkspaceStore.getState())).toMatchObject({ kind: 'multi', nodes: [1, 2, 3] });
    useWorkspaceStore.getState().selectNone();
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'tree' });
    useWorkspaceStore.getState().setToolMode('node');
    expect(selectToolMode(useWorkspaceStore.getState())).toBe('node');

    await useWorkspaceStore.getState().updatePaper({ width: 2, height: 3 });
    expect(selectProject(useWorkspaceStore.getState()).paper).toMatchObject({ width: 2, height: 3 });

    await useWorkspaceStore
      .getState()
      .setSymmetry({ hasSymmetry: true, symLoc: { x: 0.25, y: 0.75 }, symAngle: 45 });
    expect(selectProject(useWorkspaceStore.getState())).toMatchObject({
      hasSymmetry: true,
      paper: { symLoc: { x: 0.25, y: 0.75 }, symAngle: 45 },
    });

    await useWorkspaceStore.getState().addCondition(nodeFixedCondition(2));
    expect(selectProject(useWorkspaceStore.getState()).conditions).toHaveLength(2);
    await useWorkspaceStore.getState().deleteCondition(1);
    expect(selectProject(useWorkspaceStore.getState()).conditions.map((condition) => condition.id)).toEqual([2]);
    await useWorkspaceStore.getState().clearConditions();
    expect(selectProject(useWorkspaceStore.getState()).conditions).toEqual([]);

    useWorkspaceStore.getState().selectAll();
    await useWorkspaceStore.getState().deleteSelection();
    expect(selectProject(useWorkspaceStore.getState()).nodes).toEqual([]);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Cleared design');
  });

  it('selects by index, movable parts, and corridor facets', () => {
    const api = resetStores(
      makeSnapshot({
        nodes: [
          nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'root', is_leaf: false }),
          nodeSnapshot(2, { x: 0.2, y: 0.2 }, { is_pinned: true }),
          nodeSnapshot(3, { x: 0.8, y: 0.2 }),
        ],
        edges: [edgeSnapshot(1, [1, 2]), edgeSnapshot(2, [1, 3])],
        paths: [pathSnapshot(1, [2, 3])],
        vertices: [
          { id: 1, loc: { x: 0, y: 0 } },
          { id: 2, loc: { x: 1, y: 0 } },
          { id: 3, loc: { x: 0, y: 1 } },
        ],
        facets: [
          { id: 1, vertices: [1, 2, 3], color: 1, corridor_edge: 1 },
          { id: 2, vertices: [1, 3, 2], color: 2, corridor_edge: 2 },
        ],
        conditions: [
          conditionSnapshot(1, { type: 'edge_length_fixed', edge: 2 }),
        ],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    useWorkspaceStore.getState().selectByIndex('node', 3);
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'node', id: 3 });

    useWorkspaceStore.getState().selectMovableParts();
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({
      kind: 'multi',
      nodes: [3],
      edges: [1],
      paths: [],
      creases: [],
      facets: [],
      conditions: [],
    });

    useWorkspaceStore.getState().select({ kind: 'edge', id: 2 });
    useWorkspaceStore.getState().selectCorridorFacets();
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({
      kind: 'multi',
      nodes: [],
      edges: [],
      paths: [],
      creases: [],
      facets: [2],
      conditions: [],
    });
  });

  it('applies core tree editing commands through the engine', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(api.snapshotState);

    useWorkspaceStore.getState().select({ kind: 'edge', id: 1 });
    await useWorkspaceStore.getState().setSelectedEdgeLengths(2);
    expect(selectProject(useWorkspaceStore.getState()).edges[0].length).toBe(2);

    await useWorkspaceStore.getState().scaleSelectedEdgeLengths(0.5);
    expect(selectProject(useWorkspaceStore.getState()).edges[0].length).toBe(1);

    await useWorkspaceStore.getState().splitSelectedEdge(0.4);
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'node', id: 3 });
    expect(selectProject(useWorkspaceStore.getState()).nodes).toHaveLength(3);

    useWorkspaceStore.getState().select({ kind: 'node', id: 2 });
    await useWorkspaceStore.getState().makeSelectedNodeRoot();
    expect(api.applyEdit).toHaveBeenLastCalledWith(1, { type: 'make_root', node: 2 });

    useWorkspaceStore.getState().select({ kind: 'edge', id: 1 });
    await useWorkspaceStore.getState().removeSelectionStrain();
    await useWorkspaceStore.getState().relieveSelectionStrain();
    await useWorkspaceStore.getState().renormalizeToSelectedEdge();
    await useWorkspaceStore.getState().renormalizeToUnitScale();
    await useWorkspaceStore.getState().perturbAllNodes();

    expect(api.applyEdit).toHaveBeenCalledWith(1, { type: 'remove_strain', edges: [1] });
    expect(api.applyEdit).toHaveBeenCalledWith(1, { type: 'relieve_strain', edges: [1] });
    expect(api.applyEdit).toHaveBeenCalledWith(1, { type: 'perturb_all_nodes' });
    expect(selectHistoryPast(useWorkspaceStore.getState()).at(-1)?.label).toBe('Perturb all nodes');
  });

  it('updates conditions and removes conditions scoped to selected parts', async () => {
    const api = resetStores(
      makeSnapshot({
        ...seedSnapshot(),
        conditions: [
          conditionSnapshot(1, nodeFixedCondition(2)),
          conditionSnapshot(2, { type: 'edge_length_fixed', edge: 1 }),
          conditionSnapshot(3, { type: 'path_active', node1: 1, node2: 2 }),
        ],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().updateCondition(1, {
      type: 'node_fixed',
      node: 2,
      x_fixed: true,
      y_fixed: true,
      x_fix_value: 0.2,
      y_fix_value: 0.3,
    });
    expect(selectProject(useWorkspaceStore.getState()).conditions[0].kind).toMatchObject({
      y_fixed: true,
      y_fix_value: 0.3,
    });

    useWorkspaceStore.getState().select({ kind: 'path', id: 1 });
    await useWorkspaceStore.getState().deleteConditionsForSelectedPaths();
    expect(selectProject(useWorkspaceStore.getState()).conditions.map((condition) => condition.kind.type)).toEqual([
      'node_fixed',
      'edge_length_fixed',
    ]);

    useWorkspaceStore.getState().select({ kind: 'node', id: 2 });
    await useWorkspaceStore.getState().deleteConditionsForSelectedNodes();
    expect(selectProject(useWorkspaceStore.getState()).conditions.map((condition) => condition.kind.type)).toEqual([
      'edge_length_fixed',
    ]);

    useWorkspaceStore.getState().select({ kind: 'edge', id: 1 });
    await useWorkspaceStore.getState().deleteConditionsForSelectedEdges();
    expect(selectProject(useWorkspaceStore.getState()).conditions).toEqual([]);
  });

  it('creates mirrored branches from an axial parent in one history entry', async () => {
    const api = resetStores(
      makeSnapshot({
        paper: { has_symmetry: true },
        nodes: [nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'axis', is_leaf: false })],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().addNodeWithSymmetry({ x: 0.25, y: 0.72 }, 1);

    expect(selectProject(useWorkspaceStore.getState()).nodes.map((node) => node.loc)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.72 },
      { x: 0.75, y: 0.72 },
    ]);
    expect(selectProject(useWorkspaceStore.getState()).edges.map((edge) => edge.nodes)).toEqual([
      [1, 2],
      [1, 3],
    ]);
    expect(selectProject(useWorkspaceStore.getState()).conditions.map((condition) => condition.kind)).toEqual([
      { type: 'nodes_paired', node1: 2, node2: 3 },
    ]);
    expect(selectSelection(useWorkspaceStore.getState())).toMatchObject({ kind: 'multi', nodes: [2, 3] });
    expect(selectHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
    expect(selectHistoryPast(useWorkspaceStore.getState())[0].label).toBe('Add mirrored branch');
  });

  it('keeps internal mirror links after branching from a mirrored leaf', async () => {
    const api = resetStores(
      makeSnapshot({
        paper: { has_symmetry: true },
        nodes: [
          nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'axis', is_leaf: false }),
          nodeSnapshot(2, { x: 0.28, y: 0.5 }),
          nodeSnapshot(3, { x: 0.72, y: 0.5 }),
        ],
        edges: [edgeSnapshot(1, [1, 2]), edgeSnapshot(2, [1, 3])],
        conditions: [
          conditionSnapshot(1, { type: 'nodes_paired', node1: 2, node2: 3 }),
        ],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().addNodeWithSymmetry({ x: 0.16, y: 0.7 }, 2);

    expect(selectProject(useWorkspaceStore.getState()).conditions.map((condition) => condition.kind)).toEqual([
      { type: 'nodes_paired', node1: 4, node2: 5 },
    ]);
    expect(selectSymmetryAuthoringPairs(useWorkspaceStore.getState())).toEqual([
      { node1: 2, node2: 3 },
      { node1: 4, node2: 5 },
    ]);

    await useWorkspaceStore.getState().addNodeWithSymmetry({ x: 0.14, y: 0.3 }, 2);

    const nodeLocs = selectProject(useWorkspaceStore.getState()).nodes.map((node) => node.loc);
    expect(nodeLocs).toHaveLength(7);
    expect(nodeLocs[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(nodeLocs[1]).toEqual({ x: 0.28, y: 0.5 });
    expect(nodeLocs[2]).toEqual({ x: 0.72, y: 0.5 });
    expect(nodeLocs[3]).toEqual({ x: 0.16, y: 0.7 });
    expect(nodeLocs[4]).toEqual({ x: 0.84, y: 0.7 });
    expect(nodeLocs[5]).toEqual({ x: 0.14, y: 0.3 });
    expect(nodeLocs[6]?.x).toBeCloseTo(0.86);
    expect(nodeLocs[6]?.y).toBeCloseTo(0.3);
    expect(selectProject(useWorkspaceStore.getState()).conditions.map((condition) => condition.kind)).toEqual([
      { type: 'nodes_paired', node1: 4, node2: 5 },
      { type: 'nodes_paired', node1: 6, node2: 7 },
    ]);
  });

  it('draws an axial segment once in symmetry mode', async () => {
    const api = resetStores(
      makeSnapshot({
        paper: { has_symmetry: true },
        nodes: [nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'axis', is_leaf: false })],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().addNodeWithSymmetry({ x: 0.506, y: 0.72 }, 1);

    expect(selectProject(useWorkspaceStore.getState()).nodes).toHaveLength(2);
    expect(selectProject(useWorkspaceStore.getState()).nodes[1].loc.x).toBeCloseTo(0.5);
    expect(selectProject(useWorkspaceStore.getState()).nodes[1].loc.y).toBeCloseTo(0.72);
    expect(selectProject(useWorkspaceStore.getState()).edges.map((edge) => edge.nodes)).toEqual([[1, 2]]);
    expect(selectProject(useWorkspaceStore.getState()).conditions).toEqual([]);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Added axial node');
  });

  it('moves paired leaf nodes together in one history entry', async () => {
    const api = resetStores(
      makeSnapshot({
        paper: { has_symmetry: true },
        nodes: [
          nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'root', is_leaf: false }),
          nodeSnapshot(2, { x: 0.2, y: 0.25 }),
          nodeSnapshot(3, { x: 0.8, y: 0.25 }),
        ],
        conditions: [
          conditionSnapshot(1, { type: 'nodes_paired', node1: 2, node2: 3 }),
        ],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().moveNodeWithSymmetry(2, { x: 0.3, y: 0.4 });

    expect(selectProject(useWorkspaceStore.getState()).nodes.find((node) => node.id === 2)?.loc).toEqual({
      x: 0.3,
      y: 0.4,
    });
    expect(selectProject(useWorkspaceStore.getState()).nodes.find((node) => node.id === 3)?.loc).toEqual({
      x: 0.7,
      y: 0.4,
    });
    expect(selectHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
    expect(selectHistoryPast(useWorkspaceStore.getState())[0].label).toBe('Move mirrored nodes');
  });

  it('updates mirrored flap edge lengths together', async () => {
    const api = resetStores(
      makeSnapshot({
        paper: { has_symmetry: true },
        nodes: [
          nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'root', is_leaf: false }),
          nodeSnapshot(2, { x: 0.2, y: 0.3 }),
          nodeSnapshot(3, { x: 0.8, y: 0.3 }),
        ],
        edges: [edgeSnapshot(1, [1, 2]), edgeSnapshot(2, [1, 3])],
        conditions: [
          conditionSnapshot(1, { type: 'nodes_paired', node1: 2, node2: 3 }),
        ],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    await useWorkspaceStore.getState().updateEdge(1, { length: 2.5 });

    expect(selectProject(useWorkspaceStore.getState()).edges.map((edge) => edge.length)).toEqual([
      2.5,
      2.5,
    ]);
    expect(selectHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
    expect(selectHistoryPast(useWorkspaceStore.getState())[0].label).toBe('Edit mirrored edges');
  });

  it('deletes a selected design node from the canonical engine snapshot', async () => {
    const api = resetStores(
      makeSnapshot({
        nodes: [
          nodeSnapshot(1, { x: 0.5, y: 0.5 }, { label: 'root', is_leaf: false }),
          nodeSnapshot(2, { x: 0.2, y: 0.2 }, { label: 'left' }),
          nodeSnapshot(3, { x: 0.8, y: 0.2 }, { label: 'right' }),
        ],
        edges: [edgeSnapshot(1, [1, 2]), edgeSnapshot(2, [1, 3])],
        paths: [pathSnapshot(1, [1, 2]), pathSnapshot(2, [1, 3]), pathSnapshot(3, [2, 3])],
      })
    );
    loadSnapshotIntoStore(api.snapshotState);

    useWorkspaceStore.getState().select({ kind: 'node', id: 2 });
    await useWorkspaceStore.getState().deleteSelection();

    expect(api.applyEdit).toHaveBeenCalledWith(1, { type: 'delete_node', id: 2 });
    expect(selectProject(useWorkspaceStore.getState()).nodes.map((node) => [node.id, node.label])).toEqual([
      [1, 'root'],
      [2, 'right'],
    ]);
    expect(selectProject(useWorkspaceStore.getState()).edges.map((edge) => [edge.id, edge.nodes])).toEqual([
      [1, [1, 2]],
    ]);
    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'tree' });
    expect(useWorkspaceStore.getState()).toMatchObject({
      status: 'needs_optimization',
      error: null,
      dirty: true,
    });
  });

  it('copies, cuts, and pastes selected topology', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());

    useWorkspaceStore.getState().select({
      kind: 'multi',
      nodes: [1, 2],
      edges: [],
      paths: [],
      creases: [],
      facets: [],
      conditions: [],
    });
    useWorkspaceStore.getState().copySelection();

    expect(useWorkspaceStore.getState().clipboard).toMatchObject({
      nodes: [
        { sourceId: 1, label: 'root' },
        { sourceId: 2, label: 'tip' },
      ],
      edges: [{ sourceId: 1, sourceNodes: [1, 2] }],
    });

    await useWorkspaceStore.getState().pasteClipboard();
    expect(selectProject(useWorkspaceStore.getState()).nodes.map((node) => node.id)).toEqual([1, 2, 3, 4]);
    expect(selectSelection(useWorkspaceStore.getState())).toMatchObject({
      kind: 'multi',
      nodes: [3, 4],
    });
    expect(useWorkspaceStore.getState().clipboardPasteCount).toBe(1);

    await useWorkspaceStore.getState().cutSelection();
    const clipboard = useWorkspaceStore.getState().clipboard;
    expect(clipboard?.kind).toBe('tree');
    expect(clipboard?.kind === 'tree' ? clipboard.nodes.map((node) => node.sourceId) : []).toEqual([3, 4]);
    expect(selectProject(useWorkspaceStore.getState()).nodes.map((node) => node.id)).toEqual([1, 2]);
  });

  it('copies and pastes selected editable CP lines', async () => {
    resetStores(seedSnapshot());
    const sourceLine = cpLine({ x: 0, y: 0 }, { x: 2, y: 0 }, { color: 'Blue2' });
    const documentState = editableCpState([
      sourceLine,
      cpLine({ x: 0, y: 1 }, { x: 2, y: 1 }),
    ]);
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: documentState,
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      status: 'crease_pattern_ready',
      engineReady: true,
    });
    oristudioCpMocks.insertOristudioCpLineSegments.mockImplementationOnce(
      async (segments: OristudioCpLineSegment[]) =>
        editableCpState([
          ...documentState.document.crease_pattern.line_segments,
          ...segments.map((segment) => ({ ...segment, selected: 2 })),
        ])
    );

    useWorkspaceStore.getState().copySelection();

    expect(useWorkspaceStore.getState().clipboard).toMatchObject({
      kind: 'cp-lines',
      lines: [{ color: 'Blue2' }],
    });

    await useWorkspaceStore.getState().pasteClipboard();

    expect(oristudioCpMocks.insertOristudioCpLineSegments).toHaveBeenCalledWith([
      expect.objectContaining({
        a: { x: 8, y: -8 },
        b: { x: 10, y: -8 },
        color: 'Blue2',
      }),
    ]);
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([3]);
    expect(useWorkspaceStore.getState().clipboardPasteCount).toBe(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Pasted 1 CP lines');
  });

  it('transforms selected editable CP lines through the CP mutation history', async () => {
    resetStores(seedSnapshot());
    const documentState = editableCpState([
      cpLine({ x: 0, y: 0 }, { x: 2, y: 0 }),
      cpLine({ x: 0, y: 1 }, { x: 2, y: 1 }, { color: 'Blue2' }),
    ]);
    useWorkspaceStore.setState({
      oristudioCpDocument: documentState,
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      status: 'crease_pattern_ready',
      engineReady: true,
    });
    oristudioCpMocks.replaceOristudioCpLineSegments.mockImplementationOnce(
      async (_lineIds: number[], segments: OristudioCpLineSegment[]) =>
        editableCpState([
          { ...segments[0], selected: 2 },
          documentState.document.crease_pattern.line_segments[1],
        ])
    );

    await expect(
      useWorkspaceStore
        .getState()
        .transformOristudioCpSelection({ kind: 'flip-horizontal' })
    ).resolves.toBe(true);

    expect(oristudioCpMocks.replaceOristudioCpLineSegments).toHaveBeenCalledWith(
      [1],
      [
        expect.objectContaining({
          a: { x: 2, y: 0 },
          b: { x: 0, y: 0 },
        }),
      ]
    );
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Flip CP selection horizontal');
  });

  it('records checkpoints and restores snapshots through undo and redo', async () => {
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());

    await useWorkspaceStore.getState().addNodeAt({ x: 0.8, y: 0.8 }, 1);
    expect(selectProject(useWorkspaceStore.getState()).nodes).toHaveLength(3);
    expect(selectHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);

    await useWorkspaceStore.getState().undo();
    expect(selectProject(useWorkspaceStore.getState()).nodes).toHaveLength(2);
    expect(selectHistoryFuture(useWorkspaceStore.getState())).toHaveLength(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Undid Add node');

    await useWorkspaceStore.getState().redo();
    expect(selectProject(useWorkspaceStore.getState()).nodes).toHaveLength(3);
    expect(selectHistoryPast(useWorkspaceStore.getState())).toHaveLength(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Redid Add node');

    useWorkspaceStore.getState().clearHistory();
    expect(selectHistoryPast(useWorkspaceStore.getState())).toEqual([]);
    expect(selectHistoryFuture(useWorkspaceStore.getState())).toEqual([]);
  });

  it('optimizes, builds crease patterns, toggles color mode, and foregrounds Edit', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    // A delegating spy, not a stub: `activateWorkspace` is also what settles
    // which pane is active, so replacing it outright hides the very disagreement
    // that killed the Edit shortcuts after an open.
    const activateWorkspace = vi.fn(useLayoutStore.getState().activateWorkspace);
    useLayoutStore.setState({ activateWorkspace });

    const initialFitRequestId = selectDesignViewportFitRequestId(useWorkspaceStore.getState());
    await useWorkspaceStore.getState().optimizeScale();
    expect(useWorkspaceStore.getState().status).toBe('optimized');
    expect(selectLastOptimization(useWorkspaceStore.getState())).toMatchObject({ kind: 'scale' });
    expect(selectDesignViewportFitRequestId(useWorkspaceStore.getState())).toBe(
      initialFitRequestId + 1
    );

    await useWorkspaceStore.getState().optimizeEdges();
    expect(selectLastOptimization(useWorkspaceStore.getState())).toMatchObject({ kind: 'edges' });
    expect(selectDesignViewportFitRequestId(useWorkspaceStore.getState())).toBe(
      initialFitRequestId + 1
    );

    await useWorkspaceStore.getState().optimizeStrain();
    expect(selectLastOptimization(useWorkspaceStore.getState())).toMatchObject({ kind: 'strain' });
    expect(selectDesignViewportFitRequestId(useWorkspaceStore.getState())).toBe(
      initialFitRequestId + 1
    );

    await useWorkspaceStore.getState().buildCreasePattern();
    expect(useWorkspaceStore.getState().status).toBe('crease_pattern_ready');
    expect(selectProject(useWorkspaceStore.getState()).creases).toHaveLength(1);
    expect(useWorkspaceStore.getState().foldArtifacts?.fold.vertices_coords).toHaveLength(3);
    expect(useWorkspaceStore.getState().refreshFoldArtifacts).toBeTypeOf('function');
    expect(api.foldArtifacts).toHaveBeenCalledWith(1);
    expect(activateWorkspace).toHaveBeenCalledWith('edit');

    useWorkspaceStore.getState().setCreaseColorMode('mvf');
    expect(useWorkspaceStore.getState().creaseColorMode).toBe('mvf');
  });

  it('ignores stale fold artifact responses after the source changes', async () => {
    const api = resetStores(seedSnapshot());
    const builtSnapshot = await api.buildCreasePattern();
    loadSnapshotIntoStore(builtSnapshot);
    const currentArtifacts = foldArtifactsFromSnapshot(builtSnapshot);
    const staleArtifacts: FoldArtifacts = {
      ...currentArtifacts,
      folded_base_error: 'stale response',
    };
    let resolveStale: (artifacts: FoldArtifacts) => void = () => undefined;
    const stalePromise = new Promise<FoldArtifacts>((resolve) => {
      resolveStale = resolve;
    });
    api.foldArtifacts
      .mockImplementationOnce(async () => stalePromise)
      .mockResolvedValueOnce(currentArtifacts);

    const staleRefresh = useWorkspaceStore.getState().ensureFoldArtifacts();
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('loading');

    useWorkspaceStore.getState().markFoldSourceChanged();
    await expect(useWorkspaceStore.getState().ensureFoldArtifacts()).resolves.toBe(
      currentArtifacts
    );
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('ready');

    resolveStale(staleArtifacts);
    await expect(staleRefresh).resolves.toBe(staleArtifacts);

    expect(useWorkspaceStore.getState().foldArtifacts).toBe(currentArtifacts);
    expect(useWorkspaceStore.getState().foldArtifactError).toBeNull();
  });

  it('ignores a fold artifact response for a document that has since been replaced', async () => {
    // Same guarantee as above, but for a *document load* rather than an edit.
    // A load resets the whole fold-artifact resource, so the request bookkeeping
    // cannot live in it: restarted at zero, the in-flight request for the file
    // being closed matched the one for the file being opened and won the race.
    const api = resetStores(seedSnapshot());
    const builtSnapshot = await api.buildCreasePattern();
    loadSnapshotIntoStore(builtSnapshot);
    const currentArtifacts = foldArtifactsFromSnapshot(builtSnapshot);
    const closedFileArtifacts: FoldArtifacts = {
      ...currentArtifacts,
      folded_base_error: 'artifacts for the file that was closed',
    };
    let resolveClosedFile: (artifacts: FoldArtifacts) => void = () => undefined;
    const closedFilePromise = new Promise<FoldArtifacts>((resolve) => {
      resolveClosedFile = resolve;
    });
    api.foldArtifacts
      .mockImplementationOnce(async () => closedFilePromise)
      .mockResolvedValueOnce(currentArtifacts);

    const closedFileRequest = useWorkspaceStore.getState().ensureFoldArtifacts();
    expect(useWorkspaceStore.getState().foldArtifactStatus).toBe('loading');

    await useWorkspaceStore.getState().loadProjectText('another tree', {
      filename: 'another.tmd5',
      path: '/tmp/another.tmd5',
    });
    await expect(useWorkspaceStore.getState().ensureFoldArtifacts()).resolves.toBe(
      currentArtifacts
    );

    resolveClosedFile(closedFileArtifacts);
    await expect(closedFileRequest).resolves.toBe(closedFileArtifacts);

    expect(useWorkspaceStore.getState().foldArtifacts).toBe(currentArtifacts);
  });

  it('does not mark CP ready when build returns no drawable crease pattern', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    api.buildCreasePattern.mockResolvedValueOnce(seedSnapshot());

    await useWorkspaceStore.getState().buildCreasePattern();

    expect(useWorkspaceStore.getState().status).toBe('optimized');
    expect(selectProject(useWorkspaceStore.getState()).creases).toHaveLength(0);
    expect(selectProject(useWorkspaceStore.getState()).facets).toHaveLength(0);
    expect(useWorkspaceStore.getState().error).toEqual({
      code: 'invalid_operation',
      message: 'Build CP completed but did not produce drawable crease-pattern geometry.',
    });
    expect(api.foldArtifacts).not.toHaveBeenCalled();
  });

  it('blocks building a crease pattern before optimization succeeds', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    useWorkspaceStore.setState({ status: 'needs_optimization', error: null });

    await useWorkspaceStore.getState().buildCreasePattern();

    expect(api.buildCreasePattern).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().status).toBe('needs_optimization');
    expect(useWorkspaceStore.getState().error).toEqual({
      code: 'invalid_operation',
      message: 'Optimize Scale before building the crease pattern',
    });
  });

  it('surfaces engine errors on mutating actions', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    api.applyEdit.mockRejectedValueOnce({ code: 'invalid_operation', message: 'nope' });

    await useWorkspaceStore.getState().addNodeAt({ x: 0.4, y: 0.4 });

    expect(useWorkspaceStore.getState().status).toBe('error');
    expect(useWorkspaceStore.getState().error).toEqual({
      code: 'invalid_operation',
      message: 'nope',
    });
  });

  describe('Box Pleating Studio file interchange', () => {
    it('opens a .bps file as a box-pleat design in the BP context', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      const fileService = createFileService({
        text: '{"title":"Crane","tree":{}}',
        name: 'crane.bps',
        path: '/tmp/crane.bps',
      });

      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      expect(bpMocks.loadOristudioBpProjectFromText).toHaveBeenCalledWith(
        '{"title":"Crane","tree":{}}',
        expect.objectContaining({ filename: 'crane.bps', format: 'bps' })
      );
      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).not.toBeNull();
      expect(selectDesignMethod(state)).toBe('box-pleat');
      expect(state.activeEditingContext).toBe('bp-tree');
    });

    it('discards the previously open document when a .bps replaces it', async () => {
      // Regression: opening a box-pleat project replaced only the BP document
      // and left the previous file's project and fold artifacts in the store.
      // The Simulate workspace simulates `foldArtifacts` verbatim and only
      // re-derives them when they are null, so the file the user had just
      // closed kept folding under the new project's name.
      resetStores(seedSnapshot());
      await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
        filename: 'crease.cp',
        path: '/tmp/crease.cp',
      });
      // Materialize them, so the assertion below is about the swap discarding
      // artifacts rather than about them never having existed.
      await useWorkspaceStore.getState().ensureFoldArtifacts();
      expect(useWorkspaceStore.getState().foldArtifacts).not.toBeNull();

      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: '/tmp/crane.bps',
      });

      const state = useWorkspaceStore.getState();
      expect(state.foldArtifacts).toBeNull();
      expect(state.foldArtifactStatus).toBe('stale');
      expect(state.oristudioCpDocument).toBeNull();
      expect(selectProject(state).creases).toHaveLength(0);
      expect(state.workspaceTitle).toBe('Sample BP');
    });

    it('keeps the live Edit canvas when the design chooser seeds a box-pleat project', async () => {
      // The counterpart to the test above: the chooser layers a design onto the
      // project already being authored rather than replacing it, so its crease
      // pattern — and the artifacts derived from it — must survive.
      resetStores(seedSnapshot());
      await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
        filename: 'crease.cp',
        path: '/tmp/crease.cp',
      });
      const artifacts = await useWorkspaceStore.getState().ensureFoldArtifacts();
      expect(artifacts).not.toBeNull();

      await expect(
        useWorkspaceStore
          .getState()
          .createOristudioBpProject({ preserveEditCanvas: true, confirmDiscard: false })
      ).resolves.toBe(true);

      expect(useWorkspaceStore.getState().foldArtifacts).toBe(artifacts);
      expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
    });

    it('saves a box-pleat design as a native .osf bundling the bps payload', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: '/tmp/crane.bps',
      });
      expect(useWorkspaceStore.getState().activeEditingContext).toBe('bp-tree');
      bpMocks.exportOristudioBpProjectAsBps.mockResolvedValueOnce('{"title":"Crane","saved":true}');

      const fileService = createFileService();
      await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

      const options = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
        | SaveTextFileOptions
        | undefined;
      expect(options?.extensions).toEqual(['osf']);
      const saved = parseNativeProjectFile(options?.contents ?? '');
      const active = activeNativeDesign(saved);
      if (!active) throw new Error('expected a box-pleat design');
      expect(active.payload.kind).toBe('box-pleat');
      expect(active.payload.text).toBe('{"title":"Crane","saved":true}');
      expect(useWorkspaceStore.getState().dirty).toBe(false);
    });

    it('saves the box-pleat design even when the Edit crease pattern is the focused view', async () => {
      // Regression: save routed by the active view dropped the design whenever
      // the user saved from the always-live Edit canvas. Save must follow the
      // documents that exist, not the focused pane.
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      // The user sends to Edit and focuses the crease-pattern pane.
      useWorkspaceStore.setState({
        activePanelId: 'crease-pattern',
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      });
      expect(useWorkspaceStore.getState().activeEditingContext).toBe('crease-pattern');
      bpMocks.exportOristudioBpProjectAsBps.mockResolvedValueOnce('{"design":"kept"}');

      const fileService = createFileService();
      await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

      const options = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
        | SaveTextFileOptions
        | undefined;
      const saved = parseNativeProjectFile(options?.contents ?? '');
      expect(saved.workspace.designs.map((design) => design.payload.kind)).toEqual(['box-pleat']);
      expect(saved.workspace.creasePattern).not.toBeNull();
      const active = activeNativeDesign(saved);
      if (!active) throw new Error('expected a box-pleat design');
      expect(active.payload.text).toBe('{"design":"kept"}');
    });

    it('bundles the Edit crease pattern as a companion when saving a box-pleat design', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      // A design coexists with a CP on the always-live Edit canvas.
      useWorkspaceStore.setState({ oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]) });

      const fileService = createFileService();
      await expect(useWorkspaceStore.getState().saveProject(fileService)).resolves.toBe(true);

      const options = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
        | SaveTextFileOptions
        | undefined;
      const saved = parseNativeProjectFile(options?.contents ?? '');
      expect(saved.workspace.designs.map((design) => design.payload.kind)).toEqual(['box-pleat']);
      expect(saved.workspace.creasePattern).not.toBeNull();
    });

    it('exports the active box-pleat design as a .bps file', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      bpMocks.exportOristudioBpProjectAsBps.mockResolvedValueOnce('{"exported":true}');

      const fileService = createFileService();
      await expect(useWorkspaceStore.getState().exportBps(fileService)).resolves.toBe(true);

      const options = fileService.saveTextFile.mock.calls.at(-1)?.[0] as
        | SaveTextFileOptions
        | undefined;
      expect(options?.contents).toBe('{"exported":true}');
      expect(options?.extensions).toEqual(['bps']);
      expect(options?.suggestedName.endsWith('.bps')).toBe(true);
    });

    it('reopens a saved box-pleat .osf, restoring the design and its CP companion', async () => {
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          creasePatternCompanion: {
            title: 'Crane CP',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: null,
            foldProjection: null,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
          },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      const fileService = createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' });

      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      expect(bpMocks.loadOristudioBpProjectFromText).toHaveBeenCalledWith(
        '{"title":"Crane"}',
        expect.objectContaining({ format: 'bps' })
      );
      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).not.toBeNull();
      expect(selectDesignMethod(state)).toBe('box-pleat');
      // The companion crease pattern is restored onto the Edit canvas.
      expect(state.oristudioCpDocument).not.toBeNull();
      // The bundle dispatches its load on the design document, so the BP loader
      // activated Design and the file always opened there — even though the
      // crease pattern it carries is the surface that was being worked on. One
      // landing rule now places every format the same way.
      expect(useLayoutStore.getState().activeWorkspace).toBe('edit');
      expect(currentWorkspacePath()).toBe('/edit');
    });

    it('lands the .osf on the crease-pattern pane, not just the Edit workspace', async () => {
      // Regression: every Edit shortcut went dead after opening a `.osf` holding
      // a design *plus* a crease pattern while Edit was already the workspace on
      // screen, and the toolbar rendered the BP verbs over the CP canvas.
      //
      // The loader wrote `activePanelId: 'design'` speculatively, then the
      // landing rule computed the real answer -- `edit`, because the file carries
      // a crease pattern -- and `activateWorkspace('edit')` returned early with
      // nothing to switch. Dockview's `onDidActivePanelChange` reports *changes*,
      // so it never fired and never corrected the guess. The landing has to name
      // the pane, not only the workspace.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          creasePatternCompanion: {
            title: 'Crane CP',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: null,
            foldProjection: null,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
          },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      // The user is editing the crease pattern when they open the file, so the
      // landing has nothing to switch.
      useLayoutStore.setState({ activeWorkspace: 'edit' });

      await expect(
        useWorkspaceStore
          .getState()
          .openProject(createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' }))
      ).resolves.toBe(true);

      const state = useWorkspaceStore.getState();
      expect(state.activePanelId).toBe('crease-pattern');
      expect(state.activeEditingContext).toBe('crease-pattern');
    });

    it('routes Edit shortcuts after opening a design bundled with a crease pattern', async () => {
      // The same regression stated as the thing the user actually reported: the
      // keyboard. `shortcutScopeStackForContext` only pushes the `crease-pattern`
      // scope when the context says so, so a stale context leaves every CP chord
      // matching no definition at all -- not even claimed. Asserting the context
      // alone would not have said which of those two failed.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          creasePatternCompanion: {
            title: 'Crane CP',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: null,
            foldProjection: null,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
          },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      useLayoutStore.setState({ activeWorkspace: 'edit' });

      await expect(
        useWorkspaceStore
          .getState()
          .openProject(createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' }))
      ).resolves.toBe(true);

      const cpAction = vi.fn();
      const release = registerCpActionShortcutExecutor(cpAction);
      try {
        // `Q` is Select, a crease-pattern tool -- the plainest chord that only
        // resolves inside the CP scope.
        const event = new KeyboardEvent('keydown', { key: 'q', cancelable: true });
        const handled = handleShortcutRuntimeKeyDown(event, {
          context: {
            activeEditingContext: useWorkspaceStore.getState().activeEditingContext,
          },
          menu: vi.fn(),
        });

        expect(handled).toBe(true);
        expect(cpAction).toHaveBeenCalledWith('cp.action.crease-select');
      } finally {
        release();
      }
    });

    it('leaves the active pane inside the workspace the open landed in', async () => {
      // The invariant behind both tests above, stated once for every entry point:
      // whatever writes `activePanelId`, the pane it names has to belong to the
      // workspace the landing chose. A guess that disagrees is exactly the state
      // the shortcut runtime and the toolbar read as "you are editing something
      // else", and nothing downstream can tell it from the truth.
      //
      // Table-driven because each loader used to make this decision for itself,
      // which is how the formats drifted apart in the first place.
      const cpCompanion = () => ({
        title: 'Crane CP',
        document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
        source: null,
        foldProjection: null,
        foldArtifacts: null,
        creaseColorMode: 'mvf' as const,
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [],
        activeFoldedFigureId: null,
        lineage: importedCpLineage(),
      });

      const opens: Array<{ name: string; text: string; from: 'design' | 'edit' }> = [
        {
          name: 'bp-with-cp.osf',
          from: 'edit',
          text: serializeNativeProjectFile(
            createNativeBoxPleatProjectFile({
              title: 'Crane',
              filename: 'bp-with-cp.osf',
              path: null,
              bps: '{"title":"Crane"}',
              creasePatternCompanion: cpCompanion(),
              appVersion: '0.0.0',
            })
          ),
        },
        {
          name: 'bp-only.osf',
          from: 'edit',
          text: serializeNativeProjectFile(
            createNativeBoxPleatProjectFile({
              title: 'Crane',
              filename: 'bp-only.osf',
              path: null,
              bps: '{"title":"Crane"}',
              appVersion: '0.0.0',
            })
          ),
        },
        {
          name: 'tree-with-cp.osf',
          from: 'edit',
          text: serializeNativeProjectFile(
            createNativeTreeProjectFile({
              title: 'Tree',
              filename: 'tree-with-cp.osf',
              path: null,
              tmd5Text: 'native tree tmd5',
              creasePatternCompanion: cpCompanion(),
              appVersion: '0.0.0',
            })
          ),
        },
        {
          name: 'tree-only.osf',
          from: 'edit',
          text: serializeNativeProjectFile(
            createNativeTreeProjectFile({
              title: 'Tree',
              filename: 'tree-only.osf',
              path: null,
              tmd5Text: 'native tree tmd5',
              appVersion: '0.0.0',
            })
          ),
        },
      ];

      for (const open of opens) {
        resetStores(seedSnapshot());
        useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
        useLayoutStore.setState({ activeWorkspace: open.from });

        await expect(
          useWorkspaceStore
            .getState()
            .openProject(createFileService({ text: open.text, name: open.name, path: null }))
        ).resolves.toBe(true);

        const activePanelId = useWorkspaceStore.getState().activePanelId;
        expect(
          activePanelId === null ? null : workspaceForPanelId(activePanelId),
          `${open.name} left ${activePanelId} active`
        ).toBe(useLayoutStore.getState().activeWorkspace);
      }
    });

    it('restores the crease-pattern view settings saved alongside a design', async () => {
      // Regression: the companion installer was a hand-rolled subset of the
      // CP-only one and silently dropped `creaseColorMode`, the viewport (grid,
      // snaps, line width), `toolMode`, and the `projectLoadId` bump. None of
      // those are in localStorage, so reopening a design bundled with an Edit
      // crease pattern really did revert the crease colours and every grid
      // setting. Both paths now spread one `nativeCpEditorState`.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          creasePatternCompanion: {
            title: 'Crane CP',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: null,
            foldProjection: null,
            foldArtifacts: null,
            creaseColorMode: 'agrh',
            selection: emptyOristudioCpSelection(),
            viewport: {
              ...DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
              gridVisible: false,
              snapToGrid: false,
              lineWidth: 3,
            },
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
            // Schema v7. Added on main to the CP-only path only — the third time
            // these two installers diverged, and the reason they now share one.
            camera: { centerX: 12, centerY: -4, zoom: 3, rotation: 0.5 },
          },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({
        engineReady: true,
        status: 'ready',
        dirty: false,
        // Non-default values the load must overwrite, not inherit.
        creaseColorMode: 'mvf',
        oristudioCpViewport: { ...DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS },
        oristudioCpCamera: null,
      });
      const projectLoadIdBefore = useWorkspaceStore.getState().projectLoadId;

      await expect(
        useWorkspaceStore
          .getState()
          .openProject(createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' }))
      ).resolves.toBe(true);

      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).not.toBeNull();
      expect(state.creaseColorMode).toBe('agrh');
      expect(state.oristudioCpViewport.gridVisible).toBe(false);
      expect(state.oristudioCpViewport.snapToGrid).toBe(false);
      expect(state.oristudioCpViewport.lineWidth).toBe(3);
      expect(selectToolMode(state)).toBe('select');
      expect(state.projectLoadId).toBeGreaterThan(projectLoadIdBefore);
      // The saved canvas camera comes back too — rotation is how a hex-pleat
      // design is authored, not a transient way of looking at it.
      expect(state.oristudioCpCamera).toEqual({
        centerX: 12,
        centerY: -4,
        zoom: 3,
        rotation: 0.5,
      });
    });

    it('never empties the Edit canvas while loading a design bundled with a crease pattern', async () => {
      // Regression: the design installer cleared the canvas before the bundle's
      // crease pattern was restored, so the load published an empty Edit canvas
      // mid-flight. The Edit surface self-provisions into any gap it sees, so
      // each gap cost a blank document built and thrown away moments later —
      // measured at two per open. The bundle knows its companion is coming
      // before anything is installed, so the design installer is told to keep
      // the canvas and the companion replaces it directly.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          creasePatternCompanion: {
            title: 'Crane CP',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: null,
            foldProjection: null,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
          },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({
        engineReady: true,
        status: 'ready',
        dirty: false,
        // A crease pattern is already on the always-live canvas.
        // Installing a crease pattern focuses the CP editor, as every production
        // install path does (see `freshEditableCpState`).
        activePanelId: 'crease-pattern',
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 0, y: 1 })]),
      });

      const presence: boolean[] = [];
      const unsubscribe = useWorkspaceStore.subscribe((state, previous) => {
        if ((state.oristudioCpDocument !== null) !== (previous.oristudioCpDocument !== null)) {
          presence.push(state.oristudioCpDocument !== null);
        }
      });
      try {
        await expect(
          useWorkspaceStore
            .getState()
            .openProject(createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' }))
        ).resolves.toBe(true);
      } finally {
        unsubscribe();
      }

      // Never null at any point: no gap for the Edit surface to fill.
      expect(presence).toEqual([]);
      expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
      expect(selectOristudioBpDocument(useWorkspaceStore.getState())).not.toBeNull();
    });

    it('still discards the open crease pattern for a design with no companion', async () => {
      // The other half: the opt-out is scoped to bundles that carry a crease
      // pattern. A design-only file is not one, so the previous file's canvas
      // must still go.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({
        engineReady: true,
        status: 'ready',
        dirty: false,
        // Installing a crease pattern focuses the CP editor, as every production
        // install path does (see `freshEditableCpState`).
        activePanelId: 'crease-pattern',
        oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 0, y: 1 })]),
      });

      await expect(
        useWorkspaceStore
          .getState()
          .openProject(createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' }))
      ).resolves.toBe(true);

      expect(useWorkspaceStore.getState().oristudioCpDocument).toBeNull();
      expect(selectOristudioBpDocument(useWorkspaceStore.getState())).not.toBeNull();
    });

    it('moves the user exactly once when opening a design bundled with a crease pattern', async () => {
      // Regression: `setLoadedBpProject` both installed the BP document and
      // called `activateWorkspace('design')`, so the destination was chosen from
      // a half-installed project — the companion crease pattern that decides on
      // Edit had not been restored yet. The landing rule then corrected it, and
      // the two decisions disagreeing showed up as a ~150ms flash of the BP
      // workspace plus a junk `/design/bp` browser-history entry.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          creasePatternCompanion: {
            title: 'Crane CP',
            document: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]).document,
            source: null,
            foldProjection: null,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
          },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      useLayoutStore.setState({ activeWorkspace: 'edit' });

      const transitions: string[] = [];
      const unsubscribe = useLayoutStore.subscribe((state, previous) => {
        if (state.activeWorkspace !== previous.activeWorkspace) {
          transitions.push(`${previous.activeWorkspace}->${state.activeWorkspace}`);
        }
      });
      try {
        await expect(
          useWorkspaceStore
            .getState()
            .openProject(createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' }))
        ).resolves.toBe(true);
      } finally {
        unsubscribe();
      }

      // Never design-then-edit: the design installer must not move anyone.
      expect(transitions).toEqual([]);
      expect(useLayoutStore.getState().activeWorkspace).toBe('edit');
      expect(selectOristudioBpDocument(useWorkspaceStore.getState())).not.toBeNull();
      expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
    });

    it('opens a box-pleat .osf with no crease pattern on the BP design, not the chooser', async () => {
      // Regression: the landing path was derived from which documents existed,
      // and returned bare `/design` for anything without a crease pattern. That
      // is the method-chooser sub-route, so routing there ran
      // `applyDesignRoute('nux')` and replaced the design that had just loaded
      // with the chooser — the design stayed in the store, invisible.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: '/tmp/crane.osf',
          bps: '{"title":"Crane"}',
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      const fileService = createFileService({ text: osf, name: 'crane.osf', path: '/tmp/crane.osf' });

      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).not.toBeNull();
      expect(selectDesignMethod(state)).not.toBe('none');
      expect(useLayoutStore.getState().activeWorkspace).toBe('design');
      // One Design route, whatever the design's kind: with tabs the workspace can
      // hold both kinds at once, so there is nothing for a sub-path to name.
      expect(currentWorkspacePath()).toBe('/design');
    });

    it('replaces a box-pleat design outright when a tree is opened', async () => {
      // Regression: `loadText` installed a tree without claiming the design
      // fields, so the previous file's `workflowTarget` and BP document both
      // survived — a tab claiming to author a tree while still holding a
      // box-pleat document.
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('box-pleat');
      useWorkspaceStore.setState({ dirty: false });

      await expect(
        useWorkspaceStore
          .getState()
          .openProject(
            createFileService({ text: 'tree text', name: 'tree.tmd5', path: '/tmp/tree.tmd5' })
          )
      ).resolves.toBe(true);

      const state = useWorkspaceStore.getState();
      expect(selectDesignMethod(state)).toBe('treemaker');
      expect(selectDesignMethod(state)).not.toBe('none');
      expect(selectOristudioBpDocument(state)).toBeNull();
    });

    it('warns before a .bps export drops mirror symmetry, and aborts when refused', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      useWorkspaceStore.getState().setOristudioBpSymmetry({ pairs: [{ v1: 1, v2: 2 }] });
      const fileService = createFileService();

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const exporting = useWorkspaceStore.getState().exportBps(fileService);
        const dialog = useCommandDialogStore.getState().dialog;
        expect(dialog).toMatchObject({
          type: 'confirm',
          title: 'Some features can’t be exported',
        });
        expect((dialog as { message: string }).message).toContain('Mirror symmetry');
        expect((dialog as { message: string }).message).toContain('BPS');
        if (!dialog) throw new Error('expected an export-loss confirmation');
        resolveCommandDialog(dialog.id, false);
        await expect(exporting).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }
      expect(fileService.saveTextFile).not.toHaveBeenCalled();
    });

    it('exports .bps without a prompt when the design carries no symmetry of its own', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      bpMocks.exportOristudioBpProjectAsBps.mockResolvedValueOnce('{"exported":true}');
      const fileService = createFileService();

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        await expect(useWorkspaceStore.getState().exportBps(fileService)).resolves.toBe(true);
        expect(useCommandDialogStore.getState().dialog).toBeNull();
      } finally {
        unregisterDialogHost();
      }
      expect(fileService.saveTextFile).toHaveBeenCalled();
    });

    it('carries mirror-draw state through a save and reopen', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      useWorkspaceStore.getState().setOristudioBpSymmetry({
        enabled: false,
        fold: 'diagonal',
        pairs: [{ v1: 1, v2: 2 }],
      });
      bpMocks.exportOristudioBpProjectAsBps.mockResolvedValue('{"title":"Crane"}');

      const saveService = createFileService();
      await expect(useWorkspaceStore.getState().saveProject(saveService)).resolves.toBe(true);
      const saved = (
        saveService.saveTextFile.mock.calls.at(-1)?.[0] as SaveTextFileOptions | undefined
      )?.contents;
      expect(saved).toBeDefined();

      // A fresh store, so nothing can be carried over in memory.
      useWorkspaceStore.setState(initialWorkspaceState, true);
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      const openService = createFileService({
        text: saved as string,
        name: 'crane.osf',
        path: '/tmp/crane.osf',
      });
      await expect(useWorkspaceStore.getState().openProject(openService)).resolves.toBe(true);

      const symmetry = selectOristudioBpSymmetry(useWorkspaceStore.getState());
      expect(symmetry.enabled).toBe(false);
      expect(symmetry.fold).toBe('diagonal');
      expect(symmetry.pairs).toEqual([{ v1: 1, v2: 2 }]);
      // The axis is rebuilt from the sheet rather than restored, so it is centred
      // on whatever the reopened design turned out to be.
      expect(symmetry.angle).toBe(90);
      expect(symmetry.loc).toEqual({ x: 10, y: 10 });
    });

    it('drops a stored pair naming a vertex the loaded design does not have', async () => {
      // The fixture tree has vertices 0-2; the file claims 1 is paired with 99.
      const osf = serializeNativeProjectFile(
        createNativeBoxPleatProjectFile({
          title: 'Crane',
          filename: 'crane.osf',
          path: null,
          bps: '{"title":"Crane"}',
          symmetry: { enabled: true, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [{ v1: 1, v2: 99 }] },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      const fileService = createFileService({ text: osf, name: 'crane.osf', path: null });

      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      expect(selectOristudioBpSymmetry(useWorkspaceStore.getState()).pairs).toEqual([]);
    });

    it('opens a plain .bps with default mirror draw, having nowhere to store it', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      // Set to something distinctive first, so the assertion below is about the
      // load resetting to the default rather than about nothing having happened.
      useWorkspaceStore.getState().setOristudioBpSymmetry({ fold: 'diagonal', enabled: true });

      await useWorkspaceStore
        .getState()
        .loadOristudioBpProjectFromFile('{"tree":{}}', { filename: 'other.bps', path: null });

      const symmetry = selectOristudioBpSymmetry(useWorkspaceStore.getState());
      expect(symmetry).toMatchObject({ enabled: false, fold: 'book', pairs: [] });
    });
  });

  describe('design tabs', () => {
    /**
     * The tab set is never empty and `activeDesignId` always names one of its
     * members. Everything downstream — the chooser, the layout variant, routing,
     * and Phase 3's tab strip — reads the active tab without a null check, so this
     * has to hold after every action that touches the design, not just at boot.
     */
    const expectInvariant = () => {
      const { designTabs, activeDesignId } = useWorkspaceStore.getState();
      expect(designTabs.length).toBeGreaterThan(0);
      expect(designTabs.map((tab) => tab.id)).toContain(activeDesignId);
    };

    it('starts with exactly one chooser tab', () => {
      const state = useWorkspaceStore.getState();
      expect(state.designTabs).toHaveLength(1);
      expect(state.designTabs[0].kind).toBeNull();
      expectInvariant();
    });

    it('holds across every design action', async () => {
      useWorkspaceStore.getState().startNewDesign();
      expectInvariant();

      await useWorkspaceStore.getState().chooseDesignMethod('treemaker');
      expectInvariant();

      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      expectInvariant();

      await useWorkspaceStore.getState().duplicateDesignTab(
        useWorkspaceStore.getState().activeDesignId
      );
      expectInvariant();

      useWorkspaceStore.getState().startNewDesign();
      expectInvariant();
    });

    it('changes the kind of the existing tab rather than replacing it', async () => {
      // Phase 3 hangs a tab strip off these ids. If picking a method swapped the
      // tab out, the strip would lose selection, title, and position on every
      // choice — so identity has to survive a kind change.
      const before = useWorkspaceStore.getState().designTabs[0];

      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');

      const after = useWorkspaceStore.getState().designTabs[0];
      expect(useWorkspaceStore.getState().designTabs).toHaveLength(1);
      expect(after.id).toBe(before.id);
      expect(after.title).toBe(before.title);
      expect(after.kind).toBe('box-pleat');
    });

    it('replaces every design when a new project is started', async () => {
      // Not "clears the active tab's kind": with tabs, starting a new project
      // has to discard the ones the user is walking away from. Clearing one left
      // the others in the strip, pointing at engine documents nothing owned any
      // more, and the next save wrote them into the new file.
      await useWorkspaceStore.getState().chooseDesignMethod('treemaker');
      useWorkspaceStore.getState().addDesignTab();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const before = useWorkspaceStore.getState().designTabs.map((tab) => tab.id);
      expect(before).toHaveLength(2);

      useWorkspaceStore.getState().startNewDesign();

      const after = useWorkspaceStore.getState().designTabs;
      expect(after).toHaveLength(1);
      expect(after[0].kind).toBeNull();
      // A fresh id, so a late write addressed to a discarded design cannot land
      // on the tab that replaced it.
      expect(before).not.toContain(after[0].id);
      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
      expectInvariant();
    });
  });

  describe('design method chooser', () => {
    it('startNewDesign enters the Design workspace on the chooser without a document', () => {
      useWorkspaceStore.getState().startNewDesign();

      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');
      expect(useLayoutStore.getState().activeWorkspace).toBe('design');
    });

    it('choosing Box-pleated sets the method and clears the chooser', async () => {
      useWorkspaceStore.getState().startNewDesign();

      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');

      const state = useWorkspaceStore.getState();
      expect(selectDesignMethod(state)).toBe('box-pleat');
      expect(selectDesignMethod(state)).not.toBe('none');
      expect(selectOristudioBpDocument(state)).not.toBeNull();
      expect(bpMocks.loadOristudioBpProjectFromText).toHaveBeenCalledOnce();
    });

    it('preserves the always-live Edit canvas when choosing a design method', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      const editCp = editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]);
      useWorkspaceStore.setState({ oristudioCpDocument: editCp });
      useWorkspaceStore.getState().startNewDesign();

      // Circle-packed: establishes a tree without touching the Edit canvas.
      await useWorkspaceStore.getState().chooseDesignMethod('treemaker');
      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('treemaker');
      expect(selectDesignMethod(useWorkspaceStore.getState())).not.toBe('none');
      expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(editCp);
      // The CP wasm handle must not be released, or the kept document is dead.
      expect(oristudioCpMocks.releaseOristudioCpDocument).not.toHaveBeenCalled();

      // Box-pleated: same guarantee via the BP creation path.
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      expect(selectOristudioBpDocument(useWorkspaceStore.getState())).not.toBeNull();
      expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(editCp);
      expect(oristudioCpMocks.releaseOristudioCpDocument).not.toHaveBeenCalled();
    });

    it('choosing Circle-packed creates a TreeMaker design and clears the chooser', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      useWorkspaceStore.getState().startNewDesign();

      await useWorkspaceStore.getState().chooseDesignMethod('treemaker');

      const state = useWorkspaceStore.getState();
      expect(selectDesignMethod(state)).toBe('treemaker');
      expect(selectDesignMethod(state)).not.toBe('none');
    });

    it('creating a TreeMaker project after a Box-pleat design resets the method', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('box-pleat');
      expect(selectOristudioBpDocument(useWorkspaceStore.getState())).not.toBeNull();

      // Skip the discard confirmation this test isn't exercising.
      useWorkspaceStore.setState({ dirty: false });
      await useWorkspaceStore.getState().createNewProject();

      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('treemaker');
      expect(selectDesignMethod(useWorkspaceStore.getState())).not.toBe('none');
      expect(selectOristudioBpDocument(useWorkspaceStore.getState())).toBeNull();
    });

    it('applies an optimizer result as exactly one undoable step', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const before = selectOristudioBpDocument(useWorkspaceStore.getState());
      useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), { historyPast: [], historyFuture: [] 
      }),});
      // The snapshot the history entry must capture is the state *before* the
      // run, so the export mocked here is the pre-optimize project.
      bpMocks.exportOristudioBpProjectAsSessionBps.mockResolvedValueOnce('{"before":"optimize"}');
      const optimized = { ...sampleBpDocument(), activeSurface: 'packing' as const };
      bpMocks.optimizeOristudioBpLayout.mockResolvedValueOnce({
        document: optimized,
        eventCount: 3,
        openedNew: false,
      });

      await expect(
        useWorkspaceStore.getState().optimizeOristudioBpLayout({
          useDimension: true,
          layoutMode: 'view',
          useBasinHopping: false,
          randomCandidateCount: 1,
          respectSymmetry: false,
        })
      ).resolves.toBe('applied');

      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).toBe(optimized);
      expect(selectOristudioBpDocument(state)).not.toBe(before);
      expect(selectOristudioBpHistoryPast(state)).toHaveLength(1);
      expect(selectOristudioBpHistoryPast(state)[0].snapshot.bps).toBe('{"before":"optimize"}');
      expect(state.oristudioBpBusy).toBe(false);
      // The sheet resized and every flap moved, so the packing pane is asked to
      // re-fit its camera around the result.
      expect(selectOristudioBpViewportFitRequestId(state)).toBe(1);
      // `openNew` is never a user choice: the optimizer always replaces in place.
      expect(bpMocks.optimizeOristudioBpLayout).toHaveBeenCalledWith(
        expect.objectContaining({ openNew: false, seed: null }),
        expect.objectContaining({ activeSurface: 'packing' }),
        undefined
      );
    });

    it('passes no symmetry when the run does not ask for it', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      bpMocks.optimizeOristudioBpLayout.mockResolvedValueOnce({
        document: sampleBpDocument(),
        eventCount: 0,
        openedNew: false,
      });

      await useWorkspaceStore.getState().optimizeOristudioBpLayout({
        useDimension: true,
        layoutMode: 'view',
        useBasinHopping: false,
        randomCandidateCount: 1,
        respectSymmetry: false,
      });

      expect(bpMocks.optimizeOristudioBpLayout).toHaveBeenCalledWith(
        expect.objectContaining({ symmetry: null }),
        expect.anything(),
        undefined
      );
    });

    it('resolves symmetry from the authoring mode and passes it to the solver', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const tree = selectOristudioBpDocument(useWorkspaceStore.getState())!.snapshot.tree;
      const leaves = tree.vertices.filter((vertex) => vertex.isLeaf);
      // The blank design has two leaves; pair them across a vertical axis.
      useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
        symmetry: {
          enabled: true,
          fold: 'book',
          quarterTurn: false,
          sidesSwapped: false,
          angle: 90,
          loc: { x: tree.sheet.width / 2, y: tree.sheet.height / 2 },
          pairs: [{ v1: leaves[0].id, v2: leaves[1].id }],
        }
      }),});
      bpMocks.optimizeOristudioBpLayout.mockResolvedValueOnce({
        document: sampleBpDocument(),
        eventCount: 0,
        openedNew: false,
      });

      await expect(
        useWorkspaceStore.getState().optimizeOristudioBpLayout({
          useDimension: true,
          layoutMode: 'view',
          useBasinHopping: false,
          randomCandidateCount: 1,
          respectSymmetry: true,
        })
      ).resolves.toBe('applied');

      const call = bpMocks.optimizeOristudioBpLayout.mock.calls.at(-1)!;
      const symmetry = (call[0] as { symmetry: { axis: string; partners: [number, number][] } })
        .symmetry;
      expect(symmetry.axis).toBe('verticalHalf');
      expect(new Map(symmetry.partners)).toEqual(
        new Map([
          [leaves[0].id, leaves[1].id],
          [leaves[1].id, leaves[0].id],
        ])
      );
    });

    it('refuses to run rather than silently dropping an unusable symmetry', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const document = selectOristudioBpDocument(useWorkspaceStore.getState())!;
      const tree = document.snapshot.tree;
      // The starter tree's two leaves are paired, as mirror draw would have left
      // them; the stray one has no pair and is not on the mirror line, so it has
      // no mirror to give and the run must say so rather than quietly drop it.
      const leaves = tree.vertices.filter((vertex) => vertex.isLeaf).map((vertex) => vertex.id);
      useWorkspaceStore.setState({
      ...singleBoxPleatDesignTab({
        document: {
          ...document,
          snapshot: {
            ...document.snapshot,
            tree: {
              ...tree,
              vertices: [
                ...tree.vertices,
                { ...tree.vertices[1], id: 99, name: 'stray', loc: { x: 3, y: 4 } },
              ],
            },
          },
        },
        symmetry: {
          enabled: true,
          fold: 'book',
          quarterTurn: false,
          sidesSwapped: false,
          angle: 90,
          loc: { x: tree.sheet.width / 2, y: tree.sheet.height / 2 },
          pairs: [{ v1: Math.min(leaves[0], leaves[1]), v2: Math.max(leaves[0], leaves[1]) }],
        }
      }),} as never);

      await expect(
        useWorkspaceStore.getState().optimizeOristudioBpLayout({
          useDimension: true,
          layoutMode: 'random',
          useBasinHopping: false,
          randomCandidateCount: 4,
          respectSymmetry: true,
        })
      ).resolves.toBe('failed');

      expect(bpMocks.optimizeOristudioBpLayout).not.toHaveBeenCalled();
      // Names the flap, and the verbs that would pair it.
      expect(useWorkspaceStore.getState().oristudioBpError).toContain('Nothing is paired with stray');
      expect(useWorkspaceStore.getState().oristudioBpError).toContain('Pair with mirror');
    });

    it('mirrors in random mode too, since that discards the packing not the tree', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const tree = selectOristudioBpDocument(useWorkspaceStore.getState())!.snapshot.tree;
      const leaves = tree.vertices.filter((vertex) => vertex.isLeaf).map((vertex) => vertex.id);
      useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), {
        symmetry: {
          enabled: true,
          fold: 'book',
          quarterTurn: false,
          sidesSwapped: false,
          angle: 90,
          loc: { x: tree.sheet.width / 2, y: tree.sheet.height / 2 },
          pairs: [{ v1: leaves[0], v2: leaves[1] }],
        }
      }),});

      bpMocks.optimizeOristudioBpLayout.mockResolvedValueOnce({
        document: sampleBpDocument(),
        eventCount: 0,
        openedNew: false,
      });

      await expect(
        useWorkspaceStore.getState().optimizeOristudioBpLayout({
          useDimension: true,
          layoutMode: 'random',
          useBasinHopping: false,
          randomCandidateCount: 4,
          respectSymmetry: true,
        })
      ).resolves.toBe('applied');

      const call = bpMocks.optimizeOristudioBpLayout.mock.calls.at(-1)!;
      expect((call[0] as { symmetry: unknown }).symmetry).not.toBeNull();
    });


    it('leaves the document and history untouched when the optimizer is cancelled', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const before = selectOristudioBpDocument(useWorkspaceStore.getState());
      useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), { historyPast: [], historyFuture: [] 
      }),});
      bpMocks.optimizeOristudioBpLayout.mockRejectedValueOnce({
        code: 'optimization_cancelled',
        message: 'Box Pleat optimization cancelled',
      });

      await expect(
        useWorkspaceStore.getState().optimizeOristudioBpLayout({
          useDimension: true,
          layoutMode: 'random',
          useBasinHopping: false,
          randomCandidateCount: 4,
          respectSymmetry: false,
        })
      ).resolves.toBe('cancelled');

      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).toBe(before);
      expect(selectOristudioBpHistoryPast(state)).toHaveLength(0);
      // Aborting is a user action, so nothing is surfaced as a failure.
      expect(state.oristudioBpError).toBeNull();
      expect(state.oristudioBpBusy).toBe(false);
      // Nothing changed on screen, so the camera must stay where the user left it.
      expect(selectOristudioBpViewportFitRequestId(state)).toBe(0);
    });

    it('reports a failed optimizer run without recording history', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const before = selectOristudioBpDocument(useWorkspaceStore.getState());
      useWorkspaceStore.setState({
      ...patchBoxPleatDesign(useWorkspaceStore.getState(), { historyPast: [], historyFuture: [] 
      }),});
      bpMocks.optimizeOristudioBpLayout.mockRejectedValueOnce({
        code: 'optimization_failed',
        message: 'Solution exceeds maximal sheet size.',
      });

      await expect(
        useWorkspaceStore.getState().optimizeOristudioBpLayout({
          useDimension: false,
          layoutMode: 'view',
          useBasinHopping: true,
          randomCandidateCount: 1,
          respectSymmetry: false,
        })
      ).resolves.toBe('failed');

      const state = useWorkspaceStore.getState();
      expect(selectOristudioBpDocument(state)).toBe(before);
      expect(selectOristudioBpHistoryPast(state)).toHaveLength(0);
      expect(state.oristudioBpError).toBe('Solution exceeds maximal sheet size.');
      expect(state.oristudioBpBusy).toBe(false);
    });

    it('opening a file clears a pending design choice', async () => {
      useWorkspaceStore.getState().startNewDesign();
      expect(selectDesignMethod(useWorkspaceStore.getState())).toBe('none');

      await useWorkspaceStore.getState().loadProjectText('native tree tmd5', {
        filename: 'sample.osf',
      });

      expect(selectDesignMethod(useWorkspaceStore.getState())).not.toBe('none');
    });
  });
});

describe('orbit focus on a 3D folded figure', () => {
  /**
   * Focus is the *second* press, and only a focused figure goes inert to the
   * canvas-object overlay — so these rules decide whether a drag moves the
   * figure or turns it, which is the whole gesture.
   */
  const figures = () => useWorkspaceStore.getState().oristudioCpFoldedFigures;
  const focusedId = () => useWorkspaceStore.getState().oristudioCpFocusedFoldedFigureId;

  function seedFigures(): void {
    resetStores(seedSnapshot());
    const base = {
      title: 'f',
      handle: 1,
      sourceCpRevision: null,
      startingFaceId: 1,
      displayStyle: 'Paper5' as const,
      status: 'ready' as const,
      renderSnapshot: null,
      placement: IDENTITY_FOLDED_PLACEMENT,
      error: null,
    };
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [
        // A 3D figure is the one with `folded3d`; the flat one carries `snapshot`.
        {
          ...base,
          id: 'spatial',
          sourceKind: 'generated-3d',
          snapshot: null,
          folded3d: {} as never,
        },
        { ...base, id: 'flat', sourceKind: 'generated-from-current-cp', snapshot: {} as never },
      ] as never,
    });
  }

  it('refuses a flat figure, so focus is never a state you can reach and find inert', () => {
    seedFigures();
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('flat');
    expect(focusedId()).toBeNull();
  });

  it('refuses a figure that does not exist', () => {
    seedFigures();
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('nope');
    expect(focusedId()).toBeNull();
  });

  it('focusing a 3D figure also selects it, so its toolbar is the one on screen', () => {
    seedFigures();
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('spatial');
    expect(focusedId()).toBe('spatial');
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe('spatial');
  });

  it('gives up focus when the selection moves to a different figure', () => {
    // Selection alone does not express this: focus belongs to one figure, not to
    // folded figures as a class, so leaving it behind would let a drag over the
    // newly selected figure turn the old one.
    seedFigures();
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('spatial');
    useWorkspaceStore.getState().setOristudioCpActiveFoldedFigure('flat');
    expect(focusedId()).toBeNull();
  });

  it('is exclusive with a focused simulation window, both ways', () => {
    // Both claim canvas drags, so two focused things would fight over one press.
    seedFigures();
    useWorkspaceStore.setState({ oristudioCpFocusedInlineSimulationId: 'sim-1' });
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('spatial');
    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBeNull();
    expect(focusedId()).toBe('spatial');

    useWorkspaceStore.getState().focusOristudioCpInlineSimulation('sim-1');
    expect(focusedId()).toBeNull();
  });

  it('gives up focus when the creases take the canvas', () => {
    seedFigures();
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('spatial');
    useWorkspaceStore
      .getState()
      .setOristudioCpSelection({ ...emptyOristudioCpSelection(), lines: [1] });
    expect(focusedId()).toBeNull();
    expect(figures()).toHaveLength(2);
  });
});

describe('orbit focus follows the selection out', () => {
  /**
   * Focus is narrower than selection, so it must not survive one. A figure that
   * keeps focus after being deselected goes on turning under every drag that
   * lands on it — and `setOristudioCpActiveFoldedFigure(null)` deliberately does
   * not go through `takeCanvasSelection`, so it has to say this itself.
   */
  it('clears focus when the folded selection is released', () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [
        {
          id: 'spatial',
          title: 'f',
          handle: 1,
          sourceKind: 'generated-3d',
          sourceCpRevision: null,
          startingFaceId: 1,
          displayStyle: 'Paper5',
          status: 'ready',
          snapshot: null,
          folded3d: {},
          renderSnapshot: null,
          placement: IDENTITY_FOLDED_PLACEMENT,
          error: null,
        },
      ] as never,
    });
    useWorkspaceStore.getState().focusOristudioCpFoldedFigure('spatial');
    expect(useWorkspaceStore.getState().oristudioCpFocusedFoldedFigureId).toBe('spatial');

    useWorkspaceStore.getState().setOristudioCpActiveFoldedFigure(null);
    expect(useWorkspaceStore.getState().oristudioCpFocusedFoldedFigureId).toBeNull();
  });
});

describe('changing a 3D folded model appearance', () => {
  /**
   * The folded-model menu was greyed out on a 3D figure. `editModel` was false
   * because the write path did not exist: a flat figure's model lives in the
   * kernel, a 3D one's on `folded3d`, and only the first had a setter. The
   * picture is a pure function of (render model, model, camera), so the 3D
   * write rebuilds it locally rather than making a round trip.
   */
  async function seedSpatialFigure() {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: editableCpState([
        cpLine(
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
        ),
      ]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    const figure = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
    expect(figure.folded3d ?? null).not.toBeNull();
    return figure;
  }

  it('accepts a model change and keeps it on the 3D snapshot', async () => {
    // Re-pinned for the paper style (Phase 1): a colour written to the model
    // alone is mirrored straight back from the figure's effective style, so
    // the direct write is exercised with a field the mirror does not own.
    const figure = await seedSpatialFigure();
    await expect(
      useWorkspaceStore
        .getState()
        .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: 40 })
    ).resolves.toBe(true);

    const after = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
    expect(after.folded3d?.model.transparent_transparency).toBe(40);
    // The flat snapshot stays null: changing the model must not make a figure
    // look like both kinds at once.
    expect(after.snapshot).toBeNull();
  });

  it('carries a colour pin into the 3D model, and leaves the picture alone', async () => {
    // The paper-style mirror (D6): the figure's `appearance` is the source and
    // the model's colour follows it, through the same write a colour pick makes.
    //
    // The *picture* does not follow it, and that is the point of a scene: it
    // carries geometry and roles and no ink, so the canvas and the painter
    // re-ink the one that is already there rather than a new one being built
    // for every drag of a colour picker.
    const figure = await seedSpatialFigure();
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!.scene;
    expect(
      useWorkspaceStore
        .getState()
        .setOristudioCpFoldedFigureAppearance(figure.id, 'paper.front', '#0a141e')
    ).toBe(true);
    await flushMicrotasks();
    const after = useWorkspaceStore.getState().oristudioCpFoldedFigures[0]!;
    expect(after.folded3d?.model.front_color).toEqual({ red: 10, green: 20, blue: 30 });
    expect(after.scene).toBe(before);
    expect(after.snapshot).toBeNull();
  });

  it('still refuses a figure that has neither model', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [
        {
          id: 'empty',
          title: 'f',
          handle: null,
          sourceKind: 'generated-3d',
          sourceCpRevision: null,
          startingFaceId: 1,
          displayStyle: 'Paper5',
          status: 'error',
          snapshot: null,
          folded3d: null,
          renderSnapshot: null,
          placement: IDENTITY_FOLDED_PLACEMENT,
          error: null,
        },
      ] as never,
    });
    await expect(
      useWorkspaceStore.getState().updateOristudioCpFoldedFigureModel('empty', {})
    ).resolves.toBe(false);
  });
});

describe('a fresh 3D fold arrives focused', () => {
  /**
   * Selected-but-not-focused was a state the user could see and not act on: the
   * outline and floating toolbar said "ready", and the first drag moved the
   * figure instead of turning it, because only focus makes the body inert and
   * hands the drag to the camera.
   *
   * The assertion is deliberately about the *pair*. Focus rides in on the fold's
   * `takeCanvasSelection` patch, which wins only because the patch spreads last
   * over that function's own focus-clearing branch — a property worth pinning
   * rather than trusting to argument order.
   */
  async function foldSpatial() {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: editableCpState([
        cpLine(
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
        ),
      ]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    return useWorkspaceStore.getState();
  }

  it('selects and focuses the same figure', async () => {
    const state = await foldSpatial();
    const figure = state.oristudioCpFoldedFigures[0]!;
    expect(figure.folded3d ?? null).not.toBeNull();
    expect(state.oristudioCpActiveFoldedFigureId).toBe(figure.id);
    expect(state.oristudioCpFocusedFoldedFigureId).toBe(figure.id);
  });

  it('never focuses a flat figure, which has nothing to turn', async () => {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    const state = useWorkspaceStore.getState();
    expect(state.oristudioCpFoldedFigures[0]?.snapshot ?? null).not.toBeNull();
    expect(state.oristudioCpFocusedFoldedFigureId).toBeNull();
  });
});

describe('one canvas selection', () => {
  /**
   * The canvas has one holder — a crease selection, an annotation, a folded
   * figure or a focused window — and every claim goes through
   * `takeCanvasSelection`. These drive each selection-bearing action and count
   * holders afterwards, so a raw `set` that bypasses the helper (the fold
   * completions used to; a model write's landing used to re-claim) fails here
   * rather than surfacing as a pane showing the wrong object.
   */
  function holders(): number {
    const state = useWorkspaceStore.getState();
    return [
      cpSelectionSize(state.oristudioCpSelection) > 0,
      state.oristudioCpSelectedAnnotationId !== null,
      state.oristudioCpActiveFoldedFigureId !== null,
      state.oristudioCpFocusedInlineSimulationId !== null,
    ].filter(Boolean).length;
  }

  function seedEverything() {
    resetStores(seedSnapshot());
    const snapshot = foldedFigureSnapshot();
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: (nextInvariantHandle += 1),
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot,
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    const image = createCpImage({
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 10,
      naturalHeight: 10,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
    });
    const window = inlineSimulationFixture();
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
      oristudioCpFoldedFigures: [figure],
      oristudioCpAnnotations: [image],
      oristudioCpInlineSimulations: [window],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    });
    return { figure, image, window };
  }
  let nextInvariantHandle = 500;

  it('holds at most one selection through every claim', () => {
    const { figure, image, window } = seedEverything();
    const store = useWorkspaceStore.getState();
    store.setOristudioCpSelection({ ...emptyOristudioCpSelection(), lines: [1] });
    expect(holders()).toBe(1);
    store.setSelectedAnnotation(image.id);
    expect(holders()).toBe(1);
    store.setOristudioCpActiveFoldedFigure(figure.id);
    expect(holders()).toBe(1);
    store.focusOristudioCpInlineSimulation(window.id);
    expect(holders()).toBe(1);
    store.setOristudioCpSelection({ ...emptyOristudioCpSelection(), lines: [1] });
    expect(holders()).toBe(1);
    expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).toBeNull();
  });

  it('releases only the releaser\'s own claim', () => {
    const { image } = seedEverything();
    const store = useWorkspaceStore.getState();
    store.setSelectedAnnotation(image.id);
    // A tool that clears the annotation as it starts must not drop creases it
    // is about to act on — so releasing is asymmetric to taking.
    store.setSelectedAnnotation(null);
    store.setOristudioCpSelection({ ...emptyOristudioCpSelection(), lines: [1] });
    store.setSelectedAnnotation(null);
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
    store.setOristudioCpActiveFoldedFigure(null);
    store.focusOristudioCpInlineSimulation(null);
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1]);
  });

  it('leaves one holder after a flat fold and after a 3D fold', async () => {
    seedEverything();
    useWorkspaceStore.setState({
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    // A flat fold selects nothing: the creases let go and the figure is not
    // taken, so a delete right after folding removes neither.
    expect(holders()).toBe(0);

    useWorkspaceStore.setState({
      oristudioCpDocument: editableCpState([
        cpLine(
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
        ),
      ]),
      oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1] },
      oristudioCpSelectedAnnotationId: null,
    });
    await expect(useWorkspaceStore.getState().foldOristudioCpDocument()).resolves.toBe(true);
    // A 3D fold arrives selected and focused, and nothing else holds the canvas.
    const state = useWorkspaceStore.getState();
    expect(holders()).toBe(1);
    expect(state.oristudioCpActiveFoldedFigureId).toBe(state.oristudioCpFocusedFoldedFigureId);
  });

  it('selects nothing after deleting the selected object of any kind', () => {
    const { figure, image, window } = seedEverything();
    const store = useWorkspaceStore.getState();
    store.setSelectedAnnotation(image.id);
    store.removeAnnotation(image.id);
    expect(holders()).toBe(0);
    store.focusOristudioCpInlineSimulation(window.id);
    store.removeOristudioCpInlineSimulation(window.id);
    expect(holders()).toBe(0);
    store.setOristudioCpActiveFoldedFigure(figure.id);
    void store.deleteOristudioCpFoldedFigure(figure.id);
    expect(holders()).toBe(0);
    expect(useWorkspaceStore.getState().oristudioCpFocusedFoldedFigureId).toBeNull();
  });

  it('keeps an annotation selected across undo when the step left it in place', async () => {
    const { image } = seedEverything();
    const store = useWorkspaceStore.getState();
    store.setSelectedAnnotation(image.id);
    const before = useWorkspaceStore.getState().oristudioCpAnnotations;
    store.updateAnnotation(image.id, { opacity: 0.5 });
    store.recordAnnotationHistory([...before], 'Adjust opacity');

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().oristudioCpAnnotations[0]?.opacity).toBe(1);
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe(image.id);

    await useWorkspaceStore.getState().redo();
    expect(useWorkspaceStore.getState().oristudioCpAnnotations[0]?.opacity).toBe(0.5);
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe(image.id);
  });

  it('drops the annotation selection when undo removes the annotation', async () => {
    const { image } = seedEverything();
    const store = useWorkspaceStore.getState();
    const before = useWorkspaceStore.getState().oristudioCpAnnotations;
    const added = createCpImage({
      src: 'data:image/png;base64,BBBB',
      naturalWidth: 10,
      naturalHeight: 10,
      center: { x: 1, y: 1 },
      width: 1,
      height: 1,
    });
    store.addAnnotation(added);
    store.recordAnnotationHistory([...before], 'Add image');
    store.setSelectedAnnotation(added.id);

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().oristudioCpAnnotations).toEqual([image]);
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBeNull();
  });

  it('opens a file that names two holders with the creases selected', async () => {
    // Covered by 'opens native editable CP projects through the CP runtime',
    // which writes a crease selection beside an active figure and asserts the
    // figure is not selected; this pins the other half — a file with only an
    // active figure keeps it.
    resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const document = blankCpDocumentState().document;
    const nativeText = serializeNativeProjectFile(
      createNativeCreasePatternProjectFile({
        title: 'Figure only',
        filename: 'figure.cp',
        path: '/tmp/figure.cp',
        document,
        source: { format: 'cp', filename: 'figure.cp', path: '/tmp/figure.cp' },
        foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
        foldArtifacts: null,
        creaseColorMode: 'mvf',
        selection: emptyOristudioCpSelection(),
        viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
        foldedFigures: [
          {
            id: 'generated-1',
            title: 'Folded model 1',
            handle: 99,
            sourceKind: 'generated-from-current-cp',
            sourceCpRevision: 0,
            startingFaceId: 1,
            displayStyle: 'Paper5',
            status: 'ready',
            placement: IDENTITY_FOLDED_PLACEMENT,
            snapshot: foldedFigureSnapshot(),
            renderSnapshot: foldedRenderSnapshot(),
            error: null,
          },
        ],
        activeFoldedFigureId: 'generated-1',
        lineage: importedCpLineage(),
        appVersion: '0.1.1',
        now: new Date('2026-05-26T12:00:00.000Z'),
      })
    );
    const fileService = createFileService({
      text: nativeText,
      name: 'figure.osf',
      path: '/tmp/figure.osf',
    });
    await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe('generated-1');
    expect(holders()).toBe(1);
  });
});

describe('live folded model writes', () => {
  /**
   * A flat figure's appearance is a kernel round trip per change, and a colour
   * drag issues one per pointer move. The slice's own bookkeeping — which model
   * a partial merges onto, how in-flight writes are counted, what a landing
   * writes — is what keeps the kernel and the store agreeing under that load.
   */
  let nextHandle = 700;

  function seedFlatFigure() {
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]),
    });
    const snapshot = foldedFigureSnapshot();
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: (nextHandle += 1),
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot,
      renderSnapshot: foldedRenderSnapshot(),
      error: null,
    };
    const image = createCpImage({
      src: 'data:image/png;base64,AAAA',
      naturalWidth: 10,
      naturalHeight: 10,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
    });
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [figure],
      oristudioCpAnnotations: [image],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    });
    return { figure, image };
  }

  /** Each kernel write resolves only when the test says so, in issue order. */
  function deferredKernelWrites() {
    const pending: Array<() => void> = [];
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      (_handle: number, model: OristudioCpFoldedFigureModel) =>
        new Promise<OristudioCpFoldedFigureSnapshot>((resolve) => {
          pending.push(() => resolve({ ...foldedFigureSnapshot(), model }));
        })
    );
    return {
      resolveNext: async () => {
        pending.shift()?.();
        await flushMicrotasks();
      },
      count: () => pending.length,
    };
  }

  function kernelModels(): OristudioCpFoldedFigureModel[] {
    return oristudioCpMocks.setOristudioCpFoldedFigureModel.mock.calls.map(
      (call) => call[1] as OristudioCpFoldedFigureModel
    );
  }

  it('merges a second in-flight write onto the first, so neither field is lost', async () => {
    const { figure } = seedFlatFigure();
    const writes = deferredKernelWrites();
    const first = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { state: 'Back1' });
    const second = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { display_shadows: true });
    // The second write carries the first's field even though the store has not
    // heard back from the first yet.
    expect(kernelModels()[1]).toMatchObject({ state: 'Back1', display_shadows: true });
    await writes.resolveNext();
    await writes.resolveNext();
    await Promise.all([first, second]);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model).toMatchObject(
      { state: 'Back1', display_shadows: true }
    );
  });

  it('does not let the first landed write unmask a reconcile while others are in flight', async () => {
    const { figure } = seedFlatFigure();
    const writes = deferredKernelWrites();
    const first = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { state: 'Back1' });
    const second = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { display_shadows: true });
    await writes.resolveNext();
    const writesBefore = kernelModels().length;
    // With one write still in flight the reconcile must stand down — a live
    // edit is newer intent than whatever scheduled the reconcile.
    void useWorkspaceStore.getState().reconcileFoldedFigureModels([figure.id]);
    await flushMicrotasks();
    expect(kernelModels().length).toBe(writesBefore);
    await writes.resolveNext();
    await Promise.all([first, second]);
  });

  it('lands a write without taking the selection back from what the user clicked meanwhile', async () => {
    const { figure, image } = seedFlatFigure();
    const writes = deferredKernelWrites();
    const write = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { state: 'Back1' });
    // Editing selects the figure, at issue time.
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe(figure.id);
    useWorkspaceStore.getState().setSelectedAnnotation(image.id);
    await writes.resolveNext();
    await write;
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe(image.id);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model.state).toBe(
      'Back1'
    );
  });

  it('reconciles the kernel after an undo supersedes a write still in flight', async () => {
    const { figure } = seedFlatFigure();
    const original = figure.snapshot!.model;
    const writes = deferredKernelWrites();
    const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
    // A field the paper-style mirror does not own (see the reconcile tests).
    const write = useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { transparent_transparency: 40 });
    // The gesture records what it has; the undo lands while the kernel has not
    // answered — the mid-drag case.
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change folded model');
    useWorkspaceStore.getState().supersedeOristudioCpFoldedFigureModelWrites();
    await useWorkspaceStore.getState().undo();
    await flushMicrotasks();
    // Now the stale write answers.
    await writes.resolveNext();
    await write;
    await flushMicrotasks();
    // The store shows the restored model, and so does the kernel's last write:
    // the stale tick reached the kernel and the deferred reconcile put it back.
    expect(
      useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.snapshot?.model
        .transparent_transparency
    ).toEqual(original.transparent_transparency);
    await writes.resolveNext();
    await flushMicrotasks();
    await vi.waitFor(() =>
      expect(kernelModels().at(-1)?.transparent_transparency).toEqual(
        original.transparent_transparency
      )
    );
  });
});

describe('the project diagram', () => {
  beforeEach(() => {
    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
  });

  const state = () => useWorkspaceStore.getState();

  /** A diagram of two steps with an instruction each, as the author would make it. */
  function authorTwoSteps() {
    const first = state().addDiagramStep()!;
    state().setDiagramStepText(first, 'Fold in half.');
    const second = state().addDiagramStep()!;
    state().setDiagramStepText(second, 'Unfold.');
    return { first, second };
  }

  /** Every diagram-scoped key is what a replacement leaves, bar the fresh load id. */
  function expectNoDiagram(before: number) {
    const discarded = discardDiagramState();
    for (const key of DIAGRAM_SCOPED_KEYS) {
      if (key === 'diagramLoadId') continue;
      expect(state()[key], key).toEqual(discarded[key]);
    }
    expect(state().diagramLoadId).not.toBe(before);
  }

  /** The parts of a written `.osf` these tests read. */
  interface WrittenProject {
    minimumReaderSchemaVersion: number;
    workspace: {
      designs: unknown[];
      creasePattern: unknown;
      diagrams?: { id: string; title?: string; steps: unknown[] }[];
    };
  }

  function writtenFile(fileService: ReturnType<typeof createFileService>) {
    const options = fileService.saveTextFile.mock.calls.at(-1)?.[0] as SaveTextFileOptions;
    return { options, file: JSON.parse(options.contents) as WrittenProject };
  }

  it('creates the diagram with its first edit, and undoing that edit removes it again', () => {
    expect(state().diagram).toBeNull();
    const { first } = authorTwoSteps();

    expect(stepsIn(state().diagram!).map((step) => step.text)).toEqual(['Fold in half.', 'Unfold.']);
    expect(state().dirty).toBe(true);
    expect(state().diagramHistory.past).toHaveLength(4);

    while (state().undoDiagram());
    expect(state().diagram).toBeNull();
    expect(state().diagramSelectedStepId).toBeNull();

    expect(state().redoDiagram()).toBe(true);
    expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first]);
  });

  it('records nothing for an edit that changes nothing, and makes no diagram for one', () => {
    // The title a new diagram starts with (Zach, 2026-10-15): no change.
    expect(state().setDiagramTitle('Add a title')).toBe(false);
    expect(state().diagram).toBeNull();
    expect(state().dirty).toBe(false);

    const { first } = authorTwoSteps();
    const past = state().diagramHistory.past.length;
    expect(state().setDiagramStepText(first, 'Fold in half.')).toBe(false);
    expect(state().moveDiagramStep(first, 0)).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(past);
  });

  it('treats which view and which step are showing as neither history nor unsaved work', () => {
    const { first } = authorTwoSteps();
    useWorkspaceStore.setState({ dirty: false });
    const past = state().diagramHistory.past.length;

    state().selectDiagramStep(first);
    state().setDiagramView('pages');

    expect(state().diagramSelectedStepId).toBe(first);
    expect(state().diagramView).toBe('pages');
    expect(state().dirty).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(past);
    // A step that is not there cannot be selected.
    state().selectDiagramStep('missing');
    expect(state().diagramSelectedStepId).toBeNull();
  });

  it('moves the selection to the neighbour of a deleted step, and drops it on an undo that removes its step', () => {
    const { first, second } = authorTwoSteps();
    state().selectDiagramStep(first);

    expect(state().deleteDiagramSteps([first])).toBe(true);
    expect(state().diagramSelectedStepId).toBe(second);

    // Undo the delete, then undo the second step's creation while it is selected.
    state().undoDiagram();
    state().selectDiagramStep(second);
    state().undoDiagram(); // its text
    state().undoDiagram(); // its creation
    expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first]);
    expect(state().diagramSelectedStepId).toBeNull();
  });

  it('drops an instruction edit made against a diagram that has since been replaced', () => {
    const { first } = authorTwoSteps();
    const loadId = state().diagramLoadId;
    const document = state().diagram!;

    state().installDiagram({ document, readOnly: false, raw: {} });

    expect(state().setDiagramStepText(first, 'Late', { loadId })).toBe(false);
    expect(stepsIn(state().diagram!)[0].text).toBe('Fold in half.');
    expect(
      state().setDiagramStepText(first, 'On time', { loadId: state().diagramLoadId })
    ).toBe(true);
  });

  it('undoes and redoes the diagram from the Diagram, and touches no other history', async () => {
    await state().createNewCreasePattern();
    const cpPast = state().oristudioCpHistoryPast;
    authorTwoSteps();
    state().setActivePanelId('diagram');
    expect(state().activeEditingContext).toBe('diagram');

    await state().undo();
    expect(stepsIn(state().diagram!)[1].text).toBe('');
    await state().redo();
    expect(stepsIn(state().diagram!)[1].text).toBe('Unfold.');
    expect(state().oristudioCpHistoryPast).toBe(cpPast);
    expect(oristudioCpMocks.restoreOristudioCpDocumentInPlace).not.toHaveBeenCalled();
  });

  it('deletes an empty step at once, and asks first for one with content', async () => {
    const { first } = authorTwoSteps();
    const empty = state().addDiagramStep()!;
    const unregisterDialogHost = registerCommandDialogHost();
    try {
      await expect(state().confirmDeleteDiagramSteps([empty])).resolves.toBe(true);
      expect(useCommandDialogStore.getState().dialog).toBeNull();

      const refused = state().confirmDeleteDiagramSteps([first]);
      const dialog = useCommandDialogStore.getState().dialog;
      expect(dialog).toMatchObject({ type: 'confirm', title: 'Delete step 1?', tone: 'danger' });
      resolveCommandDialog(dialog!.id, false);
      await expect(refused).resolves.toBe(false);
      expect(state().diagram?.steps).toHaveLength(2);

      const accepted = state().confirmDeleteDiagramSteps([first]);
      resolveCommandDialog(useCommandDialogStore.getState().dialog!.id, true);
      await expect(accepted).resolves.toBe(true);
      expect(state().diagram?.steps).toHaveLength(1);
    } finally {
      unregisterDialogHost();
    }
  });

  it('does not delete into a diagram that replaced the one the question was about', async () => {
    const { first } = authorTwoSteps();
    const unregisterDialogHost = registerCommandDialogHost();
    try {
      const pending = state().confirmDeleteDiagramSteps([first]);
      // A file opened while the question was up: same step ids, new diagram.
      state().installDiagram({ document: state().diagram!, readOnly: false, raw: {} });
      resolveCommandDialog(useCommandDialogStore.getState().dialog!.id, true);
      await expect(pending).resolves.toBe(false);
      expect(state().diagram?.steps).toHaveLength(2);
    } finally {
      unregisterDialogHost();
    }
  });

  it('makes one sitting at an instruction one undo step, until something else is recorded', () => {
    const { first, second } = authorTwoSteps();
    const past = state().diagramHistory.past.length;

    state().setDiagramStepText(first, 'Fold', { session: 7 });
    state().setDiagramStepText(first, 'Fold in', { session: 7 });
    state().setDiagramStepText(first, 'Fold in thirds.', { session: 7 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);

    state().undoDiagram();
    expect(stepsIn(state().diagram!)[0].text).toBe('Fold in half.');

    // After an undo the same session starts a new entry rather than extending
    // the one that was undone.
    state().setDiagramStepText(first, 'Again', { session: 7 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    // Another edit in between ends the run; so does another step or session.
    state().moveDiagramStep(second, 0);
    state().setDiagramStepText(first, 'Again.', { session: 7 });
    state().setDiagramStepText(second, 'Other', { session: 7 });
    state().setDiagramStepText(second, 'Other.', { session: 8 });
    expect(state().diagramHistory.past).toHaveLength(past + 5);
  });

  it('refuses every edit to a diagram from a newer build, and writes it back as it came', async () => {
    const raw = {
      formatVersion: 99,
      id: 'diagram-new',
      title: 'From the future',
      steps: [{ id: 'step-1', text: 'Hello', hologram: true }],
      futureField: { kept: true },
    };
    useWorkspaceStore.setState({
      ...singleDesignTab('treemaker'),
    });
    state().installDiagram(readDiagram(raw));

    expect(state().diagramReadOnly).toBe(true);
    expect(state().addDiagramStep()).toBeNull();
    expect(state().setDiagramTitle('Changed')).toBe(false);
    expect(state().undoDiagram()).toBe(false);
    expect(state().dirty).toBe(false);

    const fileService = createFileService();
    await state().saveProjectAs(fileService);
    expect(writtenFile(fileService).file.workspace.diagrams).toEqual([raw]);
  });

  it('saves and reopens a project that holds only a diagram', async () => {
    authorTwoSteps();
    useWorkspaceStore.setState({ workspaceTitle: 'Crane diagram' });
    const saved = state().diagram;
    const fileService = createFileService();

    await expect(state().saveProjectAs(fileService)).resolves.toBe(true);

    const { options, file } = writtenFile(fileService);
    expect(options.extensions).toEqual(['osf']);
    expect(file.minimumReaderSchemaVersion).toBe(10);
    expect(file.workspace.designs).toEqual([]);
    expect(file.workspace.creasePattern).toBeNull();
    expect(file.workspace.diagrams?.[0]?.steps).toHaveLength(2);
    expect(state().dirty).toBe(false);

    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
    await expect(
      state().openProject(
        createFileService({ text: options.contents, name: 'crane.osf', path: '/tmp/crane.osf' })
      )
    ).resolves.toBe(true);

    expect(state().diagram).toEqual(saved);
    // Nothing but a diagram: it opens on the Diagram, not Design's chooser.
    expect(useLayoutStore.getState().activateWorkspace).toHaveBeenLastCalledWith('diagram');
    expect(state()).toMatchObject({
      workspaceTitle: 'Crane diagram',
      currentFileName: 'crane.osf',
      dirty: false,
      status: 'ready',
      error: null,
      diagramReadOnly: false,
    });
    expect(state().diagramHistory.past).toEqual([]);
  });

  it('opens a flow diagram saved before its pages were packed, takes in their packing as no edit, and saves and reopens them held (`diagram-flow-packing.md`, Decision 5)', async () => {
    const steps = Array.from({ length: 11 }, (_, index) => ({
      ...cpStep(`step-${index}`),
      text: index % 3 === 0 ? 'Fold the bottom edge up to the top edge, crease firmly, then unfold.' : 'Fold in half.',
    }));
    const document = setPageSetup(insertSteps(createDiagram({ title: 'Crane', newId: () => 'diagram-old' }), steps, 0), {
      layout: 'flow',
      stepsPerPage: 4,
      // No title block, as no diagram of then had one.
      titleBlock: PAGE_SETTINGS.titleBlock.legacy,
    });
    state().installDiagram({ document, readOnly: false, raw: {} });
    const saving = createFileService();
    await state().saveProjectAs(saving);
    const old = writtenFile(saving).options.contents;
    // As a build before packing wrote it: no page's arrangement.
    expect(JSON.parse(old).workspace.diagrams[0]).not.toHaveProperty('pageArrangements');

    const open = async (text: string) => {
      resetStores(seedSnapshot());
      useLayoutStore.setState({ activateWorkspace: vi.fn() });
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      await expect(state().openProject(createFileService({ text, name: 'crane.osf', path: '/tmp/crane.osf' }))).resolves.toBe(true);
      return state().diagram!;
    };
    // The Pages view's layout, with the real fonts.
    const layOut = (diagram: DiagramDocument) =>
      layoutDiagram(diagram, fontTextSetter((key, weight) => FIXTURE_FONTS.font(key, weight)?.metrics ?? null, diagram.hanStyle));

    // Opened, it holds no packing, and every page is packed: four steps, four and three.
    const first = layOut(await open(old));
    expect(first.pages.map((page) => [page.cells.length, page.packing?.packed])).toEqual([
      [4, true],
      [4, true],
      [3, true],
    ]);
    // Opened again, unsaved, it packs the same.
    const opened = await open(old);
    expect(opened.pageArrangements).toBeUndefined();
    const packed = layOut(opened);
    expect(packed.packed).toEqual(first.packed);
    // Taken in as the Pages view takes it in: no edit, no undo step, the project as it was.
    expect(state().adoptDiagramPageArrangements(packed.packed!, opened)).toBe(true);
    const adopted = state().diagram!;
    expect(Object.keys(adopted.pageArrangements!).sort()).toEqual(['step-0', 'step-4', 'step-8']);
    expect(state().dirty).toBe(false);
    expect(state().diagramHistory.past).toEqual([]);

    // The next save writes them.
    const again = createFileService();
    await expect(state().saveProject(again)).resolves.toBe(true);
    const saved = writtenFile(again).options.contents;
    expect(Object.keys(JSON.parse(saved).workspace.diagrams[0].pageArrangements)).toEqual(['step-0', 'step-4', 'step-8']);
    expect(state().dirty).toBe(false);

    // Reopened, every page holds what was saved, and draws as it was packed: nothing is packed again.
    const reopened = await open(saved);
    expect(reopened.pageArrangements).toEqual(adopted.pageArrangements);
    const held = layOut(reopened);
    expect(held.packed).toBeUndefined();
    expect(held.pages.map((page) => page.packing?.packed)).toEqual([false, false, false]);
    expect(held.pages.map((page) => [page.cells, page.band, page.turns])).toEqual(packed.pages.map((page) => [page.cells, page.band, page.turns]));
    expect(state().dirty).toBe(false);
  });

  it('opens the first of a project’s diagrams, and saves the others after it as they came', async () => {
    authorTwoSteps();
    const fileService = createFileService();
    await state().saveProjectAs(fileService);
    const file = JSON.parse(writtenFile(fileService).options.contents);
    const shown = file.workspace.diagrams[0];
    // What a later build that keeps several diagrams in a project would write.
    const other = { formatVersion: 1, id: 'diagram-frog', title: 'Frog', steps: [], futureField: { kept: true } };
    file.workspace.diagrams = [shown, other];

    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
    await state().openProject(
      createFileService({ text: JSON.stringify(file), name: 'two.osf', path: '/tmp/two.osf' })
    );
    expect(state().diagram?.id).toBe(shown.id);
    expect(state().diagramOthers).toEqual([other]);

    state().setDiagramTitle('Crane, again');
    const again = createFileService();
    await state().saveProject(again);
    const written = writtenFile(again).file.workspace.diagrams;
    expect(written?.map((diagram) => diagram.id)).toEqual([shown.id, 'diagram-frog']);
    expect(written?.[0].title).toBe('Crane, again');
    expect(written?.[1]).toEqual(other);
  });

  it('opens a project saved with one diagram, before the list, and saves it as the list', async () => {
    authorTwoSteps();
    const saved = state().diagram;
    const fileService = createFileService();
    await state().saveProjectAs(fileService);
    const file = JSON.parse(writtenFile(fileService).options.contents);
    // As builds before the list wrote it.
    file.workspace.diagram = file.workspace.diagrams[0];
    delete file.workspace.diagrams;
    file.minimumReaderSchemaVersion = 9;

    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
    await state().openProject(
      createFileService({ text: JSON.stringify(file), name: 'one.osf', path: '/tmp/one.osf' })
    );
    expect(state().diagram).toEqual(saved);
    expect(state().diagramOthers).toEqual([]);

    const again = createFileService();
    await state().saveProject(again);
    const written = writtenFile(again).file;
    expect(written.minimumReaderSchemaVersion).toBe(10);
    expect(written.workspace.diagrams).toHaveLength(1);
    expect('diagram' in written.workspace).toBe(false);
  });

  it('opening a diagram-only project replaces the crease pattern that was open', async () => {
    authorTwoSteps();
    const contents = await (async () => {
      const fileService = createFileService();
      await state().saveProjectAs(fileService);
      return writtenFile(fileService).options.contents;
    })();

    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
    await state().createNewCreasePattern();
    expect(state().oristudioCpDocument).not.toBeNull();
    oristudioCpMocks.releaseOristudioCpDocument.mockClear();

    await state().openProject(
      createFileService({ text: contents, name: 'only.osf', path: '/tmp/only.osf' })
    );

    expect(oristudioCpMocks.releaseOristudioCpDocument).toHaveBeenCalled();
    expect(state().oristudioCpDocument).toBeNull();
    expect(state().importedCreasePattern).toBeNull();
    expect(state().currentFileName).toBe('only.osf');
    expect(state().diagram?.steps).toHaveLength(2);
    // And the next save writes the diagram alone, not the crease pattern that was open.
    const fileService = createFileService();
    await state().saveProject(fileService);
    expect(writtenFile(fileService).file.workspace.creasePattern).toBeNull();
  });

  it('saves the diagram beside a crease pattern, and reopens both', async () => {
    await state().createNewCreasePattern();
    authorTwoSteps();
    const saved = state().diagram;
    const fileService = createFileService();

    await state().saveProjectAs(fileService);
    const { options, file } = writtenFile(fileService);
    expect(file.minimumReaderSchemaVersion).toBe(10);
    expect(file.workspace.creasePattern).not.toBeNull();

    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
    await state().openProject(
      createFileService({ text: options.contents, name: 'both.osf', path: '/tmp/both.osf' })
    );

    expect(state().oristudioCpDocument).not.toBeNull();
    expect(state().diagram).toEqual(saved);
    expect(state().dirty).toBe(false);
  });

  // The Diagram's example: a crease pattern lands on Edit, unless the caller
  // names the surface the file is for — and it counts as an example, not a file.
  it('lands an open where its caller names, and reports the source it gives', async () => {
    await state().createNewCreasePattern();
    authorTwoSteps();
    const fileService = createFileService();
    await state().saveProjectAs(fileService);
    const { options } = writtenFile(fileService);

    for (const [openOptions, landing, source] of [
      [{}, 'edit', 'file'],
      [{ landing: 'diagram', source: 'example' }, 'diagram', 'example'],
    ] as const) {
      resetStores(seedSnapshot());
      useLayoutStore.setState({ activateWorkspace: vi.fn() });
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      analyticsMocks.track.mockClear();
      await expect(
        state().openProject(createFileService({ text: options.contents, name: 'Crane.osf', path: null }), openOptions)
      ).resolves.toBe(true);

      expect(state().oristudioCpDocument).not.toBeNull();
      expect(useLayoutStore.getState().activateWorkspace).toHaveBeenLastCalledWith(landing);
      expect(analyticsMocks.track).toHaveBeenCalledWith('project opened', { source });
    }
  });

  it('saves a crease pattern opened from an Oriedita file as .osf once it has a diagram', async () => {
    await state().openProject(
      createFileService({
        text: '{"@version":"v1.1","title":"native ori","lineSegments":[]}',
        name: 'native.ori',
        path: '/tmp/native.ori',
      })
    );
    authorTwoSteps();
    const fileService = createFileService();

    await state().saveProject(fileService);

    expect(oristudioCpMocks.exportOristudioCpDocumentAsOri).not.toHaveBeenCalled();
    const { options, file } = writtenFile(fileService);
    // Never over the `.ori`: a native target is asked for.
    expect(options).toMatchObject({ extensions: ['osf'], path: null });
    expect(file.workspace.diagrams?.[0]?.steps).toHaveLength(2);
  });

  describe('typing that has not committed yet', () => {
    afterEach(resetPendingEditsForTests);

    it('is saved, not the text from before it', async () => {
      const { first } = authorTwoSteps();
      // A field holding a draft, as the instruction field does between keystrokes.
      registerPendingEditFlush(() => state().setDiagramStepText(first, 'Typed, not committed.'));
      const fileService = createFileService();

      await state().saveProject(fileService);

      const steps = writtenFile(fileService).file.workspace.diagrams?.[0]?.steps as { text: string }[];
      expect(steps[0].text).toBe('Typed, not committed.');
      expect(state().dirty).toBe(false);
    });

    it('counts as unsaved work when the project is about to be replaced', async () => {
      authorTwoSteps();
      useWorkspaceStore.setState({ dirty: false });
      const { first } = { first: stepsIn(state().diagram!)[0].id };
      registerPendingEditFlush(() => state().setDiagramStepText(first, 'Still typing'));
      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const replacing = state().createNewCreasePattern();
        const dialog = useCommandDialogStore.getState().dialog;
        expect(dialog).toMatchObject({ type: 'confirm', title: 'Discard unsaved changes?' });
        resolveCommandDialog(dialog!.id, false);
        await replacing;
        expect(stepsIn(state().diagram!)[0].text).toBe('Still typing');
      } finally {
        unregisterDialogHost();
      }
    });
  });

  it('leaves the project unsaved when the diagram changes while the save dialog is up', async () => {
    const { second } = authorTwoSteps();
    const fileService = createFileService();
    fileService.saveTextFile.mockImplementation(async (options: SaveTextFileOptions) => {
      // An edit that lands while the native dialog is open, as a field's
      // blur commit does when the window loses focus to it.
      state().setDiagramStepText(second, 'Edited during the dialog');
      return { name: options.suggestedName, path: `/tmp/${options.suggestedName}` };
    });

    await state().saveProjectAs(fileService);

    const steps = writtenFile(fileService).file.workspace.diagrams?.[0]?.steps as { text: string }[];
    expect(steps[1].text).toBe('Unfold.');
    expect(state().dirty).toBe(true);
  });

  it('keeps the old project whole when a crease-pattern project fails to open over it', async () => {
    // A file holding only a crease pattern, made by the real writer, from Edit.
    await state().createNewCreasePattern();
    state().setActivePanelId('crease-pattern');
    const cpOnly = createFileService();
    await state().saveProjectAs(cpOnly);
    const cpOnlyText = writtenFile(cpOnly).options.contents;

    authorTwoSteps();
    const ours = createFileService();
    await state().saveProjectAs(ours);
    const diagram = state().diagram;
    const path = state().currentFilePath;
    oristudioCpMocks.restoreOristudioCpDocument.mockRejectedValueOnce(new Error('kernel refused'));

    await expect(
      state().openProject(createFileService({ text: cpOnlyText, name: 'other.osf', path: '/tmp/other.osf' }))
    ).resolves.toBe(false);

    expect(state().currentFilePath).toBe(path);
    expect(state().diagram).toBe(diagram);
    // So saving again writes the file it came from, diagram and all.
    const again = createFileService();
    await state().saveProject(again);
    expect(writtenFile(again).file.workspace.diagrams?.[0]?.steps).toHaveLength(2);
  });

  it('keeps the crease pattern when a .bps fails to open over it', async () => {
    await state().createNewCreasePattern();
    authorTwoSteps();
    await state().saveProjectAs(createFileService());
    const document = state().oristudioCpDocument;
    bpMocks.loadOristudioBpProjectFromText.mockRejectedValueOnce(new Error('not a .bps'));

    await state().openProject(createFileService({ text: 'garbage', name: 'x.bps', path: '/tmp/x.bps' }));

    expect(state().oristudioCpDocument).toBe(document);
    const again = createFileService();
    await state().saveProject(again);
    expect(writtenFile(again).file.workspace.creasePattern).not.toBeNull();
  });

  it('still refuses a project with no design, no crease pattern and no project document', async () => {
    // Written by the real writer, so the refusal is the loader's — not a format
    // check failing first on a hand-made file.
    const empty = serializeNativeProjectFile(
      createNativeProjectFile({
        workspaceTitle: 'Empty',
        filename: 'empty.osf',
        path: null,
        designs: [],
        creasePattern: null,
        diagrams: [],
        appVersion: 'test',
      })
    );

    await expect(
      state().openProject(createFileService({ text: empty, name: 'empty.osf', path: null }))
    ).resolves.toBe(false);
    expect(state().status).toBe('error');
    expect(state().error).toMatchObject({
      code: 'project_file_damaged',
      message: expect.stringContaining('neither a design, a crease pattern, a diagram nor a fold sequence'),
    });
  });

  // Every entry point that replaces the project, each with a diagram open first.
  it.each([
    ['File › New crease pattern', () => state().createNewCreasePattern()],
    ['File › New', () => state().createNewProject()],
    ['the starter project', () => state().loadStarterProject()],
    [
      'opening a tree',
      () =>
        state().openProject(
          createFileService({ text: 'tree tmd5', name: 'opened.tmd5', path: '/tmp/opened.tmd5' })
        ),
    ],
    [
      'opening a crease pattern',
      () =>
        state().openProject(
          createFileService({
            text: '{"@version":"v1.1","title":"native ori","lineSegments":[]}',
            name: 'native.ori',
            path: '/tmp/native.ori',
          })
        ),
    ],
    [
      'opening a box-pleat file',
      () =>
        state().openProject(
          createFileService({ text: '{}', name: 'crane.bps', path: '/tmp/crane.bps' })
        ),
    ],
    ['a new box-pleat project', () => state().createOristudioBpProject({ confirmDiscard: false })],
    [
      'a box-pleat example',
      () => state().loadOristudioBpExample('valid-packing', { confirmDiscard: false }),
    ],
  ])('%s replaces the diagram and the fold sequences', async (_label, replace) => {
    authorTwoSteps();
    state().commitFoldStep({ parent: null, op: valleyAt(0.5) });
    // Saved, so no discard prompt stands between the action and the test.
    useWorkspaceStore.setState({ dirty: false });
    const before = state().diagramLoadId;
    const foldBefore = state().foldLoadId;

    await replace();

    expect(state().status).not.toBe('error');
    expectNoDiagram(before);
    // Every fold-scoped key is what a replacement leaves, bar the fresh load id.
    const discarded = discardFoldState();
    for (const key of FOLD_SCOPED_KEYS) {
      if (key === 'foldLoadId') continue;
      expect(state()[key], key).toEqual(discarded[key]);
    }
    expect(state().foldLoadId).not.toBe(foldBefore);
  });

  // And every one that only adds to the project, or rebuilds a part of it.
  it.each([
    ['closing the crease pattern', () => state().clearOristudioCpDocument()],
    ['Edit seeding its own canvas', async () => {
      useWorkspaceStore.setState({ oristudioCpDocument: null });
      await state().ensureEditCreasePattern();
    }],
    ['choosing a design method', () => state().createNewProject({ preserveEditCanvas: true })],
    [
      'seeding a box-pleat design',
      () => state().createOristudioBpProject({ confirmDiscard: false, preserveEditCanvas: true }),
    ],
    ['the engine finishing its boot', () => state().initEngine()],
  ])('%s keeps the diagram, the fold sequences and their unsaved state', async (_label, act) => {
    authorTwoSteps();
    state().commitFoldStep({ parent: null, op: valleyAt(0.5) });
    const diagram = state().diagram;
    const history = state().diagramHistory;
    const fold = pickFoldState(state());

    await act();

    expect(state().status).not.toBe('error');
    expect(state().diagram).toBe(diagram);
    expect(state().diagramHistory).toBe(history);
    expect(pickFoldState(state())).toEqual(fold);
    expect(state().foldSequences).toBe(fold.foldSequences);
    expect(state().dirty).toBe(true);
  });

  describe('uploaded pictures', () => {
    function svgAsset(id: string, side = 10): KnownDiagramAsset {
      const result = sanitizeSvg(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"><rect width="${side / 2}" height="${side / 2}"/></svg>`,
        { idPrefix: id, mode: 'import' }
      );
      if (!result.ok) throw new Error(result.error);
      return { id, kind: 'svg', svg: result.svg, widthPx: side, heightPx: side, bytes: result.svg.length };
    }

    const assetOf = (stepId: string) => {
      const diagram = state().diagram!;
      return stepAsset(diagram, stepsIn(diagram)[stepIndex(diagram, stepId)])?.id ?? null;
    };

    it('fills a selected step that has no picture with one picture, as one undo step', () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      const past = state().diagramHistory.past.length;

      expect(state().addDiagramPictures([svgAsset('asset-a')])).toEqual({ stepIds: [first], filled: true });

      expect(state().diagram?.steps).toHaveLength(2);
      expect(assetOf(first)).toBe('asset-a');
      expect(stepsIn(state().diagram!)[0].text).toBe('Fold in half.');
      expect(state().diagramSelectedStepId).toBe(first);
      expect(state().diagramHistory.past).toHaveLength(past + 1);
    });

    it('adds several pictures as steps after the selected one, in order, and selects the last', () => {
      const { first, second } = authorTwoSteps();
      state().selectDiagramStep(first);
      const past = state().diagramHistory.past.length;

      const added = state().addDiagramPictures([svgAsset('asset-a'), svgAsset('asset-b')])!;

      expect(added.filled).toBe(false);
      expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first, ...added.stepIds, second]);
      expect(added.stepIds.map(assetOf)).toEqual(['asset-a', 'asset-b']);
      expect(state().diagramSelectedStepId).toBe(added.stepIds[1]);
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      expect(state().undoDiagram()).toBe(true);
      expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first, second]);
    });

    it('adds one picture as a new step when the selected step already has one, or nothing is selected', () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      state().addDiagramPictures([svgAsset('asset-a')]);
      const added = state().addDiagramPictures([svgAsset('asset-b')])!;
      expect(added.filled).toBe(false);
      expect(stepsIn(state().diagram!)[1].id).toBe(added.stepIds[0]);

      state().selectDiagramStep(null);
      const atEnd = state().addDiagramPictures([svgAsset('asset-c')])!;
      expect(stepsIn(state().diagram!).at(-1)?.id).toBe(atEnd.stepIds[0]);
    });

    it('drops pictures imported for a diagram that has since been replaced', () => {
      authorTwoSteps();
      const loadId = state().diagramLoadId;
      // A file opened while the pictures were being read.
      state().installDiagram(null);
      expect(state().addDiagramPictures([svgAsset('asset-a')], { loadId })).toBeNull();
      expect(state().setDiagramStepPicture('anything', svgAsset('asset-b'), { loadId })).toBe(false);
      expect(state().diagram).toBeNull();
    });

    it('replaces and removes a picture, keeping the instruction, and undoes both', () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      state().addDiagramPictures([svgAsset('asset-a')]);

      expect(state().setDiagramStepPicture(first, svgAsset('asset-b'))).toBe(true);
      expect(assetOf(first)).toBe('asset-b');
      expect(state().removeDiagramStepPicture(first)).toBe(true);
      expect(assetOf(first)).toBeNull();
      expect(stepsIn(state().diagram!)[0].text).toBe('Fold in half.');
      expect(state().removeDiagramStepPicture(first)).toBe(false);

      state().undoDiagram();
      state().undoDiagram();
      // The replaced picture's asset is still there for undo to bring back.
      expect(assetOf(first)).toBe('asset-a');
    });

    it('lets go of a replaced picture once only history holds it, so the byte cap can trim it', () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      const big = (id: string): KnownDiagramAsset => {
        const src = `data:image/png;base64,${id.padEnd(1024 * 1024, 'A')}`;
        return { id, kind: 'raster', src, widthPx: 1, heightPx: 1, bytes: src.length };
      };
      state().addDiagramPictures([big('asset-0')]);
      for (let index = 1; index <= 80; index++) state().setDiagramStepPicture(first, big(`asset-${index}`));

      // Only the picture on show is in the diagram.
      expect(Object.keys(state().diagram!.assets)).toEqual(['asset-80']);
      // 80 MB of replaced pictures is past the 64 MB cap: the oldest undo steps go.
      expect(state().diagramHistory.past.length).toBeLessThan(80);
      // Undo still brings back the one before.
      state().undoDiagram();
      expect(stepAsset(state().diagram!, stepsIn(state().diagram!)[0])?.id).toBe('asset-79');
    });

    it('keeps what sanitizing changed in an upload for this session only', () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      state().addDiagramPictures([svgAsset('asset-a')]);
      useWorkspaceStore.setState({ dirty: false });

      state().noteDiagramPictureChanges('asset-a', ['flowed-text']);
      expect(state().diagramPictureNotices).toEqual({ 'asset-a': ['flowed-text'] });
      expect(state().dirty).toBe(false);
      state().noteDiagramPictureChanges('asset-a', []);
      expect(state().diagramPictureNotices).toEqual({});

      state().noteDiagramPictureChanges('asset-a', ['css-dropped']);
      state().installDiagram(null);
      expect(state().diagramPictureNotices).toEqual({});
    });

    it('saves pictures and reopens them, leaving out an asset only undo refers to', async () => {
      const { first, second } = authorTwoSteps();
      state().selectDiagramStep(first);
      state().addDiagramPictures([svgAsset('asset-a')]);
      state().setDiagramStepPicture(first, svgAsset('asset-b'));
      state().selectDiagramStep(second);
      state().addDiagramPictures([svgAsset('asset-c')]);
      const fileService = createFileService();
      await state().saveProjectAs(fileService);

      const { options } = writtenFile(fileService);
      const written = JSON.parse(options.contents).workspace.diagrams?.[0];
      expect(Object.keys(written.assets).sort()).toEqual(['asset-b', 'asset-c']);

      resetStores(seedSnapshot());
      useLayoutStore.setState({ activateWorkspace: vi.fn() });
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      await state().openProject(
        createFileService({ text: options.contents, name: 'crane.osf', path: '/tmp/crane.osf' })
      );
      expect(stepsIn(state().diagram!).map((step) => stepAsset(state().diagram!, step)?.id)).toEqual([
        'asset-b',
        'asset-c',
      ]);
      expect(stepsIn(state().diagram!).map((step) => step.text)).toEqual(['Fold in half.', 'Unfold.']);
    });

    it('opens a step in detail, and closes it with whatever clears the selection', () => {
      const { first, second } = authorTwoSteps();
      useWorkspaceStore.setState({ dirty: false });
      expect(state().openDiagramStep('missing')).toBe(false);
      expect(state().openDiagramStep(second)).toBe(true);
      expect(state()).toMatchObject({ diagramSelectedStepId: second, diagramDetail: 'pose', dirty: false });

      // The detail follows the selection from step to step.
      state().selectDiagramStep(first);
      expect(state().diagramDetail).toBe('pose');
      state().closeDiagramStep();
      expect(state()).toMatchObject({ diagramSelectedStepId: first, diagramDetail: null });

      state().openDiagramStep(first);
      state().selectDiagramStep(null);
      expect(state().diagramDetail).toBeNull();

      // Undoing the add that made the open step takes the detail with it.
      state().openDiagramStep(second);
      state().deleteDiagramSteps([first, second]);
      expect(state()).toMatchObject({ diagramSelectedStepId: null, diagramDetail: null });
      state().undoDiagram();
      state().openDiagramStep(second);
      while (state().undoDiagram());
      expect(state().diagramDetail).toBeNull();
    });

    it('chooses one step’s pattern at a time, and lets the picker go with the step', () => {
      const { first, second } = authorTwoSteps();
      useWorkspaceStore.setState({ dirty: false });
      expect(state().openDiagramPatternPicker('missing')).toBe(false);
      expect(state().openDiagramPatternPicker(second)).toBe(true);
      // Choosing selects the step, and is view state: nothing to save.
      expect(state()).toMatchObject({ diagramSelectedStepId: second, diagramPatternPicker: second, dirty: false });
      // The picker belongs to its step: selecting it again keeps it, another closes it.
      state().selectDiagramStep(second);
      expect(state().diagramPatternPicker).toBe(second);
      state().selectDiagramStep(first);
      expect(state().diagramPatternPicker).toBeNull();
      state().openDiagramPatternPicker(first);
      state().closeDiagramPatternPicker();
      expect(state().diagramPatternPicker).toBeNull();
      // Not for a diagram that cannot change.
      useWorkspaceStore.setState({ diagramReadOnly: true });
      expect(state().openDiagramPatternPicker(first)).toBe(false);
    });

    it('poses an upload as one undo step, and refuses a step without one', () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      state().addDiagramPictures([svgAsset('asset-a')]);
      const past = state().diagramHistory.past.length;

      expect(state().setDiagramStepPose(first, { rotationQuarterTurns: 3, mirrored: false })).toBe(true);
      expect(stepsIn(state().diagram!)[0].source).toMatchObject({ rotationQuarterTurns: 3 });
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      state().undoDiagram();
      expect(stepsIn(state().diagram!)[0].source).toMatchObject({ rotationQuarterTurns: 0 });
      const plain = stepsIn(state().diagram!)[1].id;
      expect(state().setDiagramStepPose(plain, { rotationQuarterTurns: 1, mirrored: false })).toBe(false);
    });

    it('warns about a heavy file by what it holds, not by what undo keeps', async () => {
      const { first } = authorTwoSteps();
      state().selectDiagramStep(first);
      const heavy: KnownDiagramAsset = {
        id: 'asset-heavy',
        kind: 'raster',
        src: `data:image/png;base64,${'A'.repeat(26 * 1024 * 1024)}`,
        widthPx: 1,
        heightPx: 1,
        bytes: 26 * 1024 * 1024,
      };
      state().addDiagramPictures([heavy]);
      await state().saveProjectAs(createFileService());
      expect(state().projectMessage).toMatch(/embeds ~\d+ MB/);

      state().setDiagramStepPicture(first, svgAsset('asset-light'));
      await state().saveProjectAs(createFileService());
      expect(state().projectMessage).not.toMatch(/embeds/);
    });
  });


  describe('annotating a step', () => {
    const ARROW: KnownDiagramAnnotation = { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 };
    const LABEL: KnownDiagramAnnotation = { id: 'a-2', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };

    function pictured(): string {
      const result = sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><rect width="20" height="10"/></svg>',
        { idPrefix: 'asset-pic', mode: 'import' }
      );
      if (!result.ok) throw new Error(result.error);
      state().addDiagramPictures([
        { id: 'asset-pic', kind: 'svg', svg: result.svg, widthPx: 40, heightPx: 30, bytes: result.svg.length },
      ]);
      const stepId = state().diagramSelectedStepId!;
      state().openDiagramStep(stepId, 'annotate');
      return stepId;
    }
    const step = (stepId: string) => stepsIn(state().diagram!)[stepIndex(state().diagram!, stepId)]!;
    const add = (stepId: string, annotation: KnownDiagramAnnotation) =>
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [...list, annotation], { select: annotation.id });

    it('adds one as one undo step, selected, drawn on the picture the step has', () => {
      const stepId = pictured();
      const past = state().diagramHistory.past.length;
      expect(add(stepId, ARROW)).toBe(true);
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      expect(state().diagramSelectedAnnotationId).toBe('a-1');
      expect(step(stepId).annotatedPictureKey).toBe(step(stepId).picture!.key);
      // An edit that changes nothing records nothing.
      expect(state().editDiagramAnnotations(stepId, 'Nothing', (list) => list)).toBe(false);
      expect(state().diagramHistory.past).toHaveLength(past + 1);
    });

    it('makes a sitting at a label’s field one undo step, and nothing else extends it', () => {
      const stepId = pictured();
      add(stepId, LABEL);
      const past = state().diagramHistory.past.length;
      const text = (value: string, session: number) =>
        state().editDiagramAnnotations(stepId, 'Edit label', (list) => list.map((a) => ({ ...a, text: value })), { session });
      text('B', 7);
      text('BC', 7);
      expect(state().diagramHistory.past).toHaveLength(past + 1);
      // An instruction's session is another field's, whatever its number.
      state().setDiagramStepText(stepId, 'Fold.', { session: 7 });
      text('BCD', 7);
      expect(state().diagramHistory.past).toHaveLength(past + 3);
      state().undoDiagram();
      expect((step(stepId).annotations[0] as KnownDiagramAnnotation).text).toBe('BC');
    });

    it('lets go of the selected annotation with its step, the detail, or an undo that removes it', () => {
      const stepId = pictured();
      add(stepId, ARROW);
      state().undoDiagram();
      expect(state().diagramSelectedAnnotationId).toBeNull();
      state().redoDiagram();
      state().selectDiagramAnnotation('a-1');
      expect(state().diagramSelectedAnnotationId).toBe('a-1');
      state().closeDiagramStep();
      expect(state().diagramSelectedAnnotationId).toBeNull();
      state().openDiagramStep(stepId, 'annotate');
      state().selectDiagramAnnotation('a-1');
      state().selectDiagramStep(state().addDiagramStep());
      expect(state().diagramSelectedAnnotationId).toBeNull();
      // One that is not on the selected step cannot be selected.
      state().selectDiagramAnnotation('a-1');
      expect(state().diagramSelectedAnnotationId).toBeNull();
    });

    it('keeps the tool and the selection out of history and unsaved work', () => {
      const stepId = pictured();
      add(stepId, ARROW);
      useWorkspaceStore.setState({ dirty: false });
      const past = state().diagramHistory.past.length;
      state().setDiagramAnnotateTool('circle');
      state().selectDiagramAnnotation(null);
      expect(state().diagramAnnotateTool).toBe('circle');
      expect(state().dirty).toBe(false);
      expect(state().diagramHistory.past).toHaveLength(past);
    });

    it('says when the picture changed under them, until they are kept or touched', () => {
      const stepId = pictured();
      add(stepId, ARROW);
      const result = sanitizeSvg(
        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"/>',
        { idPrefix: 'asset-new', mode: 'import' }
      );
      if (!result.ok) throw new Error(result.error);
      state().setDiagramStepPicture(stepId, { id: 'asset-new', kind: 'svg', svg: result.svg, widthPx: 10, heightPx: 10, bytes: 1 });
      expect(annotationsOutOfStep(step(stepId))).toBe(true);
      expect(state().keepDiagramAnnotations(stepId)).toBe(true);
      expect(annotationsOutOfStep(step(stepId))).toBe(false);
      expect(state().keepDiagramAnnotations(stepId)).toBe(false);
    });

    it('offers Delete for the selected annotation in Annotate, and for the step anywhere else', () => {
      const stepId = pictured();
      state().setActivePanelId('diagram');
      expect(hasDeletableDiagramSelection(state())).toBe(false);
      add(stepId, ARROW);
      expect(hasDeletableDiagramSelection(state())).toBe(true);
      state().selectDiagramAnnotation(null);
      expect(hasDeletableDiagramSelection(state())).toBe(false);
      state().openDiagramStep(stepId, 'pose');
      expect(hasDeletableDiagramSelection(state())).toBe(true);
    });

    it('acts as Pose on a step with nothing to annotate, and Annotate again on one with a picture', () => {
      const stepId = pictured();
      state().setActivePanelId('diagram');
      add(stepId, ARROW);
      const empty = state().addDiagramStep()!;
      // Walked onto in Annotate: the detail shows Pose, so Delete is the step's.
      expect(state().diagramDetail).toBe('annotate');
      expect(isDiagramAnnotating(state())).toBe(false);
      expect(hasDeletableDiagramSelection(state())).toBe(true);
      state().selectDiagramStep(stepId);
      expect(isDiagramAnnotating(state())).toBe(true);
      // Its picture taken away: Pose again.
      state().removeDiagramStepPicture(stepId);
      expect(isDiagramAnnotating(state())).toBe(false);
      expect(empty).not.toBe(stepId);
    });

    it('takes none on a step with no picture, or a diagram it cannot change', () => {
      const stepId = state().addDiagramStep()!;
      expect(add(stepId, ARROW)).toBe(false);
      const pic = pictured();
      useWorkspaceStore.setState({ diagramReadOnly: true });
      expect(add(pic, ARROW)).toBe(false);
    });
  });
});

describe('the project fold sequences', () => {
  beforeEach(() => {
    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
  });

  const state = () => useWorkspaceStore.getState();

  /** sheet → a → b, as the author folds it, the reader back on a. */
  /**
   * A valley as Fold's canvas commits one (`foldStepBuilder`): its landing
   * said, as the file writes every valley — so a save and a reopen give back
   * the step that was committed.
   */
  const canvasValley = (y: number) => ({ ...valleyAt(y), landing: { kind: 'outer' as const } });

  function foldTwo() {
    const a = state().commitFoldStep({ parent: null, op: canvasValley(0.5) })!;
    const b = state().commitFoldStep({ parent: a, op: canvasValley(0.25) })!;
    state().moveFoldCursor(a);
    return { a, b };
  }

  /** The parts of a written `.osf` these tests read. */
  interface WrittenProject {
    minimumReaderSchemaVersion: number;
    workspace: {
      designs: unknown[];
      creasePattern: unknown;
      foldSequences?: { steps: unknown[] }[];
      viewState: { fold?: { cursor: string | null } };
    };
  }

  function writtenFile(fileService: ReturnType<typeof createFileService>) {
    const options = fileService.saveTextFile.mock.calls.at(-1)?.[0] as SaveTextFileOptions;
    return { options, file: JSON.parse(options.contents) as WrittenProject };
  }

  async function reopen(contents: string, name: string) {
    resetStores(seedSnapshot());
    useLayoutStore.setState({ activateWorkspace: vi.fn() });
    useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
    return state().openProject(createFileService({ text: contents, name, path: `/tmp/${name}` }));
  }

  it('saves and reopens a project that holds only fold sequences, on Fold, the reader where it was', async () => {
    const { a } = foldTwo();
    useWorkspaceStore.setState({ workspaceTitle: 'Crane' });
    const saved = state().foldSequences.map((held) => held.document);
    const reader = state().foldReader;
    const fileService = createFileService();

    await expect(state().saveProjectAs(fileService)).resolves.toBe(true);

    const { options, file } = writtenFile(fileService);
    expect(options.extensions).toEqual(['osf']);
    // Fold sequences ask for reader 11: v0.6.0 reads the diagrams (10) but not these.
    expect(file.minimumReaderSchemaVersion).toBe(11);
    expect(file.workspace.designs).toEqual([]);
    expect(file.workspace.creasePattern).toBeNull();
    expect(file.workspace.foldSequences?.[0].steps).toHaveLength(2);
    expect(file.workspace.viewState.fold?.cursor).toBe(a);
    expect(state().dirty).toBe(false);

    await expect(reopen(options.contents, 'crane.osf')).resolves.toBe(true);

    expect(state().foldSequences.map((held) => held.document)).toEqual(saved);
    expect(state().foldReader).toEqual(reader);
    // Nothing but fold sequences: it opens on Fold, not Design's chooser.
    expect(useLayoutStore.getState().activateWorkspace).toHaveBeenLastCalledWith('fold');
    expect(state()).toMatchObject({ workspaceTitle: 'Crane', currentFileName: 'crane.osf', dirty: false, error: null });
    expect(state().foldHistory).toEqual({ past: [], future: [] });
  });

  it('saves the sequences beside a crease pattern, and reopens both, on Edit', async () => {
    await state().createNewCreasePattern();
    foldTwo();
    const saved = state().foldSequences.map((held) => held.document);
    const fileService = createFileService();

    await state().saveProjectAs(fileService);
    const { options, file } = writtenFile(fileService);
    expect(file.minimumReaderSchemaVersion).toBe(11);
    expect(file.workspace.creasePattern).not.toBeNull();

    await reopen(options.contents, 'both.osf');
    expect(state().oristudioCpDocument).not.toBeNull();
    expect(state().foldSequences.map((held) => held.document)).toEqual(saved);
    expect(useLayoutStore.getState().activateWorkspace).toHaveBeenLastCalledWith('edit');
    expect(state().dirty).toBe(false);
  });

  it('opens a development build’s file that stamped its sequences reader 10, and saves it as reader 11', async () => {
    foldTwo();
    useWorkspaceStore.setState({ workspaceTitle: 'Crane' });
    const fileService = createFileService();
    await state().saveProjectAs(fileService);
    // As a development build wrote it, before fold sequences had a reader of their own.
    const file = JSON.parse(writtenFile(fileService).options.contents);
    file.minimumReaderSchemaVersion = 10;

    await expect(reopen(JSON.stringify(file), 'crane.osf')).resolves.toBe(true);
    expect(state().foldSequences.map((held) => held.document.id)).toEqual(
      file.workspace.foldSequences.map((sequence: { id: string }) => sequence.id)
    );
    expect(state().foldSequences[0]!.document.steps).toHaveLength(2);

    const again = createFileService();
    await state().saveProject(again);
    const written = writtenFile(again).file;
    expect(written.minimumReaderSchemaVersion).toBe(11);
    expect(written.workspace.foldSequences?.[0].steps).toHaveLength(2);
  });

  it('saves a crease pattern opened from an Oriedita file as .osf once it has fold sequences', async () => {
    await state().openProject(
      createFileService({
        text: '{"@version":"v1.1","title":"native ori","lineSegments":[]}',
        name: 'native.ori',
        path: '/tmp/native.ori',
      })
    );
    foldTwo();
    const fileService = createFileService();

    await state().saveProject(fileService);

    expect(oristudioCpMocks.exportOristudioCpDocumentAsOri).not.toHaveBeenCalled();
    const { options, file } = writtenFile(fileService);
    // Never over the `.ori`, which has nowhere to put a sequence: a native target is asked for.
    expect(options).toMatchObject({ extensions: ['osf'], path: null });
    expect(file.workspace.foldSequences?.[0].steps).toHaveLength(2);
  });

  it('leaves the project unsaved when the sequences change while the save dialog is up, and not when the reader moves', async () => {
    const { a } = foldTwo();
    const fileService = createFileService();
    fileService.saveTextFile.mockImplementationOnce(async (options: SaveTextFileOptions) => {
      state().moveFoldCursor(null);
      return { name: options.suggestedName, path: `/tmp/${options.suggestedName}` };
    });
    await state().saveProjectAs(fileService);
    expect(state().dirty).toBe(false);

    fileService.saveTextFile.mockImplementationOnce(async (options: SaveTextFileOptions) => {
      state().commitFoldStep({ parent: a, op: valleyAt(0.75) });
      return { name: options.suggestedName, path: `/tmp/${options.suggestedName}` };
    });
    await state().saveProjectAs(fileService);
    expect(writtenFile(fileService).file.workspace.foldSequences?.[0].steps).toHaveLength(2);
    expect(state().dirty).toBe(true);
  });

  it('writes a newer build’s sequence back as it came', async () => {
    // Newer than this build writes, whatever that is now.
    const raw = { ...writtenSequence(), formatVersion: FOLD_SEQUENCE_FORMAT_VERSION + 1, hologram: true };
    useWorkspaceStore.setState({ ...singleDesignTab('treemaker') });
    state().installFoldSequences(readFoldSequences([raw]), null);

    expect(state().commitFoldStep({ parent: null, op: valleyAt(0.5) })).toBeNull();
    const fileService = createFileService();
    await state().saveProjectAs(fileService);
    expect(writtenFile(fileService).file.workspace.foldSequences).toEqual([raw]);
  });
});

/**
 * Edit's display and Apply of a chosen layer order (`implementation-plans/layer-order-dialog.md`,
 * row H3), with the kernel, the host engine and the dialog's answer stood in
 * for: Apply is a new fold of the analysed segments, digest checked, one undo
 * entry; an undo shows the order before, whatever re-renders it; a copy keeps
 * the record; a reopened figure is folded again only on a press; and with no
 * record, every path makes exactly the kernel calls it always made.
 */
describe('a chosen layer order on an Edit folded figure (H3)', () => {
  const state = () => useWorkspaceStore.getState();
  const figureNow = () => state().oristudioCpFoldedFigures[0]!;
  // Identity `t` with English plurals, as the catalog tests use.
  const t = ((_key: string, fallback: string | Record<string, unknown>, options?: Record<string, unknown>) => {
    const values = typeof fallback === 'string' ? options : fallback;
    const text =
      typeof fallback === 'string'
        ? fallback
        : String((values?.count === 1 ? values.defaultValue_one : values?.defaultValue_other) ?? '');
    return text.replace(/\{\{(\w+)\}\}/gu, (_match, name: string) => String(values?.[name] ?? ''));
  }) as unknown as TFunction;

  const MODEL = foldedFigureSnapshot().model;
  /** The whole chosen order, as the dialog hands it over: `[upper, lower, …]`. */
  const RELATIONS = Uint32Array.of(0, 1, 2, 1);
  /** The picture the constrained fold draws: not the one the figure had. */
  const CONSTRAINED_PICTURE: OristudioCpFoldedRenderSnapshot = { ...foldedRenderSnapshot(), pass: 'constrained' };

  function held(record = twoConstraintRecord()) {
    const made = foldedFigureLayerOrder(record);
    if (!made.ok) throw new Error('the fixture record encodes');
    return made.layerOrder;
  }

  function applied(record = twoConstraintRecord()): LayerOrderApplied {
    return { record, relations: RELATIONS, source: layerOrderSourceOf(layerOrderKernelSource(), MODEL) };
  }

  const solvedSnapshot = (overrides: Partial<OristudioCpFoldedFigureSnapshot> = {}): OristudioCpFoldedFigureSnapshot => ({
    ...foldedFigureSnapshot(),
    outcome: 'Solved',
    ...overrides,
  });

  /** A flat figure folded from the X, on handle 3 unless `handle` says otherwise; the store holds only it. */
  function seedFigure(overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry {
    resetStores(seedSnapshot());
    const figure: OristudioCpFoldedFigureEntry = {
      id: 'generated-1',
      title: 'Folded model 1',
      handle: 3,
      sourceKind: 'generated-from-current-cp',
      sourceCpRevision: 0,
      startingFaceId: 1,
      displayStyle: 'Paper5',
      status: 'ready',
      placement: IDENTITY_FOLDED_PLACEMENT,
      snapshot: solvedSnapshot(),
      renderSnapshot: foldedRenderSnapshot(),
      sourceBounds: foldedSourceBounds(LAYER_ORDER_LINES),
      // No fingerprint: never stale against the document below.
      sourceFingerprint: null,
      sourceLineIds: [1, 2],
      error: null,
      ...overrides,
    };
    if (figure.handle !== null) retainFoldedFigureHandle(figure.handle);
    useWorkspaceStore.setState({
      activePanelId: 'crease-pattern',
      oristudioCpDocument: editableCpState(LAYER_ORDER_LINES),
      oristudioCpFoldedFigures: [figure],
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      dirty: false,
    });
    return figure;
  }

  /** Apply as the verb runs it: one entry through the folded layer's bracket, its press made just now. */
  const applyAsEntry = (id: string, answer: LayerOrderApplied) =>
    applyFoldedFigureLayerOrder(id, answer, markFoldPress(useWorkspaceStore.getState()), t);

  /** `folded figure rehydrated`, as sent since the last reset. */
  const rehydratedEvents = () =>
    analyticsMocks.track.mock.calls.filter(([name]) => name === 'folded figure rehydrated').map(([, properties]) => properties);

  /** Every call made to the CP kernel since the last reset, in the order made. */
  function kernelCalls(): string[] {
    return Object.entries(oristudioCpMocks)
      .flatMap(([name, mock]) => mock.mock.invocationCallOrder.map((order) => [order, name] as const))
      .sort(([a], [b]) => a - b)
      .map(([, name]) => name);
  }

  function clearKernelCalls(): void {
    for (const mock of Object.values(oristudioCpMocks)) mock.mockClear();
    hostEngineMocks.resolveLayerOrder.mockClear();
  }

  describe('Apply', () => {
    it('folds the analysed segments again with the chosen order, checks its faces, and lands as one entry', async () => {
      const figure = seedFigure();
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce(CONSTRAINED_PICTURE);

      await expect(applyAsEntry(figure.id, applied())).resolves.toBe(true);

      // Exactly the segments the dialog analysed, never reselected from the document.
      expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(
        layerOrderKernelSource(),
        RELATIONS,
        MODEL,
        A_RUN_ID
      );
      expect(oristudioCpMocks.getOristudioCpFoldedFigureDigest).toHaveBeenCalledWith(9);
      expect(figureNow()).toMatchObject({
        handle: 9,
        status: 'ready',
        snapshot: { shown_order: 'given' },
        renderSnapshot: CONSTRAINED_PICTURE,
        layerOrder: held(),
        // Same creases, same placement: only the order changed.
        sourceBounds: figure.sourceBounds,
        placement: figure.placement,
      });
      expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Set layer order']);
      expect(state().dirty).toBe(true);
      // The old fold stays with history, for an undo to show: held by the entry alone.
      expect(oristudioCpMocks.freeOristudioCpFoldedFigure).not.toHaveBeenCalledWith(3);
      expect(foldedFigureHandleRefCount(3)).toBe(1);
      expect(foldedFigureHandleRefCount(9)).toBe(1);
    });

    it('undoes to the order before, which a restyle then draws from the old fold; redo brings the chosen one back', async () => {
      const figure = seedFigure();
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce(CONSTRAINED_PICTURE);
      await applyAsEntry(figure.id, applied());

      await state().undo();
      await flushMicrotasks();
      expect(figureNow()).toMatchObject({ handle: 3, renderSnapshot: figure.renderSnapshot });
      expect(figureNow().layerOrder).toBeUndefined();
      // Each fold keeps one holder: the undone one the live list, the chosen one redo.
      expect(oristudioCpMocks.freeOristudioCpFoldedFigure).not.toHaveBeenCalled();
      expect([foldedFigureHandleRefCount(3), foldedFigureHandleRefCount(9)]).toEqual([1, 1]);

      // A re-render after the undo asks the old fold, so the undone order stays undone.
      clearKernelCalls();
      await state().setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Transparent3');
      const rendered = () =>
        oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mock.calls.map(([handle]) => handle as number);
      expect(rendered()).toEqual([3]);

      await state().redo();
      await flushMicrotasks();
      // (The redo's model reconcile re-renders through 9, which the stand-in draws plainly.)
      expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held() });
      expect([foldedFigureHandleRefCount(3), foldedFigureHandleRefCount(9)]).toEqual([1, 1]);
      clearKernelCalls();
      await state().setOristudioCpFoldedFigureDisplayStyle(figure.id, 'Paper5');
      expect(rendered()).toEqual([9]);
    });

    it('carries the record to a duplicate, which saves it under its own id', async () => {
      const figure = seedFigure();
      await applyAsEntry(figure.id, applied());
      oristudioCpMocks.duplicateOristudioCpFoldedFigure.mockResolvedValueOnce({
        handle: 12,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
      });

      await expect(state().duplicateOristudioCpFoldedFigure(figure.id)).resolves.toBe(true);

      // The kernel clones the session with its given order: the copy draws it too.
      expect(oristudioCpMocks.duplicateOristudioCpFoldedFigure).toHaveBeenCalledWith(9);
      const [original, copy] = state().oristudioCpFoldedFigures;
      expect(copy).toMatchObject({ handle: 12, layerOrder: held() });
      const bag = withFoldedFigureLayerOrders({}, state().oristudioCpFoldedFigures) as Record<
        string,
        { figures: Record<string, { record: string }> }
      >;
      const saved = bag[FOLDED_FIGURE_LAYER_ORDERS_KEY]!.figures;
      expect(Object.keys(saved).sort()).toEqual([original!.id, copy!.id].sort());
      expect(saved[copy!.id]!.record).toBe(saved[original!.id]!.record);
    });

    it('refuses a fold whose faces are not the ones the dialog analysed: the digest, on the new fold', async () => {
      const figure = seedFigure();
      oristudioCpMocks.getOristudioCpFoldedFigureDigest.mockResolvedValueOnce('ffffffffffffffff');

      await expect(applyAsEntry(figure.id, applied())).resolves.toBe(false);

      expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(9);
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      expect(state().oristudioCpError).toBe(
        'Layer order couldn’t apply this order to Folded model 1. Its picture is unchanged.'
      );
    });

    it('leaves the figure as it was when the kernel refuses the order, and when a Stop ends the fold', async () => {
      const figure = seedFigure();
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'refused',
        refusal: { code: 'digest_mismatch', expected: LAYER_ORDER_DIGEST, actual: 'ffffffffffffffff' },
      });
      await expect(applyAsEntry(figure.id, applied())).resolves.toBe(false);
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);

      useWorkspaceStore.setState({ oristudioCpError: null, error: null });
      oristudioCpMocks.foldOristudioCpWithOrder.mockRejectedValueOnce({ code: 'fold_cancelled', message: 'stopped' });
      await expect(applyAsEntry(figure.id, applied())).resolves.toBe(false);
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      // Stopped is not failed: nothing to report.
      expect(state().oristudioCpError).toBeNull();
    });

    it('writes nothing for the record the figure already shows (D16)', async () => {
      const figure = seedFigure({ snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held() });

      await expect(applyAsEntry(figure.id, applied())).resolves.toBe(false);

      expect(kernelCalls()).toEqual([]);
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);
    });

    it.each(['a Delete', 'an undo'] as const)(
      'lands on nothing after %s took the figure while it folded: its fold goes, the old one stays with history',
      async (meanwhile) => {
        const figure = seedFigure();
        if (meanwhile === 'an undo') await setFoldedFigurePlacementAsEntry(figure.id, { rotation: 1 }, 'Rotate folded form');
        clearKernelCalls();
        let answer: (() => void) | null = null;
        oristudioCpMocks.foldOristudioCpWithOrder.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              answer = () => resolve({ status: 'folded', handle: 9, snapshot: solvedSnapshot({ shown_order: 'given' }) });
            })
        );

        const applying = applyAsEntry(figure.id, applied());
        await vi.waitFor(() => expect(answer).not.toBeNull());
        if (meanwhile === 'a Delete') {
          await deleteFoldedFigure(figure.id, t);
        } else {
          endOpenCanvasSessions('history');
          await state().undo();
        }
        answer!();

        await expect(applying).resolves.toBe(false);
        expect(oristudioCpMocks.freeOristudioCpFoldedFigure.mock.calls).toEqual([[9]]);
        expect(foldedFigureHandleRefCount(9)).toBe(0);
        // With the Delete's entry; or with the figure the undo put back, and the redo.
        expect(foldedFigureHandleRefCount(3)).toBe(meanwhile === 'a Delete' ? 1 : 2);
        expect(state().oristudioCpFoldedFigures.some((each) => each.layerOrder)).toBe(false);
      }
    );
  });

  describe('Layer order… (the verb)', () => {
    it('opens the dialog on the figure’s own fold, with Edit’s look, and writes nothing unless it applies', async () => {
      const scene = { schema_version: 3, flipped: false, sheet: 1, faces: [], subfaces: [], aux_lines: [], sheet_points: [] };
      for (const kind of ['unchanged', 'cancelled', 'busy', 'unavailable'] as const) {
        const figure = seedFigure({
          displayStyle: 'Transparent3',
          placement: { ...IDENTITY_FOLDED_PLACEMENT, rotation: Math.PI / 2 },
          appearance: { 'paper.front': '#ff0000' },
        });
        // The canvas turned an eighth more: the figure shows turned by both. Its creases in Edit's pen.
        useWorkspaceStore.setState({
          oristudioCpCamera: { centerX: 0, centerY: 0, zoom: 1, rotation: Math.PI / 4 },
          oristudioCpViewport: { ...state().oristudioCpViewport, lineStyle: 'black-two-dot', lineWidth: 2 },
        });
        oristudioCpMocks.getOristudioCpFoldedFigurePaperScene.mockResolvedValueOnce(scene);
        dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind });

        await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe(kind);

        expect(oristudioCpMocks.getOristudioCpFoldedFigureSource).toHaveBeenCalledWith(3);
        const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
        expect(request).toEqual({
          surface: 'edit_figure',
          source: layerOrderSourceOf(layerOrderKernelSource(), MODEL),
          record: null,
          look: {
            style: expect.objectContaining({ paper: expect.objectContaining({ front: '#ff0000' }) }),
            policy: expect.objectContaining({ surface: 'folded-flat' }),
            turnDeg: 135,
            side: 'front',
            xray: true,
            lineStyle: 'black-two-dot',
            lineWidth: 2,
          },
          shown: scene,
          name: 'Folded model 1',
          // The sheet it was folded from, which the crease-pattern pane shows alone: the unit square, no aux lines.
          region: {
            paper: [
              [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 },
                { x: 0, y: 1 },
              ],
            ],
            auxSegments: [],
          },
        });
        expect(oristudioCpMocks.foldOristudioCpWithOrder, kind).not.toHaveBeenCalled();
        expect(figureNow(), kind).toMatchObject({ handle: 3, renderSnapshot: figure.renderSnapshot });
        expect(figureNow().layerOrder, kind).toBeUndefined();
        expect(state().oristudioCpHistoryPast, kind).toEqual([]);
      }
    });

    it('opens on the back when the figure shows its back', async () => {
      const figure = seedFigure({ snapshot: solvedSnapshot({ model: { ...MODEL, state: 'Back1' } }) });

      await openFoldedFigureLayerOrder(figure.id, t);

      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request.look).toMatchObject({ side: 'back', lineStyle: 'color', lineWidth: 1 });
    });

    it('commits an Apply as one “Set layer order” entry', async () => {
      const figure = seedFigure({ layerOrder: held(twoConstraintRecord({ constraints: [[0, 1, 1]] })) });
      dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied() });

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('applied');

      // The record goes in as the dialog takes it (Edit's frame is the crease pattern's own).
      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request.record).toEqual(twoConstraintRecord({ constraints: [[0, 1, 1]] }));
      expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held() });
      expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Set layer order']);
    });

    it('turns the figure as the dialog’s Rotate left it, in the Apply’s one entry, and an undo turns it back', async () => {
      const figure = seedFigure({ layerOrder: held(twoConstraintRecord({ constraints: [[0, 1, 1]] })) });
      // The canvas turned an eighth: the dialog's 90° is the figure's own 45°.
      useWorkspaceStore.setState({ oristudioCpCamera: { centerX: 0, centerY: 0, zoom: 1, rotation: Math.PI / 4 } });
      dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied(), turnDeg: 90 });

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('applied');

      expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held() });
      expect(figureNow().placement.rotation).toBeCloseTo(Math.PI / 4, 12);
      expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Set layer order']);
      endOpenCanvasSessions('history');
      await state().undo();
      expect(figureNow()).toMatchObject({ handle: 3, placement: figure.placement });
    });

    it('an Apply that only turned the figure is its own “Rotate folded form” entry, and writes no order', async () => {
      const figure = seedFigure();
      dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'unchanged', turnDeg: 345 });

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('unchanged');

      expect(oristudioCpMocks.foldOristudioCpWithOrder).not.toHaveBeenCalled();
      expect(figureNow()).toMatchObject({ handle: 3 });
      expect(figureNow().layerOrder).toBeUndefined();
      expect(figureNow().placement.rotation).toBeCloseTo(-Math.PI / 12, 12);
      expect(state().oristudioCpHistoryPast.map((entry) => entry.label)).toEqual(['Rotate folded form']);
      endOpenCanvasSessions('history');
      await state().undo();
      expect(figureNow().placement).toEqual(figure.placement);
    });

    it('opens on the order the figure shows when an undo left its kernel on another, on a fold of its own', async () => {
      // Another solution, then Undo: the entry is back on solution 1, the handle still on 2.
      const figure = seedFigure({ snapshot: solvedSnapshot({ discovered_fold_cases: 2, current_fold_case: 1 }) });
      oristudioCpMocks.getOristudioCpFoldedFigureSnapshot.mockResolvedValueOnce(
        solvedSnapshot({ discovered_fold_cases: 2, current_fold_case: 2 })
      );
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'folded',
        handle: 15,
        snapshot: solvedSnapshot({ discovered_fold_cases: 1, current_fold_case: 1 }),
      });
      const first = { schema_version: 3, flipped: false, sheet: 1, faces: [], subfaces: [], aux_lines: [], sheet_points: [] };
      oristudioCpMocks.getOristudioCpFoldedFigurePaperScene.mockImplementation(async (handle: number) =>
        handle === 15 ? first : null
      );

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('cancelled');

      // Oriedita's own search (no order given) on the figure's own segments, at its case.
      expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(
        layerOrderKernelSource(),
        new Uint32Array(),
        MODEL,
        A_RUN_ID
      );
      expect(oristudioCpMocks.foldOristudioCpFigureToCase).not.toHaveBeenCalled();
      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request.shown).toBe(first);
      // That fold goes once the dialog closes; the figure and its handle are as they were.
      expect(oristudioCpMocks.freeOristudioCpFoldedFigure.mock.calls).toEqual([[15]]);
      expect(figureNow()).toBe(figure);
      expect(foldedFigureHandleRefCount(3)).toBe(1);
      expect(state().oristudioCpHistoryPast).toEqual([]);
    });

    it('lets its own fold go when the dialog closes, but not across a document replaced while it was open', async () => {
      const figure = seedFigure({ snapshot: solvedSnapshot({ discovered_fold_cases: 2, current_fold_case: 1 }) });
      oristudioCpMocks.getOristudioCpFoldedFigureSnapshot.mockResolvedValueOnce(
        solvedSnapshot({ discovered_fold_cases: 2, current_fold_case: 2 })
      );
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'folded',
        handle: 15,
        snapshot: solvedSnapshot({ discovered_fold_cases: 1, current_fold_case: 1 }),
      });
      dialogGatewayMocks.openLayerOrderDialog.mockImplementationOnce(async () => {
        // Another document opens while the dialog is: every fold goes, and its
        // first fold is given the slot the dialog's fold had.
        await resetFoldedFigureHandles();
        retainFoldedFigureHandle(15);
        return { kind: 'cancelled' };
      });

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('cancelled');

      // Freed once, by the replace; the new document's fold in that slot stays.
      expect(oristudioCpMocks.freeOristudioCpFoldedFigure.mock.calls.filter(([handle]) => handle === 15)).toHaveLength(1);
      expect(foldedFigureHandleRefCount(15)).toBe(1);
    });

    it('opens a constrained figure whose kernel shows another order on the source alone, to restore its record', async () => {
      const figure = seedFigure({ layerOrder: held() });
      oristudioCpMocks.getOristudioCpFoldedFigureSnapshot.mockResolvedValueOnce(solvedSnapshot({ current_fold_case: 2 }));

      await openFoldedFigureLayerOrder(figure.id, t);

      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request).toMatchObject({ record: twoConstraintRecord() });
      expect(request).not.toHaveProperty('shown');
      expect(oristudioCpMocks.foldOristudioCpWithOrder).not.toHaveBeenCalled();
    });

    it('opens nothing on a figure it is held on', async () => {
      const figure = seedFigure({ layerOrder: { kind: 'newer', saved: { figureKey: 'fk9:x', record: '{"v":2}' } } });
      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('not-opened');
      expect(dialogGatewayMocks.openLayerOrderDialog).not.toHaveBeenCalled();
      expect(kernelCalls()).toEqual([]);
    });
  });

  describe('a figure reopened from a file', () => {
    const restored = (record = twoConstraintRecord()): Extract<LayerOrderResolution, { outcome: 'applied' }> => ({
      outcome: 'applied',
      applied: { record, relations: RELATIONS, source: layerOrderSourceOf(layerOrderKernelSource(), MODEL) },
      found: {
        saved_constraints: record.constraints.map(() => ({ status: 'intact' as const })),
        carried: [],
        opened_on: { kind: 'held', ignored: 0 },
      },
      record,
      attention: null,
    });

    it('is folded again with its record only on the press, through the host engine, and keeps that fold', async () => {
      const figure = seedFigure({ handle: null, snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held() });
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(restored());
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'folded',
        handle: 11,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
      });

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('cancelled');

      expect(oristudioCpMocks.getOristudioCpSelectionFoldSource).toHaveBeenCalledWith([1, 2], 1);
      expect(hostEngineMocks.resolveLayerOrder).toHaveBeenCalledWith(
        layerOrderSourceOf(layerOrderKernelSource(), MODEL),
        twoConstraintRecord(),
        undefined,
        { signal: expect.any(AbortSignal) }
      );
      expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(
        layerOrderKernelSource(),
        RELATIONS,
        MODEL,
        A_RUN_ID
      );
      // The same picture, now live; nothing about the document changed.
      expect(figureNow()).toMatchObject({ handle: 11, status: 'ready', renderSnapshot: figure.renderSnapshot, layerOrder: held() });
      expect(foldedFigureHandleRefCount(11)).toBe(1);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      expect(state().dirty).toBe(false);
      expect(rehydratedEvents()).toEqual([{ trigger: 'press', outcome: 'adopted', mode: 'flat' }]);
      // The dialog opened on that fold, with the record: the source the fold folded, its picture read first.
      expect(oristudioCpMocks.getOristudioCpFoldedFigurePaperScene).toHaveBeenCalledWith(11);
      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request.record).toEqual(twoConstraintRecord());
      expect(request.source).toEqual(layerOrderSourceOf(layerOrderKernelSource(), MODEL));

      // Live now, so a copy can be made, and it keeps the order.
      oristudioCpMocks.duplicateOristudioCpFoldedFigure.mockResolvedValueOnce({
        handle: 13,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
      });
      await expect(state().duplicateOristudioCpFoldedFigure(figure.id)).resolves.toBe(true);
      expect(state().oristudioCpFoldedFigures[1]).toMatchObject({ handle: 13, layerOrder: held() });
    });

    it('still opens, on its source and record, when the record does not fold back to the order it shows', async () => {
      // The approved Refusals board: the dialog restores the record itself and says why in its own frames.
      const figure = seedFigure({ handle: null, snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held() });
      const error = vi.spyOn(toast, 'error').mockImplementation(() => 1);
      const fallsShort: LayerOrderResolution[] = [
        { ...restored(), found: { ...restored().found, opened_on: { kind: 'closest', moved: 2, ignored: 0 } } },
        {
          outcome: 'clash',
          clashing: [0],
          found: restored().found,
          record: twoConstraintRecord(),
          attention: { reason: 'conflict', count: 1 },
        },
        { outcome: 'timed_out', limit: 'deadline', nodes: 9, found: null, record: twoConstraintRecord(), attention: { reason: 'timeout', count: 2 } },
        { outcome: 'lost', cause: 'crashed', record: twoConstraintRecord(), attention: { reason: 'timeout', count: 2 } },
      ];
      try {
        for (const resolution of fallsShort) {
          hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(resolution);
          dialogGatewayMocks.openLayerOrderDialog.mockClear();
          analyticsMocks.track.mockClear();
          await expect(openFoldedFigureLayerOrder(figure.id, t), resolution.outcome).resolves.toBe('cancelled');
          const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
          expect(request.source, resolution.outcome).toEqual(layerOrderSourceOf(layerOrderKernelSource(), MODEL));
          expect(request.record, resolution.outcome).toEqual(twoConstraintRecord());
          expect(request, resolution.outcome).not.toHaveProperty('shown');
          expect(rehydratedEvents(), resolution.outcome).toEqual([{ trigger: 'press', outcome: 'refused', mode: 'flat' }]);
        }
        expect(error).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
      }
      expect(oristudioCpMocks.foldOristudioCpWithOrder).not.toHaveBeenCalled();
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);
    });

    it('says only that the engine didn’t load, as the dialog would, when it couldn’t load at all', async () => {
      const figure = seedFigure({ handle: null, snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held() });
      const error = vi.spyOn(toast, 'error').mockImplementation(() => 1);
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce({
        outcome: 'lost',
        cause: 'unavailable',
        record: twoConstraintRecord(),
        attention: { reason: 'timeout', count: 2 },
      });
      try {
        await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('not-opened');
        // With the reload that alone retries a load that failed (`layerOrderReloadAction`).
        expect(error).toHaveBeenCalledWith('Layer order didn’t load. Reload Ori Studio to try again.', {
          action: { label: 'Reload', onClick: expect.any(Function) },
        });
      } finally {
        error.mockRestore();
      }
      expect(dialogGatewayMocks.openLayerOrderDialog).not.toHaveBeenCalled();
      expect(figureNow()).toBe(figure);
    });

    it('lets go of a fold it could not read once, through the count, and says refused once', async () => {
      const figure = seedFigure({ handle: null, snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held() });
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(restored());
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'folded',
        handle: 11,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
      });
      oristudioCpMocks.getOristudioCpFoldedFigurePaperScene.mockRejectedValueOnce(new Error('the scene failed'));

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('cancelled');
      await resetFoldedFigureHandles();

      // Never the figure's: freed once, on the count, and not again when the document goes.
      expect(oristudioCpMocks.freeOristudioCpFoldedFigure.mock.calls).toEqual([[11]]);
      expect(rehydratedEvents()).toEqual([{ trigger: 'press', outcome: 'refused', mode: 'flat' }]);
      expect(figureNow()).toBe(figure);
      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request).not.toHaveProperty('shown');
    });

    it('puts back a figure deleted while the press folds as it was before the press, never waiting', async () => {
      const figure = seedFigure({ handle: null, snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held() });
      let answer: (resolution: LayerOrderResolution) => void = () => {};
      hostEngineMocks.resolveLayerOrder.mockReturnValueOnce(
        new Promise<LayerOrderResolution>((resolve) => {
          answer = resolve;
        })
      );
      const press = openFoldedFigureLayerOrder(figure.id, t);
      await vi.waitFor(() => expect(figureNow()?.status).toBe('loading'));

      await deleteFoldedFigure(figure.id, t);
      answer(restored());
      await expect(press).resolves.toBe('not-opened');
      expect(state().oristudioCpFoldedFigures).toEqual([]);

      await state().undo();
      expect(figureNow()).toBe(figure);
      expect(figureNow().status).toBe('ready');
    });

    it('with no record, opens on a fold of its own, stepped to the case it shows, which goes once the dialog closes', async () => {
      const figure = seedFigure({
        handle: null,
        snapshot: solvedSnapshot({ discovered_fold_cases: 2, current_fold_case: 2, find_another_overlap_valid: true }),
      });
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'folded',
        handle: 14,
        snapshot: solvedSnapshot({ discovered_fold_cases: 1, current_fold_case: 1, find_another_overlap_valid: true }),
      });
      oristudioCpMocks.foldOristudioCpFigureToCase.mockResolvedValueOnce({
        snapshot: solvedSnapshot({ discovered_fold_cases: 2, current_fold_case: 2, find_another_overlap_valid: true }),
        discovered_case_numbers: [1, 2],
      });

      await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('cancelled');

      expect(kernelCalls()).toEqual([
        'getOristudioCpSelectionFoldSource',
        'foldOristudioCpWithOrder',
        'foldOristudioCpFigureToCase',
        'getOristudioCpFoldedFigurePaperScene',
        'freeOristudioCpFoldedFigure',
      ]);
      // Oriedita's own search (no order given) on the figure's creases, stepped to its case.
      expect(oristudioCpMocks.getOristudioCpSelectionFoldSource).toHaveBeenCalledWith([1, 2], 1);
      expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(
        layerOrderKernelSource(),
        new Uint32Array(),
        MODEL,
        A_RUN_ID
      );
      expect(oristudioCpMocks.foldOristudioCpFigureToCase).toHaveBeenCalledWith(14, 2, 'Order5', A_RUN_ID);
      expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(14);
      expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
      // The figure itself stays as it was reopened.
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);
    });
  });

  it('refuses to refold a figure with a newer build’s layer order, called directly, with the toolbar’s reason', async () => {
    const figure = seedFigure({ layerOrder: { kind: 'newer', saved: { figureKey: 'fk9:x', record: '{"v":2}' } } });
    clearKernelCalls();

    await expect(state().refoldOristudioCpFoldedFigure(figure.id)).resolves.toBe(false);

    expect(kernelCalls()).toEqual([]);
    expect(figureNow()).toBe(figure);
    expect(state().oristudioCpError).toBe('Made with a newer Ori Studio: its layer constraints can’t be changed here.');
  });

  describe('refold with its layer order, staleness, 3D and attention (H4)', () => {
    /** The host engine's answer that drew `record`'s order, with what it left out (`attention`). */
    function restoredAs(record = twoConstraintRecord(), attention: LayerOrderAttention | null = null): LayerOrderResolution {
      return {
        outcome: 'applied',
        applied: { record, relations: RELATIONS, source: layerOrderSourceOf(layerOrderKernelSource(), MODEL) },
        found: {
          saved_constraints: record.constraints.map(() => ({ status: 'intact' as const })),
          carried: [],
          opened_on: { kind: 'closest', moved: 1, ignored: 0 },
        },
        record: attention ? { ...record, attention } : record,
        attention,
      };
    }

    /** The host engine's answer that drew nothing (D10): the record asked about, flagged. */
    function notDrawn(outcome: 'clash' | 'timed_out' | 'refused', attention: LayerOrderAttention): LayerOrderResolution {
      const record = twoConstraintRecord({ attention });
      const found = {
        saved_constraints: [{ status: 'clashing' as const }, { status: 'clashing' as const }],
        carried: [],
        opened_on: { kind: 'closest' as const, moved: 0, ignored: 0 },
      };
      switch (outcome) {
        case 'clash':
          return { outcome, clashing: [0, 1], found, record, attention };
        case 'timed_out':
          return { outcome, limit: 'deadline', nodes: 9, found: null, record, attention };
        case 'refused':
          return { outcome, refusal: { code: 'source_non_convex_face', face: 1 }, record, attention };
      }
    }

    /** A flat figure that shows the order its record was given with. */
    const constrained = (overrides: Partial<OristudioCpFoldedFigureEntry> = {}) =>
      seedFigure({ snapshot: solvedSnapshot({ shown_order: 'given' }), layerOrder: held(), ...overrides });

    /** Refold as the toolbar runs it: one entry through the folded layer's bracket; what it said, kept. */
    async function refoldAsEntry(id: string) {
      const said: FoldedFigureLayerOrderRefold[] = [];
      const done = await foldedFigureGesture.run('verb', 'Refold folded model', () =>
        state().refoldOristudioCpFoldedFigure(id, { onLayerOrder: (outcome) => said.push(outcome) })
      );
      return { done, said };
    }

    const labels = () => state().oristudioCpHistoryPast.map((entry) => entry.label);
    /** `layer constraints need attention`, as sent since the last reset. */
    const attentionEvents = () =>
      analyticsMocks.track.mock.calls
        .filter(([name]) => name === 'layer constraints need attention')
        .map(([, properties]) => properties);

    /** The creases with a fold angle on one: they fold in 3D now. */
    const creasesIn3d = () =>
      editableCpState([
        LAYER_ORDER_LINES[0]!,
        { ...LAYER_ORDER_LINES[1]!, fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE },
      ]);

    beforeEach(() => analyticsMocks.track.mockClear());

    it('restores its record onto the creases as they are now, folds them in the order that fits, and lands as one entry', async () => {
      const figure = constrained({ sourceFingerprint: 'cs1:before' });
      const shown = twoConstraintRecord({ order: [[2, 0, -1]] });
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(restoredAs(shown));
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce(CONSTRAINED_PICTURE);
      clearKernelCalls();

      const { done, said } = await refoldAsEntry(figure.id);

      expect(done).toBe(true);
      // Its creases read without folding, the record restored on them, then one fold in the order that fits.
      expect(kernelCalls()).toEqual([
        'getOristudioCpSelectionFoldSource',
        'foldOristudioCpWithOrder',
        'getOristudioCpFoldedFigureDigest',
        'getOristudioCpFoldedFigureRenderSnapshot',
      ]);
      expect(oristudioCpMocks.getOristudioCpSelectionFoldSource).toHaveBeenCalledWith([1, 2], 1);
      expect(hostEngineMocks.resolveLayerOrder).toHaveBeenCalledWith(
        layerOrderSourceOf(layerOrderKernelSource(), MODEL),
        twoConstraintRecord(),
        undefined,
        { signal: expect.any(AbortSignal) }
      );
      expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(layerOrderKernelSource(), RELATIONS, MODEL, A_RUN_ID);
      expect(figureNow()).toMatchObject({
        handle: 9,
        status: 'ready',
        snapshot: { shown_order: 'given' },
        renderSnapshot: CONSTRAINED_PICTURE,
        layerOrder: held(shown),
      });
      // Re-baselined on the creases it folded, as any refold.
      expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figure)).toBe(true);
      expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figureNow())).toBe(false);
      expect(labels()).toEqual(['Refold folded model']);
      expect(said).toEqual([{ kind: 'applied', attention: null }]);
      expect(attentionEvents()).toEqual([]);
      expect(dialogGatewayMocks.openLayerOrderDialog).not.toHaveBeenCalled();

      // The old fold stays with history: an undo shows the order before, with its record.
      await state().undo();
      await flushMicrotasks();
      expect(figureNow()).toMatchObject({ handle: 3, layerOrder: held() });
    });

    it('draws the rest when some constraints are left out, and flags them: the event once, as the summary changes', async () => {
      const figure = constrained();
      const left = { reason: 'unresolved', count: 1 } as const;
      hostEngineMocks.resolveLayerOrder.mockResolvedValue(restoredAs(twoConstraintRecord(), left));

      const first = await refoldAsEntry(figure.id);
      expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held(twoConstraintRecord({ attention: left })) });
      expect(first.said).toEqual([{ kind: 'applied', attention: left }]);
      expect(attentionEvents()).toEqual([{ surface: 'edit_figure', broken_count_bucket: '<=1' }]);

      // Refolded again, flagged as it was: drawn again, with nothing new to count.
      oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
        status: 'folded',
        handle: 10,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
      });
      await refoldAsEntry(figure.id);
      expect(figureNow().handle).toBe(10);
      expect(attentionEvents()).toHaveLength(1);
    });

    it.each([
      ['clash', { reason: 'conflict', count: 2 }],
      ['timed_out', { reason: 'timeout', count: 2 }],
      ['refused', { reason: 'unresolved', count: 2 }],
    ] as const)('keeps its picture on %s and flags its record, applying nothing (D10)', async (outcome, attention) => {
      const figure = constrained();
      hostEngineMocks.resolveLayerOrder.mockResolvedValue(notDrawn(outcome, attention));
      clearKernelCalls();

      const { done, said } = await refoldAsEntry(figure.id);

      expect(done).toBe(false);
      expect(kernelCalls()).toEqual(['getOristudioCpSelectionFoldSource']);
      // Its picture, its fold and its creases' baseline: all as they were; only the record says why.
      expect(figureNow()).toEqual({ ...figure, layerOrder: held(twoConstraintRecord({ attention })) });
      expect(labels()).toEqual(['Refold folded model']);
      expect(state().dirty).toBe(true);
      expect(said).toEqual([{ kind: 'kept', outcome, attention }]);
      expect(attentionEvents()).toEqual([{ surface: 'edit_figure', broken_count_bucket: '<=2' }]);
      // The dialog never opens by itself (D14).
      expect(dialogGatewayMocks.openLayerOrderDialog).not.toHaveBeenCalled();

      await state().undo();
      await flushMicrotasks();
      expect(figureNow().layerOrder).toEqual(held());
      await state().redo();
      await flushMicrotasks();

      // Again on the flagged figure: nothing new to keep, so no entry and no event.
      const flagged = figureNow();
      const entries = state().oristudioCpHistoryPast.length;
      await refoldAsEntry(figure.id);
      expect(figureNow()).toBe(flagged);
      expect(state().oristudioCpHistoryPast).toHaveLength(entries);
      expect(attentionEvents()).toHaveLength(1);
    });

    it('keeps its picture, flagged, when the kernel can’t draw the order rebuilt, and lets that fold go', async () => {
      const unresolved = { reason: 'unresolved', count: 2 } as const;
      for (const why of ['refused', 'digest'] as const) {
        const figure = constrained();
        hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(restoredAs());
        if (why === 'refused') {
          oristudioCpMocks.foldOristudioCpWithOrder.mockResolvedValueOnce({
            status: 'refused',
            refusal: { code: 'digest_mismatch', expected: LAYER_ORDER_DIGEST, actual: 'ffffffffffffffff' },
          });
        } else {
          oristudioCpMocks.getOristudioCpFoldedFigureDigest.mockResolvedValueOnce('ffffffffffffffff');
        }
        oristudioCpMocks.freeOristudioCpFoldedFigure.mockClear();

        const { said } = await refoldAsEntry(figure.id);

        expect(figureNow(), why).toEqual({ ...figure, layerOrder: held(twoConstraintRecord({ attention: unresolved })) });
        expect(said, why).toEqual([{ kind: 'kept', outcome: 'refused', attention: unresolved }]);
        expect(oristudioCpMocks.freeOristudioCpFoldedFigure.mock.calls, why).toEqual(why === 'digest' ? [[9]] : []);
      }
    });

    it.each(['load', 'crashed'] as const)('writes nothing when the engine isn’t there (%s), and says so', async (cause) => {
      const figure = constrained();
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce({
        outcome: 'lost',
        cause,
        record: twoConstraintRecord(),
        attention: { reason: 'timeout', count: 2 },
      });

      const { done, said } = await refoldAsEntry(figure.id);

      expect(done).toBe(false);
      expect(figureNow()).toBe(figure);
      expect(state().oristudioCpHistoryPast).toEqual([]);
      expect(state().dirty).toBe(false);
      expect(state().oristudioCpError).toBeNull();
      expect(said).toEqual([{ kind: 'lost', cause }]);
      expect(attentionEvents()).toEqual([]);
    });

    it('stops through the Refold’s own run: the host engine’s resolve gets its Stop, and the figure goes back quietly', async () => {
      const isolated = Object.getOwnPropertyDescriptor(globalThis, 'crossOriginIsolated');
      // A Stop reaches only a run the transport can stop: one with shared memory.
      Object.defineProperty(globalThis, 'crossOriginIsolated', { value: true, configurable: true });
      try {
        const figure = constrained();
        let signal: AbortSignal | undefined;
        hostEngineMocks.resolveLayerOrder.mockImplementationOnce(
          (_source: unknown, _record: unknown, _limits: unknown, options: { signal: AbortSignal }) =>
            new Promise((resolve) => {
              signal = options.signal;
              signal.addEventListener('abort', () => resolve({ outcome: 'cancelled' }));
            })
        );
        const refolding = refoldAsEntry(figure.id);
        await vi.waitFor(() => expect(signal).toBeDefined());
        expect(state().oristudioCpFoldRuns).not.toEqual({});

        expect(state().stopOristudioCpFolds()).toBe(true);
        const { done, said } = await refolding;

        expect(signal!.aborted).toBe(true);
        expect(done).toBe(false);
        expect(said).toEqual([]);
        expect(figureNow()).toBe(figure);
        expect(state().oristudioCpHistoryPast).toEqual([]);
        expect(state().oristudioCpError).toBeNull();
        expect(oristudioCpMocks.foldOristudioCpWithOrder).not.toHaveBeenCalled();
      } finally {
        if (isolated) Object.defineProperty(globalThis, 'crossOriginIsolated', isolated);
        else Reflect.deleteProperty(globalThis, 'crossOriginIsolated');
      }
    });

    it('with no record, refolds to 3D with exactly the kernel calls it always made, and adds none (parity guard)', async () => {
      const figure = seedFigure();
      useWorkspaceStore.setState({ oristudioCpDocument: creasesIn3d() });
      clearKernelCalls();

      await expect(state().refoldOristudioCpFoldedFigure(figure.id)).resolves.toBe(true);

      expect(kernelCalls()).toEqual(['fold3dOristudioCpDocument', 'freeOristudioCpFoldedFigure']);
      expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
      expect(figureNow().layerOrder).toBeUndefined();
      expect(attentionEvents()).toEqual([]);
    });

    it('keeps its record when its creases now fold in 3D, flagged as waiting, through a save and a reload (D13)', async () => {
      const figure = constrained();
      useWorkspaceStore.setState({ oristudioCpDocument: creasesIn3d() });
      clearKernelCalls();

      const { done, said } = await refoldAsEntry(figure.id);

      expect(done).toBe(true);
      // The 3D picture, from the 3D folder alone: no engine asked, no order drawn.
      expect(kernelCalls()).toEqual(['fold3dOristudioCpDocument']);
      expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
      const waiting = held(twoConstraintRecord({ attention: { reason: 'route-3d', count: 2 } }));
      expect(figureNow()).toMatchObject({ handle: 11, snapshot: null, sourceKind: 'generated-3d', layerOrder: waiting });
      expect(said).toEqual([]);
      expect(attentionEvents()).toEqual([{ surface: 'edit_figure', broken_count_bucket: '<=2' }]);

      // Saved and opened again: the record attaches to the 3D figure by its key.
      const nativeText = serializeNativeProjectFile(
        createNativeCreasePatternProjectFile({
          title: 'Native CP',
          filename: 'layers.osf',
          path: '/tmp/layers.osf',
          document: state().oristudioCpDocument!.document,
          source: null,
          foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
          foldArtifacts: null,
          creaseColorMode: 'mvf',
          selection: emptyOristudioCpSelection(),
          viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
          foldedFigures: state().oristudioCpFoldedFigures,
          activeFoldedFigureId: null,
          lineage: importedCpLineage(),
          appVersion: '0.1.1',
        })
      );
      resetStores(seedSnapshot());
      loadSnapshotIntoStore(seedSnapshot());
      await expect(
        state().openProject(createFileService({ text: nativeText, name: 'layers.osf', path: '/tmp/layers.osf' }))
      ).resolves.toBe(true);
      expect(figureNow()).toMatchObject({ handle: null, sourceKind: 'generated-3d', layerOrder: waiting });

      // The idle 3D rehydrate makes it live, as any reopened 3D figure, and never asks about its record.
      analyticsMocks.track.mockClear();
      await expect(state().rehydrateOristudioCpFolded3dFigure(figureNow().id)).resolves.toBe(true);
      expect(figureNow()).toMatchObject({ status: 'ready', layerOrder: waiting });
      expect(figureNow().handle).not.toBeNull();
      expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
      expect(attentionEvents()).toEqual([]);

      // Its creases fold flat again: the record is restored on them, its waiting summary replaced.
      useWorkspaceStore.setState({ oristudioCpDocument: editableCpState(LAYER_ORDER_LINES) });
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(restoredAs());
      await refoldAsEntry(figureNow().id);
      expect(hostEngineMocks.resolveLayerOrder).toHaveBeenCalledWith(
        layerOrderSourceOf(layerOrderKernelSource(), MODEL),
        twoConstraintRecord({ attention: { reason: 'route-3d', count: 2 } }),
        undefined,
        { signal: expect.any(AbortSignal) }
      );
      expect(figureNow()).toMatchObject({ snapshot: { shown_order: 'given' }, folded3d: null, layerOrder: held() });
    });

    it('treats a 3D figure whose creases fold flat again, and whose record then clashes, as a stale flat one: flagged, Review…, Apply refolds it flat', async () => {
      const figure = constrained();
      useWorkspaceStore.setState({ oristudioCpDocument: creasesIn3d() });
      await refoldAsEntry(figure.id);
      expect(figureNow().folded3d).not.toBeNull();
      // The creases fold flat again, and the record clashes on them: the 3D picture is kept, flagged.
      useWorkspaceStore.setState({ oristudioCpDocument: editableCpState(LAYER_ORDER_LINES) });
      const conflict = { reason: 'conflict', count: 2 } as const;
      hostEngineMocks.resolveLayerOrder.mockResolvedValueOnce(notDrawn('clash', conflict));
      const { said } = await refoldAsEntry(figureNow().id);
      expect(said).toEqual([{ kind: 'kept', outcome: 'clash', attention: conflict }]);
      const flagged = figureNow();
      expect(flagged.folded3d).not.toBeNull();
      expect(isFoldedFigureStale(state().oristudioCpDocument!.document, flagged)).toBe(true);
      // Flagged, with Review…, and Layer order… open: not a dead end.
      expect(foldedFigureNotice(t, flagged)).toMatchObject({ id: 'layer-order-attention', action: { id: 'review-layer-order' } });
      expect(layerOrderCommand(flagged, { t, openLayerOrder: vi.fn() })?.disabled).toBe(false);

      // Review… opens on the creases as they are now, the model from the 3D snapshot.
      clearKernelCalls();
      dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied() });
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce(CONSTRAINED_PICTURE);
      await expect(openFoldedFigureLayerOrder(flagged.id, t, { via: 'review' })).resolves.toBe('applied');
      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request).toMatchObject({
        review: true,
        applyRefolds: true,
        source: layerOrderSourceOf(layerOrderKernelSource(), MODEL),
        record: twoConstraintRecord({ attention: conflict }),
      });
      expect(oristudioCpMocks.getOristudioCpSelectionFoldSource).toHaveBeenCalledWith([1, 2], 1);
      // Its Apply refolds it flat, in the order applied, up to date.
      expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(layerOrderKernelSource(), RELATIONS, MODEL, A_RUN_ID);
      expect(figureNow()).toMatchObject({
        handle: 9,
        folded3d: null,
        camera: null,
        sourceKind: 'generated-from-current-cp',
        snapshot: { shown_order: 'given' },
        renderSnapshot: CONSTRAINED_PICTURE,
        layerOrder: held(),
      });
      expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figureNow())).toBe(false);
      expect(labels().at(-1)).toBe('Refold with layer order');
    });

    it('lands nothing when the document was replaced while it resolved: kept and lost alike (the handle generation)', async () => {
      for (const answer of [notDrawn('clash', { reason: 'conflict', count: 2 }), { outcome: 'lost' as const, cause: 'load' as const, record: twoConstraintRecord(), attention: { reason: 'timeout' as const, count: 2 } }]) {
        const figure = constrained();
        let release: (() => void) | null = null;
        hostEngineMocks.resolveLayerOrder.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve(answer);
            })
        );
        const refolding = refoldAsEntry(figure.id);
        await vi.waitFor(() => expect(release).not.toBeNull());
        // Another document: every fold goes, and a new generation of handles begins.
        await resetFoldedFigureHandles();
        release!();
        const { done, said } = await refolding;
        expect(done, answer.outcome).toBe(false);
        expect(said, answer.outcome).toEqual([]);
        expect(figureNow().layerOrder, answer.outcome).toEqual(held());
        expect(attentionEvents(), answer.outcome).toEqual([]);
      }
    });

    describe('a record a reload detached, because an older build folded the figure again', () => {
      /** The creases with one more inside the figure's region: a released build's edit. */
      const EDITED_LINES = [...LAYER_ORDER_LINES, cpLine({ x: 0.5, y: 0 }, { x: 0.5, y: 0.5 })];
      const BOUNDS = foldedSourceBounds(LAYER_ORDER_LINES);

      const cpDocument = (lines: OristudioCpLineSegment[]) => ({
        ...blankCpDocumentState().document,
        crease_pattern: { ...blankCpDocumentState().document.crease_pattern, line_segments: lines },
      });
      /** What a fold of the figure's region on `lines` is baselined on. */
      const fingerprintOn = (lines: OristudioCpLineSegment[]) => {
        const document = cpDocument(lines);
        return foldedSourceFingerprint(cpLinesByIds(document, reselectFoldableLineIds(document, BOUNDS)));
      };
      /** The figure as this build saved it: folded from the creases before the edit, in its chosen order. */
      const savedFigure = (): OristudioCpFoldedFigureEntry => ({
        id: 'generated-1',
        title: 'Folded model 1',
        handle: null,
        sourceKind: 'generated-from-current-cp',
        sourceCpRevision: 0,
        startingFaceId: 1,
        displayStyle: 'Paper5',
        status: 'ready',
        placement: IDENTITY_FOLDED_PLACEMENT,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
        renderSnapshot: foldedRenderSnapshot(),
        sourceBounds: BOUNDS,
        sourceFingerprint: fingerprintOn(LAYER_ORDER_LINES),
        sourceLineIds: [1, 2],
        error: null,
        layerOrder: held(),
      });
      /**
       * The figure as a released build's Refold leaves it after the edit: the
       * same id, title, placement, starting face and region; re-baselined on
       * the new creases; its own snapshot, with no `shown_order`.
       */
      const refoldedByAnOlderBuild = (): OristudioCpFoldedFigureEntry => {
        const { layerOrder: _notThatBuildsToWrite, ...figure } = savedFigure();
        return { ...figure, snapshot: solvedSnapshot(), sourceFingerprint: fingerprintOn(EDITED_LINES) };
      };
      /** A project file as this build writes one, its bag from `extensions`. */
      const projectFile = (
        document: OristudioCpDocumentSnapshot,
        foldedFigures: OristudioCpFoldedFigureEntry[],
        extensions?: Record<string, unknown>
      ) =>
        JSON.parse(
          serializeNativeProjectFile(
            createNativeCreasePatternProjectFile({
              title: 'Native CP',
              filename: 'layers.osf',
              path: '/tmp/layers.osf',
              document,
              source: null,
              foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
              foldArtifacts: null,
              creaseColorMode: 'mvf',
              selection: emptyOristudioCpSelection(),
              viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
              foldedFigures,
              activeFoldedFigureId: null,
              lineage: importedCpLineage(),
              appVersion: '0.1.1',
              ...(extensions ? { extensions } : {}),
            })
          )
        );
      async function openFile(json: unknown) {
        resetStores(seedSnapshot());
        loadSnapshotIntoStore(seedSnapshot());
        await expect(
          state().openProject(createFileService({ text: JSON.stringify(json), name: 'layers.osf', path: '/tmp/layers.osf' }))
        ).resolves.toBe(true);
      }

      /**
       * This build saved a constrained figure; a released one edited a crease
       * inside it and refolded it (`refolded`), carrying the bag as it came;
       * this one opens the file.
       */
      async function openedAfterAnOlderBuild(refolded = refoldedByAnOlderBuild()) {
        const saved = projectFile(cpDocument(LAYER_ORDER_LINES), [savedFigure()]);
        const older = projectFile(cpDocument(EDITED_LINES), [refolded]);
        older.workspace.creasePattern.extensions = saved.workspace.creasePattern.extensions;
        await openFile(older);
      }

      /** The bag the open project saves. */
      const savedBag = () => withFoldedFigureLayerOrders(state().oristudioCpDocumentExtensions, state().oristudioCpFoldedFigures);
      const detachedIn = () => detachedFoldedFigureLayerOrders(savedBag());
      /** The open project saved, then opened again; `edit` changes its figures between, as a later session's fold. */
      async function saveAndReopen(edit: (figures: OristudioCpFoldedFigureEntry[]) => OristudioCpFoldedFigureEntry[] = (f) => f) {
        const { document } = state().oristudioCpDocument!;
        await openFile(projectFile(document, edit(state().oristudioCpFoldedFigures), state().oristudioCpDocumentExtensions));
      }
      const notice = () => foldedFigureNotice(t, figureNow());

      it('is flagged as not applied, opens the dialog for review without folding with it, and an Apply takes it up', async () => {
        await openedAfterAnOlderBuild();
        const opened = figureNow();
        // The older build's refold baselined it on the edited creases: up to date, its record not its own.
        expect(state().oristudioCpDocument!.document.crease_pattern.line_segments).toHaveLength(3);
        expect(isFoldedFigureStale(state().oristudioCpDocument!.document, opened)).toBe(false);
        expect(opened.layerOrder).toBeUndefined();
        expect(foldedFigureNotice(t, opened)).toMatchObject({ label: 'Not applied', action: { id: 'review-layer-order' } });
        expect(detachedIn()).toHaveLength(1);

        clearKernelCalls();
        dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied() });
        await expect(openFoldedFigureLayerOrder(opened.id, t, { via: 'review' })).resolves.toBe('applied');
        // Never seeds a fold: the dialog opened on Oriedita's own search, with the record to restore itself.
        expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
        expect(oristudioCpMocks.foldOristudioCpWithOrder.mock.calls[0]![1]).toEqual(new Uint32Array());
        const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
        expect(request).toMatchObject({
          review: true,
          record: twoConstraintRecord({ attention: { reason: 'detached', count: 2 } }),
        });
        // Taken up: the figure's own now, and the save drops the detached entry.
        expect(figureNow()).toMatchObject({ handle: 9, layerOrder: held() });
        expect(foldedFigureNotice(t, figureNow())).toBeNull();
        expect(detachedIn()).toEqual([]);

        // Undone, it is detached and shown again, and the save keeps it.
        await state().undo();
        await flushMicrotasks();
        expect(figureNow().layerOrder).toBeUndefined();
        expect(foldedFigureNotice(t, figureNow())).toMatchObject({ label: 'Not applied' });
        expect(detachedIn()).toHaveLength(1);
      });

      it('is let go with Dismiss, as one entry that an undo takes back', async () => {
        await openedAfterAnOlderBuild();
        analyticsMocks.track.mockClear();
        await expect(dismissFoldedFigureDetachedLayerOrder(figureNow().id, t)).resolves.toBe(true);
        expect(notice()).toBeNull();
        expect(labels()).toEqual(['Dismiss layer constraints']);
        expect(state().dirty).toBe(true);
        expect(detachedIn()).toEqual([]);
        expect(analyticsMocks.track.mock.calls.filter(([name]) => name === 'layer constraints dismissed')).toEqual([
          ['layer constraints dismissed', { surface: 'edit_figure', constraint_count_bucket: '<=2' }],
        ]);

        await state().undo();
        await flushMicrotasks();
        expect(notice()).toMatchObject({ label: 'Not applied' });
        expect(detachedIn()).toHaveLength(1);
        await state().redo();
        await flushMicrotasks();
        expect(notice()).toBeNull();
        expect(detachedIn()).toEqual([]);
        // Nothing left to let go: no entry, and no event.
        await expect(dismissFoldedFigureDetachedLayerOrder(figureNow().id, t)).resolves.toBe(false);
        expect(labels()).toEqual(['Dismiss layer constraints']);
      });

      it('stays through a Refold here, and a reload after it shows it again', async () => {
        await openedAfterAnOlderBuild();
        // Edited here too, so the figure is stale, and refolded: plainly, as its record is not its own.
        useWorkspaceStore.setState({
          oristudioCpDocument: editableCpState([...EDITED_LINES, cpLine({ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 })]),
        });
        expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figureNow())).toBe(true);
        clearKernelCalls();
        const { done } = await refoldAsEntry(figureNow().id);
        expect(done).toBe(true);
        expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
        expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figureNow())).toBe(false);
        expect(figureNow().layerOrder).toBeUndefined();
        expect(notice()).toMatchObject({ label: 'Not applied' });

        await saveAndReopen();
        expect(figureNow().layerOrder).toBeUndefined();
        expect(notice()).toMatchObject({ label: 'Not applied' });
        expect(detachedIn()).toMatchObject([{ figureId: 'generated-1', reason: 'order-not-given' }]);
      });

      it('shows nothing on a figure the older build moved or made again, and keeps the entry', async () => {
        const moved = refoldedByAnOlderBuild();
        for (const refolded of [
          { ...moved, placement: { ...moved.placement, offset: { x: 3, y: 0 } } },
          { ...moved, title: 'Folded model 2' },
        ]) {
          await openedAfterAnOlderBuild(refolded);
          expect(figureNow().layerOrder).toBeUndefined();
          expect(notice()).toBeNull();
          expect(detachedIn()).toMatchObject([{ figureId: 'generated-1', reason: 'order-not-given' }]);
        }
      });

      it('once its figure is deleted and saved, never shows on a figure folded on the reused id', async () => {
        for (const takenUpFirst of [false, true]) {
          await openedAfterAnOlderBuild();
          expect(notice()).toMatchObject({ label: 'Not applied' });
          if (takenUpFirst) {
            dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied() });
            await expect(openFoldedFigureLayerOrder(figureNow().id, t, { via: 'review' })).resolves.toBe('applied');
            expect(figureNow().layerOrder).toMatchObject({ kind: 'record' });
          }
          // Had the figure stayed, the same figure made again on its id would be shown it.
          const before = state().oristudioCpDocumentExtensions;
          await deleteFoldedFigure(figureNow().id, t);
          expect(state().oristudioCpFoldedFigures).toEqual([]);
          expect(detachedIn().map((entry) => entry.reason), String(takenUpFirst)).toEqual(['figure-missing']);

          // Saved and reopened; the same creases folded again, on the reused id; saved and reopened.
          await saveAndReopen();
          await saveAndReopen(() => [refoldedByAnOlderBuild()]);
          expect(figureNow().id).toBe('generated-1');
          expect(notice(), String(takenUpFirst)).toBeNull();
          expect(detachedIn().map((entry) => entry.reason)).toEqual(['figure-missing']);

          if (!takenUpFirst) {
            await openFile(projectFile(cpDocument(EDITED_LINES), [refoldedByAnOlderBuild()], before));
            expect(notice()).toMatchObject({ label: 'Not applied' });
          }
        }
      });

      /** Save as the app does, through the file service: the file's text, the session's bag following it. */
      async function save(): Promise<string> {
        const files = createFileService();
        await expect(state().saveProjectAs(files)).resolves.toBeTruthy();
        return (files.saveTextFile.mock.calls.at(-1)![0] as SaveTextFileOptions).contents;
      }
      const detachedSaved = (text: string) =>
        detachedFoldedFigureLayerOrders(JSON.parse(text).workspace.creasePattern.extensions as Record<string, unknown>);

      it('never hands a figure folded this session an id the file or its layer order bag names', async () => {
        resetFoldedFigureIds();
        // The bag names a record for `generated-4` and a detached one for `generated-7`; the file has `generated-1`.
        const { layerOrder: _own, ...figure } = savedFigure();
        const other = held(twoConstraintRecord());
        if (other.kind !== 'record') throw new Error('fixture');
        await openFile(
          projectFile(cpDocument(EDITED_LINES), [figure], {
            [FOLDED_FIGURE_LAYER_ORDERS_KEY]: {
              figures: { 'generated-4': { figureKey: 'fk1:gone', record: other.json } },
              detached: [{ figureId: 'generated-7', reason: 'figure-missing', record: other.json }],
            },
          })
        );
        useWorkspaceStore.setState({ oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2, 3] } });
        await expect(state().foldOristudioCpDocument()).resolves.toBe(true);
        expect(state().oristudioCpFoldedFigures.map((entry) => entry.id)).toEqual(['generated-1', 'generated-8']);
      });

      it('once deleted, its id is not taken by a fold in the same session: saved and reopened, nothing is shown', async () => {
        // A fresh session: before the file noted its ids, the first fold was handed `generated-1`.
        resetFoldedFigureIds();
        await openedAfterAnOlderBuild();
        expect(notice()).toMatchObject({ label: 'Not applied' });
        await deleteFoldedFigure(figureNow().id, t);
        // Folded again, the same creases, with no save between.
        useWorkspaceStore.setState({ oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2, 3] } });
        await expect(state().foldOristudioCpDocument()).resolves.toBe(true);
        const fresh = state().oristudioCpFoldedFigures[0]!;
        expect(fresh.id).not.toBe('generated-1');
        expect(foldedFigureNotice(t, fresh)).toBeNull();
        const text = await save();
        expect(detachedSaved(text)).toMatchObject([{ figureId: 'generated-1', reason: 'figure-missing' }]);
        await openFile(JSON.parse(text));
        expect(state().oristudioCpFoldedFigures.map((entry) => foldedFigureNotice(t, entry))).toEqual([null]);
      });

      it('keeps an entry a save dropped dropped: settled, saved, then deleted and saved, and an undo writes it again', async () => {
        for (const settle of ['dismiss', 'apply'] as const) {
          await openedAfterAnOlderBuild();
          if (settle === 'dismiss') {
            await dismissFoldedFigureDetachedLayerOrder(figureNow().id, t);
          } else {
            dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied() });
            await openFoldedFigureLayerOrder(figureNow().id, t, { via: 'review' });
          }
          expect(detachedSaved(await save()), settle).toEqual([]);
          await deleteFoldedFigure(figureNow().id, t);
          // Not back as `figure-missing`: the session's bag no longer holds it.
          expect(detachedSaved(await save()), settle).toEqual([]);

          // The Delete and the settling undone: shown again, and the save writes its entry again.
          await state().undo();
          await flushMicrotasks();
          await state().undo();
          await flushMicrotasks();
          expect(notice(), settle).toMatchObject({ label: 'Not applied' });
          expect(detachedSaved(await save()), settle).toMatchObject([
            { figureId: 'generated-1', reason: 'order-not-given', refoldKey: foldedFigureRefoldKey(figureNow()) },
          ]);
        }
      });

      it('a Delete saved as missing, then undone: the figure claims its entry again', async () => {
        await openedAfterAnOlderBuild();
        await deleteFoldedFigure(figureNow().id, t);
        expect(detachedSaved(await save())).toMatchObject([{ reason: 'figure-missing' }]);
        await state().undo();
        await flushMicrotasks();
        expect(notice()).toMatchObject({ label: 'Not applied' });
        const text = await save();
        expect(detachedSaved(text)).toMatchObject([{ figureId: 'generated-1', reason: 'order-not-given' }]);
        await openFile(JSON.parse(text));
        expect(notice()).toMatchObject({ label: 'Not applied' });
      });
    });

    describe('a figure whose creases changed since its fold (D12)', () => {
      /** Stale: its fingerprint is not the one its region's creases give now. */
      const stale = (overrides: Partial<OristudioCpFoldedFigureEntry> = {}) =>
        constrained({ sourceFingerprint: 'cs1:before', ...overrides });

      it('opens Layer order… on the creases as they are now, and says Apply also refolds; the figure stays as it is', async () => {
        const first = { schema_version: 3, flipped: false, sheet: 1, faces: [], subfaces: [], aux_lines: [], sheet_points: [] };
        for (const layerOrder of [undefined, held()]) {
          const figure = stale({ layerOrder });
          expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figure)).toBe(true);
          clearKernelCalls();
          dialogGatewayMocks.openLayerOrderDialog.mockClear();
          oristudioCpMocks.getOristudioCpFoldedFigurePaperScene.mockImplementation(async (handle: number) =>
            handle === 9 ? first : null
          );

          await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('cancelled');

          expect(oristudioCpMocks.getOristudioCpSelectionFoldSource).toHaveBeenCalledWith([1, 2], 1);
          expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
          const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
          expect(request).toMatchObject({
            surface: 'edit_figure',
            source: layerOrderSourceOf(layerOrderKernelSource(), MODEL),
            record: layerOrder ? twoConstraintRecord() : null,
            applyRefolds: true,
            name: 'Folded model 1',
          });
          if (layerOrder) {
            // A record: read, not folded; the dialog restores it on these creases.
            expect(kernelCalls()).toEqual(['getOristudioCpSelectionFoldSource']);
            expect(request).not.toHaveProperty('shown');
          } else {
            // None: the order a plain Refold draws, Oriedita's first, on a fold of its own that goes once it closes;
            // and the sheet index, built once, for the pattern the crease-pattern pane shows.
            expect(kernelCalls()).toEqual([
              'getOristudioCpSelectionFoldSource',
              'foldOristudioCpWithOrder',
              'getOristudioCpFoldedFigurePaperScene',
              'fetchOristudioCpSheetIndex',
              'freeOristudioCpFoldedFigure',
            ]);
            expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(
              layerOrderKernelSource(),
              new Uint32Array(),
              MODEL,
              A_RUN_ID
            );
            expect(request.shown).toBe(first);
          }
          expect(figureNow()).toBe(figure);
          expect(state().oristudioCpHistoryPast).toEqual([]);
        }
      });

      it('runs the plain Refold for an untouched Apply on a stale figure with no record: no record, the plain picture', async () => {
        const figure = stale({ layerOrder: undefined });
        dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'unchanged' });
        clearKernelCalls();

        await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('unchanged');

        // The dialog's own fold, let go; then exactly a plain Refold's calls.
        expect(kernelCalls().slice(-3)).toEqual([
          'foldOristudioCpDocument',
          'getOristudioCpFoldedFigureRenderSnapshot',
          'freeOristudioCpFoldedFigure',
        ]);
        expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
        expect(figureNow()).toMatchObject({ handle: 7, layerOrder: undefined });
        expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figureNow())).toBe(false);
        expect(labels()).toEqual(['Refold folded model']);
        // With a record, "unchanged" is the dialog's to say only when nothing would change: no refold.
        const constrainedStale = stale({ layerOrder: held() });
        dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'unchanged' });
        await openFoldedFigureLayerOrder(constrainedStale.id, t);
        expect(figureNow()).toBe(constrainedStale);
      });

      it('commits an Apply as its refold: one “Refold with layer order” entry, and the figure up to date', async () => {
        for (const [record, handle] of [
          [twoConstraintRecord({ constraints: [[0, 1, 1]] }), 3],
          // The record it holds: still written, since the Apply is its refold (D12 over D16).
          [twoConstraintRecord(), 3],
          // Reopened from a file, with no live fold: the Apply gives it one.
          [twoConstraintRecord(), null],
        ] as const) {
          const figure = stale({ handle });
          dialogGatewayMocks.openLayerOrderDialog.mockResolvedValueOnce({ kind: 'applied', applied: applied(record) });
          oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot.mockResolvedValueOnce(CONSTRAINED_PICTURE);

          await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('applied');

          expect(oristudioCpMocks.foldOristudioCpWithOrder).toHaveBeenCalledWith(layerOrderKernelSource(), RELATIONS, MODEL, A_RUN_ID);
          expect(figureNow()).toMatchObject({ handle: 9, renderSnapshot: CONSTRAINED_PICTURE, layerOrder: held(record) });
          expect(isFoldedFigureStale(state().oristudioCpDocument!.document, figureNow())).toBe(false);
          expect(labels()).toEqual(['Refold with layer order']);
        }
      });

      it('leaves it stale when its creases moved again while the dialog was open', async () => {
        const figure = stale();
        const moved = editableCpState([...LAYER_ORDER_LINES, cpLine({ x: 0, y: 0.5 }, { x: 1, y: 0.5 })]);
        dialogGatewayMocks.openLayerOrderDialog.mockImplementationOnce(async () => {
          useWorkspaceStore.setState({ oristudioCpDocument: moved });
          return { kind: 'applied', applied: applied() };
        });

        await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('applied');

        // The order applied to the creases it analysed; its picture is not of these.
        expect(figureNow()).toMatchObject({ handle: 9, sourceFingerprint: 'cs1:before' });
        expect(isFoldedFigureStale(moved.document, figureNow())).toBe(true);
      });

      it('opens nothing on creases that fold in 3D now, and says why', async () => {
        const figure = stale();
        useWorkspaceStore.setState({ oristudioCpDocument: creasesIn3d() });
        const message = vi.spyOn(toast, 'message').mockImplementation(() => 1);
        clearKernelCalls();
        try {
          await expect(openFoldedFigureLayerOrder(figure.id, t)).resolves.toBe('not-opened');
          expect(message).toHaveBeenCalledWith(
            'This figure’s creases fold in 3D now, and layer order works on flat folds. Refold it to see it.'
          );
        } finally {
          message.mockRestore();
        }
        expect(kernelCalls()).toEqual([]);
        expect(dialogGatewayMocks.openLayerOrderDialog).not.toHaveBeenCalled();
        expect(figureNow()).toBe(figure);
      });
    });

    it('opens the dialog on the flagged rows from Review…, and only from it (D14)', async () => {
      const flagged = twoConstraintRecord({ attention: { reason: 'conflict', count: 2 } });
      const figure = constrained({ layerOrder: held(flagged) });

      await openFoldedFigureLayerOrder(figure.id, t, { via: 'review' });
      const reviewed = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      // The record as flagged: the dialog works out its rows' statuses itself.
      expect(reviewed).toMatchObject({ review: true, record: flagged });

      await openFoldedFigureLayerOrder(figure.id, t);
      expect(dialogGatewayMocks.openLayerOrderDialog.mock.calls[1]![0]).not.toHaveProperty('review');
    });

    it('says what a refold came to: kept and lost, once each; drawn, nothing', () => {
      const message = vi.spyOn(toast, 'message').mockImplementation(() => 1);
      const error = vi.spyOn(toast, 'error').mockImplementation(() => 1);
      try {
        sayFoldedFigureLayerOrderRefold({ kind: 'applied', attention: { reason: 'unresolved', count: 1 } }, 'Kabuto', t);
        sayFoldedFigureLayerOrderRefold({ kind: 'kept', outcome: 'clash', attention: { reason: 'conflict', count: 2 } }, 'Kabuto', t);
        sayFoldedFigureLayerOrderRefold({ kind: 'kept', outcome: 'timed_out', attention: { reason: 'timeout', count: 0 } }, 'Kabuto', t);
        sayFoldedFigureLayerOrderRefold({ kind: 'lost', cause: 'load' }, 'Kabuto', t);
        sayFoldedFigureLayerOrderRefold({ kind: 'lost', cause: 'crashed' }, 'Kabuto', t);
        expect(message.mock.calls.map(([text]) => text)).toEqual([
          'Kabuto’s layer constraints need attention, so it keeps its picture.',
          'Kabuto’s chosen layer order needs attention, so it keeps its picture.',
        ]);
        expect(error.mock.calls.map(([text]) => text)).toEqual([
          'Layer order couldn’t load, so Kabuto wasn’t refolded. Reload Ori Studio to try again.',
          'Layer order stopped unexpectedly, so Kabuto wasn’t refolded.',
        ]);
        // A load that failed offers Reload, the only retry there is; a crash offers nothing.
        expect(error.mock.calls[0]![1]).toMatchObject({ action: { label: 'Reload' } });
        expect(error.mock.calls[1]![1]).toBeUndefined();
      } finally {
        message.mockRestore();
        error.mockRestore();
      }
    });

    /**
     * Gate 2 (approach 5): opening a file with constrained figures — flat,
     * stale and 3D — and selecting each, as the toolbar, the menu and the
     * Properties pane read it, starts no worker; nor does the idle 3D
     * rehydrate of the 3D one.
     */
    it('starts no worker when a file with flat, stale and 3D constrained figures opens and each is selected', async () => {
      const spawned: string[] = [];
      class WorkerSpy {
        constructor(url: URL | string) {
          spawned.push(String(url));
          throw new Error('no worker in this test');
        }
      }
      vi.stubGlobal('Worker', WorkerSpy);
      try {
        // A 3D figure, folded from creases with a fold angle, its record waiting.
        resetStores(seedSnapshot());
        loadSnapshotIntoStore(seedSnapshot());
        useLayoutStore.setState({ activatePanel: vi.fn() });
        useWorkspaceStore.setState({
          oristudioCpDocument: creasesIn3d(),
          oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2] },
        });
        await expect(state().foldOristudioCpDocument()).resolves.toBe(true);
        const waiting = held(twoConstraintRecord({ attention: { reason: 'route-3d', count: 2 } }));
        const spatial = { ...state().oristudioCpFoldedFigures[0]!, id: 'generated-3', layerOrder: waiting };
        const flat = (id: string, overrides: Partial<OristudioCpFoldedFigureEntry> = {}): OristudioCpFoldedFigureEntry => ({
          id,
          title: id,
          handle: null,
          sourceKind: 'generated-from-current-cp',
          sourceCpRevision: 0,
          startingFaceId: 1,
          displayStyle: 'Paper5',
          status: 'ready',
          placement: IDENTITY_FOLDED_PLACEMENT,
          snapshot: solvedSnapshot({ shown_order: 'given' }),
          renderSnapshot: foldedRenderSnapshot(),
          sourceBounds: foldedSourceBounds(LAYER_ORDER_LINES),
          sourceFingerprint: null,
          sourceLineIds: [1, 2],
          error: null,
          layerOrder: held(),
          ...overrides,
        });
        const nativeText = serializeNativeProjectFile(
          createNativeCreasePatternProjectFile({
            title: 'Native CP',
            filename: 'layers.osf',
            path: '/tmp/layers.osf',
            document: state().oristudioCpDocument!.document,
            source: null,
            foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
            foldArtifacts: null,
            creaseColorMode: 'mvf',
            selection: emptyOristudioCpSelection(),
            viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
            foldedFigures: [
              flat('generated-1'),
              flat('generated-2', {
                sourceFingerprint: 'cs1:before',
                layerOrder: held(twoConstraintRecord({ attention: { reason: 'conflict', count: 1 } })),
              }),
              spatial,
            ],
            activeFoldedFigureId: null,
            lineage: importedCpLineage(),
            appVersion: '0.1.1',
          })
        );
        hostEngineMocks.resolveLayerOrder.mockImplementation(hostEngineMocks.actual!);
        resetStores(seedSnapshot());
        loadSnapshotIntoStore(seedSnapshot());

        await expect(
          state().openProject(createFileService({ text: nativeText, name: 'layers.osf', path: '/tmp/layers.osf' }))
        ).resolves.toBe(true);
        expect(state().oristudioCpFoldedFigures.map((entry) => entry.layerOrder?.kind)).toEqual(['record', 'record', 'record']);

        for (const opened of state().oristudioCpFoldedFigures) {
          state().setOristudioCpActiveFoldedFigure(opened.id);
          const selected = state().oristudioCpFoldedFigures.find((entry) => entry.id === opened.id)!;
          buildFoldedFigureActions(selected, {
            t,
            flip: vi.fn(),
            resetView: vi.fn(),
            setUpright: vi.fn(),
            setDisplayStyle: vi.fn(),
            updateModel: vi.fn(),
            endModelGesture: vi.fn(),
            paperStyle: () => DEFAULT_PAPER_STYLE,
            inheritedPaperStyle: DEFAULT_PAPER_STYLE,
            setAppearance: vi.fn(),
            foldAnother: vi.fn(),
            duplicate: vi.fn(),
            remove: vi.fn(),
            refold: vi.fn(),
            openLayerOrder: vi.fn(),
            runNoticeAction: vi.fn(),
            isStale: (figure) => isFoldedFigureStale(state().oristudioCpDocument!.document, figure),
          });
          buildFoldedFigureProperties({ kind: 'folded-figure', id: selected.id, figure: selected }, {
            t,
            stale: isFoldedFigureStale(state().oristudioCpDocument!.document, selected),
            held: false,
            begin: () => true,
            end: vi.fn(),
            commitModel: vi.fn(),
            style: DEFAULT_PAPER_STYLE,
            inherited: DEFAULT_PAPER_STYLE,
            overrides: undefined,
            writeOverride: vi.fn(),
            commitOverrides: vi.fn(),
            setDisplayStyle: vi.fn(),
            setCamera: vi.fn(),
            liveCamera: { read: () => ({ yaw: 0, pitch: 0, zoom: 1 }), subscribe: () => () => {} },
            setPlacement: vi.fn(),
            foldAnother: vi.fn(),
            foldPrevious: vi.fn(),
            exportFigure: vi.fn(),
            duplicate: vi.fn(),
            remove: vi.fn(),
            openLayerOrder: vi.fn(),
            reviewLayerOrder: vi.fn(),
            dismissDetachedLayerOrder: vi.fn(),
          });
        }
        // The idle queue's 3D rehydrate.
        await expect(state().rehydrateOristudioCpFolded3dFigure('generated-3')).resolves.toBe(true);
        await flushMicrotasks();

        expect(spawned).toEqual([]);
        expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  it('with no record, refolds, steps and duplicates with exactly the kernel calls it always made (parity guard)', async () => {
    const figure = seedFigure({
      snapshot: solvedSnapshot({ discovered_fold_cases: 1, find_another_overlap_valid: true }),
    });
    clearKernelCalls();
    await expect(state().foldAnotherOristudioCpFigure(figure.id)).resolves.toBe(true);
    expect(kernelCalls()).toEqual(['foldOristudioCpFigureAnother', 'getOristudioCpFoldedFigureRenderSnapshot']);

    clearKernelCalls();
    await expect(state().refoldOristudioCpFoldedFigure(figure.id)).resolves.toBe(true);
    // The fold it replaced goes once nothing holds it.
    expect(kernelCalls()).toEqual([
      'foldOristudioCpDocument',
      'getOristudioCpFoldedFigureRenderSnapshot',
      'freeOristudioCpFoldedFigure',
    ]);
    expect(oristudioCpMocks.foldOristudioCpDocument).toHaveBeenCalledWith(1, 'Order5', expect.anything(), [1, 2], A_RUN_ID);

    clearKernelCalls();
    await expect(state().duplicateOristudioCpFoldedFigure(figureNow().id)).resolves.toBe(true);
    // The copy's picture, then the original's selection marker as the copy takes the selection.
    expect(kernelCalls()).toEqual([
      'duplicateOristudioCpFoldedFigure',
      'getOristudioCpFoldedFigureRenderSnapshot',
      'getOristudioCpFoldedFigureRenderSnapshot',
    ]);
    expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();
    expect(state().oristudioCpFoldedFigures.every((entry) => entry.layerOrder === undefined)).toBe(true);
  });

  /**
   * The Fold engine never loads at rest (approach 5): opening an `.osf` with a
   * constrained figure and selecting it — the toolbar, the menu and the
   * Properties pane reading it — starts no worker; the press that folds it
   * again does, through the host engine. (The dialog's own worker, which its
   * mount starts, is checked in the browser: `scripts/layer-order-dialog-check.mjs`.)
   */
  it('starts no worker when a file with a constrained figure opens or the figure is selected; the press does', async () => {
    const spawned: string[] = [];
    class WorkerSpy {
      constructor(url: URL | string) {
        spawned.push(String(url));
        throw new Error('no worker in this test');
      }
    }
    vi.stubGlobal('Worker', WorkerSpy);
    const error = vi.spyOn(toast, 'error').mockImplementation(() => 1);
    try {
      resetStores(seedSnapshot());
      loadSnapshotIntoStore(seedSnapshot());
      hostEngineMocks.resolveLayerOrder.mockImplementation(hostEngineMocks.actual!);
      const figure: OristudioCpFoldedFigureEntry = {
        id: 'generated-1',
        title: 'Folded model 1',
        handle: 99,
        sourceKind: 'generated-from-current-cp',
        sourceCpRevision: 0,
        startingFaceId: 1,
        displayStyle: 'Paper5',
        status: 'ready',
        placement: IDENTITY_FOLDED_PLACEMENT,
        snapshot: solvedSnapshot({ shown_order: 'given' }),
        renderSnapshot: foldedRenderSnapshot(),
        sourceBounds: foldedSourceBounds(LAYER_ORDER_LINES),
        sourceFingerprint: null,
        sourceLineIds: [1, 2],
        error: null,
        layerOrder: held(),
      };
      const document = {
        ...blankCpDocumentState().document,
        crease_pattern: { ...blankCpDocumentState().document.crease_pattern, line_segments: LAYER_ORDER_LINES },
      };
      const nativeText = serializeNativeProjectFile(
        createNativeCreasePatternProjectFile({
          title: 'Native CP',
          filename: 'layers.osf',
          path: '/tmp/layers.osf',
          document,
          source: null,
          foldProjection: JSON.parse(editableCpFoldText) as FoldDocument,
          foldArtifacts: null,
          creaseColorMode: 'mvf',
          selection: emptyOristudioCpSelection(),
          viewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
          foldedFigures: [figure],
          activeFoldedFigureId: null,
          lineage: importedCpLineage(),
          appVersion: '0.1.1',
        })
      );

      await expect(
        state().openProject(createFileService({ text: nativeText, name: 'layers.osf', path: '/tmp/layers.osf' }))
      ).resolves.toBe(true);
      const opened = figureNow();
      expect(opened).toMatchObject({ handle: null, layerOrder: held() });

      // Selected, and every surface that draws it asked what it can do.
      state().setOristudioCpActiveFoldedFigure(opened.id);
      const selected = figureNow();
      const actions = buildFoldedFigureActions(selected, {
        t,
        flip: vi.fn(),
        resetView: vi.fn(),
        setUpright: vi.fn(),
        setDisplayStyle: vi.fn(),
        updateModel: vi.fn(),
        endModelGesture: vi.fn(),
        paperStyle: () => DEFAULT_PAPER_STYLE,
        inheritedPaperStyle: DEFAULT_PAPER_STYLE,
        setAppearance: vi.fn(),
        foldAnother: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
        openLayerOrder: vi.fn(),
        isStale: () => false,
      });
      expect(actions.some((action) => action.kind === 'command' && action.id === 'layer-order' && !action.disabled)).toBe(true);
      buildFoldedFigureProperties({ kind: 'folded-figure', id: selected.id, figure: selected }, {
        t,
        stale: false,
        held: false,
        begin: () => true,
        end: vi.fn(),
        commitModel: vi.fn(),
        style: DEFAULT_PAPER_STYLE,
        inherited: DEFAULT_PAPER_STYLE,
        overrides: undefined,
        writeOverride: vi.fn(),
        commitOverrides: vi.fn(),
        setDisplayStyle: vi.fn(),
        setCamera: vi.fn(),
        liveCamera: { read: () => ({ yaw: 0, pitch: 0, zoom: 1 }), subscribe: () => () => {} },
        setPlacement: vi.fn(),
        foldAnother: vi.fn(),
        foldPrevious: vi.fn(),
        exportFigure: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
        openLayerOrder: vi.fn(),
        reviewLayerOrder: vi.fn(),
        dismissDetachedLayerOrder: vi.fn(),
      });
      await flushMicrotasks();
      expect(spawned).toEqual([]);
      expect(hostEngineMocks.resolveLayerOrder).not.toHaveBeenCalled();

      // The press folds it again through the host engine, whose worker starts now.
      await openFoldedFigureLayerOrder(opened.id, t);
      expect(spawned).toHaveLength(1);
      expect(spawned[0]).toMatch(/layerOrderWorker/);
      // That worker never came here, so the figure keeps its picture, and the
      // dialog opens on its source and record, to restore it itself.
      expect(figureNow()).toMatchObject({ handle: null, renderSnapshot: figure.renderSnapshot });
      const request = dialogGatewayMocks.openLayerOrderDialog.mock.calls[0]![0] as LayerOrderRequest;
      expect(request).toMatchObject({ surface: 'edit_figure', record: twoConstraintRecord() });
      expect(request).not.toHaveProperty('shown');
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});
