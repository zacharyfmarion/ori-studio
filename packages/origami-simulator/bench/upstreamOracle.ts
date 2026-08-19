// Drives the vendored upstream Origami Simulator in a real browser and captures
// its solver output, so our TypeScript port can be validated against the
// original rather than against its own past behaviour.
//
// Upstream is a monolithic page app with no module exports, so the only way to
// run its solver is to load the page and poke its browser globals. Everything
// non-obvious about doing that is documented in
// third_party/origami-simulator/README.treemaker.md.
import { chromium, type Browser, type Page } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { FoldDocument } from '../src/types.js';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM_ROOT = resolve(PACKAGE_ROOT, '../../third_party/origami-simulator');

export interface UpstreamRunOptions {
  /**
   * 0..100, matching our SimulatorOptions. Converted to upstream's 0..1
   * `creasePercent`.
   */
  foldPercent: number;
  /** Solver steps to run after reset. */
  steps: number;
  /** Upstream default is 'euler'; 'verlet' selects the Verlet integrator. */
  integration?: 'euler' | 'verlet';
  axialStiffness?: number;
  creaseStiffness?: number;
  panelStiffness?: number;
  faceStiffness?: number;
  /** Damping ratio; upstream calls this `percentDamping`. */
  damping?: number;
}

export interface UpstreamRunResult {
  positions: Float32Array;
  nodeCount: number;
  creaseCount: number;
  faceCount: number;
  /** Upstream's own strain readout, for a cross-check on diagnostics. */
  maxStrain: number | null;
}

/**
 * A running upstream page. Construction is expensive (browser + dev server), so
 * callers should reuse one harness across many fixtures.
 */
export class UpstreamOracle {
  private constructor(
    private readonly server: ViteDevServer,
    private readonly browser: Browser,
    private readonly page: Page,
  ) {}

  static async launch(): Promise<UpstreamOracle> {
    const server = await createServer({
      root: UPSTREAM_ROOT,
      // Port 0 lets the OS pick, so parallel runs and the dev preview on 5193
      // cannot collide.
      server: { port: 0, strictPort: false },
      logLevel: 'error',
    });
    await server.listen();
    const address = server.resolvedUrls?.local?.[0];
    if (!address) throw new Error('Upstream oracle: vite did not report a local URL');

    const browser = await chromium.launch();
    const page = await browser.newPage();
    // Upstream logs a lot; surface only genuine errors.
    page.on('pageerror', (error) => {
      process.stderr.write(`[upstream page error] ${error.message}\n`);
    });

    await page.goto(address, { waitUntil: 'load' });
    // The app builds its first model from an async SVG fetch; wait for the
    // solver globals to exist before poking them.
    await page.waitForFunction(
      () => Boolean((window as never as UpstreamWindow).globals?.model?.sync),
      undefined,
      { timeout: 30_000 },
    );

    return new UpstreamOracle(server, browser, page);
  }

  async run(fold: FoldDocument, options: UpstreamRunOptions): Promise<UpstreamRunResult> {
    const raw = await this.page.evaluate(
      ({ fold: foldArg, options: optionsArg }) => {
        const g = (window as never as UpstreamWindow).globals;

        // setFoldData -> processFold -> model.buildModel only stashes nextFold
        // and sets needsSync; the swap happens in model.sync(), which is driven
        // by requestAnimationFrame. A headless page may never paint, so call
        // sync() directly -- which is also what we want for determinism.
        g.pattern.setFoldData(foldArg, true);
        g.model.sync();
        g.model.pause();

        if (optionsArg.integration) g.integrationType = optionsArg.integration;
        if (optionsArg.axialStiffness !== undefined) g.axialStiffness = optionsArg.axialStiffness;
        if (optionsArg.creaseStiffness !== undefined)
          g.creaseStiffness = optionsArg.creaseStiffness;
        if (optionsArg.panelStiffness !== undefined) g.panelStiffness = optionsArg.panelStiffness;
        if (optionsArg.faceStiffness !== undefined) g.faceStiffness = optionsArg.faceStiffness;
        if (optionsArg.damping !== undefined) g.percentDamping = optionsArg.damping;
        // Stiffness/damping only reach the GPU uniforms via these latches.
        g.materialHasChanged = true;
        g.creaseMaterialHasChanged = true;

        // Fold percent is `creasePercent`, on a 0..1 scale -- NOT `foldPercent`,
        // which does not exist upstream. It reaches the solver only when the
        // latch is set, so setting the value alone silently does nothing.
        g.creasePercent = optionsArg.foldPercent / 100;
        g.shouldChangeCreasePercent = true;

        g.model.reset();
        g.model.step(optionsArg.steps);

        const positions = g.model.getPositionsArray();
        return {
          positions: Array.from(positions as ArrayLike<number>),
          nodeCount: g.model.getNodes().length,
          creaseCount: g.model.getCreases().length,
          faceCount: g.model.getFaces().length,
          maxStrain: typeof g.maxStrain === 'number' ? g.maxStrain : null,
        };
      },
      { fold, options },
    );

    return {
      positions: Float32Array.from(raw.positions),
      nodeCount: raw.nodeCount,
      creaseCount: raw.creaseCount,
      faceCount: raw.faceCount,
      maxStrain: raw.maxStrain,
    };
  }

  async close(): Promise<void> {
    await this.browser.close();
    await this.server.close();
  }
}

interface UpstreamWindow {
  globals: {
    pattern: { setFoldData(fold: unknown, isDemo?: boolean): unknown };
    model: {
      sync(): void;
      pause(): void;
      reset(): void;
      step(steps: number): void;
      getPositionsArray(): ArrayLike<number>;
      getNodes(): unknown[];
      getCreases(): unknown[];
      getFaces(): unknown[];
    };
    creasePercent: number;
    shouldChangeCreasePercent: boolean;
    integrationType: string;
    axialStiffness: number;
    creaseStiffness: number;
    panelStiffness: number;
    faceStiffness: number;
    percentDamping: number;
    materialHasChanged: boolean;
    creaseMaterialHasChanged: boolean;
    maxStrain?: number;
  };
}
