/** Pixel regressions through the real WebGL shader, independent of private corpus. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.env.CAMERA_SPREAD_URL || 'http://localhost:5281';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({
    viewport: { width: 512, height: 512 },
    deviceScaleFactor: Number(process.env.CAMERA_SPREAD_DPR || 1),
  });
  await page.route('**/@vite/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'export function injectQuery(url) { return url; }',
    })
  );
  await page.route('**/__camera-renderer-check', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<canvas style="width:512px;height:512px"></canvas>' })
  );
  await page.goto(`${base}/__camera-renderer-check`);
  const results = await page.evaluate(async () => {
    const [{ cameraSpreadLift }, { cameraPaintPlans }, { createCameraRenderer }] = await Promise.all([
      import('/src/cp-workspace/folded/cameraSpreadLift.ts'),
      import('/src/cp-workspace/folded/cameraSpreadVisibility.ts'),
      import('/src/devtools/camera-spread/cameraRenderer.ts'),
    ]);
    const canvas = document.querySelector('canvas');
    canvas.style.width = canvas.style.height = '512px';
    const results = [];
    for (const constrained of [false, true])
      for (const swapped of [false, true])
        for (const pan of [
          [0, 0],
          [0.07, -0.09],
        ]) {
          const slope = swapped ? 1 : 0;
          const faces = [0, 1].map((f) => {
            const outline = [
              [0, 0],
              [1, 0],
              [1, 1],
              [0, 1],
            ].map(([x, y]) => ({ x, y }));
            return {
              points: [0, 1, 2, 3].map((v) => v + 4 * f),
              outline,
              front_up: f === slope,
              edges: outline.map((from, i) => ({ from, to: outline[(i + 1) % 4], kind: 'border' })),
            };
          });
          const kernel = {
            schema_version: 3,
            flipped: false,
            sheet: 1,
            sheet_points: [],
            faces,
            aux_lines: [{ face: slope, from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 } }],
            subfaces: constrained
              ? [{ polygon: faces[0].outline, faces_top_to_bottom: [1 - slope, slope] }]
              : [],
          };
          const mesh = cameraSpreadLift(kernel);
          for (const t of mesh.triangles)
            for (const v of t.vertices)
              mesh.heights[v] = t.face === slope ? (constrained ? 1 : 1.5 * mesh.xy[v].x - 0.5) : 0;
          const renderer = createCameraRenderer(canvas, mesh, kernel, cameraPaintPlans(mesh, kernel));
          const gl = canvas.getContext('webgl2');
          for (const projection of ['diagram', 'orthographic', 'perspective']) {
            const view = {
              amount: 0.3,
              directionDeg: 0,
              inclinationDeg: 0,
              projection,
              visibility: 'layers',
            };
            renderer.draw(view, 1, false, pan);
            const pixel = (x, y) => {
              const p = new Uint8Array(4);
              // Read the pixel containing the projected point. Rounding can
              // select the next pixel, outside a subpixel-width auxiliary line.
              gl.readPixels(
                Math.floor(canvas.width / 2 + ((x - 0.5 + pan[0]) * 1.45 * canvas.height) / 2),
                Math.floor(canvas.height / 2 - ((y - 0.5 + pan[1]) * 1.45 * canvas.height) / 2),
                1,
                1,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                p
              );
              return [...p];
            };
            // Yellow = sloping sheet, grey = level sheet. IDs must not change the answer.
            results.push({
              name: `${projection} ${constrained ? 'protected' : 'unrelated'} swapped=${swapped}`,
              left: pixel(0.2, 0.4),
              right: pixel(0.8, 0.4),
              ink: pixel(0.8, 0.5),
              depthBits: gl.getParameter(gl.DEPTH_BITS),
              constrained,
            });
            if (constrained && projection !== 'diagram') {
              renderer.draw({ ...view, inclinationDeg: 180 }, 1, false, pan);
              results.push({
                name: `${projection} reversed swapped=${swapped}`,
                left: pixel(0.2, 0.4),
                right: pixel(0.8, 0.4),
                ink: pixel(0.8, 0.5),
                constrained: true,
                back: true,
              });
            }
          }
          renderer.dispose();
        }
    return results;
  });
  for (const r of results) {
    const yellow = (p) => p[0] > 245 && p[2] < 140;
    const grey = (p) => p[0] > 200 && p[0] < 240 && p[2] > 210;
    const ink = (p) => p[0] >= 150 && p[0] <= 180 && p[1] >= 150 && p[1] <= 180;
    assert(grey(r.left), `${r.name}: left ${r.left}`);
    assert(r.constrained ? grey(r.right) : yellow(r.right), `${r.name}: right ${r.right}`);
    assert(r.constrained && !r.back ? !ink(r.ink) : ink(r.ink), `${r.name}: ink ${r.ink}`);
  }
  console.log(
    `${results.length} WebGL pixel cases passed: unrelated depth crossings, face-ID permutation, protected inverted stacks, underside reversal auxiliary ink and panning.`
  );
} finally {
  await browser.close();
}
