import { describe, expect, it } from 'vitest';
import type { FoldArtifacts, FoldDocument } from '../engine/types';
import {
  SEGMENT_EXPORT_FORMATS,
  buildSegmentSubFold,
  isSegmentImageFormat,
} from './creaseSegmentExport';

// Same two-region fixture as the resolver test: two bordered squares sharing a
// middle wall, each split by a diagonal crease. Left region = faces {0,1}.
function makeFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [0, 3],
      [2, 5],
      [3, 4],
      [4, 5],
      [1, 4],
      [0, 4],
      [1, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'V'],
    faces_vertices: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  };
}

function makeArtifacts(fold: FoldDocument = makeFold()): FoldArtifacts {
  return { fold, simulation_model: null };
}

describe('buildSegmentSubFold', () => {
  it('extracts the left region as a standalone sub-fold', () => {
    const sub = buildSegmentSubFold(makeArtifacts(), 0);
    expect(sub).not.toBeNull();
    // Left region uses vertices {0,1,3,4} and edges {0-1, 0-3, 3-4, 1-4, 0-4}.
    expect(sub?.vertices_coords.length).toBe(4);
    expect(sub?.edges_vertices.length).toBe(5);
    // Its diagonal crease (M) and its border creases (B) survive re-indexing.
    expect(sub?.edges_assignment).toContain('M');
    expect(sub?.edges_assignment).toContain('B');
    expect(sub?.edges_assignment).not.toContain('V');
  });

  it('extracts the right region distinctly', () => {
    const sub = buildSegmentSubFold(makeArtifacts(), 1);
    expect(sub?.vertices_coords.length).toBe(4);
    expect(sub?.edges_assignment).toContain('V');
    expect(sub?.edges_assignment).not.toContain('M');
  });

  it('returns null for an unknown segment id or missing artifacts', () => {
    expect(buildSegmentSubFold(makeArtifacts(), 99)).toBeNull();
    expect(buildSegmentSubFold(null, 0)).toBeNull();
  });
});

describe('segment export format metadata', () => {
  it('excludes tree formats and classifies images vs files', () => {
    const formats = SEGMENT_EXPORT_FORMATS.map((meta) => meta.format);
    expect(formats).toEqual(['cp', 'fold', 'ori', 'orh', 'svg', 'png']);
    expect(formats).not.toContain('v5');
    expect(
      SEGMENT_EXPORT_FORMATS.filter((meta) => meta.kind === 'image').map((m) => m.format),
    ).toEqual(['svg', 'png']);
  });

  it('isSegmentImageFormat only matches svg/png', () => {
    expect(isSegmentImageFormat('svg')).toBe(true);
    expect(isSegmentImageFormat('png')).toBe(true);
    expect(isSegmentImageFormat('fold')).toBe(false);
    expect(isSegmentImageFormat('cp')).toBe(false);
  });
});
