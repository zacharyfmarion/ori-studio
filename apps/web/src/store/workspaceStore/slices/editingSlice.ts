import {
  patchTreemakerDesign,
  selectProject,
  selectSelection,
  selectSymmetryAuthoringPairs,
} from '../designTabs';
import type { TreeEdit, TreeSnapshot } from '../../../engine/types';
import { projectFromSnapshot } from '../../../engine/snapshotMapper';
import {
  selectByIndex as selectionByIndex,
  selectCorridorFacets as corridorFacetSelection,
  selectEverything,
  selectMovableParts as movablePartSelection,
  selectedEdgeIds,
  selectedFacetIds,
  selectedNodeIds,
  selectionCoversAllNodes,
} from '../../../lib/selection';
import {
  addSymmetryAuthoringPair,
  filterSymmetryAuthoringPairs,
  findMirrorEdgeId,
  findMirrorNodeId,
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  symmetryAxisForProject,
  symmetrySide,
} from '../../../lib/symmetryAuthoring';
import { markGeneratedCpLineageStale } from '../../../lib/oristudioCpLineage';
import {
  createBlankTree,
  engineError,
  ensureTreeHandle,
  nextSelectionForEdit,
  syncTreemakerProject,
  statusAfterEdit,
} from '../engineRuntime';
import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import type { EditingSlice, WorkspaceSliceCreator } from '../types';

export const createEditingSlice: WorkspaceSliceCreator<EditingSlice> = (set, get) => {
  function staleTreeDerivedArtifacts() {
    return {
      ...staleFoldArtifactResourceState(get().foldArtifactRevision),
      oristudioCpLineage: markGeneratedCpLineageStale(get().oristudioCpLineage),
    };
  }

  function rejectReadOnly() {
    if (!get().importedCreasePattern) return false;
    set({
      error: {
        code: 'invalid_operation',
        message: 'Imported crease patterns are read-only',
      },
    });
    return true;
  }

  async function requireActiveTree() {
    const result = await ensureTreeHandle();
    if (result.initializedSnapshot) {
      set(syncTreemakerProject(get(), result.initializedSnapshot, selectProject(get()).title));
    }
    return result;
  }

  async function applyCommandEdit(edit: TreeEdit, label: string) {
    if (rejectReadOnly()) return;
    set({ error: null });
    const checkpoint = await get().beginHistoryCheckpoint();
    const selectionBeforeEdit = selectSelection(get());
    try {
      const { api, treeHandle } = await requireActiveTree();
      const report = await api.applyEdit(treeHandle, edit);
      set({
        ...patchTreemakerDesign(get(), {
          project: projectFromSnapshot(report.snapshot, selectProject(get()).title),
          selection:
            report.created_node !== undefined || report.created_edge !== undefined
              ? nextSelectionForEdit(
                  edit,
                  report.snapshot,
                  report.created_node,
                  report.created_edge,
                )
              : selectionBeforeEdit,
          lastOptimization: null,
        }),
        status: statusAfterEdit(report.snapshot),
        dirty: true,
        error: null,
        ...staleTreeDerivedArtifacts(),
        projectMessage: null,
      });
      get().commitHistoryCheckpoint(checkpoint, label);
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
    }
  }

  function selectedEdgesOrMessage(): number[] {
    const edges = selectedEdgeIds(selectSelection(get()));
    if (edges.length === 0) set({ projectMessage: 'Select one or more edges first' });
    return edges;
  }

  function selectedNodesOrMessage(): number[] {
    const nodes = selectedNodeIds(selectSelection(get()));
    if (nodes.length === 0) set({ projectMessage: 'Select one or more nodes first' });
    return nodes;
  }

  return {
    // No state of its own: selection, tool mode and symmetry pairs moved onto the
    // active design tab in phase 2b. Left here they would be inert top-level keys
    // shadowing the real ones — and the compiler would not say so, because a
    // slice's returned literal is contextually typed and loses excess-property
    // checking. `designTabWrites.test.ts` asserts they are gone.
    addNodeAt: async (loc, connectTo) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      if (rejectReadOnly()) return;
      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const report = await api.applyEdit(treeHandle, {
          type: 'add_node',
          loc,
          connect_to: connectTo,
          edge_length: connectTo === undefined ? undefined : 1,
        });
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(report.snapshot, selectProject(get(), designId).title),
              selection: nextSelectionForEdit(
                { type: 'add_node', loc, connect_to: connectTo },
                report.snapshot,
                report.created_node,
                report.created_edge,
              ),
              lastOptimization: null,
            },
            designId,
          ),
          status: statusAfterEdit(report.snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(checkpoint, 'Add node');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    addNodeWithSymmetry: async (loc, connectTo) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      const project = selectProject(get(), designId);
      if (!project.hasSymmetry) {
        await get().addNodeAt(loc, connectTo);
        return;
      }

      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const axis = symmetryAxisForProject(project);
        const snapped = snapPointToSymmetryAxis(loc, axis);
        const parent =
          connectTo === undefined ? null : project.nodes.find((node) => node.id === connectTo);
        const parentSide = parent ? symmetrySide(parent.loc, axis) : 0;
        const parentPair = parent
          ? findMirrorNodeId(project, selectSymmetryAuthoringPairs(get(), designId), parent.id)
          : null;
        const shouldMirror = Boolean(
          parent && !snapped.snapped && (parentSide === 0 || parentPair),
        );
        let snapshot: TreeSnapshot | null = null;
        let selection = selectSelection(get(), designId);
        let authoringPairs = selectSymmetryAuthoringPairs(get(), designId);
        if (parent && parentPair) {
          authoringPairs = addSymmetryAuthoringPair(authoringPairs, parent.id, parentPair);
        }

        const firstReport = await api.applyEdit(treeHandle, {
          type: 'add_node',
          loc: snapped.point,
          connect_to: connectTo,
          edge_length: connectTo === undefined ? undefined : 1,
        });
        snapshot = firstReport.snapshot;
        selection = nextSelectionForEdit(
          { type: 'add_node', loc: snapped.point, connect_to: connectTo },
          snapshot,
          firstReport.created_node,
          firstReport.created_edge,
        );

        if (shouldMirror && firstReport.created_node) {
          const mirroredLoc = reflectPointAcrossSymmetryAxis(snapped.point, axis);
          const mirroredParent = parentSide === 0 ? connectTo : (parentPair ?? undefined);
          const secondReport = await api.applyEdit(treeHandle, {
            type: 'add_node',
            loc: mirroredLoc,
            connect_to: mirroredParent,
            edge_length: mirroredParent === undefined ? undefined : 1,
          });
          snapshot = secondReport.snapshot;

          if (secondReport.created_node) {
            authoringPairs = addSymmetryAuthoringPair(
              authoringPairs,
              firstReport.created_node,
              secondReport.created_node,
            );
            const conditionReport = await api.applyEdit(treeHandle, {
              type: 'add_condition',
              kind: {
                type: 'nodes_paired',
                node1: firstReport.created_node,
                node2: secondReport.created_node,
              },
            });
            snapshot = conditionReport.snapshot;
            selection = {
              kind: 'multi',
              nodes: [firstReport.created_node, secondReport.created_node].sort((a, b) => a - b),
              edges: [],
              paths: [],
              creases: [],
              facets: [],
              conditions: [],
            };
          }
        }

        if (!snapshot) return;
        const addedPair = selection.kind === 'multi' && selection.nodes.length === 2;
        const nextProject = projectFromSnapshot(snapshot, selectProject(get(), designId).title);
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: nextProject,
              symmetryAuthoringPairs: filterSymmetryAuthoringPairs(nextProject, authoringPairs),
              lastOptimization: null,
              selection,
            },
            designId,
          ),
          status: statusAfterEdit(snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
          projectMessage: addedPair
            ? 'Added mirrored branch'
            : snapped.snapped
              ? 'Added axial node'
              : null,
        });
        get().commitHistoryCheckpoint(checkpoint, addedPair ? 'Add mirrored branch' : 'Add node');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    moveNode: async (id, loc) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      if (rejectReadOnly()) return;
      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const edit: TreeEdit = { type: 'move_node', id, loc };
        const report = await api.applyEdit(treeHandle, edit);
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(report.snapshot, selectProject(get(), designId).title),
              selection: nextSelectionForEdit(edit, report.snapshot),
              lastOptimization: null,
            },
            designId,
          ),
          status: statusAfterEdit(report.snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(checkpoint, 'Move node');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    moveNodeWithSymmetry: async (id, loc) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      const project = selectProject(get(), designId);
      const pairedNode = project.hasSymmetry
        ? findMirrorNodeId(project, selectSymmetryAuthoringPairs(get(), designId), id)
        : null;
      if (!pairedNode) {
        await get().moveNode(id, loc);
        return;
      }

      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const axis = symmetryAxisForProject(project);
        const edit: TreeEdit = { type: 'move_node', id, loc };
        const primaryReport = await api.applyEdit(treeHandle, edit);
        const pairedReport = await api.applyEdit(treeHandle, {
          type: 'move_node',
          id: pairedNode,
          loc: reflectPointAcrossSymmetryAxis(loc, axis),
        });
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(
                pairedReport.snapshot,
                selectProject(get(), designId).title,
              ),
              selection: nextSelectionForEdit(edit, primaryReport.snapshot),
              lastOptimization: null,
            },
            designId,
          ),
          status: statusAfterEdit(pairedReport.snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(checkpoint, 'Move mirrored nodes');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    addEdge: async (node1, node2) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      if (rejectReadOnly()) return;
      if (node1 === node2) return;
      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const report = await api.applyEdit(treeHandle, {
          type: 'add_edge',
          node1,
          node2,
          length: 1,
        });
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(report.snapshot, selectProject(get(), designId).title),
              selection: report.created_edge
                ? { kind: 'edge', id: report.created_edge }
                : { kind: 'node', id: node2 },
              lastOptimization: null,
            },
            designId,
          ),
          status: statusAfterEdit(report.snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(checkpoint, 'Add edge');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    updateNodeLabel: async (id, label) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      if (rejectReadOnly()) return;
      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const edit: TreeEdit = { type: 'update_node_label', id, label };
        const report = await api.applyEdit(treeHandle, edit);
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(report.snapshot, selectProject(get(), designId).title),
              selection: nextSelectionForEdit(edit, report.snapshot),
            },
            designId,
          ),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(checkpoint, 'Rename node');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    updateEdge: async (id, update) => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      if (rejectReadOnly()) return;
      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        const edit: TreeEdit = { type: 'update_edge', id, ...update };
        const report = await api.applyEdit(treeHandle, edit);
        const mirrorEdge = findMirrorEdgeId(
          selectProject(get(), designId),
          selectSymmetryAuthoringPairs(get(), designId),
          id,
        );
        const mirrorUpdate = {
          length: update.length,
          stiffness: update.stiffness,
        };
        const shouldUpdateMirror =
          mirrorEdge !== null &&
          (mirrorUpdate.length !== undefined || mirrorUpdate.stiffness !== undefined);
        const finalReport = shouldUpdateMirror
          ? await api.applyEdit(treeHandle, {
              type: 'update_edge',
              id: mirrorEdge,
              ...mirrorUpdate,
            })
          : report;
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(
                finalReport.snapshot,
                selectProject(get(), designId).title,
              ),
              selection: nextSelectionForEdit(edit, report.snapshot),
              lastOptimization: null,
            },
            designId,
          ),
          status: statusAfterEdit(finalReport.snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(
          checkpoint,
          shouldUpdateMirror ? 'Edit mirrored edges' : 'Edit edge',
        );
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    makeSelectedNodeRoot: async () => {
      const nodes = selectedNodeIds(selectSelection(get()));
      if (nodes.length !== 1) {
        set({ projectMessage: 'Select one node to make root' });
        return;
      }
      await applyCommandEdit({ type: 'make_root', node: nodes[0] }, 'Make root');
    },

    splitSelectedEdge: async (distance) => {
      const edges = selectedEdgeIds(selectSelection(get()));
      if (edges.length !== 1) {
        set({ projectMessage: 'Select one edge to split' });
        return;
      }
      await applyCommandEdit({ type: 'split_edge', edge: edges[0], distance }, 'Split edge');
    },

    setSelectedEdgeLengths: async (length) => {
      const edges = selectedEdgesOrMessage();
      if (edges.length === 0) return;
      await applyCommandEdit({ type: 'set_edge_lengths', edges, length }, 'Set edge lengths');
    },

    scaleSelectedEdgeLengths: async (factor) => {
      const edges = selectedEdgesOrMessage();
      if (edges.length === 0) return;
      await applyCommandEdit({ type: 'scale_edge_lengths', edges, factor }, 'Scale edge lengths');
    },

    renormalizeToSelectedEdge: async () => {
      const edges = selectedEdgeIds(selectSelection(get()));
      if (edges.length !== 1) {
        set({ projectMessage: 'Select one edge to renormalize' });
        return;
      }
      await applyCommandEdit(
        { type: 'renormalize_to_edge', edge: edges[0] },
        'Renormalize to edge',
      );
    },

    renormalizeToUnitScale: async () => {
      await applyCommandEdit({ type: 'renormalize_to_unit_scale' }, 'Renormalize to unit scale');
    },

    absorbSelectedNodes: async () => {
      const nodes = selectedNodesOrMessage();
      if (nodes.length === 0) return;
      await applyCommandEdit({ type: 'absorb_nodes', nodes }, 'Absorb nodes');
    },

    absorbRedundantNodes: async () => {
      await applyCommandEdit({ type: 'absorb_redundant_nodes' }, 'Absorb redundant nodes');
    },

    absorbSelectedEdges: async () => {
      const edges = selectedEdgesOrMessage();
      if (edges.length === 0) return;
      await applyCommandEdit({ type: 'absorb_edges', edges }, 'Absorb edges');
    },

    perturbSelectedNodes: async () => {
      const nodes = selectedNodesOrMessage();
      if (nodes.length === 0) return;
      await applyCommandEdit({ type: 'perturb_nodes', nodes }, 'Perturb nodes');
    },

    perturbAllNodes: async () => {
      await applyCommandEdit({ type: 'perturb_all_nodes' }, 'Perturb all nodes');
    },

    removeSelectionStrain: async () => {
      const edges = selectedEdgesOrMessage();
      if (edges.length === 0) return;
      await applyCommandEdit({ type: 'remove_strain', edges }, 'Remove strain');
    },

    removeAllStrain: async () => {
      await applyCommandEdit({ type: 'remove_all_strain' }, 'Remove all strain');
    },

    relieveSelectionStrain: async () => {
      const edges = selectedEdgesOrMessage();
      if (edges.length === 0) return;
      await applyCommandEdit({ type: 'relieve_strain', edges }, 'Relieve strain');
    },

    relieveAllStrain: async () => {
      await applyCommandEdit({ type: 'relieve_all_strain' }, 'Relieve all strain');
    },

    addLargestStubForSelectedNodes: async () => {
      const nodes = selectedNodesOrMessage();
      if (nodes.length === 0) return;
      await applyCommandEdit({ type: 'add_largest_stub_for_nodes', nodes }, 'Add largest stub');
    },

    addLargestStubForSelectedPoly: async () => {
      const facets = selectedFacetIds(selectSelection(get()));
      if (facets.length !== 1) {
        set({ projectMessage: 'Select one generated facet before choosing a stub polygon' });
        return;
      }
      await applyCommandEdit(
        { type: 'add_largest_stub_for_poly', poly: facets[0] },
        'Add largest polygon stub',
      );
    },

    triangulateTree: async () => {
      await applyCommandEdit({ type: 'triangulate_tree' }, 'Triangulate tree');
    },

    deleteSelection: async () => {
      // Addressed write: this action's result belongs to the design it started
      // in, not to whichever tab is showing when the engine answers. See
      // `mapDesignTab`.
      const designId = get().activeDesignId;
      if (rejectReadOnly()) return;
      const selection = selectSelection(get(), designId);
      const nodeIds = selectedNodeIds(selection).sort((a, b) => b - a);
      const edgeIds = selectedEdgeIds(selection).sort((a, b) => b - a);
      if (nodeIds.length === 0 && edgeIds.length === 0) return;
      set({ error: null });
      const checkpoint = await get().beginHistoryCheckpoint();
      try {
        const { api, treeHandle } = await requireActiveTree();
        if (selectionCoversAllNodes(selection, selectProject(get(), designId))) {
          const snapshot = await createBlankTree(api);
          set({
            ...patchTreemakerDesign(
              get(),
              {
                project: projectFromSnapshot(snapshot, selectProject(get(), designId).title),
                selection: { kind: 'tree' },
                lastOptimization: null,
              },
              designId,
            ),
            status: statusAfterEdit(snapshot),
            dirty: true,
            error: null,
            ...staleTreeDerivedArtifacts(),
            projectMessage: 'Cleared design',
          });
          get().commitHistoryCheckpoint(checkpoint, 'Clear design');
          return;
        }

        let snapshot: TreeSnapshot | null = null;
        for (const id of edgeIds) {
          const report = await api.applyEdit(treeHandle, { type: 'delete_edge', id });
          snapshot = report.snapshot;
        }
        for (const id of nodeIds) {
          const report = await api.applyEdit(treeHandle, { type: 'delete_node', id });
          snapshot = report.snapshot;
        }
        if (!snapshot) return;
        set({
          ...patchTreemakerDesign(
            get(),
            {
              project: projectFromSnapshot(snapshot, selectProject(get(), designId).title),
              selection: { kind: 'tree' },
              lastOptimization: null,
            },
            designId,
          ),
          status: statusAfterEdit(snapshot),
          dirty: true,
          error: null,
          ...staleTreeDerivedArtifacts(),
        });
        get().commitHistoryCheckpoint(checkpoint, 'Delete selection');
      } catch (error) {
        set({ status: 'error', error: engineError(error) });
      }
    },

    select: (selection) => set(patchTreemakerDesign(get(), { selection })),
    selectAll: () =>
      set({
        ...patchTreemakerDesign(get(), { selection: selectEverything(selectProject(get())) }),
      }),
    selectNone: () =>
      set({
        ...patchTreemakerDesign(get(), { selection: { kind: 'tree' } }),
      }),
    selectByIndex: (kind, id) => {
      const next = selectionByIndex(selectProject(get()), kind, id);
      set({
        ...patchTreemakerDesign(get(), {
          selection: next,
        }),
        projectMessage: next.kind === 'tree' ? `No ${kind} ${id}` : null,
      });
    },
    selectMovableParts: () => {
      const next = movablePartSelection(selectProject(get()));
      set({
        ...patchTreemakerDesign(get(), {
          selection: next,
        }),
        projectMessage: next.kind === 'tree' ? 'No movable parts' : null,
      });
    },
    selectCorridorFacets: () => {
      const next = corridorFacetSelection(
        selectProject(get()),
        selectedEdgeIds(selectSelection(get())),
      );
      set({
        ...patchTreemakerDesign(get(), {
          selection: next,
        }),
        projectMessage: next.kind === 'tree' ? 'No corridor facets for selected edges' : null,
      });
    },
    selectPathBetweenSelectedNodes: () => {
      const [a, b] = selectedNodeIds(selectSelection(get()));
      if (a === undefined || b === undefined) return;
      const path = selectProject(get()).paths.find(
        (candidate) =>
          (candidate.nodes[0] === a && candidate.nodes[1] === b) ||
          (candidate.nodes[0] === b && candidate.nodes[1] === a),
      );
      if (path)
        set({
          ...patchTreemakerDesign(get(), { selection: { kind: 'path', id: path.id } }),
        });
    },
    setToolMode: (toolMode) =>
      set({
        ...patchTreemakerDesign(get(), {
          toolMode: !get().importedCreasePattern ? toolMode : 'select',
        }),
      }),
  };
};
