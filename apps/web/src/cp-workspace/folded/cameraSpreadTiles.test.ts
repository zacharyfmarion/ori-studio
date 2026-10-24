import { describe, expect, it } from 'vitest';
import { triangleTouchesTile } from './cameraSpreadTiles';
describe('camera coverage tiles', () => {
  it('rejects empty corners of a skinny triangle’s bounding box, for either winding', () => {
    expect(triangleTouchesTile([0, 0], [100, 100], [99, 100], 0, 80, 10)).toBe(false);
    expect(triangleTouchesTile([0, 0], [99, 100], [100, 100], 0, 80, 10)).toBe(false);
    expect(triangleTouchesTile([0, 0], [100, 100], [99, 100], 40, 40, 10)).toBe(true);
  });
  it('retains shared boundaries and triangles wholly inside a tile', () => {
    expect(triangleTouchesTile([0, 0], [10, 0], [0, 10], 10, 0, 10)).toBe(true);
    expect(triangleTouchesTile([2, 2], [8, 2], [2, 8], 0, 0, 10)).toBe(true);
  });
});
