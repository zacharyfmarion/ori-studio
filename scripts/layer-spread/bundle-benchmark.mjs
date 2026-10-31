#!/usr/bin/env node
// Freeze the current JS implementation for before/after comparisons. WASM is
// loaded separately from the current production build by benchmarkWorker.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.argv[2];
const relativeOutput = output ? path.relative(root, output) : '';
if (!path.isAbsolute(output ?? '') || (!relativeOutput.startsWith('..' + path.sep) && !path.isAbsolute(relativeOutput)))
  throw new Error('Pass an absolute output bundle path outside the checkout');
const modules = [
  'apps/web/src/layer-spread/posedScene.ts',
  'apps/web/src/layer-spread/connectedScene.ts',
  'apps/web/src/layer-spread/spreadGeometry.ts',
  'apps/web/src/cp-workspace/folded/connectedSpreadSource.ts',
  'apps/web/src/diagram/pictures/diagramPaperStyle.ts',
  'apps/web/src/diagram/capture/captureGeometry.ts',
  'packages/layer-spread/src/index.ts',
];
await build({
  stdin: { contents: modules.map(m => `export * from ${JSON.stringify(path.join(root, m))};`).join('\n'), resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: output,
  alias: { '@oristudio/layer-spread': path.join(root, 'packages/layer-spread/src/index.ts') },
});
