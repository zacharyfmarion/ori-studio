import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import { foldedFoldDocument, foldedObj, foldedStl, type FoldedMesh } from './foldedExport';

function sourceFold(): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    frame_title: 'Square',
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
  };
}

/** Two triangles, one lifted in Y so the fold is not flat. */
function mesh(): FoldedMesh {
  return {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0.5, 1, 0, 0, 1]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
    foldPercent: 60,
  };
}

describe('foldedFoldDocument', () => {
  it('marks the frame as a folded form with 3D vertices', () => {
    const folded = foldedFoldDocument(sourceFold(), mesh());

    expect(folded.frame_classes).toEqual(['foldedForm']);
    expect(folded.frame_title).toContain('60%');
    expect(folded.vertices_coords).toHaveLength(4);
    expect(folded.vertices_coords[0]).toHaveLength(3);
    expect(folded.vertices_coords[2]).toEqual([1, 0.5, 1]);
    expect(folded.faces_vertices).toEqual([
      [0, 1, 2],
      [0, 2, 3],
    ]);
  });

  it('keeps crease assignments when the vertex set is unchanged', () => {
    const folded = foldedFoldDocument(sourceFold(), mesh());
    expect(folded.edges_assignment).toEqual(['B', 'B', 'B', 'B', 'V']);
  });

  it('drops edges when triangulation changed the vertex set', () => {
    // Edges would otherwise index vertices that no longer mean the same thing.
    const denser: FoldedMesh = {
      positions: new Float32Array(15),
      triangles: new Uint32Array([0, 1, 2]),
      foldPercent: 100,
    };
    const folded = foldedFoldDocument(sourceFold(), denser);

    expect(folded.edges_vertices).toEqual([]);
    expect(folded.edges_assignment).toBeUndefined();
    expect(folded.edges_foldAngle).toBeUndefined();
  });

  it('drops namespaced per-edge arrays along with the edges they describe', () => {
    // These ride in on the spread of the source document. Deleting only the
    // typed fields left a folded form asserting 5 line colours for 0 edges --
    // self-contradictory, and a leak of the whole sheet's data into a fragment.
    const source: FoldDocument = {
      ...sourceFold(),
      'oristudio:edges_line_colors': [0, 0, 0, 0, 2],
      'oriedita:edges_colors': ['', '', '', '', ''],
    };
    const denser: FoldedMesh = {
      positions: new Float32Array(15),
      triangles: new Uint32Array([0, 1, 2]),
      foldPercent: 100,
    };

    const folded = foldedFoldDocument(source, denser) as Record<string, unknown>;

    expect(folded.edges_vertices).toEqual([]);
    expect(folded['oristudio:edges_line_colors']).toBeUndefined();
    expect(folded['oriedita:edges_colors']).toBeUndefined();
  });

  it('drops derived topology that the new faces would contradict', () => {
    const source = { ...sourceFold(), faces_edges: [[0, 1, 4]], edges_faces: [[0]] };
    const folded = foldedFoldDocument(source, mesh());

    expect(folded.faces_edges).toBeUndefined();
    expect(folded.edges_faces).toBeUndefined();
  });
});

describe('foldedObj', () => {
  it('writes vertices and 1-based faces', () => {
    const obj = foldedObj(mesh(), 'lamprey');
    const lines = obj.trim().split('\n');

    expect(lines[1]).toBe('o lamprey');
    expect(lines).toContain('v 1 0.5 1');
    // OBJ indices start at 1, not 0.
    expect(lines).toContain('f 1 2 3');
    expect(lines).toContain('f 1 3 4');
  });
});

describe('foldedStl', () => {
  it('writes a binary STL with one 50-byte record per triangle', () => {
    const bytes = foldedStl(mesh());

    expect(bytes.length).toBe(84 + 2 * 50);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(80, true)).toBe(2);

    // First facet's normal must be a unit vector.
    const n = [view.getFloat32(84, true), view.getFloat32(88, true), view.getFloat32(92, true)];
    expect(Math.hypot(...n)).toBeCloseTo(1, 5);

    // ...and its first vertex must be the mesh's first vertex.
    expect(view.getFloat32(96, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(100, true)).toBeCloseTo(0, 5);
    expect(view.getFloat32(104, true)).toBeCloseTo(0, 5);
  });

  it('writes a zero normal for a degenerate triangle instead of NaN', () => {
    const degenerate: FoldedMesh = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      triangles: new Uint32Array([0, 1, 2]),
      foldPercent: 0,
    };
    const view = new DataView(foldedStl(degenerate).buffer);

    expect(view.getFloat32(84, true)).toBe(0);
    expect(view.getFloat32(88, true)).toBe(0);
    expect(view.getFloat32(92, true)).toBe(0);
  });
});
