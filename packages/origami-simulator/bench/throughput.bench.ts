// Solver throughput benchmark.
//
//   npm run bench:sim              # measure, compare against the committed baseline
//   BENCH_WRITE_BASELINE=1 ...     # re-bless the baseline after an intentional change
//
// Run under vitest purely because it is the TypeScript runner this package
// already has; nothing here is an assertion about correctness.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { SCALING_FIXTURES, type SimulatorFixture } from './fixtures.js';

const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), 'baseline.json');

interface BenchResult {
  fixture: string;
  vertices: number;
  faces: number;
  edges: number;
  creases: number;
  msPerStep: number;
}

interface Baseline {
  /** Informational only — timings are machine-dependent. */
  recordedOn: string;
  note: string;
  results: Record<string, Omit<BenchResult, 'fixture'>>;
}

/** Steps chosen so each fixture takes a broadly similar wall-clock time. */
function stepsFor(fixture: SimulatorFixture): number {
  switch (fixture.scale) {
    case 'tiny': return 400;
    case 'small': return 200;
    case 'medium': return 100;
    case 'large': return 50;
    case 'xl': return 25;
  }
}

function measure(fixture: SimulatorFixture): BenchResult {
  const prepared = prepareFoldModel(fixture.build(), { triangulate: true });
  const model = new OrigamiModel(prepared);
  const solver = new ReferenceSolver(model, { foldPercent: 60 });

  solver.step(20); // warm the JIT
  const steps = stepsFor(fixture);
  const started = performance.now();
  solver.step(steps);
  const elapsed = performance.now() - started;

  return {
    fixture: fixture.name,
    vertices: prepared.vertexCount,
    faces: prepared.faceCount,
    edges: prepared.edgeCount,
    creases: prepared.creaseParams.length,
    msPerStep: elapsed / steps,
  };
}

function formatRow(result: BenchResult, baseline: Baseline | null): string {
  const previous = baseline?.results[result.fixture]?.msPerStep;
  const delta = previous
    ? ` (${result.msPerStep <= previous ? '' : '+'}${(((result.msPerStep - previous) / previous) * 100).toFixed(0)}% vs baseline)`
    : '';
  return (
    `${result.fixture.padEnd(14)} ` +
    `v=${String(result.vertices).padStart(5)} ` +
    `f=${String(result.faces).padStart(5)} ` +
    `creases=${String(result.creases).padStart(5)} | ` +
    `${result.msPerStep.toFixed(3)} ms/step` +
    `  100-step frame ${(result.msPerStep * 100).toFixed(0)}ms${delta}`
  );
}

describe('solver throughput', () => {
  it('measures ms/step across fixture sizes', () => {
    const baseline: Baseline | null = existsSync(BASELINE_PATH)
      ? (JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline)
      : null;

    const results = SCALING_FIXTURES.map(measure);
    process.stdout.write(`\n${results.map((r) => formatRow(r, baseline)).join('\n')}\n\n`);

    if (process.env.BENCH_WRITE_BASELINE) {
      const next: Baseline = {
        recordedOn: new Date().toISOString().slice(0, 10),
        note:
          'Timings are machine-dependent; treat large relative regressions as ' +
          'signal, absolute numbers as indicative only. Re-bless with ' +
          'BENCH_WRITE_BASELINE=1 npm run bench:sim.',
        results: Object.fromEntries(
          results.map(({ fixture, ...rest }) => [
            fixture,
            { ...rest, msPerStep: Number(rest.msPerStep.toFixed(4)) },
          ])
        ),
      };
      writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
      process.stdout.write(`wrote baseline -> ${BASELINE_PATH}\n`);
    }
  }, 600_000);
});
