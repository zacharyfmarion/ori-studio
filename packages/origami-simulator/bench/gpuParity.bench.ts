// Browser parity gate for the GPU solver.
//
//   npm run bench:gpu-parity
//
// WebGL2 does not exist in Node, so the GPU solver can only be exercised in a
// real browser. This serves the harness page with Vite and drives it in
// headless Chromium, comparing WebglSolver against ReferenceSolver -- the local
// oracle, itself verified against upstream to 1 ULP -- on every fixture.
//
// The threshold is Tier C (1e-3), the value measured in Phase 0 for
// CPU-vs-GPU float32 divergence of this exact algorithm. A GPU pass with a
// packing or indexing bug diverges by orders of magnitude, so this cleanly
// separates "faithful" from "broken".
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'gpuParityHarness');
const TIER_C = 1e-3;
const FOLD_PERCENT = 60;
const STEP_COUNTS = [1, 10, 100];

interface GpuParityRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  steps: number;
  vertices: number;
  maxAbs: number;
  meanAbs: number;
  gpuSupported: boolean;
  error?: string;
}

interface RenderCheckRow {
  fixture: string;
  vertices: number;
  coverage: number;
  distinctColors: number;
  ok: boolean;
  strainDiffers?: boolean;
  error?: string;
}

describe('GPU solver parity', () => {
  it('matches ReferenceSolver within Tier C on every fixture', async () => {
    const packageRoot = resolve(HARNESS_ROOT, '../..');
    const server: ViteDevServer = await createServer({
      root: packageRoot,
      server: { port: 0 },
      logLevel: 'error',
    });
    await server.listen();
    const base = server.resolvedUrls?.local?.[0];
    if (!base) throw new Error('vite did not report a local URL');

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({
        args: ['--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader'],
      });
      const page = await browser.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));

      await page.goto(`${base}bench/gpuParityHarness/index.html`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => typeof (window as unknown as { runGpuParity?: unknown }).runGpuParity === 'function', undefined, {
        timeout: 30_000,
      });

      const rows = (await page.evaluate(
        ([foldPercent, stepCounts]) =>
          (window as unknown as { runGpuParity: (p: number, s: number[]) => GpuParityRow[] }).runGpuParity(
            foldPercent as number,
            stepCounts as number[]
          ),
        [FOLD_PERCENT, STEP_COUNTS] as const
      )) as GpuParityRow[];

      const lines = rows.map(
        (row) =>
          `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} steps=${String(row.steps).padStart(3)} ` +
          `v=${String(row.vertices).padStart(5)} | ` +
          (row.error
            ? `ERROR: ${row.error}`
            : `max ${row.maxAbs.toExponential(2)}  mean ${row.meanAbs.toExponential(2)}`)
      );
      process.stdout.write(`\n${lines.join('\n')}\n\n`);
      if (pageErrors.length) process.stdout.write(`page errors:\n${pageErrors.join('\n')}\n\n`);

      const supported = rows.filter((row) => row.gpuSupported && !row.error);
      expect(supported.length, `no fixtures ran on the GPU; page errors: ${pageErrors.join('; ')}`).toBeGreaterThan(0);

      const worst = supported.reduce((max, row) => Math.max(max, row.maxAbs), 0);
      process.stdout.write(`worst GPU-vs-reference divergence: ${worst.toExponential(3)} (Tier C ${TIER_C})\n\n`);

      for (const row of supported) {
        expect(row.maxAbs, `${row.fixture} ${row.integrator} @ ${row.steps} steps diverged`).toBeLessThan(TIER_C);
      }

      // Headless render coverage. Not a visual check -- it only catches shaders
      // that fail to compile/link and renders that draw nothing or one flat
      // colour. The visual result is user-verified in a visible window.
      const renderRows = (await page.evaluate(() =>
        (window as unknown as { runRenderCheck: () => RenderCheckRow[] }).runRenderCheck()
      )) as RenderCheckRow[];

      const renderLines = renderRows.map(
        (row) =>
          `${row.fixture.padEnd(14)} v=${String(row.vertices).padStart(5)} | ` +
          (row.error
            ? `ERROR: ${row.error}`
            : `coverage ${(row.coverage * 100).toFixed(1)}%  colors ${row.distinctColors}  ` +
              `strain ${row.strainDiffers ? 'differs' : 'SAME'}  ${row.ok ? 'ok' : 'FAIL'}`)
      );
      process.stdout.write(`render check:\n${renderLines.join('\n')}\n\n`);

      const renderable = renderRows.filter((row) => !row.error);
      expect(renderable.length, 'no fixtures rendered on the GPU').toBeGreaterThan(0);
      for (const row of renderable) {
        expect(row.ok, `${row.fixture} rendered an implausible frame (coverage ${row.coverage}, colors ${row.distinctColors})`).toBe(true);
        // Strain visualization must actually change the image; it used to be a stub.
        expect(row.strainDiffers, `${row.fixture} strain colour mode changed nothing`).toBe(true);
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  }, 180_000);
});
