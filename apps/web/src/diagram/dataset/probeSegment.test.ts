import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import { probeSegment } from './probeSegment';

/** Two faces of a 200-unit square split along its diagonal, and a sliver. */
const fold = {
  vertices_coords: [
    [0, 0],
    [200, 0],
    [200, 200],
    [0, 200],
    [201, 0],
  ],
  faces_vertices: [
    [0, 1, 2],
    [0, 2, 3],
    [1, 4, 2],
  ],
} as unknown as FoldDocument;

function insideTriangle(point: { x: number; y: number }, [p, q, r]: number[][]): boolean {
  const cross = (a: number[], b: number[]) => (b[0]! - a[0]!) * (point.y - a[1]!) - (b[1]! - a[1]!) * (point.x - a[0]!);
  const signs = [cross(p!, q!), cross(q!, r!), cross(r!, p!)];
  return signs.every((sign) => sign > 0) || signs.every((sign) => sign < 0);
}

describe('probeSegment', () => {
  it('draws strictly inside one of the largest faces, clear of its edges', () => {
    const segment = probeSegment(fold);
    expect(segment).not.toBeNull();
    const { a, b } = segment!;
    expect(a.y).toBe(b.y);
    expect(b.x - a.x).toBeGreaterThan(0);
    const lower = [[0, 0], [200, 0], [200, 200]];
    const upper = [[0, 0], [200, 200], [0, 200]];
    const inLower = insideTriangle(a, lower) && insideTriangle(b, lower);
    const inUpper = insideTriangle(a, upper) && insideTriangle(b, upper);
    expect(inLower || inUpper).toBe(true);
  });

  it('has nowhere to draw on a fold without faces', () => {
    expect(probeSegment({ vertices_coords: [], faces_vertices: [] } as unknown as FoldDocument)).toBeNull();
  });
});
