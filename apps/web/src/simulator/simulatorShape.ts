/**
 * The paper's shape as something kept outside a session: keyed by its flat
 * sheet rather than by the model's numbering, so it can be put back on another
 * load of the same region, or refused when the region is not the same.
 *
 * A Diagram step keeps one (implementation-plans/diagram-pose-simulator-tools.md,
 * "What a step stores"), whose rule is that links are geometric, never ids. So
 * nothing here names a node or a face by its index:
 *
 * - **The sheet's order.** Nodes are ordered by where they lie on the flat
 *   sheet, relative to its lower-left corner and rounded to 2^-20 of its size
 *   (the rounding `relativeCreaseFingerprint` uses); creases by their ordered
 *   pair of end nodes. Two nodes on one flat point (a slit) are told apart by
 *   where their triangles are.
 * - **The key** (`simulatorSheetKey`) digests that order, the triangles and
 *   each crease's target angle. Equal keys mean node *i* is the same node in
 *   both: a moved or renumbered region keeps its key, and any change to its
 *   creases or triangulation changes it, so a shape is dropped rather than
 *   scrambled. An order that cannot be decided has no key at all.
 * - **Pins** are points: each pinned face as the centroid of one of its
 *   triangles, which is strictly inside even a non-convex face, relative to
 *   the sheet's corner. A restore finds the face each point lies in.
 *
 * Pure: the worker session reads the solver and calls these, and the Diagram
 * encodes the state for its file with {@link encodeSimulatorShapeState}.
 */
import { createSolverShape, type SolverShape } from '@treemaker/origami-simulator';
import { keyDigest } from '../lib/keyDigest';

/** Names the algorithm in the key, as `rc1:` and `cs1:` do. */
export const SIMULATOR_SHEET_KEY_PREFIX = 'sk1:';
/** Names the encoding of a kept state. */
export const SIMULATOR_SHAPE_STATE_PREFIX = 'ss1:';
/** The rounding of a flat coordinate, as a fraction of the sheet's size. A power of two; see `regionIdentity`. */
const SHEET_QUANTUM = 2 ** -20;
/**
 * The most state a shape may carry, before base64: 12 bytes a node and 4 a
 * crease, so about 87,000 nodes. A picture of the same region is bounded at
 * 4 MB, and a shape this size is already a quarter of that.
 */
export const SIMULATOR_SHAPE_MAX_BYTES = 1 << 20;

/** A point on the flat sheet, relative to its lower-left corner, in the solver's units. */
export type SheetPoint = [number, number, number];

/**
 * The paper's shape kept outside a session: what the worker reads
 * (`readShape`) and puts back (`restoreShape`, or the load's `shape`).
 */
export interface SimulatorShape {
  /** The {@link simulatorSheetKey} of the sheet it was read from. */
  sheet: string;
  /** Each pinned face, as a point inside it on the flat sheet. */
  pins: SheetPoint[];
  /** A kept pull holds: the paper rests in this shape, and Spring back applies. */
  posed: boolean;
  /**
   * Each node's displacement from the flat sheet (×3), then each crease's
   * angle, in the sheet's order. See `SolverShape` for why displacements and
   * why the angles are kept rather than recomputed.
   */
  state: Float32Array;
}

/** What the model's flat sheet is made of, as a prepared model has it. */
export interface SimulatorSheetInput {
  /** xyz per node on the flat sheet. */
  flat: Float32Array;
  /** Three nodes per triangle. */
  triangles: Uint32Array;
  edges: readonly (readonly [number, number])[];
  creases: readonly { edge: number; targetAngle: number }[];
}

/** A sheet's canonical order, and its key; see the module comment. */
export interface SimulatorSheet {
  /** Null when two nodes or two creases cannot be told apart: such a sheet keeps no shape. */
  key: string | null;
  /** For each place in the order, the model's node there. */
  nodes: Uint32Array;
  /** For each place in the order, the model's crease there. */
  creases: Uint32Array;
  /** The flat sheet's lower-left corner, which pin points are relative to. */
  corner: SheetPoint;
}

/** Quantised flat place and tie-break of one node, compared in that order. */
type NodePlace = [number, number, number, number, number, number];

function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index]! - b[index]!;
    if (delta !== 0) return delta;
  }
  return 0;
}

/** The sheet's order and key. Linear in the model, bar the sorts; a session keeps it. */
export function simulatorSheetOf(input: SimulatorSheetInput): SimulatorSheet {
  const { flat, triangles, edges, creases } = input;
  const nodeCount = flat.length / 3;
  const corner: SheetPoint = [Infinity, Infinity, Infinity];
  const far: SheetPoint = [-Infinity, -Infinity, -Infinity];
  for (let node = 0; node < nodeCount; node += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      corner[axis] = Math.min(corner[axis]!, flat[node * 3 + axis]!);
      far[axis] = Math.max(far[axis]!, flat[node * 3 + axis]!);
    }
  }
  if (nodeCount === 0) corner.fill(0);
  const size = Math.max(far[0] - corner[0], far[1] - corner[1], far[2] - corner[2]);
  const quantum = size > 0 ? size * SHEET_QUANTUM : 1;
  // `+ 0` folds a rounded -0 into 0, so the two never spell differently.
  const round = (value: number, origin: number) => Math.round((value - origin) / quantum) + 0;

  // Where each node's triangles are, for telling apart two nodes on one point.
  const centroidSum = new Float64Array(nodeCount * 3);
  const centroidCount = new Uint32Array(nodeCount);
  for (let triangle = 0; triangle < triangles.length / 3; triangle += 1) {
    const centre = [0, 0, 0];
    for (let corner3 = 0; corner3 < 3; corner3 += 1) {
      const node = triangles[triangle * 3 + corner3]!;
      for (let axis = 0; axis < 3; axis += 1) centre[axis]! += flat[node * 3 + axis]! / 3;
    }
    for (let corner3 = 0; corner3 < 3; corner3 += 1) {
      const node = triangles[triangle * 3 + corner3]!;
      for (let axis = 0; axis < 3; axis += 1) centroidSum[node * 3 + axis]! += centre[axis]!;
      centroidCount[node]! += 1;
    }
  }
  const places: NodePlace[] = [];
  for (let node = 0; node < nodeCount; node += 1) {
    const count = Math.max(1, centroidCount[node]!);
    places.push([
      round(flat[node * 3]!, corner[0]),
      round(flat[node * 3 + 1]!, corner[1]),
      round(flat[node * 3 + 2]!, corner[2]),
      round(centroidSum[node * 3]! / count, corner[0]),
      round(centroidSum[node * 3 + 1]! / count, corner[1]),
      round(centroidSum[node * 3 + 2]! / count, corner[2]),
    ]);
  }
  const nodeOrder = Uint32Array.from({ length: nodeCount }, (_, node) => node).sort((a, b) =>
    compareTuples(places[a]!, places[b]!)
  );
  let ambiguous = false;
  const rank = new Uint32Array(nodeCount);
  const nodeKeys: string[] = [];
  nodeOrder.forEach((node, slot) => {
    rank[node] = slot;
    const place = places[node]!;
    const previous = slot > 0 ? places[nodeOrder[slot - 1]!]! : null;
    const next = slot + 1 < nodeCount ? places[nodeOrder[slot + 1]!]! : null;
    const tiedOnSheet = (other: NodePlace | null) => other !== null && compareTuples(place.slice(0, 3), other.slice(0, 3)) === 0;
    if (previous && compareTuples(place, previous) === 0) ambiguous = true;
    // A node's triangles are keyed only where they break a tie: elsewhere they
    // would only add rounding that a moved sheet could cross.
    nodeKeys.push((tiedOnSheet(previous) || tiedOnSheet(next) ? place : place.slice(0, 3)).join(','));
  });

  const triangleKeys: string[] = [];
  for (let triangle = 0; triangle < triangles.length / 3; triangle += 1) {
    const ranks = [0, 1, 2].map((corner3) => rank[triangles[triangle * 3 + corner3]!]!);
    // Turned to start at its least node, keeping its winding: which way a
    // triangle faces is part of the sheet.
    const start = ranks.indexOf(Math.min(...ranks));
    triangleKeys.push([0, 1, 2].map((offset) => ranks[(start + offset) % 3]).join(','));
  }
  triangleKeys.sort();

  const creasePairs = creases.map((crease) => {
    const edge = edges[crease.edge];
    const a = edge ? rank[edge[0]]! : 0;
    const b = edge ? rank[edge[1]]! : 0;
    return [Math.min(a, b), Math.max(a, b)] as const;
  });
  const creaseOrder = Uint32Array.from({ length: creases.length }, (_, crease) => crease).sort((a, b) =>
    compareTuples(creasePairs[a]!, creasePairs[b]!)
  );
  const creaseKeys: string[] = [];
  creaseOrder.forEach((crease, slot) => {
    if (slot > 0 && compareTuples(creasePairs[crease]!, creasePairs[creaseOrder[slot - 1]!]!) === 0) ambiguous = true;
    const [low, high] = creasePairs[crease]!;
    creaseKeys.push(`${low},${high},${Math.round(creases[crease]!.targetAngle * 1e6) / 1e6}`);
  });

  const key = ambiguous
    ? null
    : keyDigest(
        [`n${nodeCount}`, ...nodeKeys, `t${triangleKeys.length}`, ...triangleKeys, `c${creases.length}`, ...creaseKeys],
        SIMULATOR_SHEET_KEY_PREFIX
      );
  return { key, nodes: nodeOrder, creases: creaseOrder, corner };
}

/** The key a shape read from this sheet carries; null for a sheet whose order cannot be decided. */
export function simulatorSheetKey(input: SimulatorSheetInput): string | null {
  return simulatorSheetOf(input).key;
}

/** How many bytes a shape's state takes before base64: 12 a node, 4 a crease. */
export function simulatorShapeBytes(nodeCount: number, creaseCount: number): number {
  return nodeCount * 12 + creaseCount * 4;
}

/** A solver's shape in the sheet's order. */
export function shapeStateOf(sheet: SimulatorSheet, shape: SolverShape): Float32Array {
  const nodeCount = sheet.nodes.length;
  const state = new Float32Array(nodeCount * 3 + sheet.creases.length);
  sheet.nodes.forEach((node, slot) => {
    for (let axis = 0; axis < 3; axis += 1) state[slot * 3 + axis] = shape.offsets[node * 3 + axis]!;
  });
  sheet.creases.forEach((crease, slot) => {
    state[nodeCount * 3 + slot] = shape.theta[crease]!;
  });
  return state;
}

/** A state in the sheet's order back in the model's own; null when it is not this sheet's size. */
export function solverShapeOf(sheet: SimulatorSheet, state: Float32Array): SolverShape | null {
  const nodeCount = sheet.nodes.length;
  if (state.length !== nodeCount * 3 + sheet.creases.length) return null;
  const shape = createSolverShape(nodeCount, sheet.creases.length);
  sheet.nodes.forEach((node, slot) => {
    for (let axis = 0; axis < 3; axis += 1) shape.offsets[node * 3 + axis] = state[slot * 3 + axis]!;
  });
  sheet.creases.forEach((crease, slot) => {
    shape.theta[crease] = state[nodeCount * 3 + slot]!;
  });
  return shape;
}

/** What pins are taken from: the flat sheet, its triangles, and each triangle's face. */
export interface SimulatorPinSheet {
  flat: Float32Array;
  triangles: Uint32Array;
  faceGroups: Int32Array;
}

/** Each face as the centroid of its first triangle, relative to the sheet's corner. */
export function pinPointsOf(sheet: SimulatorSheet, model: SimulatorPinSheet, faces: readonly number[]): SheetPoint[] {
  const wanted = new Set(faces);
  const points: SheetPoint[] = [];
  for (let triangle = 0; triangle < model.faceGroups.length && wanted.size > 0; triangle += 1) {
    const face = model.faceGroups[triangle]!;
    if (!wanted.has(face)) continue;
    wanted.delete(face);
    const point: SheetPoint = [0, 0, 0];
    for (let corner = 0; corner < 3; corner += 1) {
      const node = model.triangles[triangle * 3 + corner]!;
      for (let axis = 0; axis < 3; axis += 1) point[axis] += model.flat[node * 3 + axis]! / 3;
    }
    points.push([point[0] - sheet.corner[0], point[1] - sheet.corner[1], point[2] - sheet.corner[2]]);
  }
  return points.sort(compareTuples);
}

/** How far outside a triangle, in barycentric terms, a point may lie and still be in it. */
const INSIDE = 1e-7;

/**
 * The face each point lies in, ascending and without repeats; null when a
 * point lies in none, so a restore that cannot place a pin places none.
 */
export function facesAtPinPoints(
  sheet: SimulatorSheet,
  model: SimulatorPinSheet,
  points: readonly SheetPoint[]
): number[] | null {
  const faces = new Set<number>();
  const at = (node: number, axis: number) => model.flat[node * 3 + axis]!;
  for (const relative of points) {
    const p = [relative[0] + sheet.corner[0], relative[1] + sheet.corner[1], relative[2] + sheet.corner[2]];
    let found: number | null = null;
    for (let triangle = 0; triangle < model.faceGroups.length && found === null; triangle += 1) {
      const [a, b, c] = [0, 1, 2].map((corner) => model.triangles[triangle * 3 + corner]!) as [number, number, number];
      const v0 = [0, 1, 2].map((axis) => at(b, axis) - at(a, axis));
      const v1 = [0, 1, 2].map((axis) => at(c, axis) - at(a, axis));
      const v2 = [0, 1, 2].map((axis) => p[axis]! - at(a, axis));
      const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
      const d00 = dot(v0, v0);
      const d01 = dot(v0, v1);
      const d11 = dot(v1, v1);
      const denominator = d00 * d11 - d01 * d01;
      if (!(Math.abs(denominator) > 1e-18)) continue;
      const d20 = dot(v2, v0);
      const d21 = dot(v2, v1);
      const v = (d11 * d20 - d01 * d21) / denominator;
      const w = (d00 * d21 - d01 * d20) / denominator;
      if (v < -INSIDE || w < -INSIDE || 1 - v - w < -INSIDE) continue;
      // On the triangle's plane, too: the flat sheet is one plane, but a point
      // carried over from another sheet need not be on it.
      const off = v2.map((value, axis) => value - v * v0[axis]! - w * v1[axis]!);
      if (Math.hypot(off[0]!, off[1]!, off[2]!) > INSIDE * Math.sqrt(Math.max(d00, d11))) continue;
      found = model.faceGroups[triangle]!;
    }
    if (found === null) return null;
    faces.add(found);
  }
  return [...faces].sort((a, b) => a - b);
}

/**
 * A state as text for a file: `ss1:` and base64 of little-endian float32s.
 * Null when it is over {@link SIMULATOR_SHAPE_MAX_BYTES}.
 */
export function encodeSimulatorShapeState(state: Float32Array): string | null {
  const bytes = state.length * 4;
  if (bytes > SIMULATOR_SHAPE_MAX_BYTES) return null;
  const view = new DataView(new ArrayBuffer(bytes));
  state.forEach((value, index) => view.setFloat32(index * 4, value, true));
  const raw = new Uint8Array(view.buffer);
  let binary = '';
  // In slices: a spread of a megabyte would overflow the argument limit.
  for (let start = 0; start < raw.length; start += 0x8000) {
    binary += String.fromCharCode(...raw.subarray(start, start + 0x8000));
  }
  return `${SIMULATOR_SHAPE_STATE_PREFIX}${btoa(binary)}`;
}

/** The state {@link encodeSimulatorShapeState} wrote, or null for anything else. */
export function decodeSimulatorShapeState(text: string): Float32Array | null {
  if (!text.startsWith(SIMULATOR_SHAPE_STATE_PREFIX)) return null;
  let binary: string;
  try {
    binary = atob(text.slice(SIMULATOR_SHAPE_STATE_PREFIX.length));
  } catch {
    return null;
  }
  if (binary.length % 4 !== 0 || binary.length > SIMULATOR_SHAPE_MAX_BYTES) return null;
  const view = new DataView(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) view.setUint8(index, binary.charCodeAt(index));
  const state = new Float32Array(binary.length / 4);
  for (let index = 0; index < state.length; index += 1) state[index] = view.getFloat32(index * 4, true);
  return state;
}
