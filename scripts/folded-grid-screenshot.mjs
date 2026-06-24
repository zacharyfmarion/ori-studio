import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'apps/web');
const outputDir = path.join(repoRoot, 'artifacts/folded-grid-screenshots');
const outputPath = path.join(outputDir, 'folded-grid-primitive.png');

const server = await createServer({
  root: webRoot,
  logLevel: 'error',
  server: {
    host: '127.0.0.1',
    port: 0,
  },
});

let browser;
try {
  await server.listen();
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite did not expose a local URL');

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create a CP' }).click();
  await page.waitForFunction(() => {
    const store = window.__treemakerWorkspaceStore;
    return Boolean(store?.getState().oristudioCpDocument);
  });

  await page.evaluate(() => {
    const store = window.__treemakerWorkspaceStore;
    if (!store) throw new Error('Workspace store debug hook was not installed');
    store.setState({
      oristudioCpFoldedFigures: [
        {
          id: 'screenshot-folded-1',
          title: 'Folded model 1',
          handle: null,
          sourceKind: 'generated-from-current-cp',
          sourceCpRevision: 0,
          startingFaceId: 1,
          displayStyle: 'Paper5',
          status: 'ready',
          snapshot: {
            model: {
              front_color: { red: 255, green: 255, blue: 50 },
              back_color: { red: 233, green: 233, blue: 233 },
              line_color: { red: 0, green: 0, blue: 0 },
              scale: 1,
              rotation: 0,
              anti_alias: true,
              display_shadows: false,
              state: 'Front0',
              folded_cases: 1,
              transparent_transparency: 16,
              transparency_color: false,
            },
            estimation_step: 'Step5',
            display_style: 'Paper5',
            discovered_fold_cases: 1,
            find_another_overlap_valid: false,
            text_result: 'Number of found solutions = 1',
            wireframe: null,
          },
          renderSnapshot: {
            schema_version: 1,
            fixture: null,
            pass: 'paper-front-full',
            primitives: [
              {
                sequence: 0,
                kind: 'fill_path',
                style: {
                  paint: {
                    kind: 'color',
                    color: { red: 255, green: 255, blue: 50, alpha: 255 },
                  },
                  stroke: { kind: 'none' },
                  antialias: 'off',
                },
                geometry: {
                  kind: 'path',
                  commands: [
                    { command: 'move_to', point: { x: 0, y: 0 } },
                    { command: 'line_to', point: { x: 1, y: 0 } },
                    { command: 'line_to', point: { x: 0.2, y: 0.85 } },
                    { command: 'close' },
                  ],
                },
              },
              {
                sequence: 1,
                kind: 'stroke_segment',
                style: {
                  paint: {
                    kind: 'color',
                    color: { red: 8, green: 8, blue: 8, alpha: 255 },
                  },
                  stroke: { kind: 'basic', width: 1.2, end_cap: 1, line_join: 1, miter_limit: 10 },
                  antialias: 'on',
                },
                geometry: {
                  kind: 'segment',
                  from: { x: 0, y: 0 },
                  to: { x: 1, y: 0 },
                },
              },
              {
                sequence: 2,
                kind: 'stroke_segment',
                style: {
                  paint: {
                    kind: 'color',
                    color: { red: 8, green: 8, blue: 8, alpha: 255 },
                  },
                  stroke: { kind: 'basic', width: 1.2, end_cap: 1, line_join: 1, miter_limit: 10 },
                  antialias: 'on',
                },
                geometry: {
                  kind: 'segment',
                  from: { x: 1, y: 0 },
                  to: { x: 0.2, y: 0.85 },
                },
              },
              {
                sequence: 3,
                kind: 'stroke_segment',
                style: {
                  paint: {
                    kind: 'color',
                    color: { red: 8, green: 8, blue: 8, alpha: 255 },
                  },
                  stroke: { kind: 'basic', width: 1.2, end_cap: 1, line_join: 1, miter_limit: 10 },
                  antialias: 'on',
                },
                geometry: {
                  kind: 'segment',
                  from: { x: 0.2, y: 0.85 },
                  to: { x: 0, y: 0 },
                },
              },
            ],
          },
          error: null,
        },
      ],
      oristudioCpActiveFoldedFigureId: 'screenshot-folded-1',
    });
  });

  await page.locator('[data-folded-render-pass="paper-front-full"]').waitFor();
  const primitiveCount = await page.locator('.cp-generated-folded-figure-primitive').count();
  if (primitiveCount < 4) {
    throw new Error(`Expected folded render primitives, found ${primitiveCount}`);
  }

  await mkdir(outputDir, { recursive: true });
  const screenshot = await page.locator('.cp-panel__body').screenshot();
  if (screenshot.length < 1000) {
    throw new Error(`Folded grid screenshot was unexpectedly small: ${screenshot.length} bytes`);
  }
  await writeFile(outputPath, screenshot);
  console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${screenshot.length} bytes)`);
} finally {
  await browser?.close();
  await server.close();
}
