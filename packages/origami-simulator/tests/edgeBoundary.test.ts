import { describe, expect, it } from 'vitest';
import { EDGE_CODE } from '../src/edgeCodes.js';
import {
  EDGE_BOUNDARY_A,
  EDGE_BOUNDARY_B,
  edgeBoundaryFlags,
  endpointOnBoundary,
  outlineVertexCounts,
} from '../src/edgeBoundary.js';

/**
 * The erode rule, stated once for three renderers: which end of each edge
 * retreats. The scene producer's own tests pin the same answers through
 * `onBoundary`; these pin the module the GPU and canvas-2D passes read.
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
    // The mountain itself: on the border at the corner, and alone at the
    // centre — the aux and facet edges there are interior to its layer.
    expect(flags[SPOKE_TO_CORNER_2]).toBe(EDGE_BOUNDARY_A);
  });

  it('flags both ends of creases that meet', () => {
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    expect(flags[6]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
    expect(flags[SPOKE_TO_CORNER_2]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
  });

  it('never flags a paper edge, whatever meets its ends', () => {
    // An edge is the outline; it has nothing to retreat from, and pulling it
    // back would open the outline at every corner.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    for (let edge = 0; edge < 5; edge += 1) expect(flags[edge]).toBe(0);
  });

  it('gives a facet edge flags too, which no pass reads', () => {
    // Facet edges are never drawn, so their flags are inert; they still come
    // out of the same rule rather than as a special case.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux })
    );
    expect(flags[8]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
  });

  it('ignores vertices past an explicit count', () => {
    // The scene producer bounds the table by the projected vertex count; an
    // edge naming a vertex past it counts for nothing there.
    const flags = edgeBoundaryFlags(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      5
    );
    expect(flags[AUX_LINE]).toBe(EDGE_BOUNDARY_A);
    expect(flags[6]).toBe(EDGE_BOUNDARY_A);
  });

  it('counts an edge once however many times the buffer lists it', () => {
    // The 3D figure's buffer carries a crease in every draw run that inks it,
    // on the same two vertices. A mountain from corner 2 to the centre listed
    // three times must not make the centre a place three creases meet: its
    // centre end is still alone there, and the aux line's centre end still
    // meets one fold, not three.
    const single = fan({
      toCorner1: EDGE_CODE.facet,
      toCorner2: EDGE_CODE.mountain,
      toCorner0: EDGE_CODE.aux,
    });
    const repeated = {
      edgeIndices: new Uint32Array([...single.edgeIndices, 2, 5, 5, 2]),
      edgeAssignments: new Uint8Array([...single.edgeAssignments, EDGE_CODE.mountain, EDGE_CODE.mountain]),
    };
    const once = edgeBoundaryFlags(single);
    const thrice = edgeBoundaryFlags(repeated);
    expect(thrice[SPOKE_TO_CORNER_2]).toBe(once[SPOKE_TO_CORNER_2]);
    expect(thrice[SPOKE_TO_CORNER_2]).toBe(EDGE_BOUNDARY_A);
    expect(thrice[AUX_LINE]).toBe(once[AUX_LINE]);
    // The copies carry the same flags as the original, whichever way round
    // their vertices are listed.
    expect(thrice[10]).toBe(EDGE_BOUNDARY_A);
    expect(thrice[11]).toBe(EDGE_BOUNDARY_B);
    expect([...outlineVertexCounts(repeated, 6)]).toEqual([...outlineVertexCounts(single, 6)]);
  });

  it('sizes the table from the edges when no count is given', () => {
    const counts = outlineVertexCounts(
      fan({ toCorner1: EDGE_CODE.valley, toCorner2: EDGE_CODE.mountain, toCorner0: EDGE_CODE.aux }),
      6
    );
    expect([...counts]).toEqual([2, 3, 3, 2, 2, 2]);
    expect(endpointOnBoundary(counts, 5, EDGE_CODE.mountain)).toBe(true);
    expect(endpointOnBoundary(counts, 5, EDGE_CODE.aux)).toBe(true);
    expect(endpointOnBoundary(counts, 5, EDGE_CODE.border)).toBe(false);
  });
});
