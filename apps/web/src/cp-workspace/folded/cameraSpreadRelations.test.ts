import { describe, expect, it } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { cameraLayerCovers, cameraLayerRelations } from './cameraSpreadRelations';

function kernel(stacks: number[][], count = 5): OristudioCpFoldedPaperScene {
  return {
    schema_version: 3,
    flipped: false,
    sheet: 1,
    aux_lines: [],
    sheet_points: [],
    faces: Array.from({ length: count }, () => ({
      points: [],
      outline: [],
      edges: [],
      front_up: true,
    })),
    subfaces: stacks.map((faces_top_to_bottom) => ({
      polygon: [],
      faces_top_to_bottom,
    })),
  };
}
describe('authoritative camera layer relationships', () => {
  it('protects transitive stacks but leaves independent flaps incomparable regardless of paint rank', () => {
    const scene = kernel([
      [0, 1],
      [1, 2],
      [3, 4],
    ]);
    const relations = cameraLayerRelations(scene);
    expect(cameraLayerRelations(scene)).toBe(relations);
    const piece = (face: number, rank: number) => ({ face, rank });
    expect(cameraLayerCovers(relations, piece(0, 0), piece(2, 100), false)).toBe(true);
    expect(cameraLayerCovers(relations, piece(2, 100), piece(0, 0), false)).toBe(false);
    for (const back of [false, true]) {
      expect(cameraLayerCovers(relations, piece(3, 1000), piece(0, 0), back)).toBe(false);
      expect(cameraLayerCovers(relations, piece(0, 0), piece(3, 1000), back)).toBe(false);
    }
    expect(cameraLayerCovers(relations, piece(2, 100), piece(0, 0), true)).toBe(true);
  });
  it('retains woven patch ordering inside a cycle without making unrelated faces part of it', () => {
    const relations = cameraLayerRelations(
      kernel([
        [0, 1],
        [1, 2],
        [2, 0],
        [2, 3],
      ])
    );
    for (const back of [false, true]) {
      expect(cameraLayerCovers(relations, { face: 0, rank: 10 }, { face: 1, rank: 5 }, back)).toBe(true);
      expect(cameraLayerCovers(relations, { face: 0, rank: 5 }, { face: 1, rank: 10 }, back)).toBe(false);
      expect(cameraLayerCovers(relations, { face: 4, rank: 100 }, { face: 0, rank: 5 }, back)).toBe(false);
      expect(cameraLayerCovers(relations, { face: 0, rank: 5 }, { face: 0, rank: 5 }, back)).toBe(false);
    }
    expect(cameraLayerCovers(relations, { face: 1, rank: 0 }, { face: 3, rank: 100 }, false)).toBe(true);
  });
});
