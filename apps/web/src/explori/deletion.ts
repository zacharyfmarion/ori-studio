import type { ExploriDocument } from './document';
import type { TreeSelectionTarget } from '../tree-editor/model';

/**
 * Which node a delete would remove, or null when the selection names nothing
 * deletable.
 *
 * The same rule box-pleat follows, over a document rather than an engine
 * snapshot: the root has no edge to remove with it, and an interior node cannot
 * go because there is no sensible way to reattach what hangs below it. An edge
 * selection resolves to the node it leads *away* from the root, which is the one
 * a user pointing at a branch means.
 */
export function deletableExploriNodeId(
  document: ExploriDocument,
  selection: TreeSelectionTarget | null
): number | null {
  if (!selection) return null;
  const degreeOf = (id: number) =>
    document.edges.filter((edge) => edge.vertices.includes(id)).length;

  if (selection.kind === 'vertex') {
    if (selection.id === 0) return null;
    // Existence is checked, not assumed: a node with no edges and a node that
    // is not there both have degree zero, and only one of them is deletable.
    if (!document.nodes.some((node) => node.id === selection.id)) return null;
    return degreeOf(selection.id) <= 1 ? selection.id : null;
  }

  const edge = document.edges.find((candidate) => candidate.id === selection.id);
  if (!edge) return null;
  // The endpoint further from the root. Both endpoints of a leaf edge qualify
  // only when one of them is a leaf, which is the case this resolves.
  const [a, b] = edge.vertices;
  const candidates = [a, b].filter((id) => id !== 0 && degreeOf(id) <= 1);
  return candidates[0] ?? null;
}
