#!/usr/bin/env node
// Assert a built `dist` carries the CP detector's runtime when the build flag
// was on, and none of it when the flag was off.
//
// The first deploy with `VITE_CP_DETECT=1` shipped the Detect dialog with a
// stubbed ONNX Runtime behind it: the worker's gate read the flag, the build
// config's stub plugin still read only `isProduction`, and nothing between the
// build and the first user's Detect looked at what was actually emitted. This
// does, on the same terms `scripts/verify-analytics-build.mjs` checks the
// analytics were inlined: by reading the output, not the intent.
//
//   node scripts/verify-cp-detect-build.mjs apps/web/dist
//
// Reads `VITE_CP_DETECT` from the environment the build ran with.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function verifyCpDetectBuild(dist, env = process.env) {
  const assetsDir = join(dist, 'assets');
  if (!existsSync(assetsDir)) return [`${assetsDir} does not exist — was the web app built?`];
  const assets = readdirSync(assetsDir);
  const enabled = env.VITE_CP_DETECT === '1';
  const stubs = assets.filter((name) => name.startsWith('_ori-ort-runtime-stub-'));
  const ortWasm = assets.filter((name) => /^ort-wasm-simd-threaded\.asyncify-[^/]+\.wasm$/.test(name));
  const ortEntry = assets.filter((name) => /^ort\.webgpu\.bundle\.min-[^/]+\.js$/.test(name));
  const workers = assets.filter((name) => /^cpDetectWorker-[^/]+\.js$/.test(name));
  const problems = [];

  if (enabled) {
    if (stubs.length > 0) {
      problems.push(`VITE_CP_DETECT=1 but the build stubbed ONNX Runtime: ${stubs.join(', ')}`);
    }
    if (ortWasm.length === 0) problems.push('VITE_CP_DETECT=1 but no ONNX Runtime wasm was emitted');
    if (ortEntry.length === 0) problems.push('VITE_CP_DETECT=1 but no ONNX Runtime entry chunk was emitted');
    if (workers.length === 0) {
      problems.push('VITE_CP_DETECT=1 but no detector worker chunk was emitted');
    } else {
      const worker = readFileSync(join(assetsDir, workers[0]), 'utf8');
      if (!/ort\.webgpu\.bundle\.min-/.test(worker)) {
        problems.push(`${workers[0]} does not reference the ONNX Runtime entry chunk`);
      }
    }
  } else if (ortWasm.length > 0 || ortEntry.length > 0) {
    problems.push(
      `VITE_CP_DETECT is off but ONNX Runtime was emitted: ${[...ortEntry, ...ortWasm].join(', ')}`
    );
  }

  // The service worker must never warm or precache the detector: every visitor
  // would pay for it on their first load, for a feature most never open. Its
  // manifest lists what it bypasses (`uncacheable`) and what it warms
  // (`workers`, `kernels`); the detector's files belong in the first and in
  // neither of the others.
  const sw = join(dist, 'sw.js');
  if (existsSync(sw)) {
    const text = readFileSync(sw, 'utf8');
    const list = (key) => {
      const match = text.match(new RegExp(`\\b${key}\\s*:\\s*\\[([^\\]]*)\\]`));
      return match ? match[1].match(/"[^"]+"/g)?.map((entry) => entry.slice(1, -1)) ?? [] : null;
    };
    const uncacheable = list('uncacheable');
    const warmed = [...(list('workers') ?? []), ...(list('kernels') ?? [])];
    const detector = [...ortWasm, ...ortEntry, ...workers].map((name) => `/assets/${name}`);
    if (uncacheable === null) {
      problems.push('sw.js carries no `uncacheable` list — the manifest shape changed');
    } else {
      const cacheable = detector.filter((path) => !uncacheable.includes(path));
      if (cacheable.length > 0) {
        problems.push(`sw.js does not bypass detector assets: ${cacheable.join(', ')}`);
      }
    }
    const warm = detector.filter((path) => warmed.includes(path));
    if (warm.length > 0) problems.push(`sw.js warms detector assets: ${warm.join(', ')}`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const dist = process.argv[2];
  if (!dist) {
    console.error('usage: node scripts/verify-cp-detect-build.mjs <dist>');
    process.exit(2);
  }
  const problems = verifyCpDetectBuild(dist);
  for (const problem of problems) console.error(`verify-cp-detect-build: ${problem}`);
  if (problems.length > 0) process.exit(1);
  console.log(
    `verify-cp-detect-build: ok (VITE_CP_DETECT=${process.env.VITE_CP_DETECT === '1' ? 'on' : 'off'})`
  );
}
