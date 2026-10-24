// Isolated process: a corpus fold is allowed to time out without blocking the batch.
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import init, * as cp from '../../apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm.js';
await init({
  module_or_path: await readFile(
    new URL('../../apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm', import.meta.url)
  ),
});
const [input, output] = process.argv.slice(2);
const started = performance.now();
const load = extname(input).toLowerCase() === '.cp' ? cp.load_cp : cp.load_fold;
const document = load(await readFile(input, 'utf8'), 'Camera spread research');
// The selected-fold entry filters auxiliary ink out of face tracing, while
// retaining all aux lines for the folded paper scene. Match the app's path.
const segments = cp.document_snapshot(document).crease_pattern.line_segments;
const ids = segments.flatMap((line, i) => (['Black0', 'Red1', 'Blue2'].includes(line.color) ? [i + 1] : []));
if (!ids.length) throw new Error('No foldable creases');
const folded = cp.folded_figure_fold_selected(document, ids, 1, 'Order5', undefined, 0);
const scene = cp.folded_figure_paper_scene(folded.handle, document);
if (!scene) throw new Error('No solved flat paper scene');
await writeFile(output, JSON.stringify({ scene, foldMs: performance.now() - started }));
console.log(
  JSON.stringify({
    faces: scene.faces.length,
    edges: segments.length,
    subfaces: scene.subfaces.length,
    ms: performance.now() - started,
  })
);
