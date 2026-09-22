import { describe, expect, it } from 'vitest';
import {
  meshToPaperScene,
  type MeshToPaperSceneOptions,
  type PaperFaceItem,
  type PaperLineItem,
  type PaperScene,
} from '../src/paperScene.js';
import { EDGE_CODE } from '../src/edgeCodes.js';
import { cameraUniforms, projectVertices } from '../src/webgl/camera.js';
import { SHADE_MAX, shadeFor } from '../src/shading.js';
import type { SvgMeshTopology } from '../src/projectedMesh.js';

/**
 * The SVG renderer's fixture: two triangles at different heights off the sheet,
 * so one is unambiguously nearer the eye than the other and the painter's order
 * is checkable. At the camera below (pitch -1, so the view is tilted well off
 * top-down) the near triangle sits at y = +1 and the far one at y = -1.
 */
const NEAR_TRIANGLE = [0, 1, 2] as const;
const FAR_TRIANGLE = [3, 4, 5] as const;

function positions(): Float32Array {
  return new Float32Array([
    // near triangle: y = +1
    -1, 1, -1, 1, 1, -1, 0, 1, 1,
    // far triangle: y = -1
    -1, -1, -1, 1, -1, -1, 0, -1, 1,
  ]);
}

/** One edge of each drawn kind on the near triangle, and a facet edge on the far one. */
function topology(farEdgeCode: number = EDGE_CODE.facet): SvgMeshTopology {
  return {
    // The far triangle is deliberately wound the other way, so the paper's two
    // sides are both exercised — which is what a folded sheet actually contains.
    faceIndices: new Uint32Array([0, 1, 2, 3, 5, 4]),
    edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 0, 3, 4]),
    edgeAssignments: new Uint8Array([
      EDGE_CODE.mountain,
      EDGE_CODE.valley,
      EDGE_CODE.border,
      farEdgeCode,
    ]),
  };
}

const CAMERA = cameraUniforms({ yaw: 0, pitch: -1, zoom: 1 }, [0, 0, 0], 2, 400, 300);

/** Looking straight down the vertical axis: world y is the depth axis alone. */
const OVERHEAD = cameraUniforms({ yaw: 0, pitch: 0, zoom: 1 }, [0, 0, 0], 2, 400, 300);

const SHEET = 2;

function scene(
  options: Partial<MeshToPaperSceneOptions> = {},
  geometry = positions(),
  mesh = topology(),
  camera = CAMERA
): PaperScene {
  return meshToPaperScene(geometry, mesh, camera, { sheet: SHEET, ...options });
}

const faces = (result: PaperScene): PaperFaceItem[] =>
  result.items.filter((item): item is PaperFaceItem => item.kind === 'face');
const lines = (result: PaperScene): PaperLineItem[] =>
  result.items.filter((item): item is PaperLineItem => item.kind === 'line');

/** A vertex's projected coordinates, using the projection as its own oracle. */
function pointOf(vertex: number, geometry = positions(), camera = CAMERA): [number, number] {
  const projected = projectVertices(geometry, camera);
  return [projected.screen[vertex * 2]!, projected.screen[vertex * 2 + 1]!];
}

function same(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/** Whether an item touches any of these vertices' projected positions. */
function touches(
  item: PaperFaceItem | PaperLineItem,
  vertices: readonly number[],
  geometry = positions(),
  camera = CAMERA
): boolean {
  const points = item.kind === 'face' ? item.rings.flat() : [item.a, item.b];
  return vertices.some((vertex) => {
    const target = pointOf(vertex, geometry, camera);
    return points.some((point) => same(point, target));
  });
}

describe('the scene a mesh makes', () => {
  it('paints the far triangle before the near one', () => {
    // The painter's contract. Reversed, the model renders inside out.
    const drawn = faces(scene({ showEdges: false }));
    expect(drawn).toHaveLength(2);
    expect(touches(drawn[0]!, FAR_TRIANGLE)).toBe(true);
    expect(touches(drawn[1]!, NEAR_TRIANGLE)).toBe(true);
  });

  it('puts a crease after the face it lies on, so it is not painted over', () => {
    const items = scene().items;
    const lastFace = items.reduce((last, item, index) => (item.kind === 'face' ? index : last), -1);
    // Every crease here belongs to the near triangle, which is the last face
    // drawn, so all three lines follow it.
    expect(items.slice(lastFace + 1).every((item) => item.kind === 'line')).toBe(true);
    expect(items.slice(lastFace + 1)).toHaveLength(3);
  });

  it('gives each line the role its edge code says', () => {
    const roles = lines(scene()).map((line) => line.role);
    expect(roles).toEqual(['mountain', 'valley', 'edge']);
  });

  it('emits an auxiliary crease as an aux line and never a facet edge', () => {
    // The same edge on the far triangle, tagged both ways. Code 3 used to mean
    // facet; it is now the crease someone drew, and 4 is the diagonal nobody did.
    const aux = lines(scene({}, positions(), topology(EDGE_CODE.aux)));
    expect(aux).toHaveLength(4);
    const drawn = aux.find((line) => touches(line, FAR_TRIANGLE))!;
    expect(drawn.role).toBe('aux');

    const facet = lines(scene({}, positions(), topology(EDGE_CODE.facet)));
    expect(facet).toHaveLength(3);
    expect(facet.some((line) => touches(line, FAR_TRIANGLE))).toBe(false);
  });

  it('reads the paper side off the screen winding when no side is given', () => {
    // The far triangle is wound the other way in the fixture.
    const drawn = faces(scene({ showEdges: false }));
    expect(drawn.map((face) => face.side)).toEqual(['back', 'front']);
  });

  it('takes the side from the caller when it knows it', () => {
    // The kernel knows which side of a face shows; a per-triangle table
    // overrides the winding guess. Triangle 0 is the near one, triangle 1 the far.
    const drawn = faces(scene({ showEdges: false, sides: new Uint8Array([1, 0]) }));
    expect(drawn.map((face) => face.side)).toEqual(['front', 'back']);
  });

  it('shades by the light when lit, and gives 1 when not', () => {
    const unlit = faces(scene({ showEdges: false, lighting: false }));
    expect(unlit.every((face) => face.shade === 1)).toBe(true);

    // A flat sheet seen square-on has its view normal along the eye, so a light
    // along the eye gives the band's top.
    const flat = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1]);
    const lit = faces(
      scene(
        { showEdges: false, lighting: true, lightDir: [0, 0, 1] },
        flat,
        { faceIndices: new Uint32Array([0, 1, 2]), edgeIndices: new Uint32Array(), edgeAssignments: new Uint8Array() },
        OVERHEAD
      )
    );
    expect(lit[0]!.shade).toBeCloseTo(shadeFor([0, 0, 1], [0, 0, 1]), 6);
    expect(lit[0]!.shade).toBe(SHADE_MAX);

    // Lighting asked for with no direction is unlit, not an error.
    const blind = faces(scene({ showEdges: false, lighting: true }));
    expect(blind.every((face) => face.shade === 1)).toBe(true);
  });

  it('measures the sheet in scene px at the camera', () => {
    expect(scene().sheet).toBe(SHEET * CAMERA.scale);
  });

  it('bounds the drawn items', () => {
    const result = scene();
    const points = result.items.flatMap((item) =>
      item.kind === 'face' ? item.rings.flat() : [item.a, item.b]
    );
    expect(result.bounds.minX).toBe(Math.min(...points.map(([x]) => x)));
    expect(result.bounds.maxX).toBe(Math.max(...points.map(([x]) => x)));
    expect(result.bounds.minY).toBe(Math.min(...points.map(([, y]) => y)));
    expect(result.bounds.maxY).toBe(Math.max(...points.map(([, y]) => y)));
    // Well inside the frame at this zoom.
    expect(result.bounds.maxX - result.bounds.minX).toBeLessThan(CAMERA.width);
  });

  it('leaves faces or lines out when asked', () => {
    expect(faces(scene({ showFaces: false }))).toHaveLength(0);
    expect(lines(scene({ showFaces: false }))).toHaveLength(3);
    expect(lines(scene({ showEdges: false }))).toHaveLength(0);
    expect(faces(scene({ showEdges: false }))).toHaveLength(2);
  });

  it('is empty, not broken, for an empty model', () => {
    const result = meshToPaperScene(
      new Float32Array(),
      { faceIndices: new Uint32Array(), edgeIndices: new Uint32Array(), edgeAssignments: new Uint8Array() },
      CAMERA,
      { sheet: SHEET }
    );
    expect(result.items).toEqual([]);
    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('emits no non-finite coordinate when the solve has blown up', () => {
    const blown = positions();
    blown[0] = Number.NaN;
    blown[4] = Number.POSITIVE_INFINITY;
    const result = scene({}, blown);
    const points = result.items.flatMap((item) =>
      item.kind === 'face' ? item.rings.flat() : [item.a, item.b]
    );
    expect(points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  // The three below are re-pinned from the SVG serializer's tests, which went
  // with it: the facts they check are the producer's, not the painter's.

  it('drops degenerate triangles rather than emitting invisible faces', () => {
    // A zero-area triangle is the signature of a solver NaN reaching the
    // renderer.
    const collapsed = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, -1, -1, -1, 1, -1, -1, 0, -1, 1]);
    expect(faces(scene({ showEdges: false }, collapsed))).toHaveLength(1);
  });

  it('projects orthographically when the caller draws through the canvas-2D path', () => {
    const perspective = scene({ perspective: true });
    const orthographic = scene({ perspective: false });
    expect(orthographic.items).not.toEqual(perspective.items);
  });

  it('picks the paper side where gl_FrontFacing does, after the perspective warp', () => {
    // The vertex shader leaves `gl_Position.w` at 1 and instead scales x and y by
    // a per-vertex `camDist/(camDist - depth)`. That is a nonlinear warp rather
    // than a projective map, so it can reorder a triangle's vertices — this one
    // winds one way in view space and the other way on screen. Deciding in view
    // space put patches of the paper's back into an export the GPU drew as front
    // (1-7% of faces on a folded Miura).
    const camera = cameraUniforms({ yaw: 0, pitch: -1, zoom: 1 }, [0, 0, 0], 1, 400, 300);
    const flipping = new Float32Array([
      0.6178846, 0.24418533, -0.01926319, 0.34378998, 0.71988648, -0.64118776, -0.75720953,
      0.8038861, 0.29766905,
    ]);
    const projected = projectVertices(flipping, camera);
    const viewArea =
      (projected.view[3]! - projected.view[0]!) * (projected.view[7]! - projected.view[1]!) -
      (projected.view[4]! - projected.view[1]!) * (projected.view[6]! - projected.view[0]!);
    const screenArea =
      (projected.screen[2]! - projected.screen[0]!) * (projected.screen[5]! - projected.screen[1]!) -
      (projected.screen[3]! - projected.screen[1]!) * (projected.screen[4]! - projected.screen[0]!);
    // The fixture is only meaningful while the two spaces disagree about it.
    expect(viewArea >= 0).not.toBe(screenArea <= 0);

    const drawn = faces(
      scene(
        { showEdges: false },
        flipping,
        { faceIndices: new Uint32Array([0, 1, 2]), edgeIndices: new Uint32Array(), edgeAssignments: new Uint8Array() },
        camera
      )
    );
    // Screen winding says front, so front is the correct answer.
    expect(drawn.map((face) => face.side)).toEqual(['front']);
  });
});

describe('pieces nothing shows', () => {
  /**
   * A small triangle squarely inside a large one, at different depths. Overhead,
   * the two overlap exactly on screen and one of them is wholly buried.
   */
  const STACKED = new Float32Array([
    -1, 1, -1, 1, 1, -1, 0, 1, 1,
    -0.2, -1, -0.5, 0.2, -1, -0.5, 0, -1, 0,
  ]);
  const STACKED_TOPOLOGY: SvgMeshTopology = {
    faceIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    // One mountain crease on the buried triangle.
    edgeIndices: new Uint32Array([3, 4]),
    edgeAssignments: new Uint8Array([EDGE_CODE.mountain]),
  };

  const stacked = (options: Partial<MeshToPaperSceneOptions> = {}) =>
    scene(options, STACKED, STACKED_TOPOLOGY, OVERHEAD);

  it('marks the buried face and its crease, and keeps them in place', () => {
    // The tree emits both, correctly ordered — an order says what covers what,
    // not what survives. The far one here is covered along its whole extent.
    // Marked rather than dropped, so a painter that keeps buried faces can
    // draw them under the ones that cover them.
    const items = stacked().items;
    expect(items).toHaveLength(3);
    const [far, crease, near] = items as [PaperFaceItem, PaperLineItem, PaperFaceItem];
    expect(far.kind).toBe('face');
    expect(far.hidden).toBe(true);
    expect(touches(far, FAR_TRIANGLE, STACKED, OVERHEAD)).toBe(true);
    expect(crease.kind).toBe('line');
    expect(crease.hidden).toBe(true);
    expect(near.hidden).toBe(false);
  });

  it('marks nothing when not asked to look', () => {
    const items = stacked({ markHidden: false }).items;
    expect(items).toHaveLength(3);
    expect(items.every((item) => !item.hidden)).toBe(true);
  });

  it('keeps both visible when the near one does not cover the far one', () => {
    const apart = new Float32Array([
      -1, 1, -1, 1, 1, -1, 0, 1, 1,
      -1, -1, 3, 1, -1, 3, 0, -1, 5,
    ]);
    const drawn = faces(scene({ showEdges: false }, apart, STACKED_TOPOLOGY, OVERHEAD));
    expect(drawn).toHaveLength(2);
    expect(drawn.every((face) => !face.hidden)).toBe(true);
  });

  it('attributes a crease to the face it is drawn on', () => {
    const [crease] = lines(stacked());
    const [far] = faces(stacked());
    expect(crease!.face).toBe(far!.face);
  });
});

describe('a face the pipeline took apart', () => {
  /** A flat square, as the two triangles `prepareFoldModel` would make of it. */
  const SQUARE = new Float32Array([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1]);
  const SQUARE_TOPOLOGY: SvgMeshTopology = {
    faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    // Four sides, then the triangulation diagonal, which is a facet edge.
    edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0, 0, 2]),
    edgeAssignments: new Uint8Array([1, 1, 1, 1, EDGE_CODE.facet]),
  };

  it('draws it as one face with the square’s four corners', () => {
    const drawn = faces(scene({ showEdges: false }, SQUARE, SQUARE_TOPOLOGY));
    expect(drawn).toHaveLength(1);
    expect(drawn[0]!.rings).toHaveLength(1);
    expect(drawn[0]!.rings[0]).toHaveLength(4);
  });

  it('keeps the pieces apart when the shared edge is a real fold', () => {
    const folded = { ...SQUARE_TOPOLOGY, edgeAssignments: new Uint8Array([1, 1, 1, 1, 1]) };
    expect(faces(scene({ showEdges: false }, SQUARE, folded))).toHaveLength(2);
  });

  it('keeps the pieces apart when the shared edge is an auxiliary crease', () => {
    // An aux line is drawn between two faces, so they stay two shapes for it to
    // lie on — unless the caller says otherwise with its own face groups.
    const aux = { ...SQUARE_TOPOLOGY, edgeAssignments: new Uint8Array([1, 1, 1, 1, EDGE_CODE.aux]) };
    expect(faces(scene({ showEdges: false }, SQUARE, aux))).toHaveLength(2);
    expect(
      faces(scene({ showEdges: false, faceGroups: new Uint32Array([5, 5]) }, SQUARE, aux))
    ).toHaveLength(1);
  });

  it('takes the face id from the caller’s groups when given', () => {
    const drawn = faces(
      scene({ showEdges: false, faceGroups: new Uint32Array([42, 42]) }, SQUARE, SQUARE_TOPOLOGY)
    );
    expect(drawn.map((face) => face.face)).toEqual([42]);
  });

  /**
   * A square sheet as a ring of four trapezoids around a centre square, all one
   * face. O0..O3 = 0..3, I0..I3 = 4..7. The ring's triangles are listed so each
   * shares an edge with the ones before it, which is what a run asks of
   * consecutive pieces; the centre's two come last.
   */
  const SHEET_RING = [
    [0, 1, 5], [0, 5, 4],
    [1, 6, 5], [1, 2, 6],
    [2, 7, 6], [2, 3, 7],
    [3, 4, 7], [3, 0, 4],
    [4, 5, 6], [4, 6, 7],
  ];
  const SHEET_CORNERS = [
    [-2, -2], [2, -2], [2, 2], [-2, 2],
    [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5],
  ];
  // Every edge inside the sheet is a facet edge, so the sheet is one face.
  const SHEET_FACETS: number[][] = [
    [0, 5], [1, 6], [2, 7], [3, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
    [4, 5], [5, 6], [6, 7], [7, 4],
  ];
  const SHEET_BORDERS: number[][] = [[0, 1], [1, 2], [2, 3], [3, 0]];

  /** The sheet with a nearer polygon (vertices 8..) over it, at y = 1. */
  function sheetUnder(cover: number[][], coverFaces: number[][]) {
    const geometry = new Float32Array([
      ...SHEET_CORNERS.flatMap(([x, z]) => [x!, 0, z!]),
      ...cover.flatMap(([x, z]) => [x!, 1, z!]),
    ]);
    const coverEdges = cover.map((_, i) => [8 + i, 8 + ((i + 1) % cover.length)]);
    const mesh: SvgMeshTopology = {
      faceIndices: new Uint32Array([...SHEET_RING.flat(), ...coverFaces.flat()]),
      edgeIndices: new Uint32Array([...SHEET_FACETS.flat(), ...SHEET_BORDERS.flat(), ...coverEdges.flat()]),
      edgeAssignments: new Uint8Array([
        ...SHEET_FACETS.map(() => EDGE_CODE.facet),
        ...SHEET_BORDERS.map(() => EDGE_CODE.border),
        ...coverEdges.map(() => EDGE_CODE.border),
      ]),
    };
    return faces(scene({ showEdges: false }, geometry, mesh, OVERHEAD));
  }

  it('returns a face with a hidden middle as one face with a hole', () => {
    // A nearer square covers the centre exactly. The centre's pieces are
    // buried; the ring's pieces survive, and their outline is two loops —
    // which used to leave them as eight triangles.
    const drawn = sheetUnder(
      [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]],
      [[8, 9, 10], [8, 10, 11]]
    );
    const shown = drawn.filter((face) => !face.hidden);
    const buried = drawn.filter((face) => face.hidden);
    // The ring as one face, the cover as its two triangles (no facet edge joins
    // them); the two centre pieces buried.
    expect(shown).toHaveLength(3);
    expect(buried).toHaveLength(2);
    const [sheet] = shown;
    expect(sheet!.rings).toHaveLength(2);
    expect(sheet!.rings.map((loop) => loop.length).sort()).toEqual([4, 4]);
    // The buried pieces come before the cover, which is what buried them.
    const order = drawn.map((face) => (face.hidden ? 'buried' : face === sheet ? 'ring' : 'cover'));
    expect(order).toEqual(['ring', 'buried', 'buried', 'cover', 'cover']);
  });

  it('merges around a buried piece and emits the buried piece first', () => {
    // A nearer triangle buries one centre piece, listed *between* the ring and
    // the other centre piece. The survivors either side of it still merge —
    // into a face with a triangular hole — and the buried piece is emitted
    // before that face rather than where it sat, so a painter that keeps
    // buried faces still draws it under everything that covered it.
    const centroid = [1 / 6, -1 / 6] as const;
    const grow = ([x, z]: readonly [number, number]) => [
      centroid[0] + (x - centroid[0]) * 1.3,
      centroid[1] + (z - centroid[1]) * 1.3,
    ];
    const drawn = sheetUnder(
      [grow([-0.5, -0.5]), grow([0.5, -0.5]), grow([0.5, 0.5])],
      [[8, 9, 10]]
    );
    expect(drawn.map((face) => face.hidden)).toEqual([true, false, false]);
    const [buried, sheet, cover] = drawn;
    expect(buried!.rings[0]).toHaveLength(3);
    expect(sheet!.rings).toHaveLength(2);
    expect(sheet!.rings.map((loop) => loop.length).sort()).toEqual([3, 4]);
    expect(cover!.rings[0]).toHaveLength(3);
  });

  it('does not merge past a buried piece of another face that it could hide', () => {
    // A tilted face A pierces the plane of a flat layer B, which lies over
    // A's far half; a cover C over B buries it. The tree draws A_back, B,
    // A_front, C. Merging A's halves across B would emit the whole of A after
    // B, so a painter keeping buried faces would put A_back over B — and
    // deleting C in an editor would show A where the tree said B should show.
    // So the run is cut at B, and A stays two pieces around it.
    const tris = [
      [[-0.3, 0, -1], [0.3, 0, -1], [0, 0, 0.5]], // B: y = 0, straddling A's plane
      [[-0.6, 1, -1.2], [0.6, 1, -1.2], [0, 1, 0.9]], // C: y = 1, over B
      [[-1, -2, -2], [1, -2, -2], [0, 2, 2]], // A: the plane y = z
    ];
    const geometry = new Float32Array(tris.flat(2));
    const edges = tris.flatMap((_, t) => [
      [t * 3, t * 3 + 1],
      [t * 3 + 1, t * 3 + 2],
      [t * 3 + 2, t * 3],
    ]);
    const mesh: SvgMeshTopology = {
      faceIndices: new Uint32Array(tris.flatMap((_, t) => [t * 3, t * 3 + 1, t * 3 + 2])),
      edgeIndices: new Uint32Array(edges.flat()),
      edgeAssignments: new Uint8Array(edges.map(() => EDGE_CODE.border)),
    };
    // Orthographic, so the world's sidedness survives into the tree's space.
    const drawn = faces(scene({ showEdges: false, perspective: false }, geometry, mesh, OVERHEAD));
    const name = (face: PaperFaceItem) => `${['B', 'C', 'A'][face.face]}${face.hidden ? '*' : ''}`;
    expect(drawn.map(name)).toEqual(['A', 'B*', 'A', 'C']);
    // The halves meet along the cut, which is what would have let them merge.
    expect(drawn[0]!.rings[0]).toHaveLength(4);
    expect(drawn[2]!.rings[0]).toHaveLength(3);
  });
});

describe('coplanar order from the caller', () => {
  /** Two overlapping squares in one plane, distinct vertices, A listed first. */
  const OVERLAP = new Float32Array([
    -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
    0, 0, -1, 2, 0, -1, 2, 0, 1, 0, 0, 1,
  ]);
  const OVERLAP_TOPOLOGY: SvgMeshTopology = {
    faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    edgeIndices: new Uint32Array([0, 2, 4, 6]),
    edgeAssignments: new Uint8Array([EDGE_CODE.facet, EDGE_CODE.facet]),
  };
  const GROUPS = new Uint32Array([7, 7, 9, 9]);

  it('keeps array order when no order is given', () => {
    const drawn = faces(
      scene({ showEdges: false, faceGroups: GROUPS }, OVERLAP, OVERLAP_TOPOLOGY, OVERHEAD)
    );
    expect(drawn.map((face) => face.face)).toEqual([7, 9]);
  });

  it('passes the order through to the tree', () => {
    // The tree cannot know how the kernel stacks coplanar faces; told, it
    // draws the lower one first.
    const drawn = faces(
      scene(
        { showEdges: false, faceGroups: GROUPS, order: new Float32Array([1, 1, 0, 0]) },
        OVERLAP,
        OVERLAP_TOPOLOGY,
        OVERHEAD
      )
    );
    expect(drawn.map((face) => face.face)).toEqual([9, 7]);
  });
});

describe('coplanar layers from the caller', () => {
  /**
   * A two-layer stack in one plane — the same square twice, distinct vertices
   * — each layer with a mountain crease across its middle. The 3D folded
   * figure's shape: layers exactly coplanar, ordered by the kernel, every one
   * of them kept for the painter.
   */
  const STACK = new Float32Array([
    -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
    -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
  ]);
  const STACK_TOPOLOGY: SvgMeshTopology = {
    faceIndices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
    edgeIndices: new Uint32Array([0, 2, 4, 6]),
    edgeAssignments: new Uint8Array([EDGE_CODE.mountain, EDGE_CODE.mountain]),
  };
  const GROUPS = new Uint32Array([7, 7, 9, 9]);
  /** Layer 9 on top: its faces at 2, its crease past them at 3; layer 7 at 0 and 1. */
  const ORDER = { order: new Float32Array([0, 0, 2, 2]), edgeOrder: new Float32Array([1, 3]) };

  const layered = (options: Partial<MeshToPaperSceneOptions> = {}) =>
    scene(
      { faceGroups: GROUPS, layers: { coplanarEps: 1e-6 }, ...ORDER, ...options },
      STACK,
      STACK_TOPOLOGY,
      OVERHEAD
    );

  /** `face N` or `line`, with `*` on the items nothing shows. */
  const summary = (result: PaperScene): string[] =>
    result.items.map(
      (item) => `${item.kind === 'face' ? `face ${item.face}` : 'line'}${item.hidden ? '*' : ''}`
    );

  it('draws each layer’s crease over that layer and under the next', () => {
    // Without `layers` the crease is nudged off the plane and every face of the
    // stack precedes every crease; with it the order interleaves, so the
    // buried layer's crease is covered by the layer above it. The buried layer
    // stays in its two triangles: only what shows is put back together.
    expect(summary(layered())).toEqual(['face 7*', 'face 7*', 'line*', 'face 9', 'line']);
  });

  it('is the simulator’s rule without it: faces first, creases nudged toward the eye', () => {
    const plain = scene({ faceGroups: GROUPS, ...ORDER }, STACK, STACK_TOPOLOGY, OVERHEAD);
    // Both creases sit in front of the stack, at one place; the top layer's
    // is drawn second and covers the other exactly.
    expect(summary(plain)).toEqual(['face 7*', 'face 7*', 'face 9', 'line*', 'line']);
  });

  it('keeps a crease in its plane’s node whatever the ink allowance', () => {
    // `lineWidth` is the hidden test's stroke only under `layers`; the tree
    // gets no ink allowance, so a wide pen cannot lift a crease off its layer.
    expect(summary(layered({ lineWidth: 40 }))).toEqual([
      'face 7*',
      'face 7*',
      'line*',
      'face 9',
      'line',
    ]);
  });

  it('keeps a tilted plane one node under perspective, by cutting in view space', () => {
    // Seen at a tilt, the perspective warp bends a plane in screen space: the
    // two triangles of one layer are no longer coplanar there, so a screen-
    // space tree splits the stack into nodes the layer order cannot reach
    // across, and the buried crease surfaces. In view space the plane is a
    // plane and the picture is the overhead one.
    const tilted = scene(
      { faceGroups: GROUPS, layers: { coplanarEps: 1e-6 }, ...ORDER },
      STACK,
      STACK_TOPOLOGY,
      cameraUniforms({ yaw: 0.6, pitch: -1.1, zoom: 1 }, [0, 0, 0], 2, 400, 300)
    );
    expect(summary(tilted)).toEqual(['face 7*', 'face 7*', 'line*', 'face 9', 'line']);
  });

  it('joins a plane the kernel joined, past the tree’s own epsilon', () => {
    // The top layer a hair off the first, and on the far side of it — float
    // rounding after the kernel placed it — is still one plane at the caller's
    // tolerance, so the kernel's order holds and the buried crease keeps its
    // place under the top layer.
    const jittered = Float32Array.from(STACK);
    for (let vertex = 4; vertex < 8; vertex += 1) jittered[vertex * 3 + 1] = -1e-5;
    const joined = scene(
      { faceGroups: GROUPS, layers: { coplanarEps: 1e-3 }, ...ORDER },
      jittered,
      STACK_TOPOLOGY,
      OVERHEAD
    );
    expect(summary(joined)).toEqual(['face 7*', 'face 7*', 'line*', 'face 9', 'line']);
    // At the tree's own epsilon the jitter is a second plane behind the
    // first, and the geometry rather than the caller's order decides.
    const split = scene(
      { faceGroups: GROUPS, layers: { coplanarEps: 1e-9 }, ...ORDER },
      jittered,
      STACK_TOPOLOGY,
      OVERHEAD
    );
    expect(summary(split)).toEqual(['face 9*', 'face 9*', 'line*', 'face 7', 'line']);
  });
});

describe('a crease on the line where two planes meet', () => {
  /**
   * A hinge: two triangles at 90° sharing an edge along x, each with its own
   * copy of the fold as a mountain crease on its own vertices — the 3D folded
   * figure's shape, where every layer inks its own ring. The crease is
   * coplanar with both planes, so the tree files both copies under one node.
   */
  const HINGE = new Float32Array([
    // face 0, flat in y = 0, extending to -z
    -1, 0, 0, 1, 0, 0, 0, 0, -1,
    // face 1, upright in z = 0, extending to +y
    -1, 0, 0, 1, 0, 0, 0, 1, 0,
  ]);
  const HINGE_TOPOLOGY: SvgMeshTopology = {
    faceIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    edgeIndices: new Uint32Array([0, 1, 3, 4]),
    edgeAssignments: new Uint8Array([EDGE_CODE.mountain, EDGE_CODE.mountain]),
  };
  const GROUPS = new Uint32Array([0, 1]);

  it.each([
    ['above and in front', { yaw: 0.3, pitch: -1, zoom: 1 }],
    ['below and behind', { yaw: 2.9, pitch: 1.2, zoom: 1 }],
    ['from the side', { yaw: 1.4, pitch: -0.3, zoom: 1 }],
  ])('follows its own face under layers, seen from %s', (_label, view) => {
    const camera = cameraUniforms(view, [0, 0, 0], 2, 400, 300);
    const result = scene(
      {
        faceGroups: GROUPS,
        layers: { coplanarEps: 1e-6 },
        order: new Float32Array([0, 0]),
        edgeOrder: new Float32Array([1, 1]),
      },
      HINGE,
      HINGE_TOPOLOGY,
      camera
    );
    // Each copy of the fold is drawn after its own face, whichever plane's
    // node the tree filed it under, so neither face's edge paints over the
    // other's crease: the nearer plane's copy draws over both faces at full
    // width, as the GPU draws it.
    for (const face of [0, 1]) {
      const own = result.items.findIndex((item) => item.kind === 'face' && item.face === face);
      const crease = result.items.findIndex((item) => item.kind === 'line' && item.face === face);
      expect(own, `face ${face}`).toBeGreaterThanOrEqual(0);
      expect(crease, `crease of face ${face}`).toBeGreaterThan(own);
    }
    // And the last thing drawn is a copy of the fold, over everything.
    expect(result.items.at(-1)!.kind).toBe('line');
  });
});

describe('which endpoints lie on a boundary', () => {
  /**
   * A flat square fanned from its centre (vertex 5), with a vertex (4) on the
   * bottom edge: an aux line runs from 4 up to the centre, and the spokes carry
   * whatever codes the case needs.
   */
  const FAN = new Float32Array([
    -1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1,
    0, 0, -1,
    0, 0, 0,
  ]);
  function fan(spokes: { toCorner1: number; toCorner2: number; toCorner0: number }): SvgMeshTopology {
    return {
      faceIndices: new Uint32Array([0, 4, 5, 4, 1, 5, 1, 2, 5, 2, 3, 5, 3, 0, 5]),
      edgeIndices: new Uint32Array([
        0, 4, 4, 1, 1, 2, 2, 3, 3, 0, // border
        4, 5, // the aux line
        1, 5, 2, 5, 3, 5, 0, 5, // spokes
      ]),
      edgeAssignments: new Uint8Array([
        EDGE_CODE.border, EDGE_CODE.border, EDGE_CODE.border, EDGE_CODE.border, EDGE_CODE.border,
        EDGE_CODE.aux,
        spokes.toCorner1, spokes.toCorner2, EDGE_CODE.facet, spokes.toCorner0,
      ]),
    };
  }
  const lineFromTo = (result: PaperScene, from: number, to: number) =>
    lines(result).find(
      (line) => same(line.a, pointOf(from, FAN, OVERHEAD)) && same(line.b, pointOf(to, FAN, OVERHEAD))
    )!;

  it('is true where a crease meets the border, false where it ends mid-face', () => {
    // The rule: an endpoint is on the boundary when another border or fold edge
    // meets it there — those are where the layer it is drawn on ends. Here the
    // aux line starts on the border and ends at a centre where only aux and
    // facet edges meet, which is the middle of a flat layer.
    const result = scene(
      {},
      FAN,
      fan({ toCorner1: EDGE_CODE.facet, toCorner2: EDGE_CODE.facet, toCorner0: EDGE_CODE.aux }),
      OVERHEAD
    );
    expect(lineFromTo(result, 4, 5).onBoundary).toEqual([true, false]);
  });

  it('is true where a crease ends on a fold', () => {
    // A mountain spoke into the centre turns it into a place the layer ends.
    const result = scene(
      {},
      FAN,
      fan({ toCorner1: EDGE_CODE.facet, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      OVERHEAD
    );
    expect(lineFromTo(result, 4, 5).onBoundary).toEqual([true, true]);
    // The mountain itself: on the border at the corner, and alone at the
    // centre — the aux and facet edges there are interior to its layer.
    expect(lineFromTo(result, 2, 5).onBoundary).toEqual([true, false]);
  });

  it('is true at a vertex where creases meet', () => {
    const result = scene(
      {},
      FAN,
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      OVERHEAD
    );
    expect(lineFromTo(result, 2, 5).onBoundary).toEqual([true, true]);
    expect(lineFromTo(result, 1, 5).onBoundary).toEqual([true, true]);
  });

  it('never retreats a paper edge', () => {
    // An edge is the outline; it has nothing to retreat from, and pulling it
    // back would open the outline at every corner.
    const result = scene(
      {},
      FAN,
      fan({ toCorner1: EDGE_CODE.facet, toCorner2: EDGE_CODE.facet, toCorner0: EDGE_CODE.aux }),
      OVERHEAD
    );
    for (const [from, to] of [[0, 4], [4, 1], [1, 2]] as const) {
      expect(lineFromTo(result, from, to).onBoundary).toEqual([false, false]);
    }
  });

  it('is false at the end a cut left behind', () => {
    // Two triangles through each other, and a mountain along the first's base
    // that crosses the second's plane: the tree cuts it in two, and the cut end
    // of each piece is nobody's boundary — or erode would open a gap where the
    // pieces meet.
    const crossing = new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
      0, -1, -1, 0, -1, 1, 0, 1, 0,
    ]);
    const mesh: SvgMeshTopology = {
      faceIndices: new Uint32Array([0, 1, 2, 3, 4, 5]),
      edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 0]),
      edgeAssignments: new Uint8Array([EDGE_CODE.mountain, EDGE_CODE.border, EDGE_CODE.border]),
    };
    const camera = cameraUniforms({ yaw: 0.6, pitch: -0.5, zoom: 1 }, [0, 0, 0], 1.5, 400, 400);
    const pieces = lines(meshToPaperScene(crossing, mesh, camera, { sheet: 2 })).filter(
      (line) => line.role === 'mountain'
    );
    expect(pieces).toHaveLength(2);
    const start = pointOf(0, crossing, camera);
    const end = pointOf(1, crossing, camera);
    const first = pieces.find((line) => same(line.a, start))!;
    const second = pieces.find((line) => same(line.b, end))!;
    expect(first.onBoundary).toEqual([true, false]);
    expect(second.onBoundary).toEqual([false, true]);
  });

  it('knows a crease’s own ends under layers, at a camera the rounding does not favour', () => {
    // Under `layers` the tree cuts in view space and a piece's page position
    // is its float32 view position projected, which is not `projected.screen`
    // — the float64 projection rounded to float32 — in the last bits. At the
    // overhead camera every coordinate is exact and the two agree; at a real
    // orbit they never do, so ownership must be decided in the cut space.
    const camera = cameraUniforms(
      { yaw: 0.37, pitch: 0.61, zoom: 1.3 },
      [0.1, 0.2, 0.05],
      2,
      400,
      300
    );
    const layered = scene(
      { layers: { coplanarEps: 1e-6 } },
      FAN,
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      camera
    );
    const flags = lines(layered)
      .filter((line) => line.role !== 'edge')
      .map((line) => line.onBoundary);
    // Two aux spokes and the two folds, every end at a corner or at the centre
    // where the folds meet.
    expect(flags).toEqual([
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
  });

  it('is false at the end a cut left behind under layers too', () => {
    // The crossing pair again, with the vertical triangle doubled into a
    // two-layer plane and put first, so its plane is the splitter: under
    // `layers` a crease stays whole in its own plane's node, and is only ever
    // cut by another plane chosen before it.
    const crossing = new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
      0, -1, -1, 0, -1, 1, 0, 1, 0,
      0, -1, -1, 0, -1, 1, 0, 1, 0,
    ]);
    const mesh: SvgMeshTopology = {
      faceIndices: new Uint32Array([3, 4, 5, 6, 7, 8, 0, 1, 2]),
      edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 0]),
      edgeAssignments: new Uint8Array([EDGE_CODE.mountain, EDGE_CODE.border, EDGE_CODE.border]),
    };
    const camera = cameraUniforms({ yaw: 0.6, pitch: -0.5, zoom: 1 }, [0, 0, 0], 1.5, 400, 400);
    const pieces = lines(
      meshToPaperScene(crossing, mesh, camera, { sheet: 2, layers: { coplanarEps: 1e-6 } })
    ).filter((line) => line.role === 'mountain');
    expect(pieces).toHaveLength(2);
    const flags = pieces.map((line) => line.onBoundary).sort();
    expect(flags).toEqual([
      [false, true],
      [true, false],
    ]);
  });
});
