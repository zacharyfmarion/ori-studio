import { patchTreemakerDesign, selectProject, selectSelection } from '../designTabs';
import { projectFromSnapshot } from '../../../engine/snapshotMapper';
import { clampPaperPoint, type Point } from '../../../lib/geometry';
import {
  buildCpLineClipboardPayload,
  offsetCpLineSegmentsForPaste,
  placeCpLineSegmentsAt,
} from '../../../lib/creasePatternClipboard';
import type { Selection, TreeProject } from '../../../lib/sampleProject';
import { toast } from 'sonner';
import i18n from '../../../i18n';
import { EDIT_PATH, enlargedStepTakesNoArea } from '../../../diagram/annotate/annotateTools';
import { stepById, type DiagramDocument } from '../../../diagram/document/diagramDocument';
import { annotationActionEdit } from '../../../diagram/annotate/annotationActions';
import {
  annotationClipboard,
  copiedView,
  pastedAnnotations,
  pastedOnto,
} from '../../../diagram/annotate/annotationClipboard';
import { applyAnnotationEdit } from '../../../diagram/annotate/applyAnnotationEdit';
import { canCopyDiagramAnnotation, canPasteDiagramAnnotations, selectedDiagramAnnotation } from '../diagramState';
import { selectedEdgeIds, selectedNodeIds } from '../../../lib/selection';
import {
  engineError,
  ensureTreeHandle,
  syncTreemakerProject,
  statusAfterEdit,
} from '../engineRuntime';
import { staleFoldArtifactResourceState } from '../foldArtifactResource';
import type {
  ClipboardEdge,
  ClipboardNode,
  ClipboardSlice,
  TreeClipboardPayload,
  WorkspaceSliceCreator,
} from '../types';

function offsetPoint(point: Point, pasteCount: number): Point {
  const offset = 0.04 * ((pasteCount % 6) + 1);
  return clampPaperPoint({ x: point.x + offset, y: point.y - offset });
}

function buildClipboardPayload(
  project: TreeProject,
  selection: Selection
): TreeClipboardPayload | null {
  const explicitNodeIds = selectedNodeIds(selection);
  const explicitEdgeIds = selectedEdgeIds(selection);
  const selectedEdges = project.edges.filter((edge) => explicitEdgeIds.includes(edge.id));
  const nodeIds = new Set(explicitNodeIds);
  selectedEdges.forEach((edge) => {
    nodeIds.add(edge.nodes[0]);
    nodeIds.add(edge.nodes[1]);
  });

  const nodes = project.nodes
    .filter((node) => nodeIds.has(node.id))
    .map<ClipboardNode>((node) => ({
      sourceId: node.id,
      label: node.label,
      loc: node.loc,
    }));

  const edges = project.edges
    .filter(
      (edge) =>
        explicitEdgeIds.includes(edge.id) ||
        (nodeIds.has(edge.nodes[0]) && nodeIds.has(edge.nodes[1]))
    )
    .map<ClipboardEdge>((edge) => ({
      sourceId: edge.id,
      sourceNodes: edge.nodes,
      label: edge.label,
      length: edge.length,
      strain: edge.strain,
      stiffness: edge.stiffness,
    }));

  return nodes.length > 0 || edges.length > 0 ? { kind: 'tree', nodes, edges } : null;
}

/** The view a step's marks are drawn in, while they are in step with its picture (Revision 2): what a copy remembers. */
function copiedViewOf(diagram: DiagramDocument | null, stepId: string) {
  const step = diagram ? stepById(diagram, stepId) : null;
  return step ? copiedView(step) : undefined;
}

/** The pastes of annotations, counted: `diagramPasted`'s nonce. */
let diagramPastes = 0;

export const createClipboardSlice: WorkspaceSliceCreator<ClipboardSlice> = (set, get) => ({
  clipboard: null,
  clipboardPasteCount: 0,

  copySelection: () => {
    // The Diagram's own marks, never the tree's: the diagram is what is on screen.
    if (get().activeEditingContext === 'diagram') {
      const annotation = canCopyDiagramAnnotation(get()) ? selectedDiagramAnnotation(get()) : null;
      const stepId = get().diagramSelectedStepId;
      if (annotation && stepId !== null) {
        set({ clipboard: annotationClipboard([annotation], stepId, { view: copiedViewOf(get().diagram, stepId) }), clipboardPasteCount: 0 });
      }
      return;
    }
    if (get().activeEditingContext === 'crease-pattern') {
      const clipboard = buildCpLineClipboardPayload(
        get().oristudioCpDocument?.document,
        get().oristudioCpSelection
      );
      if (!clipboard) return;
      set({
        clipboard,
        clipboardPasteCount: 0,
        error: null,
        projectMessage: `Copied ${clipboard.lines.length} CP lines`,
      });
      return;
    }
    if (get().activeEditingContext === 'crease-pattern') {
      set({
        error: {
          code: 'invalid_operation',
          message: 'Copy is unavailable for this document',
        },
      });
      return;
    }
    const clipboard = buildClipboardPayload(selectProject(get()), selectSelection(get()));
    if (!clipboard) return;
    set({
      clipboard,
      clipboardPasteCount: 0,
      projectMessage: `Copied ${clipboard.nodes.length} nodes and ${clipboard.edges.length} edges`,
    });
  },

  cutSelection: async () => {
    if (get().activeEditingContext === 'diagram') {
      // Taken out as Delete takes it — the whole annotation, Edit Path's node
      // or not — onto a clipboard whose first paste on this step puts it back.
      const annotation = canCopyDiagramAnnotation(get()) ? selectedDiagramAnnotation(get()) : null;
      const stepId = get().diagramSelectedStepId;
      if (!annotation || stepId === null || !canPasteDiagramAnnotations(get())) return;
      // The view it was drawn in, as it was before it was taken out.
      const view = copiedViewOf(get().diagram, stepId);
      const cut = applyAnnotationEdit(get(), stepId, { ...annotationActionEdit('delete', annotation.id), label: 'Cut annotation' });
      if (cut) set({ clipboard: annotationClipboard([annotation], stepId, { cut: true, view }), clipboardPasteCount: 0 });
      return;
    }
    if (get().activeEditingContext === 'crease-pattern') {
      set({
        error: {
          code: 'invalid_operation',
          message: 'Cut is only available for tree selections',
        },
      });
      return;
    }
    get().copySelection();
    if (get().clipboard?.kind !== 'tree') return;
    await get().deleteSelection();
  },

  pasteClipboard: async (at) => {
    if (get().activeEditingContext === 'diagram') {
      // On the step open in Annotate, the first copy selected with Select in
      // hand to move it — Edit Path kept — as a press on the list selects.
      const clipboard = get().clipboard;
      const stepId = get().diagramSelectedStepId;
      if (clipboard?.kind !== 'diagram-annotations' || stepId === null || !canPasteDiagramAnnotations(get())) return;
      // A step is enlarged or holds areas, not both (Revision 2): an area pasted on an enlarged step is left out.
      const target = get().diagram ? stepById(get().diagram!, stepId) : undefined;
      // On the picture they came from, on the same paper: an enlarged step's window or its whole picture.
      const copies = pastedAnnotations(clipboard, stepId, undefined, target ?? undefined);
      const pasted = target?.zoom ? copies.filter((annotation) => annotation.kind !== 'zoom') : copies;
      if (pasted.length < copies.length) toast.message(enlargedStepTakesNoArea(i18n.t));
      if (pasted.length === 0) return;
      const label = pasted.length === 1 ? 'Paste annotation' : 'Paste annotations';
      const changed = get().editDiagramAnnotations(stepId, label, (list) => [...list, ...pasted], {
        select: pasted[0]?.id ?? null,
      });
      if (!changed) return;
      // Told to the step's canvas, which steps back to show it if it lies out of view (18d review).
      set({
        clipboard: pastedOnto(clipboard, stepId),
        diagramPasted: { stepId, ids: pasted.map(({ id }) => id), nonce: (diagramPastes += 1) },
      });
      if (get().diagramAnnotateTool !== EDIT_PATH) get().setDiagramAnnotateTool(null);
      return;
    }
    if (get().activeEditingContext === 'crease-pattern') {
      const clipboard = get().clipboard;
      if (!clipboard || clipboard.kind !== 'cp-lines' || clipboard.lines.length === 0) return;
      // Two placements, and which one applies is decided by whether the caller
      // had a point at all. A right-click knows where it happened, so the paste
      // lands there; Cmd+V does not, so it cascades off the copy origin the way
      // it always has.
      const segments = at
        ? placeCpLineSegmentsAt(clipboard.lines, at)
        : offsetCpLineSegmentsForPaste(clipboard.lines, get().clipboardPasteCount);
      const pasted = await get().insertOristudioCpLineSegments(segments, 'Paste CP lines');
      if (!pasted) return;
      set({
        // The counter only advances for a cascading paste. It exists so repeats
        // do not stack, and a placed paste answers that question itself — while
        // *bumping* it would make the next Cmd+V skip a step for no reason the
        // user could see.
        clipboardPasteCount: at ? get().clipboardPasteCount : get().clipboardPasteCount + 1,
        error: null,
        projectMessage: `Pasted ${segments.length} CP lines`,
      });
      return;
    }
    if (get().activeEditingContext === 'crease-pattern') {
      set({
        error: {
          code: 'invalid_operation',
          message: 'Paste is unavailable for this document',
        },
      });
      return;
    }
    const clipboard = get().clipboard;
    if (!clipboard || clipboard.kind !== 'tree' || clipboard.nodes.length === 0) return;
    set({ error: null });

    const checkpoint = await get().beginHistoryCheckpoint();
    try {
      const { api, treeHandle, initializedSnapshot } = await ensureTreeHandle();
      if (initializedSnapshot) {
        set(syncTreemakerProject(get(), initializedSnapshot, selectProject(get()).title));
      }

      const project = selectProject(get());
      const sourceNodes = clipboard.nodes;
      const sourceNodeIds = new Set(sourceNodes.map((node) => node.sourceId));
      const sourceById = new Map(sourceNodes.map((node) => [node.sourceId, node]));
      const mappedIds = new Map<number, number>();
      const createdFromEdge = new Set<number>();
      const selection = selectSelection(get());
      const attachTarget =
        selection.kind === 'node'
          ? selection.id
          : project.nodes.length > 0
            ? project.nodes[0].id
            : undefined;
      const root = sourceNodes[0];
      let latestSnapshot = initializedSnapshot;

      const applyEdgeMetadata = async (createdEdgeId: number | undefined, edge?: ClipboardEdge) => {
        if (!createdEdgeId || !edge) return;
        const report = await api.applyEdit(treeHandle, {
          type: 'update_edge',
          id: createdEdgeId,
          label: edge.label,
          length: edge.length,
          strain: edge.strain,
          stiffness: edge.stiffness,
        });
        latestSnapshot = report.snapshot;
      };

      const addNode = async (node: ClipboardNode, connectTo?: number, edge?: ClipboardEdge) => {
        const report = await api.applyEdit(treeHandle, {
          type: 'add_node',
          label: node.label,
          loc: offsetPoint(node.loc, get().clipboardPasteCount),
          connect_to: connectTo,
          edge_length: edge?.length ?? (connectTo === undefined ? undefined : 1),
        });
        if (report.created_node === undefined) {
          throw new Error('Paste did not create a node');
        }
        mappedIds.set(node.sourceId, report.created_node);
        latestSnapshot = report.snapshot;
        await applyEdgeMetadata(report.created_edge, edge);
        if (edge) createdFromEdge.add(edge.sourceId);
      };

      await addNode(root, attachTarget);

      while (mappedIds.size < sourceNodes.length) {
        const bridge = clipboard.edges.find((edge) => {
          const [a, b] = edge.sourceNodes;
          return (
            sourceNodeIds.has(a) &&
            sourceNodeIds.has(b) &&
            ((mappedIds.has(a) && !mappedIds.has(b)) || (mappedIds.has(b) && !mappedIds.has(a)))
          );
        });

        if (bridge) {
          const [a, b] = bridge.sourceNodes;
          const known = mappedIds.has(a) ? a : b;
          const nextSourceId = known === a ? b : a;
          const nextNode = sourceById.get(nextSourceId);
          const connectTo = mappedIds.get(known);
          if (!nextNode || connectTo === undefined) break;
          await addNode(nextNode, connectTo, bridge);
          continue;
        }

        const nextNode = sourceNodes.find((node) => !mappedIds.has(node.sourceId));
        const connectTo = mappedIds.get(root.sourceId);
        if (!nextNode || connectTo === undefined) break;
        await addNode(nextNode, connectTo);
      }

      for (const edge of clipboard.edges) {
        if (createdFromEdge.has(edge.sourceId)) continue;
        const node1 = mappedIds.get(edge.sourceNodes[0]);
        const node2 = mappedIds.get(edge.sourceNodes[1]);
        if (node1 === undefined || node2 === undefined) continue;
        const report = await api.applyEdit(treeHandle, {
          type: 'add_edge',
          node1,
          node2,
          label: edge.label,
          length: edge.length,
        });
        latestSnapshot = report.snapshot;
        await applyEdgeMetadata(report.created_edge, edge);
      }

      if (!latestSnapshot) latestSnapshot = await api.snapshot(treeHandle);
      const pastedNodes = Array.from(mappedIds.values()).sort((a, b) => a - b);
      set({
      ...patchTreemakerDesign(get(), {
        project: projectFromSnapshot(latestSnapshot, selectProject(get()).title),
        selection:
          pastedNodes.length === 1
            ? { kind: 'node', id: pastedNodes[0] }
            : {
                kind: 'multi',
                nodes: pastedNodes,
                edges: [],
                paths: [],
                creases: [],
                facets: [],
                conditions: [],
              },
        lastOptimization: null
      }),
        status: statusAfterEdit(latestSnapshot),
        dirty: true,
        error: null,
        ...staleFoldArtifactResourceState(get().foldArtifactRevision),
        clipboardPasteCount: get().clipboardPasteCount + 1,
        projectMessage: `Pasted ${pastedNodes.length} nodes`});
      get().commitHistoryCheckpoint(checkpoint, 'Paste');
    } catch (error) {
      set({ status: 'error', error: engineError(error) });
    }
  },
});
