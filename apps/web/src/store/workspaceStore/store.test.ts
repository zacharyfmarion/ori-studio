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
  OristudioCpDocumentSnapshot,
  OristudioCpDocumentState,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
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
import { registerCpCamera } from '../../cp-workspace/renderer/cpCameraRegistry';
import { projectFromSnapshot } from '../../engine/snapshotMapper';
import type { FileService, SaveBinaryFileOptions, SaveTextFileOptions } from '../../platform/fileService';
import { DEFAULT_CREASE_COLOR_MODE } from '../../lib/sampleProject';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
} from '../../lib/creasePatternViewport';
import {
  activeNativeDocument,
  createNativeBoxPleatProjectFile,
  createNativeCreasePatternProjectFile,
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
import { isFoldedFigureStale } from '../../cp-workspace/folded/foldedFigureStaleness';
import {
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
} from '../../cp-workspace/folded/foldedFigureHandles';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import { useLayoutStore } from '../layoutStore';
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
  exportOristudioCpDocumentAsCp: vi.fn(),
  exportOristudioCpDocumentAsFold: vi.fn(),
  exportOristudioCpDocumentAsOri: vi.fn(),
  exportOristudioCpDocumentAsOrh: vi.fn(),
  foldOristudioCpDocument: vi.fn(),
  foldOristudioCpFigureAnother: vi.fn(),
  foldOristudioCpFigureToCase: vi.fn(),
  freeOristudioCpFoldedFigure: vi.fn(),
  getOristudioCpFoldedFigureRenderSnapshot: vi.fn(),
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
  EMPTY_CREASE_EXPORT_CAPTION: { title: '', subtitle: '', description: '' },
  EMPTY_CREASE_EXPORT_CONTENT: { foldedFigure: null },
  DEFAULT_CREASE_EXPORT_OPTIONS: {
    segmentId: null,
    lineStyle: 'color',
    lineWidth: 1,
    pointSize: 0,
    includeUnassigned: true,
    showBackgroundColor: true,
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
  optimizeOristudioBpLayout: vi.fn(),
}));

vi.mock('../../lib/creaseExport', () => exportMocks);

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
    optimizeOristudioBpLayout: bpMocks.optimizeOristudioBpLayout,
  };
});

vi.mock('./oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioCpRuntime')>();
  return {
    ...actual,
    createBlankOristudioCpDocument: oristudioCpMocks.createBlankOristudioCpDocument,
    duplicateOristudioCpFoldedFigure: oristudioCpMocks.duplicateOristudioCpFoldedFigure,
    executeOristudioCpCommand: oristudioCpMocks.executeOristudioCpCommand,
    exportOristudioCpDocumentAsCp: oristudioCpMocks.exportOristudioCpDocumentAsCp,
    exportOristudioCpDocumentAsFold: oristudioCpMocks.exportOristudioCpDocumentAsFold,
    exportOristudioCpDocumentAsOri: oristudioCpMocks.exportOristudioCpDocumentAsOri,
    exportOristudioCpDocumentAsOrh: oristudioCpMocks.exportOristudioCpDocumentAsOrh,
    foldOristudioCpDocument: oristudioCpMocks.foldOristudioCpDocument,
    foldOristudioCpFigureAnother: oristudioCpMocks.foldOristudioCpFigureAnother,
    foldOristudioCpFigureToCase: oristudioCpMocks.foldOristudioCpFigureToCase,
    freeOristudioCpFoldedFigure: oristudioCpMocks.freeOristudioCpFoldedFigure,
    getOristudioCpFoldedFigureRenderSnapshot:
      oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot,
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
  };
});

import type { EngineClient } from './engineRuntime';
import { selectWorkspaceCapabilities } from './capabilities';
import { useWorkspaceStore } from './store';

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
    sequenceAnalyzeFold: vi.fn(async (foldJson: string) => ({
      normalized: JSON.parse(foldJson) as FoldDocument,
      folded_vertices: [],
      faces_flip: [],
      face_orders: [],
      states: '1',
      diagnostics: [],
    })),
    sequencePlanFold: vi.fn(async () => ({
      status: 'complete',
      steps: [],
      states: [],
      diagnostics: [],
      unresolved_regions: [],
      search: {
        states_explored: 1,
        branches_pruned: 0,
        repeated_states: 0,
        timed_out: false,
        budget_exhausted: false,
        best_unresolved_creases: 0,
        target_solves: 0,
        target_solve_cache_hits: 0,
        duplicate_candidates_pruned: 0,
      },
    })),
    sequencePlanFoldWithTarget: vi.fn(async (foldJson: string) => ({
      target: {
        normalized: JSON.parse(foldJson) as FoldDocument,
        folded_vertices: [],
        faces_flip: [],
        face_orders: [],
        states: '1',
        diagnostics: [],
      },
      plan: {
        status: 'complete',
        steps: [],
        states: [],
        diagnostics: [],
        unresolved_regions: [],
        search: {
          states_explored: 1,
          branches_pruned: 0,
          repeated_states: 0,
          timed_out: false,
          budget_exhausted: false,
          best_unresolved_creases: 0,
          target_solves: 0,
          target_solve_cache_hits: 0,
          duplicate_candidates_pruned: 0,
        },
      },
    })),
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
  useWorkspaceStore.setState({
    project: projectFromSnapshot(snapshot, title),
    // A loaded tree claims the design, exactly as `loadText` does in production.
    designMethod: 'treemaker',
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
    lastOptimization: null,
    designViewportFitRequestId: 0,
    historyPast: [],
    historyFuture: [],
    historyBusy: false,
    selection: { kind: 'tree' },
    toolMode: 'select',
    symmetryAuthoringPairs: [],
    clipboard: null,
    clipboardPasteCount: 0,
    creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    foldArtifacts: null,
    foldArtifactError: null,
    sequenceTarget: null,
    sequencePlan: null,
    sequenceSimulationFocus: { kind: 'whole' },
    sequencePlanning: false,
    sequenceError: null,
  });
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
  // Handle ownership is module-level; isolate it between tests.
  resetFoldedFigureHandles();
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
  oristudioCpMocks.exportOristudioCpDocumentAsOri
    .mockReset()
    .mockResolvedValue('{"@version":"v1.1","title":"square"}\n');
  oristudioCpMocks.exportOristudioCpDocumentAsOrh
    .mockReset()
    .mockResolvedValue('<タイトル>\nタイトル,square\n');
  oristudioCpMocks.foldOristudioCpDocument
    .mockReset()
    .mockResolvedValue({ handle: 7, snapshot: foldedFigureSnapshot() });
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
  saveTextFile: ReturnType<typeof vi.fn>;
  saveBinaryFile: ReturnType<typeof vi.fn>;
} {
  return {
    surface: 'web',
    supportsNativeDialogs: false,
    openTextFile: vi.fn(async () => file),
    openBinaryFile: vi.fn(async () => null),
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

    expect(state.project.nodes).toEqual([]);
    expect(state.importedCreasePattern).toBeNull();
    expect(state.oristudioCpDocument).toBeNull();
    expect(state.oristudioCpOperationDescriptors).toEqual([]);
    expect(state.oristudioCpError).toBeNull();
    expect(state.oristudioCpCamvResult).toBeNull();
    expect(state.oristudioCpHistoryPast).toEqual([]);
    expect(state.oristudioCpHistoryFuture).toEqual([]);
    expect(state.status).toBe('loading_engine');
    expect(state.selection).toEqual({ kind: 'tree' });
    expect(state.toolMode).toBe('select');
    expect(state.symmetryAuthoringPairs).toEqual([]);
    expect(state.creaseColorMode).toBe(DEFAULT_CREASE_COLOR_MODE);
    expect(state.oristudioCpSelection).toEqual(emptyOristudioCpSelection());
    expect(state.oristudioCpViewport).toEqual(DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS);
    expect(state.foldArtifacts).toBeNull();
    expect(state.designViewportFitRequestId).toBe(0);
    expect(state.historyPast).toEqual([]);
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
    expect(useWorkspaceStore.getState().project.nodes).toHaveLength(2);
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
    expect(activeNativeDocument(savedNativeTree)).toMatchObject({
      kind: 'treemaker-tree',
      tree: { format: 'tmd5' },
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
      { foldedFigure: null }
    );

    await expect(useWorkspaceStore.getState().exportPng(fileService)).resolves.toBe(true);
    expect(exportMocks.renderCreasePatternPng).toHaveBeenCalledWith(
      expect.objectContaining({ edges_vertices: expect.any(Array) }),
      expect.any(Array),
      expect.objectContaining({ segmentId: null, includeUnassigned: true, showBackgroundColor: true }),
      { foldedFigure: null }
    );
    expect(fileService.saveBinaryFile).toHaveBeenCalledWith(
      expect.objectContaining({ extensions: ['png'], mimeType: 'image/png' })
    );

    useWorkspaceStore.getState().clearProjectMessage();
    expect(useWorkspaceStore.getState().projectMessage).toBeNull();
  });

  it('creates a blank editable CP document', async () => {
    resetStores(seedSnapshot());
    const activateWorkspace = vi.fn();
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
    expect(useWorkspaceStore.getState().project.title).toBe('Untitled CP');
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
    expect(useWorkspaceStore.getState().designMethod).toBe('none');
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

  it('ensureEditCreasePattern offers the Design chooser only for a design-less bare CP', async () => {
    // Fresh, design-less project (no tree, no BP): the auto-seeded Edit CP keeps
    // the Design workspace on its method chooser.
    resetStores(seedSnapshot());
    useWorkspaceStore.setState({
      oristudioCpDocument: null,
      oristudioBpDocument: null,
      designMethod: 'treemaker',
    });
    await useWorkspaceStore.getState().ensureEditCreasePattern();
    expect(useWorkspaceStore.getState().oristudioCpDocument).not.toBeNull();
    expect(useWorkspaceStore.getState().designMethod).toBe('none');
    // The CP editor must report ready (not the initial 'loading_engine'), else
    // `isBusy` disables undo/redo and every engine-gated command on this canvas.
    expect(useWorkspaceStore.getState().status).toBe('crease_pattern_ready');

    // With an authored tree, seeding a blank Edit CP must NOT reset the choice.
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().initEngine();
    expect(useWorkspaceStore.getState().project.edges.length).toBeGreaterThan(0);
    useWorkspaceStore.setState({ oristudioCpDocument: null, designMethod: 'treemaker' });
    await useWorkspaceStore.getState().ensureEditCreasePattern();
    expect(useWorkspaceStore.getState().designMethod).not.toBe('none');
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
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe('generated-1');
    expect(useWorkspaceStore.getState().foldArtifacts?.simulation_model).not.toBeNull();
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
    const activateWorkspace = vi.fn();
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
    expect(useWorkspaceStore.getState().project.creases.length).toBeGreaterThan(0);
    expect(useWorkspaceStore.getState().project.facets.length).toBeGreaterThan(0);
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
    expect(activeNativeDocument(savedNativeCp)).toMatchObject({
      kind: 'crease-pattern',
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
    expect(activeNativeDocument(savedProject)).toMatchObject({
      kind: 'crease-pattern',
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
      [1]
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

  // A crease with a non-180 angle has no flat folded form at all, so the 2D
  // folder cannot answer. The dialog offers the simulator, which can — and that
  // answer belongs beside the crease pattern, not in another workspace.
  describe('folding a pattern that is not flat-folded', () => {
    /** The unit square of `editableCpFoldText`, with its diagonal folded to 90°. */
    function nonFlatSquare() {
      return editableCpState([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 0 }, { color: 'Black0' }),
        cpLine({ x: 1, y: 0 }, { x: 1, y: 1 }, { color: 'Black0' }),
        cpLine({ x: 1, y: 1 }, { x: 0, y: 1 }, { color: 'Black0' }),
        cpLine({ x: 0, y: 1 }, { x: 0, y: 0 }, { color: 'Black0' }),
        cpLine(
          { x: 0, y: 0 },
          { x: 1, y: 1 },
          { color: 'Red1', fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }
        ),
      ]);
    }

    const WHOLE_REGION = [1, 2, 3, 4, 5];

    /** Fold `lines`, answer the non-flat dialog, and report what the panel saw. */
    async function foldAndAnswer(lines: number[], simulate: boolean) {
      const activatePanel = vi.fn();
      useLayoutStore.setState({ activatePanel });
      useWorkspaceStore.setState({
        oristudioCpDocument: nonFlatSquare(),
        oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
      });

      const unregisterDialogHost = registerCommandDialogHost();
      try {
        const folding = useWorkspaceStore.getState().foldOristudioCpDocument();
        const dialog = useCommandDialogStore.getState().dialog;
        expect(dialog).toMatchObject({
          type: 'confirm',
          title: 'This pattern isn’t flat-folded',
          confirmLabel: 'Simulate',
        });
        if (!dialog) throw new Error('expected the non-flat fold confirmation');
        resolveCommandDialog(dialog.id, simulate);
        // False either way: there is no flat folded form to have produced.
        await expect(folding).resolves.toBe(false);
      } finally {
        unregisterDialogHost();
      }
      return { activatePanel };
    }

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
      // The fold itself never ran, so no figure was produced.
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    });

    it('does nothing when the dialog is dismissed', async () => {
      resetStores(seedSnapshot());
      const { activatePanel } = await foldAndAnswer(WHOLE_REGION, false);

      expect(useWorkspaceStore.getState().oristudioCpInlineSimulations).toEqual([]);
      expect(activatePanel).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
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
      [2, 1]
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
              state: 'TRANSPARENT_3',
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
        state: 'Transparent3',
      }),
      [1]
    );
  });

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
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe(foldedFigure.id);
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

  const RED = { red: 255, green: 0, blue: 0 };
  const BLUE = { red: 0, green: 0, blue: 255 };

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
      .updateOristudioCpFoldedFigureModel(figure.id, { front_color: RED });
    useWorkspaceStore.getState().recordFoldedFigureHistory([...before], 'Change folded model');

    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockClear();
    await useWorkspaceStore.getState().undo();
    await flushMicrotasks();

    // The web state reverted, and the kernel was told about it.
    expect(
      useWorkspaceStore.getState().oristudioCpFoldedFigures[0].snapshot?.model.front_color
    ).toEqual(original.front_color);
    expect(kernelModelWrites().at(-1)?.front_color).toEqual(original.front_color);
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
    for (const color of [RED, BLUE, { red: 0, green: 255, blue: 0 }]) {
      const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [
          {
            ...useWorkspaceStore.getState().oristudioCpFoldedFigures[0],
            snapshot: {
              ...figure.snapshot!,
              model: { ...figure.snapshot!.model, front_color: color },
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

    for (const color of [RED, BLUE]) {
      const before = useWorkspaceStore.getState().oristudioCpFoldedFigures;
      useWorkspaceStore.setState({
        oristudioCpFoldedFigures: [
          {
            ...useWorkspaceStore.getState().oristudioCpFoldedFigures[0],
            snapshot: {
              ...figure.snapshot!,
              model: { ...figure.snapshot!.model, front_color: color },
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
      expect(kernelModelWrites().at(-1)?.front_color).toEqual(original.front_color)
    );
    expect(kernelModelWrites().some((m) => m.front_color.blue === 255)).toBe(false);
  });

  it('skips a reconcile that would not change the kernel', async () => {
    const figure = seedFoldedFigureForModelTests();
    oristudioCpMocks.setOristudioCpFoldedFigureModel.mockImplementation(
      async (_handle: number, model: OristudioCpFoldedFigureModel) => ({
        ...foldedFigureSnapshot(),
        model,
      })
    );
    // Colour first, so the kernel holds RED...
    await useWorkspaceStore
      .getState()
      .updateOristudioCpFoldedFigureModel(figure.id, { front_color: RED });
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
      .updateOristudioCpFoldedFigureModel(figure.id, { front_color: RED });
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
              selected: 2,
              customized: 0,
              customized_color: { red: 100, green: 200, blue: 200 },
            },
            {
              a: { x: 0, y: 0 },
              b: { x: 0, y: 1 },
              active: 'Inactive0',
              color: 'Blue2',
              selected: 2,
              customized: 0,
              customized_color: { red: 100, green: 200, blue: 200 },
            },
            {
              a: { x: 1, y: 0 },
              b: { x: 1, y: 1 },
              active: 'Inactive0',
              color: 'Black0',
              selected: 0,
              customized: 0,
              customized_color: { red: 100, green: 200, blue: 200 },
            },
          ],
        },
      },
      summary: {
        ...currentDocument.summary,
        line_segments: 3,
      },
    });

    await expect(
      useWorkspaceStore.getState().executeOristudioCpCommand('SelectLineIntersecting', {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ],
      })
    ).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpSelection).toEqual({
      ...emptyOristudioCpSelection(),
      lines: [1, 2],
    });
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
      document: loadedDocument.document,
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
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'tree' });

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
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast[0]).toMatchObject({
      document: documentState.document,
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
    expect(useWorkspaceStore.getState().project.nodes.map((node) => node.id)).toEqual([1, 2, 3]);
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'node', id: 3 });
    expect(useWorkspaceStore.getState().status).toBe('needs_optimization');
    expect(useWorkspaceStore.getState().historyPast.at(-1)?.label).toBe('Add node');

    await useWorkspaceStore.getState().moveNode(3, { x: 0.8, y: 0.7 });
    expect(useWorkspaceStore.getState().project.nodes.find((node) => node.id === 3)?.loc).toEqual({
      x: 0.8,
      y: 0.7,
    });

    await useWorkspaceStore.getState().updateNodeLabel(3, 'new tip');
    expect(useWorkspaceStore.getState().project.nodes.find((node) => node.id === 3)?.label).toBe(
      'new tip'
    );

    await useWorkspaceStore.getState().addEdge(2, 3);
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'edge', id: 3 });

    await useWorkspaceStore
      .getState()
      .updateEdge(3, { label: 'span', length: 2, strain: 0.1, stiffness: 4 });
    expect(useWorkspaceStore.getState().project.edges.find((edge) => edge.id === 3)).toMatchObject({
      label: 'span',
      length: 2,
      strain: 0.1,
      stiffness: 4,
    });

    useWorkspaceStore.getState().select({ kind: 'multi', nodes: [1, 2], edges: [], paths: [], creases: [], facets: [], conditions: [] });
    useWorkspaceStore.getState().selectPathBetweenSelectedNodes();
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'path', id: 1 });

    useWorkspaceStore.getState().selectAll();
    expect(useWorkspaceStore.getState().selection).toMatchObject({ kind: 'multi', nodes: [1, 2, 3] });
    useWorkspaceStore.getState().selectNone();
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'tree' });
    useWorkspaceStore.getState().setToolMode('node');
    expect(useWorkspaceStore.getState().toolMode).toBe('node');

    await useWorkspaceStore.getState().updatePaper({ width: 2, height: 3 });
    expect(useWorkspaceStore.getState().project.paper).toMatchObject({ width: 2, height: 3 });

    await useWorkspaceStore
      .getState()
      .setSymmetry({ hasSymmetry: true, symLoc: { x: 0.25, y: 0.75 }, symAngle: 45 });
    expect(useWorkspaceStore.getState().project).toMatchObject({
      hasSymmetry: true,
      paper: { symLoc: { x: 0.25, y: 0.75 }, symAngle: 45 },
    });

    await useWorkspaceStore.getState().addCondition(nodeFixedCondition(2));
    expect(useWorkspaceStore.getState().project.conditions).toHaveLength(2);
    await useWorkspaceStore.getState().deleteCondition(1);
    expect(useWorkspaceStore.getState().project.conditions.map((condition) => condition.id)).toEqual([2]);
    await useWorkspaceStore.getState().clearConditions();
    expect(useWorkspaceStore.getState().project.conditions).toEqual([]);

    useWorkspaceStore.getState().selectAll();
    await useWorkspaceStore.getState().deleteSelection();
    expect(useWorkspaceStore.getState().project.nodes).toEqual([]);
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
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'node', id: 3 });

    useWorkspaceStore.getState().selectMovableParts();
    expect(useWorkspaceStore.getState().selection).toEqual({
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
    expect(useWorkspaceStore.getState().selection).toEqual({
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
    expect(useWorkspaceStore.getState().project.edges[0].length).toBe(2);

    await useWorkspaceStore.getState().scaleSelectedEdgeLengths(0.5);
    expect(useWorkspaceStore.getState().project.edges[0].length).toBe(1);

    await useWorkspaceStore.getState().splitSelectedEdge(0.4);
    expect(useWorkspaceStore.getState().selection).toEqual({ kind: 'node', id: 3 });
    expect(useWorkspaceStore.getState().project.nodes).toHaveLength(3);

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
    expect(useWorkspaceStore.getState().historyPast.at(-1)?.label).toBe('Perturb all nodes');
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
    expect(useWorkspaceStore.getState().project.conditions[0].kind).toMatchObject({
      y_fixed: true,
      y_fix_value: 0.3,
    });

    useWorkspaceStore.getState().select({ kind: 'path', id: 1 });
    await useWorkspaceStore.getState().deleteConditionsForSelectedPaths();
    expect(useWorkspaceStore.getState().project.conditions.map((condition) => condition.kind.type)).toEqual([
      'node_fixed',
      'edge_length_fixed',
    ]);

    useWorkspaceStore.getState().select({ kind: 'node', id: 2 });
    await useWorkspaceStore.getState().deleteConditionsForSelectedNodes();
    expect(useWorkspaceStore.getState().project.conditions.map((condition) => condition.kind.type)).toEqual([
      'edge_length_fixed',
    ]);

    useWorkspaceStore.getState().select({ kind: 'edge', id: 1 });
    await useWorkspaceStore.getState().deleteConditionsForSelectedEdges();
    expect(useWorkspaceStore.getState().project.conditions).toEqual([]);
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

    expect(useWorkspaceStore.getState().project.nodes.map((node) => node.loc)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: 0.25, y: 0.72 },
      { x: 0.75, y: 0.72 },
    ]);
    expect(useWorkspaceStore.getState().project.edges.map((edge) => edge.nodes)).toEqual([
      [1, 2],
      [1, 3],
    ]);
    expect(useWorkspaceStore.getState().project.conditions.map((condition) => condition.kind)).toEqual([
      { type: 'nodes_paired', node1: 2, node2: 3 },
    ]);
    expect(useWorkspaceStore.getState().selection).toMatchObject({ kind: 'multi', nodes: [2, 3] });
    expect(useWorkspaceStore.getState().historyPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().historyPast[0].label).toBe('Add mirrored branch');
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

    expect(useWorkspaceStore.getState().project.conditions.map((condition) => condition.kind)).toEqual([
      { type: 'nodes_paired', node1: 4, node2: 5 },
    ]);
    expect(useWorkspaceStore.getState().symmetryAuthoringPairs).toEqual([
      { node1: 2, node2: 3 },
      { node1: 4, node2: 5 },
    ]);

    await useWorkspaceStore.getState().addNodeWithSymmetry({ x: 0.14, y: 0.3 }, 2);

    const nodeLocs = useWorkspaceStore.getState().project.nodes.map((node) => node.loc);
    expect(nodeLocs).toHaveLength(7);
    expect(nodeLocs[0]).toEqual({ x: 0.5, y: 0.5 });
    expect(nodeLocs[1]).toEqual({ x: 0.28, y: 0.5 });
    expect(nodeLocs[2]).toEqual({ x: 0.72, y: 0.5 });
    expect(nodeLocs[3]).toEqual({ x: 0.16, y: 0.7 });
    expect(nodeLocs[4]).toEqual({ x: 0.84, y: 0.7 });
    expect(nodeLocs[5]).toEqual({ x: 0.14, y: 0.3 });
    expect(nodeLocs[6]?.x).toBeCloseTo(0.86);
    expect(nodeLocs[6]?.y).toBeCloseTo(0.3);
    expect(useWorkspaceStore.getState().project.conditions.map((condition) => condition.kind)).toEqual([
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

    expect(useWorkspaceStore.getState().project.nodes).toHaveLength(2);
    expect(useWorkspaceStore.getState().project.nodes[1].loc.x).toBeCloseTo(0.5);
    expect(useWorkspaceStore.getState().project.nodes[1].loc.y).toBeCloseTo(0.72);
    expect(useWorkspaceStore.getState().project.edges.map((edge) => edge.nodes)).toEqual([[1, 2]]);
    expect(useWorkspaceStore.getState().project.conditions).toEqual([]);
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

    expect(useWorkspaceStore.getState().project.nodes.find((node) => node.id === 2)?.loc).toEqual({
      x: 0.3,
      y: 0.4,
    });
    expect(useWorkspaceStore.getState().project.nodes.find((node) => node.id === 3)?.loc).toEqual({
      x: 0.7,
      y: 0.4,
    });
    expect(useWorkspaceStore.getState().historyPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().historyPast[0].label).toBe('Move mirrored nodes');
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

    expect(useWorkspaceStore.getState().project.edges.map((edge) => edge.length)).toEqual([
      2.5,
      2.5,
    ]);
    expect(useWorkspaceStore.getState().historyPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().historyPast[0].label).toBe('Edit mirrored edges');
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
    expect(useWorkspaceStore.getState().project.nodes.map((node) => [node.id, node.label])).toEqual([
      [1, 'root'],
      [2, 'right'],
    ]);
    expect(useWorkspaceStore.getState().project.edges.map((edge) => [edge.id, edge.nodes])).toEqual([
      [1, [1, 2]],
    ]);
    expect(useWorkspaceStore.getState()).toMatchObject({
      selection: { kind: 'tree' },
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
    expect(useWorkspaceStore.getState().project.nodes.map((node) => node.id)).toEqual([1, 2, 3, 4]);
    expect(useWorkspaceStore.getState().selection).toMatchObject({
      kind: 'multi',
      nodes: [3, 4],
    });
    expect(useWorkspaceStore.getState().clipboardPasteCount).toBe(1);

    await useWorkspaceStore.getState().cutSelection();
    const clipboard = useWorkspaceStore.getState().clipboard;
    expect(clipboard?.kind).toBe('tree');
    expect(clipboard?.kind === 'tree' ? clipboard.nodes.map((node) => node.sourceId) : []).toEqual([3, 4]);
    expect(useWorkspaceStore.getState().project.nodes.map((node) => node.id)).toEqual([1, 2]);
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
    expect(useWorkspaceStore.getState().project.nodes).toHaveLength(3);
    expect(useWorkspaceStore.getState().historyPast).toHaveLength(1);

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().project.nodes).toHaveLength(2);
    expect(useWorkspaceStore.getState().historyFuture).toHaveLength(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Undid Add node');

    await useWorkspaceStore.getState().redo();
    expect(useWorkspaceStore.getState().project.nodes).toHaveLength(3);
    expect(useWorkspaceStore.getState().historyPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().projectMessage).toBe('Redid Add node');

    useWorkspaceStore.getState().clearHistory();
    expect(useWorkspaceStore.getState().historyPast).toEqual([]);
    expect(useWorkspaceStore.getState().historyFuture).toEqual([]);
  });

  it('optimizes, builds crease patterns, toggles color mode, and foregrounds Edit', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    const activateWorkspace = vi.fn();
    useLayoutStore.setState({ activateWorkspace });

    const initialFitRequestId = useWorkspaceStore.getState().designViewportFitRequestId;
    await useWorkspaceStore.getState().optimizeScale();
    expect(useWorkspaceStore.getState().status).toBe('optimized');
    expect(useWorkspaceStore.getState().lastOptimization).toMatchObject({ kind: 'scale' });
    expect(useWorkspaceStore.getState().designViewportFitRequestId).toBe(
      initialFitRequestId + 1
    );

    await useWorkspaceStore.getState().optimizeEdges();
    expect(useWorkspaceStore.getState().lastOptimization).toMatchObject({ kind: 'edges' });
    expect(useWorkspaceStore.getState().designViewportFitRequestId).toBe(
      initialFitRequestId + 1
    );

    await useWorkspaceStore.getState().optimizeStrain();
    expect(useWorkspaceStore.getState().lastOptimization).toMatchObject({ kind: 'strain' });
    expect(useWorkspaceStore.getState().designViewportFitRequestId).toBe(
      initialFitRequestId + 1
    );

    await useWorkspaceStore.getState().buildCreasePattern();
    expect(useWorkspaceStore.getState().status).toBe('crease_pattern_ready');
    expect(useWorkspaceStore.getState().project.creases).toHaveLength(1);
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

  it('plans a folding sequence from loaded fold artifacts', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    await useWorkspaceStore.getState().buildCreasePattern();
    useWorkspaceStore
      .getState()
      .setSequenceSimulationFocus({ kind: 'sequence_step', stepId: 'stale-step' });

    const plan = await useWorkspaceStore.getState().planFoldingSequence();

    expect(api.sequencePlanFoldWithTarget).toHaveBeenCalledOnce();
    expect(api.sequenceAnalyzeFold).not.toHaveBeenCalled();
    expect(api.sequencePlanFold).not.toHaveBeenCalled();
    expect(plan?.status).toBe('complete');
    expect(useWorkspaceStore.getState().sequencePlan?.status).toBe('complete');
    expect(useWorkspaceStore.getState().sequenceSimulationFocus).toEqual({ kind: 'whole' });
    expect(useWorkspaceStore.getState().sequenceError).toBeNull();
  });

  it('does not mark CP ready when build returns no drawable crease pattern', async () => {
    const api = resetStores(seedSnapshot());
    loadSnapshotIntoStore(seedSnapshot());
    api.buildCreasePattern.mockResolvedValueOnce(seedSnapshot());

    await useWorkspaceStore.getState().buildCreasePattern();

    expect(useWorkspaceStore.getState().status).toBe('optimized');
    expect(useWorkspaceStore.getState().project.creases).toHaveLength(0);
    expect(useWorkspaceStore.getState().project.facets).toHaveLength(0);
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
      expect(state.oristudioBpDocument).not.toBeNull();
      expect(state.designMethod).toBe('box-pleat');
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
      expect(state.project.creases).toHaveLength(0);
      expect(state.project.title).toBe('Sample BP');
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
      expect(saved.workspace.activeMode).toBe('box-pleat');
      const active = activeNativeDocument(saved);
      expect(active.kind).toBe('box-pleat');
      if (active.kind !== 'box-pleat') throw new Error('expected box-pleat document');
      expect(active.project.text).toBe('{"title":"Crane","saved":true}');
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
      expect(saved.workspace.activeMode).toBe('box-pleat');
      expect(saved.workspace.documents.map((document) => document.kind)).toEqual([
        'box-pleat',
        'crease-pattern',
      ]);
      const active = activeNativeDocument(saved);
      if (active.kind !== 'box-pleat') throw new Error('expected box-pleat document');
      expect(active.project.text).toBe('{"design":"kept"}');
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
      expect(saved.workspace.documents.map((document) => document.kind)).toEqual([
        'box-pleat',
        'crease-pattern',
      ]);
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
      expect(state.oristudioBpDocument).not.toBeNull();
      expect(state.designMethod).toBe('box-pleat');
      // The companion crease pattern is restored onto the Edit canvas.
      expect(state.oristudioCpDocument).not.toBeNull();
      // The bundle dispatches its load on the design document, so the BP loader
      // activated Design and the file always opened there — even though the
      // crease pattern it carries is the surface that was being worked on. One
      // landing rule now places every format the same way.
      expect(useLayoutStore.getState().activeWorkspace).toBe('edit');
      expect(currentWorkspacePath()).toBe('/edit');
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
      expect(state.oristudioBpDocument).not.toBeNull();
      expect(state.creaseColorMode).toBe('agrh');
      expect(state.oristudioCpViewport.gridVisible).toBe(false);
      expect(state.oristudioCpViewport.snapToGrid).toBe(false);
      expect(state.oristudioCpViewport.lineWidth).toBe(3);
      expect(state.toolMode).toBe('select');
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
      expect(useWorkspaceStore.getState().oristudioBpDocument).not.toBeNull();
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
      expect(useWorkspaceStore.getState().oristudioBpDocument).not.toBeNull();
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
      expect(useWorkspaceStore.getState().oristudioBpDocument).not.toBeNull();
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
      expect(state.oristudioBpDocument).not.toBeNull();
      expect(state.designMethod).not.toBe('none');
      expect(useLayoutStore.getState().activeWorkspace).toBe('design');
      expect(currentWorkspacePath()).toBe('/design/bp');
    });

    it('names the TreeMaker variant when a tree replaces a box-pleat design', async () => {
      // Regression: `loadText` installed a tree without claiming the design
      // fields, so the previous file's `workflowTarget` and BP document both
      // survived. Harmless while every design landed on bare `/design`; once the
      // landing names the variant it would send a freshly-opened tree to
      // `/design/bp` and show the stale box-pleat design instead.
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      await useWorkspaceStore.getState().loadOristudioBpProjectFromFile('{"tree":{}}', {
        filename: 'crane.bps',
        path: null,
      });
      expect(useWorkspaceStore.getState().designMethod).toBe('box-pleat');
      useWorkspaceStore.setState({ dirty: false });

      await expect(
        useWorkspaceStore
          .getState()
          .openProject(
            createFileService({ text: 'tree text', name: 'tree.tmd5', path: '/tmp/tree.tmd5' })
          )
      ).resolves.toBe(true);

      const state = useWorkspaceStore.getState();
      expect(state.designMethod).toBe('treemaker');
      expect(state.designMethod).not.toBe('none');
      expect(state.oristudioBpDocument).toBeNull();
      expect(currentWorkspacePath()).toBe('/design/treemaker');
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

      const symmetry = useWorkspaceStore.getState().oristudioBpSymmetry;
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
          symmetry: { enabled: true, fold: 'book', pairs: [{ v1: 1, v2: 99 }] },
          appVersion: '0.0.0',
        })
      );
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      const fileService = createFileService({ text: osf, name: 'crane.osf', path: null });

      await expect(useWorkspaceStore.getState().openProject(fileService)).resolves.toBe(true);

      expect(useWorkspaceStore.getState().oristudioBpSymmetry.pairs).toEqual([]);
    });

    it('opens a plain .bps with default mirror draw, having nowhere to store it', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready', dirty: false });
      useWorkspaceStore.getState().setOristudioBpSymmetry({ fold: 'diagonal', enabled: false });

      await useWorkspaceStore
        .getState()
        .loadOristudioBpProjectFromFile('{"tree":{}}', { filename: 'other.bps', path: null });

      const symmetry = useWorkspaceStore.getState().oristudioBpSymmetry;
      expect(symmetry).toMatchObject({ enabled: true, fold: 'book', pairs: [] });
    });
  });

  describe('design method chooser', () => {
    it('startNewDesign enters the Design workspace on the chooser without a document', () => {
      useWorkspaceStore.getState().startNewDesign();

      expect(useWorkspaceStore.getState().designMethod).toBe('none');
      expect(useLayoutStore.getState().activeWorkspace).toBe('design');
    });

    it('choosing Box-pleated sets the method and clears the chooser', async () => {
      useWorkspaceStore.getState().startNewDesign();

      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');

      const state = useWorkspaceStore.getState();
      expect(state.designMethod).toBe('box-pleat');
      expect(state.designMethod).not.toBe('none');
      expect(state.oristudioBpDocument).not.toBeNull();
      expect(bpMocks.loadOristudioBpProjectFromText).toHaveBeenCalledOnce();
    });

    it('preserves the always-live Edit canvas when choosing a design method', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      const editCp = editableCpState([cpLine({ x: 0, y: 0 }, { x: 1, y: 0 })]);
      useWorkspaceStore.setState({ oristudioCpDocument: editCp });
      useWorkspaceStore.getState().startNewDesign();

      // Circle-packed: establishes a tree without touching the Edit canvas.
      await useWorkspaceStore.getState().chooseDesignMethod('treemaker');
      expect(useWorkspaceStore.getState().designMethod).toBe('treemaker');
      expect(useWorkspaceStore.getState().designMethod).not.toBe('none');
      expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(editCp);
      // The CP wasm handle must not be released, or the kept document is dead.
      expect(oristudioCpMocks.releaseOristudioCpDocument).not.toHaveBeenCalled();

      // Box-pleated: same guarantee via the BP creation path.
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      expect(useWorkspaceStore.getState().oristudioBpDocument).not.toBeNull();
      expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(editCp);
      expect(oristudioCpMocks.releaseOristudioCpDocument).not.toHaveBeenCalled();
    });

    it('choosing Circle-packed creates a TreeMaker design and clears the chooser', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      useWorkspaceStore.getState().startNewDesign();

      await useWorkspaceStore.getState().chooseDesignMethod('treemaker');

      const state = useWorkspaceStore.getState();
      expect(state.designMethod).toBe('treemaker');
      expect(state.designMethod).not.toBe('none');
    });

    it('creating a TreeMaker project after a Box-pleat design resets the method', async () => {
      useWorkspaceStore.setState({ engineReady: true, status: 'ready' });
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      expect(useWorkspaceStore.getState().designMethod).toBe('box-pleat');
      expect(useWorkspaceStore.getState().oristudioBpDocument).not.toBeNull();

      // Skip the discard confirmation this test isn't exercising.
      useWorkspaceStore.setState({ dirty: false });
      await useWorkspaceStore.getState().createNewProject();

      expect(useWorkspaceStore.getState().designMethod).toBe('treemaker');
      expect(useWorkspaceStore.getState().designMethod).not.toBe('none');
      expect(useWorkspaceStore.getState().oristudioBpDocument).toBeNull();
    });

    it('applies an optimizer result as exactly one undoable step', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const before = useWorkspaceStore.getState().oristudioBpDocument;
      useWorkspaceStore.setState({ oristudioBpHistoryPast: [], oristudioBpHistoryFuture: [] });
      // The snapshot the history entry must capture is the state *before* the
      // run, so the export mocked here is the pre-optimize project.
      bpMocks.exportOristudioBpProjectAsBps.mockResolvedValueOnce('{"before":"optimize"}');
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
      expect(state.oristudioBpDocument).toBe(optimized);
      expect(state.oristudioBpDocument).not.toBe(before);
      expect(state.oristudioBpHistoryPast).toHaveLength(1);
      expect(state.oristudioBpHistoryPast[0].snapshot.bps).toBe('{"before":"optimize"}');
      expect(state.oristudioBpBusy).toBe(false);
      // The sheet resized and every flap moved, so the packing pane is asked to
      // re-fit its camera around the result.
      expect(state.oristudioBpViewportFitRequestId).toBe(1);
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
      const tree = useWorkspaceStore.getState().oristudioBpDocument!.snapshot.tree;
      const leaves = tree.vertices.filter((vertex) => vertex.isLeaf);
      // The blank design has two leaves; pair them across a vertical axis.
      useWorkspaceStore.setState({
        oristudioBpSymmetry: {
          enabled: true,
          fold: 'book',
          angle: 90,
          loc: { x: tree.sheet.width / 2, y: tree.sheet.height / 2 },
          pairs: [{ v1: leaves[0].id, v2: leaves[1].id }],
        },
      });
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
      const document = useWorkspaceStore.getState().oristudioBpDocument!;
      const tree = document.snapshot.tree;
      // A leaf that is neither on the mirror line nor opposite another one has
      // no mirror to give, so the run must say so rather than quietly drop it.
      useWorkspaceStore.setState({
        oristudioBpDocument: {
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
        oristudioBpSymmetry: {
          enabled: true,
          fold: 'book',
          angle: 90,
          loc: { x: tree.sheet.width / 2, y: tree.sheet.height / 2 },
          pairs: [],
        },
      } as never);

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
      expect(useWorkspaceStore.getState().oristudioBpError).toMatch(/mirrors/i);
    });

    it('mirrors in random mode too, since that discards the packing not the tree', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const tree = useWorkspaceStore.getState().oristudioBpDocument!.snapshot.tree;
      const leaves = tree.vertices.filter((vertex) => vertex.isLeaf).map((vertex) => vertex.id);
      useWorkspaceStore.setState({
        oristudioBpSymmetry: {
          enabled: true,
          fold: 'book',
          angle: 90,
          loc: { x: tree.sheet.width / 2, y: tree.sheet.height / 2 },
          pairs: [{ v1: leaves[0], v2: leaves[1] }],
        },
      });

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
      const before = useWorkspaceStore.getState().oristudioBpDocument;
      useWorkspaceStore.setState({ oristudioBpHistoryPast: [], oristudioBpHistoryFuture: [] });
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
      expect(state.oristudioBpDocument).toBe(before);
      expect(state.oristudioBpHistoryPast).toHaveLength(0);
      // Aborting is a user action, so nothing is surfaced as a failure.
      expect(state.oristudioBpError).toBeNull();
      expect(state.oristudioBpBusy).toBe(false);
      // Nothing changed on screen, so the camera must stay where the user left it.
      expect(state.oristudioBpViewportFitRequestId).toBe(0);
    });

    it('reports a failed optimizer run without recording history', async () => {
      useWorkspaceStore.getState().startNewDesign();
      await useWorkspaceStore.getState().chooseDesignMethod('box-pleat');
      const before = useWorkspaceStore.getState().oristudioBpDocument;
      useWorkspaceStore.setState({ oristudioBpHistoryPast: [], oristudioBpHistoryFuture: [] });
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
      expect(state.oristudioBpDocument).toBe(before);
      expect(state.oristudioBpHistoryPast).toHaveLength(0);
      expect(state.oristudioBpError).toBe('Solution exceeds maximal sheet size.');
      expect(state.oristudioBpBusy).toBe(false);
    });

    it('opening a file clears a pending design choice', async () => {
      useWorkspaceStore.getState().startNewDesign();
      expect(useWorkspaceStore.getState().designMethod).toBe('none');

      await useWorkspaceStore.getState().loadProjectText('native tree tmd5', {
        filename: 'sample.osf',
      });

      expect(useWorkspaceStore.getState().designMethod).not.toBe('none');
    });
  });
});
