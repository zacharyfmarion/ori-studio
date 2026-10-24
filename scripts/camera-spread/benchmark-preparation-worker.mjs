/** One fresh process per fold or cold preparation trial. Geometry stays in ignored artifacts. */
import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
const [mode, input, output, bundle] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '../..');
const timings = {};
let stage = 'startup';
async function measure(name, fn) {
  stage = name;
  process.send?.({ kind: 'stage', stage, timings });
  const start = performance.now();
  try { return await fn(); } finally { timings[name] = performance.now() - start; }
}
const hash = (data) => createHash('sha256').update(data).digest('hex');
try {
  let result;
  if (mode === 'fold') {
    const cp = await measure('moduleMs', () => import(pathToFileURL(path.join(root, 'apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm.js'))));
    const wasm = await readFile(path.join(root, 'apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm'));
    await measure('wasmInitMs', () => cp.default({ module_or_path: wasm }));
    const text = await readFile(input, 'utf8');
    const document = await measure('parseMs', () => cp.load_fold(text, 'Preparation benchmark'));
    const segments = await measure('snapshotMs', () => cp.document_snapshot(document).crease_pattern.line_segments);
    const ids = segments.flatMap((line, i) => ['Black0', 'Red1', 'Blue2'].includes(line.color) ? [i + 1] : []);
    if (!ids.length) throw new Error('No folding-colour creases');
    const folded = await measure('foldMs', () => cp.folded_figure_fold_selected(document, ids, 1, 'Order5', undefined, 0));
    const scene = await measure('sceneMs', () => cp.folded_figure_paper_scene(folded.handle, document));
    if (!scene?.faces?.length) throw new Error('No solved flat paper scene');
    const serialized = JSON.stringify(scene);
    await writeFile(output, serialized);
    result = { inputSha256: hash(text), sceneSha256: hash(serialized), counts: {
      edges: segments.length, foldingEdges: ids.length, faces: scene.faces.length,
      subfaces: scene.subfaces.length, auxLines: scene.aux_lines.length,
      maxLocalStack: scene.subfaces.reduce((n, s) => Math.max(n, s.faces_top_to_bottom.length), 0),
    } };
  } else if (mode === 'prepare') {
    const api = await measure('moduleMs', () => import(pathToFileURL(bundle)));
    const scene = JSON.parse(await readFile(input, 'utf8'));
    const begin = performance.now();
    const mesh = await measure('liftMs', () => api.cameraSpreadLift(scene));
    const plans = await measure('paintMs', () => api.cameraPaintPlans(mesh, scene));
    const relations = await measure('relationsMs', () => api.cameraLayerRelations(scene));
    timings.totalPrepMs = performance.now() - begin;
    const { prepareMs, solveMs, ...stable } = mesh.diagnostics;
    timings.topologyMs = prepareMs;
    // Existing diagnostic includes matrix compilation, solve, normalization and probes.
    timings.solveAndProbeMs = solveMs;
    const warm = performance.now();
    if (api.cameraSpreadLift(scene) !== mesh || api.cameraPaintPlans(mesh, scene) !== plans || api.cameraLayerRelations(scene) !== relations)
      throw new Error('Prepared geometry was not cached');
    timings.cachedLookupMs = performance.now() - warm;
    result = { meshSha256: hash(JSON.stringify({ ...mesh, heights: [...mesh.heights], diagnostics: stable })),
      counts: { meshVertices: mesh.xy.length, triangles: mesh.triangles.length, contacts: stable.contacts,
        paintPieces: plans.front.pieces.length + plans.back.pieces.length, relationBytes: relations.data.byteLength },
      diagnostics: stable };
  } else throw new Error(`Unknown mode: ${mode}`);
  process.send?.({ kind: 'result', status: 'ok', timings, ...result, maxRssKiB: process.resourceUsage().maxRSS });
} catch (error) {
  process.send?.({ kind: 'result', status: 'error', stage, timings, error: String(error?.stack ?? error).slice(0, 3000), maxRssKiB: process.resourceUsage().maxRSS });
} finally { process.disconnect?.(); }
