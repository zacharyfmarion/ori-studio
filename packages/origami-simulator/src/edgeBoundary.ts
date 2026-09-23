// Which ends of each edge retreat under the style's erode, stated once.
//
// Erode is for auxiliary creases alone. A fold is drawn to the paper's edge,
// as a diagram draws the line it folds along; an existing crease, drawn in the
// aux pen, stops short of it. The rule (D8, the step-folder's `clip`): an aux
// crease's endpoint retreats when it lies on the outline of the layer the
// crease is drawn on, and that outline is made of the sheet's border and of
// the folds where the paper turns. Auxiliary creases and facet edges are
// interior to a layer and do not count. So an aux crease's end retreats when a
// border or fold edge meets it there — at the paper's edge, or where folds
// meet — and not when it ends in the middle of a face. Every other edge is
// drawn to its ends: a paper edge is the outline itself, a fold runs to it,
// and a facet edge is never drawn.
//
// Three renderers apply it — the scene producer for the vector export, the GPU
// edge pass and the canvas-2D fallback — and the erosion is the painter's to
// the pixel only if all three read the same flags. This is the one copy.
import { EDGE_CODE } from './edgeCodes.js';

/** The topology the rule reads: edge endpoints and their codes. */
export interface EdgeBoundaryTopology {
  /** Edge vertex indices, 2 per edge. */
  edgeIndices: ArrayLike<number>;
  /** One {@link EDGE_CODE} per edge. */
  edgeAssignments: ArrayLike<number>;
  /**
   * Per edge, {@link EDGE_BOUNDARY_A} / {@link EDGE_BOUNDARY_B} for an aux
   * crease's ends that lie on its layer's outline where no outline edge shares
   * the vertex — which the vertex rule cannot see. A producer that gives a
   * crease vertices of its own states them here: the 3D figure puts each cut
   * of the document's aux lines on two vertices past its layer's ring. Read
   * for aux creases only; absent, the vertex rule is the whole answer.
   */
  auxEnds?: ArrayLike<number>;
}

/** Bit set in an edge's flags when its first endpoint (`edgeIndices[2e]`) retreats. */
export const EDGE_BOUNDARY_A = 1;
/** Bit set when its second endpoint (`edgeIndices[2e + 1]`) retreats. */
export const EDGE_BOUNDARY_B = 2;

/** Whether a code is a border or a fold — the edges a layer's outline is made of. */
function isOutline(code: number): boolean {
  return code <= EDGE_CODE.valley;
}

/**
 * Per vertex, how many border or fold edges meet there. Vertices past
 * `vertexCount` are ignored; a count is clamped at the array's width.
 *
 * An edge counts once however many times the buffer lists it. The 3D figure's
 * buffer carries each crease in every draw run that inks it — a plane's skin,
 * a hinge group, the translucent run — on the same two vertices, and a
 * crease's own copies are not other creases meeting its ends.
 */
export function outlineVertexCounts(
  topology: EdgeBoundaryTopology,
  vertexCount: number
): Uint16Array {
  const counts = new Uint16Array(vertexCount);
  const edgeCount = topology.edgeAssignments.length;
  const seen = new Set<string>();
  for (let edge = 0; edge < edgeCount; edge += 1) {
    if (!isOutline(topology.edgeAssignments[edge]!)) continue;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    const key = from < to ? `${from}_${to}` : `${to}_${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (from < vertexCount && counts[from]! < 0xffff) counts[from] += 1;
    if (to < vertexCount && counts[to]! < 0xffff) counts[to] += 1;
  }
  return counts;
}

/**
 * Whether the endpoint `vertex` of an edge with code `code` retreats, given
 * the outline counts: only an aux crease's, and only where a border or fold
 * edge meets the vertex.
 */
export function endpointOnBoundary(
  counts: Uint16Array,
  vertex: number,
  code: number
): boolean {
  if (code !== EDGE_CODE.aux) return false;
  return (counts[vertex] ?? 0) > 0;
}

/**
 * Two bits per edge — {@link EDGE_BOUNDARY_A} and {@link EDGE_BOUNDARY_B} —
 * saying which of its ends retreat under erode; zero for every edge but an
 * aux crease. Computed once per topology; the flags do not depend on the
 * camera.
 *
 * `vertexCount` bounds the per-vertex table; absent, it is one past the
 * largest index the edges name.
 */
export function edgeBoundaryFlags(topology: EdgeBoundaryTopology, vertexCount?: number): Uint8Array {
  const edgeCount = topology.edgeAssignments.length;
  let vertices = vertexCount ?? 0;
  if (vertexCount === undefined) {
    for (let i = 0; i < edgeCount * 2; i += 1) {
      const vertex = topology.edgeIndices[i]!;
      if (vertex + 1 > vertices) vertices = vertex + 1;
    }
  }
  const counts = outlineVertexCounts(topology, vertices);
  const stated = topology.auxEnds;
  const flags = new Uint8Array(edgeCount);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const code = topology.edgeAssignments[edge]!;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    flags[edge] =
      (endpointOnBoundary(counts, from, code) ? EDGE_BOUNDARY_A : 0) |
      (endpointOnBoundary(counts, to, code) ? EDGE_BOUNDARY_B : 0) |
      (code === EDGE_CODE.aux ? (stated?.[edge] ?? 0) & (EDGE_BOUNDARY_A | EDGE_BOUNDARY_B) : 0);
  }
  return flags;
}

/**
 * How near a border or fold edge, as a share of the sheet's extent, a free aux
 * end lies on it: the crease-pattern kernel's own `distance_relative`.
 */
export const AUX_END_ON_OUTLINE_RELATIVE = 1e-6;

/**
 * The ends of aux creases that lie on a border or fold edge without sharing a
 * vertex with one, found in the flat sheet — the bits for
 * {@link EdgeBoundaryTopology.auxEnds}.
 *
 * An aux line laid over the faces rather than into them meets the paper's edge
 * and the folds only geometrically, and the crease-pattern kernel appends
 * every aux line to its simulation model that way. Only an end no outline edge
 * meets is tested, so an aux crease the faces carry costs nothing; undefined
 * when there is nothing to state.
 *
 * `positions` are the flat sheet's, 3 per vertex; `tolerance` is in their units.
 */
export function auxEndsOnOutline(
  topology: EdgeBoundaryTopology,
  positions: ArrayLike<number>,
  tolerance: number
): Uint8Array | undefined {
  const edgeCount = topology.edgeAssignments.length;
  const vertexCount = Math.floor(positions.length / 3);
  const counts = outlineVertexCounts(topology, vertexCount);
  let free = false;
  for (let edge = 0; edge < edgeCount && !free; edge += 1) {
    if (topology.edgeAssignments[edge] !== EDGE_CODE.aux) continue;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    free = (counts[from] ?? 1) === 0 || (counts[to] ?? 1) === 0;
  }
  if (!free) return undefined;

  // Each outline edge's box, padded by the tolerance, so most tests are a
  // few comparisons.
  const outline: number[] = [];
  const boxes: number[] = [];
  for (let edge = 0; edge < edgeCount; edge += 1) {
    if (!isOutline(topology.edgeAssignments[edge]!)) continue;
    const a = topology.edgeIndices[edge * 2]!;
    const b = topology.edgeIndices[edge * 2 + 1]!;
    if (a >= vertexCount || b >= vertexCount) continue;
    outline.push(edge);
    for (let axis = 0; axis < 3; axis += 1) {
      const p = positions[a * 3 + axis]!;
      const q = positions[b * 3 + axis]!;
      boxes.push(Math.min(p, q) - tolerance, Math.max(p, q) + tolerance);
    }
  }

  const onOutline = (vertex: number): boolean => {
    if (vertex >= vertexCount || counts[vertex]! > 0) return false;
    const x = positions[vertex * 3]!;
    const y = positions[vertex * 3 + 1]!;
    const z = positions[vertex * 3 + 2]!;
    for (let i = 0; i < outline.length; i += 1) {
      const box = i * 6;
      if (x < boxes[box]! || x > boxes[box + 1]!) continue;
      if (y < boxes[box + 2]! || y > boxes[box + 3]!) continue;
      if (z < boxes[box + 4]! || z > boxes[box + 5]!) continue;
      const edge = outline[i]!;
      const a = topology.edgeIndices[edge * 2]! * 3;
      const b = topology.edgeIndices[edge * 2 + 1]! * 3;
      const ex = positions[b]! - positions[a]!;
      const ey = positions[b + 1]! - positions[a + 1]!;
      const ez = positions[b + 2]! - positions[a + 2]!;
      const lengthSq = ex * ex + ey * ey + ez * ez;
      const dx = x - positions[a]!;
      const dy = y - positions[a + 1]!;
      const dz = z - positions[a + 2]!;
      const t = lengthSq > 0 ? Math.min(1, Math.max(0, (dx * ex + dy * ey + dz * ez) / lengthSq)) : 0;
      if (Math.hypot(dx - ex * t, dy - ey * t, dz - ez * t) <= tolerance) return true;
    }
    return false;
  };

  const stated = new Uint8Array(edgeCount);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    if (topology.edgeAssignments[edge] !== EDGE_CODE.aux) continue;
    stated[edge] =
      (onOutline(topology.edgeIndices[edge * 2]!) ? EDGE_BOUNDARY_A : 0) |
      (onOutline(topology.edgeIndices[edge * 2 + 1]!) ? EDGE_BOUNDARY_B : 0);
  }
  return stated;
}
