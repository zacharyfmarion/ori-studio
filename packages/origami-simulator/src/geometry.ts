import type { FoldAssignment, FoldDocument } from './types.js';

export function assignmentFoldAngle(assignment: FoldAssignment): number | null {
  if (assignment === 'M') return -180;
  if (assignment === 'V') return 180;
  if (assignment === 'F') return 0;
  return null;
}

export function normalizeAssignment(value: unknown): FoldAssignment {
  return value === 'B' ||
    value === 'M' ||
    value === 'V' ||
    value === 'F' ||
    value === 'U' ||
    value === 'C' ||
    value === 'J'
    ? value
    : 'U';
}

/**
 * Lift a FOLD coordinate into the renderer's world: the sheet lies in the XZ
 * plane, so world **Y** is the flat paper's normal and the axis the orbit camera
 * spins about.
 *
 * A 2-component coordinate lifts to `[x, 0, −y]`, and the **negation is
 * load-bearing**. Two facts meet here:
 *
 * 1. Every FOLD this app produces is **y-down**, because that is the crease
 *    pattern canvas's own model space (`userCameraToView` sends model +y to
 *    device +y). TreeMaker converts on the way out — `to_fold_document` emits
 *    `paper_height − y` — so its exports land in the same space rather than in
 *    the y-up one a reader might assume from the FOLD spec.
 * 2. `MeshRenderer`'s view transform is a **reflection**: `viewRotation` has
 *    determinant −1 at every angle (see `webgl/camera.ts`), so the picture it
 *    draws is the mirror of the true view.
 *
 * Lifted as `[x, 0, y]` — upstream Origami Simulator's spelling, which is right
 * for the right-handed THREE.js camera it draws through — a y-down sheet comes
 * out flipped: a crease running to the canvas's top-right corner runs to the
 * bottom-right on screen. Negating cancels the reflection, and it is the same
 * cancellation a 3D folded figure already makes with `toSimBasis`
 * (`(x, y, z) → (x, z, −y)`, whose flat case is exactly this) — so the two
 * surfaces now place the same sheet the same way up.
 *
 * The paper's two tones and the mountain/valley sense do not ride on this sign:
 * `prepareSimulationFold` re-derives every face's winding from the lifted
 * coordinates and pairs it with a matching fold-angle sign, both downstream of
 * here.
 *
 * A 3-component coordinate is passed through: it already names a plane, and
 * which one is the file's business.
 */
export function normalizePoint(coord: number[]): [number, number, number] {
  if (coord.length === 2) return [coord[0] ?? 0, 0, -(coord[1] ?? 0)];
  return [coord[0] ?? 0, coord[1] ?? 0, coord[2] ?? 0];
}

export function distanceToLine2D(
  point: [number, number, number],
  a: [number, number, number],
  b: [number, number, number]
): number {
  const ax = a[0];
  const az = a[2];
  const bx = b[0];
  const bz = b[2];
  const px = point[0];
  const pz = point[2];
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len === 0) return Math.hypot(px - ax, pz - az);
  return Math.abs(dx * (az - pz) - (ax - px) * dz) / len;
}

export function edgeLength(positions: Float32Array, edge: [number, number]): number {
  const a = edge[0] * 3;
  const b = edge[1] * 3;
  return Math.hypot(
    positions[a] - positions[b],
    positions[a + 1] - positions[b + 1],
    positions[a + 2] - positions[b + 2]
  );
}

export function findEdge(edges: [number, number][], a: number, b: number): number {
  return edges.findIndex((edge) => sameEdge(edge, a, b));
}

export function sameEdge(edge: [number, number], a: number, b: number): boolean {
  return (edge[0] === a && edge[1] === b) || (edge[0] === b && edge[1] === a);
}

// Pack an unordered vertex pair into one numeric key for O(1) edge lookup. The
// stride (2^26 ≈ 67M) exceeds any realistic vertex count, so distinct pairs never
// collide while the key stays well inside the safe-integer range. Replaces the
// O(edges) linear `findEdge` scan in the fold-prep hot paths (a big pattern with
// tens of thousands of edges was O(E²) → seconds; this makes it O(E)).
const EDGE_KEY_STRIDE = 0x4000000;

export function edgeKey(a: number, b: number): number {
  return a < b ? a * EDGE_KEY_STRIDE + b : b * EDGE_KEY_STRIDE + a;
}

export function buildEdgeIndex(edges: [number, number][]): Map<number, number> {
  const index = new Map<number, number>();
  for (let i = 0; i < edges.length; i += 1) {
    const edge = edges[i];
    if (edge) index.set(edgeKey(edge[0], edge[1]), i);
  }
  return index;
}

export function facePairs(face: number[]): Array<[number, number]> {
  return face.map((vertex, index) => [vertex, face[(index + 1) % face.length] ?? vertex]);
}

export function cloneFold(fold: FoldDocument): FoldDocument {
  return {
    ...fold,
    frame_classes: [...(fold.frame_classes ?? [])],
    vertices_coords: fold.vertices_coords.map((coord) => [...coord]),
    edges_vertices: fold.edges_vertices.map((edge) => [edge[0], edge[1]]),
    edges_assignment: fold.edges_assignment ? [...fold.edges_assignment] : undefined,
    edges_foldAngle: fold.edges_foldAngle ? [...fold.edges_foldAngle] : undefined,
    edges_faces: fold.edges_faces?.map((faces) => [...faces]),
    faces_vertices: fold.faces_vertices.map((face) => [...face]),
    faces_edges: fold.faces_edges?.map((edges) => [...edges]),
    faceOrders: fold.faceOrders?.map((order) => [order[0], order[1], order[2]]),
  };
}
