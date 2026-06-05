import { describe, expect, it } from 'vitest';
import type { FoldDocument, SequenceStateSnapshot } from '../../engine/types';
import { foldedSurfaceFromSequenceState } from './foldedSurfaceAdapters';

describe('foldedSurfaceFromSequenceState', () => {
  it('keeps an unfolded crease pattern on one side of the paper', () => {
    const snapshot = foldedSurfaceFromSequenceState(sequenceState('flat', simpleFold()));

    expect(snapshot.facets.map((facet) => facet.color)).toEqual([1, 1]);
  });

  it('marks faces with reversed folded orientation as the back side', () => {
    const document = simpleFold();
    const snapshot = foldedSurfaceFromSequenceState(
      sequenceState('folded', document, [
        [0, 0],
        [1, 0],
        [1, 0],
        [0, 0],
        [0, 0.5],
        [1, 0.5],
      ])
    );

    expect(snapshot.facets.map((facet) => facet.color)).toEqual([1, 2]);
  });
});

function sequenceState(
  id: string,
  document: FoldDocument,
  foldedVertices = document.vertices_coords.map((coord) => [coord[0] ?? 0, coord[1] ?? 0] as [number, number])
): SequenceStateSnapshot {
  return {
    id,
    document,
    active_creases: [],
    face_orders: [],
    folded_vertices: foldedVertices,
    unresolved_regions: [],
    diagnostics: [],
  };
}

function simpleFold(): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 0.5],
      [1, 0.5],
    ],
    edges_vertices: [
      [0, 1],
      [1, 5],
      [5, 2],
      [2, 3],
      [3, 4],
      [4, 0],
      [4, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'V'],
    faces_vertices: [
      [0, 1, 5, 4],
      [4, 5, 2, 3],
    ],
  };
}
