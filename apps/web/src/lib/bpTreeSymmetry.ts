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

/**
 * An ephemeral mirror pairing between two tree vertices (stored min-first).
 *
 * A pair whose two members are the same vertex declares it as sitting *on* the
 * axis, where it is its own mirror image. Without that there would be no way to
 * say so: a flap on the axis has no partner to pair with, and the optimizer
 * needs every flap accounted for before it will mirror a layout.
 */
export interface BpTreeSymmetryPair {
  v1: number;
  v2: number;
}

/** How a vertex participates in the mirror, if at all. */
export type BpTreeSymmetryRole = 'paired' | 'on-axis';

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
 * Pair two vertices, or declare one on the axis by passing it as both.
 *
 * Either vertex may already be spoken for, so any pairing that mentions them is
 * dropped first — a vertex has exactly one mirror.
 */
export function addBpTreeSymmetryPair(
  pairs: BpTreeSymmetryPair[],
  a: number,
  b: number
): BpTreeSymmetryPair[] {
  const next = { v1: Math.min(a, b), v2: Math.max(a, b) };
  const rest = pairs.filter(
    (pair) => ![pair.v1, pair.v2].some((id) => id === a || id === b)
  );
  return [...rest, next];
}

/** Drop whatever pairing mentions this vertex. */
export function removeBpTreeSymmetryPair(
  pairs: BpTreeSymmetryPair[],
  vertexId: number
): BpTreeSymmetryPair[] {
  return pairs.filter((pair) => pair.v1 !== vertexId && pair.v2 !== vertexId);
}

/** Whether a vertex is explicitly paired, on the axis, or neither. */
export function bpTreeSymmetryRole(
  pairs: BpTreeSymmetryPair[],
  vertexId: number
): BpTreeSymmetryRole | null {
  const pair = pairs.find((entry) => entry.v1 === vertexId || entry.v2 === vertexId);
  if (!pair) return null;
  return pair.v1 === pair.v2 ? 'on-axis' : 'paired';
}

/**
 * Drop pairs that reference a removed vertex. Self-pairs are kept: they are how
 * a vertex is declared to sit on the axis.
 */
export function filterBpTreeSymmetryPairs(
  tree: OristudioBpTreeView,
  pairs: BpTreeSymmetryPair[]
): BpTreeSymmetryPair[] {
  return pairs.filter((pair) => vertexExists(tree, pair.v1) && vertexExists(tree, pair.v2));
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
