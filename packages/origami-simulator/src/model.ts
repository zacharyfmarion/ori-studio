import { distanceToLine2D, edgeLength, normalizePoint } from './geometry.js';
import type { FoldProfile, PreparedOrigamiModel, SimulatorDiagnostics } from './types.js';

const EPSILON = 1e-6;

export class OrigamiModel {
  readonly prepared: PreparedOrigamiModel;
  readonly originalPositions: Float32Array;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly colors: Float32Array;
  private readonly originalEdgeLengths: Float32Array;
  private readonly creaseMomentArms: Float32Array;

  constructor(prepared: PreparedOrigamiModel) {
    this.prepared = prepared;
    this.originalPositions = normalizeSimulationPositions(prepared.originalPositions);
    this.positions = prepared.originalPositions.slice();
    this.positions.set(this.originalPositions);
    this.velocities = new Float32Array(this.positions.length);
    this.colors = prepared.colors.slice();
    this.originalEdgeLengths = new Float32Array(
      prepared.edgesVertices.map((edge) => edgeLength(this.originalPositions, edge)),
    );
    this.creaseMomentArms = this.computeCreaseMomentArms();
  }

  reset(): void {
    this.positions.set(this.originalPositions);
    this.velocities.fill(0);
  }

  computeTarget(foldPercent: number, foldProfile?: FoldProfile | null): Float32Array {
    const target = this.originalPositions.slice();
    const normalizedPercent = foldPercent / 100;
    const originalPoints = this.pointTuples(this.originalPositions);
    const profileRanges = new Map((foldProfile?.ranges ?? []).map((range) => [range.edge, range]));

    for (const crease of this.prepared.creaseParams) {
      const edge = this.prepared.edgesVertices[crease.edge];
      if (!edge) continue;
      const a = originalPoints[edge[0]];
      const b = originalPoints[edge[1]];
      const v1 = originalPoints[crease.vertex1];
      const v2 = originalPoints[crease.vertex2];
      if (!a || !b || !v1 || !v2) continue;

      const range = profileRanges.get(crease.edge);
      const angle = range
        ? range.fromAngle + (range.toAngle - range.fromAngle) * normalizedPercent
        : crease.targetAngle * normalizedPercent;
      const theta = (angle * Math.PI) / 180;
      const h1 = Math.sin(theta / 2) * distanceToLine2D(v1, a, b);
      const h2 = Math.sin(theta / 2) * distanceToLine2D(v2, a, b);
      target[crease.vertex1 * 3 + 1] -= h1;
      target[crease.vertex2 * 3 + 1] += h2;
    }

    return target;
  }

  applyStrainColors(maxStrain: number): void {
    this.colors.fill(0.75);
    if (maxStrain <= 0) return;
    for (let edgeIndex = 0; edgeIndex < this.prepared.edgesVertices.length; edgeIndex += 1) {
      const edge = this.prepared.edgesVertices[edgeIndex];
      if (!edge) continue;
      const base = this.originalEdgeLengths[edgeIndex] || 1;
      const strain = Math.abs(edgeLength(this.positions, edge) / base - 1);
      const heat = Math.min(1, strain / maxStrain);
      for (const vertex of edge) {
        const offset = vertex * 3;
        this.colors[offset] = 0.3 + 0.7 * heat;
        this.colors[offset + 1] = 0.65 * (1 - heat);
        this.colors[offset + 2] = 0.85 * (1 - heat);
      }
    }
  }

  edgeRestLength(edgeIndex: number): number {
    return this.originalEdgeLengths[edgeIndex] || EPSILON;
  }

  creaseMomentArm(creaseIndex: number, side: 0 | 1): number {
    return this.creaseMomentArms[creaseIndex * 2 + side] || EPSILON;
  }

  computeFaceNormals(source = this.positions): Float32Array {
    const normals = new Float32Array(this.prepared.faceCount * 3);
    for (let faceIndex = 0; faceIndex < this.prepared.faceCount; faceIndex += 1) {
      const a = this.prepared.indices[faceIndex * 3] ?? 0;
      const b = this.prepared.indices[faceIndex * 3 + 1] ?? 0;
      const c = this.prepared.indices[faceIndex * 3 + 2] ?? 0;
      const normal = triangleNormal(source, a, b, c);
      normals.set(normal, faceIndex * 3);
    }
    return normals;
  }

  diagnostics(): SimulatorDiagnostics {
    let total = 0;
    let max = 0;
    for (let edgeIndex = 0; edgeIndex < this.prepared.edgesVertices.length; edgeIndex += 1) {
      const edge = this.prepared.edgesVertices[edgeIndex];
      if (!edge) continue;
      const base = this.originalEdgeLengths[edgeIndex] || 1;
      const strain = Math.abs(edgeLength(this.positions, edge) / base - 1);
      total += strain;
      max = Math.max(max, strain);
    }
    return {
      ...this.prepared.diagnostics,
      maxEdgeStrain: max,
      averageEdgeStrain: this.prepared.edgesVertices.length
        ? total / this.prepared.edgesVertices.length
        : 0,
    };
  }

  private pointTuples(source: Float32Array): Array<[number, number, number]> {
    const points: Array<[number, number, number]> = [];
    for (let index = 0; index < source.length; index += 3) {
      points.push(
        normalizePoint([source[index] ?? 0, source[index + 1] ?? 0, source[index + 2] ?? 0]),
      );
    }
    return points;
  }

  private computeCreaseMomentArms(): Float32Array {
    const arms = new Float32Array(this.prepared.creaseParams.length * 2);
    this.prepared.creaseParams.forEach((crease, index) => {
      const edge = this.prepared.edgesVertices[crease.edge];
      if (!edge) {
        arms[index * 2] = EPSILON;
        arms[index * 2 + 1] = EPSILON;
        return;
      }
      const a = pointAt(this.originalPositions, edge[0]);
      const b = pointAt(this.originalPositions, edge[1]);
      const v1 = pointAt(this.originalPositions, crease.vertex1);
      const v2 = pointAt(this.originalPositions, crease.vertex2);
      arms[index * 2] = Math.max(EPSILON, distanceToLine3D(v1, a, b));
      arms[index * 2 + 1] = Math.max(EPSILON, distanceToLine3D(v2, a, b));
    });
    return arms;
  }
}

function normalizeSimulationPositions(source: Float32Array): Float32Array {
  const normalized = source.slice();
  if (normalized.length < 3) return normalized;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < normalized.length; index += 3) {
    const x = normalized[index] ?? 0;
    const y = normalized[index + 1] ?? 0;
    const z = normalized[index + 2] ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  if (!Number.isFinite(minX)) return normalized;
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  let radius = 0;
  for (let index = 0; index < normalized.length; index += 3) {
    radius = Math.max(
      radius,
      Math.hypot(
        (normalized[index] ?? 0) - center[0],
        (normalized[index + 1] ?? 0) - center[1],
        (normalized[index + 2] ?? 0) - center[2],
      ),
    );
  }
  if (radius <= EPSILON) return normalized;

  for (let index = 0; index < normalized.length; index += 3) {
    normalized[index] = ((normalized[index] ?? 0) - center[0]) / radius;
    normalized[index + 1] = ((normalized[index + 1] ?? 0) - center[1]) / radius;
    normalized[index + 2] = ((normalized[index + 2] ?? 0) - center[2]) / radius;
  }
  return normalized;
}

function pointAt(source: Float32Array, vertex: number): [number, number, number] {
  const index = vertex * 3;
  return [source[index] ?? 0, source[index + 1] ?? 0, source[index + 2] ?? 0];
}

function triangleNormal(
  source: Float32Array,
  aIndex: number,
  bIndex: number,
  cIndex: number,
): [number, number, number] {
  const a = pointAt(source, aIndex);
  const b = pointAt(source, bIndex);
  const c = pointAt(source, cIndex);
  const cb: [number, number, number] = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const ab: [number, number, number] = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  return normalize(cross(cb, ab));
}

function distanceToLine3D(
  point: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
): number {
  const ab: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: [number, number, number] = [point[0] - a[0], point[1] - a[1], point[2] - a[2]];
  const length = magnitude(ab);
  if (length <= EPSILON) return magnitude(ap);
  return magnitude(cross(ap, ab)) / length;
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function magnitude(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = magnitude(vector);
  if (length <= EPSILON) return [0, 1, 0];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
