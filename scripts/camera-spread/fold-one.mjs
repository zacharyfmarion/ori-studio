// Isolated process: a corpus fold is allowed to time out without blocking the batch.
import { readFile, writeFile } from 'node:fs/promises';
import init, * as cp from '../../apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm.js';
await init({
  module_or_path: await readFile(
    new URL('../../apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm', import.meta.url)
  ),
});
const [input, output] = process.argv.slice(2);
const started = performance.now();
const document = cp.load_fold(await readFile(input, 'utf8'), 'Camera spread research');
const folded = cp.folded_figure_fold(document, 1, 'Order5', undefined, 0);
const scene = cp.folded_figure_paper_scene(folded.handle, document);
if (!scene) throw new Error('No solved flat paper scene');
await writeFile(output, JSON.stringify({ scene, foldMs: performance.now() - started }));
console.log(
  JSON.stringify({
    faces: scene.faces.length,
    subfaces: scene.subfaces.length,
    ms: performance.now() - started,
  })
);
