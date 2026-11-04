import { describe, expect, it } from 'vitest';
import { layerOrderSceneRelations } from './layerOrderSceneRelations';

/** Two spots: faces 2, 0, 1 from the top, and 0 over 1 again. */
const subfaces = [
  { polygon: [], faces_top_to_bottom: [2, 0, 1] },
  { polygon: [], faces_top_to_bottom: [0, 1] },
];

describe('layerOrderSceneRelations', () => {
  it('lists each face above each below it once, ascending, upper first', () => {
    expect(Array.from(layerOrderSceneRelations({ flipped: false, subfaces }))).toEqual([0, 1, 2, 0, 2, 1]);
  });

  it('reads a rear pass the other way up', () => {
    expect(Array.from(layerOrderSceneRelations({ flipped: true, subfaces }))).toEqual([0, 2, 1, 0, 1, 2]);
  });

  it('gives nothing for a scene of single faces', () => {
    expect(layerOrderSceneRelations({ flipped: false, subfaces: [{ polygon: [], faces_top_to_bottom: [3] }] })).toEqual(
      new Uint32Array(0)
    );
  });
});
