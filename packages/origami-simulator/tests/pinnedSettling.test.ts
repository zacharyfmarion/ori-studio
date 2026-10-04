// A pinned model has to be able to go idle.
//
// Pins hold paper far from its rest pose, and there a float32 position is too
// coarse for the smallest velocities: a node can be left with a velocity that
// cannot move it by even one representable step, so it never moves again and
// its velocity never changes. The kabuto below sits at 1.26e-5 that way, above
// the clock's 1e-5 epsilon, forever. The clock's stagnation rule is what lets
// it settle; without it the worker would step a still model indefinitely.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { SimulationClock } from '../src/simulationClock.js';
import { sourceFaceGroups } from '../src/coplanarRuns.js';
import { meshTopologyFor } from '../src/webgl/meshRenderer.js';
import type { FoldDocument } from '../src/types.js';

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/kabuto-simulation.fold');

/** Every node of the `count` largest crease-pattern faces. */
function largestFacesMask(model: OrigamiModel, count: number): Uint8Array {
  const { indices, vertexCount } = model.prepared;
  const groups = sourceFaceGroups(meshTopologyFor(model.prepared));
  const rest = model.originalPositions;
  const area = new Map<number, number>();
  for (let t = 0; t < groups.length; t += 1) {
    const [a, b, c] = [indices[t * 3]!, indices[t * 3 + 1]!, indices[t * 3 + 2]!];
    const u = [rest[b * 3]! - rest[a * 3]!, rest[b * 3 + 1]! - rest[a * 3 + 1]!, rest[b * 3 + 2]! - rest[a * 3 + 2]!];
    const v = [rest[c * 3]! - rest[a * 3]!, rest[c * 3 + 1]! - rest[a * 3 + 1]!, rest[c * 3 + 2]! - rest[a * 3 + 2]!];
    const cross = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    area.set(groups[t]!, (area.get(groups[t]!) ?? 0) + Math.hypot(cross[0]!, cross[1]!, cross[2]!) / 2);
  }
  const largest = new Set([...area].sort((x, y) => y[1] - x[1]).slice(0, count).map(([group]) => group));
  const mask = new Uint8Array(vertexCount);
  for (let t = 0; t < groups.length; t += 1) {
    if (!largest.has(groups[t]!)) continue;
    for (let corner = 0; corner < 3; corner += 1) mask[indices[t * 3 + corner]!] = 1;
  }
  return mask;
}

function ramp(solver: ReferenceSolver, from: number, to: number): void {
  const direction = Math.sign(to - from);
  for (let percent = from; direction > 0 ? percent <= to : percent >= to; percent += direction) {
    solver.setFoldPercent(percent);
    solver.step(300);
  }
}

describe('a pinned model goes idle', () => {
  it('settles once its velocity can no longer move it, though it is above epsilon', () => {
    const fold = JSON.parse(readFileSync(FIXTURE, 'utf8')) as FoldDocument;
    const model = new OrigamiModel(prepareFoldModel(fold, { triangulate: true }));
    const solver = new ReferenceSolver(model, { timeStepScale: 0.35, foldPercent: 0 });
    ramp(solver, 0, 100);
    new SimulationClock({ chunkSteps: 100 }).runToConvergence(solver, 40_000);

    // Hold the helmet's back, the two largest faces, and open the rest flat.
    solver.setFixedNodes(largestFacesMask(model, 2));
    ramp(solver, 100, 0);

    const withoutRule = new SimulationClock({ chunkSteps: 100, stagnationCeiling: 0 });
    const withRule = new SimulationClock({ chunkSteps: 100 });
    const plain = withoutRule.runToConvergence(solver, 40_000);
    const tick = withRule.runToConvergence(solver, 2_000);

    expect(plain.converged).toBe(false);
    expect(tick.converged).toBe(true);
    expect(tick.maxVelocity).toBeGreaterThan(1e-5);
    // And it really is still: settling it hides no motion.
    const settled = model.positions.slice();
    solver.step(1_000);
    expect(Array.from(model.positions)).toEqual(Array.from(settled));
  });
});
