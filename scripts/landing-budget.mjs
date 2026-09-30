#!/usr/bin/env node
// Hold the landing page's first load to a budget.
//
// The landing's entry chunk was the whole app, and it grew from 988 KB to 1,116 KB
// (brotli) in a month with nothing noticing. Since the workspace moved behind
// `apps/web/src/routing/workspaceGateway.ts` the landing loads about a quarter of that;
// this keeps it there. Deterministic, unlike Lighthouse, so it can gate CI.
//
// What counts is what the built `index.html` makes a browser fetch before anything lazy:
// the module entry and every chunk it imports statically, and the stylesheets. Sizes are
// brotli at quality 11. Cloudflare compresses at a lower level, so production transfer
// runs a little higher; the budget is about growth, not the absolute.
//
//   node scripts/landing-budget.mjs apps/web/dist
//
// Over budget is a prompt, not a ceiling — the same stance as the panel line cap in
// AGENTS.md. Either move what grew behind the gateway, or raise the number below and say
// why in the PR.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

export const BUDGET = { js: 300 * 1024, css: 40 * 1024 };

const STATIC_IMPORT = /(?:\bimport|\bexport)\s*(?:[\w$*{}\s,]*?\s*from\s*)?["'](\.\/[^"']+\.js)["']/g;

function brotliSize(bytes) {
  return brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
}

/** `/assets/x.js` → `dist/assets/x.js`, for the root-relative paths Vite writes. */
function distPath(dist, path) {
  return join(dist, path.replace(/^\//, ''));
}

/** What `index.html` loads up front: its module entry's static graph, and its stylesheets. */
export function landingFiles(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => m[1]);

  const js = new Set();
  const visit = (path) => {
    if (js.has(path)) return;
    js.add(path);
    const code = readFileSync(distPath(dist, path), 'utf8');
    const dir = path.slice(0, path.lastIndexOf('/') + 1);
    for (const match of code.matchAll(STATIC_IMPORT)) visit(dir + match[1].slice(2));
  };
  for (const path of [...entries, ...preloads]) visit(path);
  return { js: [...js], css };
}

export function landingWeight(dist) {
  const files = landingFiles(dist);
  const weigh = (paths) =>
    paths.reduce((total, path) => total + brotliSize(readFileSync(distPath(dist, path))), 0);
  return { js: weigh(files.js), css: weigh(files.css), files };
}

export function checkLandingBudget(dist, budget = BUDGET) {
  if (!existsSync(join(dist, 'index.html'))) return [`${dist}/index.html does not exist — was the web app built?`];
  const weight = landingWeight(dist);
  const problems = [];
  for (const kind of /** @type {const} */ (['js', 'css'])) {
    if (weight[kind] > budget[kind]) {
      problems.push(
        `landing ${kind.toUpperCase()} is ${kb(weight[kind])} brotli, over its ${kb(budget[kind])} budget ` +
          `(${weight.files[kind].join(', ')})`
      );
    }
  }
  return problems;
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dist = process.argv[2] ?? 'apps/web/dist';
  const problems = checkLandingBudget(dist);
  if (problems.length === 0 && existsSync(join(dist, 'index.html'))) {
    const { js, css } = landingWeight(dist);
    console.log(`landing budget: JS ${kb(js)} of ${kb(BUDGET.js)}, CSS ${kb(css)} of ${kb(BUDGET.css)} (brotli)`);
  }
  for (const problem of problems) console.error(`landing budget: ${problem}`);
  process.exit(problems.length === 0 ? 0 : 1);
}
