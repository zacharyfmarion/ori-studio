import { vi } from 'vitest';
// Exercise the real WASM geometry in capture tests, replacing only browser
// transport. Worker lifecycle/cancellation is tested by SpreadService itself.
// What each worker answers on a failure is kept: an invalid solve is refused
// (spread.worker.ts), and a clip too complex to finish hands the scene back
// unclipped (capture.worker.ts, captureConnected.ts). The workers' time
// limits are not: a test that needs one stubs it.
vi.mock('./prepareConnected', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { initSync, solve_layer_spread } = await import(
    '../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm'
  );
  const { connectedSpreadSource } = await import('../cp-workspace/folded/connectedSpreadSource');
  const { validSolution } = await import('./protocol');
  initSync({
    module: readFileSync(resolve('src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm')),
  });
  return {
    prepareConnected: (scene: Parameters<typeof connectedSpreadSource>[0], yUp = false) => {
      const promise = (async () => {
        const source = connectedSpreadSource(scene, yUp);
        const solution = solve_layer_spread(source.input);
        if (!validSolution(solution, source.input)) throw new Error('Invalid layer spread result');
        return { source, solution };
      })();
      void promise.catch(() => {});
      return { promise, release: () => {} };
    },
  };
});
vi.mock('./captureConnected', async () => {
  const { connectedPaperScene } = await import('./connectedScene');
  const { SpreadComplexityError } = await import('@oristudio/layer-spread');
  return {
    captureConnected: async (scene: import('./connectedScene').ConnectedPaperScene) => {
      try {
        return connectedPaperScene(scene.connected, scene.sheet, true);
      } catch (error) {
        if (error instanceof SpreadComplexityError) return scene;
        throw error;
      }
    },
  };
});
