/** Real GPU checks against production modules. Requires the worktree Vite server.
 * --examples also sweeps ignored, locally generated external corpus sources. */
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(
  new URL('../../../apps/web/package.json', import.meta.url)
);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../../../', import.meta.url)).replace(
  /\/$/,
  ''
);
const base = process.env.ORISTUDIO_SPATIAL_URL ?? 'http://localhost:5234';
const path = `${base}/@fs${root}/scripts/layer-spread/spatial`;
const out = `${root}/artifacts/spatial-production`;
const modelArg = process.argv.indexOf('--model');
const selectedModel = modelArg >= 0 ? process.argv[modelArg + 1] : undefined;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1100, height: 1000 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${path}/production-check.html`);
  await page.waitForFunction(() =>
    document.querySelector('#result').textContent.startsWith('{')
  );
  const pixels = JSON.parse(await page.locator('#result').innerText());
  await writeFile(`${out}/gpu-checks.json`, JSON.stringify(pixels, null, 2));
  if (!pixels.passed)
    throw new Error(`GPU policy failed: ${JSON.stringify(pixels)}`);
  console.log(`${pixels.result.length} production rendering/worker cases passed`);
  if (process.argv.includes('--examples') || selectedModel) {
    await page.goto(`${path}/production-examples.html`);
    await page.waitForFunction(
      () => document.querySelector('#result').textContent.includes('"ready"'),
      { timeout: 30000 }
    );
    const sweep = [],
      picks = [];
    for (const name of selectedModel ? [selectedModel] : [
      'strip',
      'waterbomb',
      'three-plane',
      'spikes',
      'penguin',
      'cylinder',
      'rectangles',
    ]) {
      for (const amount of [0, 0.001, 0.25, 1, 2, 4])
        for (const back of [false, true]) {
          const result = await page.evaluate(
            async ({ name, amount, back }) =>
              window.runSpatialCase(name, amount, back),
            { name, amount, back }
          );
          if (result.status !== 'ready' || !result.items)
            throw new Error(`Capture failed: ${name} ${amount} ${back}`);
          sweep.push({ name, back, ...result });
          if (amount === 4) {
            const parity = await page.evaluate(() =>
              window.checkSpatialPixels()
            );
            picks.push({ name, back, ...parity });
            if (!parity.checked || parity.mismatches.length)
              throw new Error(
                `Picking mismatch: ${JSON.stringify(picks.at(-1))}`
              );
          }
        }
      console.log(
        `${name}: 0–100% (0–4× displacement), both camera sides, capture and picking passed`
      );
    }
    await page.evaluate(() => window.runSpatialCase('strip', 4));
    const raster = await page.evaluate(() => window.captureSpatialRaster());
    if (raster.markup !== 1)
      throw new Error('Raster fallback did not produce an image');
    await page.locator('#captured').evaluate((image) => image.decode());
    await page.screenshot({
      path: `${out}/raster-fallback.png`,
      fullPage: true,
    });
    const refusal = await page.evaluate(() =>
      window.runSpatialCase('airplane').then(
        () => false,
        () => true
      )
    );
    if (!refusal) throw new Error('Unknown-order model was not refused');
    await writeFile(`${out}/sweep.json`, JSON.stringify(sweep, null, 2));
    await writeFile(
      `${out}/picking-parity.json`,
      JSON.stringify(picks, null, 2)
    );
    console.log(
      `${sweep.length} captures; ${picks.reduce((n, p) => n + p.checked, 0)} interior pixels; ${picks.reduce((n, p) => n + p.contactTies.length, 0)} independent near-contact depth ties (reported separately)`
    );
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
