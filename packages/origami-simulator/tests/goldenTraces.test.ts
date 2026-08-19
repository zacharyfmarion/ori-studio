// Golden traces: ReferenceSolver's exact output, committed.
//
// ReferenceSolver is the oracle, so changing its output changes the definition
// of correct. That should be possible, but never by accident -- this suite makes
// it fail loudly and requires a deliberate re-bless:
//
//   GOLDEN_WRITE=1 npx vitest run tests/goldenTraces.test.ts
//
// Traces are stored as raw float32 rather than hashes so that when one fails you
// can see *where* it diverged and by how much, which is the difference between
// "something changed" and a diagnosis.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { FIXTURES } from '../bench/fixtures.js';

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), 'golden');
const STEP_COUNTS = [1, 10, 100, 1000] as const;
const FOLD_PERCENT = 60;
const WRITE = Boolean(process.env.GOLDEN_WRITE);

/**
 * Traces are compared bit-exactly, which only holds on the machine that blessed
 * them.
 *
 * `Math.hypot`, `Math.acos` and friends are not required to be identical across
 * libm implementations, and 1000 solver steps amplify a last-ulp difference into
 * a visible one. The GitHub runner diverges from the committed traces by ~1e-18
 * on values that are themselves ~1e-17 — pure cancellation noise, not a solver
 * change. That is why wiring this package into CI turned three of these red
 * while every other suite in it passed.
 *
 * So the suite stays exactly what it was designed to be — a local, exact,
 * deliberately-re-blessed oracle — and is skipped on CI specifically. Local
 * behaviour is unchanged for everyone. Making it portable means choosing a
 * tolerance, which changes what the oracle asserts; that is a deliberate
 * decision, not something to slip in alongside a CI wiring change.
 */
const SKIP_UNPORTABLE = !WRITE && Boolean(process.env.CI);

// Large fixtures would add megabytes of binary to the repo for no extra signal:
// a solver change that alters an 81-vertex Miura alters a 6561-vertex one too.
const TRACED = FIXTURES.filter(
  (fixture) =>
    fixture.scale === 'tiny' || fixture.scale === 'small' || fixture.name === 'boxpleat-24',
);

function tracePath(name: string): string {
  return join(GOLDEN_DIR, `${name}.f32`);
}

/** Concatenated positions after each of STEP_COUNTS, in order. */
function computeTrace(fixtureName: string): Float32Array {
  const fixture = TRACED.find((f) => f.name === fixtureName)!;
  const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
  const model = new OrigamiModel(prepared);
  const solver = new ReferenceSolver(model, { foldPercent: FOLD_PERCENT });

  const chunks: Float32Array[] = [];
  let taken = 0;
  for (const target of STEP_COUNTS) {
    solver.step(target - taken);
    taken = target;
    chunks.push(model.positions.slice());
  }

  const out = new Float32Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

describe('golden traces', () => {
  if (WRITE) {
    it('rewrites every trace', () => {
      mkdirSync(GOLDEN_DIR, { recursive: true });
      for (const fixture of TRACED) {
        const trace = computeTrace(fixture.name);
        writeFileSync(tracePath(fixture.name), Buffer.from(trace.buffer, 0, trace.byteLength));
      }
      process.stdout.write(`rewrote ${TRACED.length} golden traces in ${GOLDEN_DIR}\n`);
    }, 300_000);
    return;
  }

  for (const fixture of TRACED) {
    it.skipIf(SKIP_UNPORTABLE)(
      `${fixture.name} matches its committed trace`,
      () => {
        const path = tracePath(fixture.name);
        expect(
          existsSync(path),
          `Missing golden trace for ${fixture.name}. Generate with GOLDEN_WRITE=1.`,
        ).toBe(true);

        const raw = readFileSync(path);
        const expected = new Float32Array(
          raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
        );
        const actual = computeTrace(fixture.name);

        expect(actual.length).toBe(expected.length);

        // Report the worst divergence and where, rather than just "not equal".
        let worstIndex = -1;
        let worst = 0;
        for (let i = 0; i < expected.length; i += 1) {
          const delta = Math.abs(actual[i]! - expected[i]!);
          if (delta > worst) {
            worst = delta;
            worstIndex = i;
          }
        }

        if (worst !== 0) {
          const perStep = expected.length / STEP_COUNTS.length;
          const stepIndex = Math.floor(worstIndex / perStep);
          throw new Error(
            `${fixture.name} diverged from its golden trace.\n` +
              `  worst delta ${worst.toExponential(3)} at value ${worstIndex} ` +
              `(after ${STEP_COUNTS[stepIndex]} steps, vertex ${Math.floor((worstIndex % perStep) / 3)})\n` +
              `  expected ${expected[worstIndex]}, got ${actual[worstIndex]}\n` +
              `  If this change is intended, re-bless with GOLDEN_WRITE=1.`,
          );
        }
      },
      300_000,
    );
  }
});
