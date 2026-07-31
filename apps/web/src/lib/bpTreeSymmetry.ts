import type { OristudioBpSheet, OristudioBpTreeView } from '../engine/oristudioBpTypes';
import type { Point } from './geometry';
import {
  reflectPointAcrossSymmetryAxis,
  symmetrySide,
  type SymmetryAxis,
} from './symmetryGeometry';
import { paperCenter } from './symmetryPresets';

/**
 * Box-Pleating tree adapter for symmetry authoring. Reuses the model-agnostic math in
 * {@link ./symmetryGeometry} and adds the pieces specific to the BP metric tree:
 * an axis derived from the sheet, ephemeral vertex pairing, and — because a BP drag
 * rotates a whole subtree — building the mirrored set of vertex moves from a primary
 * set. Pure and side-effect free; the store slice owns the ephemeral state and calls
 * these to compute mirrored edits.
 */

// Match tolerance in tree units (leaves are unit length). Governs "is on the axis"
// and "which vertex is the reflection of this one" for geometric pair inference.
export const BP_TREE_SYMMETRY_TOLERANCE = 0.02;

/**
 * The tree's mirror line is always vertical.
 *
 * A tree is not drawn on the paper, so there is no book or diagonal fold to
 * orient it against — mirror-draw only needs one line to reflect across. How
 * that mirror maps onto the paper is the optimizer's concern, chosen per run.
 */
export const BP_TREE_SYMMETRY_ANGLE = 90;

/** An ephemeral mirror pairing between two tree vertices (stored min-first). */
export interface BpTreeSymmetryPair {
  v1: number;
  v2: number;
}

/** A vertex move, as the panel/store already model them. */
export interface BpTreeVertexUpdate {
  id: number;
  loc: Point;
}

/** The default symmetry axis location: the sheet (paper) centre, in tree coords. */
export function bpTreeSymmetryDefaultLoc(sheet: OristudioBpSheet): Point {
  return paperCenter(Math.max(1, sheet.width), Math.max(1, sheet.height));
}

function vertexExists(tree: OristudioBpTreeView, id: number): boolean {
  return tree.vertices.some((vertex) => vertex.id === id);
}

function vertexLoc(tree: OristudioBpTreeView, id: number): Point | null {
  return tree.vertices.find((vertex) => vertex.id === id)?.loc ?? null;
}

/**
 * Pair two vertices. Either may already be spoken for, so any pairing that
 * mentions them is dropped first — a vertex has exactly one mirror.
 */
export function addBpTreeSymmetryPair(
  pairs: BpTreeSymmetryPair[],
  a: number,
  b: number
): BpTreeSymmetryPair[] {
  if (a === b) return pairs;
  const next = { v1: Math.min(a, b), v2: Math.max(a, b) };
  const rest = pairs.filter((pair) => ![pair.v1, pair.v2].some((id) => id === a || id === b));
  return [...rest, next];
}

/** Drop pairs that reference a removed vertex (or degenerated to a self-pair). */
export function filterBpTreeSymmetryPairs(
  tree: OristudioBpTreeView,
  pairs: BpTreeSymmetryPair[]
): BpTreeSymmetryPair[] {
  return pairs.filter(
    (pair) => pair.v1 !== pair.v2 && vertexExists(tree, pair.v1) && vertexExists(tree, pair.v2)
  );
}

/** The explicitly-paired counterpart of a vertex, if any. */
export function explicitBpTreePairId(pairs: BpTreeSymmetryPair[], vertexId: number): number | null {
  for (const pair of pairs) {
    if (pair.v1 === vertexId) return pair.v2;
    if (pair.v2 === vertexId) return pair.v1;
  }
  return null;
}

/**
 * The mirror of a vertex across the axis: an explicit ephemeral pair first, else
 * geometric inference — a vertex on the axis mirrors to itself, otherwise the nearest
 * vertex sitting at the reflected position (within tolerance). Returns null when no
 * counterpart resolves (the caller then leaves that vertex un-mirrored — partial mirror).
 */
export function mirrorBpTreeVertexId(
  tree: OristudioBpTreeView,
  pairs: BpTreeSymmetryPair[],
  axis: SymmetryAxis,
  vertexId: number,
  tolerance = BP_TREE_SYMMETRY_TOLERANCE
): number | null {
  const explicit = explicitBpTreePairId(pairs, vertexId);
  if (explicit != null && vertexExists(tree, explicit)) return explicit;
  const loc = vertexLoc(tree, vertexId);
  if (!loc) return null;
  if (symmetrySide(loc, axis, tolerance) === 0) return vertexId; // on the axis → self-mirror
  const target = reflectPointAcrossSymmetryAxis(loc, axis);
  let best: { id: number; distance: number } | null = null;
  for (const vertex of tree.vertices) {
    if (vertex.id === vertexId) continue;
    const distance = Math.hypot(vertex.loc.x - target.x, vertex.loc.y - target.y);
    if (distance <= tolerance && (!best || distance < best.distance)) {
      best = { id: vertex.id, distance };
    }
  }
  return best?.id ?? null;
}

/**
 * Given the primary set of vertex moves (e.g. a dragged subtree), build the mirrored
 * moves for the paired vertices on the other side. Partial mirror: a primary vertex
 * with no resolvable pair is skipped. A vertex already in the primary set — its own
 * mirror (on the axis) or a vertex being moved by a whole-tree/root drag — is skipped
 * so it isn't updated twice, which also makes a rigid root translation a no-op here.
 */
export function buildMirroredBpTreeUpdates(
  tree: OristudioBpTreeView,
  pairs: BpTreeSymmetryPair[],
  axis: SymmetryAxis,
  updates: readonly BpTreeVertexUpdate[],
  tolerance = BP_TREE_SYMMETRY_TOLERANCE
): BpTreeVertexUpdate[] {
  const primaryIds = new Set(updates.map((update) => update.id));
  const emitted = new Set<number>();
  const mirrored: BpTreeVertexUpdate[] = [];
  for (const { id, loc } of updates) {
    const mirrorId = mirrorBpTreeVertexId(tree, pairs, axis, id, tolerance);
    if (mirrorId == null || mirrorId === id || primaryIds.has(mirrorId) || emitted.has(mirrorId)) {
      continue;
    }
    emitted.add(mirrorId);
    mirrored.push({ id: mirrorId, loc: reflectPointAcrossSymmetryAxis(loc, axis) });
  }
  return mirrored;
}
