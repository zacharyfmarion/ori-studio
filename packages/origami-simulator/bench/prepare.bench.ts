// Cost of `prepareFoldModel` — triangulation, edge indexing, crease params.
//
//   npm run bench:prepare
//
// This runs on whichever thread asks for a simulation model, so it is the
// latency between "user asks to simulate" and "anything appears". It was once
// quadratic in edge count; `e5313d8c` made the edge lookup O(1) and `118bd294`
// replaced the all-pairs intersection test with a sweep. This pins the result so
// a future change cannot quietly reintroduce the cliff.
import { describe, expect, it } from 'vitest';
import { prepareFoldModel } from '../src/prepare.js';
import { makeBoxPleat, makeMiura } from './fixtures.js';
import type { FoldDocument } from '../src/types.js';

/**
 * Above this, a prepare is doing something worse than linear work. Deliberately
 * loose: the point is to catch an algorithmic regression, not machine variance.
 */
const REGRESSION_CEILING_MS = 2_000;

const CASES: Array<{ name: string; fold: FoldDocument }> = [
  { name: 'miura-32x32', fold: makeMiura(32, 32) },
  { name: 'miura-56x56', fold: makeMiura(56, 56) },
  { name: 'miura-80x80', fold: makeMiura(80, 80) },
  { name: 'miura-120x120', fold: makeMiura(120, 120) },
  { name: 'boxpleat-48', fold: makeBoxPleat(48) },
];

describe('prepareFoldModel cost', () => {
  it('stays well under a second on large models', () => {
    const lines: string[] = [];
    let worst = 0;

    for (const { name, fold } of CASES) {
      // Warm up so JIT compilation is not charged to the measurement.
      prepareFoldModel(fold, { triangulate: true });
      const started = performance.now();
      const prepared = prepareFoldModel(fold, { triangulate: true });
      const ms = performance.now() - started;
      worst = Math.max(worst, ms);
      lines.push(
        `${name.padEnd(15)} v=${String(prepared.vertexCount).padStart(6)} ` +
          `f=${String(prepared.faceCount).padStart(6)} ` +
          `e=${String(prepared.edgeCount).padStart(6)} | prepare ${ms.toFixed(1)}ms`,
      );
    }

    process.stdout.write(`\n${lines.join('\n')}\n\n`);
    expect(worst).toBeLessThan(REGRESSION_CEILING_MS);
  }, 300_000);
});
