/**
 * Writes the diagram corpus report from two sides' results. Not a test of
 * the app: `scripts/diagram-dataset/run.mjs` runs it after both sides, and
 * it skips everywhere else. Every path is outside the checkout.
 */
import { describe, expect, it } from 'vitest';
import { assertOutsideCheckout } from './datasetCorpus';
import { diffResults, summaryLine, writeReport } from './datasetReport';
import { readResults } from './datasetResults';

const BEFORE = process.env.ORI_DIAGRAM_DATASET_BEFORE;
const AFTER = process.env.ORI_DIAGRAM_DATASET_AFTER;
const REPORT = process.env.ORI_DIAGRAM_DATASET_REPORT;

describe.skipIf(!BEFORE || !AFTER || !REPORT)('the diagram corpus report', () => {
  it('writes what changed between the two sides', () => {
    const dirs = {
      before: assertOutsideCheckout(BEFORE!, 'ORI_DIAGRAM_DATASET_BEFORE'),
      after: assertOutsideCheckout(AFTER!, 'ORI_DIAGRAM_DATASET_AFTER'),
    };
    const out = assertOutsideCheckout(REPORT!, 'ORI_DIAGRAM_DATASET_REPORT');
    const model = diffResults(readResults(dirs.before), readResults(dirs.after), dirs);
    const page = writeReport(model, dirs, out);
    expect(page.startsWith(out)).toBe(true);
    process.stdout.write(`${summaryLine(model)}\n`);
  });
});
