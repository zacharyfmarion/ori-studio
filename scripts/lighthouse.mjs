#!/usr/bin/env node
/**
 * Run Lighthouse against the landing page the way PageSpeed Insights does, several
 * times per form factor, and print the medians.
 *
 * PageSpeed's lab data is this same engine with these presets, so a local run
 * reproduces a report — which matters because the keyless PageSpeed API has no quota,
 * and one run tells you little: three desktop runs of the same build scored 70, 86 and
 * 87. PageSpeed's machines are slower than a developer's, so expect its TBT to read
 * higher than the numbers here. Too noisy to gate CI on; `landing-budget.mjs` does that.
 *
 *   node scripts/lighthouse.mjs https://oristudio.dev/      # a deploy
 *   node scripts/lighthouse.mjs --dist apps/web/dist        # a local build, served like Pages
 *   node scripts/lighthouse.mjs --runs 5 --only mobile
 *
 * `--dist` serves the build the way Cloudflare Pages does: brotli, the cross-origin
 * isolation headers, directory indexes and the SPA fallback. `vite preview` does not
 * compress, and Lighthouse would simulate downloading every byte raw.
 *
 * Needs Chrome, and network access for `npx` to fetch Lighthouse the first time.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { servePagesLike } from './lib/serve-dist.mjs';

const LIGHTHOUSE = 'lighthouse@13.5.0';

function parseArgs(argv) {
  const options = { url: null, dist: null, runs: 3, only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dist') options.dist = argv[(i += 1)];
    else if (arg === '--runs') options.runs = Number(argv[(i += 1)]);
    else if (arg === '--only') options.only = argv[(i += 1)];
    else options.url = arg;
  }
  if (!options.url && !options.dist) options.dist = 'apps/web/dist';
  return options;
}

function runLighthouse(url, formFactor, outDir, index) {
  const output = path.join(outDir, `${formFactor}-${index}`);
  const args = [
    '-y',
    LIGHTHOUSE,
    url,
    ...(formFactor === 'desktop' ? ['--preset=desktop'] : []),
    '--only-categories=performance,accessibility,best-practices,seo',
    '--output=json',
    `--output-path=${output}.json`,
    '--chrome-flags=--headless=new --no-first-run --no-default-browser-check',
    '--quiet',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn('npx', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) =>
      code === 0 ? resolve(JSON.parse(readFileSync(`${output}.json`, 'utf8'))) : reject(new Error(stderr))
    );
  });
}

function summarize(report) {
  const audit = (id) => report.audits[id]?.numericValue ?? NaN;
  const lcpNode = (report.audits['lcp-breakdown-insight']?.details?.items ?? []).find(
    (item) => item.type === 'node'
  );
  return {
    performance: Math.round((report.categories.performance.score ?? 0) * 100),
    accessibility: Math.round((report.categories.accessibility.score ?? 0) * 100),
    fcp: audit('first-contentful-paint'),
    lcp: audit('largest-contentful-paint'),
    tbt: audit('total-blocking-time'),
    cls: audit('cumulative-layout-shift'),
    si: audit('speed-index'),
    bytes: audit('total-byte-weight'),
    lcpElement: lcpNode?.nodeLabel ?? '',
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function report(formFactor, runs) {
  const pick = (key) => runs.map((run) => run[key]);
  const ms = (value) => `${(value / 1000).toFixed(2)} s`;
  console.log(`\n${formFactor} — median of ${runs.length}`);
  console.log(`  performance   ${median(pick('performance'))}   (runs: ${pick('performance').join(', ')})`);
  console.log(`  accessibility ${median(pick('accessibility'))}`);
  console.log(`  FCP ${ms(median(pick('fcp')))}   LCP ${ms(median(pick('lcp')))}   SI ${ms(median(pick('si')))}`);
  console.log(`  TBT ${Math.round(median(pick('tbt')))} ms   CLS ${median(pick('cls')).toFixed(3)}`);
  console.log(`  bytes ${(median(pick('bytes')) / 1024).toFixed(0)} KiB   LCP element: ${runs[0].lcpElement}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const served = options.dist ? await servePagesLike(path.resolve(options.dist)) : null;
  const url = served?.url ?? options.url;
  const outDir = mkdtempSync(path.join(tmpdir(), 'ori-lighthouse-'));
  console.log(`Lighthouse ${LIGHTHOUSE.split('@')[1]} against ${url}${options.dist ? ` (serving ${options.dist})` : ''}`);
  try {
    for (const formFactor of ['desktop', 'mobile']) {
      if (options.only && options.only !== formFactor) continue;
      const runs = [];
      // Sequential: parallel runs contend for the CPU and inflate TBT.
      for (let i = 0; i < options.runs; i += 1) runs.push(summarize(await runLighthouse(url, formFactor, outDir, i)));
      report(formFactor, runs);
    }
    console.log(`\nReports: ${outDir}`);
  } finally {
    await served?.close();
  }
}

await main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
