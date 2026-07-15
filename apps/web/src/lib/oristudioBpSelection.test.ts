import { describe, expect, it } from 'vitest';
import type { OristudioBpDocumentState } from '../engine/oristudioBpTypes';
import {
  bpLinkedSelection,
  bpSelectionSize,
  bpSelectionSummary,
  isBpEdgeSelected,
  isBpFlapSelected,
  isBpInvalidJunctionSelected,
  isBpRiverSelected,
  isBpVertexSelected,
  toggleBpEdgeSelection,
  toggleBpFlapSelection,
  toggleBpInvalidJunctionSelection,
  toggleBpRiverSelection,
  toggleBpVertexSelection,
} from './oristudioBpSelection';

describe('oristudio BP selection helpers', () => {
  const linkedDocument = {
    snapshot: {
      tree: {
        vertices: [
          { id: 1, dualFlapId: null, isLeaf: false },
          { id: 2, dualFlapId: 2, isLeaf: true },
          { id: 3, dualFlapId: 3, isLeaf: true },
        ],
        edges: [
          { id: 4, vertices: [1, 2], dualRiverId: 9 },
          { id: 5, vertices: [1, 3], dualRiverId: null },
        ],
      },
      packing: {
        flaps: [
          { id: 2, vertexId: 2 },
          { id: 3, vertexId: 3 },
        ],
        rivers: [{ id: 9, edgeId: 4 }],
        invalidJunctions: [{ id: '2,3', flapIds: [2, 3], riverIds: [9] }],
      },
    },
  } as OristudioBpDocumentState;

  it('toggles BP vertex and edge selections into a compact multi-selection', () => {
    const vertex = toggleBpVertexSelection({ kind: 'bp-tree' }, 2);
    expect(vertex).toEqual({ kind: 'bp-vertex', id: 2 });
    expect(isBpVertexSelected(vertex, 2)).toBe(true);

    const withEdge = toggleBpEdgeSelection(vertex, 3);
    expect(withEdge).toEqual({
      kind: 'bp-multi',
      vertices: [2],
      edges: [3],
      flaps: [],
      rivers: [],
      stretches: [],
      devices: [],
      invalidJunctions: [],
    });
    expect(isBpEdgeSelected(withEdge, 3)).toBe(true);
    expect(bpSelectionSize(withEdge)).toBe(2);
    expect(bpSelectionSummary(withEdge)).toBe('1 vertices, 1 edges');

    expect(toggleBpVertexSelection(withEdge, 2)).toEqual({ kind: 'bp-edge', id: 3 });
  });

  it('toggles BP packing selections and summarizes them', () => {
    const flap = toggleBpFlapSelection({ kind: 'bp-tree' }, 7);
    expect(flap).toEqual({ kind: 'bp-flap', id: 7 });
    expect(isBpFlapSelected(flap, 7)).toBe(true);

    const withRiver = toggleBpRiverSelection(flap, 3);
    const withConflict = toggleBpInvalidJunctionSelection(withRiver, 'f7,f8');
    expect(withConflict).toEqual({
      kind: 'bp-multi',
      vertices: [],
      edges: [],
      flaps: [7],
      rivers: [3],
      stretches: [],
      devices: [],
      invalidJunctions: ['f7,f8'],
    });
    expect(isBpRiverSelected(withConflict, 3)).toBe(true);
    expect(isBpInvalidJunctionSelected(withConflict, 'f7,f8')).toBe(true);
    expect(bpSelectionSize(withConflict)).toBe(3);
    expect(bpSelectionSummary(withConflict)).toBe('1 flaps, 1 rivers, 1 conflicts');

    expect(toggleBpFlapSelection(withConflict, 7)).toMatchObject({
      kind: 'bp-multi',
      rivers: [3],
      invalidJunctions: ['f7,f8'],
    });
  });

  it('expands linked BP source and packing selections', () => {
    const conflict = bpLinkedSelection({ kind: 'bp-invalid-junction', id: '2,3' }, linkedDocument);
    expect([...conflict.vertices]).toEqual([2, 3]);
    expect([...conflict.edges]).toEqual([4]);
    expect([...conflict.flaps]).toEqual([2, 3]);
    expect([...conflict.rivers]).toEqual([9]);

    const edge = bpLinkedSelection({ kind: 'bp-edge', id: 4 }, linkedDocument);
    expect([...edge.rivers]).toEqual([9]);

    const river = bpLinkedSelection({ kind: 'bp-river', id: 9 }, linkedDocument);
    expect([...river.edges]).toEqual([4]);
  });
});
