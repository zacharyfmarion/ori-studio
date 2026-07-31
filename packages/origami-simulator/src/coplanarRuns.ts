// Puts a face back together after the pipeline has taken it apart.
//
// A face reaches the exporter as several triangles and leaves it as several
// polygons, for two reasons that have nothing to do with each other:
//
//  - `prepareFoldModel` triangulates, because the solver needs triangles. On one
//    real model only 28 of 126 faces were triangles to begin with; the rest were
//    quads and pentagons, and fanning them out gave 254.
//  - The BSP cuts faces on planes to get a correct draw order, taking those 254
//    to 535.
//
// Every piece of that is coplanar with its neighbours and drawn in the same
// colour, so the drawing looks right — but a vector editor sees 535 shapes where
// the model has 126 faces, and selecting one selects a sliver.
//
// Neither split has to be guessed at. Triangulation records its diagonals as
// facet edges, which is already how the renderer knows not to draw a crease
// there, so the triangles of one face are exactly those joined by facet edges.
// A BSP piece keeps its parent triangle's `ref`. Grouping is therefore a fact
// about the mesh rather than a coplanarity tolerance.
//
// What is left is an ordering question, and it is the reason only consecutive
// pieces are merged. Replacing a run with its outline draws that area at the
// run's position; if anything were drawn between two pieces, merging would
// repaint over it. Consecutive pieces have nothing between them by definition,
// so the merge is exactly equivalent — see `outlineOf` for the geometric half.

/** Edge assignment code for a triangulation diagonal, as `MeshTopology` stores it. */
const FACET = 3;

export type Point = readonly [number, number];

interface Topology {
  faceIndices: Uint32Array;
  edgeIndices: Uint32Array;
  edgeAssignments: Uint8Array;
}

/**
 * Which source face each triangle came from, as a group id per triangle of
 * `faceIndices`. Triangles joined by a facet edge share an id.
 *
 * Ids are arbitrary and dense only by accident; all a caller may do is compare
 * them.
 */
export function sourceFaceGroups(topology: Topology): Int32Array {
  const faceCount = Math.floor(topology.faceIndices.length / 3);
  const parent = new Int32Array(faceCount);
  for (let i = 0; i < faceCount; i += 1) parent[i] = i;
  const find = (x: number): number => {
    let root = x;
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]!]!;
      root = parent[root]!;
    }
    return root;
  };

  const facet = new Set<string>();
  for (let edge = 0; edge < topology.edgeAssignments.length; edge += 1) {
    if (topology.edgeAssignments[edge] !== FACET) continue;
    facet.add(vertexKey(topology.edgeIndices[edge * 2]!, topology.edgeIndices[edge * 2 + 1]!));
  }
  if (facet.size === 0) return parent;

  // One pass over the triangles, joining the pair that meets at each diagonal.
  const seen = new Map<string, number>();
  for (let face = 0; face < faceCount; face += 1) {
    const a = topology.faceIndices[face * 3]!;
    const b = topology.faceIndices[face * 3 + 1]!;
    const c = topology.faceIndices[face * 3 + 2]!;
    for (const [from, to] of [[a, b], [b, c], [c, a]] as const) {
      const key = vertexKey(from, to);
      if (!facet.has(key)) continue;
      const other = seen.get(key);
      if (other === undefined) {
        seen.set(key, face);
        continue;
      }
      const left = find(other);
      const right = find(face);
      if (left !== right) parent[right] = left;
    }
  }

  const groups = new Int32Array(faceCount);
  for (let i = 0; i < faceCount; i += 1) groups[i] = find(i);
  return groups;
}

function vertexKey(from: number, to: number): string {
  return from < to ? `${from}_${to}` : `${to}_${from}`;
}

export interface RunPiece {
  /**
   * The source face this piece belongs to, or a negative number for anything
   * that must never merge — a crease, or a face whose group is unknown.
   */
  group: number;
  /**
   * The piece's fill as it would be written. Compared rather than assumed equal
   * from the group: strain colouring shades each triangle by its own mean, so
   * two triangles of one face can legitimately differ.
   */
  fill: string;
  points: readonly Point[];
}

/**
 * Maximal runs of consecutive pieces that may be drawn as one shape, as
 * `[start, end)` index ranges into `pieces`. Runs of one are omitted.
 *
 * A piece joins the run in front of it when it belongs to the same face, is
 * filled the same way, and touches what is already there along a whole edge.
 * That last condition is what keeps the outline solvable: pieces meeting at only
 * a point, or overlapping part of an edge, are left alone.
 */
export function coplanarRuns(pieces: readonly RunPiece[]): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = 0;
  while (start < pieces.length) {
    const head = pieces[start]!;
    let end = start + 1;
    if (head.group >= 0) {
      const edges = new Set(edgeKeys(head.points));
      while (end < pieces.length) {
        const next = pieces[end]!;
        if (next.group !== head.group || next.fill !== head.fill) break;
        const keys = edgeKeys(next.points);
        if (!keys.some((key) => edges.has(key))) break;
        keys.forEach((key) => edges.add(key));
        end += 1;
      }
    }
    if (end - start > 1) runs.push([start, end]);
    start = end;
  }
  return runs;
}

/**
 * The outline of pieces that tile a region without overlapping, or null when
 * they do not resolve to one simple loop.
 *
 * Works by cancellation: the pieces are wound consistently, so an edge two of
 * them share appears once in each direction and drops out, leaving only the
 * boundary. Null is the honest answer for a region with a hole, one that pinches
 * to a point, or one whose pieces meet at a T-junction — a cut that split a
 * neighbour's edge but not this one leaves half an edge with nothing to cancel
 * against. The caller emits the pieces unmerged in that case.
 */
export function outlineOf(pieces: ReadonlyArray<readonly Point[]>): Point[] | null {
  const directed = new Map<string, Point[]>();
  for (const points of pieces) {
    for (let i = 0; i < points.length; i += 1) {
      const from = points[i]!;
      const to = points[(i + 1) % points.length]!;
      const forward = `${pointKey(from)}>${pointKey(to)}`;
      const backward = `${pointKey(to)}>${pointKey(from)}`;
      if (directed.has(backward)) directed.delete(backward);
      else directed.set(forward, [from, to]);
    }
  }
  if (directed.size < 3) return null;

  // One outgoing edge per vertex, or the walk below would have to choose.
  const next = new Map<string, Point[]>();
  for (const edge of directed.values()) {
    const key = pointKey(edge[0]!);
    if (next.has(key)) return null;
    next.set(key, edge);
  }

  const first = directed.values().next().value as Point[];
  const loop: Point[] = [first[0]!];
  let cursor = first;
  for (let step = 0; step < directed.size; step += 1) {
    const to = cursor[1]!;
    if (pointKey(to) === pointKey(first[0]!)) {
      // Closed. Every boundary edge must be in it, or this is one loop of several.
      return loop.length === directed.size ? dropCollinear(loop) : null;
    }
    loop.push(to);
    const onward = next.get(pointKey(to));
    if (!onward) return null;
    cursor = onward;
  }
  return null;
}

/**
 * Distance below which a vertex is taken to be on the line through its
 * neighbours. Coordinates are written to two decimals, so this is well under
 * what the document can express.
 */
const COLLINEAR_EPSILON = 0.005;

/**
 * Drop vertices that lie on the edge through their neighbours. Cuts leave them
 * behind wherever a plane crossed a face without changing its shape, and they
 * are geometrically nothing.
 */
function dropCollinear(loop: readonly Point[]): Point[] {
  if (loop.length < 4) return [...loop];
  const kept: Point[] = [];
  for (let i = 0; i < loop.length; i += 1) {
    const previous = kept[kept.length - 1] ?? loop[(i - 1 + loop.length) % loop.length]!;
    const current = loop[i]!;
    const following = loop[(i + 1) % loop.length]!;
    const dx = following[0] - previous[0];
    const dy = following[1] - previous[1];
    const span = Math.hypot(dx, dy);
    if (span > 0) {
      const area = Math.abs((current[0] - previous[0]) * dy - (current[1] - previous[1]) * dx);
      if (area / span < COLLINEAR_EPSILON) continue;
    }
    kept.push(current);
  }
  return kept.length >= 3 ? kept : [...loop];
}

function edgeKeys(points: readonly Point[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const from = pointKey(points[i]!);
    const to = pointKey(points[(i + 1) % points.length]!);
    keys.push(from < to ? `${from}|${to}` : `${to}|${from}`);
  }
  return keys;
}

function pointKey(point: Point): string {
  return `${point[0]},${point[1]}`;
}
