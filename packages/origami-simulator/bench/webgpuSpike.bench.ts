// Parity and timing for the WebGPU spike (implementation-plans/simulator-webgpu-backend.md).
//
//   npm run bench:webgpu-spike
//
// Serves the harness page with Vite and drives it in headless Chromium. The
// kernels must match the WebGL2 solver on the same input: normals to float32
// rounding, the motion reduction bit for bit, and a non-finite node must read as
// NaN. Timings are printed, not asserted: headless, they come from SwiftShader.
//
// When the machine's GPU offers no WebGPU adapter to headless Chromium, the run
// falls back to SwiftShader's. Either way it says when the adapter is
// SwiftShader. `ORI_BENCH_CHROMIUM` points at a Chromium binary when
// Playwright's own is not installed.
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatBackend,
  formatFullStep,
  formatRender,
  formatReport,
  type BackendReport,
  type FullStepReport,
  type RenderReport,
  type SpikeReport,
} from './webgpuSpikeHarness/report.js';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'webgpuSpikeHarness');
/** Two float32 normal passes over the same input differ by a few ULP of a unit vector. */
const NORMALS_TOLERANCE = 1e-5;
/** The GPU parity gate's Tier C: float32 CPU-vs-GPU divergence of this algorithm, gpuParity.bench.ts. */
const FULL_STEP_TOLERANCE = 1e-3;
/**
 * Share of pixels with nothing like them within a pixel in the other
 * renderer's frame (render.ts differingShare). Most fixtures differ by well
 * under 1%; the densest, miura-80x80 at 128 pixels, is nearly all overlapping
 * sub-pixel crease ribbons and differs by about 2% in scattered speckle, the
 * moire of two rasterizers' coverage. A shading, depth, dash or projection
 * bug differs over whole regions, far past this.
 */
const RENDER_DIFFERS_LIMIT = 0.03;

/**
 * `ORI_BENCH_ONLY=render,solver` runs only those sections: spike, fullstep,
 * solver, render. Unset runs everything.
 */
const ONLY = (process.env.ORI_BENCH_ONLY ?? '').split(',').map((part) => part.trim()).filter(Boolean);
const runs = (section: string) => ONLY.length === 0 || ONLY.includes(section);

const GL_ARGS = ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'];
const SOFTWARE_WEBGPU_ARGS = ['--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'];

function launchOptions(args: string[]): LaunchOptions {
  const executablePath = process.env.ORI_BENCH_CHROMIUM;
  return executablePath ? { args, executablePath } : { args };
}

async function hasAdapter(browser: Browser, url: string): Promise<boolean> {
  const page = await browser.newPage();
  try {
    await page.goto(url);
    return await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()));
  } finally {
    await page.close();
  }
}

describe('WebGPU spike', () => {
  // Long: WebgpuSolver's checks settle models to rest, on a software adapter in CI.
  it('matches the WebGL2 solver on every fixture', { timeout: 1_800_000 }, async () => {
    const server: ViteDevServer = await createServer({
      root: resolve(HARNESS_ROOT, '../..'),
      server: { port: 0 },
      logLevel: 'error',
    });
    await server.listen();
    const base = server.resolvedUrls?.local?.[0];
    if (!base) throw new Error('vite did not report a local URL');
    const url = `${base}bench/webgpuSpikeHarness/index.html`;

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch(launchOptions(GL_ARGS));
      if (!(await hasAdapter(browser, url))) {
        await browser.close();
        browser = await chromium.launch(launchOptions([...GL_ARGS, ...SOFTWARE_WEBGPU_ARGS]));
      }

      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => typeof (window as unknown as { runWebgpuSpike?: unknown }).runWebgpuSpike === 'function',
        undefined,
        { timeout: 30_000 }
      );
      // SwiftShader is a CPU emulation: its timings are not GPU timings, and it cannot present a WebGPU canvas.
      const software = await page.evaluate(async () => {
        const info = (await navigator.gpu?.requestAdapter())?.info;
        return /swiftshader/i.test(`${info?.vendor ?? ''} ${info?.architecture ?? ''} ${info?.description ?? ''}`);
      });

      if (runs('spike')) {
      const report = (await page.evaluate(() =>
        (window as unknown as { runWebgpuSpike: () => Promise<SpikeReport> }).runWebgpuSpike()
      )) as SpikeReport;

      process.stdout.write(
        `\n${software ? '(WebGPU is on SwiftShader, a CPU emulation: these timings are not GPU timings)\n' : ''}` +
          `${formatReport(report)}\n\n`
      );
      if (pageErrors.length) process.stdout.write(`page errors:\n${pageErrors.join('\n')}\n\n`);

      expect(report.error, 'WebGPU did not start').toBeUndefined();
      const ran = report.rows.filter((row) => !row.error);
      expect(ran.length, `no fixture ran; ${report.rows.map((row) => row.error).join('; ')}`).toBe(report.rows.length);
      expect(ran.length).toBeGreaterThan(0);
      for (const row of ran) {
        expect(row.normalsMaxAbs, `${row.fixture} normals diverged`).toBeLessThan(NORMALS_TOLERANCE);
        expect(row.motionExact, `${row.fixture} motion reduction differs: ${JSON.stringify([row.webgl, row.webgpu])}`).toBe(
          true
        );
        expect(row.nonFiniteCaught, `${row.fixture} missed a non-finite node`).toBe(true);
      }
      }

      // A full Euler step from the WebGPU port's kernels, on the same bytes.
      if (runs('fullstep')) {
      const fullStep = (await page.evaluate(() =>
        (window as unknown as { runFullStep: () => Promise<FullStepReport> }).runFullStep()
      )) as FullStepReport;
      process.stdout.write(`${formatFullStep(fullStep)}\n\n`);
      expect(fullStep.error, 'full step did not start').toBeUndefined();
      for (const row of fullStep.rows) {
        expect(row.error, `${row.fixture} full step failed`).toBeUndefined();
        expect(row.maxAbs, `${row.fixture} full step diverged from WebglSolver`).toBeLessThan(FULL_STEP_TOLERANCE);
      }
      }

      // WebgpuSolver itself, held to the WebGL2 solver's own gate.
      if (runs('solver')) {
      const backend = (await page.evaluate(() =>
        (window as unknown as { runWebgpuBackend: () => Promise<BackendReport | { error: string }> }).runWebgpuBackend()
      )) as BackendReport | { error: string };
      if ('error' in backend) throw new Error(`WebgpuSolver checks did not start: ${backend.error}`);
      process.stdout.write(`${formatBackend(backend)}\n\n`);
      for (const row of backend.rows) {
        expect(row.error, `${row.fixture} WebgpuSolver failed`).toBeUndefined();
        for (const [steps, delta] of Object.entries(row.vsReference)) {
          expect(delta, `${row.fixture} @ ${steps} steps diverged from ReferenceSolver`).toBeLessThan(FULL_STEP_TOLERANCE);
        }
        expect(row.vsWebgl, `${row.fixture} diverged from WebglSolver`).toBeLessThan(FULL_STEP_TOLERANCE);
        expect(row.retarget, `${row.fixture} diverged after a mid-run change`).toBeLessThan(FULL_STEP_TOLERANCE);
        expect(row.resetExact, `${row.fixture} reset left the flat sheet`).toBe(true);
        expect(row.arrestStill, `${row.fixture} still moving after arrest`).toBe(true);
        // Where WebGL2 settles, WebGPU must too.
        if (row.settle.webgl !== null && row.settle.webgl >= 0) {
          expect(row.settle.gpu, `${row.fixture} never settled`).toBeGreaterThanOrEqual(0);
        }
      }
      for (const row of backend.integrators) {
        const label = `${row.fixture} ${row.integrator}${row.pinned ? ' pinned' : ''} @ ${row.steps} steps`;
        expect(row.error, `${label} failed`).toBeUndefined();
        expect(row.maxAbs, `${label} diverged from ReferenceSolver`).toBeLessThan(FULL_STEP_TOLERANCE);
        // A fixed node keeps its position bit for bit, on both integrators.
        if (row.pinned) expect(row.heldDrift, `${label} moved a fixed node`).toBe(0);
      }
      for (const row of backend.pulls) {
        const label = `${row.fixture} ${row.integrator} ${row.phase}`;
        expect(row.error, `${label} failed`).toBeUndefined();
        expect(row.maxAbs, `${label} diverged from ReferenceSolver`).toBeLessThan(FULL_STEP_TOLERANCE);
        expect(row.heldDrift, `${label} moved a fixed node`).toBe(0);
      }
      for (const row of backend.shapes) {
        const label = `${row.fixture} ${row.integrator}`;
        expect(row.error, `${label} shape check failed`).toBeUndefined();
        expect(row.roundTrip, `${label} shape did not survive a round trip`).toBe(true);
        expect(row.positionsMatch, `${label} restored positions differ`).toBe(true);
      }
      }

      // The WebGPU renderer, against the WebGL2 one's picture of the same fold.
      if (runs('render')) {
        const render = (await page.evaluate(() =>
          (window as unknown as { runWebgpuRender: () => Promise<RenderReport | { error: string }> }).runWebgpuRender()
        )) as RenderReport | { error: string };
        if ('error' in render) throw new Error(`renderer checks did not start: ${render.error}`);
        process.stdout.write(`${formatRender(render)}\n\n`);
        for (const row of render.rows) {
          expect(row.error, `${row.fixture} render failed`).toBeUndefined();
          expect(row.coverage, `${row.fixture} drew an implausible frame`).toBeGreaterThan(0.02);
          expect(row.coverage).toBeLessThan(0.99);
          for (const [mode, share] of [['paper', row.differs], ['strain', row.differsStrain], ['x-ray', row.differsXray]] as const) {
            expect(share, `${row.fixture} ${mode} frame differs from WebGL2's`).toBeLessThan(RENDER_DIFFERS_LIMIT);
          }
          expect(row.highlightTints, `${row.fixture} highlight tinted nothing`).toBe(true);
          expect(row.highlightOnlyWhenAsked, `${row.fixture} highlight leaked into an unasked frame`).toBe(true);
        }
        // SwiftShader loses the device on presenting any WebGPU canvas, so this is held on real hardware only.
        if (!software) expect(render.canvas.presents, `the canvas presented a blank frame: ${render.canvas.error ?? ''}`).toBe(true);
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  });
});
