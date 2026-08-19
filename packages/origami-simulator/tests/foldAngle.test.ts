// Does the simulator honour arbitrary (non-180) fold angles?
//
// Acceptance test for the claim that `edges_foldAngle` flows through `prepare.ts` into
// `CreaseParameter.targetAngle` verbatim, and that the solver relaxes the crease
// to that angle rather than to +/-180. If true, the simulator needs no work for
// non-flat creases -- the only thing missing is the angle surviving the trip out
// of the CP kernel.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import type { FoldDocument } from '../src/types.js';

/** Square with one diagonal crease, carrying an explicit fold angle. */
function bookFoldAt(angleDeg: number): FoldDocument {
  return {
    file_spec: 1.2,
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
      [0, 2],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', angleDeg < 0 ? 'M' : 'V'],
    edges_foldAngle: [null, null, null, null, angleDeg],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

function point(positions: Float32Array, i: number): [number, number, number] {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

/**
 * Signed dihedral fold angle about the crease 0-2, in degrees.
 * Flat sheet => 0. Fully folded => +/-180.
 */
function measuredFoldAngle(positions: Float32Array): number {
  const p0 = point(positions, 0);
  const p2 = point(positions, 2);
  const apexA = point(positions, 1);
  const apexB = point(positions, 3);

  const sub = (a: number[], b: number[]) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const norm = (a: number[]) => Math.hypot(a[0], a[1], a[2]);
  const unit = (a: number[]) => {
    const n = norm(a);
    return [a[0] / n, a[1] / n, a[2] / n];
  };

  const axis = unit(sub(p2, p0));
  const rejectA = sub(
    sub(apexA, p0),
    axis.map((c) => c * dot(sub(apexA, p0), axis)),
  );
  const rejectB = sub(
    sub(apexB, p0),
    axis.map((c) => c * dot(sub(apexB, p0), axis)),
  );
  const ua = unit(rejectA);
  const ub = unit(rejectB);

  // Flat => the two apex directions are antiparallel (180 deg apart).
  const between = Math.acos(Math.max(-1, Math.min(1, dot(ua, ub))));
  const magnitude = 180 - (between * 180) / Math.PI;
  // ua x ub winds opposite to the FOLD sign convention (negative = mountain),
  // because ua/ub are apex rejections rather than face normals. Negate so this
  // helper reports angles in the same convention as `edges_foldAngle`.
  const sign = -(Math.sign(dot(cross(ua, ub), axis)) || 1);
  return sign * magnitude;
}

function solveTo(angleDeg: number, steps = 4000): number {
  const model = new OrigamiModel(prepareFoldModel(bookFoldAt(angleDeg), { triangulate: true }));
  new ReferenceSolver(model, { foldPercent: 100 }).step(steps);
  return measuredFoldAngle(model.positions);
}

describe('non-180 fold angles through the simulator', () => {
  const TARGETS = [-180, -135, -90, -45, 45, 90, 135, 180];

  it('carries edges_foldAngle into CreaseParameter.targetAngle verbatim', () => {
    for (const target of TARGETS) {
      const prepared = prepareFoldModel(bookFoldAt(target), { triangulate: true });
      const crease = prepared.creaseParams.find((c) => c.targetAngle !== 0);
      expect(crease, `no driven crease for target ${target}`).toBeDefined();
      expect(crease?.targetAngle).toBe(target);
    }
  });

  it('relaxes each crease toward its own target, not to +/-180', () => {
    const rows = TARGETS.map((target) => ({ target, measured: solveTo(target) }));
    // eslint-disable-next-line no-console
    console.table(rows.map((r) => ({ ...r, error: +(r.measured - r.target).toFixed(3) })));

    for (const { target, measured } of rows) {
      expect(Math.sign(measured)).toBe(Math.sign(target));
      // Torsional springs against face/axial stiffness never fully reach the
      // target; what matters is that it tracks the target, not +/-180.
      expect(Math.abs(measured - target)).toBeLessThan(30);
    }
  });

  it('is monotone in the requested angle', () => {
    const measured = TARGETS.map((t) => solveTo(t));
    for (let i = 1; i < measured.length; i += 1) {
      expect(measured[i]).toBeGreaterThan(measured[i - 1]);
    }
  });
});
