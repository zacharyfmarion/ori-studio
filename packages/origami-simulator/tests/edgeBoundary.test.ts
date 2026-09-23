import { describe, expect, it } from 'vitest';
import { EDGE_CODE } from '../src/edgeCodes.js';
import {
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  auxEndsOnOutline,
  edgeBoundaryFlags,
  endpointOnBoundary,
  outlineVertexCounts,
} from '../src/edgeBoundary.js';
import { meshTopologyFor } from '../src/webgl/meshRenderer.js';

/**
 * The erode rule, stated once for three renderers: which end of each edge
 * retreats — an aux crease's, and nothing else's. The scene producer's own
 * tests pin the same answers through `onBoundary`; these pin the module the
 * GPU and canvas-2D passes read.
 */

/**
 * A square fanned from its centre (vertex 5), with a vertex (4) on the bottom
 * edge: an aux line runs from 4 up to the centre, and the spokes carry
 * whatever codes the case needs — the scene producer's fixture.
 */
function fan(spokes: { toCorner1: number; toCorner2: number; toCorner0: number }) {
  return {
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

const AUX_LINE = 5;
const SPOKE_TO_CORNER_2 = 7;

describe('edgeBoundaryFlags', () => {
  it('flags the end on the border and not the end in the middle of a layer', () => {
    // The aux line starts on the border and ends at a centre where only aux
    // and facet edges meet, which is the middle of a flat layer.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.facet, toCorner2: EDGE_CODE.facet, toCorner0: EDGE_CODE.aux })
    );
    expect(flags[AUX_LINE]).toBe(EDGE_BOUNDARY_A);
  });

  it('flags an end where a fold meets it', () => {
    // A mountain spoke into the centre turns it into a place the layer ends.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.facet, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    expect(flags[AUX_LINE]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
  });

  it('never flags a fold, which is drawn to the paper’s edge', () => {
    // Folds meeting each other and the border: erode is the aux pen's alone,
    // so neither end of either retreats.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    expect(flags[6]).toBe(0);
    expect(flags[SPOKE_TO_CORNER_2]).toBe(0);
    expect(flags[AUX_LINE]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
  });

  it('never flags a paper edge, whatever meets its ends', () => {
    // An edge is the outline; it has nothing to retreat from, and pulling it
    // back would open the outline at every corner.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    for (let edge = 0; edge < 5; edge += 1) expect(flags[edge]).toBe(0);
  });

  it('never flags a facet edge, which is never drawn', () => {
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    expect(flags[8]).toBe(0);
  });

  it('ignores vertices past an explicit count', () => {
    // The scene producer bounds the table by the projected vertex count; an
    // edge naming a vertex past it counts for nothing there.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      5
    );
    expect(flags[AUX_LINE]).toBe(EDGE_BOUNDARY_A);
  });

  it('counts an edge once however many times the buffer lists it', () => {
    // The 3D figure's buffer carries a crease in every draw run that inks it,
    // on the same two vertices. A mountain from corner 2 to the centre listed
    // three times is still one fold meeting the centre.
    const single = fan({
      toCorner1: EDGE_CODE.facet,
      toCorner2: EDGE_CODE.mountain,
      toCorner0: EDGE_CODE.aux,
    });
    const repeated = {
      edgeIndices: new Uint32Array([...single.edgeIndices, 2, 5, 5, 2]),
      edgeAssignments: new Uint8Array([...single.edgeAssignments, EDGE_CODE.mountain, EDGE_CODE.mountain]),
    };
    expect([...outlineVertexCounts(repeated, 6)]).toEqual([...outlineVertexCounts(single, 6)]);
    const thrice = edgeBoundaryFlags(repeated);
    expect(thrice[AUX_LINE]).toBe(edgeBoundaryFlags(single)[AUX_LINE]);
    // The copies are folds, drawn to their ends like the original.
    expect([thrice[SPOKE_TO_CORNER_2], thrice[10], thrice[11]]).toEqual([0, 0, 0]);
  });

  it('takes the ends a producer states, for an aux crease only', () => {
    // A crease on vertices of its own meets no outline edge there, so only
    // its producer knows where it ends on the outline.
    const topology = {
      edgeIndices: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]),
      edgeAssignments: new Uint8Array([
        EDGE_CODE.aux, EDGE_CODE.aux, EDGE_CODE.mountain, EDGE_CODE.border,
      ]),
      auxEnds: new Uint8Array([EDGE_BOUNDARY_B, 0, EDGE_BOUNDARY_A, EDGE_BOUNDARY_A | EDGE_BOUNDARY_B]),
    };
    expect([...edgeBoundaryFlags(topology)]).toEqual([EDGE_BOUNDARY_B, 0, 0, 0]);
    // Without them, nothing meets anything here.
    const { auxEnds: _stated, ...unstated } = topology;
    expect([...edgeBoundaryFlags(unstated)]).toEqual([0, 0, 0, 0]);
  });

  it('sizes the table from the edges when no count is given', () => {
    const counts = outlineVertexCounts(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      6
    );
    expect([...counts]).toEqual([2, 3, 3, 2, 2, 2]);
    expect(endpointOnBoundary(counts, 5, EDGE_CODE.aux)).toBe(true);
    expect(endpointOnBoundary(counts, 5, EDGE_CODE.mountain)).toBe(false);
    expect(endpointOnBoundary(counts, 5, EDGE_CODE.border)).toBe(false);
  });
});

describe('auxEndsOnOutline', () => {
  /**
   * The crease-pattern kernel's simulation model of a square with a mountain
   * diagonal and an aux line across the middle: the aux line is appended on
   * two vertices of its own (4, 5), on no face, crossing the diagonal.
   */
  const SQUARE = {
    edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 3, 3, 0, 0, 2, 4, 5]),
    edgeAssignments: new Uint8Array([
      EDGE_CODE.border, EDGE_CODE.border, EDGE_CODE.border, EDGE_CODE.border,
      EDGE_CODE.mountain, EDGE_CODE.aux,
    ]),
  };
  const FLAT = new Float32Array([
    -200, 0, -200, 200, 0, -200, 200, 0, 200, -200, 0, 200,
    -200, 0, 0, 200, 0, 0,
  ]);

  it('finds a free aux end on the paper’s edge, which no shared vertex could say', () => {
    expect([...edgeBoundaryFlags(SQUARE)]).toEqual([0, 0, 0, 0, 0, 0]);
    const stated = auxEndsOnOutline(SQUARE, FLAT, 1e-3)!;
    expect([...stated]).toEqual([0, 0, 0, 0, 0, EDGE_BOUNDARY_A | EDGE_BOUNDARY_B]);
    expect(edgeBoundaryFlags({ ...SQUARE, auxEnds: stated })[5]).toBe(
      EDGE_BOUNDARY_A | EDGE_BOUNDARY_B
    );
  });

  it('leaves an end in the middle of the paper, and says nothing when nothing is free', () => {
    const inside = Float32Array.from(FLAT);
    inside[5 * 3] = 50;
    expect([...auxEndsOnOutline(SQUARE, inside, 1e-3)!]).toEqual([0, 0, 0, 0, 0, EDGE_BOUNDARY_A]);
    // The fan's aux line shares its vertices with the border and the spokes.
    expect(
      auxEndsOnOutline(
        fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
        new Float32Array(6 * 3),
        1e-3
      )
    ).toBeUndefined();
  });

  it('is what the renderers’ topology carries, from the flat sheet', () => {
    const topology = meshTopologyFor({
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      edgesVertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2], [4, 5]],
      edgesAssignment: ['B', 'B', 'B', 'B', 'M', 'F'],
      originalPositions: FLAT,
    });
    expect(topology.auxEnds?.[5]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
    expect(edgeBoundaryFlags(topology)[5]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
  });
});
