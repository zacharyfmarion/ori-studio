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
import { POSE_REST_LENGTH_TOLERANCE } from '../src/pull.js';

const HARNESS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), 'gpuParityHarness');
const TIER_C = 1e-3;
const FOLD_PERCENT = 60;
const STEP_COUNTS = [1, 10, 100];
/** How far a restored settled shape may move in 400 steps: the reference's own bound, in `tests/shape.test.ts`. */
const SHAPE_STILL = 1e-4;

interface GpuParityRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  pinned: boolean;
  heldDrift?: number;
  steps: number;
  vertices: number;
  maxAbs: number;
  meanAbs: number;
  gpuSupported: boolean;
  error?: string;
}

interface PullParityRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  phase: 'pulling' | 'kept' | 'cancelled' | 'released';
  maxAbs: number;
  heldDrift: number;
  movedCreases?: { reference: number; gpu: number };
  error?: string;
}

interface ShapeCheckRow {
  fixture: string;
  integrator: 'euler' | 'verlet';
  vertices: number;
  creases: number;
  roundTrip: boolean;
  positionsMatch: boolean;
  heldStill?: { free: number; kept: number };
  sidesKept?: boolean;
  stretch?: number;
  readShapeMs: number;
  writeShapeMs: number;
  readPositionsMs: number;
  error?: string;
}

interface RenderCheckRow {
  fixture: string;
  vertices: number;
  coverage: number;
  distinctColors: number;
  ok: boolean;
  strainDiffers?: boolean;
  highlightDiffers?: boolean;
  highlightAbsentUnasked?: boolean;
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
          `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ${row.pinned ? 'pinned' : '      '} steps=${String(row.steps).padStart(3)} ` +
          `v=${String(row.vertices).padStart(5)} | ` +
          (row.error
            ? `ERROR: ${row.error}`
            : `max ${row.maxAbs.toExponential(2)}  mean ${row.meanAbs.toExponential(2)}` +
              (row.pinned ? `  held drift ${(row.heldDrift ?? Number.NaN).toExponential(2)}` : ''))
      );
      process.stdout.write(`\n${lines.join('\n')}\n\n`);
      if (pageErrors.length) process.stdout.write(`page errors:\n${pageErrors.join('\n')}\n\n`);

      const supported = rows.filter((row) => row.gpuSupported && !row.error);
      expect(supported.length, `no fixtures ran on the GPU; page errors: ${pageErrors.join('; ')}`).toBeGreaterThan(0);

      const worst = supported.reduce((max, row) => Math.max(max, row.maxAbs), 0);
      process.stdout.write(`worst GPU-vs-reference divergence: ${worst.toExponential(3)} (Tier C ${TIER_C})\n\n`);

      for (const row of supported) {
        const label = `${row.fixture} ${row.integrator}${row.pinned ? ' pinned' : ''} @ ${row.steps} steps`;
        expect(row.maxAbs, `${label} diverged`).toBeLessThan(TIER_C);
        // A fixed node keeps its position bit for bit: the fixed branch writes the
        // last position back unchanged, on both integrators.
        if (row.pinned) expect(row.heldDrift, `${label} moved a fixed node`).toBe(0);
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
              `strain ${row.strainDiffers ? 'differs' : 'SAME'}  ` +
              `highlight ${row.highlightDiffers ? 'tints' : 'NONE'}/${row.highlightAbsentUnasked ? 'clean' : 'LEAKS'}  ` +
              `${row.ok ? 'ok' : 'FAIL'}`)
      );
      process.stdout.write(`render check:\n${renderLines.join('\n')}\n\n`);

      const renderable = renderRows.filter((row) => !row.error);
      expect(renderable.length, 'no fixtures rendered on the GPU').toBeGreaterThan(0);
      for (const row of renderable) {
        expect(row.ok, `${row.fixture} rendered an implausible frame (coverage ${row.coverage}, colors ${row.distinctColors})`).toBe(true);
        // Strain visualization must actually change the image; it used to be a stub.
        expect(row.strainDiffers, `${row.fixture} strain colour mode changed nothing`).toBe(true);
        expect(row.highlightDiffers, `${row.fixture} highlight pass tinted nothing`).toBe(true);
        expect(row.highlightAbsentUnasked, `${row.fixture} highlight leaked into an unasked frame`).toBe(true);
      }

      // A scripted pull — grip, keep, pull and cancel, drop the pose — run on
      // both backends: the pose and the grip live in shaders the parity rows
      // above never switch on.
      const pullRows = (await page.evaluate(
        (foldPercent) =>
          (window as unknown as { runPullParity: (p: number) => PullParityRow[] }).runPullParity(foldPercent as number),
        FOLD_PERCENT
      )) as PullParityRow[];
      const pullLines = pullRows.map(
        (row) =>
          `${row.fixture.padEnd(14)} ${row.integrator.padEnd(6)} ${row.phase.padEnd(9)} | ` +
          (row.error
            ? `ERROR: ${row.error}`
            : `max ${row.maxAbs.toExponential(2)}  held drift ${row.heldDrift.toExponential(2)}` +
              (row.movedCreases ? `  moved creases ${row.movedCreases.reference}/${row.movedCreases.gpu}` : ''))
      );
      process.stdout.write(`pull parity:\n${pullLines.join('\n')}\n\n`);
      const pulled = pullRows.filter((row) => !row.error);
      expect(pulled.length, 'no pull ran on the GPU').toBeGreaterThan(0);
      for (const row of pulled) {
        const label = `${row.fixture} ${row.integrator} ${row.phase}`;
        expect(row.maxAbs, `${label} diverged`).toBeLessThan(TIER_C);
        expect(row.heldDrift, `${label} moved a fixed node`).toBe(0);
      }

      // Reading the paper's shape and putting it back: exact, still, and
      // cheap enough to read on every capture.
      const shapeRows = (await page.evaluate(() =>
        (window as unknown as { runShapeChecks: () => ShapeCheckRow[] }).runShapeChecks()
      )) as ShapeCheckRow[];
      const shapeLines = shapeRows.map(
        (row) =>
          `${row.fixture.padEnd(12)} ${row.integrator.padEnd(6)} v=${String(row.vertices).padStart(5)} c=${String(row.creases).padStart(5)} | ` +
          (row.error
            ? `ERROR: ${row.error}`
            : `round trip ${row.roundTrip ? 'exact' : 'DIFFERS'}  positions ${row.positionsMatch ? 'exact' : 'DIFFER'}  ` +
              (row.heldStill
                ? `still ${row.heldStill.free.toExponential(1)}/${row.heldStill.kept.toExponential(1)} ` +
                  `(stretch ${((row.stretch ?? 0) * 100).toFixed(1)}%) sides ${row.sidesKept ? 'kept' : 'FLIPPED'}  `
                : '') +
              `readShape ${row.readShapeMs.toFixed(3)} ms  writeShape ${row.writeShapeMs.toFixed(3)} ms  ` +
              `(readPositions ${row.readPositionsMs.toFixed(3)} ms)`)
      );
      process.stdout.write(`shape read and restore:\n${shapeLines.join('\n')}\n\n`);
      const shaped = shapeRows.filter((row) => !row.error);
      expect(shaped.length, 'no shape ran on the GPU').toBeGreaterThan(0);
      for (const row of shaped) {
        const label = `${row.fixture} ${row.integrator}`;
        expect(row.roundTrip, `${label} shape did not round-trip`).toBe(true);
        expect(row.positionsMatch, `${label} restored positions differ`).toBe(true);
        if (row.heldStill) {
          expect(row.heldStill.free, `${label} restored shape crept`).toBeLessThan(SHAPE_STILL);
          // A pose keeps lengths within its tolerance of the sheet's: past it,
          // keeping settles by the difference, a restore or a pull alike.
          if ((row.stretch ?? Infinity) < POSE_REST_LENGTH_TOLERANCE) {
            expect(row.heldStill.kept, `${label} restored pose crept`).toBeLessThan(SHAPE_STILL);
          }
          expect(row.sidesKept, `${label} a crease changed side`).toBe(true);
        }
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  }, 180_000);
});
