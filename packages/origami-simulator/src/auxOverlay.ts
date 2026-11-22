// Aux lines drawn on the paper rather than built into it.
//
// Nothing folds an auxiliary line, so a simulation must be what it would be had
// the line never been drawn. The app leaves aux lines out of the mesh it hands
// the simulator and carries them beside it under `AUX_LINES_KEY`; this cuts each
// one to the flat sheet's triangles so it rides on the paper as it folds.
//
// A cut's ends are virtual vertices: a triangle's three nodes and barycentric
// weights over them. Weights survive every affine map, so a renderer places an
// end as the weighted sum of node positions it already has, at any fold; the
// solver never sees one.
import { EDGE_BOUNDARY_A, EDGE_BOUNDARY_B } from './edgeBoundary.js';
import { edgeKey, normalizePoint } from './geometry.js';
import type { FoldAssignment, FoldDocument } from './types.js';

/**
 * The fold key aux lines travel under: `[[ax, ay], [bx, by]]` per line, each
 * point in the space of `vertices_coords`. No `:edges_` in it, so the per-edge
 * remaps leave it alone.
 */
export const AUX_LINES_KEY = 'oristudio:aux_lines';

/** One aux line: two points in the space of the fold's `vertices_coords`. */
export type AuxLine = readonly [readonly number[], readonly number[]];

/** Vertices past a mesh's nodes, each placed in a triangle. */
export interface VirtualVertices {
  /** The index of the first: the mesh's node count. */
  start: number;
  /** The three nodes of the triangle each lies in, 3 per vertex. */
  nodes: Uint32Array;
  /** Its barycentric weights over those nodes, 3 per vertex, summing to 1. */
  weights: Float32Array;
}

/** A fold's aux lines cut to its mesh's triangles. */
export interface AuxOverlay {
  /** Where each cut end lies, as {@link VirtualVertices.nodes} has it. */
  nodes: Uint32Array;
  /** Its weights, as {@link VirtualVertices.weights} has them. */
  weights: Float32Array;
  /** Each cut's two ends, as indices into the ends above, 2 per cut. */
  pieces: Uint32Array;
  /** The triangle each cut lies on. */
  triangles: Uint32Array;
  /** Per cut, `EDGE_BOUNDARY_A` / `EDGE_BOUNDARY_B` for an end on the paper's edge or a fold. */
  ends: Uint8Array;
}

/** The aux lines a fold carries; none when the key is absent or malformed. */
export function auxLinesOf(fold: FoldDocument): AuxLine[] {
  const value = fold[AUX_LINES_KEY];
  if (!Array.isArray(value)) return [];
  const lines: AuxLine[] = [];
  for (const line of value) {
    if (!Array.isArray(line) || line.length !== 2) continue;
    const [a, b] = line as unknown[];
    if (isPoint(a) && isPoint(b)) lines.push([a, b]);
  }
  return lines;
}

function isPoint(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((component) => typeof component === 'number' && Number.isFinite(component))
  );
}

/**
 * The fold with every aux line point mapped as its vertices were: whatever
 * moves `vertices_coords` must move the lines with them, or they come loose
 * from the paper. The fold itself when it carries none.
 */
export function withAuxLinesMapped(
  fold: FoldDocument,
  map: (point: readonly number[]) => number[]
): FoldDocument {
  if (!(AUX_LINES_KEY in fold)) return fold;
  return {
    ...fold,
    [AUX_LINES_KEY]: auxLinesOf(fold).map(([a, b]) => [map(a), map(b)]),
  };
}

/** Cuts shorter than this share of the sheet are dust, as in the 3D figure's cut. */
const MIN_PIECE_RELATIVE = 1e-9;
/** How near a triangle's side, as a share of the sheet, still counts as on it. */
const ON_SIDE_RELATIVE = 1e-9;
/** A weight below this is an end lying on the triangle's opposite side. */
const ZERO_WEIGHT = 1e-7;
/** Weights are compared at this resolution when two cuts share an end. */
const WEIGHT_KEY_SCALE = 1e9;

/** The mesh a cut reads: a prepared fold, vertices normalised, faces triangles. */
export interface AuxCutMesh {
  vertices_coords: number[][];
  faces_vertices: number[][];
  edges_vertices: [number, number][];
  edges_assignment?: FoldAssignment[];
}

/**
 * Cut `lines` to the mesh's triangles, or null when no line touches the paper.
 *
 * A line lying along a side two triangles share goes to the first; a stretch
 * already cut is never cut again. Two cuts share an end where it lies on the
 * same nodes — a side or a corner both triangles have — so a drawn line is one
 * chain across the paper, and a slit, whose two sides are different nodes,
 * still parts it.
 */
export function cutAuxLines(mesh: AuxCutMesh, lines: readonly AuxLine[]): AuxOverlay | null {
  const triangleCount = mesh.faces_vertices.length;
  if (lines.length === 0 || triangleCount === 0) return null;
  const sheet = flatSheet(mesh);
  const span = Math.max(sheet.maxU - sheet.minU, sheet.maxV - sheet.minV);
  if (!(span > 0)) return null;
  const minLength = MIN_PIECE_RELATIVE * span;
  const onSide = ON_SIDE_RELATIVE * span;
  const grid = triangleGrid(mesh, sheet);
  const outline = outlineOf(mesh);

  const ends = new Map<string, number>();
  const nodes: number[] = [];
  const weights: number[] = [];
  const pieces: number[] = [];
  const triangles: number[] = [];
  const flags: number[] = [];
  const seen = new Int32Array(triangleCount).fill(-1);

  lines.forEach((line, lineIndex) => {
    const [au, av] = sheet.project(line[0]);
    const [bu, bv] = sheet.project(line[1]);
    const du = bu - au;
    const dv = bv - av;
    const length = Math.hypot(du, dv);
    if (!(length > minLength)) return;

    const stretches: Array<{ from: number; to: number; triangle: number }> = [];
    for (const triangle of grid.near(au, av, bu, bv)) {
      if (seen[triangle] === lineIndex) continue;
      seen[triangle] = lineIndex;
      const corners = sheet.corners(mesh.faces_vertices[triangle]!);
      const kept = clipToTriangle(au, av, du, dv, corners, onSide);
      if (kept && (kept[1] - kept[0]) * length > minLength) {
        stretches.push({ from: kept[0], to: kept[1], triangle });
      }
    }
    stretches.sort((x, y) => x.from - y.from || y.to - x.to);

    let covered = -Infinity;
    for (const stretch of stretches) {
      const from = Math.max(stretch.from, covered);
      if ((stretch.to - from) * length <= minLength) continue;
      covered = Math.max(covered, stretch.to);
      const face = mesh.faces_vertices[stretch.triangle]!;
      const corners = sheet.corners(face);
      const endAt = (t: number) => {
        const placed = placeIn(face, corners, au + du * t, av + dv * t, stretch.triangle);
        let index = ends.get(placed.key);
        if (index === undefined) {
          index = nodes.length / 3;
          ends.set(placed.key, index);
          nodes.push(...placed.nodes);
          weights.push(...placed.weights);
        }
        return { index, onOutline: outline.holds(placed) };
      };
      const a = endAt(from);
      const b = endAt(stretch.to);
      pieces.push(a.index, b.index);
      triangles.push(stretch.triangle);
      flags.push((a.onOutline ? EDGE_BOUNDARY_A : 0) | (b.onOutline ? EDGE_BOUNDARY_B : 0));
    }
  });

  if (triangles.length === 0) return null;
  return {
    nodes: Uint32Array.from(nodes),
    weights: Float32Array.from(weights),
    pieces: Uint32Array.from(pieces),
    triangles: Uint32Array.from(triangles),
    ends: Uint8Array.from(flags),
  };
}

/**
 * `positions` (3 per node) with the virtual vertices after the nodes, each
 * where its weights put it. `positions` itself when there are none.
 */
export function withVirtualVertices(
  positions: Float32Array,
  virtual: VirtualVertices | undefined
): Float32Array {
  if (!virtual) return positions;
  const count = Math.floor(virtual.weights.length / 3);
  const out = new Float32Array((virtual.start + count) * 3);
  out.set(positions.subarray(0, Math.min(positions.length, virtual.start * 3)));
  for (let vertex = 0; vertex < count; vertex += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) {
        const node = virtual.nodes[vertex * 3 + k]!;
        sum += virtual.weights[vertex * 3 + k]! * (positions[node * 3 + axis] ?? 0);
      }
      out[(virtual.start + vertex) * 3 + axis] = sum;
    }
  }
  return out;
}

interface FlatSheet {
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
  /** A point of the fold's space in the sheet's own two axes. */
  project(point: readonly number[]): [number, number];
  /** A triangle's corners in those axes, `[u0, v0, u1, v1, u2, v2]`. */
  corners(face: readonly number[]): number[];
}

/**
 * The flat sheet in its own plane: the two axes left when the one its
 * triangles' normals point along is dropped, as `projectFaceTo2D` does per face.
 */
function flatSheet(mesh: AuxCutMesh): FlatSheet {
  const points = mesh.vertices_coords.map((coord) => normalizePoint(coord));
  const normal = [0, 0, 0];
  for (const face of mesh.faces_vertices) {
    const a = points[face[0]!];
    const b = points[face[1]!];
    const c = points[face[2]!];
    if (!a || !b || !c) continue;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    normal[0]! += Math.abs(u[1]! * v[2]! - u[2]! * v[1]!);
    normal[1]! += Math.abs(u[2]! * v[0]! - u[0]! * v[2]!);
    normal[2]! += Math.abs(u[0]! * v[1]! - u[1]! * v[0]!);
  }
  let dropped = 1;
  for (let axis = 0; axis < 3; axis += 1) {
    if (normal[axis]! > normal[dropped]!) dropped = axis;
  }
  const [uAxis, vAxis] = dropped === 0 ? [1, 2] : dropped === 1 ? [0, 2] : [0, 1];
  const u = points.map((point) => point[uAxis!]);
  const v = points.map((point) => point[vAxis!]);
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < u.length; i += 1) {
    minU = Math.min(minU, u[i]!);
    maxU = Math.max(maxU, u[i]!);
    minV = Math.min(minV, v[i]!);
    maxV = Math.max(maxV, v[i]!);
  }
  return {
    minU,
    maxU,
    minV,
    maxV,
    project(point) {
      const lifted = normalizePoint([...point]);
      return [lifted[uAxis!], lifted[vAxis!]];
    },
    corners(face) {
      return face.slice(0, 3).flatMap((vertex) => [u[vertex] ?? 0, v[vertex] ?? 0]);
    },
  };
}

/** Triangles bucketed by the cells of a uniform grid their boxes cover. */
function triangleGrid(mesh: AuxCutMesh, sheet: FlatSheet) {
  const count = mesh.faces_vertices.length;
  const side = Math.max(1, Math.ceil(Math.sqrt(count)));
  const width = Math.max(sheet.maxU - sheet.minU, Number.MIN_VALUE);
  const height = Math.max(sheet.maxV - sheet.minV, Number.MIN_VALUE);
  const cellU = width / side;
  const cellV = height / side;
  const column = (u: number) => Math.min(side - 1, Math.max(0, Math.floor((u - sheet.minU) / cellU)));
  const row = (v: number) => Math.min(side - 1, Math.max(0, Math.floor((v - sheet.minV) / cellV)));
  const cells: number[][] = Array.from({ length: side * side }, () => []);
  mesh.faces_vertices.forEach((face, triangle) => {
    const c = sheet.corners(face);
    const u0 = column(Math.min(c[0]!, c[2]!, c[4]!));
    const u1 = column(Math.max(c[0]!, c[2]!, c[4]!));
    const v0 = row(Math.min(c[1]!, c[3]!, c[5]!));
    const v1 = row(Math.max(c[1]!, c[3]!, c[5]!));
    for (let r = v0; r <= v1; r += 1) {
      for (let q = u0; q <= u1; q += 1) cells[r * side + q]!.push(triangle);
    }
  });
  const halfDiagonal = Math.hypot(cellU, cellV) / 2;
  return {
    /** Triangles in the cells the segment passes near; a triangle may repeat. */
    *near(au: number, av: number, bu: number, bv: number): Generator<number> {
      const du = bu - au;
      const dv = bv - av;
      const length = Math.hypot(du, dv);
      const q0 = column(Math.min(au, bu));
      const q1 = column(Math.max(au, bu));
      const r0 = row(Math.min(av, bv));
      const r1 = row(Math.max(av, bv));
      for (let r = r0; r <= r1; r += 1) {
        for (let q = q0; q <= q1; q += 1) {
          const cu = sheet.minU + (q + 0.5) * cellU;
          const cv = sheet.minV + (r + 0.5) * cellV;
          if (Math.abs(du * (cv - av) - dv * (cu - au)) > halfDiagonal * length) continue;
          yield* cells[r * side + q]!;
        }
      }
    },
  };
}

/**
 * The stretch `[from, to]` of the segment `a + t·d`, `t ∈ [0, 1]`, inside the
 * triangle `corners`, a point within `onSide` of a side counting as inside;
 * null when there is none. Liang–Barsky against the three sides.
 */
function clipToTriangle(
  au: number,
  av: number,
  du: number,
  dv: number,
  corners: readonly number[],
  onSide: number
): [number, number] | null {
  const area =
    (corners[2]! - corners[0]!) * (corners[5]! - corners[1]!) -
    (corners[3]! - corners[1]!) * (corners[4]! - corners[0]!);
  if (area === 0) return null;
  const sign = Math.sign(area);
  let from = 0;
  let to = 1;
  for (let side = 0; side < 3; side += 1) {
    const pu = corners[side * 2]!;
    const pv = corners[side * 2 + 1]!;
    const eu = corners[((side + 1) % 3) * 2]! - pu;
    const ev = corners[((side + 1) % 3) * 2 + 1]! - pv;
    // Signed distance from the side, times its length: inside is positive.
    const at = sign * (eu * (av - pv) - ev * (au - pu));
    const rate = sign * (eu * dv - ev * du);
    const floor = -onSide * Math.hypot(eu, ev);
    if (rate === 0) {
      if (at < floor) return null;
      continue;
    }
    const t = (floor - at) / rate;
    if (rate > 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to) return null;
  }
  return [from, to];
}

interface PlacedEnd {
  nodes: [number, number, number];
  weights: [number, number, number];
  /** The nodes it lies on: one at a corner, two on a side, three inside. */
  on: number[];
  /** Equal for two ends at one place on the same nodes. */
  key: string;
}

/** A point of a triangle as its nodes and weights, the near-zero weights zero. */
function placeIn(
  face: readonly number[],
  corners: readonly number[],
  u: number,
  v: number,
  triangle: number
): PlacedEnd {
  const [u0, v0, u1, v1, u2, v2] = corners as [number, number, number, number, number, number];
  const determinant = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2);
  const raw = [
    ((v1 - v2) * (u - u2) + (u2 - u1) * (v - v2)) / determinant,
    ((v2 - v0) * (u - u2) + (u0 - u2) * (v - v2)) / determinant,
  ];
  raw.push(1 - raw[0]! - raw[1]!);
  const nodes = [face[0]!, face[1]!, face[2]!] as [number, number, number];
  const kept = [0, 1, 2].filter((k) => raw[k]! >= ZERO_WEIGHT);
  const scaled = (weight: number) => Math.round(weight * WEIGHT_KEY_SCALE);
  const weights: [number, number, number] = [0, 0, 0];
  if (kept.length <= 1) {
    const corner = kept[0] ?? raw.indexOf(Math.max(...raw));
    weights[corner] = 1;
    return { nodes, weights, on: [nodes[corner]!], key: `n${nodes[corner]}` };
  }
  if (kept.length === 2) {
    // Measured along the side itself, from its lower node, so the triangle on
    // either side of it places the point bit for bit alike and two cuts meeting
    // there share it.
    const [first, second] = nodes[kept[0]!]! < nodes[kept[1]!]! ? kept : [kept[1]!, kept[0]!];
    const along = alongSide(corners, first!, second!, u, v);
    weights[first!] = 1 - along;
    weights[second!] = along;
    return {
      nodes,
      weights,
      on: [nodes[first!]!, nodes[second!]!],
      key: `s${nodes[first!]}_${nodes[second!]}_${scaled(along)}`,
    };
  }
  weights[0] = raw[0]!;
  weights[1] = raw[1]!;
  weights[2] = raw[2]!;
  return { nodes, weights, on: [...nodes], key: `t${triangle}_${scaled(raw[0]!)}_${scaled(raw[1]!)}` };
}

/** How far `(u, v)` lies from corner `from` toward corner `to`, 0 to 1, projected onto that side. */
function alongSide(corners: readonly number[], from: number, to: number, u: number, v: number): number {
  const fu = corners[from * 2]!;
  const fv = corners[from * 2 + 1]!;
  const su = corners[to * 2]! - fu;
  const sv = corners[to * 2 + 1]! - fv;
  const lengthSq = su * su + sv * sv;
  if (!(lengthSq > 0)) return 0;
  return Math.min(1, Math.max(0, ((u - fu) * su + (v - fv) * sv) / lengthSq));
}

/**
 * Where an aux line's end retreats under erode: on the outline of the layer it
 * is drawn on, which is made of the paper's edge and the folds — every edge but
 * a flat one (`edgeBoundary.ts` states the rule for the mesh's own edges).
 */
function outlineOf(mesh: AuxCutMesh) {
  const sides = new Set<number>();
  const corners = new Set<number>();
  mesh.edges_vertices.forEach(([a, b], edge) => {
    if ((mesh.edges_assignment?.[edge] ?? 'U') === 'F') return;
    sides.add(edgeKey(a, b));
    corners.add(a);
    corners.add(b);
  });
  return {
    holds(end: PlacedEnd): boolean {
      if (end.on.length === 1) return corners.has(end.on[0]!);
      if (end.on.length === 2) return sides.has(edgeKey(end.on[0]!, end.on[1]!));
      return false;
    },
  };
}
