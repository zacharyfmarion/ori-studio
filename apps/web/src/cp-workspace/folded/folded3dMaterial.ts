import earcut from 'earcut';
import {
  spatialVisibility,
  faceLineSegments,
  type Point,
  type Point3,
  type Triangle,
  type SpatialPlane,
  type SpreadInput,
} from '@oristudio/layer-spread';
import {
  EDGE_CODE,
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
} from '@treemaker/origami-simulator';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFolded3dAuxLines,
} from '../../engine/oristudioCpTypes';
import { triangulateSpreadFace } from './triangulateSpreadFace';
import {
  toSimBasis,
  type Folded3dMesh,
  type Folded3dRange,
} from './folded3dMesh';
import { modelCentroid, modelRadius } from './folded3dModelReader';
import { clampSpatialSpreadAmount } from './spatialSpreadSettings';

export interface SpatialSpreadInput {
  positions: Point3[];
  faces: number[][];
  triangles: Triangle[];
  triangle_faces: number[];
  groups: number[];
  cells: { ring: Point3[]; faces: number[]; normal: Point3 }[];
}
export interface SpatialSpreadSolution {
  version: 'spatial-vector-v1';
  displacements: Point3[];
  constraint_residual: number;
  mean_gap: number;
  max_order_violation: number;
  status: string;
}
export interface SpatialMeshOrder {
  planes: SpatialPlane[];
  ranges: Folded3dRange[];
  triangleFaces: number[];
  edgeFaces: number[];
}
export interface SpatialMaterial {
  input: SpatialSpreadInput;
  source: NonNullable<OristudioCpFolded3dRenderModel['material']>;
  planes: SpatialPlane[];
  scale: number;
  center: Point3;
}

const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const dot = (a: number[], b: number[]) =>
  a.reduce((s, x, i) => s + x * b[i]!, 0);

/** One immutable material source per kernel ordering solution. */
export function prepareSpatialMaterial(
  model: OristudioCpFolded3dRenderModel
): SpatialMaterial {
  const source = model.material;
  if (!source || source.version !== 1 || model.undetermined_cells)
    throw new Error('A determined material source is required');
  const { faces, positions } = source;
  if (
    faces.length !== model.face_count ||
    positions.length !== source.sheet.length ||
    positions.length > 10_000 ||
    model.face_count > 5_000
  )
    throw new Error('Spatial material budget or schema');
  if (
    positions.flat().some((v) => !Number.isFinite(v)) ||
    faces.some(
      (f) =>
        f.length < 3 ||
        f.some((v) => !Number.isInteger(v) || v < 0 || v >= positions.length)
    )
  )
    throw new Error('Invalid material identity');
  const min: Point3 = [Infinity, Infinity, Infinity],
    max: Point3 = [-Infinity, -Infinity, -Infinity];
  for (const p of positions)
    p.forEach((v, i) => {
      min[i] = Math.min(min[i]!, v);
      max[i] = Math.max(max[i]!, v);
    });
  const center = min.map((v, i) => (v + max[i]!) / 2) as Point3;
  const scale = Math.max(...max.map((v, i) => v - min[i]!)) / 2;
  if (!(scale > 0)) throw new Error('Empty spatial material');
  const normalized = positions.map(
    (p) => p.map((v, i) => (v - center[i]!) / scale) as Point3
  );
  const triangles: Triangle[] = [],
    triangle_faces: number[] = [];
  const sheetScale = Math.max(model.span, 1e-12);
  const sheet = source.sheet.map((p) => p.map((v) => v / sheetScale) as Point);
  faces.forEach((ids, f) => {
    for (const t of triangulateSpreadFace(ids, sheet)) {
      triangles.push(t);
      triangle_faces.push(f);
    }
  });
  const incidence = new Map<string, number[]>();
  faces.forEach((ring, f) =>
    ring.forEach((a, i) => {
      const k = key(a, ring[(i + 1) % ring.length]!);
      incidence.set(k, [...(incidence.get(k) ?? []), f]);
    })
  );
  const parent = faces.map((_, f) => f);
  const find = (f: number): number => {
    while (parent[f] !== f) f = parent[f]!;
    return f;
  };
  source.edges.forEach(([a, b], e) => {
    const fs = incidence.get(key(a, b));
    if (
      fs?.length === 2 &&
      source.fold_degrees[e] != null &&
      Math.abs(source.fold_degrees[e]!) < 1e-7 &&
      model.face_attr[4 * fs[0]!] === model.face_attr[4 * fs[1]!]
    )
      parent[find(fs[1]!)] = find(fs[0]!);
  });
  const groups = faces.map((_, f) => find(f));
  const planes: SpatialPlane[] = Array.from(
    { length: model.plane_count },
    (_, p) => {
      const frame = model.plane_frames.slice(12 * p, 12 * p + 12);
      const fs = faces.flatMap((_, f) =>
        model.face_attr[4 * f] === p ? [f] : []
      );
      return {
        normal: frame.slice(0, 3) as Point3,
        origin: frame.slice(3, 6) as Point3,
        faces: fs,
        groups: fs.map((f) => groups[f]!),
        orders: [],
        witnesses: [],
      };
    }
  );
  const cells: SpatialSpreadInput['cells'] = [];
  let orderWork = 0;
  for (let c = 0; c < model.cell_count; c++) {
    const [p, start, count, stackStart, stackCount, unknown] =
      model.cell_attr.slice(7 * c, 7 * c + 6) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    if (unknown) throw new Error('Unknown spatial stack');
    const stack = model.cell_stack.slice(stackStart, stackStart + stackCount);
    const plane = planes[p]!;
    if (stack.length > 1) {
      plane.witnesses.push({ cell: c, stack });
      for (let i = 0; i < stack.length; i++)
        for (let j = i + 1; j < stack.length; j++) {
          if (++orderWork > 250_000) throw new Error('Spatial order budget');
          plane.orders.push([stack[j]!, stack[i]!]);
        }
    }
    const frame = model.plane_frames.slice(12 * p, 12 * p + 12);
    const ring = Array.from(
      { length: count },
      (_, i) =>
        model.cell_points
          .slice(3 * (start + i), 3 * (start + i + 1))
          .map((v, a) => (v - center[a]!) / scale) as Point3
    );
    const xy = ring.flatMap((v) => [
      dot(v, frame.slice(6, 9)),
      dot(v, frame.slice(9, 12)),
    ]);
    const tris = earcut(xy);
    for (let i = 0; i < tris.length; i += 3)
      cells.push({
        ring: tris.slice(i, i + 3).map((v) => ring[v]!),
        faces: stack,
        normal: plane.normal,
      });
  }
  // Admit both directions' worst triangle work before a window can load it.
  const visibility = spatialVisibility(faces.length, planes, [0, 0, 0]);
  const counts = faces.map(() => 0);
  triangle_faces.forEach((f) => counts[f]++);
  let draws = 0,
    relations = 0;
  visibility.above.forEach((blockers, f) =>
    blockers.forEach((b) => {
      draws += counts[f]! + counts[b]!;
      relations++;
    })
  );
  if (relations > 50_000 || draws > 2_000_000)
    throw new Error('Spatial draw budget');
  return {
    source,
    planes,
    scale,
    center,
    input: {
      positions: normalized,
      faces,
      triangles,
      triangle_faces,
      groups,
      cells,
    },
  };
}

/** All material, including buried paper. No cell/skin vertices become unknowns.
 * Auxiliary ink is split at material triangles and bound barycentrically. */
export function spatialMaterialMesh(
  model: OristudioCpFolded3dRenderModel,
  prepared: SpatialMaterial,
  solution: SpatialSpreadSolution,
  amount: number,
  aux?: OristudioCpFolded3dAuxLines | null
): Folded3dMesh {
  const { source, input, scale } = prepared;
  const center = modelCentroid(model);
  const spreadAmount = clampSpatialSpreadAmount(amount);
  const posed = source.positions.map(
    (p, v) =>
      p.map(
        (x, a) =>
          x +
          spreadAmount *
            scale *
            solution.displacements[v]![a]! -
          center[a]!
      ) as Point3
  );
  const positions: number[] = posed.flatMap((p) => toSimBasis(p));
  const faceIndices: number[] = [],
    edgeIndices: number[] = [],
    assignments: number[] = [],
    auxEnds: number[] = [];
  const ranges: Folded3dRange[] = [],
    triangleFaces: number[] = [],
    edgeFaces: number[] = [];
  const edgeMap = new Map(source.edges.map((e, i) => [key(...e), i]));
  const addEdge = (
    a: number,
    b: number,
    assignment: number,
    face: number,
    ends = 0
  ) => {
    edgeIndices.push(a, b);
    assignments.push(assignment);
    auxEnds.push(ends);
    edgeFaces.push(face);
  };
  source.faces.forEach((ring, face) => {
    const faceIndexStart = faceIndices.length,
      edgeStart = assignments.length;
    input.triangles.forEach((ids, t) => {
      if (input.triangle_faces[t] !== face) return;
      // Material rings are CCW about the paper front. The simulator view is a
      // reflection, so reverse once, just as the legacy cell mesh does.
      faceIndices.push(ids[0], ids[2], ids[1]);
      triangleFaces.push(face);
    });
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length]!,
        edge = edgeMap.get(key(a, b));
      if (edge === undefined) throw new Error('Missing material crease');
      const angle = source.fold_degrees[edge];
      addEdge(
        a,
        b,
        angle == null
          ? EDGE_CODE.border
          : angle < 0
            ? EDGE_CODE.mountain
            : angle > 0
              ? EDGE_CODE.valley
              : EDGE_CODE.aux,
        face
      );
    });
    if (aux) {
      const plane = model.face_attr[4 * face]!,
        frame = model.plane_frames.slice(12 * plane, 12 * plane + 12);
      const xy = source.positions.map(
        (p) => [dot(p, frame.slice(6, 9)), dot(p, frame.slice(9, 12))] as Point
      );
      const binding = {
        xy,
        triangles: input.triangles,
        triangleFaces: input.triangle_faces,
      } as SpreadInput;
      for (let line = 0; line < aux.faces.length; line++) {
        if (aux.faces[line] !== face) continue;
        const ends = [0, 1].map((k) => {
          const p = aux.points.slice(6 * line + 3 * k, 6 * line + 3 * k + 3);
          return [
            dot(p, frame.slice(6, 9)),
            dot(p, frame.slice(9, 12)),
          ] as Point;
        });
        for (const segment of faceLineSegments(
          binding,
          face,
          ends[0]!,
          ends[1]!
        )) {
          const a = positions.length / 3;
          for (const weights of [segment.wa, segment.wb])
            positions.push(
              ...toSimBasis(
                [0, 1, 2].map((axis) =>
                  weights.reduce(
                    (sum, w, k) => sum + w * posed[segment.ids[k]!]![axis]!,
                    0
                  )
                ) as Point3
              )
            );
          const onOutline = (point: Point) =>
            ring.some((u, i) => {
              const v = ring[(i + 1) % ring.length]!,
                edge = edgeMap.get(key(u, v));
              if (edge === undefined || source.fold_degrees[edge] === 0)
                return false;
              const start = xy[u]!,
                end = xy[v]!,
                dx = end[0] - start[0],
                dy = end[1] - start[1];
              const length2 = dx * dx + dy * dy;
              if (!length2) return false;
              const t =
                ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) /
                length2;
              return (
                t >= -1e-8 &&
                t <= 1 + 1e-8 &&
                Math.hypot(
                  point[0] - start[0] - t * dx,
                  point[1] - start[1] - t * dy
                ) <=
                  model.span * 1e-8
              );
            });
          addEdge(
            a,
            a + 1,
            EDGE_CODE.aux,
            face,
            (segment.lo === 0 && onOutline(ends[0]!) ? EDGE_BOUNDARY_A : 0) |
              (segment.hi === 1 && onOutline(ends[1]!) ? EDGE_BOUNDARY_B : 0)
          );
        }
      }
    }
    ranges.push({
      faceIndexStart,
      faceIndexCount: faceIndices.length - faceIndexStart,
      edgeStart,
      edgeCount: assignments.length - edgeStart,
    });
  });
  const planes = prepared.planes.map((p) => ({
    ...p,
    normal: toSimBasis(p.normal),
    origin: toSimBasis(p.origin.map((v, i) => v - center[i]!) as Point3),
  }));
  return {
    positions: Float32Array.from(positions),
    topology: {
      faceIndices: Uint32Array.from(faceIndices),
      edgeIndices: Uint32Array.from(edgeIndices),
      edgeAssignments: Uint8Array.from(assignments),
      auxEnds: Uint8Array.from(auxEnds),
      textureDim: Math.ceil(Math.sqrt(positions.length / 3)),
    },
    center: [0, 0, 0],
    radius: modelRadius(model),
    sheet: model.span,
    maxStackDepth: input.cells.reduce(
      (depth, c) => Math.max(depth, c.faces.length),
      1
    ),
    slots: {
      count: 0,
      cell: new Int32Array(),
      face: new Int32Array(),
      depth: new Int32Array(),
      indexStart: new Uint32Array(),
      vertexStart: new Uint32Array(),
    },
    skins: [],
    translucent: {
      faceIndexStart: 0,
      faceIndexCount: faceIndices.length,
      edgeStart: 0,
      edgeCount: assignments.length,
    },
    undetermined: {
      faceIndexStart: 0,
      faceIndexCount: 0,
      edgeStart: 0,
      edgeCount: 0,
    },
    fallbackEdgeCount: 0,
    hinges: {
      partnerPlane: new Int32Array(assignments.length).fill(-1),
      requiredSide: new Int8Array(assignments.length),
    },
    spatial: { planes, ranges, triangleFaces, edgeFaces },
  };
}
