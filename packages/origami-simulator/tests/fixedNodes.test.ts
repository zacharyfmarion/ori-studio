// Fixed nodes: upstream Origami Simulator's `Node.setFixed`, the flag its solver
// keeps in `u_mass.y`. A fixed node keeps its position and has zero velocity,
// while the nodes around it still feel it — which is what lets a pinned face
// hold still while the rest of the paper folds around it.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { InvalidFixedNodeMaskError } from '../src/solverBackend.js';
import { makeBirdBase, makeBookFold } from '../bench/fixtures.js';
import type { FoldDocument, SimulatorOptions } from '../src/types.js';

function solverFor(fold: FoldDocument, options: SimulatorOptions = {}) {
  const model = new OrigamiModel(prepareFoldModel(fold, { triangulate: true }));
  return { model, solver: new ReferenceSolver(model, { timeStepScale: 0.35, ...options }) };
}

function maskOf(count: number, nodes: readonly number[]): Uint8Array {
  const mask = new Uint8Array(count);
  for (const node of nodes) mask[node] = 1;
  return mask;
}

/** Drive the fold the way the app plays it: small target steps, each settled a little. */
function ramp(solver: ReferenceSolver, from: number, to: number): void {
  const direction = Math.sign(to - from);
  for (let percent = from; direction > 0 ? percent <= to : percent >= to; percent += 5 * direction) {
    solver.setFoldPercent(percent);
    solver.step(150);
  }
}

function nodeOf(positions: Float32Array, node: number): number[] {
  return [positions[node * 3]!, positions[node * 3 + 1]!, positions[node * 3 + 2]!];
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
}

/** Angle between the normals of two triangles, in degrees: 0 flat, 180 folded shut. */
function normalAngle(positions: Float32Array, a: number[], b: number[]): number {
  const normal = ([i, j, k]: number[]) => {
    const p = nodeOf(positions, i!);
    const q = nodeOf(positions, j!);
    const r = nodeOf(positions, k!);
    const u = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!];
    const v = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!];
    const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const length = Math.hypot(n[0]!, n[1]!, n[2]!);
    return n.map((c) => c / length);
  };
  const na = normal(a);
  const nb = normal(b);
  const cos = na[0]! * nb[0]! + na[1]! * nb[1]! + na[2]! * nb[2]!;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

describe('fixed nodes (ReferenceSolver)', () => {
  for (const integrationType of ['euler', 'verlet'] as const) {
    it(`${integrationType}: a fixed node holds bit-identically through a fold ramp`, () => {
      const { model, solver } = solverFor(makeBirdBase(), { integrationType });
      ramp(solver, 0, 60);
      // Face [0, 4, 8]: a corner, an edge midpoint and the centre.
      const fixed = [0, 4, 8];
      solver.setFixedNodes(maskOf(model.prepared.vertexCount, fixed));
      const held = model.positions.slice();

      ramp(solver, 60, 100);
      ramp(solver, 100, 0);

      for (const node of fixed) {
        expect(nodeOf(model.positions, node)).toEqual(nodeOf(held, node));
      }
      const freeMoved = [1, 2, 3, 5, 6, 7].some(
        (node) => distance(nodeOf(model.positions, node), nodeOf(held, node)) > 1e-2
      );
      expect(freeMoved).toBe(true);
    });
  }

  it('fixing nothing changes nothing', () => {
    const untouched = solverFor(makeBirdBase(), { foldPercent: 70 });
    const released = solverFor(makeBirdBase(), { foldPercent: 70 });
    const emptyMask = solverFor(makeBirdBase(), { foldPercent: 70 });
    released.solver.setFixedNodes(null);
    emptyMask.solver.setFixedNodes(new Uint8Array(emptyMask.model.prepared.vertexCount));
    for (const { solver } of [untouched, released, emptyMask]) solver.step(400);

    expect(Array.from(released.model.positions)).toEqual(Array.from(untouched.model.positions));
    expect(Array.from(emptyMask.model.positions)).toEqual(Array.from(untouched.model.positions));
  });

  it('the rest of the paper still feels a fixed face: a book fold closes about its held half', () => {
    const { model, solver } = solverFor(makeBookFold(), { foldPercent: 50 });
    solver.setFixedNodes(maskOf(model.prepared.vertexCount, [0, 1, 2]));
    const flat = model.positions.slice();
    solver.step(6000);

    for (const node of [0, 1, 2]) {
      expect(nodeOf(model.positions, node)).toEqual(nodeOf(flat, node));
    }
    // Half of a -180° fold: the free face stands at a right angle to the held one.
    expect(normalAngle(model.positions, [0, 1, 2], [0, 2, 3])).toBeCloseTo(90, -1);
  });

  it('a fully held sheet cannot fold, and folds once released', () => {
    const { model, solver } = solverFor(makeBookFold(), { foldPercent: 80 });
    const flat = model.positions.slice();
    solver.setFixedNodes(maskOf(model.prepared.vertexCount, [0, 1, 2, 3]));
    solver.step(2000);
    expect(Array.from(model.positions)).toEqual(Array.from(flat));

    solver.setFixedNodes(null);
    solver.step(2000);

    expect(normalAngle(model.positions, [0, 1, 2], [0, 2, 3])).toBeGreaterThan(90);
  });

  it('the mask survives reset: a fixed node goes back to the flat sheet and holds it there', () => {
    const { model, solver } = solverFor(makeBookFold(), { foldPercent: 80 });
    const flat = model.positions.slice();
    solver.step(2000);
    solver.setFixedNodes(maskOf(model.prepared.vertexCount, [3]));

    solver.reset();
    expect(nodeOf(model.positions, 3)).toEqual(nodeOf(flat, 3));
    solver.step(2000);

    expect(nodeOf(model.positions, 3)).toEqual(nodeOf(flat, 3));
  });

  it('reports zero strain at a fixed node, as the GPU does', () => {
    const { model, solver } = solverFor(makeBirdBase(), { foldPercent: 100 });
    solver.step(300);
    solver.setFixedNodes(maskOf(model.prepared.vertexCount, [8]));
    solver.step(300);

    const strain = new Float32Array(model.prepared.vertexCount);
    solver.readStrain(strain);
    expect(strain[8]).toBe(0);
  });

  it('copies the mask, so a caller reusing its buffer fixes nothing new', () => {
    const { model, solver } = solverFor(makeBookFold(), { foldPercent: 80 });
    const mask = maskOf(model.prepared.vertexCount, [0]);
    solver.setFixedNodes(mask);
    mask[3] = 1;
    const before = nodeOf(model.positions, 3);
    solver.step(2000);

    expect(distance(nodeOf(model.positions, 3), before)).toBeGreaterThan(1e-2);
  });

  it('refuses a mask that does not describe the model', () => {
    const { model, solver } = solverFor(makeBookFold());
    expect(() => solver.setFixedNodes(new Uint8Array(model.prepared.vertexCount + 1))).toThrow(
      InvalidFixedNodeMaskError
    );
  });
});
