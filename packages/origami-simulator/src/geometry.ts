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

export function normalizePoint(coord: number[]): [number, number, number] {
  if (coord.length === 2) return [coord[0] ?? 0, 0, coord[1] ?? 0];
  return [coord[0] ?? 0, coord[1] ?? 0, coord[2] ?? 0];
}

export function distanceToLine2D(
  point: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
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
    positions[a + 2] - positions[b + 2],
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
