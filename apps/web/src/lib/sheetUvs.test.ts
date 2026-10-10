import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '@treemaker/origami-simulator';
import { sheetUvs } from './sheetUvs';

const rectangle = new Float32Array([0, 0, 0, 2, 0, 0, 2, 0, 1, 0, 0, 1]);

describe('sheetUvs', () => {
  it('preserves aspect ratio with the same longest-span normalization as upstream saveOBJ', () => {
    expect([...sheetUvs(rectangle).uvs!]).toEqual([0, 0, 1, 0, 1, 0.5, 0, 0.5]);
    const square = rectangle.map((value, i) => i % 3 === 2 ? value * 2 : value);
    expect([...sheetUvs(square).uvs!]).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
  });

  it('is invariant to a uniform scale and translation, including a very small sheet', () => {
    for (const scale of [1e-8, 10, 10000]) {
      const moved = rectangle.map((value, i) => (value + [7, 0, -3][i % 3]!) * scale);
      const uv = sheetUvs(moved).uvs!;
      [...sheetUvs(rectangle).uvs!].forEach((value, i) => expect(uv[i]).toBeCloseTo(value, 5));
    }
  });

  it('maps the y-down source top-left to the UV top-left without an extra reflection', () => {
    const prepared = prepareFoldModel({
      vertices_coords: [[0, 0], [1, 0], [1, 1], [0, 1]],
      edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0]],
      edges_assignment: ['B', 'B', 'B', 'B'],
      faces_vertices: [[0, 1, 2, 3]],
    });
    expect([...sheetUvs(prepared.originalPositions).uvs!]).toEqual([0, 1, 1, 1, 1, 0, 0, 0]);
  });

  it('keeps subdivisions, interior points, and separate pieces in one sheet space', () => {
    const rest = new Float32Array([...rectangle, 1, 0, 0.5, 3, 0, 0, 4, 0, 1]);
    expect([...sheetUvs(rest).uvs!]).toEqual([
      0, 0, 0.5, 0, 0.5, 0.25, 0, 0.25, 0.25, 0.125, 0.75, 0, 1, 0.25,
    ]);
  });

  it.each([
    new Float32Array(), new Float32Array(9), new Float32Array([0, 1]),
    new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
    new Float32Array([...rectangle.slice(0, -1), NaN]),
    new Float32Array([...rectangle.slice(0, -1), Infinity]),
  ])('refuses invalid or collapsed sheet coordinates', (rest) => {
    expect(sheetUvs(rest)).toEqual({ uvs: null, reason: 'invalid-sheet' });
  });

  it('refuses a nonplanar rest mesh or a sheet in another plane, but tolerates float noise', () => {
    const lifted = rectangle.slice();
    lifted[1] = 0.5;
    expect(sheetUvs(lifted).reason).toBe('nonplanar-sheet');
    const xy = rectangle.map((value, i) => i % 3 === 1 ? rectangle[i + 1]! : i % 3 === 2 ? 0 : value);
    expect(sheetUvs(xy).reason).toBe('nonplanar-sheet');
    lifted[1] = 1e-8;
    expect(sheetUvs(lifted).reason).toBeNull();
  });
});
