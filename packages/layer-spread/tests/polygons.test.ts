import { describe, expect, it } from 'vitest';
import { area, clean, depthPlane, edges, keepsTriangle, partitionBy, separated, triangleArea } from '../src/polygons.js';
import type { Point, Point3 } from '../src/types.js';

let seed = 11;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;

/** Triangles `clean` keeps and drops: ordinary, tiny beside their coordinates, collinear, with repeated or near-repeated corners, far from the origin. */
function triangles(count: number): [Point, Point, Point][] {
  const out: [Point, Point, Point][] = [];
  for (let i = 0; i < count; i++) {
    const offset = [0, 1e3, 1e6, -3e7][i % 4];
    const scale = [1, 1e-6, 1e-12, 1e3][Math.floor(i / 4) % 4];
    const corner = (): Point => [offset + scale * (random() - 0.5), offset + scale * (random() - 0.5)];
    const a = corner(), b = corner();
    let c = corner();
    if (i % 7 === 0) c = [a[0] + 2 * (b[0] - a[0]), a[1] + 2 * (b[1] - a[1])]; // collinear
    if (i % 11 === 0) c = [a[0], a[1]]; // repeated
    if (i % 13 === 0) c = [b[0] + 1e-14 * offset, b[1]]; // within a few ULPs of b
    out.push([a, b, c]);
  }
  return out;
}

describe('triangle fast paths', () => {
  it('keepsTriangle decides exactly as clean does', () => {
    let kept = 0, dropped = 0;
    for (const [a, b, c] of triangles(4000)) {
      const keeps = keepsTriangle(a[0], a[1], b[0], b[1], c[0], c[1]);
      const ring = clean([a, b, c]);
      expect(keeps).toBe(ring.length > 0);
      if (keeps) expect(ring).toEqual([a, b, c]);
      keeps ? kept++ : dropped++;
    }
    expect(kept).toBeGreaterThan(100);
    expect(dropped).toBeGreaterThan(100);
  });

  it('triangleArea is area to the last bit', () => {
    for (const [a, b, c] of triangles(4000)) expect(Object.is(triangleArea(a[0], a[1], b[0], b[1], c[0], c[1]), area([a, b, c]))).toBe(true);
  });

  it('depthPlane holds its corners and refuses an edge-on triangle', () => {
    const corners: Point3[] = [[1, 2, 3], [4, -1, 0.5], [-2, 6, 7]];
    const plane = depthPlane(corners)!;
    for (const [x, y, z] of corners) expect(plane.x * (x - plane.origin[0]) + plane.y * (y - plane.origin[1]) + plane.z).toBeCloseTo(z, 12);
    expect(depthPlane([[0, 0, 0], [1, 1, 1], [2, 2, 5]])).toBeNull();
  });
});

describe('separated', () => {
  /** A convex polygon: corners round a centre at sorted angles. */
  const convex = (cx: number, cy: number, r: number, corners: number): Point[] =>
    Array.from({ length: corners }, (_, k) => (2 * Math.PI * (k + random() * 0.8)) / corners).map((t): Point => [cx + r * Math.cos(t), cy + r * Math.sin(t)]);

  it('is true only where partitionBy hands the subject back whole', () => {
    let skipped = 0, whole = 0;
    for (let i = 0; i < 3000; i++) {
      const mask = convex(0, 0, 1, 3 + (i % 4));
      // Subjects all round the mask, many just touching or crossing an edge.
      const subject = convex(3 * (random() - 0.5), 3 * (random() - 0.5), 0.1 + random(), 3 + (i % 5));
      const halfplanes = edges(mask);
      const parts = partitionBy(subject, halfplanes).outside;
      const unchanged = parts.length === 1 && parts[0] === subject;
      if (separated(subject, halfplanes)) {
        expect(unchanged).toBe(true);
        skipped++;
      }
      if (unchanged) whole++;
    }
    // A good share of the subjects left whole are told apart without clipping.
    expect(skipped).toBeGreaterThan(whole / 3);
  });

  it('tells a subject beside the mask from one inside it or across its edge', () => {
    const mask: Point[] = [[0, 0], [4, 0], [4, 4], [0, 4]];
    expect(separated([[1, 1], [2, 1], [2, 2]], edges(mask))).toBe(false);
    expect(separated([[3, 1], [5, 1], [5, 2]], edges(mask))).toBe(false);
    expect(separated([[5, 1], [6, 1], [6, 2]], edges(mask))).toBe(true);
  });
});
