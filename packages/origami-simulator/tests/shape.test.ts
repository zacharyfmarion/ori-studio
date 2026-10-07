// Reading the paper's shape and putting it back (`SolverBackend.readShape` and
// `writeShape`) on the reference solver. The GPU's half runs in a browser:
// `bench:gpu-parity` holds WebglSolver to the same round trip.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { SimulationClock } from '../src/simulationClock.js';
import { createSolverShape, InvalidSolverShapeError, type SolverShape } from '../src/solverBackend.js';
import { makeBirdBase, makeBookFold, makeMiura } from '../bench/fixtures.js';
import type { FoldDocument } from '../src/types.js';

function solverFor(fold: FoldDocument, foldPercent: number) {
  const model = new OrigamiModel(prepareFoldModel(fold, { triangulate: true }));
  return { model, solver: new ReferenceSolver(model, { foldPercent }) };
}

function settle(solver: ReferenceSolver): void {
  new SimulationClock({ chunkSteps: 100 }).runToConvergence(solver, 40_000);
}

function shapeOf(model: OrigamiModel, solver: ReferenceSolver): SolverShape {
  const shape = createSolverShape(model.prepared.vertexCount, model.prepared.creaseParams.length);
  solver.readShape(shape);
  return shape;
}

function bytes(array: Float32Array): number[] {
  return Array.from(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
}

function maxDisplacement(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let node = 0; node < a.length / 3; node += 1) {
    max = Math.max(
      max,
      Math.hypot(a[node * 3]! - b[node * 3]!, a[node * 3 + 1]! - b[node * 3 + 1]!, a[node * 3 + 2]! - b[node * 3 + 2]!)
    );
  }
  return max;
}

/** The largest node displacement over `steps` steps, sampled every 50. */
function wander(model: OrigamiModel, solver: ReferenceSolver, steps: number): number {
  const start = model.positions.slice();
  let max = 0;
  for (let done = 0; done < steps; done += 50) {
    solver.step(50);
    max = Math.max(max, maxDisplacement(start, model.positions));
  }
  return max;
}

/** A bird base folded to 60% with the centre's first face pinned, then a corner pulled up and kept. */
function posedBirdBase() {
  const { model, solver } = solverFor(makeBirdBase(), 60);
  const mask = new Uint8Array(model.prepared.vertexCount);
  for (const node of [0, 4, 8]) mask[node] = 1;
  solver.setFixedNodes(mask);
  settle(solver);
  const corner = 2;
  const at: [number, number, number] = [
    model.positions[corner * 3]!,
    model.positions[corner * 3 + 1]!,
    model.positions[corner * 3 + 2]!,
  ];
  solver.beginPull({
    nodes: [corner, corner, corner],
    weights: [1, 0, 0],
    ray: { origin: [at[0] + 0.3, at[1] + 5, at[2]], direction: [0, -1, 0] },
  });
  solver.step(4000);
  solver.endPull('keep');
  settle(solver);
  return { model, solver, mask };
}

describe('readShape and writeShape (ReferenceSolver)', () => {
  it('round-trips bit for bit, posed or not, onto a solver of its own', () => {
    for (const keep of [false, true]) {
      const folded = solverFor(makeMiura(4, 4), 60);
      settle(folded.solver);
      const shape = shapeOf(folded.model, folded.solver);

      const restored = solverFor(makeMiura(4, 4), 60);
      restored.solver.writeShape(shape, keep);
      const back = shapeOf(restored.model, restored.solver);

      expect(bytes(back.offsets)).toEqual(bytes(shape.offsets));
      expect(bytes(back.theta)).toEqual(bytes(shape.theta));
      // The positions drawn are the ones the folded solver draws.
      expect(bytes(restored.model.positions)).toEqual(bytes(folded.model.positions));
      expect(restored.solver.posed).toBe(keep);
    }
  });

  it('restores an unpinned, unposed model to exactly its mesh, and it holds still', () => {
    const folded = solverFor(makeBirdBase(), 75);
    settle(folded.solver);
    const restored = solverFor(makeBirdBase(), 75);
    restored.solver.writeShape(shapeOf(folded.model, folded.solver), false);

    expect(bytes(restored.model.positions)).toEqual(bytes(folded.model.positions));
    expect(wander(restored.model, restored.solver, 3000)).toBeLessThan(1e-4);
  });

  it('holds a pinned, pulled pose still once restored and kept', () => {
    const posed = posedBirdBase();
    const shape = shapeOf(posed.model, posed.solver);

    const restored = solverFor(makeBirdBase(), 60);
    restored.solver.setFixedNodes(posed.mask);
    restored.solver.writeShape(shape, true);

    expect(restored.solver.posed).toBe(true);
    expect(bytes(restored.model.positions)).toEqual(bytes(posed.model.positions));
    expect(wander(restored.model, restored.solver, 3000)).toBeLessThan(1e-4);
    // The pins hold the positions written, bit for bit.
    for (const node of [0, 4, 8]) {
      for (let axis = 0; axis < 3; axis += 1) {
        expect(restored.model.positions[node * 3 + axis]).toBe(posed.model.positions[node * 3 + axis]);
      }
    }
  });

  it('keeps every crease of a 100% bird base on the side it started', () => {
    const folded = solverFor(makeBirdBase(), 100);
    settle(folded.solver);
    const shape = shapeOf(folded.model, folded.solver);
    // Folded shut: the valleys sit at π, where a sign is all that tells the
    // two ways to get there apart.
    expect(Math.max(...Array.from(shape.theta, Math.abs))).toBeGreaterThan(3.1);

    const restored = solverFor(makeBirdBase(), 100);
    restored.solver.writeShape(shape, false);
    restored.solver.step(3000);
    const after = shapeOf(restored.model, restored.solver);
    shape.theta.forEach((theta, crease) => {
      expect(Math.sign(after.theta[crease]!)).toBe(Math.sign(theta));
      expect(Math.abs(after.theta[crease]! - theta)).toBeLessThan(1e-3);
    });
  });

  it('needs the angle it read, not one the positions would give: the other side of π swings the long way', () => {
    // A book folded shut: its one crease at -π. The positions say the same of
    // -π and +π; only the angle the solver tracked tells them apart.
    const folded = solverFor(makeBookFold(), 100);
    settle(folded.solver);
    const shape = shapeOf(folded.model, folded.solver);
    expect(shape.theta[0]).toBeLessThan(-3);

    const kept = solverFor(makeBookFold(), 100);
    kept.solver.writeShape(shape, false);
    expect(wander(kept.model, kept.solver, 4000)).toBeLessThan(1e-4);

    const wrapped = solverFor(makeBookFold(), 100);
    wrapped.solver.writeShape({ offsets: shape.offsets, theta: shape.theta.map((theta) => theta + 2 * Math.PI) }, false);
    // Told it sits at +π with its target at -π, the crease turns all the way
    // round through flat: the leaf sweeps across the sheet.
    expect(wander(wrapped.model, wrapped.solver, 4000)).toBeGreaterThan(0.5);
  });

  it('springs back the short way round from a restored pose', () => {
    const posed = posedBirdBase();
    const shape = shapeOf(posed.model, posed.solver);
    const restored = solverFor(makeBirdBase(), 60);
    restored.solver.setFixedNodes(posed.mask);
    restored.solver.writeShape(shape, true);

    for (const { solver } of [posed, restored]) {
      solver.releasePose();
      settle(solver);
    }
    const after = shapeOf(restored.model, restored.solver);
    shape.theta.forEach((theta, crease) => expect(Math.abs(after.theta[crease]! - theta)).toBeLessThan(Math.PI / 2));
    // Back where the pose the restore came from springs back to.
    expect(maxDisplacement(restored.model.positions, posed.model.positions)).toBeLessThan(1e-3);
  });

  it('ends a pull and drops a pose before writing', () => {
    const posed = posedBirdBase();
    const shape = shapeOf(posed.model, posed.solver);
    posed.solver.beginPull({ nodes: [2, 2, 2], weights: [1, 0, 0], ray: { origin: [0, 5, 0], direction: [0, -1, 0] } });

    posed.solver.writeShape(shape, false);
    expect(posed.solver.pulling).toBe(false);
    expect(posed.solver.posed).toBe(false);
  });

  it('refuses a shape sized for another model', () => {
    const { solver } = solverFor(makeBookFold(), 0);
    const wrong = createSolverShape(5, 1);
    expect(() => solver.writeShape(wrong, false)).toThrow(InvalidSolverShapeError);
    expect(() => solver.readShape(wrong)).toThrow(InvalidSolverShapeError);
  });
});
