/**
 * The candidate the detect dialog shows and adds, with "Snap to grid" on and
 * off. The mapping from solve-input ids to FOLD vertices is exercised by the
 * dialog's partial and improved offers too; what is held here is that a snap
 * lands on the vertex it names, and that anything the FOLD cannot carry leaves
 * the candidate as recognized rather than half-moved.
 */
import { describe, expect, it } from 'vitest';
import { activeBoxPleatGrid, candidateFoldJson, foldJsonWithMovedVertices } from './cpDetectCandidateFold';

const FOLD = JSON.stringify({
  vertices_coords: [
    [0, 0],
    [0.4985, 0.5],
    [1, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
  ],
  cp_detector: { vertex_original_ids: [4, 7, 9] },
});

const GRID = { cells: 16, snappedVertices: [{ vertex_id: 7, after: { x: 0.5, y: 0.5 } }] };

describe('candidateFoldJson', () => {
  it('writes the snap into the vertex it names', () => {
    expect(JSON.parse(candidateFoldJson({ foldJson: FOLD }, GRID)).vertices_coords).toEqual([
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ]);
  });

  it('is the candidate as recognized without a grid', () => {
    expect(candidateFoldJson({ foldJson: FOLD }, null)).toBe(FOLD);
  });

  it('is the candidate as recognized when the snap moved nothing or names no vertex here', () => {
    expect(candidateFoldJson({ foldJson: FOLD }, { cells: 16, snappedVertices: [] })).toBe(FOLD);
    expect(
      candidateFoldJson({ foldJson: FOLD }, { cells: 16, snappedVertices: [{ vertex_id: 99, after: { x: 0, y: 0 } }] })
    ).toBe(FOLD);
  });
});

describe('activeBoxPleatGrid', () => {
  it('is the recognized grid while snapping, and null otherwise', () => {
    expect(activeBoxPleatGrid({ boxPleatGrid: GRID }, true)).toBe(GRID);
    expect(activeBoxPleatGrid({ boxPleatGrid: GRID }, false)).toBeNull();
    expect(activeBoxPleatGrid({ boxPleatGrid: null }, true)).toBeNull();
    expect(activeBoxPleatGrid(null, true)).toBeNull();
  });
});

describe('foldJsonWithMovedVertices', () => {
  it('refuses a FOLD whose id map does not match its vertices', () => {
    const mismatched = JSON.stringify({ vertices_coords: [[0, 0]], cp_detector: { vertex_original_ids: [4, 7] } });
    expect(foldJsonWithMovedVertices(mismatched, GRID.snappedVertices)).toBeNull();
    expect(foldJsonWithMovedVertices('not json', GRID.snappedVertices)).toBeNull();
  });
});
