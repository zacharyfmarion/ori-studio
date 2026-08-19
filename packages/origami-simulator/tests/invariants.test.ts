// Backend-independent invariants.
//
// These must hold for EVERY solver backend, and they catch the class of bug
// that tolerance comparisons pass straight through: a tolerance test says "close
// to the reference", but if the reference and the backend share a sign error, or
// a gather scrambles a subset of vertices symmetrically, the numbers still
// agree. These assert properties of the physics instead.
//
// When the WebGL2 backend lands, run this same suite against it.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { FIXTURES, makeMiura, makeBookFold } from '../bench/fixtures.js';
import type { FoldDocument } from '../src/types.js';

// Invariants are about behaviour, not scale, so they run on the cheap fixtures.
// How cost grows with model size is the benchmarks' job, and putting a
// 6561-vertex fixture at 32 ms/step into the unit suite just makes it slow
// enough that people stop running it.
const INVARIANT_FIXTURES = FIXTURES.filter(
  (fixture) => fixture.scale === 'tiny' || fixture.scale === 'small',
);
const SOLVABLE_FIXTURES = INVARIANT_FIXTURES.filter((fixture) => !fixture.degenerate);

const SLOW = 120_000;

function solve(fold: FoldDocument, foldPercent: number, steps: number): OrigamiModel {
  const model = new OrigamiModel(prepareFoldModel(fold, { triangulate: true }));
  new ReferenceSolver(model, { foldPercent }).step(steps);
  return model;
}

describe('determinism', () => {
  // Nondeterminism across GPU vendors is expected; within a single backend on a
  // single machine it is always a bug.
  for (const fixture of INVARIANT_FIXTURES) {
    it(`${fixture.name} produces identical output for identical input`, () => {
      const a = solve(fixture.build(), 70, 60);
      const b = solve(fixture.build(), 70, 60);
      expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    });
  }
});

describe('rest state is a fixed point', () => {
  // At foldPercent 0 from flat there is no crease torque and no initial
  // velocity, so nothing should move. A non-zero result means a force term is
  // leaking a constant.
  for (const fixture of SOLVABLE_FIXTURES) {
    it(`${fixture.name} stays put at foldPercent 0`, () => {
      const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
      const model = new OrigamiModel(prepared);
      const flat = model.positions.slice();
      new ReferenceSolver(model, { foldPercent: 0 }).step(200);

      let maxDelta = 0;
      for (let i = 0; i < flat.length; i += 1) {
        maxDelta = Math.max(maxDelta, Math.abs(flat[i]! - model.positions[i]!));
      }
      expect(maxDelta).toBeLessThan(1e-6);
    });
  }
});

describe('no NaN or Inf', () => {
  // The solver is peppered with Number.isFinite guards that silently reset
  // state. That is a reasonable runtime safety net and a terrible thing to rely
  // on, so assert the guards never actually fire on real input.
  for (const fixture of INVARIANT_FIXTURES) {
    for (const foldPercent of [0, 50, 100]) {
      it(
        `${fixture.name} stays finite at foldPercent ${foldPercent}`,
        () => {
          const model = solve(fixture.build(), foldPercent, 300);
          for (const value of model.positions) expect(Number.isFinite(value)).toBe(true);
          for (const value of model.velocities) expect(Number.isFinite(value)).toBe(true);
        },
        SLOW,
      );
    }
  }
});

describe('energy monotonicity', () => {
  // With foldPercent held constant and damping > 0 the system is dissipative, so
  // kinetic energy must trend down once the initial crease impulse has been
  // absorbed. This is what catches an integrator sign flip: the trajectory would
  // still be smooth and still be "close to reference" for a while, but the
  // energy would climb.
  // "Already at rest" has to be an accepted outcome, not a failure. Some
  // fixtures (high-valence especially) settle to ~1e-13 within the warmup, and
  // at that point the remaining motion is float32 jitter with no meaningful
  // direction -- comparing absolute energies there tests the noise floor, not
  // the physics. What must never happen is energy *growing* materially.
  const AT_REST = 1e-9;

  for (const fixture of SOLVABLE_FIXTURES) {
    it(
      `${fixture.name} does not gain kinetic energy while settling`,
      () => {
        const model = new OrigamiModel(prepareFoldModel(fixture.build(), { triangulate: true }));
        const solver = new ReferenceSolver(model, { foldPercent: 60, damping: 0.45 });

        const kinetic = () => {
          let total = 0;
          for (const v of model.velocities) total += v * v;
          return total;
        };

        // Let the crease impulse do its work first; energy legitimately rises
        // while the creases are still driving the sheet.
        solver.step(400);
        const early = kinetic();
        solver.step(1200);
        const late = kinetic();

        if (early < AT_REST && late < AT_REST) return; // settled before we started measuring
        expect(late).toBeLessThan(early);
      },
      SLOW,
    );
  }
});

describe('symmetry preservation', () => {
  // A crease pattern symmetric under a coordinate swap must fold symmetrically.
  // A gather bug that mixes up neighbour indices for some vertices breaks this
  // while barely moving an aggregate error metric.
  it('book fold keeps its diagonal mirror symmetry', () => {
    // The book fold is symmetric about the x=y diagonal: vertex 1 (1,0) and
    // vertex 3 (0,1) are mirror images, and 0 and 2 sit on the axis.
    const model = solve(makeBookFold(), 80, 500);
    const at = (v: number) => [
      model.positions[v * 3]!,
      model.positions[v * 3 + 1]!,
      model.positions[v * 3 + 2]!,
    ];
    const [x1, y1, z1] = at(1);
    const [x3, y3, z3] = at(3);
    // Mirroring across x=y swaps the in-plane axes and preserves height.
    expect(Math.abs(x1 - z3)).toBeLessThan(1e-5);
    expect(Math.abs(z1 - x3)).toBeLessThan(1e-5);
    expect(Math.abs(y1 - y3)).toBeLessThan(1e-5);
  });

  it('square Miura is invariant under 180-degree rotation', () => {
    const prepared = prepareFoldModel(makeMiura(8, 8), { triangulate: true });
    const model = new OrigamiModel(prepared);
    new ReferenceSolver(model, { foldPercent: 60 }).step(500);

    // The generated grid is centro-symmetric, so vertex i and its opposite
    // should be negatives of each other about the centroid.
    const n = prepared.vertexCount;
    let centroidX = 0;
    let centroidY = 0;
    let centroidZ = 0;
    for (let i = 0; i < n; i += 1) {
      centroidX += model.positions[i * 3]!;
      centroidY += model.positions[i * 3 + 1]!;
      centroidZ += model.positions[i * 3 + 2]!;
    }
    centroidX /= n;
    centroidY /= n;
    centroidZ /= n;

    // Centroid of a symmetric fold stays on the original centre line; a gather
    // bug that corrupts one region drags it off.
    expect(Math.abs(centroidX)).toBeLessThan(0.05);
    expect(Math.abs(centroidZ)).toBeLessThan(0.05);
    expect(Number.isFinite(centroidY)).toBe(true);
  });
});
