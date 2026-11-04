import earcut from 'earcut';
import type { Point, Triangle } from '@oristudio/layer-spread';
import { describe, expect, it, vi } from 'vitest';
import { triangulateSpreadFace } from './triangulateSpreadFace';

vi.mock('earcut', async (importOriginal) => {
  const original = await importOriginal<typeof import('earcut')>();
  return { ...original, default: vi.fn(original.default) };
});

const area = ([a, b, c]: Point[]) => ((b![0] - a![0]) * (c![1] - a![1]) - (b![1] - a![1]) * (c![0] - a![0])) / 2;
const edge = (a: number, b: number) => [a, b].sort((u, v) => u - v).join(':');

function checkMesh(ids: number[], xy: Point[], triangles: Triangle[]) {
  expect(triangles).toHaveLength(ids.length - 2);
  expect(new Set(triangles.flat())).toEqual(new Set(ids));
  const counts = new Map<string, number>();
  for (const t of triangles) {
    expect(area(t.map((v) => xy[v]!))).toBeGreaterThan(0);
    expect(area(t.map((v) => xy[v]!.map(Math.fround) as Point))).toBeGreaterThan(0);
    t.forEach((v, i) => {
      const key = edge(v, t[(i + 1) % 3]!);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
  }
  const boundary = new Set(ids.map((v, i) => edge(v, ids[(i + 1) % ids.length]!)));
  for (const key of boundary) expect(counts.get(key)).toBe(1);
  for (const [key, count] of counts) expect(count).toBe(boundary.has(key) ? 1 : 2);
  const polygonArea =
    Math.abs(
      ids.reduce((sum, v, i) => {
        const a = xy[v]!,
          b = xy[ids[(i + 1) % ids.length]!]!;
        return sum + a[0] * b[1] - b[0] * a[1];
      }, 0),
    ) / 2;
  expect(triangles.reduce((sum, t) => sum + area(t.map((v) => xy[v]!)), 0)).toBeCloseTo(polygonArea, 12);
}

describe('spread face triangulation', () => {
  it.each([false, true])('restores a boundary chain omitted by the triangulator (reverse=%s)', (reverse) => {
    const xy: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [0, 2],
    ];
    const ids = xy.map((_, i) => i);
    if (reverse) ids.reverse();
    // This triangulation covers the flat polygon exactly, but omits two
    // material vertices which must move with their adjoining crease faces.
    vi.mocked(earcut).mockReturnValueOnce([0, 3, 4].map((id) => ids.indexOf(id)));
    checkMesh(ids, xy, triangulateSpreadFace(ids, xy));
  });

  it('repairs a collinear ear without skipping its middle crease vertex', () => {
    const xy: Point[] = [
      [0, 0],
      [1, 0],
      [2, 1e-12],
      [0, 2],
    ];
    const ids = [0, 1, 2, 3];
    const triangles = triangulateSpreadFace(ids, xy);
    checkMesh(ids, xy, triangles);
    // Each subedge of the original crease is still present, and participates
    // in a well conditioned triangle reaching the opposite corner.
    for (const t of triangles) expect(area(t.map((v) => xy[v]!))).toBeGreaterThan(0.01);
  });

  it.each([false, true])('preserves chains of collinear boundary vertices (reverse=%s)', (reverse) => {
    const xy: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 2],
      [2, 2],
      [1, 2],
      [0, 2],
    ];
    const ids = xy.map((_, i) => i);
    if (reverse) ids.reverse();
    checkMesh(ids, xy, triangulateSpreadFace(ids, xy));
  });

  it('preserves the shape of a concave face with collinear boundary vertices', () => {
    const xy: Point[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [3, 3],
      [2, 3],
      [2, 1],
      [0, 1],
    ];
    const ids = xy.map((_, i) => i);
    checkMesh(ids, xy, triangulateSpreadFace(ids, xy));
  });

  it('leaves ordinary triangulations unchanged', () => {
    const xy: Point[] = [
      [0, 0],
      [2, 0],
      [2, 2],
      [1, 1],
      [0, 2],
    ];
    const ids = xy.map((_, i) => i);
    expect(triangulateSpreadFace(ids, xy).flat()).toEqual(earcut(xy.flat()));
  });

  it('does not remove a genuinely narrow original face', () => {
    const xy: Point[] = [
      [0, 0],
      [1, 0],
      [1, 1e-9],
    ];
    const ids = [0, 1, 2];
    checkMesh(ids, xy, triangulateSpreadFace(ids, xy));
  });

  it('rejects an entirely collinear face', () => {
    expect(() =>
      triangulateSpreadFace(
        [0, 1, 2],
        [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
      ),
    ).toThrow('triangulate');
  });
});
