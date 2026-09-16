import { describe, expect, it } from 'vitest';
import {
  bendRows,
  clipCellToPolygon,
  createFoldSurface,
  creasedness,
  rigidHinge,
  strokeCuts,
  tessellateFlap,
  type FlatPoint,
} from './foldSurface';

/** Twice the signed area of placed triangles, projected onto the paper. */
function meshArea(vertices: { s: number; v: number }[]): number {
  let area = 0;
  for (let i = 0; i + 2 < vertices.length; i += 3) {
    const [a, b, c] = [vertices[i]!, vertices[i + 1]!, vertices[i + 2]!];
    area += Math.abs((b.s - a.s) * (c.v - a.v) - (b.v - a.v) * (c.s - a.s)) / 2;
  }
  return area;
}

/** A rectangle of the flap: 10 along the line, 4 into it. */
const RECT: FlatPoint[] = [
  { s: 0, u: 0 },
  { s: 10, u: 0 },
  { s: 10, u: 4 },
  { s: 0, u: 4 },
];

describe('creasedness', () => {
  it('is 1 on a creased stretch, 0 away from it, and ramps between', () => {
    const creased = [[2, 4]] as const;
    expect(creasedness(creased, 1, 3)).toBe(1);
    expect(creasedness(creased, 1, 4)).toBe(1);
    expect(creasedness(creased, 1, 4.5)).toBeCloseTo(0.5);
    expect(creasedness(creased, 1, 1.25)).toBeCloseTo(0.25);
    expect(creasedness(creased, 1, 6)).toBe(0);
    expect(creasedness([], 1, 3)).toBe(0);
  });
});

describe('createFoldSurface', () => {
  it('is the rigid hinge exactly when the radius is zero', () => {
    for (const angle of [0, 0.7, Math.PI / 2, 2.5, Math.PI]) {
      const surface = createFoldSurface({ radius: 0, angle, press: 0.5, creased: [[1, 2]], ramp: 1 });
      const hinge = rigidHinge(angle);
      for (const [s, u] of [
        [0, 0],
        [3, 1],
        [7, 4],
      ]) {
        const a = surface.place(s, u);
        const b = hinge.place(s, u);
        expect(a.v).toBeCloseTo(b.v);
        expect(a.z).toBeCloseTo(b.z);
        expect(a.nz).toBeCloseTo(b.nz);
      }
      expect(surface.breakpoints()).toEqual([]);
    }
  });

  it('is the identity when flat', () => {
    const surface = createFoldSurface({ radius: 1, angle: 0, press: 0, creased: [], ramp: 1 });
    const p = surface.place(3, 2.5);
    expect(p.v).toBeCloseTo(2.5);
    expect(p.z).toBeCloseTo(0);
    expect(p.nz).toBeCloseTo(1);
  });

  it('lands hovering at twice the radius, short of the mirror by the bend, bulging past the line', () => {
    const r = 0.5;
    const surface = createFoldSurface({ radius: r, angle: Math.PI, press: 0, creased: [], ramp: 1 });
    // Past the bend: flat at 2r, mirrored about the line but πr short.
    const far = surface.place(0, 4);
    expect(far.z).toBeCloseTo(2 * r);
    expect(far.v).toBeCloseTo(-(4 - Math.PI * r));
    expect(far.nz).toBeCloseTo(-1);
    // Halfway round the bend: the bulge, r past the line at height r, edge-on.
    const bulge = surface.place(0, (Math.PI * r) / 2);
    expect(bulge.v).toBeCloseTo(r);
    expect(bulge.z).toBeCloseTo(r);
    expect(bulge.nz).toBeCloseTo(0);
    expect(surface.bendReach).toBeCloseTo(Math.PI * r);
  });

  it('goes sharp only where the step creases when pressed', () => {
    const r = 0.5;
    const surface = createFoldSurface({
      radius: r,
      angle: Math.PI,
      press: 1,
      creased: [[2, 4]],
      ramp: 1,
    });
    // On the crease: the rigid hinge, flat on the paper at the mirror position.
    const pressed = surface.place(3, 4);
    expect(pressed.z).toBeCloseTo(0);
    expect(pressed.v).toBeCloseTo(-4);
    // Away from it: still the curl.
    const curled = surface.place(8, 4);
    expect(curled.z).toBeCloseTo(2 * r);
    // Half way up the ramp: half the radius.
    const ramping = surface.place(4.5, 4);
    expect(ramping.z).toBeCloseTo(r);
    expect(surface.breakpoints()).toEqual([1, 2, 4, 5]);
  });
});

describe('clipCellToPolygon', () => {
  it('cuts a cell to a triangle whichever way the triangle winds', () => {
    const cell: FlatPoint[] = [
      { s: 0, u: 0 },
      { s: 2, u: 0 },
      { s: 2, u: 2 },
      { s: 0, u: 2 },
    ];
    const triangle: FlatPoint[] = [
      { s: 0, u: 0 },
      { s: 4, u: 0 },
      { s: 0, u: 4 },
    ];
    const clipped = clipCellToPolygon(cell, triangle);
    expect(clipped.map((p) => [p.s, p.u])).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ]);
    const smaller: FlatPoint[] = [
      { s: 0, u: 0 },
      { s: 2, u: 0 },
      { s: 0, u: 2 },
    ];
    const half = clipCellToPolygon(cell, smaller);
    expect(half).toHaveLength(3);
    const reversed = clipCellToPolygon(cell, [...smaller].reverse());
    expect(reversed).toHaveLength(3);
    expect(clipCellToPolygon(cell, [{ s: 5, u: 5 }, { s: 6, u: 5 }, { s: 5, u: 6 }])).toEqual([]);
  });
});

describe('tessellateFlap', () => {
  it('covers exactly the flap when flat, and exactly its mirror when folded sharp', () => {
    const flat = createFoldSurface({ radius: 0.5, angle: 0, press: 0, creased: [], ramp: 1 });
    expect(meshArea(tessellateFlap(RECT, flat, 1).vertices)).toBeCloseTo(40);
    const sharp = createFoldSurface({ radius: 0, angle: Math.PI, press: 0, creased: [], ramp: 1 });
    const mesh = tessellateFlap(RECT, sharp, 1);
    expect(meshArea(mesh.vertices)).toBeCloseTo(40);
    for (const p of mesh.vertices) expect(p.v).toBeLessThanOrEqual(1e-9);
  });

  it('samples the bend densely and the flat part once, breaking columns at the ramps', () => {
    const surface = createFoldSurface({
      radius: 0.5,
      angle: Math.PI,
      press: 1,
      creased: [[4, 6]],
      ramp: 1,
    });
    const rows = bendRows(surface, 4);
    expect(rows[0]).toBe(0);
    expect(rows[rows.length - 1]).toBe(4);
    expect(rows).toHaveLength(14);
    const mesh = tessellateFlap(RECT, surface, 2);
    // Every vertex is on the surface: over the pressed middle the far edge
    // lies flat on the paper; away from it the flap hovers at twice the radius.
    const flatMiddle = mesh.vertices.filter((p) => p.s >= 4 && p.s <= 6 && p.v < -3.5);
    expect(flatMiddle.length).toBeGreaterThan(0);
    for (const p of flatMiddle) expect(p.z).toBeCloseTo(0);
    const outside = mesh.vertices.filter((p) => p.s <= 2 || p.s >= 8);
    expect(outside.length).toBeGreaterThan(0);
    expect(Math.max(...outside.map((p) => p.z))).toBeCloseTo(1);
    for (const p of outside) expect(p.z).toBeGreaterThanOrEqual(-1e-9);
  });

  it('follows a triangular flap without spilling past its edges', () => {
    const triangle: FlatPoint[] = [
      { s: 0, u: 0 },
      { s: 10, u: 0 },
      { s: 5, u: 5 },
    ];
    const surface = createFoldSurface({ radius: 0.5, angle: 0, press: 0, creased: [], ramp: 1 });
    const mesh = tessellateFlap(triangle, surface, 1);
    expect(meshArea(mesh.vertices)).toBeCloseTo(25);
    for (const p of mesh.vertices) {
      expect(p.v).toBeLessThanOrEqual(Math.min(p.s, 10 - p.s) + 1e-9);
    }
  });
});

describe('strokeCuts', () => {
  const surface = createFoldSurface({
    radius: 0.5,
    angle: Math.PI,
    press: 1,
    creased: [[4, 6]],
    ramp: 1,
  });

  it('leaves a stroke on the flat part whole unless it crosses a ramp', () => {
    expect(strokeCuts({ s: 0, u: 3 }, { s: 2, u: 3.5 }, surface, 4)).toEqual([0, 1]);
    const cuts = strokeCuts({ s: 0, u: 3 }, { s: 8, u: 3 }, surface, 4);
    expect(cuts.map((t) => t * 8)).toEqual([0, 3, 4, 6, 7, 8]);
  });

  it('cuts a stroke through the bend at every row it crosses', () => {
    const cuts = strokeCuts({ s: 1, u: 0 }, { s: 1, u: 4 }, surface, 4);
    // The bend reaches π/2 in: twelve rows through it, plus the ends.
    expect(cuts).toHaveLength(14);
    expect(cuts[0]).toBe(0);
    expect(cuts[cuts.length - 1]).toBe(1);
    expect(cuts[1]! * 4).toBeCloseTo((Math.PI / 2) / 12);
  });
});
