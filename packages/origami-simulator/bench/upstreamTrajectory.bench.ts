// Holds the WebGPU solver to the original Origami Simulator's own WebGL solver
// along the whole path of a fold, not just where it ends.
//
//   npm run bench:upstream-trajectory
//
// One browser runs the vendored upstream (third_party/origami-simulator) through
// UpstreamOracle; another runs WebgpuSolver, WebglSolver and ReferenceSolver on
// the backend benchmark page. Each starts from the same flat sheet and is read
// at the same checkpoints, from the first step to a few thousand. At every
// checkpoint the furthest any node is from upstream's position is reported, for
// each backend, and WebGPU's must stay within the parity gate's Tier C, 1e-3.
// Where our CPU reference leaves upstream's path as well, the difference is in
// the port the three backends share; it is reported, and WebGPU is held to our
// WebGL2 solver there instead.
//
// `ORI_BENCH_FIXTURES=bird-base,miura-16x16` narrows the run.
// `ORI_BENCH_CHROMIUM` points at a Chromium binary when Playwright's own is not
// installed.
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from './fixtures.js';
import { UpstreamOracle } from './upstreamOracle.js';
import type { BackendName } from './backendBench/report.js';
import type { TrajectoryRequest } from './backendBench/main.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FOLD_PERCENT = 60;
/** 0 is the flat sheet, read only to pair up the two meshes' nodes. */
const CHECKPOINTS = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const BACKENDS: BackendName[] = ['webgpu', 'webgl2', 'reference'];
/** The parity gate's Tier C (bench/gpuParity.bench.ts). */
const LIMIT = 1e-3;
const DEFAULT_FIXTURES = ['book-fold', 'bird-base', 'miura-8x8', 'miura-16x16', 'miura-32x32', 'boxpleat-24'];

const GL_ARGS = ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'];
const SOFTWARE_WEBGPU_ARGS = ['--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'];

function launchOptions(args: string[]): LaunchOptions {
  const executablePath = process.env.ORI_BENCH_CHROMIUM;
  return executablePath ? { args, executablePath } : { args };
}

/**
 * For each upstream node, ours at the same place on the flat sheet. The oracle
 * already turns upstream's sheet into our frame (`toOurFrame` in
 * upstreamOracle.ts), so on every fixture so far this is the identity; pairing
 * by place rather than by index guards against a mesh that numbers the same
 * vertices differently. Null when some node has no partner.
 */
function pairNodes(ours: ArrayLike<number>, theirs: ArrayLike<number>): Int32Array | null {
  if (ours.length !== theirs.length) return null;
  const key = (values: ArrayLike<number>, node: number) =>
    [0, 1, 2].map((axis) => Math.round(values[node * 3 + axis]! * 1e5)).join(',');
  const byPlace = new Map<string, number>();
  for (let node = 0; node < ours.length / 3; node += 1) byPlace.set(key(ours, node), node);
  const pairs = new Int32Array(theirs.length / 3);
  for (let node = 0; node < pairs.length; node += 1) {
    const partner = byPlace.get(key(theirs, node));
    if (partner === undefined) return null;
    pairs[node] = partner;
  }
  return pairs;
}

function maxAbs(ours: ArrayLike<number>, theirs: ArrayLike<number>, pairs: Int32Array): number {
  let max = 0;
  for (let node = 0; node < pairs.length; node += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = Math.abs(ours[pairs[node]! * 3 + axis]! - theirs[node * 3 + axis]!);
      // A NaN on either side is a failure, not a zero.
      if (!(delta <= max)) max = Number.isNaN(delta) ? Number.POSITIVE_INFINITY : delta;
    }
  }
  return max;
}

interface Row {
  fixture: string;
  steps: number;
  /** Per backend: furthest any node is from upstream's position; null when that backend failed. */
  deviation: Record<string, number | null>;
  /** WebGPU against our own WebglSolver, node for node: what WebGPU itself adds. */
  webgpuVsWebgl: number | null;
}

describe('trajectory against upstream', () => {
  it('follows the original solver at every checkpoint', { timeout: 1_800_000 }, async () => {
    const fixtures = (process.env.ORI_BENCH_FIXTURES ?? DEFAULT_FIXTURES.join(','))
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const oracle = await UpstreamOracle.launch();
    const server: ViteDevServer = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'error' });
    let browser: Browser | null = null;
    const rows: Row[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];
    try {
      await server.listen();
      const base = server.resolvedUrls?.local?.[0];
      if (!base) throw new Error('vite did not report a local URL');
      browser = await chromium.launch(launchOptions(GL_ARGS));
      let page = await browser.newPage();
      await page.goto(`${base}bench/backendBench/index.html`, { waitUntil: 'networkidle' });
      if (!(await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter())))) {
        await browser.close();
        browser = await chromium.launch(launchOptions([...GL_ARGS, ...SOFTWARE_WEBGPU_ARGS]));
        page = await browser.newPage();
        await page.goto(`${base}bench/backendBench/index.html`, { waitUntil: 'networkidle' });
      }
      await page.waitForFunction(() => typeof (window as unknown as { runTrajectory?: unknown }).runTrajectory === 'function');

      for (const name of fixtures) {
        const fixture = FIXTURES.find((candidate) => candidate.name === name);
        if (!fixture) throw new Error(`no fixture ${name}`);
        const upstream = await oracle.trajectory(fixture.build(), { foldPercent: FOLD_PERCENT }, CHECKPOINTS);
        const request: TrajectoryRequest = { fixture: name, backends: BACKENDS, foldPercent: FOLD_PERCENT, checkpoints: CHECKPOINTS };
        const ours = (await page.evaluate(
          (given) =>
            (window as unknown as { runTrajectory: (r: unknown) => Promise<Record<string, number[][] | { error: string }>> }).runTrajectory(given),
          request
        )) as Record<string, number[][] | { error: string }>;

        // Unpaired nodes mean the two triangulated the FOLD differently: the
        // positions are of different meshes.
        const flat = Array.isArray(ours.reference) ? ours.reference[0]! : null;
        const pairs = flat ? pairNodes(flat, upstream.positions[0]!) : null;
        if (!pairs) {
          skipped.push(`${name}: ${flat ? flat.length / 3 : '?'} nodes here, ${upstream.nodeCount} upstream, not the same sheet`);
          continue;
        }
        for (const backend of BACKENDS) {
          const path = ours[backend];
          if (path && !Array.isArray(path)) errors.push(`${name} ${backend}: ${path.error}`);
        }
        CHECKPOINTS.forEach((steps, index) => {
          if (steps === 0) return;
          const deviation: Record<string, number | null> = {};
          for (const backend of BACKENDS) {
            const path = ours[backend];
            deviation[backend] = Array.isArray(path) ? maxAbs(path[index]!, upstream.positions[index]!, pairs) : null;
          }
          const gpu = ours.webgpu;
          const gl = ours.webgl2;
          const identity = Int32Array.from({ length: pairs.length }, (_, node) => node);
          const webgpuVsWebgl = Array.isArray(gpu) && Array.isArray(gl) ? maxAbs(gpu[index]!, gl[index]!, identity) : null;
          rows.push({ fixture: name, steps, deviation, webgpuVsWebgl });
        });
      }
    } finally {
      await browser?.close();
      await server.close();
      await oracle.close();
    }

    const cell = (value: number | null) =>
      (value === null ? 'failed' : `${value.toExponential(1)}${value > LIMIT ? '!' : ''}`).padStart(10);
    const lines = [
      `Furthest any node is from upstream's position, model units; "!" past ${LIMIT}.`,
      '',
      'The last column is WebGPU against our own WebGL2 solver: what the WebGPU port itself adds.',
      '',
      `${'fixture'.padEnd(14)}${'steps'.padStart(6)}${BACKENDS.map((backend) => backend.padStart(10)).join('')}${'gpu-vs-gl'.padStart(11)}`,
      ...rows.map(
        (row) =>
          `${row.fixture.padEnd(14)}${String(row.steps).padStart(6)}` +
          `${BACKENDS.map((backend) => cell(row.deviation[backend] ?? null)).join('')} ${cell(row.webgpuVsWebgl)}`
      ),
    ];
    // Where the CPU reference leaves upstream's path too, the difference is in
    // the port all three backends share, not in WebGPU: reported, and WebGPU is
    // then held to our WebGL2 solver instead.
    const portDiffers = [...new Set(rows.filter((row) => (row.deviation.reference ?? Infinity) > LIMIT).map((row) => row.fixture))];
    if (portDiffers.length) {
      lines.push(
        '',
        `The port differs from upstream on: ${portDiffers.join(', ')}. ReferenceSolver leaves upstream's path there too,`,
        "so the difference predates WebGPU; WebGPU is held to WebglSolver on those."
      );
    }
    if (skipped.length) lines.push('', 'Skipped (topology differs from upstream):', ...skipped);
    if (errors.length) lines.push('', 'Errors:', ...errors);
    process.stdout.write(`\n${lines.join('\n')}\n\n`);

    expect(errors).toEqual([]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const label = `${row.fixture} @ ${row.steps} steps`;
      expect(row.webgpuVsWebgl, `${label}: WebGPU left WebglSolver's path`).toBeLessThan(LIMIT);
      if (!portDiffers.includes(row.fixture)) {
        expect(row.deviation.webgpu, `${label}: WebGPU left upstream's path`).toBeLessThan(LIMIT);
      }
    }
  });
});
