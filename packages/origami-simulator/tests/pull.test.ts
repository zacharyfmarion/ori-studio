// Pulling the paper: the grip, yielding creases, and the pose a pull keeps.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { SimulationClock } from '../src/simulationClock.js';
import {
  gripForce,
  gripParameters,
  InvalidPullGripError,
  keptRestLength,
  POSE_REST_LENGTH_TOLERANCE,
  validatedGrip,
  yieldedRest,
  type CursorRay,
  type GripParameters,
} from '../src/pull.js';
import { makeBirdBase, makeBookFold } from '../bench/fixtures.js';
import type { FoldDocument } from '../src/types.js';

type Vec3 = [number, number, number];

const PARAMETERS: GripParameters = { stiffness: 10, damping: 2, maxForce: 100, bias: 0.3 };
const DOWN: CursorRay = { origin: [0, 5, 0], direction: [0, -1, 0] };

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

describe('gripForce', () => {
  it('feels nothing along its ray: depth is the paper’s to find', () => {
    expect(length(gripForce([0, 2, 0], [0, 0, 0], DOWN, PARAMETERS))).toBeCloseTo(0, 12);
    expect(length(gripForce([0, -3, 0], [0, 7, 0], DOWN, PARAMETERS))).toBeCloseTo(0, 12);
  });

  it('pulls a point back toward the ray, and a little toward the eye', () => {
    const force = gripForce([1, 0, 0], [0, 0, 0], DOWN, PARAMETERS);
    expect(force[0]).toBeCloseTo(-10, 9);
    // The eye is up the ray: the bias lifts the point toward it.
    expect(force[1]).toBeCloseTo(0.3 * 10 * 1, 9);
    expect(force[2]).toBeCloseTo(0, 12);
  });

  it('damps motion across the ray only', () => {
    const across = gripForce([0, 0, 0], [0, 0, 2], DOWN, PARAMETERS);
    expect(across[2]).toBeCloseTo(-4, 9);
  });

  it('never pulls harder than its cap', () => {
    const force = gripForce([50, 0, 0], [0, 0, 0], DOWN, { ...PARAMETERS, maxForce: 1.2 });
    expect(length(force)).toBeCloseTo(1.2, 9);
  });
});

describe('the pull’s rules', () => {
  it('a crease keeps its rest angle until pushed past the yield, then follows', () => {
    const yieldAngle = 0.01;
    // Deviation 0.2 at the press: the crease sits at theta = rest + 0.2.
    expect(yieldedRest(1, 1.2 + 0.005, 0.2, yieldAngle)).toBe(1);
    expect(yieldedRest(1, 1.2 + 0.5, 0.2, yieldAngle)).toBeCloseTo(1.5 - yieldAngle, 12);
    expect(yieldedRest(1, 1.2 - 0.5, 0.2, yieldAngle)).toBeCloseTo(0.5 + yieldAngle, 12);
  });

  it('a kept edge stays within tolerance of the sheet', () => {
    expect(keptRestLength(1.01, 1)).toBe(1.01);
    expect(keptRestLength(1.5, 1)).toBeCloseTo(1 + POSE_REST_LENGTH_TOLERANCE, 12);
    expect(keptRestLength(0.5, 1)).toBeCloseTo(1 - POSE_REST_LENGTH_TOLERANCE, 12);
  });

  it('grips as stiff as the stiffest edge, critically damped for the point, capped by the material', () => {
    const third = 1 / 3;
    const parameters = gripParameters(20, 0.5, [third, third, third]);
    expect(parameters.stiffness).toBe(40);
    // A point between three unit masses moves like a mass of 3.
    expect(parameters.damping).toBeCloseTo(2 * Math.sqrt(40 * 3), 9);
    expect(parameters.maxForce).toBeCloseTo(1.2, 12);
  });

  it('refuses a grip that does not describe the model, and renormalises its weights', () => {
    const ray = DOWN;
    expect(() => validatedGrip({ nodes: [0, 1, 4], weights: [1, 0, 0], ray }, 4)).toThrow(InvalidPullGripError);
    expect(() => validatedGrip({ nodes: [0, 1, 2], weights: [0, 0, 0], ray }, 4)).toThrow(InvalidPullGripError);
    expect(() =>
      validatedGrip({ nodes: [0, 1, 2], weights: [1, 0, 0], ray: { origin: [0, 0, 0], direction: [0, 0, 0] } }, 4)
    ).toThrow(InvalidPullGripError);
    const grip = validatedGrip({ nodes: [0, 1, 2], weights: [2, 1, 1], ray: { origin: [0, 0, 0], direction: [0, 3, 0] } }, 4);
    expect(grip.weights).toEqual([0.5, 0.25, 0.25]);
    expect(grip.ray.direction).toEqual([0, 1, 0]);
  });
});

function solverFor(fold: FoldDocument, foldPercent = 0) {
  const model = new OrigamiModel(prepareFoldModel(fold, { triangulate: true }));
  return { model, solver: new ReferenceSolver(model, { timeStepScale: 0.35, foldPercent }) };
}

function maskOf(count: number, nodes: readonly number[]): Uint8Array {
  const mask = new Uint8Array(count);
  for (const node of nodes) mask[node] = 1;
  return mask;
}

function point(positions: Float32Array, node: number): Vec3 {
  return [positions[node * 3]!, positions[node * 3 + 1]!, positions[node * 3 + 2]!];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Angle between two triangles' normals, in degrees: 0 flat, 180 folded shut. */
function normalAngle(positions: Float32Array, a: readonly number[], b: readonly number[]): number {
  const normal = ([i, j, k]: readonly number[]) => {
    const p = point(positions, i!);
    const u = sub(point(positions, j!), p);
    const v = sub(point(positions, k!), p);
    const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    return scale(n, 1 / length(n));
  };
  const na = normal(a);
  const nb = normal(b);
  const cos = na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2];
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

function maxDisplacement(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let node = 0; node < a.length / 3; node += 1) max = Math.max(max, length(sub(point(a, node), point(b, node))));
  return max;
}

const HELD = [0, 1, 2];
const LEAF = [0, 2, 3];

/**
 * A flat book fold with one half held and a grip on the other half's centre,
 * drawn by a ray that the centre crosses when the free half stands at 90°.
 */
function bookPull() {
  const { model, solver } = solverFor(makeBookFold(), 0);
  solver.setFixedNodes(maskOf(model.prepared.vertexCount, HELD));
  const positions = model.positions;
  const hinge0 = point(positions, 0);
  const hinge = sub(point(positions, 2), hinge0);
  const axis = scale(hinge, 1 / length(hinge));
  const centre = scale(add(add(point(positions, 0), point(positions, 2)), point(positions, 3)), 1 / 3);
  const along = sub(centre, hinge0);
  const foot = add(hinge0, scale(axis, along[0] * axis[0] + along[1] * axis[1] + along[2] * axis[2]));
  const reach = length(sub(centre, foot));
  // The flat sheet's normal is world y: the 2D lift puts the paper in the XZ plane.
  const standing = add(foot, [0, reach, 0]);
  const ray: CursorRay = { origin: sub(standing, scale(axis, 5)), direction: axis };
  const grip = { nodes: [0, 2, 3] as [number, number, number], weights: [1 / 3, 1 / 3, 1 / 3] as [number, number, number], ray };
  return { model, solver, grip };
}

function settle(solver: ReferenceSolver): void {
  new SimulationClock({ chunkSteps: 100 }).runToConvergence(solver, 40_000);
}

describe('a pull (ReferenceSolver)', () => {
  it('swings the free half up, and keeps it there once let go', () => {
    const { model, solver, grip } = bookPull();
    solver.beginPull(grip);
    solver.step(6000);
    expect(normalAngle(model.positions, HELD, LEAF)).toBeCloseTo(90, -1);

    const summary = solver.endPull('keep');
    expect(summary.movedCreases).toBe(1);
    const released = model.positions.slice();
    settle(solver);

    expect(solver.posed).toBe(true);
    expect(solver.pulling).toBe(false);
    expect(maxDisplacement(model.positions, released)).toBeLessThan(5e-3);
  });

  it('holds the pinned half bit-identically throughout', () => {
    const { model, solver, grip } = bookPull();
    const held = model.positions.slice();
    solver.beginPull(grip);
    solver.step(3000);
    solver.endPull('keep');
    settle(solver);

    for (const node of HELD) expect(point(model.positions, node)).toEqual(point(held, node));
  });

  it('cancelled, it springs back to where the press found it', () => {
    const { model, solver, grip } = bookPull();
    solver.beginPull(grip);
    solver.step(6000);
    expect(normalAngle(model.positions, HELD, LEAF)).toBeGreaterThan(45);

    solver.endPull('cancel');
    settle(solver);
    expect(solver.posed).toBe(false);
    expect(normalAngle(model.positions, HELD, LEAF)).toBeLessThan(2);
  });

  it('released, the pose gives the paper back to the fold target', () => {
    const { model, solver, grip } = bookPull();
    solver.beginPull(grip);
    solver.step(6000);
    solver.endPull('keep');
    settle(solver);

    solver.releasePose();
    settle(solver);
    expect(solver.posed).toBe(false);
    expect(normalAngle(model.positions, HELD, LEAF)).toBeLessThan(2);
  });

  it('a reset ends the pull and the pose', () => {
    const { model, solver, grip } = bookPull();
    const flat = model.positions.slice();
    solver.beginPull(grip);
    solver.step(2000);
    solver.reset();

    expect(solver.pulling).toBe(false);
    expect(solver.posed).toBe(false);
    expect(Array.from(model.positions)).toEqual(Array.from(flat));
    solver.step(2000);
    expect(maxDisplacement(model.positions, flat)).toBeLessThan(1e-6);
  });

  it('a press that does not move moves nothing', () => {
    const pulled = solverFor(makeBirdBase(), 60);
    const control = solverFor(makeBirdBase(), 60);
    for (const { model, solver } of [pulled, control]) {
      solver.setFixedNodes(maskOf(model.prepared.vertexCount, [0, 4, 8]));
      settle(solver);
    }
    // The far corner's face, gripped where it is, along the line of sight.
    const nodes: [number, number, number] = [2, 6, 8];
    const at = scale(
      add(add(point(pulled.model.positions, 2), point(pulled.model.positions, 6)), point(pulled.model.positions, 8)),
      1 / 3
    );
    pulled.solver.beginPull({ nodes, weights: [1 / 3, 1 / 3, 1 / 3], ray: { origin: add(at, [0, 5, 0]), direction: [0, -1, 0] } });
    pulled.solver.step(2000);
    control.solver.step(2000);

    expect(maxDisplacement(pulled.model.positions, control.model.positions)).toBeLessThan(1e-4);
  });

  it('a new pull starts from the pose the last one kept', () => {
    const { model, solver, grip } = bookPull();
    solver.beginPull(grip);
    solver.step(6000);
    solver.endPull('keep');
    settle(solver);
    const kept = normalAngle(model.positions, HELD, LEAF);

    // Pressed and cancelled without moving: the kept pose is what comes back.
    solver.beginPull(grip);
    solver.step(500);
    solver.endPull('cancel');
    settle(solver);
    expect(solver.posed).toBe(true);
    expect(normalAngle(model.positions, HELD, LEAF)).toBeCloseTo(kept, 0);
  });
});
