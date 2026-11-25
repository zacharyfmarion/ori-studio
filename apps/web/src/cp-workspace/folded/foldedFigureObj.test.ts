import { describe, expect, it, vi } from 'vitest';
import type { Point3, SpreadSolution } from '@oristudio/layer-spread';
import fixture from '../../../../../tests/fixtures/fold-angle-3d/spread-strip.render.json';
import type {
  OristudioCpFolded3dRenderModel,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedPaperScene,
} from '../../engine/oristudioCpTypes';
import { connectedSpreadSource } from './connectedSpreadSource';
import { posedMaterialPositions, prepareSpatialMaterial, type SpatialSpreadSolution } from './folded3dMaterial';
import { toSimBasis } from './folded3dMesh';
import {
  folded3dFigureObjExport,
  folded3dObjMesh,
  foldedFigureObj,
  foldedFlatFigureObjExport,
  foldedFlatObjMesh,
  type FoldedFigureObjMesh,
} from './foldedFigureObj';
import type { LayerSpreadOptions } from './foldedLayerSpread';

const mock = vi.hoisted(() => ({ solve: vi.fn(), prepare: vi.fn() }));
vi.mock('./folded3dSpread', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./folded3dSpread')>()),
  ensureSpatialSolution: mock.solve,
}));
vi.mock('../../layer-spread/prepareConnected', () => ({ prepareConnected: mock.prepare }));

const MODEL = fixture as OristudioCpFolded3dRenderModel;
const MATERIAL = MODEL.material!;

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const vertex = (mesh: FoldedFigureObjMesh, v: number): Vec => [
  mesh.positions[3 * v]!,
  mesh.positions[3 * v + 1]!,
  mesh.positions[3 * v + 2]!,
];
/** Each triangle's right-hand normal, unnormalised. */
function normals(mesh: FoldedFigureObjMesh): Vec[] {
  const out: Vec[] = [];
  for (let t = 0; t < mesh.triangles.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => vertex(mesh, mesh.triangles[t + k]!));
    out.push(cross(sub(b!, a!), sub(c!, a!)));
  }
  return out;
}
/** The face of each triangle, by which ring holds all three of its vertices. */
const faceOf = (rings: readonly number[][], mesh: FoldedFigureObjMesh, t: number) =>
  rings.findIndex((ring) => [0, 1, 2].every((k) => ring.includes(mesh.triangles[3 * t + k]!)));
const bounds = (mesh: FoldedFigureObjMesh) => {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i++) {
    min[i % 3] = Math.min(min[i % 3]!, mesh.positions[i]!);
    max[i % 3] = Math.max(max[i % 3]!, mesh.positions[i]!);
  }
  return { min, max };
};
/** Six times a tetrahedron's signed volume: its handedness. */
const volume = (mesh: FoldedFigureObjMesh, [a, b, c, d]: number[]) => {
  const o = vertex(mesh, a!);
  return dot(cross(sub(vertex(mesh, b!), o), sub(vertex(mesh, c!), o)), sub(vertex(mesh, d!), o));
};

/**
 * The kernel's world on the file's axes, written out here rather than shared,
 * so the test pins the map: the renderer's basis with its z turned round.
 */
const onFileAxes = (p: Vec): Vec => {
  const [x, up, down] = toSimBasis(p);
  return [x, up, -down];
};

describe('folded3dObjMesh', () => {
  const mesh = folded3dObjMesh(MATERIAL, MATERIAL.positions, MODEL.span);

  it('writes every sheet vertex once, each face in triangles wound about its paper front', () => {
    expect(mesh.positions).toHaveLength(3 * MATERIAL.positions.length);
    // Four quads.
    expect(mesh.triangles).toHaveLength(3 * 8);
    normals(mesh).forEach((normal, t) => {
      const face = faceOf(MATERIAL.faces, mesh, t);
      const front = onFileAxes(MODEL.face_normals.slice(3 * face, 3 * face + 3) as Vec);
      expect(dot(normal, front)).toBeGreaterThan(0);
    });
  });

  it('is the paper the window draws: across, up out of the front, down the pattern', () => {
    const { min, max } = bounds(mesh);
    min.forEach((low, axis) => expect(low + max[axis]!).toBeCloseTo(0, 6));
    // The strip's first face stays where it lies on the 400 × 100 sheet, its
    // front up: along the strip is +x, down the pattern +z. The mountain fold
    // at x = 100 takes the next face away from the front, down 100.
    const span = (v: number, w: number) => sub(vertex(mesh, v), vertex(mesh, w));
    expect(span(4, 0)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    expect(span(1, 0)).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(0.25, 6)]);
    expect(span(6, 4)).toEqual([expect.closeTo(0, 6), expect.closeTo(-0.25, 6), expect.closeTo(0, 6)]);
    // The first face's front is up.
    expect(onFileAxes(MODEL.face_normals.slice(0, 3) as Vec)[1]).toBeCloseTo(1, 9);
  });

  it('maps the unfolded sheet to the texture as the simulator does', () => {
    // u across the 400 sheet; v up it, its y running down.
    MATERIAL.sheet.forEach(([x, y], v) => {
      expect(mesh.uvs![2 * v]).toBeCloseTo(x / 400, 6);
      expect(mesh.uvs![2 * v + 1]).toBeCloseTo((100 - y) / 400, 6);
    });
  });

  it('moves every vertex by a spread’s posing, as the window does', () => {
    const prepared = prepareSpatialMaterial(MODEL);
    const solution: SpatialSpreadSolution = {
      version: 'spatial-vector-v1',
      status: 'Solved',
      constraint_residual: 0,
      mean_gap: 0.1,
      max_order_violation: 0,
      displacements: MATERIAL.positions.map((_, i) => [0, 0, i % 2 === 0 ? 0.05 : -0.05]),
    };
    const spread = folded3dObjMesh(MATERIAL, posedMaterialPositions(prepared, solution, 2), MODEL.span);
    // Relative to vertex 0, so the recentring drops out.
    for (let v = 1; v < MATERIAL.positions.length; v++) {
      const moved = onFileAxes(sub(solution.displacements[v]! as Vec, solution.displacements[0]! as Vec));
      const delta = sub(sub(vertex(spread, v), vertex(spread, 0)), sub(vertex(mesh, v), vertex(mesh, 0)));
      delta.forEach((d, axis) => expect(d).toBeCloseTo((2 * prepared.scale * moved[axis]!) / MODEL.span, 5));
    }
    expect(spread.triangles).toEqual(mesh.triangles);
  });
});

/**
 * A 400 × 200 sheet folded in half along x = 200: face 0, the left half,
 * turned over onto face 1. Its corners A and F land on C and D, and keep their
 * own names; the crease's ends B and E are one name in both faces.
 */
function halfFold(flipped = false): OristudioCpFoldedPaperScene {
  // The rear pass is the front mirrored, its stack read from the back.
  const at = (x: number, y: number) => ({ x: flipped ? 600 - x : x, y });
  const edges = (outline: { x: number; y: number }[]) =>
    outline.map((from, i) => ({ from, to: outline[(i + 1) % outline.length]!, kind: 'border' as const }));
  const left = [at(400, 0), at(200, 0), at(200, 200), at(400, 200)];
  const right = [at(200, 0), at(400, 0), at(400, 200), at(200, 200)];
  return {
    schema_version: 3,
    flipped,
    sheet: 400,
    faces: [
      { outline: left, points: [0, 1, 4, 5], front_up: flipped, edges: edges(left) },
      { outline: right, points: [1, 2, 3, 4], front_up: !flipped, edges: edges(right) },
    ],
    subfaces: [{ polygon: right, faces_top_to_bottom: flipped ? [1, 0] : [0, 1] }],
    aux_lines: [],
    sheet_points: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 400, y: 0 },
      { x: 400, y: 200 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
  };
}

/**
 * The same paper with its y turned round, as a Fold state's scene has it: the
 * Fold pane draws y up, so this is the picture `scene` is on a canvas that
 * draws y down.
 */
function turnedUp(scene: OristudioCpFoldedPaperScene): OristudioCpFoldedPaperScene {
  const up = ({ x, y }: { x: number; y: number }) => ({ x, y: -y });
  return {
    ...scene,
    faces: scene.faces.map((face) => ({
      ...face,
      outline: face.outline.map(up),
      edges: face.edges.map((edge) => ({ ...edge, from: up(edge.from), to: up(edge.to) })),
    })),
    subfaces: scene.subfaces.map((cell) => ({ ...cell, polygon: cell.polygon.map(up) })),
    sheet_points: scene.sheet_points.map(up),
  };
}

/** The top layer's free corners lifted 1, the crease half way, the bottom's corners on the ground. */
const LIFT: SpreadSolution = {
  version: 'normalized-50-v1',
  heights: [1, 0.5, 0, 0, 0.5, 1],
  references: [
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 0, rms: 0 },
    { plane: [0, 0, 0], center: [0, 0, 0], samples: 0, rms: 0 },
  ],
  diagnostics: {} as SpreadSolution['diagnostics'],
};

describe('foldedFlatObjMesh', () => {
  const kernel = halfFold();
  const flat = foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), null);

  it('writes the fold flat, in the canvas’s view, the sheet’s longer side 1 and centred', () => {
    // Material names in order: A B C D E F, where the fold put them.
    const expected: Vec[] = [
      [400, 0, 0],
      [200, 0, 0],
      [400, 0, 0],
      [400, 0, 200],
      [200, 0, 200],
      [400, 0, 200],
    ].map(([x, y, z]) => [(x! - 300) / 400, y!, (z! - 100) / 400]);
    expected.forEach((point, v) => {
      vertex(flat, v).forEach((value, axis) => expect(value).toBeCloseTo(point[axis]!, 6));
    });
  });

  it('winds each face about its paper front: up for the face that shows it, down for the turned one', () => {
    normals(flat).forEach((normal, t) => {
      const face = faceOf(connectedSpreadSource(kernel).input.faces, flat, t);
      expect(Math.sign(normal[1])).toBe(kernel.faces[face]!.front_up ? 1 : -1);
    });
  });

  it('maps the unfolded sheet to the texture as the simulator does', () => {
    kernel.sheet_points.forEach(({ x, y }, v) => {
      expect(flat.uvs![2 * v]).toBeCloseTo(x / 400, 6);
      expect(flat.uvs![2 * v + 1]).toBeCloseTo((200 - y) / 400, 6);
    });
  });

  it('writes no texture coordinates for a scene that does not place its vertices on the sheet', () => {
    const old = { ...kernel, schema_version: 2, sheet_points: [] };
    const mesh = foldedFlatObjMesh(old, connectedSpreadSource(old), null);
    expect(mesh.uvs).toBeNull();
    expect(foldedFigureObj(mesh)).not.toContain('vt ');
  });

  it('lifts the layers apart by a Default spread toward the viewer, the top layer nearest', () => {
    const lifted = foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), { solution: LIFT, amount: 0.5 });
    // Half of a lift of 1 in the solve's frame, whose unit is half the folded 200: 50 of the sheet's 400.
    expect(vertex(lifted, 0)[1] - vertex(lifted, 2)[1]).toBeCloseTo(0.125, 6);
    expect(vertex(lifted, 1)[1] - vertex(lifted, 2)[1]).toBeCloseTo(0.0625, 6);
    // Every face keeps its winding through the lift.
    normals(lifted).forEach((normal, t) => {
      expect(Math.sign(normal[1])).toBe(Math.sign(normals(flat)[t]![1]));
    });
  });

  it('writes a y-up scene — a Fold state’s — as the paper its pane draws, never its mirror', () => {
    const lift = { solution: LIFT, amount: 0.5 };
    const down = foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), lift);
    const state = turnedUp(kernel);
    const up = foldedFlatObjMesh(state, connectedSpreadSource(state, true), lift, true);
    // The same positions, the same winding about the front, the texture the same way up.
    up.positions.forEach((value, i) => expect(value).toBeCloseTo(down.positions[i]!, 6));
    normals(up).forEach((normal, t) => expect(Math.sign(normal[1])).toBe(Math.sign(normals(down)[t]![1])));
    up.uvs!.forEach((value, i) => expect(value).toBeCloseTo(down.uvs![i]!, 6));
  });

  it('writes the rear pass as the same paper turned over, never mirrored', () => {
    const rear = halfFold(true);
    const front = foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), { solution: LIFT, amount: 0.5 });
    const back = foldedFlatObjMesh(rear, connectedSpreadSource(rear), { solution: LIFT, amount: 0.5 });
    // From the back the bottom layer is the nearest.
    expect(vertex(back, 2)[1]).toBeGreaterThan(vertex(back, 0)[1]);
    // A turn keeps the handedness of the lifted corners and every distance between them.
    const corners = [0, 1, 3, 4];
    expect(Math.sign(volume(back, corners))).toBe(Math.sign(volume(front, corners)));
    expect(Math.abs(volume(back, corners))).toBeGreaterThan(1e-6);
    for (const [v, w] of [
      [0, 2],
      [0, 4],
      [1, 3],
      [2, 5],
    ]) {
      const length = (mesh: FoldedFigureObjMesh) => Math.hypot(...sub(vertex(mesh, v!), vertex(mesh, w!)));
      expect(length(back)).toBeCloseTo(length(front), 6);
    }
    normals(back).forEach((normal, t) => {
      const face = faceOf(connectedSpreadSource(rear).input.faces, back, t);
      expect(Math.sign(normal[1])).toBe(rear.faces[face]!.front_up ? 1 : -1);
    });
  });
});

describe('foldedFigureObj', () => {
  it('writes vertices, texture coordinates and faces, one-based', () => {
    const kernel = halfFold();
    const obj = foldedFigureObj(foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), null));
    const lines = obj.trim().split('\n');
    expect(lines.filter((line) => line.startsWith('v '))).toHaveLength(6);
    expect(lines.filter((line) => line.startsWith('vt '))).toHaveLength(6);
    const faces = lines.filter((line) => line.startsWith('f '));
    expect(faces).toHaveLength(4);
    for (const face of faces) {
      for (const corner of face.slice(2).split(' ')) {
        const [v, vt] = corner.split('/').map(Number);
        expect(v).toBe(vt);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
  });
});

describe('folded3dFigureObjExport', () => {
  const figure = (amount: number | null, verdict = 'folded') =>
    ({
      displayStyle: 'Paper5',
      spread: amount === null ? undefined : { kind: 'spatial', version: 1, amount },
      folded3d: { verdict: { verdict } },
    }) as unknown as OristudioCpFoldedFigureEntry;

  it('offers nothing for a model with no material source', () => {
    expect(folded3dFigureObjExport(figure(null), { ...MODEL, material: undefined }, new AbortController().signal)).toBeUndefined();
  });

  it('writes the fold as it is without a spread, solving nothing', async () => {
    mock.solve.mockClear();
    const obj = folded3dFigureObjExport(figure(null), MODEL, new AbortController().signal)!;
    expect(obj.unavailableReason).toBeNull();
    expect(await obj.build()).toBe(foldedFigureObj(folded3dObjMesh(MATERIAL, MATERIAL.positions, MODEL.span)));
    expect(mock.solve).not.toHaveBeenCalled();
  });

  it('awaits the spread’s solve and writes the paper where the figure’s amount puts it', async () => {
    const solution: SpatialSpreadSolution = {
      version: 'spatial-vector-v1',
      status: 'Solved',
      constraint_residual: 0,
      mean_gap: 0.1,
      max_order_violation: 0,
      displacements: MATERIAL.positions.map((_, i) => [0.01 * i, 0, 0]),
    };
    mock.solve.mockResolvedValue(solution);
    const signal = new AbortController().signal;
    const obj = folded3dFigureObjExport(figure(1.5), MODEL, signal)!;
    const posed = posedMaterialPositions(prepareSpatialMaterial(MODEL), solution, 1.5);
    expect(await obj.build()).toBe(foldedFigureObj(folded3dObjMesh(MATERIAL, posed, MODEL.span)));
    expect(mock.solve).toHaveBeenCalledWith(MODEL, signal);
  });

  it('refuses a spread on a fold with no determined layer order, as its picture does', async () => {
    const obj = folded3dFigureObjExport(figure(1, 'no_layer_order'), MODEL, new AbortController().signal)!;
    await expect(obj.build()).rejects.toThrow('determined, closed fold');
  });
});

describe('foldedFlatFigureObjExport', () => {
  const kernel = halfFold();
  const connected: LayerSpreadOptions = { kind: 'connected', version: 1, amount: 0.5, reveal: [0.3, 0.2] };

  it('says an Affine or Depth spread has no 3D form', () => {
    for (const spread of [
      { kind: 'affine', amount: 0.3, keep: 'top', skew: 0, axisDeg: 0 } as const,
      { kind: 'depth', amount: 0.3, toward: 'down-right' } as const,
    ]) {
      expect(foldedFlatFigureObjExport(kernel, spread, new AbortController().signal).unavailableReason).toBe(
        'picture-only-spread'
      );
    }
  });

  it('writes a figure with no spread flat, preparing no solve', async () => {
    mock.prepare.mockClear();
    const obj = foldedFlatFigureObjExport(kernel, null, new AbortController().signal);
    expect(obj.unavailableReason).toBeNull();
    expect(await obj.build()).toBe(foldedFigureObj(foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), null)));
    expect(mock.prepare).not.toHaveBeenCalled();
  });

  it('lifts by the Default spread’s solve, without its reveal, and lets the solve go', async () => {
    const source = connectedSpreadSource(kernel);
    const release = vi.fn();
    mock.prepare.mockReturnValue({ promise: Promise.resolve({ source, solution: LIFT }), release });
    const obj = foldedFlatFigureObjExport(kernel, connected, new AbortController().signal);
    expect(await obj.build()).toBe(foldedFigureObj(foldedFlatObjMesh(kernel, source, { solution: LIFT, amount: 0.5 })));
    expect(mock.prepare).toHaveBeenCalledWith(kernel, false);
    expect(release).toHaveBeenCalled();
  });

  it('solves a Fold state in the y-up frame its pane solves it in, and writes the paper the pane draws', async () => {
    const state = turnedUp(kernel);
    mock.prepare.mockReturnValue({
      promise: Promise.resolve({ source: connectedSpreadSource(state, true), solution: LIFT }),
      release: vi.fn(),
    });
    const obj = foldedFlatFigureObjExport(state, connected, new AbortController().signal, true);
    const written = await obj.build();
    expect(mock.prepare).toHaveBeenLastCalledWith(state, true);
    expect(written).toBe(
      foldedFigureObj(foldedFlatObjMesh(kernel, connectedSpreadSource(kernel), { solution: LIFT, amount: 0.5 }))
    );
  });

  it('lets a solve still running go when the dialog closes', async () => {
    const release = vi.fn();
    let fail: (error: Error) => void = () => {};
    const promise = new Promise((_, reject) => {
      fail = reject;
    });
    mock.prepare.mockReturnValue({ promise, release });
    const controller = new AbortController();
    const building = foldedFlatFigureObjExport(kernel, connected, controller.signal).build();
    controller.abort();
    expect(release).toHaveBeenCalled();
    fail(new DOMException('Layer spread released', 'AbortError'));
    await expect(building).rejects.toThrow('released');
  });
});

it('keeps the posing the window draws: the spread mesh is the shared posing less the centroid', () => {
  // `spatialMaterialMesh` and the export read one posing, so a spread exports where it is drawn.
  const prepared = prepareSpatialMaterial(MODEL);
  const solution: SpatialSpreadSolution = {
    version: 'spatial-vector-v1',
    status: 'Solved',
    constraint_residual: 0,
    mean_gap: 0,
    max_order_violation: 0,
    displacements: MATERIAL.positions.map(() => [0.1, 0.2, 0.3]),
  };
  const posed = posedMaterialPositions(prepared, solution, 1);
  posed.forEach((p: Point3, v) =>
    p.forEach((x, axis) =>
      expect(x).toBeCloseTo(MATERIAL.positions[v]![axis]! + prepared.scale * solution.displacements[v]![axis]!, 9)
    )
  );
});
