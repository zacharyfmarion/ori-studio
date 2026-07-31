/**
 * How a tree canvas draws a node dot.
 *
 * Two panes draw trees — the BP tree pane and the TreeMaker design pane — and
 * they share `.tree-node` styling, so they have to agree on what "selected"
 * looks like or the same selection reads differently depending on which pane you
 * are in. The base sizes differ (the design pane draws a slightly larger dot);
 * the emphasis must not.
 *
 * Selection grows and thickens the dot rather than only recolouring it. Colour is
 * the weakest of the cues: on a light theme the ring is the paper colour and
 * carries nothing at all, so size has to say it too.
 */

/** Multiplier applied to a dot's radius while it is selected. */
export const TREE_DOT_SELECTED_SCALE = 1.4;

export interface TreeDotSizes {
  /** Radius of a leaf dot — a flap tip — at rest. */
  leafPx: number;
  /** Radius of a branch dot — a river or the root — at rest. */
  branchPx: number;
}

/**
 * The radius to draw a node dot at, in screen pixels. Callers on a counter-scaled
 * canvas convert the result to world units themselves.
 */
export function treeDotPx(sizes: TreeDotSizes, isLeaf: boolean, selected: boolean): number {
  const base = isLeaf ? sizes.leafPx : sizes.branchPx;
  return selected ? base * TREE_DOT_SELECTED_SCALE : base;
}
