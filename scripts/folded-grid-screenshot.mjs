/**
 * Screenshot a folded figure on the crease-pattern canvas, flat and 3D.
 *
 * **The only lane in this repo that draws one.** The agent browser pane runs
 * with `visibilityState=hidden` and issues zero animation frames, so a WebGL
 * canvas there is permanently blank; Playwright's chromium has a real frame
 * loop. Everything a projector *decides* is asserted in unit tests — this is for
 * the half only an eye settles.
 *
 * Not in CI, which is why it had rotted: it waited on
 * `[data-folded-render-pass]` and counted `.cp-generated-folded-figure-primitive`,
 * neither of which any element has emitted since the SVG-to-WebGL migration.
 * The waits are now on the store and on real frames, and the pass/fail signal is
 * that the canvas **changed** — a blank canvas also screenshots to a
 * comfortably large PNG, so size alone proved nothing.
 *
 *   node scripts/folded-grid-screenshot.mjs
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = path.join(repoRoot, 'apps/web');
const outputDir = path.join(repoRoot, 'artifacts/folded-grid-screenshots');

/** A flat figure's render snapshot, hand-written: one triangle and its edges. */
const FLAT_RENDER_SNAPSHOT = {
  schema_version: 1,
  fixture: null,
  pass: 'paper-front-full',
  primitives: [
    {
      sequence: 0,
      kind: 'fill_path',
      style: {
        paint: { kind: 'color', color: { red: 255, green: 255, blue: 50, alpha: 255 } },
        stroke: { kind: 'none' },
        antialias: 'off',
      },
      geometry: {
        kind: 'path',
        commands: [
          { command: 'move_to', point: { x: -150, y: -150 } },
          { command: 'line_to', point: { x: 150, y: -150 } },
          { command: 'line_to', point: { x: -90, y: 105 } },
          { command: 'close' },
        ],
      },
    },
    ...[
      [
        { x: -150, y: -150 },
        { x: 150, y: -150 },
      ],
      [
        { x: 150, y: -150 },
        { x: -90, y: 105 },
      ],
      [
        { x: -90, y: 105 },
        { x: -150, y: -150 },
      ],
    ].map(([from, to], index) => ({
      sequence: index + 1,
      kind: 'stroke_segment',
      style: {
        paint: { kind: 'color', color: { red: 8, green: 8, blue: 8, alpha: 255 } },
        stroke: { kind: 'basic', width: 1.2, end_cap: 1, line_join: 1, miter_limit: 10 },
        antialias: 'on',
      },
      geometry: { kind: 'segment', from, to },
    })),
  ],
};

const FOLDED_MODEL = {
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
};

/** The kernel's shipped `Fold3dTolerances::DEFAULT`. */
const TOLERANCES = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

/**
 * Project a committed kernel render model, in Node, through the same module the
 * app uses — loaded via Vite so its TypeScript and its imports resolve exactly
 * as they do in the browser. A second implementation here would be a second
 * thing to keep in step with the projector, which is the whole point of looking.
 */
async function projected3dSnapshot(server, fixtureName) {
  const projector = await server.ssrLoadModule(
    '/src/cp-workspace/folded/foldedFigure3dProjection.ts',
  );
  const model = JSON.parse(
    await readFile(
      path.join(webRoot, 'src/cp-workspace/folded/__fixtures__', `${fixtureName}.rendermodel.json`),
      'utf8',
    ),
  );
  const camera = projector.defaultFolded3dCamera(model, FOLDED_MODEL.state);
  return {
    camera,
    snapshot: projector.projectFolded3dModel(model, {
      camera,
      displayStyle: 'Paper5',
      style: projector.folded3dPaperStyle(FOLDED_MODEL),
      tolerances: TOLERANCES,
    }).snapshot,
  };
}

function entryFor(id, { renderSnapshot, folded3d = null, camera = null }) {
  return {
    id,
    title: 'Folded model 1',
    handle: null,
    sourceKind: folded3d ? 'generated-3d' : 'generated-from-current-cp',
    sourceCpRevision: 0,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: folded3d
      ? null
      : {
          model: FOLDED_MODEL,
          estimation_step: 'Step5',
          display_style: 'Paper5',
          discovered_fold_cases: 1,
          find_another_overlap_valid: false,
          text_result: 'Number of found solutions = 1',
          wireframe: null,
        },
    folded3d,
    renderSnapshot,
    camera,
    placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
    error: null,
  };
}

/** Two composited frames, so the canvas has certainly redrawn. */
async function settle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)));
      }),
  );
}

const server = await createServer({
  root: webRoot,
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0 },
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
  await page.waitForFunction(() =>
    Boolean(window.__treemakerWorkspaceStore?.getState().oristudioCpDocument),
  );

  const body = page.locator('.cp-panel__body');
  await settle(page);
  const empty = await body.screenshot();

  await mkdir(outputDir, { recursive: true });
  const spatial = await projected3dSnapshot(server, 'box_90');
  const cases = [
    { name: 'flat', entry: entryFor('screenshot-flat', { renderSnapshot: FLAT_RENDER_SNAPSHOT }) },
    {
      name: '3d',
      entry: entryFor('screenshot-3d', {
        renderSnapshot: spatial.snapshot,
        camera: spatial.camera,
        // Enough of a `Fold3dSnapshot` for the entry to read as 3D. The figure
        // draws from `renderSnapshot` alone, exactly as a reopened `.osf` does.
        folded3d: {
          schema_version: 1,
          model: FOLDED_MODEL,
          discovered_fold_cases: 1,
          current_fold_case: 1,
          find_another_overlap_valid: false,
          has_next_solution: false,
          verdict: { verdict: 'folded' },
        },
      }),
    },
  ];

  for (const { name, entry } of cases) {
    await page.evaluate((injected) => {
      const store = window.__treemakerWorkspaceStore;
      if (!store) throw new Error('Workspace store debug hook was not installed');
      store.setState({
        oristudioCpFoldedFigures: [injected],
        oristudioCpActiveFoldedFigureId: injected.id,
      });
    }, entry);
    await settle(page);

    const shot = await body.screenshot();
    // A blank canvas screenshots to a perfectly respectable PNG, so size is not
    // the test. What says the figure drew is that the pane is no longer the pane
    // we photographed before anything was injected.
    if (shot.equals(empty)) {
      throw new Error(`The ${name} folded figure did not change the canvas`);
    }
    const outputPath = path.join(outputDir, `folded-grid-${name}.png`);
    await writeFile(outputPath, shot);
    console.log(`Wrote ${path.relative(repoRoot, outputPath)} (${shot.length} bytes)`);
  }
} finally {
  await browser?.close();
  await server.close();
}
