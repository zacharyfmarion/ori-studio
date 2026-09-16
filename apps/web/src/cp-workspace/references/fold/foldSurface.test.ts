import { describe, expect, it } from 'vitest';
import {
  bendRows,
  clipCellToPolygon,
  createFoldSurface,
  createTurnOverSurface,
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
  it('is 1 on a creased stretch, 0 away from it, and eases between', () => {
    const creased = [[2, 4]] as const;
    expect(creasedness(creased, 1, 3)).toBe(1);
    expect(creasedness(creased, 1, 4)).toBe(1);
    expect(creasedness(creased, 1, 4.5)).toBeCloseTo(0.5);
    // An S-curve: flat at both ends of the ramp, steepest in the middle.
    expect(creasedness(creased, 1, 4.1)).toBeGreaterThan(0.95);
    expect(creasedness(creased, 1, 1.1)).toBeLessThan(0.05);
    expect(creasedness(creased, 1, 1.25)).toBeCloseTo(0.15625);
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

  it('lands exactly on the mirror, hovering at twice the radius, with the bend stretched to meet it', () => {
    const r = 0.5;
    const surface = createFoldSurface({ radius: r, angle: Math.PI, press: 0, creased: [], ramp: 1 });
    // Past the bend: flat at 2r, exactly where a sharp fold would land it.
    const far = surface.place(0, 4);
    expect(far.z).toBeCloseTo(2 * r);
    expect(far.v).toBeCloseTo(-4);
    expect(far.nz).toBeCloseTo(-1);
    // Where the bend ends it meets the flat part: continuous in position.
    const end = surface.place(0, Math.PI * r);
    expect(end.v).toBeCloseTo(-Math.PI * r);
    expect(end.z).toBeCloseTo(2 * r);
    // The paper leaves the hinge edge-on, rising straight up, and turns
    // over to face down by the end of the bend; it never crosses the line
    // onto the flap's own side.
    expect(surface.place(0, 1e-6).nz).toBeCloseTo(0, 3);
    expect(end.nz).toBeCloseTo(-1);
    let last = 1;
    for (const u of [0.1, 0.4, 0.8, 1.2, 1.5]) {
      const p = surface.place(0, u);
      expect(p.v).toBeLessThanOrEqual(1e-9);
      expect(p.nz).toBeLessThanOrEqual(last + 1e-9);
      last = p.nz;
    }
    expect(surface.bendReach).toBeCloseTo(Math.PI * r);
  });

  it('lands every point of the flat part where the rigid hinge would, whatever the angle', () => {
    const r = 0.5;
    for (const angle of [0.4, Math.PI / 2, 2.2, Math.PI]) {
      const surface = createFoldSurface({ radius: r, angle, press: 0, creased: [], ramp: 1 });
      const hinge = rigidHinge(angle);
      for (const u of [2, 3, 4]) {
        const a = surface.place(1, u);
        const b = hinge.place(1, u);
        // Lifted off the rigid position by the bend's own offset, which is
        // straight up at 180° and never along the flap.
        expect(a.v - b.v).toBeCloseTo(r * Math.sin(angle));
        expect(a.z - b.z).toBeCloseTo(r * (1 - Math.cos(angle)));
      }
    }
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
    // Away from it: still lifted, at the same place in the plane.
    const curled = surface.place(8, 4);
    expect(curled.z).toBeCloseTo(2 * r);
    expect(curled.v).toBeCloseTo(-4);
    // Half way up the ramp: half the radius, the S-curve's midpoint.
    const ramping = surface.place(4.5, 4);
    expect(ramping.z).toBeCloseTo(r);
    expect(surface.breakpoints()).toEqual([1, 2, 4, 5]);
  });
});

describe('createTurnOverSurface', () => {
  it('turns both sides about the line, lifted so the low side stays on the table', () => {
    const halfway = createTurnOverSurface(Math.PI / 2, 4);
    // Edge-on: everything projects onto the line, the far side four up, the near side on the table.
    expect(halfway.place(1, 4).v).toBeCloseTo(0);
    expect(halfway.place(1, 4).z).toBeCloseTo(8);
    expect(halfway.place(1, -4).z).toBeCloseTo(0);
    expect(halfway.place(1, 0).z).toBeCloseTo(4);
    expect(halfway.place(1, 2).nz).toBeCloseTo(0);
    const over = createTurnOverSurface(Math.PI, 4);
    for (const u of [-4, -1, 0, 2.5, 4]) {
      const p = over.place(0, u);
      expect(p.v).toBeCloseTo(-u);
      expect(p.z).toBeCloseTo(0);
      expect(p.nz).toBeCloseTo(-1);
    }
    expect(over.bendReach).toBe(0);
    expect(over.breakpoints()).toEqual([]);
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
  it('covers exactly the flap when flat, and exactly its mirror when folded, sharp or rounded', () => {
    const flat = createFoldSurface({ radius: 0.5, angle: 0, press: 0, creased: [], ramp: 1 });
    expect(meshArea(tessellateFlap(RECT, flat, 1).vertices)).toBeCloseTo(40);
    for (const radius of [0, 0.5]) {
      const folded = createFoldSurface({ radius, angle: Math.PI, press: 0, creased: [], ramp: 1 });
      const mesh = tessellateFlap(RECT, folded, 1);
      // The bend's stretch folds the seam back over the mirror, so the footprint is
      // the mirror's whatever the radius; a rounded bend only adds the strip it
      // rises through, counted twice by an area sum.
      expect(meshArea(mesh.vertices)).toBeGreaterThanOrEqual(40 - 1e-6);
      for (const p of mesh.vertices) {
        expect(p.v).toBeLessThanOrEqual(1e-9);
        expect(p.v).toBeGreaterThanOrEqual(-4 - 1e-9);
      }
    }
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

  it('meshes a sheet lying on both sides of its line', () => {
    const both: FlatPoint[] = [
      { s: 0, u: -3 },
      { s: 10, u: -3 },
      { s: 10, u: 4 },
      { s: 0, u: 4 },
    ];
    const surface = createTurnOverSurface(0, 4);
    expect(meshArea(tessellateFlap(both, surface, 2).vertices)).toBeCloseTo(70);
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
