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
 * node on the line is its own mirror, and a partner is an explicit pair or
 * nothing — over a document rather than an engine snapshot. A pair exists
 * because mirror-add, Pair with mirror or Pair all mirrored made it; position
 * only ever proposes a pair ({@link inferExploriPartner}), never decides one.
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
  b: number
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
  nodeId: number
): number | null {
  for (const pair of pairs) {
    if (pair.v1 === nodeId) return pair.v2;
    if (pair.v2 === nodeId) return pair.v1;
  }
  return null;
}

/**
 * A node's mirror: its explicit pairing, else itself when it sits on the axis,
 * else `null` — the mirror is unresolved and the caller leaves that node alone.
 *
 * Position is not consulted. It used to be a fallback, and that made Unpair a
 * no-op: it moves nothing, so the two nodes were still reflections and the
 * fallback found the partner straight back. See {@link inferExploriPartner}
 * for the on-request matching that replaced it.
 */
export function mirrorExploriNodeId(
  document: ExploriDocument,
  nodeId: number,
  tolerance = EXPLORI_SYMMETRY_TOLERANCE
): number | null {
  const explicit = explicitExploriPairId(document.symmetry.pairs, nodeId);
  if (explicit !== null && document.nodes.some((node) => node.id === explicit)) return explicit;
  const loc = document.nodes.find((node) => node.id === nodeId)?.loc;
  if (!loc) return null;
  return symmetrySide(loc, EXPLORI_SYMMETRY_AXIS, tolerance) === 0 ? nodeId : null;
}

/**
 * The node *Pair with mirror* would pair `nodeId` with, or `null`.
 *
 * Both must be unpaired and off the axis, the candidate must sit within
 * `tolerance` of `nodeId`'s reflection, and the match must be mutual — the
 * candidate's own nearest reflection has to be `nodeId` — so an ambiguous
 * drawing is refused rather than guessed at. Same rule as box-pleat's
 * `inferBpTreeSymmetryPartner`.
 */
export function inferExploriPartner(
  document: ExploriDocument,
  nodeId: number,
  tolerance = EXPLORI_SYMMETRY_TOLERANCE
): number | null {
  const candidate = nearestUnpairedReflection(document, nodeId, tolerance);
  if (candidate === null) return null;
  return nearestUnpairedReflection(document, candidate, tolerance) === nodeId ? candidate : null;
}

/**
 * *Pair all mirrored*: every pair {@link inferExploriPartner} would make, at
 * once. Returns the new pair list — the same array when nothing pairs.
 */
export function inferExploriPairs(
  document: ExploriDocument,
  tolerance = EXPLORI_SYMMETRY_TOLERANCE
): TreeSymmetryPair[] {
  let pairs = document.symmetry.pairs;
  for (const node of document.nodes) {
    if (explicitExploriPairId(pairs, node.id) !== null) continue;
    const partner = inferExploriPartner(
      { ...document, symmetry: { ...document.symmetry, pairs } },
      node.id,
      tolerance
    );
    if (partner !== null) pairs = addExploriPair(pairs, node.id, partner);
  }
  return pairs;
}

/** The nearest unpaired, off-axis node within `tolerance` of `nodeId`'s reflection. */
function nearestUnpairedReflection(
  document: ExploriDocument,
  nodeId: number,
  tolerance: number
): number | null {
  const pairs = document.symmetry.pairs;
  if (explicitExploriPairId(pairs, nodeId) !== null) return null;
  const loc = document.nodes.find((node) => node.id === nodeId)?.loc;
  if (!loc || symmetrySide(loc, EXPLORI_SYMMETRY_AXIS, tolerance) === 0) return null;
  const target = reflectPointAcrossSymmetryAxis(loc, EXPLORI_SYMMETRY_AXIS);
  let best: { id: number; distance: number } | null = null;
  for (const node of document.nodes) {
    if (node.id === nodeId) continue;
    if (explicitExploriPairId(pairs, node.id) !== null) continue;
    if (symmetrySide(node.loc, EXPLORI_SYMMETRY_AXIS, tolerance) === 0) continue;
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
  tolerance = EXPLORI_SYMMETRY_TOLERANCE
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
  axisTolerance: number
): { placed: Point; onAxis: boolean } {
  const snap = snapPointToSymmetryAxis(loc, EXPLORI_SYMMETRY_AXIS, axisTolerance);
  const onAxis = symmetryEnabled && snap.snapped;
  return { placed: onAxis ? snap.point : loc, onAxis };
}
