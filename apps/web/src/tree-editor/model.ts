import type { Point } from '../lib/geometry';

/**
 * The tree an editor surface draws, independent of who owns it.
 *
 * Deliberately a *structural subset* of the box-pleat engine's
 * `OristudioBpTreeView`, so that surface passes its snapshot straight in with no
 * adapter and no copy — the extra fields BP carries (`degree`, `dualFlapId`, the
 * sheet) are simply not this module's business. A surface with no engine builds
 * the same shape by hand.
 */

export interface EditableTreeVertex {
  id: number;
  loc: Point;
  isLeaf: boolean;
  isRoot: boolean;
  /** Author-supplied name. Empty means "fall back to the default label". */
  name: string;
}

export interface EditableTreeEdge {
  id: number;
  vertices: [number, number];
  length: number;
  isLeafEdge: boolean;
  /**
   * Hard ceiling on the length, or null for none.
   *
   * Never shown to the user: box-pleat's is an overflow guard rather than a
   * design constraint, and reads as a meaningless five-digit number. It clamps
   * the field and the drag, silently.
   */
  maxLength: number | null;
}

export interface EditableTree {
  rootVertexId: number | null;
  vertices: readonly EditableTreeVertex[];
  edges: readonly EditableTreeEdge[];
}

/** A vertex move, in tree coordinates. */
export interface TreeVertexUpdate {
  id: number;
  loc: Point;
}

/** An edge length change, paired with the moves that keep the drawing faithful. */
export interface TreeEdgeLengthUpdate {
  edgeId: number;
  length: number;
}

/** What a click on the canvas names. */
export type TreeSelectionTarget = { kind: 'vertex'; id: number } | { kind: 'edge'; id: number };

/**
 * The selection, as the editor needs to see it.
 *
 * Deliberately *not* the surface's own selection type. Box-pleat's is a
 * multi-select that also reaches into flaps, rivers, stretches and devices;
 * imposing a three-armed union on it here would have quietly cost shift-click.
 * The editor only ever asks three questions — what to draw selected, and which
 * single vertex or edge the contextual editors belong to — so those are the
 * three it asks.
 */
export interface TreeSelectionView {
  /** The one selected vertex, or null when none or several are. */
  vertexId: number | null;
  /** The one selected edge, or null when none or several are. */
  edgeId: number | null;
  /** Everything drawn selected, which may exceed what is strictly selected. */
  vertices: ReadonlySet<number>;
  edges: ReadonlySet<number>;
}

export const EMPTY_SELECTION_VIEW: TreeSelectionView = {
  vertexId: null,
  edgeId: null,
  vertices: new Set(),
  edges: new Set(),
};

/** Parent/child maps rooted at the tree's root, for subtree-carrying drags. */
export interface TreeTopology {
  parent: ReadonlyMap<number, number | null>;
  children: ReadonlyMap<number, number[]>;
}

export function treeTopology(tree: EditableTree): TreeTopology {
  const adjacency = new Map<number, number[]>();
  for (const vertex of tree.vertices) adjacency.set(vertex.id, []);
  for (const edge of tree.edges) {
    const [a, b] = edge.vertices;
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }
  const parent = new Map<number, number | null>();
  const children = new Map<number, number[]>();
  const root = tree.rootVertexId;
  if (root !== null) {
    parent.set(root, null);
    children.set(root, []);
    const queue = [root];
    while (queue.length > 0) {
      const current = queue.shift() as number;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (parent.has(neighbor)) continue;
        parent.set(neighbor, current);
        children.set(neighbor, []);
        children.get(current)?.push(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return { parent, children };
}

/** A vertex and everything hanging below it. */
export function subtreeIds(topology: TreeTopology, id: number): number[] {
  const out: number[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    out.push(current);
    for (const child of topology.children.get(current) ?? []) stack.push(child);
  }
  return out;
}
