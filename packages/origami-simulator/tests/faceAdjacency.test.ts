import { describe, expect, it } from 'vitest';
import { faceAdjacency } from '../src/faceAdjacency.js';
import { EDGE_CODE } from '../src/edgeCodes.js';

/**
 * Two squares side by side, each split by a triangulation diagonal, sharing a
 * valley fold:
 *
 *   3 --- 4 --- 5
 *   | \   | \   |
 *   |  \  |  \  |
 *   0 --- 1 --- 2
 *
 * plus a free aux line (6–7) laid on no face.
 */
function twoSquares() {
  return {
    faceIndices: new Uint32Array([0, 1, 3, 1, 4, 3, 1, 2, 4, 2, 5, 4]),
    edgeIndices: new Uint32Array([0, 1, 1, 2, 2, 5, 5, 4, 4, 3, 3, 0, 1, 4, 1, 3, 2, 4, 6, 7]),
    edgeAssignments: new Uint8Array([
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.border,
      EDGE_CODE.valley,
      EDGE_CODE.facet,
      EDGE_CODE.facet,
      EDGE_CODE.aux,
    ]),
  };
}

describe('faceAdjacency', () => {
  it('joins the triangles of one face across the diagonals triangulation invented', () => {
    const { faceGroups } = faceAdjacency(twoSquares());
    expect(faceGroups[0]).toBe(faceGroups[1]);
    expect(faceGroups[2]).toBe(faceGroups[3]);
    // A crease is not a diagonal: the squares stay two faces.
    expect(faceGroups[0]).not.toBe(faceGroups[2]);
  });

  it('names the faces either side of a crease, each with its vertex off the crease', () => {
    const { faceGroups, edgeFaces, edgeApex } = faceAdjacency(twoSquares());
    // The valley 1–4 bounds the left square's upper triangle (1,4,3) and the
    // right square's lower one (1,2,4).
    expect([edgeFaces[12], edgeFaces[13]]).toEqual([faceGroups[1], faceGroups[2]]);
    expect([edgeApex[12], edgeApex[13]]).toEqual([3, 2]);
  });

  it('gives a paper edge one face and a line on no face none', () => {
    const { faceGroups, edgeFaces, edgeApex } = faceAdjacency(twoSquares());
    // The bottom edge 0–1 bounds the triangle (0,1,3).
    expect([edgeFaces[0], edgeFaces[1]]).toEqual([faceGroups[0], -1]);
    expect([edgeApex[0], edgeApex[1]]).toEqual([3, -1]);
    // The free aux line.
    expect([edgeFaces[18], edgeFaces[19], edgeApex[18], edgeApex[19]]).toEqual([-1, -1, -1, -1]);
  });
});
