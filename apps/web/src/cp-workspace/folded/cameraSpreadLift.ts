/**
 * Experimental presentation lift, not a physical folding solver.
 *
 * One unknown height per PAPER vertex (never weld coincident folded positions),
 * plus interior triangle centres so faces can bend a little. Local/global least
 * squares fits layer-height targets, face planes and sampled contact half-spaces. Its matrix
 * and Jacobi preconditioner are constant; only contact projections change.
 * The resulting unit lift is reusable for every amount and camera direction.
 *
 * Contacts are samples, not a collision guarantee. Diagnostics deliberately
 * expose their residuals and evaluate separate, withheld samples as well.
 */
import earcut from 'earcut';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import { foldedPaintOrder } from './foldedFlatScene';
import { foldedModelSize, layerLevels } from './foldedLayerSpread';

export type LiftTriangle = { vertices: [number, number, number]; face: number };
type Row = {
  ids: number[];
  weights: number[];
  target: number;
  strength: number;
};
export interface CameraSpreadLift {
  /** Coordinates normalized by the original folded model's longest extent. */
  xy: Point[];
  heights: Float64Array;
  triangles: LiftTriangle[];
  faceVertices: number[][];
  faceTriangles: number[][];
  order: number[];
  size: number;
  origin: Point;
  diagnostics: {
    prepareMs: number;
    solveMs: number;
    contacts: number;
    missedSamples: number;
    fitInversions: number;
    probeInversions: number;
    probeCount: number;
    worstProbeGap: number;
    relativeResidual: number;
  };
}

const cache = new WeakMap<OristudioCpFoldedPaperScene, CameraSpreadLift>();
// Penalize deviation from a face's own freely tilting plane. Penalizing only
// height differences would suppress rigid opening as well as unwanted bending.
const PANEL_STIFFNESS = 100;

/** Cached by immutable kernel scene identity; a new layer order needs a new scene. */
export function cameraSpreadLift(kernel: OristudioCpFoldedPaperScene): CameraSpreadLift {
  const cached = cache.get(kernel);
  if (cached) return cached;
  const prepared = prepare(kernel);
  cache.set(kernel, prepared);
  return prepared;
}

function prepare(kernel: OristudioCpFoldedPaperScene): CameraSpreadLift {
  const started = performance.now();
  const size = foldedModelSize(kernel);
  if (!(size > 0)) throw new Error('Camera spread needs nonempty paper geometry');
  const origin = kernel.faces[0]?.outline[0];
  if (!origin) throw new Error('Camera spread needs a face outline');
  const xy: Point[] = [];
  const paperVertices = new Map<number, number>();
  const triangles: LiftTriangle[] = [];
  const faceTriangles: number[][] = [];
  const faceVertices: number[][] = [];
  const order = foldedPaintOrder(kernel);
  const { levels, zMax } = layerLevels(kernel.faces.length, kernel.subfaces, order);
  const rows: Row[] = [];
  const addPoint = ({ x, y }: Point) => {
    xy.push({ x, y });
    return xy.length - 1;
  };
  kernel.faces.forEach((face, f) => {
    if (face.points.length !== face.outline.length || face.points.length < 3) {
      throw new Error('Camera spread requires named paper vertices (scene schema 2+)');
    }
    const ring = face.outline.map((p, i) => {
      const normalized = {
        x: (p.x - origin.x) / size,
        y: (p.y - origin.y) / size,
      };
      const id = face.points[i]!;
      if (!Number.isInteger(id) || id < 0) throw new Error('Invalid paper vertex identity');
      const existing = paperVertices.get(id);
      if (existing !== undefined) {
        const q = xy[existing]!;
        if (Math.hypot(normalized.x - q.x, normalized.y - q.y) > 1e-6) {
          throw new Error('Shared paper vertex has inconsistent folded coordinates');
        }
        return existing;
      }
      const vertex = addPoint(normalized);
      paperVertices.set(id, vertex);
      return vertex;
    });
    faceVertices.push(ring);
    const flat = ring.flatMap((v) => [xy[v]!.x, xy[v]!.y]);
    const indices = earcut(flat);
    const inFace: number[] = [];
    const target = -levels[f]! / Math.max(1, zMax);
    for (let i = 0; i < indices.length; i += 3) {
      const corners = indices.slice(i, i + 3).map((c) => ring[c]!);
      const centre = addPoint({
        x: corners.reduce((sum, v) => sum + xy[v]!.x, 0) / 3,
        y: corners.reduce((sum, v) => sum + xy[v]!.y, 0) / 3,
      });
      // Interior targets permit shallow bending instead of forcing whole panels
      // to translate independently and tearing their shared crease endpoints.
      rows.push({ ids: [centre], weights: [1], target, strength: 1 });
      for (let j = 0; j < 3; j++) {
        const a = corners[j]!;
        const b = corners[(j + 1) % 3]!;
        inFace.push(triangles.length);
        triangles.push({ face: f, vertices: [a, b, centre] });
        rows.push({
          ids: [a, centre],
          weights: [1, -1],
          target: 0,
          strength: 0.15,
        });
        rows.push({ ids: [a], weights: [1], target, strength: 0.1 });
      }
    }
    if (inFace.length === 0) throw new Error('Camera spread could not triangulate a face');
    faceTriangles.push(inFace);
  });

  const partial = { xy, triangles, faceTriangles };
  const contacts: Row[] = [];
  const probes: Row[] = [];
  let missedSamples = 0;
  for (const cell of kernel.subfaces) {
    if (cell.faces_top_to_bottom.length < 2 || cell.polygon.length < 3) continue;
    const polygon = cell.polygon.map((p) => ({
      x: (p.x - origin.x) / size,
      y: (p.y - origin.y) / size,
    }));
    // Earcut centroids are inside even concave arrangement cells.
    const pieces = earcut(polygon.flatMap((p) => [p.x, p.y]));
    for (let t = 0; t < pieces.length; t += 3) {
      const corners = pieces.slice(t, t + 3).map((v) => polygon[v]!);
      const centre = {
        x: corners.reduce((s, p) => s + p.x, 0) / 3,
        y: corners.reduce((s, p) => s + p.y, 0) / 3,
      };
      const samples = [
        centre,
        ...corners.map((p) => ({
          x: 0.2 * centre.x + 0.8 * p.x,
          y: 0.2 * centre.y + 0.8 * p.y,
        })),
      ];
      for (let s = 0; s < samples.length; s++) {
        const p = samples[s]!;
        const weights = cell.faces_top_to_bottom.map((f) => liftWeights(partial, f, p));
        for (let k = 0; k + 1 < weights.length; k++) {
          const upper = weights[k];
          const lower = weights[k + 1];
          if (!upper || !lower) {
            missedSamples++;
            continue;
          }
          const combined = new Map<number, number>();
          for (const [v, w] of upper) combined.set(v, (combined.get(v) ?? 0) + w);
          for (const [v, w] of lower) combined.set(v, (combined.get(v) ?? 0) - w);
          const entries = [...combined].filter(([, w]) => Math.abs(w) > 1e-10);
          if (!entries.length) continue; // A common hinge cannot have a positive gap.
          const row = {
            ids: entries.map(([v]) => v),
            weights: entries.map(([, w]) => w),
            target: 0.35 / Math.max(1, zMax),
            strength: 30,
          };
          // Centre for the solve; inset corners only for independent validation.
          (s === 0 ? contacts : probes).push(row);
        }
      }
    }
  }
  // Three auxiliary unknowns per face: offset and two slopes in a local frame.
  // Shared paper vertices still have exactly one height. Only the interior
  // curvature is discouraged; each face is free to translate and tilt.
  for (let f = 0; f < faceTriangles.length; f++) {
    const ids = [...new Set(faceTriangles[f]!.flatMap((t) => triangles[t]!.vertices))];
    const cx = ids.reduce((s, v) => s + xy[v]!.x, 0) / ids.length;
    const cy = ids.reduce((s, v) => s + xy[v]!.y, 0) / ids.length;
    const radius = Math.max(1e-10, ...ids.map((v) => Math.hypot(xy[v]!.x - cx, xy[v]!.y - cy)));
    const plane = xy.length + 3 * f;
    for (const v of ids)
      rows.push({
        ids: [v, plane, plane + 1, plane + 2],
        weights: [1, -1, -(xy[v]!.x - cx) / radius, -(xy[v]!.y - cy) / radius],
        target: 0,
        strength: PANEL_STIFFNESS,
      });
  }
  const prepared = performance.now();
  const solution = new Float64Array(xy.length + 3 * faceTriangles.length);
  const allRows = [...rows, ...contacts];
  const matrix = compileRows(allRows);
  const diagonal = new Float64Array(solution.length).fill(1e-8);
  for (const row of allRows)
    row.ids.forEach((id, j) => {
      diagonal[id] += row.strength * row.weights[j]! ** 2;
    });
  const rhs = new Float64Array(solution.length);
  let relativeResidual = 0;
  // A fixed matrix local/global solve. Contacts project onto half-spaces; this
  // is a compliant least-squares fit, not a hard inequality feasibility proof.
  for (let iteration = 0; iteration < 16; iteration++) {
    rhs.fill(0);
    for (const row of rows) addRhs(rhs, row, row.target);
    for (const row of contacts) addRhs(rhs, row, Math.max(row.target, dotRow(row, solution)));
    relativeResidual = conjugateGradient(matrix, diagonal, rhs, solution);
  }
  const heights = solution.slice(0, xy.length);
  // Remove an arbitrary rigid Z translation. Keep total thickness <= 1 so
  // Amount is a model-relative thickness bound, including difficult fits.
  let low = Infinity;
  let high = -Infinity;
  heights.forEach((h) => {
    low = Math.min(low, h);
    high = Math.max(high, h);
  });
  const span = Math.max(1, high - low);
  heights.forEach((h, v) => {
    heights[v] = (h - high) / span;
  });
  const inverted = (r: Row) => dotRow(r, heights) < -1e-6;
  let worstProbeGap = 0;
  for (const probe of probes) worstProbeGap = Math.min(worstProbeGap, dotRow(probe, heights));
  return {
    xy,
    heights,
    triangles,
    faceVertices,
    faceTriangles,
    order,
    size,
    origin,
    diagnostics: {
      prepareMs: prepared - started,
      solveMs: performance.now() - prepared,
      contacts: contacts.length,
      missedSamples,
      fitInversions: contacts.filter(inverted).length,
      probeInversions: probes.filter(inverted).length,
      probeCount: probes.length,
      worstProbeGap,
      relativeResidual,
    },
  };
}

/** Barycentric embedding in the actual piecewise-linear surface, not a different interpolation field. */
export function liftWeights(
  mesh: Pick<CameraSpreadLift, 'xy' | 'triangles' | 'faceTriangles'>,
  face: number,
  p: Point
): Array<[number, number]> | null {
  for (const t of mesh.faceTriangles[face] ?? []) {
    const ids = mesh.triangles[t]!.vertices;
    const [a, b, c] = ids.map((v) => mesh.xy[v]!) as [Point, Point, Point];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-16) continue;
    const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
    const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
    const w = 1 - u - v;
    if (Math.min(u, v, w) >= -1e-7)
      return [
        [ids[0], u],
        [ids[1], v],
        [ids[2], w],
      ];
  }
  return null;
}

function dotRow(row: Row, x: Float64Array): number {
  let sum = 0;
  for (let j = 0; j < row.ids.length; j++) sum += row.weights[j]! * x[row.ids[j]!]!;
  return sum;
}
function addRhs(rhs: Float64Array, row: Row, target: number): void {
  for (let j = 0; j < row.ids.length; j++) rhs[row.ids[j]!] += row.strength * row.weights[j]! * target;
}
/** Contiguous coefficients, compiled once. Row and accumulation order stay exact. */
function compileRows(rows: Row[]) {
  const count = rows.reduce((n, row) => n + row.ids.length, 0);
  const offsets = new Uint32Array(rows.length + 1);
  const ids = new Uint32Array(count);
  const weights = new Float64Array(count);
  const scaled = new Float64Array(count);
  let at = 0;
  rows.forEach((row, i) => {
    offsets[i] = at;
    for (let j = 0; j < row.ids.length; j++, at++) {
      ids[at] = row.ids[j]!;
      weights[at] = row.weights[j]!;
      scaled[at] = row.strength * row.weights[j]!;
    }
  });
  offsets[rows.length] = at;
  return { offsets, ids, weights, scaled };
}
type Matrix = ReturnType<typeof compileRows>;
function multiply({ offsets, ids, weights, scaled }: Matrix, x: Float64Array, out: Float64Array): void {
  for (let i = 0; i < x.length; i++) out[i] = x[i]! * 1e-8;
  for (let row = 0; row < offsets.length - 1; row++) {
    const start = offsets[row]!, end = offsets[row + 1]!;
    let sum = 0;
    for (let j = start; j < end; j++) sum += weights[j]! * x[ids[j]!]!;
    for (let j = start; j < end; j++) out[ids[j]!] += scaled[j]! * sum;
  }
}
function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}
function conjugateGradient(rows: Matrix, diagonal: Float64Array, rhs: Float64Array, x: Float64Array): number {
  const ax = new Float64Array(x.length);
  multiply(rows, x, ax);
  const r = rhs.map((b, i) => b - ax[i]!);
  const z = r.map((v, i) => v / diagonal[i]!);
  const p = z.slice();
  const ap = new Float64Array(x.length);
  const rhsNorm = Math.max(1e-20, dot(rhs, rhs));
  let rz = dot(r, z);
  for (let i = 0; i < 70 && dot(r, r) > rhsNorm * 1e-12; i++) {
    multiply(rows, p, ap);
    const denominator = dot(p, ap);
    if (!(denominator > 0)) break;
    const alpha = rz / denominator;
    for (let v = 0; v < x.length; v++) {
      x[v] += alpha * p[v]!;
      r[v] -= alpha * ap[v]!;
      z[v] = r[v]! / diagonal[v]!;
    }
    const next = dot(r, z);
    const beta = next / Math.max(1e-30, rz);
    for (let v = 0; v < p.length; v++) p[v] = z[v]! + beta * p[v]!;
    rz = next;
  }
  return Math.sqrt(dot(r, r) / rhsNorm);
}

/** Relative extension of mesh edges. A height-only lift necessarily stretches paper. */
export function cameraSpreadStrain(mesh: CameraSpreadLift, amount: number): { p95: number; max: number } {
  const strains: number[] = [];
  const seen = new Set<string>();
  for (const { vertices } of mesh.triangles)
    for (let j = 0; j < 3; j++) {
      const a = vertices[j]!;
      const b = vertices[(j + 1) % 3]!;
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const length = Math.hypot(mesh.xy[a]!.x - mesh.xy[b]!.x, mesh.xy[a]!.y - mesh.xy[b]!.y);
      if (length < 1e-10) continue;
      strains.push(Math.hypot(length, amount * (mesh.heights[a]! - mesh.heights[b]!)) / length - 1);
    }
  strains.sort((a, b) => a - b);
  return {
    p95: strains[Math.floor(strains.length * 0.95)] ?? 0,
    max: strains.at(-1) ?? 0,
  };
}
