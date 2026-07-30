// Measures the CPU-optimisation ceiling: ReferenceSolver vs the unshipped
// zero-allocation prototype, on identical models.
//
//   npm run bench:cpu-ceiling
//
// This exists to keep one decision honest. The plan chose to skip a fast-JS
// solver phase and go straight to the GPU port; if that port stalls, this
// number is what tells you whether the CPU path is worth reviving. It also
// re-checks that the prototype still matches the oracle to ~1 float32 ULP, so
// the figure it reports stays trustworthy.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { FastSolver } from './fastSolverPrototype.js';
import { SCALING_FIXTURES } from './fixtures.js';

const ULP_F32 = 2 ** -23; // one float32 ULP at magnitude ~1, with headroom

describe('CPU optimisation ceiling', () => {
  it('compares ReferenceSolver against the zero-allocation prototype', () => {
    const lines: string[] = [];

    for (const fixture of SCALING_FIXTURES) {
      const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
      const steps = prepared.vertexCount > 3000 ? 40 : prepared.vertexCount > 800 ? 120 : 300;

      const referenceModel = new OrigamiModel(prepared);
      const reference = new ReferenceSolver(referenceModel, { foldPercent: 60 });
      const fastModel = new OrigamiModel(prepared);
      const fast = new FastSolver(fastModel, { foldPercent: 60 });

      reference.step(20);
      fast.step(20);

      const referenceStart = performance.now();
      reference.step(steps);
      const referenceMs = performance.now() - referenceStart;

      const fastStart = performance.now();
      fast.step(steps);
      const fastMs = performance.now() - fastStart;

      let maxDelta = 0;
      for (let i = 0; i < referenceModel.positions.length; i += 1) {
        maxDelta = Math.max(
          maxDelta,
          Math.abs(referenceModel.positions[i]! - fastModel.positions[i]!)
        );
      }

      // The whole point of the number below is that it is measured on the same
      // trajectory, so guard the equivalence rather than trusting it.
      expect(maxDelta).toBeLessThan(ULP_F32);

      lines.push(
        `${fixture.name.padEnd(14)} v=${String(prepared.vertexCount).padStart(5)} | ` +
          `reference ${(referenceMs / steps).toFixed(3)} ms/step | ` +
          `prototype ${(fastMs / steps).toFixed(3)} ms/step | ` +
          `${(referenceMs / fastMs).toFixed(1)}x | ` +
          `max delta ${maxDelta.toExponential(2)}`
      );
    }

    process.stdout.write(`\n${lines.join('\n')}\n\n`);
  }, 600_000);
});
