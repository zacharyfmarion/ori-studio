import type { FoldDocument } from '../engine/types';

/**
 * Keeping a FOLD document's per-edge arrays in step with its edge list.
 *
 * A FOLD document stores edge data as arrays positionally aligned with
 * `edges_vertices`: the standard `edges_assignment` / `edges_foldAngle`, plus an
 * open-ended set of namespaced extensions (`oristudio:edges_line_colors`,
 * `oriedita:edges_colors`, and whatever is added later). Rebuilding the edge
 * list invalidates every one of them at once.
 *
 * The natural idiom for that rebuild — `{ ...fold, edges_vertices: rebuilt }` —
 * makes carrying stale data the default and remapping the thing an author has to
 * remember, for a set of keys TypeScript cannot see behind an index signature.
 * That has produced the same shipped bug twice: the CP kernel reads
 * `oristudio:edges_line_colors` as the crease type, so an array left in the old
 * order comes back as scrambled creases, with paper borders arriving as
 * mountains and valleys.
 *
 * These two functions are the sanctioned ways to follow such a rebuild. Use
 * {@link remapEdgeExtensionArrays} when the new edges have known provenance, and
 * {@link dropPerEdgeArrays} when the edge list is going away entirely. Prefer
 * them over hand-deleting keys: the point is that no site has to know the
 * current set of extension names.
 */

/**
 * Positionally per-edge extension keys, matched structurally rather than by a
 * hard-coded list so extensions added later are covered without editing this
 * file. Namespaced FOLD keys are `<prefix>:<field>`, and the per-edge ones are
 * exactly those whose field starts with `edges_`.
 */
function isEdgeExtensionKey(key: string): boolean {
  return key.includes(':edges_');
}

/** Standard per-edge arrays, which are typed and so are usually handled directly. */
const STANDARD_PER_EDGE_KEYS = [
  'edges_vertices',
  'edges_assignment',
  'edges_foldAngle',
  'edges_faces',
] as const;

/**
 * Re-index every per-edge extension array onto a rebuilt edge list, where
 * `sourceEdgeIndices[i]` is the source edge that new edge `i` came from.
 *
 * Callers must pass that provenance rather than relying on lengths: a rebuild
 * can split, merge, and reorder edges yet still emit the same *count*, and that
 * is precisely the case the reported bug hit — 228 edges in, 228 out, only the
 * order changed. An array whose length disagrees with the source is stale beyond
 * repair and is dropped, which is safe because the kernel falls back to
 * `edges_assignment` when the line-colour extension is absent.
 *
 * The standard typed arrays are left alone: each caller rebuilds those with
 * semantics of its own (merging assignments for coincident creases, say), and
 * the type system already keeps them visible.
 */
export function remapEdgeExtensionArrays(
  next: FoldDocument,
  source: FoldDocument,
  sourceEdgeCount: number,
  sourceEdgeIndices: number[],
): void {
  for (const [key, value] of Object.entries(source)) {
    if (!isEdgeExtensionKey(key)) continue;
    if (!Array.isArray(value)) continue;
    if (value.length === sourceEdgeCount) {
      next[key] = sourceEdgeIndices.map((index) => value[index]);
    } else {
      delete next[key];
    }
  }
}

/**
 * Drop every per-edge array, standard and extension alike, for a document that
 * no longer carries the edges they describe.
 *
 * Deleting only the typed fields leaves a document asserting colours for edges
 * it does not have — self-contradictory, and a leak of the whole sheet's data
 * into an exported fragment.
 */
export function dropPerEdgeArrays(fold: FoldDocument): void {
  for (const key of STANDARD_PER_EDGE_KEYS) {
    delete fold[key];
  }
  for (const key of Object.keys(fold)) {
    if (isEdgeExtensionKey(key)) delete fold[key];
  }
}
