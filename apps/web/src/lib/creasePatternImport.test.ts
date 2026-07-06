import { describe, expect, it } from 'vitest';
import { parseImportedCreasePattern } from './creasePatternImport';

describe('crease pattern import', () => {
  it('parses ORIPA CP lines and infers simulatable faces', () => {
    const result = parseImportedCreasePattern(
      [
        '1 0 0 1 0',
        '1 1 0 1 1',
        '1 1 1 0 1',
        '1 0 1 0 0',
        '2 0 0 1 1',
      ].join('\n'),
      { format: 'cp', filename: 'square.cp', path: null }
    );

    expect(result.document.source.format).toBe('cp');
    expect(result.document.lineOnly).toBe(false);
    expect(result.document.stats.faces).toBe(2);
    expect(result.project.creases.some((crease) => crease.fold === 'mountain')).toBe(true);
    expect(result.foldArtifacts.simulation_model?.fold.faces_vertices).toHaveLength(2);
  });

  it('keeps a line-only CP document when no faces can be inferred', () => {
    const result = parseImportedCreasePattern('2 0 0 1 1', {
      format: 'cp',
      filename: 'line.cp',
      path: null,
    });

    expect(result.document.lineOnly).toBe(true);
    expect(result.project.creases).toHaveLength(1);
    expect(result.project.facets).toHaveLength(0);
    expect(result.foldArtifacts.simulation_model).toBeNull();
    expect(result.foldArtifacts.simulation_model_error).toContain('Simulation requires');
  });

  it('selects the first useful FOLD crease-pattern frame with faces', () => {
    const fold = {
      file_title: 'multi frame',
      vertices_coords: [
        [0, 0],
        [1, 0],
      ],
      edges_vertices: [[0, 1]],
      edges_assignment: ['M'],
      file_frames: [
        {
          frame_title: 'usable cp',
          frame_classes: ['creasePattern'],
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
          ],
          edges_assignment: ['B', 'B', 'B', 'B'],
          faces_vertices: [[0, 1, 2, 3]],
        },
        {
          frame_title: 'embedded folded',
          frame_classes: ['foldedForm'],
          frame_parent: 1,
          frame_inherit: true,
          vertices_coords: [
            [0, 0],
            [0.5, 0],
            [0, 0.5],
          ],
          edges_vertices: [
            [0, 1],
            [1, 2],
            [2, 0],
          ],
          edges_assignment: ['B', 'B', 'B'],
          faces_vertices: [[0, 1, 2]],
          faceOrders: [[0, 0, -1]],
        },
      ],
    };

    const result = parseImportedCreasePattern(JSON.stringify(fold), {
      format: 'fold',
      filename: 'multi.fold',
      path: null,
    });

    expect(result.document.selectedFrame?.index).toBe(1);
    expect(result.document.selectedFrame?.title).toBe('usable cp');
    expect(result.document.foldFrames).toHaveLength(3);
    expect(result.document.foldedFormFrames).toHaveLength(1);
    expect(result.document.foldedFormFrames[0]).toMatchObject({
      index: 2,
      title: 'embedded folded',
      parentIndex: 1,
      inherited: true,
      foldedForm: true,
      faces: 1,
    });
    expect(result.document.sourceFold?.file_frames?.[1]?.frame_title).toBe('embedded folded');
    expect(result.document.stats.faces).toBe(1);
    expect(result.project.title).toBe('usable cp');
  });
});
