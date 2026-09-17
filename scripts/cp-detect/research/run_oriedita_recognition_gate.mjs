// Recognition-only cross-renderer gate. Generated crop is fixed to separate
// recognition from crop finding. This does not measure exact-solve convergence.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
const [base, manifestFile, out] = process.argv.slice(2);
if (!base || !manifestFile || !out) throw new Error('BASE IMAGE_MANIFEST OUT required');
const read = p => JSON.parse(readFileSync(p, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = p => hash(readFileSync(p));
const write = (p, x) => writeFileSync(p, JSON.stringify(x, null, 2));
const manifest = read(manifestFile);
const keys = [...new Set(manifest.map(r => r.key))].sort((a, b) =>
  hash(`oriedita-recognition-v1:${a}`).localeCompare(hash(`oriedita-recognition-v1:${b}`))).slice(0, 6);
const cases = manifest.filter(r => keys.includes(r.key));
const model = read('scripts/cp-detect/current-model.json');
const modelManifest = join(model.stable_model_asset_dir, 'manifest.json');
const protocol = { keys, cases, modelSha256: sha(join(model.stable_model_asset_dir, model.model_filename)),
  modelManifestSha256: sha(modelManifest), wasmSha256: sha('apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm_bg.wasm'),
  scriptSha256: sha(new URL(import.meta.url)), crop: 'Known generated paper frame; no automatic crop search',
  executionProvider: 'wasm', threshold: model.inference.threshold };
mkdirSync(out, { recursive: true });
if (existsSync(join(out, 'protocol.json')) && JSON.stringify(read(join(out, 'protocol.json'))) !== JSON.stringify(protocol)) throw new Error('Protocol changed');
write(join(out, 'protocol.json'), protocol);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const rows = [];
try {
  await page.goto(base);
  for (const row of cases) {
    if (sha(row.source) !== row.source_sha256) throw new Error('Source changed');
    const directory = join(out, row.style, row.key.replaceAll('/', '__'));
    mkdirSync(directory, { recursive: true });
    if (existsSync(join(directory, 'complete.json'))) { rows.push(read(join(directory, 'complete.json'))); continue; }
    const result = await page.evaluate(async ({ root, imageUrl, manifestUrl, quad }) => {
      const { getCpDetectClient, releaseCpDetectClient } = await import(/* @vite-ignore */ `${root}/apps/web/src/store/workspaceStore/cpDetectRuntime.ts`);
      const started = performance.now();
      try {
        const bitmap = await createImageBitmap(await (await fetch(imageUrl)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const client = await getCpDetectClient();
        const q = Object.fromEntries(['top_left', 'top_right', 'bottom_right', 'bottom_left']
          .map((key, i) => [key, { x: quad[i][0], y: quad[i][1] }]));
        const rectified = await client.manualRectifyImage(image, q, 1024);
        const recognized = await client.recognizeRectifiedFold(rectified.image, {
          manifestUrl: new URL(manifestUrl, location.href).href, executionProvider: 'wasm',
          highResolutionSource: { image, quad: q },
        });
        return { ...recognized, seconds: (performance.now() - started) / 1000, rectification: rectified.report };
      } catch (error) { return { error: error?.message || JSON.stringify(error), seconds: (performance.now() - started) / 1000 }; }
      finally { releaseCpDetectClient(); }
    }, { root: `/@fs/${resolve('.')}`, imageUrl: `/@fs/${resolve(row.source)}`,
      manifestUrl: `/@fs/${resolve(modelManifest)}`, quad: row.quad });
    write(join(directory, 'result.json'), result);
    if (result.foldJson) write(join(directory, 'recognized.fold'), JSON.parse(result.foldJson));
    const record = { key: row.key, style: row.style, seconds: result.seconds, error: result.error,
      prediction: result.foldJson ? join(directory, 'recognized.fold') : null };
    write(join(directory, 'complete.json'), record); rows.push(record);
    console.log(JSON.stringify({ done: rows.length, total: cases.length, ...record }));
  }
  write(join(out, 'runs.json'), rows);
} finally { await browser.close(); }
