import type { ConditionKind, TreeSnapshot } from '../../../engine/types';
import { projectFromSnapshot } from '../../../engine/snapshotMapper';
import {
  selectedEdgeIds,
  selectedNodeIds,
  selectedPathIds,
} from '../../../lib/selection';
import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';
import {
  engineError,
  ensureTreeHandle,
  projectStateFromSnapshot,
  statusAfterEdit,
} from '../engineRuntime';
import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import type { ConditionSlice, WorkspaceSliceCreator } from '../types';

export const createConditionSlice: WorkspaceSliceCreator<ConditionSlice> = (set, get) => {
  function staleTreeDerivedArtifacts() {
    return {
      ...staleFoldArtifactResourceState(get().foldArtifactRevision),
      activeEditingSurface: 'tree' as const,
      oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
    };
  }

  function rejectReadOnly() {
    if (get().documentMode === 'tree') return false;
    set({
      error: {
        code: 'invalid_operation',
        message: 'Conditions require an editable tree document',
      },
    });
    return true;
  }

  async function applyConditionEdit(
    edit:
      | { type: 'update_paper'; width: number; height: number }
      | {
          type: 'set_symmetry';
          has_symmetry: boolean;
          sym_loc?: { x: number; y: number };
          sym_angle?: number;
        }
      | { type: 'add_condition'; kind: ConditionKind }
      | { type: 'update_condition'; id: number; kind: ConditionKind }
      | { type: 'delete_condition'; id: number },
    label: string
  ) {
    if (rejectReadOnly()) return;
    set({ error: null });
    const checkpoint = await get().beginHistoryCheckpoint();
    try {
      const { api, treeHandle, initializedSnapshot } = await ensureTreeHandle();
      if (initializedSnapshot) {
        set(projectStateFromSnapshot(initializedSnapshot, get().project.title));
      }
      const report = await api.applyEdit(treeHandle, edit);
      set({
        project: projectFromSnapshot(report.snapshot, get().project.title),
        status: statusAfterEdit(report.snapshot),
        dirty: true,
        error: null,
        lastOptimization: null,
        ...staleTreeDerivedArtifacts(),
        projectMessage: label,
      });
      get().commitHistoryCheckpoint(checkpoint, label);
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
    }
  }

  async function deleteConditionIds(ids: number[], label: string) {
    if (rejectReadOnly()) return;
    const sortedIds = Array.from(new Set(ids)).sort((a, b) => b - a);
    if (sortedIds.length === 0) {
      set({ projectMessage: 'No matching conditions' });
      return;
    }
    set({ error: null });
    const checkpoint = await get().beginHistoryCheckpoint();
    try {
      const { api, treeHandle } = await ensureTreeHandle();
      let snapshot: TreeSnapshot | null = null;
      for (const id of sortedIds) {
        const report = await api.applyEdit(treeHandle, { type: 'delete_condition', id });
        snapshot = report.snapshot;
      }
      if (!snapshot) return;
      set({
        project: projectFromSnapshot(snapshot, get().project.title),
        selection: { kind: 'tree' },
        status: statusAfterEdit(snapshot),
        dirty: true,
        error: null,
        lastOptimization: null,
        ...staleTreeDerivedArtifacts(),
        projectMessage: label,
      });
      get().commitHistoryCheckpoint(checkpoint, label);
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
    }
  }

  function pathKey(a: number, b: number): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  function conditionRefsNode(kind: ConditionKind, nodeIds: Set<number>): boolean {
    switch (kind.type) {
      case 'node_combo':
      case 'node_fixed':
      case 'node_on_corner':
      case 'node_on_edge':
      case 'node_symmetric':
        return nodeIds.has(kind.node);
      case 'nodes_paired':
      case 'path_active':
      case 'path_angle_fixed':
      case 'path_angle_quant':
      case 'path_combo':
        return nodeIds.has(kind.node1) || nodeIds.has(kind.node2);
      case 'nodes_collinear':
        return nodeIds.has(kind.node1) || nodeIds.has(kind.node2) || nodeIds.has(kind.node3);
      case 'edge_length_fixed':
      case 'edges_same_strain':
        return false;
    }
  }

  function conditionRefsEdge(kind: ConditionKind, edgeIds: Set<number>): boolean {
    switch (kind.type) {
      case 'edge_length_fixed':
        return edgeIds.has(kind.edge);
      case 'edges_same_strain':
        return edgeIds.has(kind.edge1) || edgeIds.has(kind.edge2);
      default:
        return false;
    }
  }

  function conditionRefsPath(kind: ConditionKind, pathKeys: Set<string>): boolean {
    switch (kind.type) {
      case 'path_active':
      case 'path_angle_fixed':
      case 'path_angle_quant':
      case 'path_combo':
        return pathKeys.has(pathKey(kind.node1, kind.node2));
      default:
        return false;
    }
  }

  return {
    updatePaper: async (update) => {
      const width = update.width ?? get().project.paper.width;
      const height = update.height ?? get().project.paper.height;
      await applyConditionEdit({ type: 'update_paper', width, height }, 'Updated paper');
    },

    setSymmetry: async (update) => {
      const project = get().project;
      await applyConditionEdit(
        {
          type: 'set_symmetry',
          has_symmetry: update.hasSymmetry ?? project.hasSymmetry,
          sym_loc: update.symLoc ?? project.paper.symLoc,
          sym_angle: update.symAngle ?? project.paper.symAngle,
        },
        'Updated symmetry'
      );
    },

    addCondition: async (kind) => {
      await applyConditionEdit({ type: 'add_condition', kind }, 'Added condition');
    },

    updateCondition: async (id, kind) => {
      await applyConditionEdit({ type: 'update_condition', id, kind }, 'Updated condition');
    },

    deleteCondition: async (id) => {
      await applyConditionEdit({ type: 'delete_condition', id }, 'Removed condition');
    },

    deleteConditionsForSelectedNodes: async () => {
      const nodeIds = new Set(selectedNodeIds(get().selection));
      const ids = get()
        .project.conditions.filter((condition) => conditionRefsNode(condition.kind, nodeIds))
        .map((condition) => condition.id);
      await deleteConditionIds(ids, 'Removed selected node conditions');
    },

    deleteConditionsForSelectedEdges: async () => {
      const edgeIds = new Set(selectedEdgeIds(get().selection));
      const ids = get()
        .project.conditions.filter((condition) => conditionRefsEdge(condition.kind, edgeIds))
        .map((condition) => condition.id);
      await deleteConditionIds(ids, 'Removed selected edge conditions');
    },

    deleteConditionsForSelectedPaths: async () => {
      const pathIds = new Set(selectedPathIds(get().selection));
      const pathKeys = new Set(
        get()
          .project.paths.filter((path) => pathIds.has(path.id))
          .map((path) => pathKey(path.nodes[0], path.nodes[1]))
      );
      const ids = get()
        .project.conditions.filter((condition) => conditionRefsPath(condition.kind, pathKeys))
        .map((condition) => condition.id);
      await deleteConditionIds(ids, 'Removed selected path conditions');
    },

    clearConditions: async () => {
      const ids = get().project.conditions.map((condition) => condition.id);
      await deleteConditionIds(ids, 'Cleared conditions');
    },
  };
};
