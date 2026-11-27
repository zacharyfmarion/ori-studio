import { describe, expect, it } from 'vitest';
import {
  AUX_LINES_KEY,
  auxLinesOf,
  cutAuxLines,
  withAuxLinesMapped,
  withVirtualVertices,
  type AuxLine,
  type AuxOverlay,
} from '../src/auxOverlay.js';
import { EDGE_BOUNDARY_A, EDGE_BOUNDARY_B } from '../src/edgeBoundary.js';
import { EDGE_CODE } from '../src/edgeCodes.js';
import { meshToPaperScene, type PaperLineItem } from '../src/paperScene.js';
import { prepareFoldModel } from '../src/prepare.js';
import { cameraUniforms } from '../src/webgl/camera.js';
import { meshTopologyFor, ribbonTopology, virtualVertexTexels } from '../src/webgl/meshRenderer.js';
import type { FoldDocument } from '../src/types.js';

/** A unit square with a valley along its diagonal (0,0)-(1,1): two triangles. */
function square(lines: AuxLine[] = []): FoldDocument {
  return {
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
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'V'],
    edges_foldAngle: [null, null, null, null, 180],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    ...(lines.length ? { [AUX_LINES_KEY]: lines } : {}),
  };
}

function overlayOf(lines: AuxLine[]): AuxOverlay {
  const prepared = prepareFoldModel(square(lines), { auxLines: true });
  expect(prepared.auxOverlay).toBeDefined();
  return prepared.auxOverlay!;
}

/** Each cut as its two ends in the sheet's own (x, y), rounded. */
function cutsInSheet(lines: AuxLine[]): Array<[[number, number], [number, number]]> {
  const prepared = prepareFoldModel(square(lines), { auxLines: true });
  const overlay = prepared.auxOverlay!;
  const placed = withVirtualVertices(prepared.originalPositions, {
    start: prepared.vertexCount,
    nodes: overlay.nodes,
    weights: overlay.weights,
  });
  // The sheet is lifted to [x, 0, -y].
  const at = (end: number): [number, number] => {
    const index = (prepared.vertexCount + end) * 3;
    return [round(placed[index]!), round(-placed[index + 2]!)];
  };
  const cuts: Array<[[number, number], [number, number]]> = [];
  for (let piece = 0; piece < overlay.triangles.length; piece += 1) {
    cuts.push([at(overlay.pieces[piece * 2]!), at(overlay.pieces[piece * 2 + 1]!)]);
  }
  return cuts;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6 + 0;

describe('cutAuxLines', () => {
  it('cuts a line at the fold it crosses, the two cuts sharing their joint', () => {
    const overlay = overlayOf([[[0, 0.25], [1, 0.25]]]);

    expect(overlay.triangles).toHaveLength(2);
    // One chain: the first cut's end is the second's start.
    expect(overlay.pieces[1]).toBe(overlay.pieces[2]);
    expect(cutsInSheet([[[0, 0.25], [1, 0.25]]])).toEqual([
      [
        [0, 0.25],
        [0.25, 0.25],
      ],
      [
        [0.25, 0.25],
        [1, 0.25],
      ],
    ]);
    // Both ends on the paper's edge, and the joint on the valley: all retreat.
    expect(Array.from(overlay.ends)).toEqual([
      EDGE_BOUNDARY_A | EDGE_BOUNDARY_B,
      EDGE_BOUNDARY_A | EDGE_BOUNDARY_B,
    ]);
  });

  it('gives a line lying along a crease to one triangle', () => {
    const overlay = overlayOf([[[0, 0], [1, 1]]]);

    expect(overlay.triangles).toHaveLength(1);
    expect(overlay.ends[0]).toBe(EDGE_BOUNDARY_A | EDGE_BOUNDARY_B);
  });

  it('keeps a line along the border', () => {
    expect(cutsInSheet([[[0.2, 0], [0.8, 0]]])).toEqual([
      [
        [0.2, 0],
        [0.8, 0],
      ],
    ]);
  });

  it('drops what lies off the paper', () => {
    expect(cutsInSheet([[[-1, 0.1], [0.5, 0.1]]])).toEqual([
      [
        [0, 0.1],
        [0.1, 0.1],
      ],
      [
        [0.1, 0.1],
        [0.5, 0.1],
      ],
    ]);
    expect(prepareFoldModel(square([[[2, 2], [3, 3]]]), { auxLines: true }).auxOverlay).toBeUndefined();
  });

  it('retreats a tick only at the end on the paper edge', () => {
    const overlay = overlayOf([[[0.5, 0], [0.5, 0.2]]]);

    expect(overlay.triangles).toHaveLength(1);
    expect(overlay.ends[0]).toBe(EDGE_BOUNDARY_A);
  });

  it('joins two lines that meet at a point', () => {
    const overlay = overlayOf([
      [[0.6, 0.1], [0.8, 0.2]],
      [[0.8, 0.2], [0.9, 0.1]],
    ]);

    expect(overlay.pieces[1]).toBe(overlay.pieces[2]);
    expect(overlay.weights).toHaveLength(9);
  });

  it('parts a line at a slit, whose two sides are different nodes', () => {
    // Two triangles meeting along x = 0.5 on nodes of their own.
    const slit: FoldDocument = {
      vertices_coords: [
        [0, 0],
        [0.5, 0],
        [0.5, 1],
        [0.5, 0],
        [1, 0],
        [0.5, 1],
      ],
      edges_vertices: [
        [0, 1],
        [1, 2],
        [2, 0],
        [3, 4],
        [4, 5],
        [5, 3],
      ],
      edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B'],
      edges_foldAngle: [null, null, null, null, null, null],
      faces_vertices: [
        [0, 1, 2],
        [3, 4, 5],
      ],
      [AUX_LINES_KEY]: [[[0.1, 0.1], [0.9, 0.1]]],
    };
    const overlay = prepareFoldModel(slit, { auxLines: true }).auxOverlay!;

    expect(overlay.triangles).toHaveLength(2);
    expect(overlay.pieces[1]).not.toBe(overlay.pieces[2]);
  });

  it('cuts a sheet given as 3-component coordinates', () => {
    const flat = square();
    const lifted: FoldDocument = {
      ...flat,
      vertices_coords: flat.vertices_coords.map(([x, y]) => [x!, y!, 0]),
      [AUX_LINES_KEY]: [[[0, 0.25, 0], [1, 0.25, 0]]],
    };

    expect(prepareFoldModel(lifted, { auxLines: true }).auxOverlay?.triangles).toHaveLength(2);
  });

  it('leaves the mesh exactly as it is without the lines', () => {
    const without = prepareFoldModel(square());
    const withLines = prepareFoldModel(square([[[0, 0.25], [1, 0.25]]]), { auxLines: true });

    expect(withLines.vertexCount).toBe(without.vertexCount);
    expect(Array.from(withLines.indices)).toEqual(Array.from(without.indices));
    expect(withLines.edgesVertices).toEqual(without.edgesVertices);
    expect(withLines.creaseParams).toEqual(without.creaseParams);
  });

  it('cuts nothing unless asked', () => {
    expect(prepareFoldModel(square([[[0, 0.25], [1, 0.25]]])).auxOverlay).toBeUndefined();
  });

  it('is empty for a fold with no lines or a malformed key', () => {
    expect(auxLinesOf(square())).toEqual([]);
    expect(auxLinesOf({ ...square(), [AUX_LINES_KEY]: [[[0, 0]], 'x', [[0, 0], [1, Number.NaN]]] })).toEqual([]);
    expect(cutAuxLines(square(), [])).toBeNull();
  });
});

describe('withAuxLinesMapped', () => {
  it('moves the lines as the vertices are moved', () => {
    const moved = withAuxLinesMapped(square([[[0, 0.25], [1, 0.25]]]), ([x, y]) => [x! * 2, y! * 2]);

    expect(auxLinesOf(moved)).toEqual([
      [
        [0, 0.5],
        [2, 0.5],
      ],
    ]);
  });

  it('leaves a fold with no lines alone', () => {
    const fold = square();
    expect(withAuxLinesMapped(fold, ([x, y]) => [x!, y!])).toBe(fold);
  });
});

describe('withVirtualVertices', () => {
  it('carries an end with its triangle when the paper folds', () => {
    const prepared = prepareFoldModel(square([[[0.5, 0.9], [0.5, 0.6]]]), { auxLines: true });
    const overlay = prepared.auxOverlay!;
    // Fold the triangle (0,2,3) over the diagonal: corner 3 at (0,1) lands on
    // (1,0), so a point (x, y) of that triangle lands on (y, x).
    const folded = prepared.originalPositions.slice();
    folded.set([1, 0, -0], 3 * 3);
    const placed = withVirtualVertices(folded, {
      start: prepared.vertexCount,
      nodes: overlay.nodes,
      weights: overlay.weights,
    });
    const end = (prepared.vertexCount + overlay.pieces[0]!) * 3;

    expect(round(placed[end]!)).toBe(0.9);
    expect(round(-placed[end + 2]!)).toBe(0.5);
  });

  it('returns the positions themselves when there is nothing to place', () => {
    const positions = new Float32Array([0, 0, 0]);
    expect(withVirtualVertices(positions, undefined)).toBe(positions);
  });
});

describe('meshTopologyFor with drawn-on aux lines', () => {
  it('appends each cut as an aux crease on its own ends', () => {
    const prepared = prepareFoldModel(square([[[0, 0.25], [1, 0.25]]]), { auxLines: true });
    const topology = meshTopologyFor(prepared);
    const meshEdges = prepared.edgesVertices.length;

    expect(topology.edgeAssignments).toHaveLength(meshEdges + 2);
    expect(Array.from(topology.edgeAssignments.slice(meshEdges))).toEqual([EDGE_CODE.aux, EDGE_CODE.aux]);
    expect(topology.virtual?.start).toBe(prepared.vertexCount);
    expect(topology.edgeIndices[meshEdges * 2]).toBeGreaterThanOrEqual(prepared.vertexCount);
    expect(Array.from(topology.edgeTriangles!.slice(0, meshEdges)).every((t) => t === -1)).toBe(true);
    expect(Array.from(topology.auxEnds!.slice(meshEdges))).toEqual(Array.from(prepared.auxOverlay!.ends));
  });

  it('names each end of a cut over its own triangle for the edge pass, and moves none', () => {
    // The line crosses the diagonal fold, so its two cuts share their joint,
    // named over whichever triangle placed it first.
    const prepared = prepareFoldModel(square([[[0, 0.25], [1, 0.25]]]), { auxLines: true });
    const topology = meshTopologyFor(prepared);
    const ribbons = ribbonTopology(topology);
    const meshEdges = prepared.edgesVertices.length;
    const table = ribbons.virtual!;
    const at = (positions: Float32Array, vertex: number) => Array.from(positions.subarray(vertex * 3, vertex * 3 + 3));
    const before = withVirtualVertices(prepared.originalPositions, topology.virtual);
    const after = withVirtualVertices(prepared.originalPositions, table);

    expect(Array.from(ribbons.edgeIndices.slice(0, meshEdges * 2))).toEqual(
      Array.from(topology.edgeIndices.slice(0, meshEdges * 2))
    );
    for (let edge = meshEdges; edge < topology.edgeAssignments.length; edge += 1) {
      const triangle = topology.edgeTriangles![edge]!;
      const corners = Array.from(topology.faceIndices.slice(triangle * 3, triangle * 3 + 3));
      for (const end of [0, 1]) {
        const vertex = ribbons.edgeIndices[edge * 2 + end]!;
        const entry = vertex - table.start;
        expect(Array.from(table.nodes.slice(entry * 3, entry * 3 + 3))).toEqual(corners);
        const was = at(before, topology.edgeIndices[edge * 2 + end]!);
        at(after, vertex).forEach((value, axis) => expect(value).toBeCloseTo(was[axis]!, 6));
      }
    }
    // The joint is one end in the topology and one per cut here.
    expect(topology.edgeIndices[meshEdges * 2 + 1]).toBe(topology.edgeIndices[meshEdges * 2 + 2]);
    expect(ribbons.edgeIndices[meshEdges * 2 + 1]).not.toBe(ribbons.edgeIndices[meshEdges * 2 + 2]);
  });

  it('leaves a mesh with no drawn-on lines as it is for the edge pass', () => {
    const topology = meshTopologyFor(prepareFoldModel(square()));
    expect(ribbonTopology(topology)).toBe(topology);
  });

  it('packs the ends two texels each for the edge shader', () => {
    const prepared = prepareFoldModel(square([[[0, 0.25], [1, 0.25]]]), { auxLines: true });
    const table = virtualVertexTexels(meshTopologyFor(prepared).virtual!, 4)!;
    const overlay = prepared.auxOverlay!;

    expect(table.width).toBe(4);
    expect(table.height).toBe(2);
    expect(Array.from(table.data.slice(0, 3))).toEqual(Array.from(overlay.nodes.slice(0, 3)));
    expect(Array.from(table.data.slice(4, 7))).toEqual(Array.from(overlay.weights.slice(0, 3)));
  });
});

describe('meshToPaperScene with drawn-on aux lines', () => {
  it('draws each cut as an aux line on its face, joined where cuts meet', () => {
    const prepared = prepareFoldModel(square([[[0, 0.25], [1, 0.25]]]), { auxLines: true });
    const camera = cameraUniforms({ yaw: 0, pitch: 0, zoom: 1 }, [0.5, 0, -0.5], 1, 400, 400);
    const scene = meshToPaperScene(prepared.originalPositions, meshTopologyFor(prepared), camera, {
      sheet: 1,
      markHidden: false,
    });
    const aux = scene.items.filter(
      (item): item is PaperLineItem => item.kind === 'line' && item.role === 'aux'
    );

    expect(aux).toHaveLength(2);
    expect(aux.every((line) => line.face !== undefined)).toBe(true);
    expect(aux.map((line) => line.joined)).toEqual(
      expect.arrayContaining([[false, true], [true, false]])
    );
  });
});
