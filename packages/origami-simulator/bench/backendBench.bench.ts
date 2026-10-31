// The simulator backend benchmark, headless: WebGPU, WebGL2 and the CPU
// reference solver on the same models (bench/backendBench/main.ts).
//
//   npm run bench:backends
//
// Prints the table and checks that every backend ran and that each GPU backend
// lands where the CPU reference does, within the parity gate's 1e-3. Headless
// here, both GPU APIs run on SwiftShader, a CPU emulation, so the timings say
// nothing about a real GPU; the accuracy check still means what it says. For those, open the page on real hardware:
//
//   npm run bench:backends:serve
//
// `ORI_BENCH_FIXTURES=miura-32x32,bird-base` and `ORI_BENCH_BACKENDS=webgpu,webgl2`
// narrow the run; the default is the small fixtures, which SwiftShader gets
// through in a few minutes. `ORI_BENCH_CHROMIUM` points at a Chromium binary
// when Playwright's own is not installed.
import { chromium, type Browser, type LaunchOptions } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ACCURACY_LIMIT,
  formatBackendBench,
  type BackendBenchOptions,
  type BackendBenchReport,
  type BackendName,
} from './backendBench/report.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FIXTURES = ['bird-base', 'miura-8x8', 'miura-16x16', 'miura-32x32'];

const GL_ARGS = ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader', '--enable-unsafe-webgpu'];
const SOFTWARE_WEBGPU_ARGS = ['--enable-features=Vulkan', '--use-webgpu-adapter=swiftshader'];

function launchOptions(args: string[]): LaunchOptions {
  const executablePath = process.env.ORI_BENCH_CHROMIUM;
  return executablePath ? { args, executablePath } : { args };
}

function listFromEnv(name: string): string[] | undefined {
  const parts = (process.env[name] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length ? parts : undefined;
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

describe('simulator backends', () => {
  it('runs every backend on every fixture', { timeout: 1_800_000 }, async () => {
    const server: ViteDevServer = await createServer({ root: ROOT, server: { port: 0 }, logLevel: 'error' });
    await server.listen();
    const base = server.resolvedUrls?.local?.[0];
    if (!base) throw new Error('vite did not report a local URL');
    const url = `${base}bench/backendBench/index.html`;

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch(launchOptions(GL_ARGS));
      if (!(await hasAdapter(browser, url))) {
        await browser.close();
        browser = await chromium.launch(launchOptions([...GL_ARGS, ...SOFTWARE_WEBGPU_ARGS]));
      }
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'networkidle' });
      await page.waitForFunction(
        () => typeof (window as unknown as { runBackendBench?: unknown }).runBackendBench === 'function',
        undefined,
        { timeout: 30_000 }
      );

      const options: Partial<BackendBenchOptions> = {
        fixtures: listFromEnv('ORI_BENCH_FIXTURES') ?? DEFAULT_FIXTURES,
        // Short: the point headless is that each backend runs, not its rate.
        durationMs: 1000,
        frames: 10,
        settleMaxSteps: 4000,
      };
      const backends = listFromEnv('ORI_BENCH_BACKENDS') as BackendName[] | undefined;
      if (backends) options.backends = backends;

      const report = (await page.evaluate(
        (given) =>
          (window as unknown as { runBackendBench: (o: unknown) => Promise<BackendBenchReport> }).runBackendBench(given),
        options
      )) as BackendBenchReport;
      const software = /swiftshader/i.test(`${report.webgpuAdapter} ${report.webglRenderer}`);
      process.stdout.write(
        `\n${software ? '(on SwiftShader, a CPU emulation: these timings are not GPU timings)\n' : ''}` +
          `${formatBackendBench(report)}\n\n`
      );

      expect(report.rows.length).toBeGreaterThan(0);
      for (const row of report.rows) {
        const label = `${row.fixture} ${row.backend}`;
        expect(row.error, `${label} failed`).toBeUndefined();
        expect(row.stepsPerSecond, `${label} did not step`).toBeGreaterThan(0);
        if (row.backend !== 'reference') {
          expect(row.frameMs, `${label} drew no frames`).not.toBeNull();
          expect(row.maxDeviation, `${label} diverged from the CPU reference`).toBeLessThan(ACCURACY_LIMIT);
        }
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  });
});
