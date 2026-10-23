/** Live worker → stored scene → reopened vectors, on the private review corpus. */
import { chromium } from 'playwright';
import { writeProductionGallery } from './production-gallery.mjs';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = process.env.CAMERA_SPREAD_URL || 'http://localhost:5281';
const dpr = Number(process.env.CAMERA_SPREAD_DPR || 1);
const output = 'artifacts/camera-spread/production';
const reference = JSON.parse(await readFile('artifacts/camera-spread/comparison/after.json', 'utf8'));
const models = reference.models.filter(
  (id) => !process.env.CAMERA_SPREAD_MODEL || id.includes(process.env.CAMERA_SPREAD_MODEL)
);
const views = reference.views.filter(
  (view) => !process.env.CAMERA_SPREAD_VIEW || view.id === process.env.CAMERA_SPREAD_VIEW
);
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root: 'apps/web',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  optimizeDeps: { noDiscovery: true, include: [] },
});
const browser = await chromium.launch({ args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 960, height: 840 }, deviceScaleFactor: dpr });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const rows = [];
try {
  const { captureCameraSpread } = await server.ssrLoadModule('/src/diagram/capture/cameraSpreadCapture.ts');
  const { storeScene } = await server.ssrLoadModule('/src/diagram/capture/captureFolded.ts');
  const { cameraSpreadInitialView } = await server.ssrLoadModule('/src/cp-workspace/folded/cameraSpreadView.ts');
  const { DEFAULT_DIAGRAM_STYLE, createDiagram } = await server.ssrLoadModule(
    '/src/diagram/document/diagramDocument.ts'
  );
  const { cpStep, stepsIn } = await server.ssrLoadModule('/src/diagram/document/diagramSteps.fixtures.ts');
  const { readDiagram, writeDiagram } = await server.ssrLoadModule('/src/diagram/document/diagramFile.ts');
  const { diagramScenePaintStyle } = await server.ssrLoadModule('/src/diagram/pictures/diagramPaperStyle.ts');
  const { paperSceneSvgBody } = await server.ssrLoadModule('/src/lib/paper/paperSvg.ts');
  const { STEP_PICTURE_EDGE_CSS_PX } = await server.ssrLoadModule('/src/diagram/pictures/poseLineWeight.ts');
  await page.route('**/@vite/client', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: 'export function injectQuery(url){return url}' })
  );
  await page.route('**/__production-review', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<body style="margin:0;background:white"><canvas style="width:960px;height:840px;display:block"></canvas><img style="width:960px;height:840px;display:none"/></body>',
    })
  );
  await page.goto(`${base}/__production-review`);
  const setup = await page.evaluate(async () => {
    const { cameraSpreadRenderClient } = await import('/src/cp-workspace/folded/cameraSpreadClients.ts');
    const { resolvePaperStyle, PAPER_STYLE_POLICIES } = await import('/src/lib/paper/paperStyleResolve.ts');
    window.client = cameraSpreadRenderClient.retain();
    window.resolvePaperStyle = resolvePaperStyle;
    window.policy = PAPER_STYLE_POLICIES['diagram-workspace'];
    const gl = document.createElement('canvas').getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      userAgent: navigator.userAgent,
    };
  });
  let key = 0;
  for (const model of models) {
    const { scene } = JSON.parse(await readFile(`artifacts/camera-spread/${model}.json`, 'utf8'));
    key++;
    const prepare = await page.evaluate(
      async ({ scene, key }) => {
        const start = performance.now();
        await window.client.load(key, scene);
        return performance.now() - start;
      },
      { scene, key }
    );
    for (const v of views) {
      const spread = {
        kind: 'camera',
        amount: v.amount,
        projection: v.projection,
        directionDeg: v.directionDeg,
        inclinationDeg: Math.min(80, v.inclinationDeg),
        cameraSet: v.projection !== 'diagram',
        camera: { ...cameraSpreadInitialView(v), zoom: v.zoom },
      };
      const started = performance.now();
      const result = captureCameraSpread(scene, spread, 0);
      const stored = storeScene(result.scene, result.paperScale, null, result.paperFaces);
      if (stored.kind !== 'picture') throw Error(`${model}/${v.id}: vector capture exceeds storage budget`);
      const written = writeDiagram({
        ...createDiagram(),
        steps: [
          cpStep('review', { mode: 'folded-flat', side: 'front', foldCase: 1, rotationDeg: 0, spread }, stored.picture),
        ],
      });
      const reopened = stepsIn(readDiagram(JSON.parse(JSON.stringify(written))).document)[0];
      if (reopened.unknown || reopened.picture?.paperFaces !== stored.picture.paperFaces)
        throw Error(`${model}/${v.id}: reopen lost anchors`);
      const saved = JSON.parse(reopened.picture.sceneJson);
      const captureMs = performance.now() - started;
      const prefix = `${model}--${v.id}--dpr${dpr}`;
      const paint = diagramScenePaintStyle(DEFAULT_DIAGRAM_STYLE, false);
      const completion = await page.evaluate(
        async ({ key, spread, paint, dpr, referenceEdge }) => {
          const canvas = document.querySelector('canvas'),
            img = document.querySelector('img');
          canvas.style.display = 'block';
          img.style.display = 'none';
          const style = window.resolvePaperStyle(paint, window.policy, {
            dpr: (dpr * 840) / referenceEdge,
            background: [1, 1, 1],
            backgroundAlpha: 1,
            faceAlpha: 1,
            colorMode: 'paper',
            strainClip: 0,
            showFaces: true,
            showEdges: true,
          });
          const start = performance.now();
          const bitmap = await window.client.render({
            key,
            spread,
            rotationDeg: 0,
            surface: { width: 960, height: 840, dpr, style },
          });
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          canvas.getContext('bitmaprenderer').transferFromImageBitmap(bitmap);
          const bitmapMs = performance.now() - start;
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return { bitmapMs, presentMs: performance.now() - start };
        },
        { key, spread, paint, dpr, referenceEdge: STEP_PICTURE_EDGE_CSS_PX }
      );
      await page.locator('canvas').screenshot({ path: `${output}/${prefix}-live.png` });
      const b = saved.bounds,
        k = 840 / (b.maxX - b.minX),
        cx = (b.minX + b.maxX) / 2,
        cy = (b.minY + b.maxY) / 2;
      const body = paperSceneSvgBody(saved, paint, {
        project: ([x, y]) => [480 + (x - cx) * k, 420 + (y - cy) * k],
        unitsPerPt: 840 / STEP_PICTURE_EDGE_CSS_PX / 0.75,
        keepHiddenFaces: false,
      });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="840" viewBox="0 0 960 840"><rect width="960" height="840" fill="white"/>${body}</svg>`;
      await writeFile(`${output}/${prefix}.svg`, svg);
      await writeFile(`${output}/${prefix}.json`, JSON.stringify(written));
      await page.evaluate(async (svg) => {
        const img = document.querySelector('img');
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
        await img.decode();
        img.style.display = 'block';
        document.querySelector('canvas').style.display = 'none';
      }, svg);
      await page.locator('img').screenshot({ path: `${output}/${prefix}-saved.png` });
      rows.push({
        model,
        view: v.id,
        spread,
        prefix,
        prepareMs: prepare,
        captureMs,
        ...completion,
        bytes: stored.picture.sceneJson.length,
      });
      console.log(`${model}/${v.id}: ${Math.round(completion.presentMs)} ms live, ${Math.round(captureMs)} ms capture`);
    }
    await page.evaluate((key) => window.client.release(key), key);
  }
  if (errors.length) throw Error(errors.join('\n'));
  await writeFile(`${output}/review-dpr${dpr}.json`, JSON.stringify({ setup, dpr, rows }, null, 2));
  await writeProductionGallery(output);
} finally {
  await browser.close();
  await server.close();
}
