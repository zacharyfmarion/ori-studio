// Compares our ReferenceSolver against the vendored upstream running its own
// GPU solver, on the shared fixture set.
//
//   npm run bench:upstream-parity
//
// This is a measurement, not a pass/fail gate: CPU and GPU float32 will not
// agree bitwise, and the point of running it is to find out *how much* they
// disagree so the Tier C threshold in the plan is derived rather than guessed.
// It requires a Chromium download (`npx playwright install chromium`).
import { describe, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { FIXTURES } from './fixtures.js';
import { UpstreamOracle } from './upstreamOracle.js';

const FOLD_PERCENT = 60;
const STEP_COUNTS = [1, 10, 100, 1000];

interface Divergence {
  fixture: string;
  steps: number;
  nodesOurs: number;
  nodesUpstream: number;
  maxAbs: number;
  meanAbs: number;
  scale: number;
  note?: string;
}

function compare(ours: Float32Array, theirs: Float32Array): { maxAbs: number; meanAbs: number; scale: number } {
  const n = Math.min(ours.length, theirs.length);
  let maxAbs = 0;
  let total = 0;
  let scale = 0;
  for (let i = 0; i < n; i += 1) {
    const delta = Math.abs(ours[i]! - theirs[i]!);
    if (delta > maxAbs) maxAbs = delta;
    total += delta;
    scale = Math.max(scale, Math.abs(theirs[i]!));
  }
  return { maxAbs, meanAbs: n ? total / n : 0, scale };
}

describe('upstream parity', () => {
  it('measures divergence between ReferenceSolver and upstream', async () => {
    const oracle = await UpstreamOracle.launch();
    const rows: Divergence[] = [];

    try {
      for (const fixture of FIXTURES) {
        // Degenerate fixtures exist to prove we do not crash; upstream makes no
        // promises about them, so comparing trajectories is meaningless.
        if (fixture.degenerate) continue;

        for (const steps of STEP_COUNTS) {
          const fold = fixture.build();
          const prepared = prepareFoldModel(structuredClone(fold), { triangulate: true });
          const model = new OrigamiModel(prepared);
          const solver = new ReferenceSolver(model, { foldPercent: FOLD_PERCENT });
          solver.step(steps);

          const upstream = await oracle.run(structuredClone(fold), {
            foldPercent: FOLD_PERCENT,
            steps,
          });

          const row: Divergence = {
            fixture: fixture.name,
            steps,
            nodesOurs: prepared.vertexCount,
            nodesUpstream: upstream.nodeCount,
            ...compare(model.positions, upstream.positions),
          };
          // A vertex-count mismatch means the two triangulated the FOLD
          // differently; position deltas are then comparing different meshes and
          // the number below is meaningless.
          if (row.nodesOurs !== row.nodesUpstream) row.note = 'TOPOLOGY MISMATCH';
          rows.push(row);
        }
      }
    } finally {
      await oracle.close();
    }

    const lines = rows.map(
      (row) =>
        `${row.fixture.padEnd(14)} steps=${String(row.steps).padStart(3)} ` +
        `v=${String(row.nodesOurs).padStart(5)}/${String(row.nodesUpstream).padEnd(5)} | ` +
        `max ${row.maxAbs.toExponential(2)}  mean ${row.meanAbs.toExponential(2)}  ` +
        `(scale ${row.scale.toFixed(3)})${row.note ? `  <-- ${row.note}` : ''}`
    );
    const comparable = rows.filter((row) => !row.note);
    const worst = comparable.reduce((max, row) => Math.max(max, row.maxAbs), 0);

    process.stdout.write(
      `\n${lines.join('\n')}\n\n` +
        `comparable rows: ${comparable.length}/${rows.length}\n` +
        `worst max-abs divergence: ${worst.toExponential(3)}\n` +
        `=> suggested Tier C threshold: ${(worst * 10).toExponential(1)}\n\n`
    );
  }, 900_000);
});
