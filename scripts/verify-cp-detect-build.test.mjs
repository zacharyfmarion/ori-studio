import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyCpDetectBuild } from './verify-cp-detect-build.mjs';

function dist(files, sw = '') {
  const root = mkdtempSync(join(tmpdir(), 'ori-dist-'));
  mkdirSync(join(root, 'assets'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(root, 'assets', name), text);
  if (sw) writeFileSync(join(root, 'sw.js'), sw);
  return root;
}

const RUNTIME = {
  'cpDetectWorker-abc.js': 'import("./ort.webgpu.bundle.min-def.js")',
  'ort.webgpu.bundle.min-def.js': '',
  'ort-wasm-simd-threaded.asyncify-ghi.wasm': '',
};

test('a flagged build with the runtime passes', () => {
  assert.deepEqual(verifyCpDetectBuild(dist(RUNTIME), { VITE_CP_DETECT: '1' }), []);
});

test('a flagged build that stubbed the runtime fails, naming the stub', () => {
  const problems = verifyCpDetectBuild(
    dist({ 'cpDetectWorker-abc.js': 'throw', '_ori-ort-runtime-stub-xyz.js': 'throw' }),
    { VITE_CP_DETECT: '1' }
  );
  assert.ok(problems.some((p) => p.includes('_ori-ort-runtime-stub-xyz.js')));
  assert.ok(problems.some((p) => p.includes('no ONNX Runtime wasm')));
});

test('an unflagged build must not carry the runtime', () => {
  assert.deepEqual(verifyCpDetectBuild(dist({ 'cpDetectWorker-abc.js': '' }), {}), []);
  assert.equal(verifyCpDetectBuild(dist(RUNTIME), {}).length, 1);
});

const SW = (uncacheable, workers, kernels) =>
  `const manifest = { entry: "/assets/index-x.js", uncacheable: [${uncacheable}], workers: [${workers}], kernels: [${kernels}] };`;

test('a service worker that bypasses the detector and warms only the rest passes', () => {
  const sw = SW(
    '"/assets/cpDetectWorker-abc.js", "/assets/ort.webgpu.bundle.min-def.js", "/assets/ort-wasm-simd-threaded.asyncify-ghi.wasm"',
    '"/assets/otherWorker-1.js"',
    '"/assets/oristudio_cp_wasm_bg-2.wasm"'
  );
  assert.deepEqual(verifyCpDetectBuild(dist(RUNTIME, sw), { VITE_CP_DETECT: '1' }), []);
});

test('a service worker that would cache or warm the runtime fails', () => {
  const problems = verifyCpDetectBuild(
    dist(RUNTIME, SW('"/assets/cpDetectWorker-abc.js"', '', '"/assets/ort-wasm-simd-threaded.asyncify-ghi.wasm"')),
    { VITE_CP_DETECT: '1' }
  );
  assert.ok(problems.some((p) => p.includes('does not bypass detector assets')));
  assert.ok(problems.some((p) => p.includes('warms detector assets')));
});
