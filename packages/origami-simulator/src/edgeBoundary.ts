// Which ends of each edge retreat under the style's erode, stated once.
//
// The rule (D8, the step-folder's `clip`): a crease's endpoint retreats when it
// lies on the outline of the layer the crease is drawn on, and that outline is
// made of the sheet's border and of the folds where the paper turns. Auxiliary
// creases and facet edges are interior to a layer and do not count. So an
// endpoint is on the boundary when *another* border or fold edge meets it
// there: a crease ending at the paper's edge, or at a vertex where other
// creases meet, retreats; an auxiliary line ending in the middle of a face does
// not. A paper edge is the outline itself and never retreats, so its own ends
// report false whatever meets them.
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
 * a hinge group, the translucent run — on the same two vertices, and the
 * vector export reads the same crease from one run; the flags agree only if a
 * crease's own copies are not taken for other creases meeting its ends.
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
 * the outline counts: never for a border edge, and otherwise when an outline
 * edge *other than this one* meets the vertex.
 */
export function endpointOnBoundary(
  counts: Uint16Array,
  vertex: number,
  code: number
): boolean {
  if (code === EDGE_CODE.border) return false;
  return (counts[vertex] ?? 0) - (isOutline(code) ? 1 : 0) > 0;
}

/**
 * Two bits per edge — {@link EDGE_BOUNDARY_A} and {@link EDGE_BOUNDARY_B} —
 * saying which of its ends retreat under erode. Computed once per topology;
 * the flags do not depend on the camera.
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
  const flags = new Uint8Array(edgeCount);
  for (let edge = 0; edge < edgeCount; edge += 1) {
    const code = topology.edgeAssignments[edge]!;
    const from = topology.edgeIndices[edge * 2]!;
    const to = topology.edgeIndices[edge * 2 + 1]!;
    flags[edge] =
      (endpointOnBoundary(counts, from, code) ? EDGE_BOUNDARY_A : 0) |
      (endpointOnBoundary(counts, to, code) ? EDGE_BOUNDARY_B : 0);
  }
  return flags;
}
