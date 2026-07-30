// Phase 0.4 spike: is the crease-angle 2pi unwrap safe to port to the GPU?
//
//   npm run bench:unwrap-spike
//
// thetaCalc accumulates the dihedral angle across steps and unwraps branch
// crossings:
//
//     let diff = theta - lastTheta;
//     if (diff < -5) diff += TWO_PI; else if (diff > 5) diff -= TWO_PI;
//
// `theta` comes from atan2, whose last bits differ between vendors. If a
// disagreement lands either side of that +/-5 rad boundary, one implementation
// adds a full turn and the other does not, and the crease flips by 2pi. That is
// a *visible catastrophic* divergence, not a numerical one -- which is why the
// plan gates the whole WebGL2 port on this.
//
// The signature to look for: divergence of order the moment arm (~1e0), versus
// the ~1e-5 float32 noise floor established by bench:upstream-parity. This runs
// the cases most likely to trigger it -- fully-folded creases whose target
// angles sit at +/-180 degrees, i.e. theta pinned at the +/-pi branch cut --
// over long horizons.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { FIXTURES } from './fixtures.js';
import { UpstreamOracle } from './upstreamOracle.js';

/** Anything at or above this is a 2pi flip, not float32 noise. */
const CATASTROPHE = 1e-2;
/** Tier C, derived from this spike's own 1.30e-4 worst case. See the plan. */
const TIER_C = 1e-3;

// Fully folded is the dangerous case: targetAngle -180 puts theta exactly on the
// branch cut. 99% sits just off it, which is where an unwrap that is off by one
// step shows up as a slow drift rather than a jump.
const FOLD_PERCENTS = [100, 99, 80];
const STEPS = [200, 1000];

describe('thetaCalc 2pi unwrap spike', () => {
  it('does not flip creases by a full turn near the branch cut', async () => {
    const oracle = await UpstreamOracle.launch();
    const rows: string[] = [];
    let worst = 0;
    let worstLabel = '';

    try {
      for (const fixture of FIXTURES) {
        if (fixture.degenerate) continue;
        for (const foldPercent of FOLD_PERCENTS) {
          for (const steps of STEPS) {
            const fold = fixture.build();
            const prepared = prepareFoldModel(structuredClone(fold), { triangulate: true });
            const model = new OrigamiModel(prepared);
            new ReferenceSolver(model, { foldPercent }).step(steps);

            const upstream = await oracle.run(structuredClone(fold), { foldPercent, steps });
            if (prepared.vertexCount !== upstream.nodeCount) continue;

            let maxAbs = 0;
            for (let i = 0; i < model.positions.length; i += 1) {
              maxAbs = Math.max(maxAbs, Math.abs(model.positions[i]! - upstream.positions[i]!));
            }

            const label = `${fixture.name} fold=${foldPercent}% steps=${steps}`;
            if (maxAbs > worst) {
              worst = maxAbs;
              worstLabel = label;
            }
            const flag = maxAbs >= CATASTROPHE ? '  <-- CATASTROPHIC' : maxAbs > TIER_C ? '  <-- over Tier C' : '';
            rows.push(`${label.padEnd(34)} max ${maxAbs.toExponential(2)}${flag}`);
          }
        }
      }
    } finally {
      await oracle.close();
    }

    process.stdout.write(
      `\n${rows.join('\n')}\n\n` +
        `worst: ${worst.toExponential(3)} (${worstLabel})\n` +
        `catastrophe threshold: ${CATASTROPHE.toExponential(0)}  |  Tier C: ${TIER_C.toExponential(0)}\n` +
        `verdict: ${worst >= CATASTROPHE ? 'UNWRAP IS FRAGILE -- do not port as-is' : 'unwrap is stable on this GPU'}\n\n`
    );

    // The gate. A 2pi flip is a correctness failure, not a tolerance question.
    expect(worst).toBeLessThan(CATASTROPHE);
  }, 1_800_000);
});
