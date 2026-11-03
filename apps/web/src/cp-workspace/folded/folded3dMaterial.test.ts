import { describe, expect, it } from 'vitest';
import fixture from '../../../../../tests/fixtures/fold-angle-3d/spread-strip.render.json';
import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';
import {
  prepareSpatialMaterial,
  spatialMaterialMesh,
  type SpatialSpreadSolution,
} from './folded3dMaterial';
import {
  projectSpatialMesh,
  pickSpatialMesh,
  spatialPaperScene,
} from './folded3dSpatialScene';
import { modelCentroid } from './folded3dModelReader';
import { toSimBasis } from './folded3dMesh';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { CameraUniforms } from '@treemaker/origami-simulator';

const model = fixture as OristudioCpFolded3dRenderModel;
const prepared = prepareSpatialMaterial(model);
const solution: SpatialSpreadSolution = {
  version: 'spatial-vector-v1',
  status: 'Solved',
  constraint_residual: 0,
  mean_gap: 0.1,
  max_order_violation: 0,
  displacements: prepared.source.positions.map((_, i) => [
    0.01 * i,
    -0.005 * i,
    0.002 * i,
  ]),
};
const camera: CameraUniforms = {
  center: [0, 0, 0],
  rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  width: 200,
  height: 200,
  camDist: 3.2,
  scale: 70,
  depthRange: 2,
};

describe('shared spatial material', () => {
  it('retains material identity and all boundary subedges, without cell or triangulation ink', () => {
    expect(prepared.source.positions).toHaveLength(10);
    expect(prepared.input.faces).toHaveLength(4);
    const mesh = spatialMaterialMesh(model, prepared, solution, 1);
    expect(mesh.positions.length / 3).toBe(10);
    expect(mesh.spatial!.ranges).toHaveLength(4);
    const edges = new Set<string>();
    for (let e = 0; e < mesh.topology.edgeIndices.length; e += 2)
      edges.add(
        [...mesh.topology.edgeIndices.slice(e, e + 2)]
          .sort((a, b) => a - b)
          .join(':')
      );
    expect(edges).toEqual(
      new Set(
        prepared.source.edges.map((e) => [...e].sort((a, b) => a - b).join(':'))
      )
    );
    // A crease shared by two faces references the same vertex, not two coincident copies.
    const neighbour = prepared.source.faces.findIndex(
      (ring, f) =>
        f > 0 &&
        ring.filter((v) => prepared.source.faces[0]!.includes(v)).length === 2
    );
    const shared = prepared.source.faces[0]!.filter((v) =>
      prepared.source.faces[neighbour]!.includes(v)
    );
    expect(shared).toHaveLength(2);
    for (const f of [0, neighbour])
      expect([
        ...mesh.topology.faceIndices.slice(
          mesh.spatial!.ranges[f]!.faceIndexStart,
          mesh.spatial!.ranges[f]!.faceIndexStart +
            mesh.spatial!.ranges[f]!.faceIndexCount
        ),
      ]).toEqual(expect.arrayContaining(shared));
  });
  it('is exactly the folded material at zero and supports twice the unit field', () => {
    const zero = spatialMaterialMesh(model, prepared, solution, 0),
      two = spatialMaterialMesh(model, prepared, solution, 2),
      center = modelCentroid(model);
    prepared.source.positions.forEach((p, v) => {
      const rest = toSimBasis(
        p.map((n, i) => n - center[i]!) as [number, number, number]
      );
      const delta = toSimBasis(solution.displacements[v]!);
      rest.forEach((n, i) => {
        expect(zero.positions[3 * v + i]).toBeCloseTo(n, 4);
        expect(two.positions[3 * v + i]).toBeCloseTo(
          n + 2 * prepared.scale * delta[i]!,
          4
        );
      });
    });
    expect(two.radius).toBe(zero.radius);
  });
  it('refuses unknown cells, missing material and excessive mask work before GPU upload', () => {
    expect(() =>
      prepareSpatialMaterial({ ...model, material: undefined })
    ).toThrow();
    expect(() =>
      prepareSpatialMaterial({ ...model, undetermined_cells: 1 })
    ).toThrow();
  });
});

describe('perspective material picks', () => {
  const mesh = spatialMaterialMesh(model, prepared, solution, 1);
  // One slanted triangle with a corner between the eye and near plane.
  mesh.positions = Float32Array.from([
    -0.7, -0.6, 0, 0.7, -0.6, 1, 0, 0.8, 3.05,
  ]);
  mesh.topology = {
    faceIndices: Uint32Array.from([0, 1, 2]),
    edgeIndices: new Uint32Array(),
    edgeAssignments: new Uint8Array(),
    textureDim: 2,
  };
  mesh.spatial = {
    ranges: [
      { faceIndexStart: 0, faceIndexCount: 3, edgeStart: 0, edgeCount: 0 },
    ],
    planes: [
      {
        normal: [0, 0, 1],
        origin: [0, 0, 0],
        faces: [0],
        groups: [0],
        orders: [],
        witnesses: [],
      },
    ],
    triangleFaces: [0],
    edgeFaces: [],
  };
  it('clips before division and maps a pick back to the original triangle with perspective-correct weights', () => {
    const projection = projectSpatialMesh(mesh, camera);
    expect(projection.projected.triangles).toHaveLength(2);
    expect(
      projection.corners.every(
        (c) => camera.camDist - c.view[2] >= camera.camDist * 0.1 - 1e-7
      )
    ).toBe(true);
    const ids = projection.projected.triangles[0]!;
    const point = ([0, 1] as const).map((axis) =>
      ids.reduce((n, v) => n + projection.projected.positions[v]![axis] / 3, 0)
    ) as [number, number];
    const pick = pickSpatialMesh(mesh, camera, point)!;
    expect(pick.face).toBe(0);
    expect(pick.triangle).toBe(0);
    expect(pick.weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    const world = [0, 1, 2].map((axis) =>
      pick.weights.reduce((n, w, v) => n + w * mesh.positions[3 * v + axis]!, 0)
    );
    expect(100 + (world[0]! * 70 * 3.2) / (3.2 - world[2]!)).toBeCloseTo(
      point[0],
      7
    );
    expect(100 - (world[1]! * 70 * 3.2) / (3.2 - world[2]!)).toBeCloseTo(
      point[1],
      7
    );
    expect(pick.weights[0]).not.toBeCloseTo(1 / 3, 2);
  });
  it('keeps hidden source triangles before visible fragments for editable captures', () => {
    const scene = spatialPaperScene(mesh, camera, DEFAULT_PAPER_STYLE);
    expect(scene.items.some((i) => i.kind === 'face' && i.hidden)).toBe(true);
    expect(scene.items.some((i) => i.kind === 'face' && !i.hidden)).toBe(true);
    expect(scene.items.findIndex((i) => !i.hidden)).toBeGreaterThan(
      scene.items.reduce((last, item, i) => (item.hidden ? i : last), -1)
    );
  });
});

it('binds auxiliary ink across triangles and marks only its original outline ends for erosion', () => {
  const face = prepared.source.faces[0]!;
  const middle = (a: number, b: number) =>
    prepared.source.positions[a]!.map(
      (v, k) => (v + prepared.source.positions[b]![k]!) / 2
    );
  const aux = {
    faces: [0],
    points: [...middle(face[0]!, face[1]!), ...middle(face[2]!, face[3]!)],
  };
  const rest = spatialMaterialMesh(model, prepared, solution, 0, aux),
    posed = spatialMaterialMesh(model, prepared, solution, 1, aux);
  const start = rest.spatial!.ranges[0]!.edgeStart + face.length;
  const count = rest.spatial!.ranges[0]!.edgeCount - face.length;
  expect(count).toBeGreaterThan(0);
  expect(
    [...rest.topology.auxEnds!.slice(start, start + count)].reduce(
      (bits, n) => bits | n,
      0
    )
  ).toBe(3);
  for (let e = start; e < start + count - 1; e++) {
    const b = rest.topology.edgeIndices[2 * e + 1]!,
      a = rest.topology.edgeIndices[2 * (e + 1)]!;
    for (let k = 0; k < 3; k++)
      expect(posed.positions[3 * b + k]).toBeCloseTo(
        posed.positions[3 * a + k]!,
        6
      );
  }
});
