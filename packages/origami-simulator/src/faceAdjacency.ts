// Which paper each crease lies on, for drawing a crease only where that paper
// is what shows (`RenderSettings.creaseVisibility`).
//
// A mass-spring model has no thickness: layers folded flat lie at the same
// depth, so a depth test cannot say which of them is on top, and a crease
// nudged toward the camera to sit on its own face wins over every coincident
// layer too — the creases of every buried layer show through. What *can* say
// it is which face the paint shows at a pixel: a crease is drawn where one of
// the faces it bounds is that face. This module states, once, what those
// faces are.
//
// Faces are source faces (`sourceFaceGroups`): the triangles of one face,
// joined across the diagonals triangulation invented, so a probe that crosses a
// diagonal is still on its own paper. Each crease names up to two, and for
// each the vertex of its triangle off the crease — its apex — which is where a
// renderer looks from the line to see that face: toward the apex, the look
// stays inside the triangle however near it starts to a vertex, so it never
// lands on a neighbour across another crease and mistakes it for a layer on top.
import { sourceFaceGroups } from './coplanarRuns.js';

/** The topology the adjacency reads. */
export interface FaceAdjacencyTopology {
  /** Triangle vertex indices, 3 per triangle. */
  faceIndices: Uint32Array;
  /** Edge vertex indices, 2 per edge. */
  edgeIndices: Uint32Array;
  /** One `EDGE_CODE` per edge. */
  edgeAssignments: Uint8Array;
}

export interface FaceAdjacency {
  /** The source face of each triangle, as `sourceFaceGroups` numbers it: compare, never count. */
  faceGroups: Int32Array;
  /** Per edge, the faces of the (up to two) triangles it bounds; -1 for none. */
  edgeFaces: Int32Array;
  /** Per edge, parallel to {@link edgeFaces}: each triangle's vertex off the edge; -1 for none. */
  edgeApex: Int32Array;
}

function key(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** The faces each crease bounds, and the vertex of each triangle off the crease. */
export function faceAdjacency(topology: FaceAdjacencyTopology): FaceAdjacency {
  const faceGroups = sourceFaceGroups(topology);
  const triangleCount = Math.floor(topology.faceIndices.length / 3);
  const edgeCount = topology.edgeAssignments.length;

  // Every triangle side, keyed by its two vertices, with the vertex opposite it.
  const sides = new Map<string, Array<[number, number]>>();
  for (let t = 0; t < triangleCount; t += 1) {
    const corners = [
      topology.faceIndices[t * 3]!,
      topology.faceIndices[t * 3 + 1]!,
      topology.faceIndices[t * 3 + 2]!,
    ];
    for (let k = 0; k < 3; k += 1) {
      const at = key(corners[k]!, corners[(k + 1) % 3]!);
      const apex = corners[(k + 2) % 3]!;
      const list = sides.get(at);
      if (list) list.push([t, apex]);
      else sides.set(at, [[t, apex]]);
    }
  }

  const edgeFaces = new Int32Array(edgeCount * 2).fill(-1);
  const edgeApex = new Int32Array(edgeCount * 2).fill(-1);
  for (let e = 0; e < edgeCount; e += 1) {
    const bounded = sides.get(key(topology.edgeIndices[e * 2]!, topology.edgeIndices[e * 2 + 1]!));
    if (!bounded) continue;
    for (let k = 0; k < Math.min(2, bounded.length); k += 1) {
      edgeFaces[e * 2 + k] = faceGroups[bounded[k]![0]]!;
      edgeApex[e * 2 + k] = bounded[k]![1];
    }
  }
  return { faceGroups, edgeFaces, edgeApex };
}
