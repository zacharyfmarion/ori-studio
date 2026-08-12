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

/** How the paper is folded onto itself. */
export type SymmetryFold = 'book' | 'diagonal';

/**
 * How the tree's mirror sits on the paper: which line, and which way round.
 *
 * The four axes fall into two classes of two — book (vertical, horizontal) and
 * diagonal (main, anti) — and a quarter turn maps book to book and diagonal to
 * diagonal. So the class survives every sheet transform while the member is what
 * a rotation changes: `fold` names the class, `quarterTurn` the member.
 *
 * `sidesSwapped` is the third, and it is not about the line at all: a mirror has
 * two sides, and the design was drawn with a definite one of them on the tree's
 * left. A transform can carry that side onto the paper's other half, which no
 * amount of looking at the line afterwards reveals. Eight states in all, which
 * is what it takes — the symmetries of the square act on an *oriented* line
 * through the centre, and the orbit of one is all eight.
 */
export interface BpMirrorOrientation {
  /**
   * Which fold of the paper the mirror becomes. A fact about the design, not a
   * preference about the optimizer: "this model is book-symmetric" travels with
   * the model.
   */
  fold: SymmetryFold;
  /**
   * Whether the mirror sits a quarter turn off the fold's canonical placement —
   * the horizontal book fold rather than the vertical, the anti-diagonal rather
   * than the main one.
   *
   * Only the sheet transforms write it: rotating or flipping the layout carries
   * the mirror along with the design, and nothing else can move it. Choosing a
   * fold does not, because that chooses the class.
   */
  quarterTurn: boolean;
  /**
   * Whether the half of the paper the tree's *left* corresponds to is now the
   * axis's positive side rather than its negative one.
   *
   * The optimizer is told which member of each pair the user drew on the left
   * (`negativeSide`), and enforces it against the axis's canonical normal. That
   * reading is only right while left means left: a rotation moves the paper
   * under the mirror, and the drawing's left can end up on the far half. Without
   * this, the next symmetric solve "corrects" every pair back onto the sides the
   * tree names and undoes the rotation's arrangement.
   *
   * Not derivable from {@link quarterTurn}. Under repeated rotation the axis has
   * period two and the sides have period four — keep, swap, swap, keep — and a
   * right turn and a left turn reach the same axis by opposite sides.
   */
  sidesSwapped: boolean;
}

/**
 * The part of mirror-draw state that belongs to the *design* and is saved with
 * it, as opposed to the runtime axis (`angle`/`loc`) which is derived from the
 * sheet on every load.
 *
 * `angle` is always {@link BP_TREE_SYMMETRY_ANGLE} and `loc` is always the sheet
 * centre, so storing either would only create a way for a file to disagree with
 * the sheet it describes — a design saved at one sheet size and reopened at
 * another would carry a mirror line that no longer runs down the middle.
 */
export interface BpDocumentSymmetry extends BpMirrorOrientation {
  enabled: boolean;
  pairs: BpTreeSymmetryPair[];
}

/**
 * Narrow the runtime symmetry state to just the part that belongs in a file.
 *
 * Explicit rather than a cast, and not optional: the runtime state is a
 * *subtype* of the persisted one, so handing it straight to the serializer
 * typechecks and then quietly writes `angle` and `loc` too — the two fields that
 * must always be derived from the sheet.
 */
export function bpDocumentSymmetry(state: BpDocumentSymmetry): BpDocumentSymmetry {
  // Copied, not aliased: the result outlives the call as an undo snapshot or a
  // serialized file, and sharing the live array makes those hostage to it.
  return {
    enabled: state.enabled,
    fold: state.fold,
    quarterTurn: state.quarterTurn,
    sidesSwapped: state.sidesSwapped,
    pairs: [...state.pairs],
  };
}

/**
 * Mirror draw as a new design starts: off, book fold, unturned and unswapped,
 * nothing paired yet.
 *
 * Off, because mirroring is a decision about the model rather than a default
 * way to draw: starting on means every first stroke silently lays down a second
 * branch, which has to be noticed and undone by anyone whose subject is not
 * symmetric. The fold is still `book`, so turning it on needs no second choice.
 *
 * Also the answer for a file that predates symmetry, which is the same claim —
 * nothing in it was ever mirrored.
 */
export function defaultBpDocumentSymmetry(): BpDocumentSymmetry {
  return { enabled: false, fold: 'book', quarterTurn: false, sidesSwapped: false, pairs: [] };
}

/**
 * Read {@link BpDocumentSymmetry} out of a parsed file.
 *
 * Lenient in the house style of the `nativeProjectFile` validators: anything
 * unusable is dropped rather than thrown, so a malformed symmetry block can
 * never stop a design from opening. Returns `null` when there is nothing to read
 * at all, which the caller reads as "this file predates symmetry" and answers
 * with {@link defaultBpDocumentSymmetry}.
 *
 * Pairs are re-normalized rather than trusted: a file could carry a vertex in
 * two pairs (hand-edited, or written by a version with different rules), and
 * `mirrorBpTreeVertexId` assumes each vertex has at most one explicit mirror.
 * Rebuilding through {@link addBpTreeSymmetryPair} restores that invariant.
 */
export function validateBpDocumentSymmetry(value: unknown): BpDocumentSymmetry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fallback = defaultBpDocumentSymmetry();
  let pairs: BpTreeSymmetryPair[] = [];
  if (Array.isArray(record.pairs)) {
    for (const entry of record.pairs) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const { v1, v2 } = entry as Record<string, unknown>;
      if (!isVertexId(v1) || !isVertexId(v2) || v1 === v2) continue;
      pairs = addBpTreeSymmetryPair(pairs, v1, v2);
    }
  }
  return {
    enabled: typeof record.enabled === 'boolean' ? record.enabled : fallback.enabled,
    fold: record.fold === 'diagonal' ? 'diagonal' : fallback.fold,
    // Absent means the file predates the sheet transforms, and a design that was
    // never rotated is one whose mirror is still where its fold puts it, the
    // right way round.
    quarterTurn: typeof record.quarterTurn === 'boolean' ? record.quarterTurn : fallback.quarterTurn,
    sidesSwapped:
      typeof record.sidesSwapped === 'boolean' ? record.sidesSwapped : fallback.sidesSwapped,
    pairs,
  };
}

function isVertexId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Drop whatever pairing mentions this vertex. */
export function removeBpTreeSymmetryPair(
  pairs: BpTreeSymmetryPair[],
  vertexId: number
): BpTreeSymmetryPair[] {
  return pairs.filter((pair) => pair.v1 !== vertexId && pair.v2 !== vertexId);
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

/**
 * Of the vertices a gesture moves, the ones that must stay in their own half of
 * the mirror.
 *
 * Exactly the vertices {@link buildMirroredBpTreeUpdates} will reflect: one
 * whose partner is being moved by the same gesture travels rigidly with it and
 * is free, and one with no partner has nothing to swap sides with. The two rules
 * are kept in step deliberately — a vertex whose partner gets mirrored is
 * precisely the vertex that would turn the drawing inside out by crossing.
 */
export function bpTreeMirrorHeldIds(
  tree: OristudioBpTreeView,
  pairs: BpTreeSymmetryPair[],
  axis: SymmetryAxis,
  movedIds: readonly number[],
  tolerance = BP_TREE_SYMMETRY_TOLERANCE
): Set<number> {
  const moved = new Set(movedIds);
  const held = new Set<number>();
  for (const id of movedIds) {
    const partner = mirrorBpTreeVertexId(tree, pairs, axis, id, tolerance);
    if (partner === null || partner === id || moved.has(partner)) continue;
    held.add(id);
  }
  return held;
}

/**
 * The vertices a delete of `vertexId` should remove: the vertex, plus its mirror
 * partner when symmetry is on. The two sides of a symmetric design are one
 * shape, so deleting a flap from one side and leaving its twin behind breaks the
 * symmetry the user is working in -- the same reasoning that makes a length edit
 * apply to both sides.
 *
 * Returns just the vertex when symmetry is off, when it sits on the axis (it
 * mirrors to itself), or when no partner resolves. Callers should pass the
 * result to the engine as one batch: it settles the delete cascade and the
 * minimum-tree floor across every id at once, where deleting them one at a time
 * could remove the first and then refuse the second, leaving the tree lopsided.
 */
export function bpTreeDeleteIdsWithSymmetry(
  tree: OristudioBpTreeView,
  pairs: BpTreeSymmetryPair[],
  axis: SymmetryAxis,
  vertexId: number,
  tolerance = BP_TREE_SYMMETRY_TOLERANCE
): number[] {
  const mirrorId = mirrorBpTreeVertexId(tree, pairs, axis, vertexId, tolerance);
  return mirrorId == null || mirrorId === vertexId ? [vertexId] : [vertexId, mirrorId];
}
