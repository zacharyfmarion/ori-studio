import {
  reflectPointAcrossSymmetryAxis,
  snapPointToSymmetryAxis,
  symmetrySide,
  type SymmetryAxis,
} from '../lib/symmetryGeometry';
import type { Point } from '../lib/geometry';
import type { TreeSymmetryPair } from '../tree-editor/host';
import type { ExploriDocument } from './document';

/**
 * Mirror draw for an ExplOri tree.
 *
 * The same rules box-pleat's tree follows — a pairing outlives the toggle, a
 * node on the line is its own mirror, a partner is explicit first and inferred
 * from position second — over a document rather than an engine snapshot.
 *
 * The axis is the y-axis and does not move. A box-pleat tree measures its
 * mirror against the sheet it will be packed onto; a query tree has no sheet,
 * so there is nothing for the line to be anywhere *else* relative to.
 */

export const EXPLORI_SYMMETRY_AXIS: SymmetryAxis = { loc: { x: 0, y: 0 }, angle: 90 };

/**
 * How close counts as on the line, in tree units.
 *
 * Larger than box-pleat's 0.02 because these lengths are continuous rather than
 * whole cells: there is no grid to land a node exactly on the axis, so the band
 * has to be wide enough for a hand to hit.
 */
export const EXPLORI_SYMMETRY_TOLERANCE = 0.05;

/** Pair two nodes, dropping whatever pairing either was already in. */
export function addExploriPair(
  pairs: TreeSymmetryPair[],
  a: number,
  b: number,
): TreeSymmetryPair[] {
  if (a === b) return pairs;
  const rest = pairs.filter((pair) => ![pair.v1, pair.v2].some((id) => id === a || id === b));
  return [...rest, { v1: Math.min(a, b), v2: Math.max(a, b) }];
}

/** Drop whatever pairing mentions this node. */
export function removeExploriPair(pairs: TreeSymmetryPair[], nodeId: number): TreeSymmetryPair[] {
  return pairs.filter((pair) => pair.v1 !== nodeId && pair.v2 !== nodeId);
}

/** The node explicitly paired with this one, if any. */
export function explicitExploriPairId(
  pairs: readonly TreeSymmetryPair[],
  nodeId: number,
): number | null {
  for (const pair of pairs) {
    if (pair.v1 === nodeId) return pair.v2;
    if (pair.v2 === nodeId) return pair.v1;
  }
  return null;
}

/**
 * A node's mirror: an explicit pairing first, else the node sitting at the
 * reflected position. A node on the axis mirrors to itself; `null` means the
 * mirror is unresolved and the caller should leave that node alone.
 */
export function mirrorExploriNodeId(
  document: ExploriDocument,
  nodeId: number,
  tolerance = EXPLORI_SYMMETRY_TOLERANCE,
): number | null {
  const explicit = explicitExploriPairId(document.symmetry.pairs, nodeId);
  if (explicit !== null && document.nodes.some((node) => node.id === explicit)) return explicit;
  const loc = document.nodes.find((node) => node.id === nodeId)?.loc;
  if (!loc) return null;
  if (symmetrySide(loc, EXPLORI_SYMMETRY_AXIS, tolerance) === 0) return nodeId;
  const target = reflectPointAcrossSymmetryAxis(loc, EXPLORI_SYMMETRY_AXIS);
  let best: { id: number; distance: number } | null = null;
  for (const node of document.nodes) {
    if (node.id === nodeId) continue;
    const distance = Math.hypot(node.loc.x - target.x, node.loc.y - target.y);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { id: node.id, distance };
    }
  }
  return best?.id ?? null;
}

/**
 * Of the nodes a gesture moves, the ones that must stay in their own half.
 *
 * Exactly the nodes whose partner is *not* also moving: those travel rigidly
 * with the gesture and are free, while one whose partner is being reflected
 * would swap sides with it and turn the drawing inside out.
 *
 * A node already *on* the axis is never held, whatever pairing it carries. It
 * is its own reflection, so "stay clear of the line on your own side" is not a
 * rule it can obey — and the drag, which pins such a node to the line, would
 * then be asking for a position this predicate rejects by construction. That
 * disagreement made a node both pinned and held permanently undraggable: every
 * sample landed it exactly on the axis, and every sample was refused for being
 * inside the clearance band. Reachable two ways — a click at a zoom where the
 * snap lane is narrower than this tolerance, so the node pairs without
 * snapping; and shrinking a near-vertical branch to the length floor, which no
 * clearance check guards.
 */
export function exploriMirrorHeldIds(
  document: ExploriDocument,
  movedIds: readonly number[],
  tolerance = EXPLORI_SYMMETRY_TOLERANCE,
): Set<number> {
  const moved = new Set(movedIds);
  const held = new Set<number>();
  for (const id of movedIds) {
    const loc = document.nodes.find((node) => node.id === id)?.loc;
    if (loc && symmetrySide(loc, EXPLORI_SYMMETRY_AXIS, tolerance) === 0) continue;
    const partner = mirrorExploriNodeId(document, id, tolerance);
    if (partner === null || partner === id || moved.has(partner)) continue;
    held.add(id);
  }
  return held;
}

/**
 * Where a clicked leaf lands, and whether it gets a twin.
 *
 * One answer to both, because they are one decision: a leaf that snapped onto
 * the mirror *is* its own reflection, so pairing it with a second node on the
 * same spot would be a duplicate. Splitting them is how a node ended up beside
 * the axis with `pairs: []` — the caller tested for "on the axis" to decide the
 * twin, and never moved the point.
 *
 * The snap is `snapPointToSymmetryAxis`, which is also what the editor's hover
 * ghost previews with. Same function, same tolerance, so the preview and the
 * commit cannot disagree about where the leaf would go.
 */
export function exploriLeafPlacement(
  symmetryEnabled: boolean,
  loc: Point,
  axisTolerance: number,
): { placed: Point; onAxis: boolean } {
  const snap = snapPointToSymmetryAxis(loc, EXPLORI_SYMMETRY_AXIS, axisTolerance);
  const onAxis = symmetryEnabled && snap.snapped;
  return { placed: onAxis ? snap.point : loc, onAxis };
}
