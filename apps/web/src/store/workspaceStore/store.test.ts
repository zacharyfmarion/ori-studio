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
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderSnapshot,
  OristudioCpLineSegment,
  OristudioCpOperationDescriptor,
} from '../../engine/oristudioCpTypes';
import { projectFromSnapshot } from '../../engine/snapshotMapper';
import type { FileService, SaveBinaryFileOptions, SaveTextFileOptions } from '../../platform/fileService';
import { DEFAULT_CREASE_COLOR_MODE } from '../../lib/sampleProject';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  emptyOristudioCpSelection,
} from '../../lib/creasePatternViewport';
import {
  activeNativeDocument,
  createNativeCreasePatternProjectFile,
  createNativeTreeProjectFile,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../../lib/nativeProjectFile';
import { importedCpLineage } from '../../lib/oristudioCpLineage';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { useLayoutStore } from '../layoutStore';
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
    documentMode: 'tree',
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
  useWorkspaceStore.setState(initialWorkspaceState, true);
  useLayoutStore.setState(initialLayoutState, true);
  const api = createMockEngineApi(snapshot);
  configureEngine(api);
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

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('workspace store slices', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetStores();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushAsyncWork();
  });

  it('composes project, history, editing, clipboard, conditions, and crease-pattern state', () => {
    const state = useWorkspaceStore.getState();

    expect(state.project.nodes).toEqual([]);
    expect(state.documentMode).toBe('tree');
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
      extensions: ['osf', 'tmd', 'tmd4', 'tmd5', 'fold', 'cp', 'ori', 'orh'],
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
      expect.objectContaining({ segmentId: null, includeUnassigned: true, showBackgroundColor: true })
    );

    await expect(useWorkspaceStore.getState().exportPng(fileService)).resolves.toBe(true);
    expect(exportMocks.renderCreasePatternPng).toHaveBeenCalledWith(
      expect.objectContaining({ edges_vertices: expect.any(Array) }),
      expect.any(Array),
      expect.objectContaining({ segmentId: null, includeUnassigned: true, showBackgroundColor: true })
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
      documentMode: 'crease-pattern',
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
      documentMode: 'tree',
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
      documentMode: 'crease-pattern',
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
      documentMode: 'crease-pattern',
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
    // Simulation faces are inferred in JS (no flat-folding).
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
    expect(oristudioCpMocks.exportOristudioCpDocumentAsFold).toHaveBeenCalledTimes(2);
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
      documentMode: 'crease-pattern',
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

  it('tracks generated folded figures and marks them stale after CP geometry edits', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    useWorkspaceStore.setState({
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
    expect(oristudioCpMocks.getOristudioCpFoldedFigureRenderSnapshot).toHaveBeenCalledWith(
      7,
      'Paper5',
      {
        display_mark: false,
        selected: true,
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
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe(foldedFigure.id);

    await expect(
      useWorkspaceStore.getState().insertOristudioCpLineSegments([
        cpLine({ x: 0, y: 0 }, { x: 1, y: 1 }),
      ])
    ).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpRevision).toBe(1);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]).toMatchObject({
      id: foldedFigure.id,
      handle: 7,
      status: 'stale',
    });

    await expect(useWorkspaceStore.getState().foldAnotherOristudioCpFigure()).resolves.toBe(false);
    expect(oristudioCpMocks.foldOristudioCpFigureAnother).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().oristudioCpError).toContain('Refold');
  });

  it('passes active editable CP line selection into folded figure folding', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'selected-lines.cp',
      path: '/tmp/selected-lines.cp',
    });
    useWorkspaceStore.setState({
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
      .moveOristudioCpFoldedFigure(foldedFigure.id, { x: 12, y: -8 });
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.displayOffset).toEqual({
      x: 12,
      y: -8,
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
      displayOffset: { x: 12, y: -8 },
    });

    const duplicateId = useWorkspaceStore.getState().oristudioCpFoldedFigures[1]?.id;
    if (!duplicateId) throw new Error('Duplicate folded figure was not created');
    await useWorkspaceStore.getState().deleteOristudioCpFoldedFigure(duplicateId);

    expect(oristudioCpMocks.freeOristudioCpFoldedFigure).toHaveBeenCalledWith(8);
    expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toHaveLength(1);
    expect(useWorkspaceStore.getState().oristudioCpActiveFoldedFigureId).toBe(foldedFigure.id);
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

  it('releases folded figure handles when clearing the editable CP document', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0', {
      filename: 'line.cp',
      path: '/tmp/line.cp',
    });
    useWorkspaceStore.setState({
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

  it('refreshes always-on CAMV diagnostics after editable CP mutations', async () => {
    resetStores(seedSnapshot());
    await useWorkspaceStore.getState().loadCreasePatternText('1 0 0 1 0\n2 0 0 0 1', {
      filename: 'lines.cp',
      path: '/tmp/lines.cp',
    });
    useWorkspaceStore.setState({ dirty: false });
    const currentDocument = useWorkspaceStore.getState().oristudioCpDocument;
    if (!currentDocument) throw new Error('expected editable CP document');
    const commandResult: OristudioCpCommandResult = {
      operation: 'CreaseMakeMountain',
      status: 'OracleTested',
      diagnostics: ['Changed 2 line(s)'],
    };
    const camvResult = camvErrorResult();
    oristudioCpMocks.executeOristudioCpCommand
      .mockResolvedValueOnce({
        ...currentDocument,
        lastCommandResult: commandResult,
      })
      .mockResolvedValueOnce({
        ...currentDocument,
        lastCommandResult: camvResult,
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
    expect(oristudioCpMocks.executeOristudioCpCommand).toHaveBeenCalledWith('CheckCamv');
    expect(useWorkspaceStore.getState().oristudioCpDocument?.lastCommandResult).toEqual(
      commandResult
    );
    expect(useWorkspaceStore.getState().oristudioCpCamvResult).toEqual(camvResult);
    expect(useWorkspaceStore.getState().oristudioCpActiveDiagnosticId).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast).toHaveLength(1);
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('keeps editable CP diagnostic checks out of undo history', async () => {
    resetStores(seedSnapshot());
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

    useWorkspaceStore.setState({ activeEditingSurface: 'tree' });
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

    useWorkspaceStore.setState({ activeEditingSurface: 'tree' });
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
      documentMode: 'crease-pattern',
      activeEditingSurface: 'crease-pattern',
      oristudioCpDocument: documentState,
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
      documentMode: 'crease-pattern',
      activeEditingSurface: 'crease-pattern',
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
      documentMode: 'crease-pattern',
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
      documentMode: 'crease-pattern',
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
});
