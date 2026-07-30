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
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'gpuParityHarness');
const FIXTURES_TO_SWEEP: string[] = [];
// Real imported geometry (an Oriedita .ori crease-pattern segment) that was
// observed exploding to NaN in the app while the synthetic fixtures stayed
// stable. Kept as a regression fixture so the case cannot silently return.
const REAL_FOLD_FIXTURES = ['lamprey-segment'] as const;
const TOTAL_STEPS = 12_000;
const CHUNK = 200;
const STRAIN_LIMIT = 3;
const TIME_STEP_SCALES = [1, 0.5, 0.35];
const INTEGRATORS = ['euler', 'verlet'] as const;
const FINE_FROM = Number.POSITIVE_INFINITY;

interface StabilityRow {
  fixture: string;
  backend: 'webgl2' | 'reference';
  vertices: number;
  steps: number;
  firstBadStep: number | null;
  firstBadFoldPercent: number | null;
  firstBadKind: 'nonfinite' | 'strain' | null;
  maxStrainSeen: number;
  integrator?: 'euler' | 'verlet';
  firstBadTexture?: string;
  firstBadTextureStep?: number;
  maxAbsPositionAtFailure?: number;
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

      const extraFolds: Record<string, unknown> = {};
      for (const name of REAL_FOLD_FIXTURES) {
        extraFolds[name] = JSON.parse(
          readFileSync(resolve(HARNESS_ROOT, `../fixtures/${name}.fold`), 'utf8')
        );
      }

      const allRows: StabilityRow[] = [];
      for (const scale of TIME_STEP_SCALES) {
      for (const integrator of INTEGRATORS) {
      const rows = (await page.evaluate(
        ([fixtures, totalSteps, chunk, strainLimit, folds, ts, ff, it]) =>
          (
            window as unknown as {
              runStabilitySweep: (
                f: string[],
                t: number,
                c: number,
                s: number,
                x: Record<string, unknown>,
                ts: number,
                ff: number,
                it: 'euler' | 'verlet'
              ) => StabilityRow[];
            }
          ).runStabilitySweep(
            fixtures as string[],
            totalSteps as number,
            chunk as number,
            strainLimit as number,
            folds as Record<string, unknown>,
            ts as number,
            ff as number,
            it as 'euler' | 'verlet'
          ),
        [FIXTURES_TO_SWEEP, TOTAL_STEPS, CHUNK, STRAIN_LIMIT, extraFolds, scale, FINE_FROM, integrator] as const
      )) as StabilityRow[];
      allRows.push(...rows);
      }
      }
      const rows = allRows;

      const lines = rows.map((row) =>
        row.error
          ? `${row.fixture.padEnd(14)} ${row.backend.padEnd(10)} ERROR: ${row.error}`
          : `${row.fixture.padEnd(16)} ${row.backend.padEnd(10)} ${(row.integrator ?? '').padEnd(6)} ts=${String(row.timeStepScale).padEnd(5)} | ` +
            (row.firstBadStep === null
              ? `stable through ${row.steps} steps (max strain ${row.maxStrainSeen.toExponential(2)})`
              : `UNSTABLE at step ${row.firstBadStep} (fold ${row.firstBadFoldPercent?.toFixed(1)}%, ` +
                `${row.firstBadKind}, max strain ${row.maxStrainSeen.toExponential(2)}, ` +
                `bad=${row.firstBadTexture ?? 'n/a'}@${row.firstBadTextureStep ?? '-'} maxPos=${row.maxAbsPositionAtFailure?.toExponential(2) ?? '-'})`)
      );
      process.stdout.write(`\n${lines.join('\n')}\n\n`);
      if (pageErrors.length) process.stdout.write(`page errors:\n${pageErrors.join('\n')}\n\n`);

      expect(rows.length).toBeGreaterThan(0);

      // Regression gate. A *strain* instability is physical and shared with the
      // CPU reference, but the GPU backend must never go non-finite: that was a
      // missing acos clamp (and friends) in the shaders, which made real crease
      // patterns NaN out and vanish while the CPU solved them fine.
      for (const row of rows.filter((r) => r.backend === 'webgl2' && !r.error)) {
        expect(row.firstBadKind, `${row.fixture} went non-finite on the GPU`).not.toBe('nonfinite');
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  }, 900_000);
});
