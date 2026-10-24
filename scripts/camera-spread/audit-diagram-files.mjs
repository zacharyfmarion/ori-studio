/** Real project regression audit. Inputs and generated geometry stay outside Git. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import path from 'node:path';
import { createHash } from 'node:crypto';
import init, * as cp from '../../apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm.js';

const [file, stepsArg = 'all'] = process.argv.slice(2);
if (!file)
  throw new Error('Usage: node scripts/camera-spread/audit-diagram-files.mjs project.osf [all|1,2,...]');
const suffix = createHash('sha256').update(path.resolve(file)).digest('hex').slice(0, 8);
const out = `artifacts/camera-spread/real-files/${path.basename(file, '.osf').replace(/[^a-z0-9-]/gi, '-')}-${suffix}`;
await mkdir(out, { recursive: true });
await init({
  module_or_path: await readFile(
    new URL('../../apps/web/src/generated/oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm', import.meta.url)
  ),
});
const server = await createServer({
  configFile: false,
  root: 'apps/web',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const { CpSheetIndex } = await server.ssrLoadModule('/src/engine/oristudioCpSheetIndex.ts');
  const { chooseStepCreases, knownCreasesOf, creasesMatch } = await server.ssrLoadModule(
    '/src/diagram/capture/captureCreases.ts'
  );
  const { captureModel } = await server.ssrLoadModule('/src/diagram/capture/captureFolded.ts');
  const project = JSON.parse(await readFile(file, 'utf8'));
  const document = project.workspace.creasePattern.creasePattern.document;
  const diagrams = project.workspace.diagrams ?? [];
  const handle = cp.load_document(document);
  const snapshot = cp.document_snapshot(handle);
  const sheets = new CpSheetIndex(cp.sheet_index(handle));
  console.log(
    JSON.stringify({
      loaded: file,
      lines: snapshot.crease_pattern.line_segments.length,
      sheets: sheets.sheetCount,
      diagrams: diagrams.length,
    })
  );
  const results = [];
  if (!diagrams.length) console.log(JSON.stringify({ skipped: 'No saved diagram document' }));
  for (const [diagramIndex, diagram] of diagrams.entries()) {
    const numbers =
      stepsArg === 'all'
        ? diagram.steps.flatMap((step, i) => (step.source?.render?.mode === 'folded-flat' ? [i + 1] : []))
        : stepsArg.split(',').map(Number);
    for (const number of numbers) {
      const step = diagram.steps[number - 1];
      if (!step?.source || step.source.render.mode !== 'folded-flat') {
        results.push({
          diagram: diagramIndex,
          step: number,
          status: 'Not a linked folded step',
        });
        continue;
      }
      const choice = chooseStepCreases(snapshot, step.source.scope, sheets, knownCreasesOf(step.source));
      if (choice.status !== 'found') {
        results.push({
          diagram: diagramIndex,
          step: number,
          status: choice.status,
        });
        continue;
      }
      const started = performance.now();
      let folded = cp.folded_figure_fold_selected(
        handle,
        choice.creases.foldLineIds,
        1,
        'Order5',
        captureModel(snapshot, 'front'),
        0
      );
      const requestedCase = step.source.render.foldCase ?? 1;
      if (requestedCase > 1) folded = cp.folded_figure_fold_to_case(folded.handle, requestedCase, 'Order5', 0);
      const scene = cp.folded_figure_paper_scene(folded.handle, handle);
      const result = {
        diagram: diagramIndex,
        step: number,
        lines: choice.creases.foldLineIds.length,
        requestedCase,
        matchesSaved: creasesMatch(choice.creases, knownCreasesOf(step.source)),
        fold: Object.fromEntries(
          Object.entries(folded.snapshot).filter(
            ([key]) => !['wireframe', 'development', 'model'].includes(key)
          )
        ),
        faces: scene?.faces.length,
        ms: performance.now() - started,
      };
      results.push(result);
      console.log(JSON.stringify(result));
      await writeFile(
        `${out}/diagram-${diagramIndex}-step-${number}.json`,
        JSON.stringify({
          scene,
          step,
          document: {
            ...snapshot,
            crease_pattern: {
              ...snapshot.crease_pattern,
              line_segments: choice.creases.scopedLineIds.map(
                (id) => snapshot.crease_pattern.line_segments[id - 1]
              ),
            },
          },
        })
      );
      // Keep the JS-decoded coordinates bit-for-bit for the native/Java oracle.
      const bits = choice.creases.foldLineIds.map((id) => {
        const l = snapshot.crease_pattern.line_segments[id - 1];
        const coordinates = [l.a.x, l.a.y, l.b.x, l.b.y].map((value) => {
          const b = Buffer.alloc(8);
          b.writeDoubleLE(value);
          return b.readBigUInt64LE().toString();
        });
        return `[[${coordinates.join(',')}],${JSON.stringify(l.color)}]`;
      });
      await writeFile(`${out}/diagram-${diagramIndex}-step-${number}-bits.json`, `[${bits.join(',')}]`);
      cp.free_folded_figure(folded.handle);
    }
  }
  cp.free_document(handle);
  await writeFile(`${out}/audit.json`, JSON.stringify(results, null, 2));
  if (results.some((r) => r.status || r.fold.outcome !== 'Solved' || r.fold.current_fold_case !== r.requestedCase))
    process.exitCode = 1;
} finally {
  await server.close();
}
