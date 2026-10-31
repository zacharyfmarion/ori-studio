import { vi } from 'vitest';
// Exercise the real WASM geometry in capture tests, replacing only browser
// transport. Worker lifecycle/cancellation is tested by SpreadService itself.
vi.mock('./prepareConnected', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const { initSync, solve_layer_spread } = await import(
    '../generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm'
  );
  const { connectedSpreadSource } = await import('../cp-workspace/folded/connectedSpreadSource');
  initSync({
    module: readFileSync(resolve('src/generated/oristudio-layer-spread-wasm/oristudio_layer_spread_wasm_bg.wasm')),
  });
  return {
    prepareConnected: (scene: Parameters<typeof connectedSpreadSource>[0], yUp = false) => {
      const source = connectedSpreadSource(scene, yUp);
      return { promise: Promise.resolve({ source, solution: solve_layer_spread(source.input) }), release: () => {} };
    },
  };
});
vi.mock('./captureConnected', async () => {
  const { connectedPaperScene } = await import('./connectedScene');
  return {
    captureConnected: async (scene: import('./connectedScene').ConnectedPaperScene) =>
      connectedPaperScene(scene.connected, scene.sheet, true),
  };
});
