// Long-run stability sweep for the solver backends.
//
//   npm run bench:gpu-stability
//
// The parity gate (gpuParity.bench.ts) compares 1-100 steps at a *fixed* fold
// percent. The interactive simulator runs tens of thousands of steps while the
// fold target ramps, and that is the regime where a model was observed exploding
// to NaN and vanishing. This drives the same ramp on both backends so a
// GPU-specific instability is separable from one the reference solver shares.
//
// Diagnostic, not a gate: it reports where each backend first destabilizes.
import { chromium, type Browser } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'gpuParityHarness');
const FIXTURES_TO_SWEEP = ['boxpleat-24', 'high-valence', 'miura-32x32'];
const TOTAL_STEPS = 12_000;
const CHUNK = 200;
const STRAIN_LIMIT = 3;

interface StabilityRow {
  fixture: string;
  backend: 'webgl2' | 'reference';
  vertices: number;
  steps: number;
  firstBadStep: number | null;
  firstBadFoldPercent: number | null;
  firstBadKind: 'nonfinite' | 'strain' | null;
  maxStrainSeen: number;
  error?: string;
}

describe('solver long-run stability', () => {
  it('reports where each backend destabilizes under a ramping fold', async () => {
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
      await page.waitForFunction(
        () => typeof (window as unknown as { runStabilitySweep?: unknown }).runStabilitySweep === 'function',
        undefined,
        { timeout: 30_000 }
      );

      const rows = (await page.evaluate(
        ([fixtures, totalSteps, chunk, strainLimit]) =>
          (
            window as unknown as {
              runStabilitySweep: (f: string[], t: number, c: number, s: number) => StabilityRow[];
            }
          ).runStabilitySweep(
            fixtures as string[],
            totalSteps as number,
            chunk as number,
            strainLimit as number
          ),
        [FIXTURES_TO_SWEEP, TOTAL_STEPS, CHUNK, STRAIN_LIMIT] as const
      )) as StabilityRow[];

      const lines = rows.map((row) =>
        row.error
          ? `${row.fixture.padEnd(14)} ${row.backend.padEnd(10)} ERROR: ${row.error}`
          : `${row.fixture.padEnd(14)} ${row.backend.padEnd(10)} v=${String(row.vertices).padStart(5)} | ` +
            (row.firstBadStep === null
              ? `stable through ${row.steps} steps (max strain ${row.maxStrainSeen.toExponential(2)})`
              : `UNSTABLE at step ${row.firstBadStep} (fold ${row.firstBadFoldPercent?.toFixed(1)}%, ` +
                `${row.firstBadKind}, max strain ${row.maxStrainSeen.toExponential(2)})`)
      );
      process.stdout.write(`\n${lines.join('\n')}\n\n`);
      if (pageErrors.length) process.stdout.write(`page errors:\n${pageErrors.join('\n')}\n\n`);

      expect(rows.length).toBeGreaterThan(0);
    } finally {
      await browser?.close();
      await server.close();
    }
  }, 900_000);
});
