/**
 * The step tree of a Fold sequence, indexed: who folds from whom, the path to
 * a node, the active path, and the order replay walks (plan D6).
 *
 * The document stores the tree flat and parent-linked, siblings in the order
 * they were made. A document the reader produced, or one the edits in
 * `foldSequenceEdits` made, is always a tree: every parent exists and every
 * path reaches the sheet. These functions assume that and never repair it;
 * the reader is where a damaged tree is pruned.
 *
 * Pure: no React, no store.
 */

import {
  isKnownMark,
  isLockedStep,
  type FoldMark,
  type FoldSequenceDocument,
  type FoldStepNode,
} from './foldSequenceDocument';

/**
 * The key of the flat sheet wherever nodes are keyed by their parent — an
 * active child, a list of children. No node id is empty (the reader drops one
 * that is), so it names no node.
 */
export const FOLD_SHEET_KEY = '';

/** Which child of each node — or of the sheet, {@link FOLD_SHEET_KEY} — the active path takes. */
export type FoldActiveChildren = Readonly<Record<string, string>>;

export interface FoldStepTree {
  readonly byId: ReadonlyMap<string, FoldStepNode>;
  /** Each node's children, and the sheet's under {@link FOLD_SHEET_KEY}, in the order they were made. */
  readonly children: ReadonlyMap<string, readonly FoldStepNode[]>;
}

const NO_CHILDREN: readonly FoldStepNode[] = [];

/** The key a node is listed under: its parent's id, or the sheet's. */
export function parentKey(node: FoldStepNode): string {
  return node.parent ?? FOLD_SHEET_KEY;
}

const TREES = new WeakMap<readonly FoldStepNode[], FoldStepTree>();

/**
 * The tree of `steps`. Memoised on the array, which a document never mutates:
 * undo snapshots, replay and the reader state ask of the same steps many
 * times.
 */
export function foldStepTree(steps: readonly FoldStepNode[]): FoldStepTree {
  const known = TREES.get(steps);
  if (known) return known;
  const byId = new Map<string, FoldStepNode>();
  const children = new Map<string, FoldStepNode[]>();
  for (const node of steps) {
    byId.set(node.id, node);
    const key = parentKey(node);
    const siblings = children.get(key);
    if (siblings) siblings.push(node);
    else children.set(key, [node]);
  }
  const tree = { byId, children };
  TREES.set(steps, tree);
  return tree;
}

/** The children of a node, or of the sheet for `null` (or its key), in the order they were made. */
export function childrenOf(tree: FoldStepTree, id: string | null): readonly FoldStepNode[] {
  return tree.children.get(id ?? FOLD_SHEET_KEY) ?? NO_CHILDREN;
}

/** The path from the sheet to `id`, the first step first and `id` last; null for no such node. */
export function pathTo(tree: FoldStepTree, id: string): FoldStepNode[] | null {
  const path: FoldStepNode[] = [];
  let node = tree.byId.get(id);
  if (!node) return null;
  // Bounded by the node count, so a tree a caller damaged cannot loop.
  for (let guard = tree.byId.size; node && guard >= 0; guard -= 1) {
    path.push(node);
    node = node.parent === null ? undefined : tree.byId.get(node.parent);
  }
  return path.reverse();
}

/**
 * The steps from `first` to `last` on one path, both included, `first`
 * first; null when either is no node, or `last` does not fold from `first`.
 */
export function pathBetween(tree: FoldStepTree, first: string, last: string): FoldStepNode[] | null {
  const path = pathTo(tree, last);
  const from = path?.findIndex((node) => node.id === first) ?? -1;
  return path && from >= 0 ? path.slice(from) : null;
}

/** `id` and every node that folds from it; empty for no such node. */
export function subtreeIds(tree: FoldStepTree, id: string): Set<string> {
  const ids = new Set<string>();
  if (!tree.byId.has(id)) return ids;
  const queue = [id];
  for (let next = queue.pop(); next !== undefined; next = queue.pop()) {
    ids.add(next);
    for (const child of childrenOf(tree, next)) queue.push(child.id);
  }
  return ids;
}

/**
 * The child the active path takes from a node, or from the sheet for `null`:
 * the one `activeChild` names when it is still a child there, else the newest
 * (plan D6: an active child that is gone is dropped, and the newest applies).
 */
export function activeChildOf(
  tree: FoldStepTree,
  activeChild: FoldActiveChildren,
  id: string | null
): FoldStepNode | null {
  const children = childrenOf(tree, id);
  const named = activeChild[id ?? FOLD_SHEET_KEY];
  return children.find((child) => child.id === named) ?? children[children.length - 1] ?? null;
}

/**
 * The active path: from the sheet, through each node's active child, to a
 * tip. It is what exports, the step strip and Send to Edit follow.
 */
export function activePath(tree: FoldStepTree, activeChild: FoldActiveChildren): FoldStepNode[] {
  const path: FoldStepNode[] = [];
  for (
    let node = activeChildOf(tree, activeChild, null);
    node && path.length < tree.byId.size;
    node = activeChildOf(tree, activeChild, node.id)
  ) {
    path.push(node);
  }
  return path;
}

/**
 * Every node in the order replay walks it: `first` (the active path) as
 * given, then the rest breadth-first from the sheet, siblings in the order
 * they were made. A node always comes after its parent, given `first` is a
 * path from the sheet.
 */
export function replayOrder(tree: FoldStepTree, first: readonly FoldStepNode[]): FoldStepNode[] {
  const order = [...first];
  const seen = new Set(first.map((node) => node.id));
  const queue: (string | null)[] = [null];
  for (let at = 0; at < queue.length; at += 1) {
    for (const child of childrenOf(tree, queue[at])) {
      queue.push(child.id);
      if (!seen.has(child.id)) {
        seen.add(child.id);
        order.push(child);
      }
    }
  }
  return order;
}

/**
 * The nodes that are locked by what the document holds: every node this
 * build cannot read, and everything that folds from one. None of them can be
 * replayed or edited; all of them can be deleted.
 */
export function lockedIds(tree: FoldStepTree): Set<string> {
  const locked = new Set<string>();
  for (const node of tree.byId.values()) {
    if (isLockedStep(node)) for (const id of subtreeIds(tree, node.id)) locked.add(id);
  }
  return locked;
}

/**
 * The marks a reader sees at `id` — or at the flat sheet for `null`: the
 * sheet's, then those made on each step of its path, oldest first. A mark is
 * visible to the node it was made on and to that node's descendants (plan
 * D6). Marks this build cannot read are left out.
 */
export function visibleMarks(document: FoldSequenceDocument, id: string | null): FoldMark[] {
  const path = id === null ? [] : (pathTo(foldStepTree(document.steps), id) ?? []);
  const entries = [
    ...(document.sheetMarks ?? []),
    ...path.flatMap((node) => (isLockedStep(node) ? [] : (node.marks ?? []))),
  ];
  return entries.filter(isKnownMark);
}
