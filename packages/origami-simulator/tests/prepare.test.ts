import { describe, expect, it } from 'vitest';
import {
  OrigamiModel,
  ReferenceSolver,
  createOrigamiSimulator,
  detectWebGlSupport,
  prepareFoldModel,
} from '../src/index.js';
import { makeBookFoldFixture, maxPositionDelta } from '../src/testing.js';
import type { FoldDocument, PreparedOrigamiModel } from '../src/types.js';

describe('prepareFoldModel', () => {
  it('normalizes FOLD data and extracts crease parameters', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());

    expect(prepared.vertexCount).toBe(4);
    expect(prepared.faceCount).toBe(2);
    expect(prepared.positions[1]).toBe(0);
    expect(prepared.positions[2]).toBe(0);
    expect(prepared.positions[5]).toBe(0);
    expect(prepared.edgesAssignment[4]).toBe('M');
    expect(prepared.edgesFoldAngle[4]).toBe(-180);
    expect(prepared.creaseParams).toHaveLength(1);
    expect(prepared.creaseParams[0]).toMatchObject({
      face1: 1,
      vertex1: 3,
      face2: 0,
      vertex2: 1,
      edge: 4,
      targetAngle: -180,
    });
  });

  it('drops a collinear (zero-area) triangle so the solve stays finite', () => {
    // Faces [0,1,2] and [0,2,3] are a normal folding pair; [0,1,4] is collinear
    // (all on the x-axis) so its normal would be normalize(0) -> NaN, which
    // upstream's face-normal pass would then spread across the whole mesh.
    const prepared = prepareFoldModel({
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [2, 0],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 2],
        [1, 4],
        [0, 4],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'V', 'B', 'B'],
      edges_foldAngle: [null, null, null, null, 180, null, null],
      faces_vertices: [
        [0, 1, 2],
        [0, 2, 3],
        [0, 1, 4],
      ],
    });

    expect(prepared.faceCount).toBe(2);
    expect(prepared.diagnostics.warnings.some((w) => w.includes('degenerate'))).toBe(true);

    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    const positions = simulator.step(64).positions;
    expect([...positions].every((value) => Number.isFinite(value))).toBe(true);
    simulator.dispose();
  });

  it('drops a zero-length edge (coincident vertices) that would divide the axial beam by zero', () => {
    const prepared = prepareFoldModel({
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0], // coincident with vertex 0
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 2],
        [0, 4], // zero-length
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'V', 'B'],
      edges_foldAngle: [null, null, null, null, 180, null],
      faces_vertices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    });

    expect(prepared.edgeCount).toBe(5);
    expect(
      prepared.edgesVertices.every(([a, b]) => {
        const pa = prepared.positions.slice(a * 3, a * 3 + 3);
        const pb = prepared.positions.slice(b * 3, b * 3 + 3);
        return Math.hypot(pa[0]! - pb[0]!, pa[1]! - pb[1]!, pa[2]! - pb[2]!) > 0;
      })
    ).toBe(true);

    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    const positions = simulator.step(64).positions;
    expect([...positions].every((value) => Number.isFinite(value))).toBe(true);
    simulator.dispose();
  });

  it('reports a NaN velocity instead of swallowing it as stillness', () => {
    // NaN never satisfies `>`, so a naive max would report a blown-up model as
    // velocity 0 -- i.e. converged -- and the simulation would stop on an
    // invisible mesh instead of recovering.
    const model = new OrigamiModel(prepareFoldModel(makeBookFoldFixture()));
    const solver = new ReferenceSolver(model, { foldPercent: 100 });
    solver.step(8);
    expect(Number.isFinite(solver.maxVelocity())).toBe(true);

    model.velocities[0] = Number.NaN;
    expect(Number.isNaN(solver.maxVelocity())).toBe(true);
  });

  it('folds with the Verlet integrator as well as Euler', () => {
    // Verlet integrates position from two steps of history, so a fresh solver has
    // no implied velocity; it must still leave the flat state and stay finite.
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: { foldPercent: 100, integrationType: 'verlet' },
    });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    expect([...after].every((value) => Number.isFinite(value))).toBe(true);
    simulator.dispose();
  });

  it('leaves clean geometry untouched', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    expect(prepared.faceCount).toBe(2);
    expect(prepared.diagnostics.warnings.some((w) => w.includes('degenerate'))).toBe(false);
  });

  it('triangulates quads and adds flat facet edges', () => {
    const prepared = prepareFoldModel({
      vertices_coords: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
      ],
      edges_assignment: ['B', 'B', 'B', 'B'],
      edges_foldAngle: [null, null, null, null],
      faces_vertices: [[0, 1, 2, 3]],
    });

    expect(prepared.facesVertices).toHaveLength(2);
    expect(prepared.edgesVertices).toHaveLength(5);
    expect(prepared.edgesAssignment[4]).toBe('F');
    expect(prepared.edgesFoldAngle[4]).toBe(0);
  });
});

// Faces with five or more vertices go through earcut, which the hand-built
// fixtures (all triangles and quads) never reach. Real Oriedita exports are full
// of them, and every property below was broken there.
describe('n-gon triangulation', () => {
  /** A 20x1 pleat band, subdivided along both long sides like a real CP. */
  function makeStrip(project: (x: number, y: number) => number[]) {
    const top = Array.from({ length: 21 }, (_, i) => project(i, 1));
    const bottom = Array.from({ length: 21 }, (_, i) => project(i, 0));
    const ring = [...bottom, ...top.slice().reverse()];
    const edges = ring.map((_, i): [number, number] => [i, (i + 1) % ring.length]);
    return {
      vertices_coords: ring,
      edges_vertices: edges,
      edges_assignment: edges.map(() => 'B' as const),
      edges_foldAngle: edges.map(() => null),
      faces_vertices: [ring.map((_, i) => i)],
    };
  }

  const signedArea = (prepared: ReturnType<typeof prepareFoldModel>, face: number[]) => {
    const p = prepared.originalPositions;
    const at = (i: number) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!] as const;
    const [a, b, c] = [at(face[0]!), at(face[1]!), at(face[2]!)];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [
      u[1]! * v[2]! - u[2]! * v[1]!,
      u[2]! * v[0]! - u[0]! * v[2]!,
      u[0]! * v[1]! - u[1]! * v[0]!,
    ];
    // Flat sheet: exactly one component is non-zero, and its sign is the winding.
    return normal.reduce((best, n) => (Math.abs(n) > Math.abs(best) ? n : best), 0);
  };

  const smallestAngleDeg = (prepared: ReturnType<typeof prepareFoldModel>, face: number[]) => {
    const p = prepared.originalPositions;
    const at = (i: number) => [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!] as const;
    const [a, b, c] = [at(face[0]!), at(face[1]!), at(face[2]!)];
    const len = (x: readonly number[], y: readonly number[]) =>
      Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!);
    const [shortest, mid, longest] = [len(b, c), len(a, c), len(a, b)].sort((m, n) => m - n);
    const cosine = (mid! ** 2 + longest! ** 2 - shortest! ** 2) / (2 * mid! * longest!);
    return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
  };

  it('winds n-gon triangles the same way as the sheet\'s 3-vertex faces', () => {
    // Both faces below are wound clockwise, which is what Oriedita writes. The
    // triangle passes through untouched while earcut normalises the n-gon's ring
    // to its own winding, so the two disagree unless the output is re-oriented.
    // Mixed winding flips half the sheet's normals, and every crease between a
    // flipped face and an unflipped one then folds the wrong way.
    const strip = makeStrip((x, y) => [x, y]);
    const apex = strip.vertices_coords.length;
    const prepared = prepareFoldModel({
      ...strip,
      vertices_coords: [...strip.vertices_coords, [0.5, -1]],
      edges_vertices: [...strip.edges_vertices, [0, apex], [apex, 1]],
      edges_assignment: [...strip.edges_assignment, 'B', 'B'],
      edges_foldAngle: [...strip.edges_foldAngle, null, null],
      faces_vertices: [
        strip.faces_vertices[0]!.slice().reverse(),
        [0, 1, apex],
      ],
    });

    const windings = new Set(prepared.facesVertices.map((f) => Math.sign(signedArea(prepared, f))));
    expect(windings.size).toBe(1);
    expect(prepared.diagnostics.warnings).toEqual([]);
  });

  it('triangulates a long strip without slivers', () => {
    // Ear clipping spans a corner to the far end of a strip, which leaves
    // triangles a tenth of a degree wide. The solver's crease force divides by
    // the adjacent triangle's height, so those never settle. The Delaunay
    // criterion zig-zags across the strip instead: every triangle is a unit
    // right triangle, so 45 degrees is the exact optimum here.
    //
    // This is also what keeps the redundant-vertex merge off crease-free border
    // points: merge them and the ring has nothing left to zig-zag between.
    const prepared = prepareFoldModel(makeStrip((x, y) => [x, y]));
    const angles = prepared.facesVertices.map((f) => smallestAngleDeg(prepared, f));

    expect(prepared.vertexCount).toBe(42);
    expect(Math.min(...angles)).toBeGreaterThan(44);
  });

  it('triangulates a sheet given as 3-component coordinates', () => {
    // `normalizePoint` lifts 2-component FOLD into the xz plane, but leaves a
    // 3-component file in whatever plane it used -- commonly xy. Projecting on
    // a fixed axis pair collapses one of the two to a line, and earcut then
    // returns nothing for every polygon in the sheet.
    const xy = prepareFoldModel(makeStrip((x, y) => [x, y, 0]));
    const xz = prepareFoldModel(makeStrip((x, y) => [x, 0, y]));

    for (const prepared of [xy, xz]) {
      expect(prepared.diagnostics.warnings).toEqual([]);
      // A 20x1 strip with unit subdivisions: 40 unit right triangles.
      expect(prepared.faceCount).toBe(40);
      expect(Math.min(...prepared.facesVertices.map((f) => smallestAngleDeg(prepared, f)))).toBeGreaterThan(44);
    }
  });
});

describe('createOrigamiSimulator', () => {
  it('steps deterministically without requiring WebGL', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    const before = simulator.readFrame().positions;
    const after = simulator.step(32).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    expect(simulator.readFrame().diagnostics.usedCpuFallback).toBe(true);

    simulator.dispose();
    expect(() => simulator.step()).toThrow(/disposed/);
  });

  it('starts from OrigamiSimulator-style centered and scaled model coordinates', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared });
    const positions = simulator.readFrame().positions;
    const xs = [positions[0], positions[3], positions[6], positions[9]];
    const zs = [positions[2], positions[5], positions[8], positions[11]];

    expect(Math.max(...xs)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.min(...xs)).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.max(...zs)).toBeCloseTo(Math.SQRT1_2);
    expect(Math.min(...zs)).toBeCloseTo(-Math.SQRT1_2);

    simulator.dispose();
  });

  it('clamps fold playback to the flat-to-target range', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: -100 } });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64);

    expect(after.foldPercent).toBe(0);
    expect(maxPositionDelta(before, after.positions)).toBeLessThan(1e-6);
    simulator.setFoldPercent(250);
    expect(simulator.readFrame().foldPercent).toBe(100);

    simulator.dispose();
  });

  it('settles a simple fold without frame-to-frame shape jumps', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    let previous = simulator.readFrame().positions;

    for (let i = 0; i < 8; i += 1) {
      previous = simulator.step(100).positions;
    }
    const after = simulator.step(100);

    expect(maxPositionDelta(previous, after.positions)).toBeLessThan(1e-4);
    expect(after.diagnostics.maxEdgeStrain).toBeLessThan(1e-4);
    expect(Array.from(after.positions).every(Number.isFinite)).toBe(true);
    simulator.dispose();
  });

  it('uses an adaptive timestep for very small crease-pattern edges', () => {
    const tiny = makeBookFoldFixture();
    tiny.vertices_coords = tiny.vertices_coords.map(([x, y]) => [x * 0.001, y * 0.001]);
    const prepared = prepareFoldModel(tiny);
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 100 } });
    const frame = simulator.step(800);

    expect(Array.from(frame.positions).every(Number.isFinite)).toBe(true);
    expect(frame.diagnostics.maxEdgeStrain).toBeLessThan(1e-4);
    simulator.dispose();
  });

  it('can scale the adaptive timestep down for higher-accuracy settling', () => {
    const standardPrepared = prepareFoldModel(makeBookFoldFixture());
    const accuratePrepared = prepareFoldModel(makeBookFoldFixture());
    const standard = createOrigamiSimulator({
      model: standardPrepared,
      options: { foldPercent: 100 },
    });
    const accurate = createOrigamiSimulator({
      model: accuratePrepared,
      options: { foldPercent: 100, timeStepScale: 0.25 },
    });
    const standardBefore = standard.readFrame().positions;
    const accurateBefore = accurate.readFrame().positions;
    const standardAfter = standard.step(1).positions;
    const accurateAfter = accurate.step(1).positions;

    expect(maxPositionDelta(standardBefore, standardAfter)).toBeGreaterThan(0);
    expect(maxPositionDelta(accurateBefore, accurateAfter)).toBeGreaterThan(0);
    expect(maxPositionDelta(accurateBefore, accurateAfter)).toBeLessThan(
      maxPositionDelta(standardBefore, standardAfter)
    );
    standard.dispose();
    accurate.dispose();
  });

  it('leaves a flat model still when the target fold percent is zero', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({ model: prepared, options: { foldPercent: 0 } });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeLessThan(1e-6);
    simulator.dispose();
  });

  it('keeps a profiled crease still when its fold range is flat', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: {
        foldPercent: 100,
        foldProfile: { ranges: [{ edge: 4, fromAngle: 0, toAngle: 0 }] },
      },
    });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeLessThan(1e-6);
    simulator.dispose();
  });

  it('moves a profiled crease as the fold percent advances through its range', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: {
        foldPercent: 100,
        foldProfile: { ranges: [{ edge: 4, fromAngle: 0, toAngle: -180 }] },
      },
    });
    const before = simulator.readFrame().positions;
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    simulator.dispose();
  });

  it('returns to whole-model targets after clearing a fold profile', () => {
    const prepared = prepareFoldModel(makeBookFoldFixture());
    const simulator = createOrigamiSimulator({
      model: prepared,
      options: {
        foldPercent: 100,
        foldProfile: { ranges: [{ edge: 4, fromAngle: 0, toAngle: 0 }] },
      },
    });
    const before = simulator.step(64).positions;
    simulator.setFoldProfile(null);
    const after = simulator.step(64).positions;

    expect(maxPositionDelta(before, after)).toBeGreaterThan(0);
    simulator.dispose();
  });

  it('reports WebGL availability without throwing in node', () => {
    expect(detectWebGlSupport()).toBe(false);
  });
});

describe('redundant vertex removal', () => {
  /**
   * The reported case, from test_files/simulation/inline_simulate_issue.osf: a
   * square with four creases to the centre, where the crease to the top-right
   * corner was drawn as two collinear mountains (1-5 and 5-4) and the two faces
   * beside it are quads whose rings walk through vertex 5.
   */
  function collinearSplitCrease(): FoldDocument {
    return {
      vertices_coords: [
        [-200, 200],
        [200, 200],
        [200, -200],
        [-200, -200],
        [0, 0],
        [150, 150],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 4],
        [1, 5],
        [4, 5],
        [3, 4],
        [2, 4],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'M', 'M', 'V'],
      edges_foldAngle: [0, 0, 0, 0, -180, -180, -180, -180, 180],
      faces_vertices: [
        [0, 1, 5, 4],
        [1, 2, 4, 5],
        [2, 3, 4],
        [0, 4, 3],
      ],
    };
  }

  function edgeOf(prepared: PreparedOrigamiModel, a: number, b: number): number {
    return prepared.edgesVertices.findIndex(
      ([from, to]) => (from === a && to === b) || (from === b && to === a)
    );
  }

  it('merges a crease split across two collinear segments into one crease', () => {
    const prepared = prepareFoldModel(collinearSplitCrease());

    // Vertex 5 is gone, and with it the two halves. Without the merge the shorter
    // diagonal 1-4 was invented as a flat facet edge and the two mountain halves
    // survived incident to no face, so the crease neither folded nor drew.
    expect(prepared.vertexCount).toBe(5);
    const diagonal = edgeOf(prepared, 1, 4);
    expect(diagonal).toBeGreaterThanOrEqual(0);
    expect(prepared.edgesAssignment[diagonal]).toBe('M');
    expect(prepared.edgesFoldAngle[diagonal]).toBe(-180);
    expect(prepared.edgesFaces[diagonal]).toHaveLength(2);

    // Four triangles around the centre, each crease driven: 3 mountains, 1 valley.
    expect(prepared.faceCount).toBe(4);
    expect(prepared.creaseParams).toHaveLength(4);
    expect(prepared.creaseParams.map((param) => param.targetAngle).sort()).toEqual([
      -180, -180, -180, 180,
    ]);
    expect(prepared.diagnostics.warnings.some((w) => w.includes('degenerate'))).toBe(false);
  });

  it('leaves no driven crease without the two faces it needs', () => {
    const prepared = prepareFoldModel(collinearSplitCrease());
    const orphans = prepared.edgesVertices.filter((_, index) => {
      const assignment = prepared.edgesAssignment[index];
      return (assignment === 'M' || assignment === 'V') && prepared.edgesFaces[index]?.length !== 2;
    });
    expect(orphans).toEqual([]);
  });

  it('is idempotent, so re-preparing keeps the vertex count', () => {
    // Load-bearing beyond tidiness: the app prepares twice (around a winding and
    // fold-angle pass), the whole-sheet simulator prepares the result again, and
    // `foldedFoldDocument` silently drops every edge and assignment from the
    // Folded FOLD export when the source's vertex count stops matching the mesh.
    const once = prepareFoldModel(collinearSplitCrease());
    const twice = prepareFoldModel(once.fold);

    expect(twice.vertexCount).toBe(once.vertexCount);
    expect(twice.edgeCount).toBe(once.edgeCount);
    expect(twice.faceCount).toBe(once.faceCount);
    expect(twice.diagnostics.warnings.some((w) => w.includes('redundant'))).toBe(false);
  });

  it('collapses a chain of collinear crease segments, as upstream does', () => {
    // One diagonal crease drawn in four strokes, split at (1,1), (2,2) and (3,3).
    // Upstream rewrites its neighbour map inside each merge, so the chain collapses
    // progressively; a batch pass over the original neighbours stops after one.
    const prepared = prepareFoldModel({
      vertices_coords: [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [1, 1],
        [2, 2],
        [3, 3],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [0, 4],
        [4, 5],
        [5, 6],
        [6, 2],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'M', 'M'],
      edges_foldAngle: [null, null, null, null, -180, -180, -180, -180],
      faces_vertices: [
        [0, 1, 2, 6, 5, 4],
        [0, 4, 5, 6, 2, 3],
      ],
    });

    expect(prepared.vertexCount).toBe(4);
    const diagonal = edgeOf(prepared, 0, 2);
    expect(diagonal).toBeGreaterThanOrEqual(0);
    expect(prepared.edgesAssignment[diagonal]).toBe('M');
    expect(prepared.edgesFaces[diagonal]).toHaveLength(2);
    expect(prepared.faceCount).toBe(2);
    expect(prepared.creaseParams).toHaveLength(1);
  });

  it('leaves crease-free border subdivisions alone, unlike upstream', () => {
    // Narrower than upstream on purpose: these points carry no crease to lose, and
    // they are the only mesh resolution `delaunayFlipRing` has to work with. See
    // the long-strip test in n-gon triangulation for what merging them costs.
    const prepared = prepareFoldModel({
      vertices_coords: [
        [0, 0],
        [1, 0],
        [2, 0],
        [2, 2],
        [0, 2],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 0],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'B'],
      edges_foldAngle: [null, null, null, null, null],
      faces_vertices: [[0, 1, 2, 3, 4]],
    });

    // Vertex 1 is degree-2 and collinear with 0 and 2, and upstream would merge it.
    expect(prepared.vertexCount).toBe(5);
    expect(prepared.diagnostics.warnings.some((w) => w.includes('redundant'))).toBe(false);
  });

  it('refuses to merge halves whose assignments disagree, as upstream does', () => {
    const prepared = prepareFoldModel({
      ...collinearSplitCrease(),
      edges_assignment: ['B', 'B', 'B', 'B', 'M', 'M', 'V', 'M', 'V'],
      edges_foldAngle: [0, 0, 0, 0, -180, -180, 180, -180, 180],
    });

    expect(prepared.vertexCount).toBe(6);
    expect(
      prepared.diagnostics.warnings.some((w) => w.includes('different edge assignments'))
    ).toBe(true);
  });

  it('keeps the namespaced per-edge arrays aligned with the merged edge list', () => {
    // The CP kernel reads `oristudio:edges_line_colors` as the crease type, so an
    // array left in the pre-merge order comes back as scrambled creases.
    const source = collinearSplitCrease();
    const prepared = prepareFoldModel({
      ...source,
      'oristudio:edges_line_colors': [0, 0, 0, 0, 1, 1, 1, 1, 2],
    });
    const colors = prepared.fold['oristudio:edges_line_colors'] as number[];

    expect(colors).toHaveLength(prepared.edgeCount);
    prepared.edgesVertices.forEach((_, index) => {
      const assignment = prepared.edgesAssignment[index];
      if (assignment === 'B') expect(colors[index]).toBe(0);
      if (assignment === 'M') expect(colors[index]).toBe(1);
      if (assignment === 'V') expect(colors[index]).toBe(2);
    });
  });

  it('drops a stale per-edge array rather than misaligning it', () => {
    const prepared = prepareFoldModel({
      ...collinearSplitCrease(),
      'oriedita:edges_colors': ['', ''],
    });
    expect(prepared.fold['oriedita:edges_colors']).toBeUndefined();
  });
});
