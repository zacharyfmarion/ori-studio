// @vitest-environment jsdom
/**
 * The diagram corpus: every frozen `.osf` in the private corpus opened,
 * painted, checked and captured as the app does, and the results written for
 * the report to compare with another commit's. It records rather than
 * asserts: `scripts/diagram-dataset/run.mjs` runs it on both sides of a change
 * and the report says what changed (tests/corpus/README.md, "Diagram corpus").
 *
 * Skips without ORI_DIAGRAM_DATASET_DIR; ORI_DIAGRAM_DATASET_REQUIRED=1 makes
 * that a failure. jsdom, for the DOMParser the reader sanitizes SVG uploads
 * with, as the app's does.
 */
import '../../layer-spread/captureWorker.testSupport';
import './datasetSimulator.testSupport';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { runCase } from './datasetCase';
import { DATASET_ENV, corpusDir, datasetRequired, outputDir, selectCases, sha256 } from './datasetCorpus';
import { RESULTS_FORMAT, RESULTS_VERSION, ResultsWriter, type DatasetResults } from './datasetResults';

/** A case that runs this long is worth knowing about, but the run goes on. */
const CASE_TIMEOUT_MS = 45 * 60_000;

const DIR = corpusDir();
const selection = DIR ? selectCases(DIR) : null;

/** The bridges this side runs, by content: what a "before" ran on is part of what it says. */
function bridgeDigests(): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const name of ['oristudio-cp-wasm', 'oristudio-layer-spread-wasm']) {
    const path = resolve(process.cwd(), 'src/generated', name, `${name.replaceAll('-', '_')}_bg.wasm`);
    digests[name] = existsSync(path) ? sha256(readFileSync(path)) : 'missing';
  }
  return digests;
}

describe.skipIf(!DIR)('the diagram corpus', () => {
  let writer: ResultsWriter;
  const results: DatasetResults = {
    format: RESULTS_FORMAT,
    version: RESULTS_VERSION,
    label: process.env.ORI_DIAGRAM_DATASET_LABEL ?? 'unlabelled run',
    node: process.version,
    bridges: DIR ? bridgeDigests() : {},
    startedAt: new Date().toISOString(),
    finishedAt: '',
    corpus: { dir: DIR ?? '', manifestSha256: selection?.manifestSha256 ?? '' },
    skippedCases: selection?.skipped ?? [],
    cases: [],
  };

  beforeAll(() => {
    writer = new ResultsWriter(outputDir());
  });

  for (const kase of selection?.cases ?? []) {
    it(
      kase.slug,
      async () => {
        results.cases.push(await runCase(DIR!, kase, writer));
      },
      CASE_TIMEOUT_MS
    );
  }

  afterAll(() => {
    results.finishedAt = new Date().toISOString();
    writer.writeResults(results);
  });
});

describe.runIf(!DIR && datasetRequired())('the diagram corpus, required', () => {
  it('has a corpus folder to run', () => {
    throw new Error(`${DATASET_ENV.dir} is not set, and ${DATASET_ENV.required}=1 asks for a run`);
  });
});
