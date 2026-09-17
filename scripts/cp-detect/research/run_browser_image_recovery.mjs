// Full source-measurement + exact-solve replay in real browser workers.
// Source pixels and frozen recognition inputs only; reference scoring is separate.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const regionUnderlay = process.argv.includes('--region-underlay');
const preserveSource = process.argv.includes('--preserve-source');
const rebuildGraph = process.argv.includes('--rebuild-graph');
const noImage = process.argv.includes('--no-image');
const [base, out, keysFile] = process.argv.slice(2).filter(a => !['--region-underlay', '--preserve-source', '--rebuild-graph', '--no-image'].includes(a));
if (!base || !out) throw new Error('BASE OUT [KEYS_JSON] required');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const write = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2));
const keys = read(keysFile || 'artifacts/cp-solver/S055-rust-sequential/keys.json');
const inventory = new Map(read('artifacts/cp-recognition/frozen/inventory.json').cases.map(r => [r.key, r]));
const baseline = new Map(read('artifacts/cp-solver/S093-browser-validation/browser/runs.json').map(r => [r.key, r]));
const wasm = 'apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm_bg.wasm';
const cases = keys.map(key => {
  const name = key.replaceAll('/', '__'), entry = inventory.get(key);
  const input = `artifacts/cp-solver/S087-ordered-grid-proposals/native/${name}/input.json`;
  const cache = `artifacts/cp-recognition/${entry.split === 'development' ? 'E013-development' : 'E017-holdout'}/${name}`;
  const crop = readdirSync(cache, { withFileTypes: true }).filter(d => d.isDirectory())
    .map(d => join(cache, d.name, 'rectification.json')).filter(existsSync).sort()[0];
  if (sha(entry.source) !== entry.source_sha256) throw new Error(`Source changed: ${key}`);
  return { key, input, crop, source: entry.source, inputSha256: sha(input), cropSha256: sha(crop), sourceSha256: sha(entry.source) };
});
const options = { timeout_seconds: 25, recognition_fallback: true, polish: true, construction_recovery: 'constructions' };
const protocol = { cases, options, wasmSha256: sha(wasm), scriptSha256: sha(new URL(import.meta.url)),
  workerSha256: sha('apps/web/src/workers/cpDetectWorker.ts'),
  regionHelperSha256: sha('apps/web/src/cp-workspace/regions/regionSolveImage.ts'),
  rebuildSha256: sha('apps/web/src/engine/cpExactSolveInputRebuild.ts'),
  sourceMode: regionUnderlay ? 'saved-region-jpeg-underlay' : 'original-image',
  preserveSource,
  rebuildGraph, noImage,
  timing: 'original: decode/measure/solve/export; region: rebuild/decode/measure/solve/export after import preparation; one shared 25s budget', jobs: 1 };
mkdirSync(out, { recursive: true });
if (existsSync(join(out, 'protocol.json')) && JSON.stringify(read(join(out, 'protocol.json'))) !== JSON.stringify(protocol)) {
  throw new Error('Refusing to mix browser protocols');
}
write(join(out, 'protocol.json'), protocol);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
let sourceBytes;
await page.route('**/__research_source_image__', route => route.fulfill({ body: sourceBytes, contentType: 'application/octet-stream' }));
const rows = [];
try {
  await page.goto(base);
  write(join(out, 'environment.json'), await page.evaluate(() => ({ userAgent: navigator.userAgent,
    cores: navigator.hardwareConcurrency, isolated: crossOriginIsolated })));
  for (const c of cases) {
    if (sha(wasm) !== protocol.wasmSha256) throw new Error('WASM changed during replay');
    const directory = join(out, c.key.replaceAll('/', '__'));
    mkdirSync(directory, { recursive: true });
    if (existsSync(join(directory, 'complete.json'))) { rows.push(read(join(directory, 'complete.json'))); continue; }
    sourceBytes = readFileSync(c.source);
    const crop = read(c.crop), quad = (crop.report ?? crop).source_quad;
    const answer = await page.evaluate(async ({ input, quad, options, root, regionUnderlay, preserveSource, rebuildGraph, noImage }) => {
      const { getCpDetectClient, releaseCpDetectClient } = await import(/* @vite-ignore */ `${root}/apps/web/src/store/workspaceStore/cpDetectRuntime.ts`);
      const { openCpExactSolveSession } = await import(/* @vite-ignore */ `${root}/apps/web/src/engine/cpExactSolveSession.ts`);
      let started = performance.now();
      let session;
      let timer;
      try {
        const bitmap = await createImageBitmap(await (await fetch('/__research_source_image__')).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const client = await getCpDetectClient();
        let measured;
        let solveFrame;
        if (regionUnderlay) {
          // Match Review & Fix's saved reference: 1024 rectification, JPEG
          // encoding and the actual region measurement helper. Preparation is
          // import work; the solve timer starts with the saved image ready.
          const { IMAGE_JPEG_QUALITY } = await import(/* @vite-ignore */ `${root}/apps/web/src/cp-workspace/images/cpImage.ts`);
          const { createCpImage } = await import(/* @vite-ignore */ `${root}/apps/web/src/cp-workspace/images/cpImage.ts`);
          const { createCpSuppressionRegion } = await import(/* @vite-ignore */ `${root}/apps/web/src/cp-workspace/annotations/suppressionRegion.ts`);
          const { measureRegionSourceImage } = await import(/* @vite-ignore */ `${root}/apps/web/src/cp-workspace/regions/regionSolveImage.ts`);
          const solveInput = preserveSource ? await client.measureSourceImage(input, pixels, quad) : undefined;
          const rectified = await client.manualRectifyImage(pixels, quad, 1024);
          const underlayCanvas = new OffscreenCanvas(1024, 1024);
          underlayCanvas.getContext('2d').putImageData(rectified.image, 0, 0);
          const blob = await underlayCanvas.convertToBlob({ type: 'image/jpeg', quality: IMAGE_JPEG_QUALITY });
          const src = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.onerror = reject; reader.readAsDataURL(blob);
          });
          const image = createCpImage({ src, naturalWidth: 1024, naturalHeight: 1024,
            center: { x: .5, y: .5 }, width: 1024 / 960, height: 1024 / 960 });
          const region = createCpSuppressionRegion({ center: { x: .5, y: .5 }, width: 1.05,
            height: 1.05, imageId: image.id, solveInput, suppress: [] });
          releaseCpDetectClient();
          started = performance.now();
          solveFrame = { origin: { x: 0, y: 0 }, ux: [1, 0], uy: [0, 1], side: 1, flip: 1 };
          if (rebuildGraph) {
            const { rebuildCpExactSolveInput } = await import(/* @vite-ignore */ `${root}/apps/web/src/engine/cpExactSolveInputRebuild.ts`);
            const assignments = { boundary: 'B', mountain: 'M', valley: 'V', flat: 'F', unknown: 'U' };
            const fold = { vertices_coords: input.vertices.map(v => [v.point.x, v.point.y]),
              edges_vertices: input.selected_spans.map(s => s.vertices),
              edges_assignment: input.selected_spans.map(s => assignments[s.assignment_evidence.observed_label]) };
            const rebuilt = await rebuildCpExactSolveInput(JSON.stringify(fold));
            input = rebuilt.input; solveFrame = rebuilt.transform;
          }
          measured = noImage ? input : (await measureRegionSourceImage(input, solveFrame, region, [image])).input;
        } else {
          measured = await client.measureSourceImage(input, pixels, quad);
        }
        const fitSeconds = (performance.now() - started) / 1000;
        session = openCpExactSolveSession();
        timer = setTimeout(() => session.stop(), 35000);
        const solver = await session.solver;
        const result = await solver.solveExactToFold(JSON.stringify(measured), JSON.stringify({ ...options,
          timeout_seconds: Math.max(0, 25 - (performance.now() - started) / 1000) }));
        if (result.fold && solveFrame) {
          const { cpSolveFramePoint } = await import(/* @vite-ignore */ `${root}/apps/web/src/engine/cpExactSolveTypes.ts`);
          result.fold.vertices_coords = result.fold.vertices_coords.map(([x, y]) => {
            const p = cpSolveFramePoint(solveFrame, { x, y }); return [p.x, p.y];
          });
        }
        return { ...result, measuredInput: measured, fitSeconds, seconds: (performance.now() - started) / 1000 };
      } catch (error) {
        return { error: error?.message || JSON.stringify(error), seconds: (performance.now() - started) / 1000 };
      } finally { clearTimeout(timer); session?.dispose(); releaseCpDetectClient(); }
    }, { input: read(c.input), quad, options, regionUnderlay, preserveSource, rebuildGraph, noImage, root: `/@fs/${resolve('.')}` });
    const measured = answer.measuredInput; delete answer.measuredInput;
    if (measured) write(join(directory, 'input.json'), measured);
    write(join(directory, 'result.json'), answer);
    const old = baseline.get(c.key);
    const row = Object.fromEntries(['key', 'split', 'complexity', 'detected_topology_exact', 'detected_assignments_exact'].map(k => [k, old[k]]));
    Object.assign(row, { seconds: answer.seconds, fit_seconds: answer.fitSeconds, error: answer.error,
      status: answer.solved?.status, accepted: answer.solved?.movement_report?.accepted === true });
    row.solved_25s = row.status === 'solved' && row.accepted && row.seconds <= 25;
    if (answer.fold) { write(join(directory, 'solved.fold'), answer.fold); row.prediction = join(directory, 'solved.fold'); }
    write(join(directory, 'complete.json'), row); rows.push(row);
    console.log(JSON.stringify({ done: rows.length, total: cases.length, ...row }));
  }
  write(join(out, 'runs.json'), rows);
} finally { await browser.close(); }
