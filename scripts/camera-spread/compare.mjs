/** Capture the actual WebGL renderer before/after, keeping all settings identical. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const phase = process.argv[2];
if (!['before', 'after'].includes(phase))
  throw new Error('Usage: node scripts/camera-spread/compare.mjs before|after');
const base = process.env.CAMERA_SPREAD_URL || 'http://localhost:5281';
const output = 'artifacts/camera-spread/comparison';
const models = [
  'crane-crane-by-jordan-langerak',
  'ldm-layer-issue',
  'frog-frog-by-gen-hagiwara',
  'bird-base-bird-base-by-ch-junhyuk',
  'lizard-lizard-by-jason-ku',
  'baby-lizard-baby-lizard-by-riccardo-foschi',
  'rain-frog-rain-frog-by-kei-morisue',
  'elephant-elephant-by-obelisk',
  'horse-1-6-horse-1-6-by-ikuno-riku',
  'simple-cat-simple-cat-by-tatsumi-1proto',
];
const views = [
  {
    id: 'flat',
    label: 'Zero depth',
    amount: 0,
    directionDeg: 192,
    inclinationDeg: 29,
    projection: 'diagram',
    zoom: 1.15,
  },
  {
    id: 'crane',
    label: 'Reported crane view',
    amount: 0.18,
    directionDeg: 192,
    inclinationDeg: 29,
    projection: 'diagram',
    zoom: 1.15,
  },
  {
    id: 'opposite',
    label: 'Opposite direction',
    amount: 0.18,
    directionDeg: 12,
    inclinationDeg: 29,
    projection: 'diagram',
    zoom: 1.15,
  },
  {
    id: 'top',
    label: 'Top down',
    amount: 0.25,
    directionDeg: 0,
    inclinationDeg: 0,
    projection: 'orthographic',
    zoom: 1.15,
  },
  {
    id: 'oblique',
    label: 'Oblique 3D',
    amount: 0.18,
    directionDeg: 247,
    inclinationDeg: 55,
    projection: 'orthographic',
    zoom: 1.15,
  },
  {
    id: 'side',
    label: 'Frog near-side / maximum amount',
    amount: 0.5,
    directionDeg: 143,
    inclinationDeg: 86,
    projection: 'perspective',
    zoom: 1,
  },
  {
    id: 'underside',
    label: 'Underside',
    amount: 0.25,
    directionDeg: 323,
    inclinationDeg: 135,
    projection: 'perspective',
    zoom: 1,
  },
].map((v) => ({ ...v, visibility: 'layers', rollDeg: 0 }));
await mkdir(`${output}/${phase}`, { recursive: true });
await writeFile(
  `${output}/capture.html`,
  '<!doctype html><html><body style="margin:0;background:white"><canvas id="capture" style="display:block;width:960px;height:840px"></canvas></body></html>'
);
const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({
  viewport: { width: 960, height: 840 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const results = [];
try {
  // Captures use a fixed module graph; unrelated Vite HMR updates must not reload it.
  await page.route('**/@vite/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'export function injectQuery(url, query) { return url + (url.includes("?") ? "&" : "?") + query; }',
    })
  );
  await page.goto(`${base}/src/generated/camera-spread/comparison/capture.html`);
  for (const model of models) {
    const setup = await page.evaluate(async (id) => {
      const [{ cameraSpreadLift }, { cameraPaintPlans }, { createCameraRenderer }] = await Promise.all([
        import('/src/cp-workspace/folded/cameraSpreadLift.ts'),
        import('/src/cp-workspace/folded/cameraSpreadVisibility.ts'),
        import('/src/cp-workspace/folded/cameraSpreadRenderer.ts'),
      ]);
      window.captureRenderer?.dispose();
      const { scene } = await (await fetch(`/src/generated/camera-spread/${id}.json`)).json();
      const mesh = cameraSpreadLift(scene);
      window.captureRenderer = createCameraRenderer(
        document.querySelector('#capture'),
        mesh,
        scene,
        cameraPaintPlans(mesh, scene)
      );
      return { faces: scene.faces.length, triangles: mesh.triangles.length };
    }, model);
    for (const view of views) {
      const timing = await page.evaluate((v) => {
        const start = performance.now();
        window.captureRenderer.draw(v, v.zoom);
        const submitted = performance.now();
        const gl = document.querySelector('#capture').getContext('webgl2');
        gl.finish();
        const error = gl.getError();
        if (error) throw new Error(`WebGL error ${error}`);
        return {
          submitMs: submitted - start,
          completeMs: performance.now() - start,
        };
      }, view);
      const file = `${phase}/${model}--${view.id}.png`;
      await page.locator('#capture').screenshot({ path: `${output}/${file}` });
      results.push({ model, view: view.id, file, ...setup, ...timing });
    }
    console.log(`${phase}: ${model} — 7 views (${setup.faces} faces)`);
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const metadata = {
    phase,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    capturedAt: new Date().toISOString(),
    models,
    views,
    results,
  };
  await writeFile(`${output}/${phase}.json`, JSON.stringify(metadata, null, 2));
  if (phase === 'after') {
    const before = JSON.parse(await readFile(`${output}/before.json`, 'utf8'));
    if (
      JSON.stringify(before.views) !== JSON.stringify(views) ||
      JSON.stringify(before.models) !== JSON.stringify(models)
    )
      throw new Error('Before/after settings differ');
  }
} finally {
  await browser.close();
}
