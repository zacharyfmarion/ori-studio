import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  EDGE_CODE,
  edgeBoundaryFlags,
} from '@treemaker/origami-simulator';
import type {
  OristudioCpFold3dTolerances,
  OristudioCpFolded3dAuxLines,
  OristudioCpFolded3dRenderModel,
} from '../../engine/oristudioCpTypes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { clipToRing, folded3dAuxSlots, ringSegmentsAt } from './folded3dAuxPieces';
import { DEFAULT_FOLDED_3D_CAMERA } from './folded3dCamera';
import { folded3dMesh, type Folded3dMesh } from './folded3dMesh';
import { folded3dPaperScene, folded3dSceneCamera } from './folded3dScene';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES: OristudioCpFold3dTolerances = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

/**
 * One plane; face 1 is the centre square under everything, face 0 the left
 * arm folded over it. Cell 1 (x 0…25, y −75…−25) stacks face 0 over face 1,
 * and cell 0 (x 25…75) holds face 1 alone.
 */
function pinwheel(): OristudioCpFolded3dRenderModel {
  return JSON.parse(readFileSync(join(FIXTURES, 'pinwheel.rendermodel.json'), 'utf8'));
}

function lines(...pieces: Array<[number, [number, number], [number, number]]>): OristudioCpFolded3dAuxLines {
  return {
    faces: pieces.map(([face]) => face),
    points: pieces.flatMap(([, a, b]) => [a[0], a[1], 0, b[0], b[1], 0]),
  };
}

function built(aux?: OristudioCpFolded3dAuxLines): Folded3dMesh {
  const result = folded3dMesh(pinwheel(), aux);
  if (result.kind !== 'mesh') throw new Error('pinwheel meshes');
  return result.mesh;
}

describe('clipToRing', () => {
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ] as const;

  it('keeps what runs inside, as fractions of the piece', () => {
    expect(clipToRing([-10, 5], [20, 5], square, 1e-9)).toEqual([[1 / 3, 2 / 3]]);
    expect(clipToRing([2, 2], [8, 8], square, 1e-9)).toEqual([[0, 1]]);
    expect(clipToRing([-5, -5], [-1, 20], square, 1e-9)).toEqual([]);
  });

  it('keeps two stretches across the notch of a non-convex ring', () => {
    const ell = [
      [0, 0],
      [10, 0],
      [10, 10],
      [6, 10],
      [6, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ] as const;
    const cuts = clipToRing([0, 7], [10, 7], ell, 1e-9);
    expect(cuts).toHaveLength(2);
    expect(cuts[0]![0]).toBeCloseTo(0, 9);
    expect(cuts[0]![1]).toBeCloseTo(0.4, 9);
    expect(cuts[1]![0]).toBeCloseTo(0.6, 9);
    expect(cuts[1]![1]).toBeCloseTo(1, 9);
  });
});

describe('folded3dAuxSlots', () => {
  it('gives a piece to its face’s slot in each cell it crosses', () => {
    const model = pinwheel();
    // Face 0's piece is on top in cell 1; face 1's runs under it there, and
    // on its own in cell 0.
    const { bySlot, count } = folded3dAuxSlots(
      model,
      lines([0, [5, -50], [20, -50]], [1, [5, -40], [50, -40]])
    );
    expect(count).toBe(3);
    const piece = (cell: number, slot: number) =>
      bySlot.get(cell)?.get(slot)?.map(({ ends: [a, b] }) => [a.map(round), b.map(round)]);
    expect(piece(1, 0)).toEqual([
      [
        [5, -50, 0],
        [20, -50, 0],
      ],
    ]);
    expect(piece(1, 1)).toEqual([
      [
        [5, -40, 0],
        [25, -40, 0],
      ],
    ]);
    expect(piece(0, 0)).toEqual([
      [
        [25, -40, 0],
        [50, -40, 0],
      ],
    ]);
    // An end inside its cell lies on none of the ring; a cut end on the
    // segment it was cut at (cell 1's ring: segment 3 is x = 25; cell 0's:
    // segment 0 is).
    const onRing = (cell: number, slot: number) =>
      bySlot.get(cell)?.get(slot)?.map((cut) => cut.onRing);
    expect(onRing(1, 0)).toEqual([[[], []]]);
    expect(onRing(1, 1)).toEqual([[[], [3]]]);
    expect(onRing(0, 0)).toEqual([[[0], []]]);
  });

  it('is nothing without aux lines', () => {
    expect(folded3dAuxSlots(pinwheel(), null).count).toBe(0);
    expect(folded3dAuxSlots(pinwheel(), { faces: [], points: [] }).count).toBe(0);
  });
});

describe('ringSegmentsAt', () => {
  const square = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ] as const;

  it('finds the segment a point lies on, both at a corner, and none inside', () => {
    expect(ringSegmentsAt([10, 4], square, 1e-9)).toEqual([1]);
    expect(ringSegmentsAt([10, 10], square, 1e-9)).toEqual([1, 2]);
    expect(ringSegmentsAt([5, 5], square, 1e-9)).toEqual([]);
    expect(ringSegmentsAt([5, 1e-7], square, 1e-6)).toEqual([0]);
  });
});

describe('where an aux cut meets its layer’s outline', () => {
  // Cell 1 (x 0…25) stacks face 0, the arm folded over, on face 1. Face 0's
  // own paper ends at x = 0 and x = 25; face 1's paper ends at x = 0 and runs
  // on under x = 25, which is only the edge of the arm lying over it. Erode
  // pulls an aux line back from the first kind of end and not the second.
  const aux = lines([0, [0, -50], [25, -50]], [1, [0, -40], [50, -40]]);

  it('says which of its cell’s ring segments each end lies on', () => {
    const { bySlot } = folded3dAuxSlots(pinwheel(), aux);
    expect(bySlot.get(1)?.get(0)?.map((cut) => cut.onRing)).toEqual([[[1], [3]]]);
    expect(bySlot.get(1)?.get(1)?.map((cut) => cut.onRing)).toEqual([[[1], [3]]]);
    expect(bySlot.get(0)?.get(0)?.map((cut) => cut.onRing)).toEqual([[[0], []]]);
  });

  it('flags an end on its own layer’s paper edge, and not one on an edge lying over it', () => {
    const mesh = built(aux);
    const flags = edgeBoundaryFlags(mesh.topology);
    const auxFlags: number[] = [];
    const { edgeStart, edgeCount } = mesh.translucent;
    for (let edge = edgeStart; edge < edgeStart + edgeCount; edge += 1) {
      if (mesh.topology.edgeAssignments[edge] === EDGE_CODE.aux) auxFlags.push(flags[edge]!);
    }
    expect(auxFlags.sort((x, y) => x - y)).toEqual([
      // Face 1 in cell 0: from under the arm's edge to the middle of the cell.
      0,
      // Face 1 in cell 1: from its own edge to under the arm's.
      EDGE_BOUNDARY_A,
      // Face 0: edge to edge.
      EDGE_BOUNDARY_A | EDGE_BOUNDARY_B,
    ]);
  });
});

describe('folded3dMesh with aux lines', () => {
  function auxEdges(mesh: Folded3dMesh, start: number, count: number): number {
    let n = 0;
    for (let i = start; i < start + count; i += 1) {
      if (mesh.topology.edgeAssignments[i] === EDGE_CODE.aux) n += 1;
    }
    return n;
  }

  // A buried layer's aux line is hidden with the layer: each side of the
  // plane shows the piece on the face that is outermost there.
  it('draws each piece on the side its layer is seen from', () => {
    const plain = built();
    const withAux = built(lines([0, [5, -50], [20, -50]], [1, [5, -40], [20, -40]]));
    expect(withAux.skins).toHaveLength(plain.skins.length);
    for (const [i, skin] of withAux.skins.entries()) {
      const before = plain.skins[i]!;
      expect(auxEdges(withAux, skin.edgeStart, skin.edgeCount)).toBe(
        auxEdges(plain, before.edgeStart, before.edgeCount) + 1
      );
    }
    // A translucent style shows every layer, and both pieces.
    expect(
      auxEdges(withAux, withAux.translucent.edgeStart, withAux.translucent.edgeCount)
    ).toBe(auxEdges(plain, plain.translucent.edgeStart, plain.translucent.edgeCount) + 2);
    // On two vertices each, past everything the model had.
    expect(withAux.positions.length).toBe(plain.positions.length + 4 * 3);
  });
});

describe('the vector scene of a figure with aux lines', () => {
  // The export and the stored picture find a crease's layer by its vertices,
  // so an aux cut has to live in its slot's own range to be drawn at all.
  it('carries every layer’s aux cut as an aux line', () => {
    const model = pinwheel();
    const auxLines = (aux?: OristudioCpFolded3dAuxLines) => {
      const result = folded3dMesh(model, aux);
      if (result.kind !== 'mesh') throw new Error('pinwheel meshes');
      const camera = folded3dSceneCamera(DEFAULT_FOLDED_3D_CAMERA, result.mesh, 256);
      const scene = folded3dPaperScene(result.mesh, model, camera, {
        style: DEFAULT_PAPER_STYLE,
        markHidden: false,
        tolerances: TOLERANCES,
      });
      return scene.items.filter((item) => item.kind === 'line' && item.role === 'aux').length;
    };
    expect(auxLines(lines([0, [5, -50], [20, -50]], [1, [5, -40], [20, -40]]))).toBe(
      auxLines() + 2
    );
  });

  it('flags the ends the window erodes', () => {
    // Face 0's cut runs from its fold-side edge to its free edge, on top.
    const model = pinwheel();
    const result = folded3dMesh(model, lines([0, [0, -50], [25, -50]]));
    if (result.kind !== 'mesh') throw new Error('pinwheel meshes');
    const camera = folded3dSceneCamera(DEFAULT_FOLDED_3D_CAMERA, result.mesh, 256);
    const scene = folded3dPaperScene(result.mesh, model, camera, {
      style: DEFAULT_PAPER_STYLE,
      markHidden: false,
      tolerances: TOLERANCES,
    });
    const ends = scene.items.flatMap((item) =>
      item.kind === 'line' && item.role === 'aux' ? [item.onBoundary] : []
    );
    expect(ends).toEqual([[true, true]]);
  });
});

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6 + 0;
}
