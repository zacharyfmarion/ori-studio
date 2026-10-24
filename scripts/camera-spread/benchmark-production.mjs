/** Completed bitmap and compositor latency, not CPU draw submission alone. */
import { chromium, webkit } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const base = process.env.CAMERA_SPREAD_URL || 'http://localhost:5281';
const label = process.env.CAMERA_SPREAD_BENCH || 'baseline';
const engine = process.env.CAMERA_SPREAD_BROWSER || 'chromium';
const models = [
  'frog-frog-by-gen-hagiwara',
  'ldm-layer-issue',
  'crane-crane-by-jordan-langerak',
  'tokyo-skytree-tokyo-skytree-by-akihiro-kosuge',
];
const browser = await (engine === 'webkit' ? webkit : chromium).launch(
  engine === 'webkit' ? {} : { args: ['--use-angle=metal', '--enable-precise-memory-info'] }
);
const rows = [];
try {
  for (const dpr of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 960, height: 840 }, deviceScaleFactor: dpr });
    await page.route('**/@vite/client', (route) =>
      route.fulfill({ contentType: 'application/javascript', body: 'export function injectQuery(url){return url}' })
    );
    await page.route('**/__camera-benchmark', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<body style="margin:0"><canvas style="width:960px;height:840px"></canvas></body>',
      })
    );
    await page.goto(`${base}/__camera-benchmark`);
    const setup = await page.evaluate(async () => {
      const { cameraSpreadRenderClient } = await import('/src/cp-workspace/folded/cameraSpreadClients.ts');
      const { cameraSpreadInitialView } = await import('/src/cp-workspace/folded/cameraSpreadView.ts');
      window.client = cameraSpreadRenderClient.retain();
      window.initialView = cameraSpreadInitialView;
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
      const result = await page.evaluate(
        async ({ key, scene, dpr }) => {
          const begin = performance.now();
          await window.client.load(key, scene);
          const prepareMs = performance.now() - begin;
          const canvas = document.querySelector('canvas');
          const ctx = canvas.getContext('bitmaprenderer');
          const samples = [];
          let beats = 0;
          const heartbeat = setInterval(() => beats++, 10);
          for (const mode of ['amount', 'orbit', 'pan', 'zoom', 'projection']) {
            const frames = [];
            for (let i = -5; i < 24; i++) {
              const n = Math.max(0, i),
                t = n / 23;
              const pose = { directionDeg: 247 + t * (mode === 'orbit' ? 100 : 0), inclinationDeg: 55 };
              const spread = {
                kind: 'camera',
                amount: mode === 'amount' ? 0.06 + 0.18 * t : 0.18,
                projection: mode === 'projection' ? (n % 2 ? 'diagram' : 'perspective') : 'perspective',
                ...pose,
                camera: window.initialView(pose),
              };
              if (mode === 'pan') spread.camera.pan = [0.15 * t, 0.08 * t];
              if (mode === 'zoom') spread.camera.zoom = 1 + 0.4 * t;
              const start = performance.now();
              const bitmap = await window.client.render({
                key,
                spread,
                rotationDeg: 0,
                surface: { width: 960, height: 840, dpr },
              });
              if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
              ctx.transferFromImageBitmap(bitmap);
              const bitmapMs = performance.now() - start;
              await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
              if (i >= 0) frames.push({ bitmapMs, presentMs: performance.now() - start });
            }
            const metric = (field) => {
              const values = frames.map((f) => f[field]).sort((a, b) => a - b);
              return { p50: values[Math.floor(values.length * 0.5)], p95: values[Math.floor(values.length * 0.95)] };
            };
            samples.push({ mode, bitmapMs: metric('bitmapMs'), presentMs: metric('presentMs'), frames });
          }
          clearInterval(heartbeat);
          await window.client.release(key);
          return { prepareMs, samples, heartbeatTicks: beats, heapBytes: performance.memory?.usedJSHeapSize ?? null };
        },
        { key, scene, dpr }
      );
      rows.push({ model, faces: scene.faces.length, dpr, setup, ...result });
      console.log(
        `${model} DPR${dpr}: ${result.samples.map((s) => `${s.mode} ${s.bitmapMs.p95.toFixed(1)}ms bitmap / ${s.presentMs.p95.toFixed(1)}ms presented`).join(', ')}`
      );
    }
    await page.close();
  }
  await mkdir('artifacts/camera-spread/performance', { recursive: true });
  await writeFile(
    `artifacts/camera-spread/performance/${label}-${engine}.json`,
    JSON.stringify({ label, engine, date: new Date().toISOString(), rows }, null, 2)
  );
} finally {
  await browser.close();
}
