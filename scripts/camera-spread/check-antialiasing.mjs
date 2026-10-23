/** Inspect composited pixels: raw WebGL pixels cannot prove display antialiasing. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.CAMERA_SPREAD_URL || 'http://localhost:5281';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  for (const deviceScaleFactor of [1, 2]) {
    const page = await browser.newPage({
      viewport: { width: 256, height: 256 },
      deviceScaleFactor,
    });
    await page.route('**/@vite/client', (route) => route.fulfill({
      contentType: 'application/javascript',
      body: 'export function injectQuery(url) { return url; }',
    }));
    await page.route('**/__camera-antialiasing-check', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<body style="margin:0"><canvas style="display:block;width:256px;height:256px"></canvas>',
    }));
    await page.goto(`${base}/__camera-antialiasing-check`);
    await page.evaluate(async () => {
      const [{ cameraSpreadLift }, { cameraPaintPlans }, { createCameraRenderer }] = await Promise.all([
        import('/src/cp-workspace/folded/cameraSpreadLift.ts'),
        import('/src/cp-workspace/folded/cameraSpreadVisibility.ts'),
        import('/src/devtools/camera-spread/cameraRenderer.ts'),
      ]);
      const outline = [[0, 0], [1, 0.2], [0.8, 1], [0.2, 0.8]].map(([x, y]) => ({ x, y }));
      const kernel = {
        schema_version: 3, flipped: false, sheet: 1, sheet_points: [], aux_lines: [], subfaces: [],
        faces: [{
          points: [0, 1, 2, 3], outline, front_up: true,
          edges: outline.map((from, i) => ({ from, to: outline[(i + 1) % 4], kind: 'border' })),
        }],
      };
      const mesh = cameraSpreadLift(kernel);
      const renderer = createCameraRenderer(document.querySelector('canvas'), mesh, kernel, cameraPaintPlans(mesh, kernel));
      renderer.draw({ amount: 0.18, directionDeg: 192, inclinationDeg: 29, projection: 'diagram', visibility: 'layers' });
    });
    const png = await page.locator('canvas').screenshot();
    const metrics = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let inkPixels = 0, blendedPixels = 0;
      // Opaque palette: white background, yellow paper, dark ink. Count only
      // mixtures well away from these endpoints, avoiding colour-rounding noise.
      const palette = [[255, 255, 255], [255, 227, 117], [31, 36, 46]];
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 245) inkPixels++;
        if (palette.every((rgb) => rgb.some((value, c) => Math.abs(data[i + c] - value) > 6))) blendedPixels++;
      }
      return { inkPixels, blendedPixels, width: canvas.width, height: canvas.height };
    }, `data:image/png;base64,${png.toString('base64')}`);
    console.log(`DPR ${deviceScaleFactor}: ${JSON.stringify(metrics)}`);
    assert(metrics.inkPixels > 100, 'Expected visible sloping outlines');
    assert(metrics.blendedPixels > metrics.inkPixels * 0.1, `DPR ${deviceScaleFactor}: diagonal edges have no meaningful antialiasing`);
    await page.close();
  }
} finally {
  await browser.close();
}
