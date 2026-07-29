import earcut from 'earcut';
import {
  assignmentFoldAngle,
  buildEdgeIndex,
  cloneFold,
  edgeKey,
  facePairs,
  findEdge,
  normalizeAssignment,
  normalizePoint,
} from './geometry.js';
import type {
  CreaseParameter,
  FoldAssignment,
  FoldDocument,
  PreparedOrigamiModel,
  PrepareFoldOptions,
  SimulatorDiagnostics,
} from './types.js';

export function prepareFoldModel(
  source: FoldDocument,
  options: PrepareFoldOptions = {}
): PreparedOrigamiModel {
  const diagnostics: SimulatorDiagnostics = { warnings: [], errors: [] };
  validateFold(source, diagnostics);
  if (diagnostics.errors.length) {
    throw new Error(diagnostics.errors.join('; '));
  }

  const fold = normalizeFold(source, options, diagnostics);
  // The dynamic solver assumes clean geometry, exactly as upstream Origami
  // Simulator does: its `normalize(cross(...))` face-normal pass NaNs on a
  // zero-area triangle, and its axial pass divides by a beam's rest length, so a
  // zero-length edge (coincident vertices) NaNs too. Upstream never hits either
  // because its inputs are hand-clean; ours are inferred from arbitrary crease
  // graphs (and Oriedita FOLD exports), which can carry coincident vertices and
  // collinear faces. One NaN contaminates the whole mesh -> a blank render. Drop
  // the degenerate primitives here so the solve stays finite.
  removeDegenerateGeometry(fold, diagnostics);
  const vertexCount = fold.vertices_coords.length;
  const positions = new Float32Array(vertexCount * 3);
  fold.vertices_coords.forEach((coord, index) => {
    positions.set(normalizePoint(coord), index * 3);
  });

  const indices = new Uint32Array(fold.faces_vertices.length * 3);
  fold.faces_vertices.forEach((face, index) => {
    indices.set(face.slice(0, 3), index * 3);
  });

  const colors = new Float32Array(vertexCount * 3);
  colors.fill(0.8);

  const facesEdges = buildFacesEdges(fold, diagnostics);
  const edgesFaces = buildEdgesFaces(fold, facesEdges, diagnostics);
  const creaseParams = buildCreaseParams(fold, edgesFaces);

  return {
    fold: { ...fold, faces_edges: facesEdges, edges_faces: edgesFaces },
    vertexCount,
    edgeCount: fold.edges_vertices.length,
    faceCount: fold.faces_vertices.length,
    positions: positions.slice(),
    originalPositions: positions,
    colors,
    indices,
    edgesVertices: fold.edges_vertices,
    edgesAssignment: fold.edges_assignment ?? [],
    edgesFoldAngle: fold.edges_foldAngle ?? [],
    facesVertices: fold.faces_vertices,
    facesEdges,
    edgesFaces,
    creaseParams,
    diagnostics,
  };
}

function validateFold(fold: FoldDocument, diagnostics: SimulatorDiagnostics): void {
  if (!fold.vertices_coords?.length) diagnostics.errors.push('FOLD document has no vertices');
  if (!fold.edges_vertices?.length) diagnostics.errors.push('FOLD document has no edges');
  if (!fold.faces_vertices?.length) diagnostics.errors.push('FOLD document has no faces');

  const vertexCount = fold.vertices_coords?.length ?? 0;
  fold.edges_vertices?.forEach((edge, index) => {
    if (edge.length !== 2) diagnostics.errors.push(`edge ${index} must have two vertices`);
    if (edge.some((vertex) => vertex < 0 || vertex >= vertexCount)) {
      diagnostics.errors.push(`edge ${index} references an invalid vertex`);
    }
  });
  fold.faces_vertices?.forEach((face, index) => {
    if (face.length < 3) diagnostics.errors.push(`face ${index} must have at least three vertices`);
    if (face.some((vertex) => vertex < 0 || vertex >= vertexCount)) {
      diagnostics.errors.push(`face ${index} references an invalid vertex`);
    }
  });
}

function normalizeFold(
  source: FoldDocument,
  options: PrepareFoldOptions,
  diagnostics: SimulatorDiagnostics
): FoldDocument {
  const fold = cloneFold(source);
  fold.vertices_coords = fold.vertices_coords.map((coord) => normalizePoint(coord));
  fold.edges_assignment = fold.edges_vertices.map((_, index) =>
    normalizeAssignment(fold.edges_assignment?.[index])
  );
  fold.edges_foldAngle = fold.edges_vertices.map((_, index) => {
    const assignment = fold.edges_assignment?.[index] ?? 'U';
    const angle = fold.edges_foldAngle?.[index];
    if (typeof angle === 'number' || angle === null) return angle;
    return options.foldUseAngles === false ? assignmentFoldAngle(assignment) : assignmentFoldAngle(assignment);
  });

  // Before triangulation, which is what turns a crease split across two collinear
  // segments into a zero-area sliver: see `removeRedundantVertices`. Upstream runs
  // it earlier still, before faces exist at all (pattern.js:551); ours arrive with
  // the document, so this is the last point that can still prevent the sliver.
  removeRedundantVertices(fold, REDUNDANT_VERTEX_EPSILON, diagnostics);

  if (options.triangulate ?? true) {
    triangulateFold(fold, diagnostics);
  }

  return fold;
}

/**
 * Upstream's collinearity tolerance, from both of its call sites (pattern.js:551
 * and :586): the dot product of the two neighbour directions must be within this
 * of -1.
 *
 * Kept at upstream's value rather than tuned, with two consequences worth knowing.
 * It admits a kink up to 8.11 degrees off straight, and because merges cascade
 * along a chain, a polyline approximating a curved crease can collapse toward a
 * single segment in the simulation mesh. Upstream appears to have hit that too:
 * the same call is commented out in its curved-folding path (curvedFolding.js:1405).
 * This constant is the knob if it ever bites us.
 */
const REDUNDANT_VERTEX_EPSILON = 0.01;

/**
 * Merge a crease split across two collinear segments back into one crease.
 *
 * Port of upstream `removeRedundantVertices` (pattern.js:865) with its `mergeEdge`
 * (pattern.js:918). A vertex with exactly two neighbours, collinear with both and
 * with the same assignment on both sides, carries no information the solver can
 * use -- and if triangulation runs a diagonal through it, the resulting triangle
 * has zero area. `removeDegenerateGeometry` then deletes that triangle, which
 * leaves the two halves incident to no face at all: `buildCreaseParams` skips
 * them, the paper renderer never draws them, and the flat diagonal invented in
 * their place is held at 0 degrees. The crease silently disappears and the model
 * folds wrongly.
 *
 * Sequential and mutating, like upstream: each merge rewrites the neighbour map,
 * so a chain of collinear vertices collapses progressively into one edge. A batch
 * pass resolved against the original neighbours would stop after the first.
 */
function removeRedundantVertices(
  fold: FoldDocument,
  epsilon: number,
  diagnostics: SimulatorDiagnostics
): void {
  const coords = fold.vertices_coords;
  const sourceEdgeCount = fold.edges_vertices.length;
  // Upstream's `edges_vertices_to_vertices_vertices_unsorted`.
  const verticesVertices: number[][] = coords.map(() => []);
  for (const edge of fold.edges_vertices) {
    verticesVertices[edge[0]]?.push(edge[1]);
    verticesVertices[edge[1]]?.push(edge[0]);
  }
  // Which source edge each surviving edge came from, so the per-edge extension
  // arrays can follow. See `foldEdgeArrays.ts` in apps/web for why provenance is
  // tracked rather than inferred from lengths.
  const edgeSources = fold.edges_vertices.map((_, index) => index);

  const merged = new Set<number>();
  for (let vertex = 0; vertex < coords.length; vertex += 1) {
    const around = verticesVertices[vertex];
    if (around?.length !== 2) continue;
    const [first, second] = around as [number, number];
    if (!isStraightThrough(coords, vertex, first, second, epsilon)) continue;
    if (mergeEdge(fold, verticesVertices, edgeSources, first, vertex, second, diagnostics)) {
      merged.add(vertex);
    }
  }
  if (merged.size === 0) return;

  const droppedFaces = dropMergedVertices(fold, merged);
  remapEdgeExtensionArrays(fold, sourceEdgeCount, edgeSources);
  diagnostics.warnings.push(
    `merged ${merged.size} redundant vertex/vertices` +
      (droppedFaces ? `, dropping ${droppedFaces} degenerate face(s)` : '')
  );
}

/** Upstream's test: the two neighbour directions point opposite, within `epsilon`. */
function isStraightThrough(
  coords: number[][],
  vertex: number,
  first: number,
  second: number,
  epsilon: number
): boolean {
  const point = coords[vertex];
  const a = coords[first];
  const b = coords[second];
  if (!point || !a || !b) return false;
  const toA = [a[0]! - point[0]!, a[1]! - point[1]!, (a[2] ?? 0) - (point[2] ?? 0)];
  const toB = [b[0]! - point[0]!, b[1]! - point[1]!, (b[2] ?? 0) - (point[2] ?? 0)];
  const magA = Math.hypot(toA[0]!, toA[1]!, toA[2]!);
  const magB = Math.hypot(toB[0]!, toB[1]!, toB[2]!);
  if (magA === 0 || magB === 0) return false;
  const dot = (toA[0]! * toB[0]! + toA[1]! * toB[1]! + toA[2]! * toB[2]!) / (magA * magB);
  return Math.abs(dot + 1) < epsilon;
}

/**
 * Replace the two edges meeting at `centre` with one edge spanning them, per
 * upstream `mergeEdge`: the assignment must match on both sides (upstream refuses
 * the merge otherwise, leaving a collinear M/V pair alone), and the merged fold
 * angle is the mean of the non-zero angles, or null when neither is set.
 */
function mergeEdge(
  fold: FoldDocument,
  verticesVertices: number[][],
  edgeSources: number[],
  first: number,
  centre: number,
  second: number,
  diagnostics: SimulatorDiagnostics
): boolean {
  const edges = fold.edges_vertices;
  const assignments = fold.edges_assignment;
  const foldAngles = fold.edges_foldAngle;
  if (!assignments || !foldAngles) return false;

  // Descending, so the splices below cannot disturb an index still to be removed.
  const halves: number[] = [];
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index]!;
    if (edge[0] !== centre && edge[1] !== centre) continue;
    const other = edge[0] === centre ? edge[1] : edge[0];
    if (other !== first && other !== second) continue;
    halves.push(index);
  }
  if (halves.length !== 2) return false;

  const assignment = assignments[halves[0]!];
  if (assignment !== assignments[halves[1]!]) {
    diagnostics.warnings.push(
      `not merging ${first}-${centre}-${second}: different edge assignments`
    );
    return false;
  }
  // Upstream never meets this case, because it removes redundant vertices before
  // faces exist and so cannot be re-run on its own output. Merging into an edge
  // that already exists would produce a duplicate, i.e. an edge with no face --
  // the very shape of the bug this pass removes.
  if (findEdge(edges, first, second) !== -1) return false;

  const angles = [foldAngles[halves[0]!], foldAngles[halves[1]!]];
  if (angles[0] !== angles[1]) {
    diagnostics.warnings.push(`incompatible fold angles merged: ${JSON.stringify(angles)}`);
  }
  const set = angles.filter((angle): angle is number => Boolean(angle));
  const mergedAngle = set.length
    ? set.reduce((sum, angle) => sum + angle, 0) / set.length
    : null;
  // The earlier half, so the inherited extension data is deterministic.
  const source = edgeSources[Math.min(halves[0]!, halves[1]!)]!;

  for (const index of halves) {
    edges.splice(index, 1);
    assignments.splice(index, 1);
    foldAngles.splice(index, 1);
    edgeSources.splice(index, 1);
  }
  edges.push([first, second]);
  assignments.push(assignment ?? 'U');
  foldAngles.push(mergedAngle);
  edgeSources.push(source);

  replaceNeighbor(verticesVertices[first], centre, second);
  replaceNeighbor(verticesVertices[second], centre, first);
  return true;
}

function replaceNeighbor(neighbors: number[] | undefined, from: number, to: number): void {
  if (!neighbors) return;
  const index = neighbors.indexOf(from);
  if (index >= 0) neighbors[index] = to;
}

/**
 * Compact the merged vertices away and re-index. Returns the number of faces
 * dropped for falling below three vertices -- a face ring that walked through a
 * merged vertex and had no more than three to begin with was already zero-area,
 * and upstream cannot meet it because its faces are built after this pass.
 */
function dropMergedVertices(fold: FoldDocument, merged: Set<number>): number {
  const remap = new Int32Array(fold.vertices_coords.length).fill(-1);
  const coords: number[][] = [];
  fold.vertices_coords.forEach((coord, index) => {
    if (merged.has(index)) return;
    remap[index] = coords.length;
    coords.push(coord);
  });
  fold.vertices_coords = coords;
  fold.edges_vertices = fold.edges_vertices.map((edge): [number, number] => [
    remap[edge[0]] ?? 0,
    remap[edge[1]] ?? 0,
  ]);

  let dropped = 0;
  fold.faces_vertices = fold.faces_vertices.reduce<number[][]>((kept, face) => {
    const next = face.filter((vertex) => !merged.has(vertex)).map((vertex) => remap[vertex] ?? 0);
    if (next.length < 3) dropped += 1;
    else kept.push(next);
    return kept;
  }, []);
  // Both are rebuilt from the new edge list before anything reads them.
  delete fold.faces_edges;
  delete fold.edges_faces;
  return dropped;
}

/**
 * Re-index the namespaced per-edge arrays onto the merged edge list. Matched
 * structurally, so an extension added later is covered without editing this file;
 * an array whose length disagrees with the source edge count was already stale and
 * is dropped rather than guessed at. Mirrors `remapEdgeExtensionArrays` in
 * apps/web, which this package cannot import.
 */
function remapEdgeExtensionArrays(
  fold: FoldDocument,
  sourceEdgeCount: number,
  edgeSources: number[]
): void {
  for (const key of Object.keys(fold)) {
    if (!key.includes(':edges_')) continue;
    const value = fold[key];
    if (!Array.isArray(value)) continue;
    if (value.length !== sourceEdgeCount) {
      delete fold[key];
      continue;
    }
    fold[key] = edgeSources.map((source) => value[source]);
  }
}

/**
 * Drop degenerate primitives the solver cannot handle: zero-area triangles
 * (whose face normal is `normalize(0)` -> NaN) and zero-length edges (whose
 * axial beam divides by a zero rest length -> NaN). Thresholds are relative to
 * the model's bounding-box diagonal so they mean the same thing regardless of
 * the coordinate scale, and small enough to only catch truly-degenerate
 * geometry, never a thin-but-real crease triangle. A no-op for clean inputs.
 */
function removeDegenerateGeometry(fold: FoldDocument, diagnostics: SimulatorDiagnostics): void {
  const coords = fold.vertices_coords.map((coord) => normalizePoint(coord));
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const c of coords) {
    for (let k = 0; k < 3; k += 1) {
      if (c[k]! < min[k]!) min[k] = c[k]!;
      if (c[k]! > max[k]!) max[k] = c[k]!;
    }
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  // A crease triangle in a normalized sheet has cross-magnitude (2*area) far
  // above diagonal^2 * 1e-9; a collinear/coincident one sits at ~0.
  const minCrossMag = diagonal * diagonal * 1e-9;
  const minEdgeLenSq = (diagonal * 1e-6) ** 2;

  let droppedFaces = 0;
  fold.faces_vertices = fold.faces_vertices.filter((face) => {
    if (face.length < 3) return true; // validateFold already rejects these
    const a = coords[face[0]!]!;
    const b = coords[face[1]!]!;
    const c = coords[face[2]!]!;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (Math.hypot(cx, cy, cz) < minCrossMag) {
      droppedFaces += 1;
      return false;
    }
    return true;
  });

  let droppedEdges = 0;
  const assignments = fold.edges_assignment;
  const foldAngles = fold.edges_foldAngle;
  const keptEdges: [number, number][] = [];
  const keptAssignment: FoldAssignment[] = [];
  const keptFoldAngle: Array<number | null> = [];
  fold.edges_vertices.forEach((edge, index) => {
    const a = coords[edge[0]]!;
    const b = coords[edge[1]]!;
    const distSq = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    if (distSq < minEdgeLenSq) {
      droppedEdges += 1;
      return;
    }
    keptEdges.push(edge);
    if (assignments) keptAssignment.push(assignments[index] ?? 'U');
    if (foldAngles) keptFoldAngle.push(foldAngles[index] ?? null);
  });
  fold.edges_vertices = keptEdges;
  if (assignments) fold.edges_assignment = keptAssignment;
  if (foldAngles) fold.edges_foldAngle = keptFoldAngle;

  if (droppedFaces || droppedEdges) {
    diagnostics.warnings.push(
      `dropped ${droppedFaces} degenerate triangle(s) and ${droppedEdges} zero-length edge(s)`
    );
  }
}

function triangulateFold(fold: FoldDocument, diagnostics: SimulatorDiagnostics): void {
  // One O(edges) index, kept in sync as triangulation appends diagonal edges, so
  // every dedup below is O(1) instead of a linear `findEdge` scan.
  const edgeIndex = buildEdgeIndex(fold.edges_vertices);
  const nextFaces: number[][] = [];
  const originalFaceCount = fold.faces_vertices.length;
  for (let faceIndex = 0; faceIndex < originalFaceCount; faceIndex += 1) {
    const face = fold.faces_vertices[faceIndex] ?? [];
    if (face.length === 3) {
      nextFaces.push(face);
      continue;
    }
    if (face.length === 4) {
      triangulateQuad(fold, face, nextFaces, edgeIndex);
      continue;
    }

    const coords = projectFaceTo2D(fold, face);
    const triangles = earcut(coords, undefined, 2);
    if (triangles.length < 3) {
      diagnostics.warnings.push(`face ${faceIndex} could not be triangulated`);
      continue;
    }
    // earcut's output stands, as upstream's does (pattern.js `triangulatePolys`).
    // It triangulates for validity, not quality, so a long thin ring can come
    // back as slivers; upstream's answer to a model that then will not settle is
    // a smaller timestep, not a better mesh.
    //
    // earcut normalises its ring's winding internally, so its triangles can come
    // back wound against the source face (mapbox/earcut#44) -- and against the
    // sheet's 3- and 4-vertex faces, which pass through untouched. Half the
    // normals then point the wrong way and `buildCreaseParams`' winding-order
    // convention folds those creases backwards. Upstream restores the source
    // winding too, by finding its first ring edge among the triangles and
    // flipping all of them; per-triangle signed area needs no such search.
    const ringSign = Math.sign(ringSignedArea(coords));
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] ?? 0;
      const b = triangles[i + 1] ?? 0;
      const c = triangles[i + 2] ?? 0;
      const oriented =
        ringSign !== 0 && Math.sign(triangleSignedArea(coords, a, b, c)) === -ringSign
          ? [a, c, b]
          : [a, b, c];
      nextFaces.push(oriented.map((index) => face[index] ?? 0));
    }
  }

  fold.faces_vertices = nextFaces;
  for (const face of nextFaces) {
    for (const [a, b] of facePairs(face)) {
      appendEdgeIfMissing(fold, edgeIndex, a, b);
    }
  }
}

/**
 * Flatten a face onto its own plane for earcut.
 *
 * The plane cannot be assumed: `normalizePoint` lifts a 2-component FOLD into
 * the xz plane, while a 3-component FOLD keeps whatever plane the file used --
 * commonly xy with z=0. Projecting onto a fixed axis pair therefore collapses
 * one of the two to a line, and earcut returns nothing for every polygon in the
 * sheet. Drop the axis the face's Newell normal points along instead, which is
 * the one that carries no shape. (Upstream covers the same case by retrying
 * earcut on each of the three axis rotations until one returns enough triangles;
 * the normal names the right plane outright.)
 *
 * Which two axes survive, and in which order, does not matter to the caller:
 * it orients the triangles against this same projection's winding, so a
 * handedness flip cancels out.
 */
function projectFaceTo2D(fold: FoldDocument, face: number[]): number[] {
  const points = face.map((vertex) => normalizePoint(fold.vertices_coords[vertex] ?? [0, 0, 0]));
  const normal = [0, 0, 0];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    normal[0]! += (p[1] - q[1]) * (p[2] + q[2]);
    normal[1]! += (p[2] - q[2]) * (p[0] + q[0]);
    normal[2]! += (p[0] - q[0]) * (p[1] + q[1]);
  }
  // A fully degenerate ring has no plane to speak of; keep the xz projection
  // that 2-component FOLD input has always used and let the degenerate filter
  // clean up whatever earcut makes of it.
  let dropped = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(normal[axis]!) > Math.abs(normal[dropped]!)) dropped = axis;
  }
  const [u, v] = dropped === 0 ? [1, 2] : dropped === 1 ? [0, 2] : [0, 1];
  const coords: number[] = [];
  for (const point of points) {
    coords.push(point[u!]!, point[v!]!);
  }
  return coords;
}

function ringSignedArea(coords: number[]): number {
  let sum = 0;
  for (let i = 0, j = coords.length - 2; i < coords.length; j = i, i += 2) {
    sum += coords[j]! * coords[i + 1]! - coords[i]! * coords[j + 1]!;
  }
  return sum / 2;
}

function triangleSignedArea(coords: number[], a: number, b: number, c: number): number {
  const ax = coords[a * 2]!, ay = coords[a * 2 + 1]!;
  const bx = coords[b * 2]!, by = coords[b * 2 + 1]!;
  const cx = coords[c * 2]!, cy = coords[c * 2 + 1]!;
  return ((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
}

function triangulateQuad(
  fold: FoldDocument,
  face: number[],
  nextFaces: number[][],
  edgeIndex: Map<number, number>
): void {
  const d1 = pointDistanceSq(fold, face[0] ?? 0, face[2] ?? 0);
  const d2 = pointDistanceSq(fold, face[1] ?? 0, face[3] ?? 0);
  if (d2 < d1) {
    appendEdgeIfMissing(fold, edgeIndex, face[1] ?? 0, face[3] ?? 0);
    nextFaces.push([face[0] ?? 0, face[1] ?? 0, face[3] ?? 0]);
    nextFaces.push([face[1] ?? 0, face[2] ?? 0, face[3] ?? 0]);
  } else {
    appendEdgeIfMissing(fold, edgeIndex, face[0] ?? 0, face[2] ?? 0);
    nextFaces.push([face[0] ?? 0, face[1] ?? 0, face[2] ?? 0]);
    nextFaces.push([face[0] ?? 0, face[2] ?? 0, face[3] ?? 0]);
  }
}

// Append an edge only if it isn't already present, keeping `edgeIndex` in sync so
// subsequent lookups (and appends) stay O(1). Replaces the old linear-scan dedup.
function appendEdgeIfMissing(
  fold: FoldDocument,
  edgeIndex: Map<number, number>,
  a: number,
  b: number
): void {
  const key = edgeKey(a, b);
  if (edgeIndex.has(key)) return;
  edgeIndex.set(key, fold.edges_vertices.length);
  fold.edges_vertices.push([a, b]);
  fold.edges_assignment?.push('F');
  fold.edges_foldAngle?.push(0);
}

function pointDistanceSq(fold: FoldDocument, a: number, b: number): number {
  const ca = fold.vertices_coords[a] ?? [0, 0, 0];
  const cb = fold.vertices_coords[b] ?? [0, 0, 0];
  const dx = (ca[0] ?? 0) - (cb[0] ?? 0);
  const dz = (ca[2] ?? ca[1] ?? 0) - (cb[2] ?? cb[1] ?? 0);
  return dx * dx + dz * dz;
}

function buildFacesEdges(fold: FoldDocument, diagnostics: SimulatorDiagnostics): number[][] {
  // Build the edge lookup once (O(edges)) and hit it O(1) per face-edge, instead
  // of a linear `findEdge` scan per face-edge (which was O(faces × edges)).
  const edgeIndex = buildEdgeIndex(fold.edges_vertices);
  return fold.faces_vertices.map((face, faceIndex) =>
    facePairs(face).map(([a, b]) => {
      const edge = edgeIndex.get(edgeKey(a, b)) ?? -1;
      if (edge === -1) {
        diagnostics.warnings.push(`face ${faceIndex} references missing edge ${a}-${b}`);
      }
      return edge;
    })
  );
}

function buildEdgesFaces(
  fold: FoldDocument,
  facesEdges: number[][],
  diagnostics: SimulatorDiagnostics
): number[][] {
  const edgesFaces = fold.edges_vertices.map((): number[] => []);
  facesEdges.forEach((faceEdges, faceIndex) => {
    faceEdges.forEach((edge) => {
      if (edge < 0) return;
      edgesFaces[edge]?.push(faceIndex);
      if ((edgesFaces[edge]?.length ?? 0) > 2) {
        diagnostics.warnings.push(`edge ${edge} is incident to more than two faces`);
      }
    });
  });
  return edgesFaces;
}

function buildCreaseParams(fold: FoldDocument, edgesFaces: number[][]): CreaseParameter[] {
  const params: CreaseParameter[] = [];
  fold.edges_vertices.forEach((edge, edgeIndex) => {
    const assignment: FoldAssignment = fold.edges_assignment?.[edgeIndex] ?? 'U';
    const angle = fold.edges_foldAngle?.[edgeIndex] ?? assignmentFoldAngle(assignment);
    if ((assignment !== 'M' && assignment !== 'V' && assignment !== 'F') || angle === null) return;

    const faces = edgesFaces[edgeIndex] ?? [];
    if (faces.length !== 2) return;
    let face1Index = faces[0] ?? 0;
    let face2Index = faces[1] ?? 0;
    const face1 = fold.faces_vertices[face1Index] ?? [];
    const face2 = fold.faces_vertices[face2Index] ?? [];
    if (face1.length !== 3 || face2.length !== 3) return;
    let vertex1 = face1.find((vertex) => vertex !== edge[0] && vertex !== edge[1]);
    let vertex2 = face2.find((vertex) => vertex !== edge[0] && vertex !== edge[1]);
    if (vertex1 === undefined || vertex2 === undefined) return;

    const v1Index = face2.indexOf(edge[0]);
    const v2Index = face2.indexOf(edge[1]);
    if (v2Index - v1Index === 1 || v2Index - v1Index === -2) {
      [face1Index, face2Index] = [face2Index, face1Index];
      [vertex1, vertex2] = [vertex2, vertex1];
    }

    params.push({
      face1: face1Index,
      vertex1,
      face2: face2Index,
      vertex2,
      edge: edgeIndex,
      targetAngle: angle,
    });
  });
  return params;
}
