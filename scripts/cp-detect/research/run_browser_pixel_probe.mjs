import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';

const root = process.cwd();
const base = process.argv[2] || 'http://127.0.0.1:5176';
const model = process.argv[3];
const image = process.argv[4];
const out = process.argv[5];
const mode = process.argv[6] || 'tiles';
if (!model || !image || !out) throw new Error('BASE MODEL IMAGE OUT required');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on('console', message => console.log(message.text()));
page.on('pageerror', error => console.error(error));
const results = [];
try {
  await page.goto(base);
  if (mode === 'recognize' || mode === 'solve' || mode === 'worker') {
    const result = await page.evaluate(async ({ module, model, image, solve, mode }) => {
      const { recognize, recognizeWithWorker } = await import(/* @vite-ignore */ module);
      return mode === 'worker' ? recognizeWithWorker(model, image) : recognize(model, image, solve);
    }, { module: `/@fs/${root}/scripts/cp-detect/research/browser_pixel_probe.mjs`,
      model: `/@fs/${resolve(model)}`, image: `/@fs/${resolve(image)}`, solve: mode === 'solve', mode });
    writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ inferenceMs: result.inferenceMs, decodeMs: result.decodeMs,
      totalMs: result.totalMs, tiles: result.tiles, vertices: result.vertices?.length, runtime: result.runtime }));
  } else {
  for (const provider of ['webgpu', 'wasm']) {
    try {
      results.push(await page.evaluate(async ({ module, model, image, provider }) => {
        const { benchmark } = await import(/* @vite-ignore */ module);
        return benchmark(model, image, provider);
      }, { module: `/@fs/${root}/scripts/cp-detect/research/browser_pixel_probe.mjs`,
        model: `/@fs/${resolve(model)}`, image: `/@fs/${resolve(image)}`, provider }));
    } catch (error) {
      results.push({ provider, error: String(error) });
    }
    writeFileSync(out, JSON.stringify(results, null, 2));
  }
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(results));
