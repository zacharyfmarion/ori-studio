#!/usr/bin/env node
/**
 * The Layer order dialog's browser check (`implementation-plans/layer-order-dialog.md`):
 * screenshots of real WebGL frames, and a pixel comparison between two runs.
 *
 * The agent browser pane draws no WebGL frames (see
 * `scripts/folded-grid-screenshot.mjs`), so every canvas gate of the plan runs
 * here, locally, never in CI. Each PR of the plan adds its cases to `CASES`;
 * U1 starts it with Fold's folded pane, which moves onto the shared stack hit
 * index and tint ladder (`cp-workspace/picking/stackHitIndex.ts`,
 * `cp-workspace/renderer/fillTint.ts`) and must not change a pixel.
 *
 * It drives a dev server that is already running (`scripts/dev-server.sh
 * start`), so a run shows what that server serves: the working tree. To prove
 * a refactor changes nothing, capture once on the base and once on the change,
 * then compare:
 *
 *   DEV_SERVER_PORT=5241 scripts/dev-server.sh start
 *   node scripts/layer-order-dialog-check.mjs capture --label before --url http://localhost:5241
 *   # … apply the change …
 *   node scripts/layer-order-dialog-check.mjs capture --label after --url http://localhost:5241
 *   node scripts/layer-order-dialog-check.mjs compare before after
 *
 * `capture` writes `artifacts/layer-order-dialog-check/<label>/<case>-<pane>.png`
 * and fails if a case's canvas never drew. `compare` counts the pixels that
 * differ between two labels, writes a diff image for any pair that does
 * (`<b>-vs-<a>/…`), prints one row per image and exits non-zero on a
 * difference. Pixels are compared in Chromium (the repo has no PNG decoder), on
 * a page of its own.
 *
 * Needs Node 22 and Playwright's Chromium (`npx playwright install chromium`).
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repoRoot, 'artifacts/layer-order-dialog-check');

const VIEWPORT = { width: 1400, height: 900 };

// ---------------------------------------------------------------------------
// Waiting for the canvas

/** Two composited frames, so the canvas has certainly redrawn. */
async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))))
  );
}

/**
 * A screenshot of `locator` once it stops changing: two in a row the same,
 * a quarter second apart. The engine answers in a worker, so a fold's preview
 * lands some frames after the click that asked for it.
 *
 * What floats over a canvas is not the canvas: a tool window (any
 * `FloatingPanel`, `section[data-pin]`) is painted over in magenta, since its
 * text settles on its own schedule and differs from run to run. So is the
 * viewport toolbar: on the same commit, its buttons' rounded corners come out
 * one of two ways from run to run (±1 on about a hundred corner pixels once a
 * fold is made). CSS transitions are finished first, for the same reason.
 */
async function steadyShot(page, locator, { timeoutMs = 15000, masked = true } = {}) {
  const deadline = Date.now() + timeoutMs;
  // A modal covers the workspace's floating bars, which a mask would paint over it.
  const floating = masked ? [page.locator('section[data-pin]'), page.locator('[data-viewport-toolbar]')] : [];
  const shoot = () => locator.screenshot({ animations: 'disabled', mask: floating, maskColor: '#ff00ff' });
  await settle(page);
  let last = await shoot();
  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    await settle(page);
    const next = await shoot();
    if (next.equals(last)) return next;
    last = next;
  }
  throw new Error('The canvas never settled');
}

// ---------------------------------------------------------------------------
// Pixels, read in the browser

/**
 * Per image: its size and the box of the pixels darker than `dark` (0–255
 * luma), in the image's pixels; null where none is. The paper's outline is the
 * darkest thing on a pane, so its box is where the paper is.
 */
async function darkBox(page, png, dark = 128) {
  return page.evaluate(
    async ({ data, dark }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, image.width, image.height);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
          const k = (y * image.width + x) * 4;
          const luma = 0.299 * rgba[k] + 0.587 * rgba[k + 1] + 0.114 * rgba[k + 2];
          // Magenta is a mask (`steadyShot`), not ink.
          const masked = rgba[k] > 200 && rgba[k + 1] < 60 && rgba[k + 2] > 200;
          if (luma >= dark || masked) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
      return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
    },
    { data: png.toString('base64'), dark }
  );
}

/** How two PNGs differ: pixel counts, the largest channel step, and a diff image (red where they differ). */
async function pixelDiff(page, a, b) {
  return page.evaluate(
    async ({ a, b }) => {
      const load = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return { width: image.width, height: image.height, rgba: context.getImageData(0, 0, image.width, image.height).data };
      };
      const [left, right] = await Promise.all([load(a), load(b)]);
      if (left.width !== right.width || left.height !== right.height) {
        return { sameSize: false, sizes: [[left.width, left.height], [right.width, right.height]] };
      }
      const canvas = document.createElement('canvas');
      canvas.width = left.width;
      canvas.height = left.height;
      const context = canvas.getContext('2d');
      const out = context.createImageData(left.width, left.height);
      let differing = 0;
      let maxDelta = 0;
      for (let k = 0; k < left.rgba.length; k += 4) {
        let delta = 0;
        for (let c = 0; c < 4; c += 1) delta = Math.max(delta, Math.abs(left.rgba[k + c] - right.rgba[k + c]));
        maxDelta = Math.max(maxDelta, delta);
        const grey = (left.rgba[k] + left.rgba[k + 1] + left.rgba[k + 2]) / 3;
        if (delta > 0) differing += 1;
        out.data.set(delta > 0 ? [255, 0, 0, 255] : [grey, grey, grey, 64], k);
      }
      context.putImageData(out, 0, 0);
      return {
        sameSize: true,
        width: left.width,
        height: left.height,
        pixels: left.width * left.height,
        differing,
        maxDelta,
        diff: differing > 0 ? canvas.toDataURL('image/png').split(',')[1] : null,
      };
    },
    { a: a.toString('base64'), b: b.toString('base64') }
  );
}

// ---------------------------------------------------------------------------
// Fold

const FOLDED = '[data-testid="fold-folded-canvas"]';
const CREASE_PATTERN = '[data-testid="fold-crease-pattern-canvas"]';

/** A fresh Fold workspace: the flat square, the valley fold in hand by point onto point. */
async function openFold(page, url) {
  await page.goto(new URL('/fold', url).href, { waitUntil: 'load', timeout: 120000 });
  await page.locator(FOLDED).waitFor({ state: 'visible', timeout: 120000 });
  await steadyShot(page, page.locator(FOLDED));
}

/**
 * The paper's corners on the folded pane, in page px: the box of its outline,
 * read with the viewport toolbar painted over (its icons are dark too).
 */
async function foldedPaperCorners(page) {
  const canvas = page.locator(FOLDED);
  await steadyShot(page, canvas);
  const box = await canvas.boundingBox();
  const shot = await canvas.screenshot({ mask: [page.locator('[data-viewport-toolbar]')], maskColor: '#ffffff' });
  const paper = await darkBox(page, shot);
  if (!box || !paper) throw new Error('No paper on the folded pane');
  // Two px in from the outline: on the paper, well inside the snap radius of the corner.
  const at = (x, y) => ({ x: box.x + x, y: box.y + y });
  return {
    topLeft: at(paper.minX + 2, paper.minY + 2),
    topRight: at(paper.maxX - 2, paper.minY + 2),
    bottomLeft: at(paper.minX + 2, paper.maxY - 2),
    bottomRight: at(paper.maxX - 2, paper.maxY - 2),
  };
}

/** Click a point on the folded pane, then let the hover and the engine's answer land. */
async function clickFolded(page, point) {
  await page.mouse.move(point.x, point.y);
  await settle(page);
  await page.mouse.click(point.x, point.y);
  await steadyShot(page, page.locator(FOLDED));
}

/** Both panes of the Fold canvas, as each case's `<case>-folded.png` and `<case>-crease-pattern.png`. */
async function foldPanes(page) {
  return {
    folded: await steadyShot(page, page.locator(FOLDED)),
    'crease-pattern': await steadyShot(page, page.locator(CREASE_PATTERN)),
  };
}

/**
 * Fold's folded pane through the states that read the stack hit index and the
 * tint ladder: the sheet at rest; a fold located on it (one layer lit as
 * moving, the pointer's hover ring on a corner); the fold made, two layers at
 * rest; and a second fold located across both layers.
 */
async function foldCases(page, url, record) {
  await openFold(page, url);
  await record('fold-sheet', await foldPanes(page));

  // Bottom left onto top right: the lower half moves, lit over the paper.
  let corners = await foldedPaperCorners(page);
  await clickFolded(page, corners.bottomLeft);
  await clickFolded(page, corners.topRight);
  await record('fold-sheet-located', await foldPanes(page));

  await page.keyboard.press('Enter');
  await page.mouse.move(1, 1);
  await steadyShot(page, page.locator(FOLDED));
  await record('fold-step-1', await foldPanes(page));

  // The triangle's top left onto its bottom right: a fold across its two layers.
  corners = await foldedPaperCorners(page);
  await clickFolded(page, corners.topLeft);
  await clickFolded(page, corners.bottomRight);
  await record('fold-step-1-located', await foldPanes(page));
}

/**
 * A deep stack: `tests/fixtures/fold-examples/petal-fold.osf` opened as the
 * app opens a project, at its last step (the bird base). With Alt held the
 * valley fold's point is wherever the pointer is, on the paper on top there
 * (`topSheetPointAt`, the stack index's first answer), and the crease pattern
 * marks that sheet point: one shot per spot.
 */
async function foldStackCases(page, url, record) {
  await openFold(page, url);
  const text = await readFile(path.join(repoRoot, 'tests/fixtures/fold-examples/petal-fold.osf'), 'utf8');
  // File ▸ Open, with a file service that hands over the fixture.
  const opened = await page.evaluate(async (osf) => {
    const store = window.__treemakerWorkspaceStore;
    if (!store) throw new Error('Workspace store debug hook was not installed');
    const files = { openTextFile: async () => ({ text: osf, name: 'petal-fold.osf', path: null }) };
    return store.getState().openProject(files, { confirmDiscard: false });
  }, text);
  if (!opened) throw new Error('petal-fold.osf did not open');
  const next = page.getByRole('button', { name: 'Next step' });
  await next.waitFor({ state: 'visible' });
  for (let guard = 0; guard < 60 && (await next.isEnabled()); guard += 1) {
    await next.click();
    await steadyShot(page, page.locator(FOLDED));
  }
  await page.mouse.move(1, 1);
  await record('fold-bird-base', await foldPanes(page));

  const canvas = await page.locator(FOLDED).boundingBox();
  if (!canvas) throw new Error('No folded pane');
  const corners = await foldedPaperCorners(page);
  const across = (t, s) => ({
    x: corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * t,
    y: corners.topLeft.y + (corners.bottomLeft.y - corners.topLeft.y) * s,
  });
  await page.keyboard.down('Alt');
  try {
    for (const [name, t, s] of [
      ['middle', 0.5, 0.5],
      ['upper', 0.5, 0.3],
      ['left', 0.4, 0.6],
    ]) {
      const at = across(t, s);
      await page.mouse.move(at.x, at.y);
      await record(`fold-bird-base-free-${name}`, await foldPanes(page));
    }
  } finally {
    await page.keyboard.up('Alt');
  }
}

// ---------------------------------------------------------------------------
// The dialog's shell (U4)

const DIALOG = { role: 'dialog', name: 'Layer order' };
const FOLD_WASM_ROUTE = '**/oristudio_fold_wasm_bg.wasm*';

/**
 * Edit on kabuto, in `theme` (a preset's name, or null for the app's
 * default): `tests/fixtures/flat-folder/kabuto.fold` opened as File ▸ Open
 * does, then folded whole as Edit folds a selection. The fold's source and
 * paper scene are kept on `window.__layerOrderCheck`, from which each case
 * builds the request a host would.
 */
async function openKabutoInEdit(page, url, theme) {
  // Nothing of the dialog loads with the page, a file or a fold: no chunk, no worker, no Fold wasm.
  const early = [];
  const onRequest = (request) => early.push(request.url());
  const onWorker = (worker) => early.push(worker.url());
  // The context's requests, which include a worker's own (its wasm fetch); the page's do not.
  page.context().on('request', onRequest);
  page.on('worker', onWorker);
  await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, {
    timeout: 120000,
  });
  const text = await readFile(path.join(repoRoot, 'tests/fixtures/flat-folder/kabuto.fold'), 'utf8');
  await page.evaluate(
    async ({ fold, theme }) => {
      const store = window.__treemakerWorkspaceStore;
      const files = { openTextFile: async () => ({ text: fold, name: 'kabuto.fold', path: null }) };
      if (!(await store.getState().openProject(files, { confirmDiscard: false }))) throw new Error('kabuto did not open');
      if (theme) {
        const { useThemeStore } = await import('/src/store/themeStore.ts');
        useThemeStore.getState().setThemeByName(theme);
      }
      const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
      const figure = await runtime.foldOristudioCpDocument(1, 'Order5');
      const source = await runtime.getOristudioCpFoldedFigureSource(figure.handle);
      const scene = await runtime.getOristudioCpFoldedFigurePaperScene(figure.handle);
      if (!scene) throw new Error('kabuto folded with no subfaces');
      window.__layerOrderCheck = { source, scene };
    },
    { fold: text, theme }
  );
  page.context().off('request', onRequest);
  page.off('worker', onWorker);
  const loaded = early.filter((loadedUrl) =>
    /components\/layer-order\/LayerOrderDialog\.tsx|layerOrderWorker|oristudio_fold_wasm/.test(loadedUrl)
  );
  if (loaded.length > 0) throw new Error(`loaded before any open: ${loaded.join(', ')}`);
  console.log(`[${theme ?? 'default'}] before the open: ${early.length} requests, none of the dialog, its worker or the Fold wasm`);
}

/**
 * Open the dialog through its gateway, as a host does, on kabuto's fold (its
 * digest forged when `forge`); the answer lands on `window.__layerOrderOutcome`.
 */
async function openDialogOnKabuto(page, { forge = false } = {}) {
  await page.evaluate(async ({ forge }) => {
    const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
    const { DEFAULT_FOLDED_MODEL } = await import('/src/lib/orieditaNativeMetadata.ts');
    const { DEFAULT_PAPER_STYLE } = await import('/src/lib/paper/paperStyle.ts');
    const { PAPER_STYLE_POLICIES } = await import('/src/lib/paper/paperStyleResolve.ts');
    const { openLayerOrderDialog } = await import('/src/layer-order/dialog/layerOrderDialogGateway.ts');
    const { source, scene } = window.__layerOrderCheck;
    const editLines = () => {
      const { lineStyle, lineWidth } = window.__treemakerWorkspaceStore.getState().oristudioCpViewport;
      return { lineStyle, lineWidth };
    };
    const kernel = forge ? { ...source, digest: `${source.digest}-forged` } : source;
    window.__layerOrderOutcome = null;
    openLayerOrderDialog({
      source: layerOrderSourceOf(kernel, DEFAULT_FOLDED_MODEL),
      record: null,
      look: { style: DEFAULT_PAPER_STYLE, policy: PAPER_STYLE_POLICIES['folded-flat'], turnDeg: 0, side: 'front', xray: false, ...editLines() },
      shown: scene,
      name: 'Kabuto',
      byline: 'Traditional',
    }).then((outcome) => {
      window.__layerOrderOutcome = outcome;
    });
  }, { forge });
  // By its frame, not its name, which a locale translates.
  await anyDialog(page).waitFor({ state: 'visible', timeout: 30000 });
}

/** The modal on top, whatever its name says in the locale. */
function anyDialog(page) {
  return page.locator('[role="dialog"][aria-modal="true"][data-shortcut-barrier]').last();
}

/** How the last dialog ended, once it has: its kind, and for Apply what it handed over. */
async function dialogOutcome(page) {
  await page.waitForFunction(() => window.__layerOrderOutcome !== null, null, { timeout: 30000 });
  return page.evaluate(() => {
    const outcome = window.__layerOrderOutcome;
    if (outcome.kind !== 'applied') return { kind: outcome.kind };
    const { applied } = outcome;
    return { kind: 'applied', relations: applied.relations.length, constraints: applied.record.constraints.length };
  });
}

async function dialogShot(page) {
  const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
  await page.mouse.move(1, 1);
  return { dialog: await steadyShot(page, dialog, { masked: false }) };
}

/**
 * The shell's states, wide and as the whole screen, in one theme: opening (the
 * Fold wasm held back so the state stays), ready, refused (a forged digest),
 * lost (the Fold wasm refused) and, on a phone, ready on each pane.
 */
function dialogShellCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openKabutoInEdit(page, url, theme);
    const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
    const working = dialog.getByText('Working out the layer orders…');
    const ready = dialog.getByRole('complementary', { name: 'Layer order details' });

    // Opening: the worker can't start its engine until the wasm arrives.
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    // The worker's fetch reaches the route; a held request is not yet a `request` event.
    const wasmAsked = [];
    await page.context().route(FOLD_WASM_ROUTE, async (route) => {
      wasmAsked.push(route.request().url());
      await held;
      await route.continue();
    });
    // What the open loads, which nothing before it did (`openKabutoInEdit`).
    const opening = [];
    const onRequest = (request) => opening.push(request.url());
    const onWorker = (worker) => opening.push(worker.url());
    page.context().on('request', onRequest);
    page.on('worker', onWorker);
    await openDialogOnKabuto(page);
    await working.waitFor({ state: 'visible' });
    page.context().off('request', onRequest);
    page.off('worker', onWorker);
    for (const expected of [/components\/layer-order\/LayerOrderDialog\.tsx/, /layerOrderWorker/]) {
      if (!opening.some((loadedUrl) => expected.test(loadedUrl))) throw new Error(`the open never loaded ${expected}`);
    }
    // The worker loads its own code first, then asks for the wasm, which the route holds.
    for (let waited = 0; wasmAsked.length === 0 && waited < 60000; waited += 100) await page.waitForTimeout(100);
    if (wasmAsked.length === 0) throw new Error('the open never fetched the Fold wasm');
    console.log(`[${tag}] the open loaded the dialog's code, spawned its worker and fetched the Fold wasm`);
    await record(`dialog-${tag}-opening`, await dialogShot(page));
    release();
    await working.waitFor({ state: 'detached', timeout: 60000 });
    await page.context().unroute(FOLD_WASM_ROUTE);
    await ready.waitFor({ state: 'visible' });
    await record(`dialog-${tag}-ready`, await dialogShot(page));
    // Kabuto's own order, held whole, nothing added: Apply changes nothing (D16), and the host writes nothing.
    await dialog.getByRole('button', { name: 'Apply' }).click();
    const applied = await dialogOutcome(page);
    if (applied.kind !== 'unchanged') throw new Error(`Apply: ${JSON.stringify(applied)}`);
    console.log(`[${tag}] Apply on the host's own order answered unchanged`);

    await openDialogOnKabuto(page, { forge: true });
    await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 60000 });
    await record(`dialog-${tag}-refused`, await dialogShot(page));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    if ((await dialogOutcome(page)).kind !== 'cancelled') throw new Error('Cancel did not answer cancelled');

    // Lost: a fresh worker whose wasm never arrives.
    await page.context().route(FOLD_WASM_ROUTE, (route) => route.abort());
    await openDialogOnKabuto(page);
    await dialog.getByRole('button', { name: 'Try again' }).waitFor({ state: 'visible', timeout: 60000 });
    await record(`dialog-${tag}-lost`, await dialogShot(page));
    await page.context().unroute(FOLD_WASM_ROUTE);
    await page.keyboard.press('Escape');
    if ((await dialogOutcome(page)).kind !== 'cancelled') throw new Error('Escape did not answer cancelled');

    // The phone: the whole screen, one pane at a time.
    await page.setViewportSize(PHONE);
    await openDialogOnKabuto(page);
    await ready.waitFor({ state: 'visible', timeout: 60000 });
    await record(`dialog-${tag}-phone-folded`, await dialogShot(page));
    await dialog.getByRole('group', { name: 'Pane' }).getByRole('button', { name: 'Crease pattern' }).click();
    await record(`dialog-${tag}-phone-crease-pattern`, await dialogShot(page));
    await dialog.getByRole('button', { name: 'Close Layer order' }).click();
    if ((await dialogOutcome(page)).kind !== 'cancelled') throw new Error('Close did not answer cancelled');
    await page.setViewportSize(VIEWPORT);
  };
}

const PHONE = { width: 390, height: 844 };

/**
 * The dialog's title line on a phone, in the locales whose words run longest
 * and English: the title, the pane switch and the close button on one line
 * that never wraps, nothing past the screen's edge. Fails on a broken line.
 */
async function dialogPhoneLocales(page, url, record) {
  await openKabutoInEdit(page, url, null);
  for (const width of [360, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const lng of ['en', 'pt-BR', 'ru']) {
      await page.evaluate(async (lng) => {
        const i18n = (await import('/src/i18n/index.ts')).default;
        await i18n.changeLanguage(lng);
        await i18n.loadNamespaces(['dialogs']);
      }, lng);
      await openDialogOnKabuto(page);
      const dialog = anyDialog(page);
      await dialog.getByRole('complementary').waitFor({ state: 'visible', timeout: 60000 });
      const line = await page.evaluate(() => {
        const root = [...document.querySelectorAll('[role="dialog"][aria-modal="true"]')].at(-1);
        const bar = root.querySelector('[role="document"] > div');
        const close = bar.lastElementChild;
        const head = bar.children[0];
        const title = head.children[0];
        const lead = head.children[1];
        const box = (el) => el.getBoundingClientRect();
        const middle = (el) => Math.round(box(el).top + box(el).height / 2);
        return {
          title: title.textContent,
          clipped: title.scrollWidth > title.clientWidth,
          oneLine: middle(title) === middle(close) && middle(lead) === middle(close),
          inside: Math.round(box(close).right) <= window.innerWidth && Math.round(box(lead).right) <= Math.round(box(close).left),
          scrolls: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      const ok = line.oneLine && line.inside && !line.scrolls;
      console.log(`[phone ${width} ${lng}] ${ok ? 'one line' : 'BROKEN'}: "${line.title}"${line.clipped ? ' (truncated)' : ''}`);
      if (!ok) throw new Error(`the title line broke at ${width}px in ${lng}: ${JSON.stringify(line)}`);
      await page.mouse.move(1, 1);
      await record(`dialog-phone-${width}-${lng}`, { dialog: await steadyShot(page, dialog, { masked: false }) });
      await page.keyboard.press('Escape');
      await dialogOutcome(page);
    }
  }
  await page.evaluate(async () => (await import('/src/i18n/index.ts')).default.changeLanguage('en'));
  await page.setViewportSize(VIEWPORT);
}

/**
 * Fold's Import CP, ModalFrame's other user, wide and on a phone: a
 * screenshot each (for `compare`) and its DOM with every element's computed
 * style, written beside them as JSON, with CSS-module hashes left out. Run on
 * the base and on the change, then diff the two.
 */
async function foldImportFrame(page, url, record, { dir }) {
  await openFold(page, url);
  for (const size of [VIEWPORT, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await page.evaluate(async () => {
      const { useFoldImportUiStore } = await import('/src/fold/io/foldImportUiStore.ts');
      useFoldImportUiStore.getState().open();
    });
    const dialog = page.getByRole('dialog', { name: 'Import crease pattern' });
    await dialog.waitFor({ state: 'visible', timeout: 30000 });
    await page.mouse.move(1, 1);
    await settle(page);
    const dump = await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"][aria-label="Import crease pattern"]');
      const PROPS = [
        'display', 'position', 'box-sizing', 'width', 'height', 'min-width', 'max-width', 'margin', 'padding',
        'border', 'border-radius', 'background-color', 'color', 'font-size', 'font-weight', 'line-height',
        'flex', 'flex-wrap', 'order', 'align-items', 'justify-content', 'gap', 'grid-template-columns',
        'grid-row', 'grid-column', 'overflow', 'white-space', 'text-overflow',
      ];
      const walk = (el, depth) => {
        const cs = getComputedStyle(el);
        const attrs = [...el.attributes]
          .filter((a) => a.name !== 'class' && a.name !== 'style')
          .map((a) => `${a.name}=${a.value}`)
          .join(' ');
        const style = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
        return [{ depth, tag: el.tagName.toLowerCase(), attrs, text: el.children.length ? '' : (el.textContent ?? '').trim(), style }, ...[...el.children].flatMap((child) => walk(child, depth + 1))];
      };
      return walk(root, 0);
    });
    await writeFile(path.join(dir, `fold-import-frame-${size.width}.json`), `${JSON.stringify(dump, null, 1)}\n`);
    await record(`fold-import-${size.width}`, { dialog: await steadyShot(page, dialog, { masked: false }) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached' });
  }
  await page.setViewportSize(VIEWPORT);
}

// ---------------------------------------------------------------------------
// The Diagram step (H7)

/** What the Diagram's capture, the host engine and the dialog load: none of it may load at rest. */
const LAYER_ORDER_LOADS = /components\/layer-order\/LayerOrderDialog\.tsx|layerOrderWorker|oristudio_fold_wasm/;

/** Everything the page and its workers ask for from now, and the workers it starts, until `stop()`. */
function watchLoads(page) {
  const seen = [];
  const onRequest = (request) => seen.push(request.url());
  const onWorker = (worker) => seen.push(worker.url());
  page.context().on('request', onRequest);
  page.on('worker', onWorker);
  return {
    layerOrder: () => seen.filter((loaded) => LAYER_ORDER_LOADS.test(loaded)),
    count: () => seen.length,
    stop() {
      page.context().off('request', onRequest);
      page.off('worker', onWorker);
    },
  };
}

/**
 * Kabuto in Edit, a Diagram with one step linked to its sheet, folded flat,
 * the step open in Pose; the step's id on `window.__layerOrderStep`.
 */
async function linkKabutoStep(page) {
  await page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const { useLayoutStore } = await import('/src/store/layoutStore.ts');
    const { ensureCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
    const { sheetRegions } = await import('/src/cp-workspace/sheets/cpSheetRegions.ts');
    const { linkDiagramStep } = await import('/src/diagram/capture/stepCaptureActions.ts');
    useLayoutStore.getState().activateWorkspace('diagram');
    const index = await ensureCpSheetIndex(store.getState().oristudioCpDocument.document);
    const [sheet] = sheetRegions(index);
    const stepId = store.getState().addDiagramStep();
    if (!(await linkDiagramStep(stepId, sheet, 'folded'))) throw new Error('kabuto did not link');
    store.getState().openDiagramStep(stepId);
    window.__layerOrderStep = stepId;
  });
}

/**
 * A constraint that moves kabuto's step off the order it shows, worked out on
 * the host engine as the dialog would (open on the order shown, the first open
 * pair either way, the side that changes a spot), and applied as the dialog's
 * Apply is: through the Diagram's capture, as one undo step. What it was.
 */
async function applyConstraintToStep(page) {
  return page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const stepId = window.__layerOrderStep;
    const { stepById } = await import('/src/diagram/document/diagramDocument.ts');
    const { chooseStepCreases, knownCreasesOf } = await import('/src/diagram/capture/captureCreases.ts');
    const { resolveFoldRoute } = await import('/src/cp-workspace/folded/foldRoute.ts');
    const { peekCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
    const { captureModel } = await import('/src/diagram/capture/captureFolded.ts');
    const { stepFoldSource } = await import('/src/diagram/capture/captureLayerOrder.ts');
    const { createCpCaptureRuntime } = await import('/src/store/workspaceStore/cpFoldRuntimeBindings.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const { layerOrderSceneRelations } = await import('/src/layer-order/engine/layerOrderSceneRelations.ts');
    const state = store.getState();
    const source = stepById(state.diagram, stepId).source;
    const document = state.oristudioCpDocument.document;
    const choice = chooseStepCreases(document, source.scope, peekCpSheetIndex(document), knownCreasesOf(source));
    const route = resolveFoldRoute(document, choice.creases.foldLineIds);
    const folded = await stepFoldSource(createCpCaptureRuntime(0, null), route.lineIds, captureModel(document, source.render.side));
    const runtime = createLayerOrderRuntime({ role: 'host' });
    try {
      const { engine } = runtime;
      const opened = await engine.openShowing(folded.source, layerOrderSceneRelations(folded.scene), LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`open: ${JSON.stringify(opened)}`);
      const pairs = opened.open_pairs;
      let chosen = null;
      for (let k = 0; k + 1 < pairs.length && !chosen; k += 2) {
        for (const sign of [1, -1]) {
          const candidate = [pairs[k], pairs[k + 1], sign];
          const previewed = await engine.preview(candidate, LAYER_ORDER_LIMITS.preview);
          if (previewed.verdict === 'fits' && previewed.changed.front.length + previewed.changed.back.length > 0) {
            chosen = { candidate, token: previewed.token, spots: previewed.changed.front.length };
            break;
          }
        }
      }
      if (!chosen) throw new Error('no constraint moves kabuto off its order');
      await engine.commitPreview(chosen.token, [chosen.candidate], LAYER_ORDER_LIMITS.commit);
      const saved = await engine.save();
      if (saved.status !== 'ok') throw new Error(`save: ${JSON.stringify(saved)}`);
      const relations = await engine.relations();
      const applied = { record: saved.record, relations, source: folded.source };
      const outcome = await store.getState().captureDiagramStep(stepId, {
        scope: source.scope,
        known: knownCreasesOf(source),
        render: source.render,
        kind: 'diagram-capture',
        label: 'Change layer order',
        layerOrderApplied: { applied, frame: folded.frame },
      });
      return {
        outcome: outcome.status,
        candidate: chosen.candidate,
        spots: chosen.spots,
        openPairs: pairs.length / 2,
        undo: store.getState().diagramHistory.past.at(-1)?.label,
      };
    } finally {
      runtime.dispose();
    }
  });
}

/** The step detail's picture, the pose toolbar over it painted out. */
async function stageShot(page) {
  const stage = page.locator('[role="region"] [data-picture]').first();
  await page.mouse.move(1, 1);
  await settle(page);
  return stage.screenshot({ animations: 'disabled', mask: [page.getByRole('toolbar', { name: 'Pose' })], maskColor: '#ff00ff' });
}

async function pageShot(page) {
  await page.mouse.move(1, 1);
  await settle(page);
  await page.waitForTimeout(250);
  return page.screenshot({ animations: 'disabled' });
}

/** Wait for the step to stop capturing. */
async function captured(page) {
  await page.waitForFunction(
    () => Object.keys(window.__treemakerWorkspaceStore.getState().diagramCaptures).length === 0,
    null,
    { timeout: 120000 }
  );
  await settle(page);
}

/** Wait for the step to be shown `mode`, and done capturing. */
async function shownAs(page, mode) {
  await page.waitForFunction(
    (wanted) => {
      const state = window.__treemakerWorkspaceStore.getState();
      const step = state.diagram?.steps.find((entry) => entry.id === window.__layerOrderStep);
      return step?.source?.render.mode === wanted && Object.keys(state.diagramCaptures).length === 0;
    },
    mode,
    { timeout: 120000 }
  );
  await settle(page);
}

/**
 * Open the step's detail again. One opened on the Diagram's first mount holds
 * a controller React's dev double mount has already let go of (found in
 * passing; dev only, not this PR's), and its verbs would do nothing.
 */
async function reopenDetail(page) {
  await page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    store.getState().closeDiagramStep();
    await new Promise((resolve) => setTimeout(resolve, 300));
    store.getState().openDiagramStep(window.__layerOrderStep);
  });
  await page.waitForFunction(
    async () => {
      const { openLinkedPoseOf } = await import('/src/diagram/capture/openLinkedPose.ts');
      return openLinkedPoseOf(window.__layerOrderStep) !== null;
    },
    null,
    { timeout: 30000 }
  );
  await settle(page);
}

/** The open step's pager, as its Pose publishes it: the count, and whether › is held. */
async function pagerNow(page) {
  return page.evaluate(async () => {
    const { openLinkedPoseOf } = await import('/src/diagram/capture/openLinkedPose.ts');
    const pose = openLinkedPoseOf(window.__layerOrderStep);
    const next = pose?.actions.find((action) => action.id === 'next-solution');
    return { count: pose?.layerOrder?.count ?? null, nextHeld: next?.disabled ?? null };
  });
}

/** Run one of the open step's Pose verbs, and wait for its capture. */
async function poseVerb(page, id) {
  await page.evaluate(async (verb) => {
    const { openLinkedPoseOf } = await import('/src/diagram/capture/openLinkedPose.ts');
    openLinkedPoseOf(window.__layerOrderStep)?.actions.find((action) => action.id === verb)?.run();
  }, id);
  await page.waitForTimeout(200);
  await captured(page);
}

/** The step's source as the store holds it, with its record read. */
async function stepSource(page) {
  return page.evaluate(async () => {
    const { stepById } = await import('/src/diagram/document/diagramDocument.ts');
    const { stepLayerOrderOf } = await import('/src/diagram/capture/captureLayerOrder.ts');
    const source = stepById(window.__treemakerWorkspaceStore.getState().diagram, window.__layerOrderStep).source;
    const read = stepLayerOrderOf(source.layerOrder);
    return {
      mode: source.render.mode,
      constraints: read ? read.record.constraints.length : null,
      attention: read?.record.attention ?? null,
      picture: window.__treemakerWorkspaceStore.getState().diagram.steps.find((step) => step.id === window.__layerOrderStep)
        ?.picture?.key,
    };
  });
}

/**
 * A Diagram step with a layer order (H7), in one theme: the constrained order
 * drawn against the kernel's; nothing of the engine loaded by opening the
 * saved diagram and selecting the step; Show as and back; Refresh after an
 * edit that keeps the faces; a clash flagged with Review…; a step whose
 * creases now fold in 3D; and Edit… opening the dialog's shell.
 */
function diagramStepCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openKabutoInEdit(page, url, theme);
    await linkKabutoStep(page);
    await captured(page);
    const unconstrained = await stageShot(page);
    await record(`diagram-${tag}-unconstrained`, { stage: unconstrained });

    // Pose's facts are the record's order's too (#519 review, fix 4): turned in a chosen order, and
    // both undone, the pager counts the kernel's orders again, never the held fold's one of one.
    await reopenDetail(page);
    const pagerBefore = await pagerNow(page);
    const trial = await applyConstraintToStep(page);
    await captured(page);
    if (trial.outcome !== 'captured') throw new Error(`Apply: ${trial.outcome}`);
    await poseVerb(page, 'rotate-right');
    const pagerHeld = await pagerNow(page);
    await page.evaluate(() => {
      const state = window.__treemakerWorkspaceStore.getState();
      state.undoDiagram();
      state.undoDiagram();
    });
    await captured(page);
    await page.waitForTimeout(500);
    const pagerUndone = await pagerNow(page);
    const recordUndone = (await stepSource(page)).constraints;
    console.log(
      `[${tag}] pager: before ${JSON.stringify(pagerBefore)}, turned in the chosen order ${JSON.stringify(pagerHeld)}, both undone ${JSON.stringify(pagerUndone)} (record ${recordUndone})`
    );
    if (recordUndone !== null || pagerUndone.nextHeld !== pagerBefore.nextHeld || pagerUndone.count === null) {
      throw new Error('undo left the pager on the chosen order’s facts');
    }
    await record(`diagram-${tag}-pager-undone`, { page: await pageShot(page) });

    const applied = await applyConstraintToStep(page);
    await captured(page);
    console.log(`[${tag}] applied ${JSON.stringify(applied)}`);
    if (applied.outcome !== 'captured') throw new Error(`Apply: ${applied.outcome}`);
    const constrained = await stageShot(page);
    await record(`diagram-${tag}-constrained`, { stage: constrained });
    const differs = await pixelDiff(page, unconstrained, constrained);
    console.log(`[${tag}] constrained vs unconstrained: ${differs.differing} of ${differs.pixels} pixels differ`);
    if (!differs.sameSize || differs.differing === 0) throw new Error('the constrained order drew the same picture');

    // Saved, and opened again in a fresh page: nothing of the engine loads with it, nor as the step is shown.
    const saved = await page.evaluate(async () => {
      let text = null;
      const files = {
        saveTextFile: async (options) => {
          text = options.contents;
          return { name: 'kabuto-diagram.osf', path: null };
        },
      };
      if (!(await window.__treemakerWorkspaceStore.getState().saveProjectAs(files))) throw new Error('save failed');
      return { text, stepId: window.__layerOrderStep };
    });
    await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
    const loads = watchLoads(page);
    await page.evaluate(
      async ({ osf, stepId, theme }) => {
        const store = window.__treemakerWorkspaceStore;
        const files = { openTextFile: async () => ({ text: osf, name: 'kabuto-diagram.osf', path: null }) };
        if (!(await store.getState().openProject(files, { confirmDiscard: false }))) throw new Error('the diagram did not open');
        if (theme) {
          const { useThemeStore } = await import('/src/store/themeStore.ts');
          useThemeStore.getState().setThemeByName(theme);
        }
        const { useLayoutStore } = await import('/src/store/layoutStore.ts');
        useLayoutStore.getState().activateWorkspace('diagram');
        store.getState().selectDiagramStep(stepId);
        store.getState().openDiagramStep(stepId);
        window.__layerOrderStep = stepId;
      },
      { osf: saved.text, stepId: saved.stepId, theme }
    );
    const row = page.locator('[data-field-row]', { hasText: 'Layer order' });
    await row.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1500);
    const reopened = await pageShot(page);
    loads.stop();
    if (loads.layerOrder().length > 0) throw new Error(`loaded at rest: ${loads.layerOrder().join(', ')}`);
    console.log(`[${tag}] reopened and shown: ${loads.count()} requests, none of the dialog, its worker or the Fold wasm`);
    await record(`diagram-${tag}-pane-constrained`, { page: reopened });
    const reopenedStage = await stageShot(page);
    const same = await pixelDiff(page, constrained, reopenedStage);
    console.log(`[${tag}] reopened picture vs the constrained one: ${same.differing} pixels differ`);

    // Show as Crease Pattern, then Folded again, from the Step pane (through the open step's Pose):
    // the record survives and is drawn again. The detail is opened again first (`reopenDetail`).
    await reopenDetail(page);
    await row.waitFor({ state: 'visible', timeout: 60000 });
    const showAs = page.getByRole('group', { name: 'Show as' });
    await showAs.getByRole('button', { name: 'Crease Pattern' }).click();
    await shownAs(page, 'crease-pattern');
    const asPattern = await stepSource(page);
    await record(`diagram-${tag}-show-as-pattern`, { stage: await stageShot(page) });
    await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Folded' }).click();
    await shownAs(page, 'folded-flat');
    const back = await stepSource(page);
    console.log(`[${tag}] Show as: crease pattern ${JSON.stringify(asPattern)}, folded ${JSON.stringify(back)}`);
    if (asPattern.constraints !== 1 || asPattern.mode !== 'crease-pattern' || back.constraints !== 1) {
      throw new Error('Show as lost the record');
    }
    const shownBack = await stageShot(page);
    await record(`diagram-${tag}-show-as-back`, { stage: shownBack });
    const roundTrip = await pixelDiff(page, constrained, shownBack);
    console.log(`[${tag}] Show as round trip vs the constrained picture: ${roundTrip.differing} pixels differ`);

    // An edit that keeps every face: a border line split in two. The link goes out of date; Refresh restores the record.
    const edit = await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const lines = store.getState().oristudioCpDocument.document.crease_pattern.line_segments;
      const ys = lines.flatMap((line) => [line.a.y, line.b.y]);
      const minY = Math.min(...ys);
      const index = lines.findIndex(
        (line) => line.color === 'Black0' && Math.abs(line.a.y - minY) < 1e-9 && Math.abs(line.b.y - minY) < 1e-9
      );
      if (index < 0) throw new Error('no border line on the bottom');
      const line = lines[index];
      const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
      await store.getState().replaceOristudioCpLineSegments([index + 1], [{ ...line, b: mid }, { ...line, a: mid }], 'Split border');
      return { lineId: index + 1 };
    });
    console.log(`[${tag}] edited: split border line ${edit.lineId}`);
    const revision = await page.evaluate(
      () => window.__treemakerWorkspaceStore.getState().diagram.steps.find((step) => step.id === window.__layerOrderStep).revision
    );
    await page.getByRole('button', { name: 'Refresh Picture' }).click();
    await page.waitForFunction(
      (was) => {
        const state = window.__treemakerWorkspaceStore.getState();
        const step = state.diagram.steps.find((entry) => entry.id === window.__layerOrderStep);
        return step.revision > was && Object.keys(state.diagramCaptures).length === 0;
      },
      revision,
      { timeout: 120000 }
    );
    await settle(page);
    const refreshed = await stepSource(page);
    console.log(`[${tag}] refreshed after the edit: ${JSON.stringify(refreshed)}`);
    if (refreshed.constraints !== 1 || refreshed.attention) throw new Error('Refresh did not restore the record');
    const afterEdit = await stageShot(page);
    await record(`diagram-${tag}-refreshed`, { stage: afterEdit });
    const kept = await pixelDiff(page, constrained, afterEdit);
    console.log(`[${tag}] refreshed picture vs the constrained one: ${kept.differing} pixels differ`);

    // A forced clash: the record's constraint and its opposite. Refresh keeps the picture and flags the step.
    await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const { stepById, setLinkedLayerOrder } = await import('/src/diagram/document/diagramDocument.ts');
      const { stepLayerOrderOf } = await import('/src/diagram/capture/captureLayerOrder.ts');
      const { encodeLayerOrderRecord } = await import('/src/lib/layerOrder/layerOrderRecord.ts');
      const stepId = window.__layerOrderStep;
      const source = stepById(store.getState().diagram, stepId).source;
      const { record } = stepLayerOrderOf(source.layerOrder);
      const [f, g, sign] = record.constraints[0];
      const clashing = encodeLayerOrderRecord({ ...record, constraints: [...record.constraints, [f, g, -sign]] });
      store.setState({ diagram: setLinkedLayerOrder(store.getState().diagram, stepId, clashing.json) });
    });
    const pictureBefore = (await stepSource(page)).picture;
    await page.evaluate(async () => {
      const { refreshDiagramStep } = await import('/src/diagram/capture/stepCaptureActions.ts');
      await refreshDiagramStep(window.__layerOrderStep);
    });
    await captured(page);
    const clashed = await stepSource(page);
    console.log(`[${tag}] clash: ${JSON.stringify(clashed)}`);
    if (clashed.attention?.reason !== 'conflict' || clashed.picture !== pictureBefore) {
      throw new Error('the clash did not keep the picture and flag the step');
    }
    await page.getByRole('button', { name: 'Review…' }).waitFor({ state: 'visible', timeout: 10000 });
    await record(`diagram-${tag}-pane-attention`, { page: await pageShot(page) });

    // Edit… opens the dialog's shell on the step; Cancel writes nothing. The Step pane's, by its row:
    // the Pose toolbar's Edit order… has the same name (H8).
    const entries = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().diagramHistory.past.length);
    await row.getByRole('button', { name: 'Edit Layer Order…' }).click();
    const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(3000);
    await record(`diagram-${tag}-dialog`, { dialog: await steadyShot(page, dialog, { masked: false, timeoutMs: 60000 }) });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    const after = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().diagramHistory.past.length);
    if (after !== entries) throw new Error('Cancel wrote something');
    console.log(`[${tag}] Edit… opened the dialog; Cancel wrote nothing`);

    // The flagged card reads Needs attention, not Out of date (#519 review, fix 9).
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().closeDiagramStep());
    const chip = page.locator('[data-tone]', { hasText: 'Needs attention' }).first();
    await chip.waitFor({ state: 'visible', timeout: 10000 });
    await record(`diagram-${tag}-card-attention`, { page: await pageShot(page) });
    console.log(`[${tag}] the flagged card reads ${JSON.stringify(await chip.textContent())}`);
    await reopenDetail(page);

    // Shown as its crease pattern, the flagged step's Review… still opens the dialog, on the flat fold
    // the step would show (#519 review, fix 2); Cancel writes nothing.
    await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Crease Pattern' }).click();
    await shownAs(page, 'crease-pattern');
    const review = page.getByRole('button', { name: 'Review…' });
    await review.waitFor({ state: 'visible', timeout: 10000 });
    if ((await review.getAttribute('aria-disabled')) === 'true') throw new Error('Review… is held on a crease pattern');
    await record(`diagram-${tag}-pane-attention-pattern`, { page: await pageShot(page) });
    const reviewEntries = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().diagramHistory.past.length);
    await review.click();
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(3000);
    await record(`diagram-${tag}-review-from-pattern`, { dialog: await steadyShot(page, dialog, { masked: false, timeoutMs: 60000 }) });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    const reviewed = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().diagramHistory.past.length);
    if (reviewed !== reviewEntries) throw new Error('Cancel from Review… wrote something');
    console.log(`[${tag}] Review… opened the dialog from the crease pattern; Cancel wrote nothing`);

    // The creases now fold in 3D: Refresh draws the 3D picture, keeps the record and flags it waiting.
    const route = await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const lines = store.getState().oristudioCpDocument.document.crease_pattern.line_segments;
      const index = lines.findIndex((line) => line.color === 'Red1' || line.color === 'Blue2');
      await store.getState().replaceOristudioCpLineSegments([index + 1], [{ ...lines[index], fold_magnitude: 90 }], 'Partial fold');
      const { refreshDiagramStep } = await import('/src/diagram/capture/stepCaptureActions.ts');
      return refreshDiagramStep(window.__layerOrderStep);
    });
    await captured(page);
    let in3d = await stepSource(page);
    console.log(`[${tag}] after a partial fold: refreshed ${route}, ${JSON.stringify(in3d)}`);
    if (in3d.mode !== 'folded-3d') {
      // Kabuto's 3D fold refused that crease: the row's 3D state is shown on the step's render alone.
      await page.evaluate(async () => {
        const store = window.__treemakerWorkspaceStore;
        const diagram = store.getState().diagram;
        const camera = { yaw: 0, pitch: 0, zoom: 1 };
        store.setState({
          diagram: {
            ...diagram,
            steps: diagram.steps.map((step) =>
              step.id === window.__layerOrderStep ? { ...step, source: { ...step.source, render: { mode: 'folded-3d', side: 'front', camera } } } : step
            ),
          },
        });
      });
      in3d = await stepSource(page);
      console.log(`[${tag}] 3D refused for kabuto; the 3D row shown on the render: ${JSON.stringify(in3d)}`);
    }
    const paneEdit = row.getByRole('button', { name: 'Edit Layer Order…' });
    await paneEdit.waitFor({ state: 'visible' });
    if ((await paneEdit.getAttribute('aria-disabled')) !== 'true') {
      throw new Error('Edit… is not held on a 3D step');
    }
    await record(`diagram-${tag}-pane-3d`, { page: await pageShot(page) });
  };
}

/**
 * Refresh All offline (#519 second review): five constrained steps and one
 * without a record, all out of date, refreshed with the network gone. The
 * host engine is asked once, the constrained steps after it counted; the
 * unconstrained one refreshes; one toast counts them, and the app's error
 * toast ("The worker stopped unexpectedly.") says nothing.
 */
function diagramStepOfflineCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openKabutoInEdit(page, url, theme);
    await linkKabutoStep(page);
    await captured(page);
    const applied = await applyConstraintToStep(page);
    await captured(page);
    if (applied.outcome !== 'captured') throw new Error(`Apply: ${applied.outcome}`);
    await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const { ensureCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
      const { sheetRegions } = await import('/src/cp-workspace/sheets/cpSheetRegions.ts');
      const { linkDiagramStep } = await import('/src/diagram/capture/stepCaptureActions.ts');
      store.getState().closeDiagramStep();
      // Four copies, record and all: five constrained steps.
      for (let i = 0; i < 4; i += 1) store.getState().duplicateDiagramStep(window.__layerOrderStep);
      const [sheet] = sheetRegions(await ensureCpSheetIndex(store.getState().oristudioCpDocument.document));
      const plain = store.getState().addDiagramStep();
      if (!(await linkDiagramStep(plain, sheet, 'folded'))) throw new Error('the plain step did not link');
      // An edit that keeps every face: every step goes out of date.
      const lines = store.getState().oristudioCpDocument.document.crease_pattern.line_segments;
      const minY = Math.min(...lines.flatMap((line) => [line.a.y, line.b.y]));
      const index = lines.findIndex(
        (line) => line.color === 'Black0' && Math.abs(line.a.y - minY) < 1e-9 && Math.abs(line.b.y - minY) < 1e-9
      );
      const line = lines[index];
      const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
      await store.getState().replaceOristudioCpLineSegments([index + 1], [{ ...line, b: mid }, { ...line, a: mid }], 'Split border');
      // What the run needs, loaded while online: Refresh All, and the host engine's code (not its worker).
      window.__refreshAll = (await import('/src/diagram/capture/captureQueue.ts')).refreshAllDiagramSteps;
      await (await import('/src/layer-order/host/hostEngineGateway.ts')).loadLayerOrderHostEngine();
      const Spawning = window.Worker;
      window.__spawned = [];
      window.Worker = class extends Spawning {
        constructor(...args) {
          super(...args);
          window.__spawned.push(String(args[0]));
        }
      };
    });
    await settle(page);

    await page.context().setOffline(true);
    const result = await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const refreshed = await window.__refreshAll();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { stepLayerOrderOf } = await import('/src/diagram/capture/captureLayerOrder.ts');
      const steps = store.getState().diagram.steps.filter((step) => step.source?.kind === 'cp');
      return {
        refreshed,
        layerOrderWorkers: window.__spawned.filter((spawned) => spawned.includes('layerOrderWorker')).length,
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((toast) => toast.textContent?.trim()),
        error: store.getState().error,
        flagged: steps.filter((step) => stepLayerOrderOf(step.source.layerOrder)?.record.attention).length,
        constrained: steps.filter((step) => step.source.layerOrder !== undefined).length,
      };
    });
    await record(`diagram-${tag}-offline-refresh-all`, { page: await pageShot(page) });
    await page.context().setOffline(false);
    console.log(`[${tag}] offline Refresh All: ${JSON.stringify(result)}`);
    // Offline, with Reload: only a reload retries a load that failed.
    const said =
      'Layer order couldn’t load while offline, so 5 steps weren’t changed. Reconnect, then reload Ori Studio to try again.';
    if (result.refreshed !== 1) throw new Error('offline Refresh All did not refresh the unconstrained step alone');
    if (result.layerOrderWorkers > 1) throw new Error(`offline Refresh All spawned ${result.layerOrderWorkers} workers`);
    if (!result.toasts.some((toast) => toast?.includes(said))) throw new Error('offline Refresh All did not count its steps');
    if (result.toasts.some((toast) => toast?.includes('stopped unexpectedly')) || result.error) {
      throw new Error('offline Refresh All raised the app’s error toast');
    }
    if (result.flagged !== 0 || result.constrained !== 5) throw new Error('offline Refresh All wrote to a record');
  };
}

// ---------------------------------------------------------------------------
// Pose (H8)

/** The step detail's Pose toolbar. */
function poseToolbar(page) {
  return page.getByRole('toolbar', { name: 'Pose' });
}

/** The toolbar's controls by name, whether ‹, › and Edit order… are held, and what it reads. */
async function poseToolbarState(page) {
  const bar = poseToolbar(page);
  const held = async (name) => (await bar.getByRole('button', { name }).getAttribute('aria-disabled')) === 'true';
  return {
    previous: await held('Previous Layer Order'),
    next: await held('Next Layer Order'),
    edit: await held(EDIT_ORDER),
    // Each button's accessible name: its label, or the words it shows.
    names: await bar
      .locator('button')
      .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label') ?? button.textContent)),
    editTitle: await bar.getByRole('button', { name: EDIT_ORDER }).getAttribute('title'),
    text: (await bar.textContent()) ?? '',
  };
}

/** Pose's Edit order…, named by the word it shows. */
const EDIT_ORDER = 'Edit order…';

/** The toolbar, with the tooltip of the control named `hover` up when given. */
async function toolbarShot(page, hover = null) {
  const bar = poseToolbar(page);
  // Away first: a control just pressed under the pointer has had its tooltip dismissed.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(300);
  if (hover) {
    await bar.getByRole('button', { name: hover }).hover();
    await page.waitForTimeout(900);
  }
  await settle(page);
  const box = await bar.boundingBox();
  const x = Math.max(0, Math.floor(box.x - 24));
  const y = Math.max(0, Math.floor(box.y - 64));
  return page.screenshot({
    animations: 'disabled',
    clip: { x, y, width: Math.min(VIEWPORT.width - x, Math.ceil(box.width + 48)), height: Math.ceil(box.height + 88) },
  });
}

/** Run one of the open step's Pose verbs from the toolbar, and wait for its capture. */
async function toolbarVerb(page, name) {
  await poseToolbar(page).getByRole('button', { name }).click();
  await page.waitForTimeout(200);
  await captured(page);
}

/**
 * The request the open dialog was given, against the kernel's own: the step's
 * creases folded afresh at its case (and at the first, to tell them apart),
 * its scene read. What Pose's held fold is, if Edit order… opened on it.
 */
async function dialogRequestAgainstKernel(page) {
  return page.evaluate(async () => {
    const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
    const { stepById } = await import('/src/diagram/document/diagramDocument.ts');
    const { chooseStepCreases, knownCreasesOf } = await import('/src/diagram/capture/captureCreases.ts');
    const { resolveFoldRoute } = await import('/src/cp-workspace/folded/foldRoute.ts');
    const { peekCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
    const { captureModel } = await import('/src/diagram/capture/captureFolded.ts');
    const { stepFoldSource } = await import('/src/diagram/capture/captureLayerOrder.ts');
    const { createCpCaptureRuntime } = await import('/src/store/workspaceStore/cpFoldRuntimeBindings.ts');
    const request = useLayerOrderDialogStore.getState().opening?.request;
    if (!request) throw new Error('no dialog is open');
    const state = window.__treemakerWorkspaceStore.getState();
    const source = stepById(state.diagram, window.__layerOrderStep).source;
    const document = state.oristudioCpDocument.document;
    const choice = chooseStepCreases(document, source.scope, peekCpSheetIndex(document), knownCreasesOf(source));
    const route = resolveFoldRoute(document, choice.creases.foldLineIds);
    const runtime = createCpCaptureRuntime(0, null);
    const model = captureModel(document, source.render.side);
    const atCase = await stepFoldSource(runtime, route.lineIds, model, source.render.foldCase);
    const atFirst = await stepFoldSource(runtime, route.lineIds, model, 1);
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return {
      foldCase: source.render.foldCase,
      turnDeg: request.look.turnDeg,
      rotationDeg: source.render.rotationDeg,
      record: request.record ? request.record.constraints.length : null,
      shown: request.shown ? (same(request.shown, atCase.scene) ? 'the step’s case' : same(request.shown, atFirst.scene) ? 'the first' : 'another') : null,
      firstDiffers: !same(atCase.scene, atFirst.scene),
      digest: request.source.digest === atCase.source.digest,
      name: request.name ?? null,
      surface: request.surface ?? null,
    };
  });
}

/**
 * Answer the open dialog with Apply, as its inspector will once U10 lands: on
 * the host engine, opened on the request the host gave (its source and the
 * scene it shows), the first open pair whose constraint moves a spot, saved,
 * with its relations; handed back through the dialog's store as `applied`.
 */
async function applyThroughOpenDialog(page) {
  return page.evaluate(async () => {
    const { useLayerOrderDialogStore, settleLayerOrderDialog } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const { layerOrderSceneRelations } = await import('/src/layer-order/engine/layerOrderSceneRelations.ts');
    const opening = useLayerOrderDialogStore.getState().opening;
    if (!opening) throw new Error('no dialog is open');
    const { request } = opening;
    const runtime = createLayerOrderRuntime({ role: 'host' });
    try {
      const { engine } = runtime;
      const opened = await engine.openShowing(request.source, layerOrderSceneRelations(request.shown), LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`open: ${JSON.stringify(opened)}`);
      const pairs = opened.open_pairs;
      let chosen = null;
      for (let k = 0; k + 1 < pairs.length && !chosen; k += 2) {
        for (const sign of [1, -1]) {
          const candidate = [pairs[k], pairs[k + 1], sign];
          const previewed = await engine.preview(candidate, LAYER_ORDER_LIMITS.preview);
          if (previewed.verdict === 'fits' && previewed.changed.front.length + previewed.changed.back.length > 0) {
            chosen = { candidate, token: previewed.token };
            break;
          }
        }
      }
      if (!chosen) throw new Error('no constraint moves the step off its order');
      await engine.commitPreview(chosen.token, [chosen.candidate], LAYER_ORDER_LIMITS.commit);
      const saved = await engine.save();
      if (saved.status !== 'ok') throw new Error(`save: ${JSON.stringify(saved)}`);
      const relations = await engine.relations();
      const applied = { record: saved.record, relations, source: request.source };
      if (!settleLayerOrderDialog(opening.id, { kind: 'applied', applied })) throw new Error('the dialog had already answered');
      // Let the app answer Apply (the dialog closing, Pose capturing the order) before this returns.
      // Chromium holds an evaluate's promise weakly: a GC in those microtasks, after it settles but
      // before Playwright hears, drops the answer ("Promise was collected"), which Playwright reports
      // as "Execution context was destroyed, most likely because of a navigation". Nothing navigates.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return { candidate: chosen.candidate, relations: relations.length / 2 };
    } finally {
      runtime.dispose();
    }
  });
}

/**
 * The #523 review's race, swept: for each delay, an Apply through Pose, then
 * Turn Over and, `delay` ms later, Undo as ⌘Z runs it (the menu action: the
 * canvas sessions hear it, then the history moves). Per round: the toasts
 * that say a capture failed, and whether a record was left once every Apply
 * was undone again.
 */
const RACE_DELAYS_MS = (process.env.POSE_RACE_DELAYS ?? '0,2,4,6,8,10,12,14,16,18,20,25,30,40,60')
  .split(',')
  .map(Number);

async function undoRaceSweep(page, delays) {
  await page.evaluate(() => {
    if (window.__toastsSeen) return;
    window.__toastsSeen = [];
    new MutationObserver(() => {
      for (const node of document.querySelectorAll('[data-sonner-toast]')) {
        if (node.__seen) continue;
        node.__seen = true;
        window.__toastsSeen.push(node.textContent ?? '');
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  const undo = () =>
    page.evaluate(async () => {
      const { handleMenuAction } = await import('/src/commands/menuActions.ts');
      await handleMenuAction('edit.undo');
    });
  const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
  const rounds = [];
  for (const delay of delays) {
    await poseToolbar(page).getByRole('button', { name: EDIT_ORDER }).click();
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    await applyThroughOpenDialog(page);
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    await captured(page);
    const seen = await page.evaluate(() => window.__toastsSeen.length);
    await page.evaluate(async (wait) => {
      const { openLinkedPoseOf } = await import('/src/diagram/capture/openLinkedPose.ts');
      const { handleMenuAction } = await import('/src/commands/menuActions.ts');
      openLinkedPoseOf(window.__layerOrderStep)
        .actions.find((action) => action.id === 'turn-over')
        .run();
      await new Promise((resolve) => setTimeout(resolve, wait));
      await handleMenuAction('edit.undo');
    }, delay);
    await page.waitForTimeout(300);
    await captured(page);
    const errors = (await page.evaluate((from) => window.__toastsSeen.slice(from), seen)).filter((text) =>
      /couldn.t be captured|invalid folded figure handle|stopped unexpectedly/i.test(text)
    );
    // The turn may have landed before the undo, which then took it back instead: undo to no record.
    for (let more = 0; more < 4 && (await poseNow(page)).layerOrder; more += 1) {
      await undo();
      await captured(page);
    }
    rounds.push({ delay, errors, record: (await poseNow(page)).layerOrder !== null });
  }
  return rounds;
}

/** The step selected, its source's render and record, and how many undo steps there are. */
async function poseNow(page) {
  return page.evaluate(async () => {
    const { stepById } = await import('/src/diagram/document/diagramDocument.ts');
    const state = window.__treemakerWorkspaceStore.getState();
    const source = stepById(state.diagram, window.__layerOrderStep).source;
    return {
      selected: state.diagramSelectedStepId,
      detail: state.diagramDetail,
      render: source.render,
      layerOrder: source.layerOrder ?? null,
      entries: state.diagramHistory.past.length,
    };
  });
}

/**
 * The Pose toolbar (H8) on kabuto's step, in one theme: ‹ › with no readout
 * and Edit order… after them; each held at its end; Edit order… opening the
 * dialog on the fold Pose holds — at the step's own layer order, past the
 * first — with Pose's keys standing down while it is open, and Cancel
 * writing nothing; then the same step constrained: ‹ › offered at rest (H9),
 * and Edit order… opening on its record.
 */
function poseToolbarCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openKabutoInEdit(page, url, theme);
    await linkKabutoStep(page);
    await captured(page);
    // A second step, so a step key has somewhere to go.
    await page.evaluate(() => {
      const store = window.__treemakerWorkspaceStore;
      store.getState().addDiagramStep();
      store.getState().selectDiagramStep(window.__layerOrderStep);
      store.getState().openDiagramStep(window.__layerOrderStep);
    });
    await reopenDetail(page);
    const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });

    // Unconstrained, at the first order: ‹ held, › free, no readout between them, Edit order… after.
    const first = await poseToolbarState(page);
    console.log(`[${tag}] toolbar at the first order: ${JSON.stringify(first)}`);
    const at = first.names.indexOf('Previous Layer Order');
    if (
      JSON.stringify(first.names.slice(at, at + 5)) !==
      JSON.stringify(['Previous Layer Order', 'Next Layer Order', EDIT_ORDER, 'Spread Layers', 'Reset Pose'])
    ) {
      throw new Error('the toolbar is not ‹ › Edit order… Spread Reset');
    }
    // Named by its word (label in name), titled in full.
    if (first.editTitle !== 'Edit layer order…') throw new Error(`Edit order…'s tooltip: ${first.editTitle}`);
    if (/\d\s*of\s*\d|Layer order \d/.test(first.text)) throw new Error(`the toolbar reads out a place: ${first.text}`);
    if (!first.previous || first.next || first.edit) throw new Error('at the first order: ‹ held, › and Edit order… free');
    await record(`pose-${tag}-toolbar-first`, { toolbar: await toolbarShot(page, 'Previous Layer Order') });

    // On to the last: › until it holds, which it does once the count is done.
    let steps = 0;
    for (; steps < 24 && !(await poseToolbarState(page)).next; steps += 1) await toolbarVerb(page, 'Next Layer Order');
    const last = await poseToolbarState(page);
    const lastCase = (await poseNow(page)).render.foldCase;
    console.log(`[${tag}] after ${steps} presses of ›: order ${lastCase}, ${JSON.stringify({ previous: last.previous, next: last.next })}`);
    if (!last.next || last.previous) throw new Error('at the last order: › held, ‹ free');
    await record(`pose-${tag}-toolbar-last`, { toolbar: await toolbarShot(page, 'Next Layer Order') });

    // Edit order… on the fold Pose holds, at the step's own order.
    const before = await poseNow(page);
    await poseToolbar(page).getByRole('button', { name: EDIT_ORDER }).click();
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    const asked = await dialogRequestAgainstKernel(page);
    console.log(`[${tag}] Edit order… asked: ${JSON.stringify(asked)}`);
    if (
      asked.shown !== 'the step’s case' ||
      asked.record !== null ||
      !asked.digest ||
      asked.turnDeg !== asked.rotationDeg ||
      asked.surface !== 'pose'
    ) {
      throw new Error('Edit order… did not open on the step’s held fold');
    }
    if (asked.foldCase > 1 && !asked.firstDiffers) console.log(`[${tag}] (order ${asked.foldCase} draws as the first does)`);

    // Pose's keys stand down while it is open: the step keys move nothing.
    for (const key of [']', '[', 'ArrowRight', 'End', 'Home']) await page.keyboard.press(key);
    const during = await poseNow(page);
    if (during.selected !== before.selected || during.detail !== before.detail || during.render.foldCase !== before.render.foldCase) {
      throw new Error(`a key reached Pose behind the dialog: ${JSON.stringify(during)}`);
    }
    await page.waitForTimeout(2500);
    await record(`pose-${tag}-dialog`, { dialog: await steadyShot(page, dialog, { masked: false, timeoutMs: 60000 }) });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    const cancelled = await poseNow(page);
    if (cancelled.entries !== before.entries || cancelled.layerOrder !== before.layerOrder) throw new Error('Cancel wrote something');
    console.log(`[${tag}] keys behind the dialog moved nothing; Cancel wrote nothing (${cancelled.entries} undo steps, record ${cancelled.layerOrder})`);
    // And once it is closed they answer again.
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(']');
    await page.waitForFunction((was) => window.__treemakerWorkspaceStore.getState().diagramSelectedStepId !== was, before.selected, {
      timeout: 5000,
    });
    console.log(`[${tag}] after the dialog closed, ] went on to the next step`);
    await page.evaluate(() => {
      const store = window.__treemakerWorkspaceStore;
      store.getState().selectDiagramStep(window.__layerOrderStep);
      store.getState().openDiagramStep(window.__layerOrderStep);
    });
    await reopenDetail(page);

    // Apply through Pose → undo → Turn Over draws the order before Apply. The dialog's Apply waits for
    // U10, so its answer is given through its store, as that Apply will give it: an order worked out on
    // the host engine from the request Pose opened it with (`applyThroughOpenDialog`).
    const preApplyShot = await stageShot(page);
    await record(`pose-${tag}-before-apply`, { stage: preApplyShot });
    await toolbarVerb(page, 'Turn Over');
    const beforeTurned = await stageShot(page);
    await record(`pose-${tag}-before-apply-turned`, { stage: beforeTurned });
    await toolbarVerb(page, 'Turn Over');
    const ready = await poseNow(page);
    await poseToolbar(page).getByRole('button', { name: EDIT_ORDER }).click();
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    const answered = await applyThroughOpenDialog(page);
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    await page.waitForFunction((was) => window.__treemakerWorkspaceStore.getState().diagramHistory.past.length > was, ready.entries, {
      timeout: 120000,
    });
    await captured(page);
    const afterApply = await poseNow(page);
    const label = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().diagramHistory.past.at(-1)?.label);
    const appliedShot = await stageShot(page);
    const appliedDiffers = await pixelDiff(page, preApplyShot, appliedShot);
    console.log(
      `[${tag}] Apply through Pose: ${JSON.stringify(answered)}, one undo step "${label}" (${afterApply.entries - ready.entries}), ` +
        `record ${afterApply.layerOrder ? 'written' : 'none'}, ${appliedDiffers.differing} of ${appliedDiffers.pixels} pixels changed`
    );
    // One undo step, named as the Step pane's Apply names it.
    if (afterApply.entries - ready.entries !== 1 || label !== 'Change layer order' || !afterApply.layerOrder || appliedDiffers.differing === 0) {
      throw new Error('Apply through Pose did not write its order as one undo step');
    }
    await record(`pose-${tag}-applied`, { stage: appliedShot });
    await page.evaluate(async () => {
      const { handleMenuAction } = await import('/src/commands/menuActions.ts');
      await handleMenuAction('edit.undo');
    });
    await captured(page);
    const undone = await poseNow(page);
    if (undone.layerOrder !== ready.layerOrder) throw new Error('undo left the applied record');
    await toolbarVerb(page, 'Turn Over');
    const undoneTurned = await stageShot(page);
    const preApply = await pixelDiff(page, beforeTurned, undoneTurned);
    console.log(`[${tag}] Apply → undo → Turn Over vs the order before Apply turned over: ${preApply.differing} pixels differ`);
    if (preApply.differing !== 0) throw new Error('Turn Over after the undo did not draw the order before Apply');
    await record(`pose-${tag}-undone-turned`, { stage: undoneTurned });
    await toolbarVerb(page, 'Turn Over');

    // The #523 review's race: Apply, Turn Over, then ⌘Z some milliseconds later, while the turn may still
    // be reading the fold the undo takes the order of. Nothing may say the picture couldn't be captured.
    const raced = await undoRaceSweep(page, RACE_DELAYS_MS);
    console.log(`[${tag}] Apply, Turn Over, undo after ${raced.map((round) => `${round.delay}ms`).join(', ')}: ${JSON.stringify(raced.flatMap((round) => round.errors))}`);
    if (raced.some((round) => round.errors.length > 0 || round.record)) throw new Error('an undo under a turn failed it');

    // Constrained: ‹ › offered at rest, from saved data (H9 lifted D9's hold; `diagramSolutionCases` steps
    // them), and Edit order… opening on the record.
    const applied = await applyConstraintToStep(page);
    await captured(page);
    if (applied.outcome !== 'captured') throw new Error(`Apply: ${applied.outcome}`);
    const constrained = await poseToolbarState(page);
    console.log(`[${tag}] constrained toolbar: ${JSON.stringify({ previous: constrained.previous, next: constrained.next, edit: constrained.edit })}`);
    if (constrained.previous || constrained.next || constrained.edit) throw new Error('constrained: ‹ › offered at rest, Edit order… free');
    await record(`pose-${tag}-toolbar-constrained`, { toolbar: await toolbarShot(page, 'Next Layer Order') });
    const constrainedBefore = await poseNow(page);
    await poseToolbar(page).getByRole('button', { name: EDIT_ORDER }).click();
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    const askedConstrained = await dialogRequestAgainstKernel(page);
    console.log(`[${tag}] Edit order… on the constrained step asked: ${JSON.stringify(askedConstrained)}`);
    if (askedConstrained.record !== 1 || askedConstrained.shown !== null || !askedConstrained.digest || askedConstrained.surface !== 'pose') {
      throw new Error('Edit order… did not open on the step’s record');
    }
    await page.waitForTimeout(2500);
    await record(`pose-${tag}-dialog-constrained`, { dialog: await steadyShot(page, dialog, { masked: false, timeoutMs: 60000 }) });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 10000 });
    const after = await poseNow(page);
    if (after.entries !== constrainedBefore.entries || after.layerOrder !== constrainedBefore.layerOrder) {
      throw new Error('Cancel on the constrained step wrote something');
    }
    console.log(`[${tag}] constrained: Cancel wrote nothing`);
    await record(`pose-${tag}-constrained`, { page: await pageShot(page) });
  };
}

// ---------------------------------------------------------------------------
// The Diagram's ‹ › within constraints (H9)

/**
 * A constraint on kabuto's step that leaves several pictures from its side,
 * worked out on the host engine as the dialog would (open on the order shown,
 * each open pair either way, counted to the end), and applied as the
 * dialog's Apply is: through the Diagram's capture, as one undo step. How
 * many pictures it leaves, and how the capture went.
 */
async function severalSolutionsStepOrder(page) {
  return page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const stepId = window.__layerOrderStep;
    const { stepById } = await import('/src/diagram/document/diagramDocument.ts');
    const { chooseStepCreases, knownCreasesOf } = await import('/src/diagram/capture/captureCreases.ts');
    const { resolveFoldRoute } = await import('/src/cp-workspace/folded/foldRoute.ts');
    const { peekCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
    const { captureModel } = await import('/src/diagram/capture/captureFolded.ts');
    const { stepFoldSource } = await import('/src/diagram/capture/captureLayerOrder.ts');
    const { createCpCaptureRuntime } = await import('/src/store/workspaceStore/cpFoldRuntimeBindings.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS, constraintSeen } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const { layerOrderSceneRelations } = await import('/src/layer-order/engine/layerOrderSceneRelations.ts');
    const state = store.getState();
    const source = stepById(state.diagram, stepId).source;
    const document = state.oristudioCpDocument.document;
    const side = source.render.side;
    const choice = chooseStepCreases(document, source.scope, peekCpSheetIndex(document), knownCreasesOf(source));
    const route = resolveFoldRoute(document, choice.creases.foldLineIds);
    const folded = await stepFoldSource(createCpCaptureRuntime(0, null), route.lineIds, captureModel(document, side));
    const runtime = createLayerOrderRuntime({ role: 'host' });
    try {
      const { engine } = runtime;
      const opened = await engine.openShowing(folded.source, layerOrderSceneRelations(folded.scene), LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`open: ${JSON.stringify(opened)}`);
      let best = null;
      for (let i = 0; i < opened.open_pairs.length; i += 2) {
        const [lo, hi] = [opened.open_pairs[i], opened.open_pairs[i + 1]];
        for (const verb of ['in_front_of', 'behind']) {
          const constraint = constraintSeen(lo, verb, hi, side, opened.front_up[hi] === 1);
          const committed = await engine.commit([constraint], LAYER_ORDER_LIMITS.commit);
          if (committed.verdict !== 'committed') continue;
          const counted = await engine.countSlice(LAYER_ORDER_LIMITS.restore);
          const n = counted.count[side].n;
          // The fewest of three or more: enough to step on and back, few enough to walk end to end.
          if (counted.count.done && n >= 3 && n < (best?.pictures ?? Infinity)) best = { constraint, pictures: n };
        }
      }
      if (!best) throw new Error('no one constraint on kabuto’s step leaves three pictures or more');
      const committed = await engine.commit([best.constraint], LAYER_ORDER_LIMITS.commit);
      if (committed.verdict !== 'committed') throw new Error('the best constraint no longer commits');
      const saved = await engine.save();
      if (saved.status !== 'ok') throw new Error(`save: ${JSON.stringify(saved)}`);
      const relations = await engine.relations();
      const applied = { record: saved.record, relations, source: folded.source };
      const outcome = await store.getState().captureDiagramStep(stepId, {
        scope: source.scope,
        known: knownCreasesOf(source),
        render: source.render,
        kind: 'diagram-capture',
        label: 'Change layer order',
        layerOrderApplied: { applied, frame: folded.frame },
      });
      return { outcome: outcome.status, pictures: best.pictures };
    } finally {
      runtime.dispose();
    }
  });
}

/** The Step pane's Layer order row on the step open in Pose: its readout, its ‹ and ›. */
function stepPanePager(page) {
  const row = page.locator('[data-field-row]', { hasText: 'Layer order' });
  const group = row.getByRole('group', { name: 'Layer order' });
  return {
    row,
    // A record's place is kept hidden at rest (`visibility: hidden`), which innerText leaves out.
    readout: async () => (await group.locator('[aria-live="polite"]').innerText()).trim(),
    next: group.getByRole('button', { name: 'Next Layer Order' }),
    previous: group.getByRole('button', { name: 'Previous Layer Order' }),
  };
}

/** Press a pager's verb and let what it starts land: the step done capturing. */
async function pressPager(page, verb) {
  await verb.click();
  await page.waitForTimeout(200);
  await captured(page);
}

/** The step's record, read: its text, its order and how many constraints it keeps. */
async function stepRecord(page) {
  return page.evaluate(async () => {
    const { stepById } = await import('/src/diagram/document/diagramDocument.ts');
    const { stepLayerOrderOf } = await import('/src/diagram/capture/captureLayerOrder.ts');
    const source = stepById(window.__treemakerWorkspaceStore.getState().diagram, window.__layerOrderStep).source;
    const read = stepLayerOrderOf(source.layerOrder);
    return {
      json: source.layerOrder ?? null,
      order: read ? JSON.stringify(read.record.order) : null,
      constraints: read ? read.record.constraints.length : null,
      side: source.render.side,
    };
  });
}

/** How many undo steps the Diagram holds, and their labels from `from`. */
function diagramHistory(page, from = 0) {
  return page.evaluate((from) => {
    const past = window.__treemakerWorkspaceStore.getState().diagramHistory.past;
    return { depth: past.length, labels: past.slice(from).map((entry) => entry.label) };
  }, from);
}

/**
 * H9 on kabuto's step, in one theme: a constraint that leaves several
 * pictures, applied; reopening the step and drawing its Step pane starts no
 * worker, and the pager reads nothing; the first ‹ makes the host engine's
 * cursor (one worker), and ‹ › then step through the solutions that fit,
 * one undo step each, the readout counting them, each end waiting once
 * reached — Pose's toolbar's too, which steps on the same worker; an undo
 * shows the order before and lets the cursor (and its worker) go; a
 * Refresh after a press keeps the order and lets it go too; and a reload
 * keeps the order the step was left on, with no worker until the next press.
 */
function diagramSolutionCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openKabutoInEdit(page, url, theme);
    await linkKabutoStep(page);
    await captured(page);
    await reopenDetail(page);
    const applied = await severalSolutionsStepOrder(page);
    await captured(page);
    if (applied.outcome !== 'captured') throw new Error(`Apply: ${applied.outcome}`);
    const { pictures } = applied;
    console.log(`[${tag}] applied one constraint that leaves ${pictures} pictures from the step's side`);

    // The step opened again (as another step and back would) and its pane drawn, from saved data: no worker.
    const watch = watchLayerOrderLoads(page);
    const closed = [];
    page.on('worker', (worker) => worker.on('close', () => closed.push(worker.url())));
    await reopenDetail(page);
    const pane = stepPanePager(page);
    await pane.row.waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(1000);
    if (watch.workers().length > 0) throw new Error(`opening the step spawned ${watch.workers().join(', ')}`);
    if ((await pane.readout()) !== '' || (await waits(pane.next)) || (await waits(pane.previous))) {
      throw new Error(`at rest the pager reads "${await pane.readout()}", or a verb waits`);
    }
    await record(`diagram-solutions-${tag}-at-rest`, { page: await pageShot(page) });
    console.log(`[${tag}] opened, its pane drawn: no worker; ‹ › live, no readout`);

    // Back to the first, from the Step pane: the first press makes the cursor, one worker.
    const { depth } = await diagramHistory(page);
    const back = [];
    for (let guard = 0; guard < 8 && !(await waits(pane.previous)); guard += 1) {
      await pressPager(page, pane.previous);
      back.push(await pane.readout());
    }
    if (watch.workers().length !== 1) throw new Error(`the presses spawned ${watch.workers().length} workers, not one`);
    if (!/^1 of \d+\+?$/.test(await pane.readout())) throw new Error(`at the first it reads "${await pane.readout()}"`);
    console.log(`[${tag}] ‹ to the first: ${back.join(' → ') || '(already there)'}, on one worker; ‹ waits`);
    const firstStage = await stageShot(page);
    await record(`diagram-solutions-${tag}-first`, { page: await pageShot(page), stage: firstStage });

    // On to the last: each press a new record and an undo step; the readout counts on; › waits there.
    const onward = [];
    for (let guard = 0; guard < 8 && !(await waits(pane.next)); guard += 1) {
      const before = await stepRecord(page);
      await pressPager(page, pane.next);
      const after = await stepRecord(page);
      if (after.json === before.json || after.constraints !== before.constraints) {
        throw new Error('› wrote no new order, or changed the constraints');
      }
      onward.push(await pane.readout());
    }
    const expected = Array.from({ length: pictures - 1 }, (_, i) => `${i + 2} of ${pictures}`);
    if (onward.join() !== expected.join()) throw new Error(`› read ${onward.join(', ')}, not ${expected.join(', ')}`);
    if (!(await waits(pane.next))) throw new Error('› never waited at the last solution');
    // Pose's toolbar's › waits there too: the stepper has ends, and neither wraps.
    if (!(await waits(poseToolbar(page).getByRole('button', { name: 'Next Layer Order' })))) {
      throw new Error('the toolbar’s › does not wait at the last solution');
    }
    const lastStage = await stageShot(page);
    const moved = await pixelDiff(page, firstStage, lastStage);
    console.log(`[${tag}] › to the last: ${onward.join(' → ')}; both › wait; ${moved.differing} of ${moved.pixels} pixels from the first`);
    if (moved.differing === 0) throw new Error('the first and the last solutions draw alike');
    await record(`diagram-solutions-${tag}-last`, { page: await pageShot(page), stage: lastStage });
    await record(`diagram-solutions-${tag}-last-toolbar`, { toolbar: await toolbarShot(page, 'Next Layer Order') });

    // ‹ back one from Pose's toolbar: one session, the same worker; the pane reads where it went.
    await toolbarVerb(page, 'Previous Layer Order');
    const backOne = await pane.readout();
    if (backOne !== `${pictures - 1} of ${pictures}` || watch.workers().length !== 1) {
      throw new Error(`the toolbar's ‹ read "${backOne}" on ${watch.workers().length} workers`);
    }
    const history = await diagramHistory(page, depth);
    const want = [...back.map(() => 'Show previous solution'), ...onward.map(() => 'Show another solution'), 'Show previous solution'];
    if (history.labels.join() !== want.join()) throw new Error(`undo steps: ${history.labels.join(', ')}`);
    const leftOn = await stepRecord(page);
    console.log(`[${tag}] toolbar ‹ back one: ${backOne}; ${history.labels.length} undo steps, one a press`);

    // Undo: the order before; the cursor goes with its worker; nothing reads out.
    const beforeUndo = closed.length;
    await page.evaluate(async () => {
      const { handleMenuAction } = await import('/src/commands/menuActions.ts');
      await handleMenuAction('edit.undo');
    });
    await captured(page);
    const undone = await stepRecord(page);
    if (undone.json === leftOn.json) throw new Error('undo did not put the order before back');
    for (let waited = 0; closed.length === beforeUndo && waited < 5000; waited += 100) await page.waitForTimeout(100);
    if (closed.length === beforeUndo) throw new Error('the cursor’s worker outlived the undo');
    if ((await pane.readout()) !== '') throw new Error(`after undo it reads "${await pane.readout()}"`);
    await record(`diagram-solutions-${tag}-undone`, { page: await pageShot(page) });
    await page.evaluate(async () => {
      const { handleMenuAction } = await import('/src/commands/menuActions.ts');
      await handleMenuAction('edit.redo');
    });
    await captured(page);
    if ((await stepRecord(page)).json !== leftOn.json) throw new Error('redo did not bring the step back');
    console.log(`[${tag}] undo: the order before; the cursor's worker closed; no readout; redo brought the step back`);

    // A press, then Refresh: the order stepped to is kept, and the cursor goes with its worker.
    await pressPager(page, pane.previous);
    const stepped = await stepRecord(page);
    const workersBefore = watch.workers().length;
    const closedBefore = closed.length;
    // The step is current, so its Picture section offers no Refresh: the verb its card's menu and Refresh All run.
    const didRefresh = await page.evaluate(async () => {
      const { refreshDiagramStep } = await import('/src/diagram/capture/stepCaptureActions.ts');
      return refreshDiagramStep(window.__layerOrderStep);
    });
    if (!didRefresh) throw new Error('Refresh did not capture');
    await captured(page);
    const refreshed = await stepRecord(page);
    for (let waited = 0; closed.length === closedBefore && waited < 5000; waited += 100) await page.waitForTimeout(100);
    console.log(
      `[${tag}] a press (worker ${workersBefore}), then Refresh: order ${refreshed.order === stepped.order ? 'kept' : 'changed'}, ` +
        `constraints ${refreshed.constraints}, readout "${await pane.readout()}", ${closed.length - closedBefore} worker closed`
    );
    if (refreshed.order !== stepped.order || refreshed.constraints !== stepped.constraints) throw new Error('Refresh lost the stepped order');
    if (closed.length === closedBefore || (await pane.readout()) !== '') throw new Error('Refresh kept the cursor');
    watch.stop();

    // Saved, and opened again in a fresh page: the order it was left on, no worker until a press.
    const saved = await page.evaluate(async () => {
      let text = null;
      const files = {
        saveTextFile: async (options) => {
          text = options.contents;
          return { name: 'kabuto-diagram.osf', path: null };
        },
      };
      if (!(await window.__treemakerWorkspaceStore.getState().saveProjectAs(files))) throw new Error('save failed');
      return { text, stepId: window.__layerOrderStep };
    });
    await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
    const reopenWatch = watchLayerOrderLoads(page);
    await page.evaluate(
      async ({ osf, stepId, theme }) => {
        const store = window.__treemakerWorkspaceStore;
        const files = { openTextFile: async () => ({ text: osf, name: 'kabuto-diagram.osf', path: null }) };
        if (!(await store.getState().openProject(files, { confirmDiscard: false }))) throw new Error('the diagram did not open');
        if (theme) {
          const { useThemeStore } = await import('/src/store/themeStore.ts');
          useThemeStore.getState().setThemeByName(theme);
        }
        const { useLayoutStore } = await import('/src/store/layoutStore.ts');
        useLayoutStore.getState().activateWorkspace('diagram');
        store.getState().selectDiagramStep(stepId);
        store.getState().openDiagramStep(stepId);
        window.__layerOrderStep = stepId;
      },
      { osf: saved.text, stepId: saved.stepId, theme }
    );
    await reopenDetail(page);
    const reopenedPane = stepPanePager(page);
    await reopenedPane.row.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(1000);
    const reopened = await stepRecord(page);
    if (reopened.order !== refreshed.order) throw new Error('the file did not keep the order the step was left on');
    if (reopenWatch.workers().length > 0) throw new Error(`opening the diagram spawned ${reopenWatch.workers().join(', ')}`);
    if ((await reopenedPane.readout()) !== '') throw new Error(`reopened, it reads "${await reopenedPane.readout()}"`);
    await record(`diagram-solutions-${tag}-reopened`, { page: await pageShot(page) });
    await pressPager(page, reopenedPane.next);
    const afterReload = await reopenedPane.readout();
    if (!/^\d+ of \d+\+?$/.test(afterReload) || reopenWatch.workers().length !== 1) {
      throw new Error(`after the reload › read "${afterReload}" on ${reopenWatch.workers().length} workers`);
    }
    reopenWatch.stop();
    console.log(`[${tag}] reloaded: left on its order, no readout, no worker; › makes one cursor and reads ${afterReload}`);
    await record(`diagram-solutions-${tag}-reopened-stepped`, { page: await pageShot(page) });
  };
}

// ---------------------------------------------------------------------------
// The panes (U8)

/** The figures the panes are photographed on: `r271-s03`'s faces are convex, two of its spots are not. */
const PANE_FIGURES = [
  { name: 'kabuto', file: 'flat-folder/kabuto.fold', title: 'Kabuto' },
  { name: 'solution-sample-1', file: 'oriedita/solution_sample_1.cp', title: 'Solution sample 1' },
  { name: 'iguana-c0', file: 'precrease/iguana-c0.fold', title: 'Iguana' },
  { name: 'r271-s03', file: 'flat-folder/r271-s03.fold', title: 'r271-s03' },
];

/**
 * Edit on `file` (under `tests/fixtures/`), in `theme`, folded whole as Edit
 * folds it, the fold's source and scene kept on `window.__layerOrderCheck`
 * (`openKabutoInEdit`, for any figure). `style`, when given, is the paper
 * style Edit's display takes, as Settings ▸ Paper sets it.
 */
async function openFigureInEdit(page, url, { theme, file, style = null }) {
  await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, {
    timeout: 120000,
  });
  const text = await readFile(path.join(repoRoot, 'tests/fixtures', file), 'utf8');
  await page.evaluate(
    async ({ text, name, theme, style }) => {
      const store = window.__treemakerWorkspaceStore;
      const files = { openTextFile: async () => ({ text, name, path: null }) };
      if (!(await store.getState().openProject(files, { confirmDiscard: false }))) throw new Error(`${name} did not open`);
      if (theme) {
        const { useThemeStore } = await import('/src/store/themeStore.ts');
        useThemeStore.getState().setThemeByName(theme);
      }
      const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
      const figure = await runtime.foldOristudioCpDocument(1, 'Order5');
      const source = await runtime.getOristudioCpFoldedFigureSource(figure.handle);
      const scene = await runtime.getOristudioCpFoldedFigurePaperScene(figure.handle);
      if (!scene) throw new Error(`${name} folded with no subfaces`);
      window.__layerOrderCheck = { source, scene, style };
    },
    { text, name: path.basename(file), theme, style }
  );
}

/**
 * Open the dialog on the figure `openFigureInEdit` folded, as a host would,
 * in `look` (the paper style given there, the Edit flat figure's policy, no
 * turn, the front, and Edit's line style and width by default), and wait for
 * the panes' session.
 */
async function openPanesDialog(page, title, look = {}, { refused = false } = {}) {
  await page.evaluate(
    async ({ title, look }) => {
      const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
      const { DEFAULT_FOLDED_MODEL } = await import('/src/lib/orieditaNativeMetadata.ts');
      const { DEFAULT_PAPER_STYLE } = await import('/src/lib/paper/paperStyle.ts');
      const { PAPER_STYLE_POLICIES } = await import('/src/lib/paper/paperStyleResolve.ts');
      const { openLayerOrderDialog } = await import('/src/layer-order/dialog/layerOrderDialogGateway.ts');
      const { source, scene, style } = window.__layerOrderCheck;
      // Edit's line style and width, as Edit hands them; the dialog never reads the store itself.
      const { lineStyle, lineWidth } = window.__treemakerWorkspaceStore.getState().oristudioCpViewport;
      window.__layerOrderOutcome = null;
      // A forged digest: the open refuses, and the crease pattern draws with nothing marked.
      const kernel = look.forge ? { ...source, digest: `${source.digest}-forged` } : source;
      openLayerOrderDialog({
        surface: 'edit_figure',
        source: layerOrderSourceOf(kernel, DEFAULT_FOLDED_MODEL),
        record: null,
        look: {
          style: style ?? DEFAULT_PAPER_STYLE,
          policy: PAPER_STYLE_POLICIES[look.policy ?? 'folded-flat'],
          turnDeg: look.turnDeg ?? 0,
          side: look.side ?? 'front',
          xray: look.xray ?? false,
          lineStyle: look.lineStyle ?? lineStyle,
          lineWidth: look.lineWidth ?? lineWidth,
        },
        // A host order forged to break a fold (`foldInsideScene`), else Edit's own.
        shown: look.inside ? window.__layerOrderCheck.inside : scene,
        name: title,
      }).then((outcome) => {
        window.__layerOrderOutcome = outcome;
      });
    },
    { title, look }
  );
  const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
  try {
    await dialog.waitFor({ state: 'visible', timeout: 30000 });
  } catch (error) {
    const outcome = await page.evaluate(() => window.__layerOrderOutcome);
    throw new Error(`the dialog never showed on ${title} (it answered ${JSON.stringify(outcome)})`, { cause: error });
  }
  if (refused) await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 120000 });
  else await dialog.getByRole('heading', { name: 'Add a constraint' }).waitFor({ state: 'visible', timeout: 120000 });
  return dialog;
}

// ---------------------------------------------------------------------------
// Driving the inspector (U10): real picks, on the panes and from its menus

/**
 * What a figure offers, worked out in the page by an engine session of the
 * check's own, beside the dialog's, on the same request: each face's letter
 * (the dialog letters from the same scene), the faces with choices and each
 * one's open faces, by letter. Kept on `window.__layerOrderCheck.figure`, with
 * the open's facts (the model's), for the cases that search the engine.
 */
async function inspectorFacts(page) {
  return page.evaluate(async () => {
    const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
    const { DEFAULT_FOLDED_MODEL } = await import('/src/lib/orieditaNativeMetadata.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const { openLayerOrderSession } = await import('/src/layer-order/dialog/layerOrderSession.ts');
    const check = window.__layerOrderCheck;
    const request = { source: layerOrderSourceOf(check.source, DEFAULT_FOLDED_MODEL), record: null, shown: check.scene };
    const runtime = createLayerOrderRuntime({ role: 'host' });
    const answer = await openLayerOrderSession(runtime.engine, request, LAYER_ORDER_LIMITS.open);
    if (answer.kind !== 'ready') throw new Error(`the check's own open refused: ${JSON.stringify(answer.refusal)}`);
    const { open } = answer;
    const letter = (face) => open.letters.letterOf(face);
    const partners = new Map();
    const pairs = open.opened.open_pairs;
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      partners.set(pairs[i], [...(partners.get(pairs[i]) ?? []), pairs[i + 1]]);
      partners.set(pairs[i + 1], [...(partners.get(pairs[i + 1]) ?? []), pairs[i]]);
    }
    const subjects = [...partners.keys()].sort(open.letters.compare);
    check.figure = { runtime, open, request, letter, partners };
    return {
      subjects: subjects.map(letter),
      partners: Object.fromEntries(subjects.map((face) => [letter(face), [...partners.get(face)].sort(open.letters.compare).map(letter)])),
      frontUp: Array.from(open.opened.front_up),
      faceOf: Object.fromEntries(Array.from({ length: open.opened.faces }, (_, face) => [letter(face), face])),
    };
  });
}

/** The check's own engine session lets go of its worker. */
async function dropInspectorFacts(page) {
  await page.evaluate(() => window.__layerOrderCheck?.figure?.runtime.dispose());
}

/** The builder's subject slot, by its name ("Subject: …"), and the object field ("Objects: …"). */
const subjectSlot = (dialog) => dialog.getByRole('button', { name: /^Subject:/ });
const objectField = (dialog) => dialog.getByRole('button', { name: /^Objects:/ });
const addButton = (dialog) => dialog.getByRole('button', { name: /^Add constraints?$/ });

/** The builder's hint line: the text under the sentence. */
async function hintText(dialog) {
  const sentence = dialog.getByRole('group', { name: 'Add a constraint' });
  // Its two live regions (polite, then the alert for a danger reason), only one of them holding text.
  return (
    await sentence.evaluate((el) =>
      el
        .getAttribute('aria-describedby')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join('')
    )
  ).trim();
}

/** Wait for the sentence's check to end: the hint no longer says it is checking. */
async function previewSettled(page, dialog, timeout = 180000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const hint = await hintText(dialog);
    if (!/Checking|Finding what it clashes/.test(hint)) return hint;
    await page.waitForTimeout(100);
  }
  throw new Error(`the check never ended: ${await hintText(dialog)}`);
}

/**
 * Wait for the sentence's check, and when it ran out of time (D8), Keep
 * trying, twice at most: a deep figure's preview can take longer than its
 * first deadline. Answers the hint it settled on.
 */
async function previewKeptTrying(page, dialog) {
  const started = Date.now();
  let hint = await previewSettled(page, dialog);
  if (Date.now() - started > 5000) console.log(`  the check took ${((Date.now() - started) / 1000).toFixed(1)} s: “${hint}”`);
  for (let tries = 0; tries < 2 && /in time/.test(hint); tries += 1) {
    console.log(`  ran out (“${hint}”): Keep trying`);
    await dialog.getByRole('button', { name: 'Keep trying' }).click();
    hint = await previewSettled(page, dialog, 120000);
  }
  return hint;
}

/** Pick `letter` as the subject from the subject slot's face menu, as the keyboard does. */
async function pickSubjectFromMenu(page, dialog, letter) {
  await subjectSlot(dialog).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Subjects' });
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  await menu.getByRole('menuitemradio', { name: `Face ${letter}`, exact: true }).click();
  await menu.waitFor({ state: 'detached', timeout: 10000 });
}

/** Toggle `letters` in the object field's face menu, which stays open (A5); Escape closes it. */
async function pickObjectsFromMenu(page, dialog, letters) {
  await objectField(dialog).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: /^Objects for / });
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  for (const letter of letters) await menu.getByRole('menuitemcheckbox', { name: `Face ${letter}`, exact: true }).click();
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 10000 });
}

/**
 * Where `letter`'s chip sits on `pane` (`pattern` or `folded`), page px: a
 * point inside its face, unless the chip had to sit beside it; null when the
 * pane letters it nowhere it can be clicked.
 */
async function letterPoint(dialog, pane, letter) {
  // Not a chip beside its face, nor a hidden face's, which sits over the paper of the face on top.
  const chip = dialog.locator(`[data-layer-order-marks="${pane}"] [data-layer-order-letter="${letter}"]:not([data-off]):not([data-under])`);
  if ((await chip.count()) === 0) return null;
  const box = await chip.first().boundingBox();
  const frame = await dialog.locator(`[data-layer-order-marks="${pane}"]`).boundingBox();
  if (!box || !frame) return null;
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // On the pane, clear of the zoom bar along its foot.
  const inside = at.x > frame.x + 4 && at.x < frame.x + frame.width - 4 && at.y > frame.y + 4 && at.y < frame.y + frame.height - 64;
  return inside ? at : null;
}

/** The middle of the face `face`'s ring on `pane`, page px, while it is ringed (the subject, an object). */
async function ringPoint(dialog, pane, face) {
  const ring = dialog.locator(`[data-layer-order-marks="${pane}"] [data-layer-order-ring="${face}"]`).first();
  const points = await ring.evaluate((polygon) => {
    const box = polygon.ownerSVGElement.getBoundingClientRect();
    return polygon.getAttribute('points').trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return { x: box.left + x, y: box.top + y };
    });
  });
  return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
}

/** Pick the objects `letters` on `pane`, each by a click on its chip there: a real pick, through the pane's hit test. */
async function pickObjectsOnPane(page, dialog, pane, letters) {
  for (const letter of letters) {
    const at = await letterPoint(dialog, pane, letter);
    if (!at) throw new Error(`${letter} has no letter to click on the ${pane} pane`);
    await page.mouse.click(at.x, at.y);
    // The pick shows as its chip in the object field.
    await dialog.getByRole('button', { name: `Remove ${letter}`, exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  }
}

/**
 * Pick `letter` as the subject on `pane` by a click inside its face: its
 * ring's middle, found by picking it from the menu first, then clearing it.
 */
async function pickSubjectOnPane(page, dialog, pane, letter, face) {
  await pickSubjectFromMenu(page, dialog, letter);
  const at = await ringPoint(dialog, pane, face);
  await dialog.getByRole('button', { name: `Clear ${letter} from the subject` }).click();
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(80);
  const name = await subjectSlot(dialog).getAttribute('aria-label');
  if (!name?.includes(`face ${letter}.`)) throw new Error(`a click on ${letter}'s face on the ${pane} pane picked ${name}`);
}

/**
 * Show what the inspector marks on the panes, by real picks, by `kind`:
 *
 * - `subjects`: choosing a subject (the open's own state), every face with choices faint;
 * - `compound`: a subject and two of its objects picked (D21), its other open faces on offer;
 * - `cap`: the subject with the most open faces, none picked, so the label cap shows (D7);
 * - `undecided`: the spots the model calls undecided (`openSpotsOf`), counted from each side.
 *
 * Answers what it marked, by letter.
 */
async function showPaneMarks(page, dialog, facts, kind, side = 'front') {
  if (kind === 'subjects') return { pickable: facts.subjects.length };
  if (kind === 'undecided') {
    return page.evaluate(async (side) => {
      const { initLayerOrderDialog, layerOrderReducer } = await import('/src/layer-order/model/layerOrderReducer.ts');
      const { openSpotsOf } = await import('/src/layer-order/model/layerOrderSelectors.ts');
      let { state } = initLayerOrderDialog({ surface: 'edit_figure', hasRecord: false, recordNeedsAttention: false, review: false, xray: false, at: 0 });
      state = layerOrderReducer(state, { type: 'opened', request: 1, facts: window.__layerOrderCheck.figure.open.facts }).state;
      const front = openSpotsOf(state, 'front').length;
      const back = openSpotsOf(state, 'back').length;
      return { side, undecided: side === 'back' ? back : front, front, back };
    }, side);
  }
  const ranked = [...facts.subjects].sort((a, b) => facts.partners[b].length - facts.partners[a].length);
  const subject = kind === 'cap' ? ranked[0] : (facts.subjects.find((s) => facts.partners[s].length >= 3) ?? ranked[0]);
  await pickSubjectFromMenu(page, dialog, subject);
  if (kind === 'cap') return { subject, open: facts.partners[subject].length };
  const objects = facts.partners[subject].slice(0, 2);
  await pickObjectsFromMenu(page, dialog, objects);
  return { subject, objects: objects.join(','), open: facts.partners[subject].length };
}

/** Clear the sentence, as the builder's Clear does. */
async function clearSentence(dialog) {
  const clear = dialog.getByRole('button', { name: 'Clear', exact: true });
  if ((await clear.getAttribute('aria-disabled')) !== 'true') await clear.click();
}

/** The dialog, the pointer off it, once its canvases settle. */
async function panesShot(page) {
  await page.mouse.move(1, 1);
  return dialogShot(page);
}

/** Press one of the title row's view tools: a Side option, X-ray or Undecided. */
async function viewTool(dialog, name) {
  const side = dialog.getByRole('group', { name: 'Side' });
  if (name === 'Front' || name === 'Back') await side.getByRole('button', { name }).click();
  else await dialog.getByRole('button', { name, exact: true }).click();
}

/**
 * How many of a crease pattern's crease pixels `marked` changes (D20: no tint,
 * ring or letter ever veils a crease). A crease pixel is one far from the
 * pane's ground in `plain` (no marks) that `tinted` (every face with choices
 * faintly tinted, under the creases) leaves exactly as it was: a pixel the
 * crease covers whole, not one its edge shares with the paper beside it.
 * Answers how many there are, how many changed, and where a few of those are.
 */
async function creasePixelsChanged(page, plain, tinted, marked) {
  return page.evaluate(
    async ({ plain, tinted, marked }) => {
      const load = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return { width: image.width, rgba: context.getImageData(0, 0, image.width, image.height).data };
      };
      const [a, b, c] = await Promise.all([load(plain), load(tinted), load(marked)]);
      const counts = new Map();
      for (let k = 0; k < a.rgba.length; k += 4) {
        const key = (a.rgba[k] << 16) | (a.rgba[k + 1] << 8) | a.rgba[k + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const ground = [...counts].sort((x, y) => y[1] - x[1])[0][0];
      const g = [(ground >> 16) & 255, (ground >> 8) & 255, ground & 255];
      const delta = (x, y, k) => Math.max(...[0, 1, 2].map((ch) => Math.abs(x.rgba[k + ch] - y.rgba[k + ch])));
      let creases = 0;
      let changed = 0;
      const at = [];
      for (let k = 0; k < a.rgba.length; k += 4) {
        const far = Math.max(...[0, 1, 2].map((ch) => Math.abs(a.rgba[k + ch] - g[ch]))) > 60;
        if (!far || delta(a, b, k) > 2) continue;
        creases += 1;
        if (delta(b, c, k) > 2) {
          changed += 1;
          if (at.length < 6) at.push([(k / 4) % a.width, Math.floor(k / 4 / a.width)]);
        }
      }
      return { creases, changed, at };
    },
    { plain: plain.toString('base64'), tinted: tinted.toString('base64'), marked: marked.toString('base64') }
  );
}

/**
 * D20 on kabuto's crease pattern, at line width 1 and 3: a face pointed at, a
 * row hovered, and a subject with two objects picked (their tints, rings and
 * letters) change no crease pixel. Fails on any.
 */
function creaseCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openFigureInEdit(page, url, { theme, file: 'flat-folder/kabuto.fold' });
    const failures = [];
    for (const lineWidth of [1, 3]) {
      const look = { lineStyle: 'color', lineWidth };
      const paneOf = (dialog) => dialog.locator('[data-layer-order-pane="pattern"]');
      const shot = async (dialog, { pointer = false } = {}) => {
        if (!pointer) await page.mouse.move(1, 1);
        return steadyShot(page, paneOf(dialog), { masked: false });
      };
      // Plain: a refusal (a forged digest) draws the crease pattern with nothing marked, at the same frame.
      let dialog = await openPanesDialog(page, 'Kabuto', { ...look, forge: true }, { refused: true });
      const plain = await shot(dialog);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForFunction(() => window.__layerOrderOutcome !== null, null, { timeout: 30000 });
      // Tinted: the open, choosing a subject: every face with choices faint.
      dialog = await openPanesDialog(page, 'Kabuto', look);
      const facts = await inspectorFacts(page);
      const tinted = await shot(dialog);
      const subject = facts.subjects.find((s) => facts.partners[s].length >= 3) ?? facts.subjects[0];
      const results = {};
      const measure = async (kind, marked) => {
        results[kind] = await creasePixelsChanged(page, plain, tinted, marked);
        await record(`creases-${tag}-kabuto-width-${lineWidth}-${kind}`, { pattern: marked });
      };
      // A face pointed at: the pointer over the subject's face, which a pick could take.
      await pickSubjectFromMenu(page, dialog, subject);
      const at = await ringPoint(dialog, 'pattern', facts.faceOf[subject]);
      await dialog.getByRole('button', { name: `Clear ${subject} from the subject` }).click();
      await page.mouse.move(at.x, at.y);
      await measure('pointed', await shot(dialog, { pointer: true }));
      // A row hovered: a constraint added, then the pointer on its row.
      await pickSubjectFromMenu(page, dialog, subject);
      await pickObjectsFromMenu(page, dialog, [facts.partners[subject][0]]);
      await previewSettled(page, dialog);
      if ((await addButton(dialog).getAttribute('aria-disabled')) === 'true') throw new Error(`${subject}'s first object can't be added`);
      await addButton(dialog).click();
      const row = dialog.getByRole('listitem').first();
      await row.waitFor({ state: 'visible' });
      await row.hover();
      await measure('row', await shot(dialog, { pointer: true }));
      // A subject with two objects picked.
      await pickSubjectFromMenu(page, dialog, subject);
      await pickObjectsFromMenu(page, dialog, facts.partners[subject].slice(1, 3));
      await previewSettled(page, dialog);
      await measure('compound', await shot(dialog));
      await dropInspectorFacts(page);
      console.log(`[${tag}] kabuto creases at line width ${lineWidth}: ${JSON.stringify(results)}`);
      for (const [kind, { changed, at }] of Object.entries(results)) {
        if (changed > 0) failures.push(`${kind} at line width ${lineWidth} changed ${changed} crease pixels, at ${JSON.stringify(at)}`);
      }
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForFunction(() => window.__layerOrderOutcome !== null, null, { timeout: 30000 });
    }
    if (failures.length > 0) throw new Error(failures.join('; '));
  };
}

/**
 * Each figure's panes, in one theme: front and back with the faces that have
 * choices tinted, X-ray, Undecided; on kabuto, a subject with two objects
 * picked, and a clash; on iguana-c0, the label cap.
 */
function paneCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    for (const figure of PANE_FIGURES) {
      await openFigureInEdit(page, url, { theme, file: figure.file });
      const dialog = await openPanesDialog(page, figure.title);
      const facts = await inspectorFacts(page);
      const shot = (state) => `panes-${tag}-${figure.name}-${state}`;
      // At Fit each pane fills itself with its own content, about 70% (your call, 2026-10-26).
      await fitFills(page, dialog, `[${tag}] ${figure.name}`);
      console.log(`[${tag}] ${figure.name}: ${JSON.stringify(await showPaneMarks(page, dialog, facts, 'subjects'))}`);
      await record(shot('front'), await panesShot(page));
      await viewTool(dialog, 'Back');
      await record(shot('back'), await panesShot(page));
      await viewTool(dialog, 'Front');
      await viewTool(dialog, 'X-ray');
      await record(shot('xray'), await panesShot(page));
      await viewTool(dialog, 'X-ray');
      await viewTool(dialog, 'Undecided');
      // From the side with more of them: the solution sample has one picture from the front.
      const counted = await showPaneMarks(page, dialog, facts, 'undecided');
      const side = counted.back > counted.front ? 'back' : 'front';
      if (side === 'back') await viewTool(dialog, 'Back');
      console.log(`[${tag}] ${figure.name} undecided: ${JSON.stringify({ ...counted, side })}`);
      await record(shot('undecided'), await panesShot(page));
      await viewTool(dialog, 'Undecided');
      if (side === 'back') await viewTool(dialog, 'Front');
      if (figure.name === 'kabuto') {
        console.log(`[${tag}] kabuto compound: ${JSON.stringify(await showPaneMarks(page, dialog, facts, 'compound'))}`);
        await previewSettled(page, dialog);
        await record(shot('compound'), await panesShot(page));
        await clearSentence(dialog);
      }
      if (figure.name === 'iguana-c0') {
        console.log(`[${tag}] iguana-c0 cap: ${JSON.stringify(await showPaneMarks(page, dialog, facts, 'cap'))}`);
        await record(shot('cap'), await panesShot(page));
        // Zoomed in on both panes, where the cap's letters have room.
        for (let step = 0; step < 6; step += 1) {
          await dialog.getByRole('button', { name: 'Zoom in the crease pattern' }).click();
          await dialog.getByRole('button', { name: 'Zoom in the folded figure' }).click();
        }
        console.log(`[${tag}] iguana-c0 letters zoomed in: ${await dialog.locator('[data-layer-order-letter]').count()}`);
        await record(shot('cap-zoomed'), await panesShot(page));
      }
      await dropInspectorFacts(page);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await page.waitForFunction(() => window.__layerOrderOutcome !== null, null, { timeout: 30000 });
    }
  };
}

/**
 * A refusal that names a face (D4): a frame with a window cut in it, whose
 * one face bends round the window. The crease pattern marks the face it
 * names, in danger, its letter dotted.
 */
async function paneRefusalCases(page, url, record) {
  await openFigureInEdit(page, url, { theme: null, file: 'oriedita/holed_frame_collinear.ori' });
  await page.evaluate(async () => {
    const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
    const { DEFAULT_FOLDED_MODEL } = await import('/src/lib/orieditaNativeMetadata.ts');
    const { DEFAULT_PAPER_STYLE } = await import('/src/lib/paper/paperStyle.ts');
    const { PAPER_STYLE_POLICIES } = await import('/src/lib/paper/paperStyleResolve.ts');
    const { openLayerOrderDialog } = await import('/src/layer-order/dialog/layerOrderDialogGateway.ts');
    const { source, scene } = window.__layerOrderCheck;
    const editLines = () => {
      const { lineStyle, lineWidth } = window.__treemakerWorkspaceStore.getState().oristudioCpViewport;
      return { lineStyle, lineWidth };
    };
    window.__layerOrderOutcome = null;
    openLayerOrderDialog({
      source: layerOrderSourceOf(source, DEFAULT_FOLDED_MODEL),
      record: null,
      look: { style: DEFAULT_PAPER_STYLE, policy: PAPER_STYLE_POLICIES['folded-flat'], turnDeg: 0, side: 'front', xray: false, ...editLines() },
      shown: scene,
      name: 'Frame',
    }).then((outcome) => {
      window.__layerOrderOutcome = outcome;
    });
  });
  const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
  await dialog.getByRole('alert').waitFor({ state: 'visible', timeout: 60000 });
  console.log(`[refusal] ${await dialog.getByRole('alert').innerText()}`);
  await record('panes-refused-non-convex', await panesShot(page));
}

/** Counts the WebGL contexts the dialog's canvases make, from before the page loads. */
const LAYER_ORDER_CONTEXT_PROBE = () => {
  const made = [];
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (kind, ...rest) {
    const context = original.call(this, kind, ...rest);
    const id = this.getAttribute('data-testid') ?? '';
    if (context && /webgl/.test(String(kind)) && id.startsWith('layer-order-') && !this.__layerOrderProbed) {
      this.__layerOrderProbed = true;
      made.push(id);
    }
    return context;
  };
  window.__layerOrderContexts = () => made.slice();
  // What reaches the window as an error, a ResizeObserver loop's included: the app toasts each one.
  const errors = [];
  window.addEventListener('error', (event) => errors.push(event.message));
  window.__layerOrderErrors = () => errors.slice();
};

/**
 * The phone (390 × 844): one pane at a time, nothing over it; kabuto with a
 * subject and two objects picked, then with its open faces on offer. A
 * switch keeps both panes: the dialog makes its two WebGL contexts once, and
 * a pane zoomed in is as it was after a switch away and back.
 */
async function panePhoneCases(page, url, record) {
  await page.addInitScript(LAYER_ORDER_CONTEXT_PROBE);
  await page.setViewportSize(PHONE);
  await openFigureInEdit(page, url, { theme: null, file: 'flat-folder/kabuto.fold' });
  const dialog = await openPanesDialog(page, 'Kabuto');
  const facts = await inspectorFacts(page);
  const switchTo = (name) => dialog.getByRole('group', { name: 'Pane' }).getByRole('button', { name }).click();
  console.log(`[phone] kabuto compound: ${JSON.stringify(await showPaneMarks(page, dialog, facts, 'compound'))}`);
  await previewSettled(page, dialog);
  await record('panes-phone-folded', await panesShot(page));
  await switchTo('Crease pattern');
  await record('panes-phone-crease-pattern', await panesShot(page));
  if ((await dialog.getByRole('toolbar').count()) !== 0) throw new Error('a toolbar floats over the phone’s pane');
  await clearSentence(dialog);
  console.log(`[phone] kabuto cap: ${JSON.stringify(await showPaneMarks(page, dialog, facts, 'cap'))}`);
  await dropInspectorFacts(page);
  await record('panes-phone-crease-pattern-offer', await panesShot(page));
  await switchTo('Folded');
  await record('panes-phone-folded-offer', await panesShot(page));

  // Zoomed in on the folded pane, then away to the crease pattern and back.
  const folded = dialog.locator('[data-testid="layer-order-folded-canvas"]');
  const box = await folded.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const fitted = await steadyShot(page, folded, { masked: false });
  await page.mouse.wheel(0, -400);
  const zoomed = await steadyShot(page, folded, { masked: false });
  if ((await pixelDiff(page, fitted, zoomed)).differing === 0) throw new Error('the wheel never zoomed the folded pane');
  await switchTo('Crease pattern');
  await switchTo('Folded');
  const back = await steadyShot(page, folded, { masked: false });
  const kept = await pixelDiff(page, zoomed, back);
  const contexts = await page.evaluate(() => window.__layerOrderContexts());
  console.log(`[phone] after switches: ${kept.differing} pixels moved; contexts made ${JSON.stringify(contexts)}`);
  if (kept.differing !== 0) throw new Error('a switch of pane reset the folded pane’s camera');
  if (contexts.length !== 2) throw new Error(`the dialog made ${contexts.length} WebGL contexts, not 2`);
  const errors = await page.evaluate(() => window.__layerOrderErrors());
  if (errors.length > 0) throw new Error(`the window heard errors: ${JSON.stringify(errors)}`);
  await page.setViewportSize(VIEWPORT);
}

/** Two PNGs side by side on one, the left's height, on white. */
async function sideBySide(page, left, right) {
  const data = await page.evaluate(
    async ({ left, right }) => {
      const load = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        return image;
      };
      const [a, b] = await Promise.all([load(left), load(right)]);
      const height = Math.max(a.height, b.height);
      const canvas = document.createElement('canvas');
      canvas.width = a.width + 8 + b.width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(a, 0, (height - a.height) / 2);
      context.drawImage(b, a.width + 8, (height - b.height) / 2);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    { left: left.toString('base64'), right: right.toString('base64') }
  );
  return Buffer.from(data, 'base64');
}

/** A paper style none of the hosts' defaults is: red front, pale back, a heavy navy edge. */
const HOST_STYLE_FIELDS = {
  'paper.front': '#e76f51',
  'paper.back': '#f1faee',
  edges: { width: 2.4, color: '#1d3557', dash: null, cap: 'butt' },
};

/** The dialog's folded pane, steady. */
async function foldedPaneShot(page, dialog) {
  await page.mouse.move(1, 1);
  return steadyShot(page, dialog.locator('[data-layer-order-pane="folded"]'), { masked: false });
}

/**
 * One side-by-side per host look (D18): the host's own picture of kabuto,
 * then the dialog's folded pane opened with the look that host hands it, in
 * a paper style none of them has by default.
 *
 * - **An Edit figure on the canvas:** the display style set to the style
 *   above, the pattern folded whole; the dialog in the figure's effective
 *   style (`effectiveObjectPaperStyle`), the flat figure's policy, no turn.
 * - **A Diagram step card** and **Pose:** the pattern linked to a step,
 *   Folded, in the Diagram's own style (its preset), turned 30° and over in
 *   Pose, its spread off; the card once Pose is done. The dialog in the
 *   Diagram's paint style (`diagramScenePaintStyle`) and policy, the step's
 *   turn, opening on its side, with no spread (D18).
 *
 * The hosts' pens scale with their pictures (the card's are a fraction of
 * Pose's); the dialog's hold their width on screen.
 */
async function hostLookCases(page, url, record) {
  await openFigureInEdit(page, url, { theme: null, file: 'flat-folder/kabuto.fold' });
  const edit = await page.evaluate(async (fields) => {
    const { useSettingsStore } = await import('/src/store/settingsStore.ts');
    useSettingsStore.getState().setPaperStyleFields('display', fields);
    const store = window.__treemakerWorkspaceStore;
    // Every line, as a selection of the whole pattern folds it.
    const lineIds = Array.from({ length: store.getState().oristudioCpDocument.summary.line_segments }, (_, index) => index + 1);
    await store.getState().foldOristudioCpDocument({ startingFaceId: 1, lineIds });
    const figure = store.getState().oristudioCpFoldedFigures.at(-1);
    if (!figure?.handle) throw new Error('Edit folded no figure');
    const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
    const { effectiveObjectPaperStyle } = await import('/src/cp-workspace/paper/objectPaperStyle.ts');
    const source = await runtime.getOristudioCpFoldedFigureSource(figure.handle);
    const scene = await runtime.getOristudioCpFoldedFigurePaperScene(figure.handle);
    window.__layerOrderCheck = { source, scene, style: effectiveObjectPaperStyle(figure) };
    return { rotation: figure.placement.rotation ?? 0, displayStyle: figure.displayStyle };
  }, HOST_STYLE_FIELDS);
  console.log(`[host] Edit figure: ${JSON.stringify(edit)}`);
  await page.waitForTimeout(1500);
  // Edit's viewport, fitted to the pattern and the figure beside it.
  await page.getByRole('toolbar').getByRole('button', { name: 'Fit', exact: true }).first().click();
  await page.mouse.move(1, 1);
  const editShot = await steadyShot(page, page.locator('.cp-panel__viewport').first(), { masked: false });
  let dialog = await openPanesDialog(page, 'Kabuto', { turnDeg: edit.rotation, xray: edit.displayStyle === 'Transparent3' });
  await record('host-edit-figure', { 'side-by-side': await sideBySide(page, editShot, await foldedPaneShot(page, dialog)) });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => window.__layerOrderOutcome !== null, null, { timeout: 30000 });

  // The Diagram: a step linked to the pattern, Folded, posed in Pose.
  await page.evaluate(async () => {
    const { handleMenuAction } = await import('/src/commands/menuActions.ts');
    await handleMenuAction('view.diagram');
  });
  await page.getByRole('button', { name: 'Link a pattern…' }).first().click();
  await page.getByRole('group', { name: 'Show as' }).getByRole('button', { name: 'Folded' }).click();
  await page.getByRole('listbox', { name: 'Patterns' }).getByRole('option', { name: 'Pattern 1' }).click();
  await page.getByRole('button', { name: 'Adjust Pose' }).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByRole('button', { name: 'Adjust Pose' }).click();
  const pose = page.getByRole('toolbar', { name: 'Pose' });
  await pose.waitFor({ state: 'visible', timeout: 60000 });
  await pose.getByRole('button', { name: 'Spread Layers' }).click();
  await pose.getByRole('button', { name: 'Turn Over' }).click();
  const rotation = page.getByRole('spinbutton', { name: 'Rotation' });
  await rotation.fill('30');
  await rotation.press('Enter');
  await page.waitForTimeout(1500);
  const posed = await page.evaluate(() => {
    const state = window.__treemakerWorkspaceStore.getState();
    return state.diagram.steps.find((step) => step.source?.kind === 'cp')?.source.render ?? null;
  });
  console.log(`[host] Diagram step: ${JSON.stringify(posed)}`);
  // Pose's stage: the page left of the Step pane, under the header.
  await page.mouse.move(1, 1);
  await page.waitForTimeout(1000);
  const poseShot = await page.screenshot({ clip: { x: 50, y: 72, width: 1070, height: 760 }, animations: 'disabled' });
  const look = await page.evaluate(async (render) => {
    const state = window.__treemakerWorkspaceStore.getState();
    const { diagramScenePaintStyle } = await import('/src/diagram/pictures/diagramPaperStyle.ts');
    const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
    const figure = await runtime.foldOristudioCpDocument(1, 'Order5');
    const back = render.side === 'back';
    if (back) await runtime.setOristudioCpFoldedFigureModel(figure.handle, { ...figure.snapshot.model, state: 'Back1' });
    const source = await runtime.getOristudioCpFoldedFigureSource(figure.handle);
    const scene = await runtime.getOristudioCpFoldedFigurePaperScene(figure.handle);
    window.__layerOrderCheck = { source, scene, style: diagramScenePaintStyle(state.diagram.style, false) };
    return { turnDeg: render.rotationDeg, side: render.side };
  }, posed);
  dialog = await openPanesDialog(page, 'Step 1', { policy: 'diagram-workspace', turnDeg: look.turnDeg, side: look.side });
  const diagramPane = await foldedPaneShot(page, dialog);
  await record('host-pose', { 'side-by-side': await sideBySide(page, poseShot, diagramPane) });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForFunction(() => window.__layerOrderOutcome !== null, null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const card = page.getByRole('listbox', { name: 'Steps' }).getByRole('option').first();
  await card.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  await record('host-diagram-step', { 'side-by-side': await sideBySide(page, await steadyShot(page, card, { masked: false }), diagramPane) });
}

// ---------------------------------------------------------------------------
// The inspector (U10)

const INSPECTOR_FIGURES = PANE_FIGURES.filter((figure) => figure.name !== 'r271-s03');

/** The constraints list's rows, as their buttons name them: each row's whole sentence. */
async function rowSentences(dialog) {
  const list = dialog.getByRole('region', { name: /^Constraints/ });
  if ((await list.getByRole('listitem').count()) === 0) return [];
  return list.getByRole('listitem').evaluateAll((rows) => rows.map((row) => row.querySelector('button')?.getAttribute('aria-label') ?? ''));
}

async function untilRows(page, dialog, expected, what) {
  const deadline = Date.now() + 30000;
  let rows = [];
  while (Date.now() < deadline) {
    rows = await rowSentences(dialog);
    if (JSON.stringify(rows) === JSON.stringify(expected)) return rows;
    await page.waitForTimeout(100);
  }
  throw new Error(`${what}: the list reads ${JSON.stringify(rows)}, not ${JSON.stringify(expected)}`);
}

/** The status row's text, once the count has a number (or says there is none to give). */
async function statusText(page, dialog) {
  // The status as drawn; its live region speaks only a settled count.
  const status = dialog.getByRole('region', { name: 'Solutions' }).locator('[data-status-shown]');
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const text = (await status.textContent())?.trim() ?? '';
    if (text && !/Counting/.test(text)) return text;
    await page.waitForTimeout(100);
  }
  return (await status.textContent())?.trim() ?? '';
}

/**
 * A sentence the engine can't fit, searched for with the check's own session
 * (`inspectorFacts`): one constraint the creases refuse, or a second one
 * against a first that fits; at most `budgetMs` of searching. Answers them by
 * letter and verb, the first (`first`) to add before the clash, or null.
 */
async function findClash(page, budgetMs) {
  return page.evaluate(async (budgetMs) => {
    const { constraintSeen, LAYER_ORDER_LIMITS } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const { runtime, open, partners, letter } = window.__layerOrderCheck.figure;
    const frontUp = open.opened.front_up;
    const verbs = ['in_front_of', 'behind'];
    const sentences = [];
    for (const [subject, objects] of partners) {
      for (const object of objects) for (const verb of verbs) sentences.push({ subject, object, verb });
    }
    const seen = (s) => constraintSeen(s.subject, s.verb, s.object, 'front', frontUp[s.object] === 1);
    const named = (s) => ({ subject: letter(s.subject), object: letter(s.object), verb: s.verb });
    const until = Date.now() + budgetMs;
    for (const s of sentences) {
      if (Date.now() > until) return null;
      const answer = await runtime.engine.previewList([seen(s)], LAYER_ORDER_LIMITS.preview);
      if (answer.verdict === 'cant_fit') return { first: null, clash: named(s) };
    }
    // A second sentence the builder still offers once the first is committed: its pair left open.
    try {
      for (const a of sentences) {
        if (Date.now() > until) return null;
        const committed = await runtime.engine.commit([seen(a)], LAYER_ORDER_LIMITS.commit);
        if (committed.verdict !== 'committed') continue;
        const pairs = committed.open_pairs;
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          for (const [subject, object] of [[pairs[i], pairs[i + 1]], [pairs[i + 1], pairs[i]]]) {
            for (const verb of verbs) {
              if (Date.now() > until) return null;
              const b = { subject, object, verb };
              const both = await runtime.engine.previewList([seen(a), seen(b)], LAYER_ORDER_LIMITS.preview);
              if (both.verdict === 'cant_fit') return { first: named(a), clash: named(b) };
            }
          }
        }
      }
      return null;
    } finally {
      await runtime.engine.commit([], LAYER_ORDER_LIMITS.commit);
    }
  }, budgetMs);
}

/** Set the verb from its menu, as a pointer does. */
async function setVerb(page, dialog, verb) {
  const label = verb === 'behind' ? 'behind' : 'in front of';
  await dialog.getByRole('button', { name: /^Verb:/ }).click();
  const menu = page.getByRole('menu', { name: 'Verb' });
  await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
  await menu.waitFor({ state: 'detached', timeout: 10000 });
  // Focus goes back to the verb's button as the menu closes, a moment later.
  await page.waitForTimeout(200);
}

/** Build a sentence from the menus, as the keyboard does. */
async function buildSentence(page, dialog, { subject, verb, objects }) {
  await pickSubjectFromMenu(page, dialog, subject);
  if (verb) await setVerb(page, dialog, verb);
  await pickObjectsFromMenu(page, dialog, objects);
  return previewKeptTrying(page, dialog);
}

/** Add what the builder holds; fails when Add waits. */
async function addSentence(page, dialog) {
  if ((await addButton(dialog).getAttribute('aria-disabled')) === 'true') {
    throw new Error(`Add waits: ${await addButton(dialog).getAttribute('title')} (hint: ${await hintText(dialog)})`);
  }
  await addButton(dialog).click();
  // The commit lands when the sentence clears.
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if ((await subjectSlot(dialog).getAttribute('aria-label')) === 'Subject: pick a face') return;
    await page.waitForTimeout(100);
  }
  throw new Error('Add never landed');
}

/** What the builder and the list show: the subject slot's name, the object field's, and the rows. */
async function inspectorShown(dialog) {
  return {
    subject: await subjectSlot(dialog).getAttribute('aria-label'),
    objects: await objectField(dialog).getAttribute('aria-label'),
    rows: await rowSentences(dialog),
  };
}

async function untilShown(page, dialog, expected, what) {
  const deadline = Date.now() + 30000;
  let shown = null;
  while (Date.now() < deadline) {
    shown = await inspectorShown(dialog);
    if (JSON.stringify(shown) === JSON.stringify(expected)) return shown;
    await page.waitForTimeout(100);
  }
  throw new Error(`${what}: the inspector shows ${JSON.stringify(shown)}, not ${JSON.stringify(expected)}`);
}

/** The page's accel key, as its shortcuts read it: Cmd on Apple platforms, Ctrl elsewhere. */
async function accelOf(page) {
  return page.evaluate(async () => ((await import('/src/platform/runtime.ts')).isApplePlatform() ? 'Meta' : 'Control'));
}

/**
 * Every action is one undo step (your words, 2026-10-26: "cmd + z should undo
 * adding a single constraint or setting the subject (so basically any
 * action)"). From an empty sentence and list, build "subject in front of
 * objects" one pick at a time from the menus, then Add (`press` clicks or
 * taps it); ⌘Z takes back the Add's commit, then each pick, to the empty
 * sentence, and ⇧⌘Z takes them all again, to the row. Each state must come
 * back exactly as it was: the slots' names and the rows, and the folded pane
 * (the exact order, #539's review), pixel for pixel: answers how many of its
 * pixels differ after ⌘Z from before the walk.
 */
async function undoEveryStep(page, dialog, { subject, objects, press, onEmpty = null }) {
  const accel = await accelOf(page);
  const names = ['empty', 'subject', ...objects.map((object) => `object ${object}`), 'Add'];
  const folded = dialog.locator('[data-layer-order-pane="folded"]');
  // The pane once any flash has faded: the order on screen alone.
  const paneShot = async () => {
    await page.mouse.move(1, 1);
    await dialog.locator('[data-layer-order-flash]').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    return steadyShot(page, folded, { masked: false });
  };
  const before = await paneShot();
  const trail = [await inspectorShown(dialog)];
  // Focus goes back to a menu's button a moment after it closes: each pick settles before the next opens one.
  const settled = () => page.waitForTimeout(250);
  await pickSubjectFromMenu(page, dialog, subject);
  await settled();
  trail.push(await inspectorShown(dialog));
  for (const object of objects) {
    await pickObjectsFromMenu(page, dialog, [object]);
    await previewKeptTrying(page, dialog);
    await settled();
    trail.push(await inspectorShown(dialog));
  }
  await press(addButton(dialog));
  const deadline = Date.now() + 30000;
  let rows = [];
  while (Date.now() < deadline && (rows = await rowSentences(dialog)).length !== 1) await page.waitForTimeout(100);
  if (rows.length !== 1) throw new Error(`Add: the list reads ${JSON.stringify(rows)}`);
  const [sentence] = rows;
  trail.push(await inspectorShown(dialog));
  for (let i = trail.length - 2; i >= 0; i -= 1) {
    await page.keyboard.press(`${accel}+z`);
    await untilShown(page, dialog, trail[i], `⌘Z back to the ${names[i]}`);
  }
  const moved = (await pixelDiff(page, before, await paneShot())).differing;
  if (onEmpty) await onEmpty();
  for (let i = 1; i < trail.length; i += 1) {
    await page.keyboard.press(`${accel}+Shift+z`);
    await untilShown(page, dialog, trail[i], `⇧⌘Z forward to the ${names[i]}`);
  }
  return { steps: trail.length - 1, sentence, moved };
}

/** The buttons a list row holds, by name: its own (the whole sentence) and its trash, and nothing per object (D21). */
async function rowButtonNames(row) {
  return row.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));
}

/** A grouped row's first comma, against the chip before it: the gap, px, how far above its foot it sits, and its opacity. */
async function commaAfterFirstObject(row) {
  return row.evaluate((item) => {
    const mark = [...item.querySelectorAll('span')].find((span) => span.children.length === 0 && span.textContent === ',');
    const chip = mark?.previousElementSibling;
    if (!mark || !chip) return null;
    const box = mark.getBoundingClientRect();
    const before = chip.getBoundingClientRect();
    return {
      gap: Math.round(box.left - before.right),
      fromFoot: Math.round(before.bottom - box.bottom),
      opacity: getComputedStyle(mark).opacity,
    };
  });
}

/**
 * The inspector on each figure, in one theme, through real picks: a subject
 * picked on the crease pattern, objects on the folded figure, the verb menu's
 * preview, compound Add, a grouped row with no per-object ×, every action
 * undone back to an empty sentence with ⌘Z and redone with ⇧⌘Z, the grouped
 * row's trash and its undo (the buttons too), the back side, X-ray stepping,
 * Clear all, a can't-fit and its reason pointed at, and Apply, which hands the
 * host `applied`. Each step's state is photographed; the fidelity list's
 * checks are logged and fail the case.
 */
function inspectorCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    for (const figure of INSPECTOR_FIGURES) {
      const failures = [];
      const check = (ok, what) => {
        console.log(`[${tag}] ${figure.name}: ${ok ? 'ok' : 'FAIL'} ${what}`);
        if (!ok) failures.push(what);
      };
      await openFigureInEdit(page, url, { theme, file: figure.file });
      const dialog = await openPanesDialog(page, figure.title);
      const facts = await inspectorFacts(page);
      const shot = (state) => `inspector-${tag}-${figure.name}-${state}`;
      const status = await statusText(page, dialog);
      console.log(`[${tag}] ${figure.name} opened: ${status}; ${facts.subjects.length} faces with choices`);
      await record(shot('ready'), await dialogShot(page));
      check((await dialog.getByText(/Apply keeps the order on screen/).count()) === 0, 'no routine foot note (spec §6.7)');

      // A subject picked on the crease pattern, by a click inside its face.
      // The subject with the fewest open faces, two at least: a compound sentence, quick to check.
      const ranked = [...facts.subjects].sort((a, b) => facts.partners[a].length - facts.partners[b].length);
      const subject = ranked.find((s) => facts.partners[s].length >= 2) ?? ranked[0];
      await pickSubjectOnPane(page, dialog, 'pattern', subject, facts.faceOf[subject]);
      const objectsHint = await hintText(dialog);
      console.log(`[${tag}] ${figure.name}: subject ${subject}, ${facts.partners[subject].length} open faces: ${facts.partners[subject].join(',')}`);
      check(/Pick (one of the \d+|the) (labelled|tinted) face/.test(objectsHint), `the hint asks for an object: “${objectsHint}”`);
      // Objects where their letters can be clicked: on the folded figure first, else on the crease pattern.
      const clickable = [];
      const findClickable = async () => {
        for (const letter of facts.partners[subject]) {
          const on = (await letterPoint(dialog, 'folded', letter)) ? 'folded' : (await letterPoint(dialog, 'pattern', letter)) ? 'pattern' : null;
          if (on) clickable.push({ letter, on });
        }
      };
      await findClickable();
      if (clickable.length === 0) {
        // Too small to letter at Fit (D7's addition): zoomed in, as the hint says, the letters find room.
        check(/Zoom in to see their letters/.test(objectsHint), 'the hint says to zoom in for the letters');
        // Toward the subject, where the nearest faces on offer keep their letters.
        const toward = await ringPoint(dialog, 'pattern', facts.faceOf[subject]);
        for (let step = 0; step < 8 && clickable.length === 0; step += 1) {
          await page.mouse.move(toward.x, toward.y);
          await page.mouse.wheel(0, -300);
          await page.waitForTimeout(400);
          await findClickable();
        }
        await record(shot('zoomed-letters'), await dialogShot(page));
      }
      const [first, second] = [...clickable.map((c) => c.letter), ...facts.partners[subject].filter((l) => !clickable.some((c) => c.letter === l))];
      const pane = clickable[0]?.on ?? null;
      if (pane) await pickObjectsOnPane(page, dialog, pane, [first]);
      else await pickObjectsFromMenu(page, dialog, [first]);
      const previewed = await previewKeptTrying(page, dialog);
      const where = pane ? `on the ${pane} pane` : 'from the object menu (no letter clickable yet)';
      console.log(`[${tag}] ${figure.name}: ${subject} in front of ${first}, picked ${where}: “${previewed}”`);
      await record(shot('preview'), await dialogShot(page));
      const folded = dialog.locator('[data-layer-order-pane="folded"]');
      const inFront = await steadyShot(page, folded, { masked: false });

      // The verb menu previews the verb under the pointer (Round3:457).
      await dialog.getByRole('button', { name: /^Verb:/ }).click();
      const verbMenu = page.getByRole('menu', { name: 'Verb' });
      await verbMenu.getByRole('menuitemradio', { name: 'behind', exact: true }).hover();
      await previewSettled(page, dialog);
      await record(shot('verb-pointed'), { dialog: await steadyShot(page, dialog, { masked: false }) });
      const behind = await steadyShot(page, folded, { masked: false });
      const verbDiff = await pixelDiff(page, inFront, behind);
      // With one picture from this side, every order that fits looks the same: nothing can move.
      const onePicture = /^1 solution$/.test(status);
      check(
        verbDiff.differing > 0 || onePicture || /Can’t fit|in time/.test(await hintText(dialog)),
        `pointing at “behind” previews it (${verbDiff.differing} pixels moved${onePicture ? '; one picture from the front' : ''})`
      );
      await page.keyboard.press('Escape');
      await verbMenu.waitFor({ state: 'detached' });

      // Compound: a second object (D21), and Add's label says so.
      if (second) {
        const secondPane = (await letterPoint(dialog, 'folded', second)) ? 'folded' : 'pattern';
        if (await letterPoint(dialog, secondPane, second)) await pickObjectsOnPane(page, dialog, secondPane, [second]);
        else await pickObjectsFromMenu(page, dialog, [second]);
        const compoundHint = await previewKeptTrying(page, dialog);
        check((await addButton(dialog).innerText()) === 'Add constraints', 'two objects: “Add constraints”');
        check(compoundHint.includes('Pick more faces to add them'), `the hint says more can be added: “${compoundHint}”`);
        await record(shot('compound'), await dialogShot(page));
      }
      const objects = [first, second].filter(Boolean).sort();
      if ((await addButton(dialog).getAttribute('aria-disabled')) === 'true') {
        // This pair can't go in front together; take the first alone.
        console.log(`[${tag}] ${figure.name}: ${subject} in front of ${objects.join(', ')} waits: ${await hintText(dialog)}`);
        await clearSentence(dialog);
        await buildSentence(page, dialog, { subject, objects: [first] });
        objects.splice(0, objects.length, first);
      }
      await addSentence(page, dialog);
      const flash = await dialog.locator('[data-layer-order-flash]').count();
      const sentence = `${subject} in front of ${objects.join(', ')}`;
      await untilRows(page, dialog, [sentence], 'compound Add');
      check(true, `Add committed “${sentence}” as one row; the flash ${flash > 0 ? 'shows' : 'had nothing to show'}`);
      if (flash > 0) {
        await page.waitForTimeout(1900);
        check((await dialog.locator('[data-layer-order-flash]').count()) === 0, 'the flash is one 1.6 s fade (Round3:172-176)');
      }
      await record(shot('added'), await dialogShot(page));

      if (objects.length === 2) {
        // A grouped row has no per-object × (your words, 2026-10-26): its trash is its one remove, hovered or not.
        const row = dialog.getByRole('listitem').first();
        await row.hover();
        await record(shot('row-hovered'), await dialogShot(page));
        const buttons = await rowButtonNames(row);
        check(
          JSON.stringify(buttons) === JSON.stringify([sentence, `Remove ${sentence}`]),
          `the grouped row holds its own button and its trash, no per-object × (${JSON.stringify(buttons)})`
        );
        const comma = await commaAfterFirstObject(row);
        check(comma !== null && comma.gap >= 0 && comma.gap < 6 && comma.opacity === '1', `a comma right after the first object (${JSON.stringify(comma)})`);
      }

      // Every action one undo step: from an empty list, the sentence one pick at a time, then Add; ⌘Z back to
      // the empty sentence, ⇧⌘Z forward to the row.
      await dialog.getByRole('button', { name: 'Clear all' }).click();
      await untilRows(page, dialog, [], 'Clear all before the undo walk');
      await page.mouse.move(1, 1);
      const walk = await undoEveryStep(page, dialog, {
        subject,
        objects,
        press: (button) => button.click(),
        onEmpty: async () => record(shot('undone-to-empty'), await dialogShot(page)),
      });
      check(walk.sentence === sentence, `the walk built “${walk.sentence}”`);
      check(true, `⌘Z took back all ${walk.steps} actions (each pick, then the Add) to the empty sentence, and ⇧⌘Z took them again`);
      check(walk.moved === 0, `⌘Z put the order back exactly: the folded pane as before the walk (${walk.moved} pixels differ)`);
      await record(shot('redone'), await dialogShot(page));

      if (objects.length === 2) {
        // The grouped row's trash: the whole row, as one step; Undo and Redo from their buttons, then ⌘Z.
        await dialog.getByRole('button', { name: `Remove ${sentence}`, exact: true }).click();
        await untilRows(page, dialog, [], 'the row’s trash');
        // Off the trash first, so its tooltip covers nothing.
        await page.mouse.move(1, 1);
        await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
        await untilRows(page, dialog, [sentence], 'Undo of the trash');
        await dialog.getByRole('button', { name: 'Redo', exact: true }).click();
        await untilRows(page, dialog, [], 'Redo of the trash');
        await page.keyboard.press(`${await accelOf(page)}+z`);
        await untilRows(page, dialog, [sentence], '⌘Z of the trash');
        check(true, 'the grouped row’s trash removes it whole, as one step: Undo, Redo and ⌘Z step it');
      }

      // The back side: the list reads from it, the figure turns over.
      await viewTool(dialog, 'Back');
      await page.waitForTimeout(300);
      const fromBack = await rowSentences(dialog);
      console.log(`[${tag}] ${figure.name} from the back: ${JSON.stringify(fromBack)}`);
      await record(shot('back'), await dialogShot(page));
      await viewTool(dialog, 'Front');

      // X-ray steps through every layer order (D5).
      await viewTool(dialog, 'X-ray');
      const xrayStatus = await statusText(page, dialog);
      const pager = dialog.getByRole('group', { name: 'Solution shown' });
      const before = (await pager.textContent())?.trim() ?? '';
      const next = pager.getByRole('button', { name: 'Next solution' });
      const previous = pager.getByRole('button', { name: 'Previous solution' });
      const way = (await next.getAttribute('aria-disabled')) !== 'true' ? next : previous;
      if ((await way.getAttribute('aria-disabled')) !== 'true') {
        await way.click();
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline && ((await pager.textContent())?.trim() ?? '') === before) await page.waitForTimeout(100);
      }
      const after = (await pager.textContent())?.trim() ?? '';
      console.log(`[${tag}] ${figure.name} X-ray: “${xrayStatus}”, stepper “${before}” → “${after}”`);
      check(/layer order/.test(xrayStatus), 'X-ray counts layer orders (D5)');
      await record(shot('xray-step'), await dialogShot(page));
      await viewTool(dialog, 'X-ray');

      // A can't-fit, and its reason pointed at (Round3:473, 883).
      const clash = figure.name === 'iguana-c0' ? null : await findClash(page, 20000);
      if (clash) {
        await dialog.getByRole('button', { name: 'Clear all' }).click();
        await untilRows(page, dialog, [], 'Clear all');
        if (clash.first) {
          await buildSentence(page, dialog, { subject: clash.first.subject, verb: clash.first.verb, objects: [clash.first.object] });
          await addSentence(page, dialog);
        }
        const reason = await buildSentence(page, dialog, { subject: clash.clash.subject, verb: clash.clash.verb, objects: [clash.clash.object] });
        check(/^Can’t fit/.test(reason), `can't fit: “${reason}”`);
        check((await addButton(dialog).getAttribute('aria-disabled')) === 'true', 'Add waits on a can’t-fit');
        const danger = await dialog.locator('[data-layer-order-letter][data-tone="danger"]').evaluateAll((chips) => chips.map((chip) => chip.closest('[data-layer-order-marks]')?.getAttribute('data-layer-order-marks')));
        check(danger.includes('pattern') && danger.includes('folded'), `the clash's letters are danger on both panes (${JSON.stringify(danger)})`);
        if (clash.first) {
          const marked = await dialog.locator('li[data-mark="clash"]').count();
          check(marked > 0, 'the clashing row is marked');
        }
        await page.mouse.move(1, 1);
        const calm = await steadyShot(page, dialog.locator('[data-layer-order-pane="pattern"]'), { masked: false });
        await record(shot('cant-fit'), await dialogShot(page));
        await dialog.getByRole('alert').filter({ hasText: 'Can’t fit' }).hover();
        const strong = await steadyShot(page, dialog.locator('[data-layer-order-pane="pattern"]'), { masked: false });
        check((await pixelDiff(page, calm, strong)).differing > 0, 'pointing at the reason strengthens the tints');
        await record(shot('cant-fit-reason'), { dialog: await steadyShot(page, dialog, { masked: false }) });
        await clearSentence(dialog);
      } else {
        console.log(`[${tag}] ${figure.name}: no can't-fit searched or found in budget`);
      }

      // Clear all, undo it, and Apply: the host gets the fold.
      if ((await rowSentences(dialog)).length > 0) {
        const kept = await rowSentences(dialog);
        await dialog.getByRole('button', { name: 'Clear all' }).click();
        await untilRows(page, dialog, [], 'Clear all');
        await record(shot('cleared'), await dialogShot(page));
        await dialog.getByRole('button', { name: 'Undo', exact: true }).click();
        await untilRows(page, dialog, kept, 'Undo of Clear all');
      }
      await dropInspectorFacts(page);
      await dialog.getByRole('button', { name: 'Apply' }).click();
      const outcome = await dialogOutcome(page);
      check(outcome.kind === 'applied', `Apply hands the host ${JSON.stringify(outcome)}`);
      if (failures.length > 0) throw new Error(`${figure.name}: ${failures.join('; ')}`);
    }
  };
}

/**
 * A tiny node budget for every preview the dialog asks while
 * `window.__layerOrderTinyBudget` is set: comlink's calls to its worker,
 * rewritten on the way out, before the page loads. The app is untouched.
 */
const TINY_BUDGET_PROBE = () => {
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (window.__layerOrderTinyBudget && message && message.type === 'APPLY' && message.path?.[0] === 'previewList') {
      const limits = message.argumentList?.[1];
      if (limits?.type === 'RAW') limits.value = { ...limits.value, maxNodes: 1, fastNodes: 0, deadlineMs: 0 };
      window.__layerOrderTinyBudgetHits = (window.__layerOrderTinyBudgetHits ?? 0) + 1;
    }
    return post.call(this, message, ...rest);
  };
};

/**
 * Couldn't check in time (D8) on kabuto, forced by a tiny node budget: the
 * quiet hint with Keep trying in its line, Add waiting; then, with the budget
 * back, Keep trying checks it again and it answers.
 */
async function inspectorTimeoutCase(page, url, record) {
  await page.addInitScript(TINY_BUDGET_PROBE);
  await openFigureInEdit(page, url, { theme: null, file: 'flat-folder/kabuto.fold' });
  const dialog = await openPanesDialog(page, 'Kabuto');
  const facts = await inspectorFacts(page);
  await page.evaluate(() => {
    window.__layerOrderTinyBudget = true;
  });
  let timedOut = null;
  for (const subject of facts.subjects) {
    for (const object of facts.partners[subject]) {
      for (const verb of ['in_front_of', 'behind']) {
        await clearSentence(dialog);
        await pickSubjectFromMenu(page, dialog, subject);
        await setVerb(page, dialog, verb);
        await pickObjectsFromMenu(page, dialog, [object]);
        const hint = await previewSettled(page, dialog);
        if (/in time/.test(hint)) {
          timedOut = { subject, verb, object, hint };
          break;
        }
      }
      if (timedOut) break;
    }
    if (timedOut) break;
  }
  if (!timedOut) {
    const hits = await page.evaluate(() => window.__layerOrderTinyBudgetHits ?? 0);
    throw new Error(`no sentence ran out of a tiny budget on kabuto (${hits} previews shrunk)`);
  }
  console.log(`[timeout] ${timedOut.subject} ${timedOut.verb} ${timedOut.object}: “${timedOut.hint}”`);
  const hint = await hintText(dialog);
  if (!/^Couldn’t check .* in time\./.test(hint)) throw new Error(`the hint: ${hint}`);
  if ((await addButton(dialog).getAttribute('aria-disabled')) !== 'true') throw new Error('Add is offered after a timeout (D8)');
  await record('inspector-timed-out', await dialogShot(page));
  await page.evaluate(() => {
    window.__layerOrderTinyBudget = false;
  });
  await dialog.getByRole('button', { name: 'Keep trying' }).click();
  const after = await previewSettled(page, dialog);
  console.log(`[timeout] Keep trying, with the budget back: “${after}”`);
  if (/in time/.test(after)) throw new Error(`Keep trying ran out again: ${after}`);
  await record('inspector-kept-trying', await dialogShot(page));
  await dropInspectorFacts(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialogOutcome(page);
}

/**
 * What a pane hover costs the dialog on iguana-c0 (850 faces): 40 pointer
 * moves across the crease pattern while a subject is chosen, most landing on
 * another face, with each component's calls counted by V8's precise coverage
 * (dev build, so the functions keep their names). `facesNamed` is the
 * builder's per-face menu label: called for every face a menu lists, open or
 * not, while the menus build their items closed. Prints the counts; fails on
 * nothing.
 */
async function inspectorHoverCost(page, url) {
  await openFigureInEdit(page, url, { theme: null, file: 'precrease/iguana-c0.fold' });
  const dialog = await openPanesDialog(page, 'Iguana');
  const pane = await dialog.locator('[data-layer-order-pane="pattern"]').boundingBox();
  const client = await page.context().newCDPSession(page);
  await client.send('Profiler.enable');
  const points = [];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      points.push({ x: pane.x + pane.width * (0.2 + 0.06 * col), y: pane.y + pane.height * (0.25 + 0.12 * row) });
    }
  }
  await page.mouse.move(points[0].x, points[0].y);
  await page.waitForTimeout(800);
  await client.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  for (const point of points) {
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(400);
  const { result } = await client.send('Profiler.takePreciseCoverage');
  await client.send('Profiler.stopPreciseCoverage');
  const names = [
    'LayerOrderDialog',
    'LayerOrderDialogFrame',
    'LayerOrderInspector',
    'LayerOrderBuilder',
    'LayerOrderConstraintList',
    'LayerOrderStatus',
    'LayerOrderViewTools',
    'LayerOrderPanes',
    'facesNamed',
  ];
  const counts = Object.fromEntries(names.map((name) => [name, 0]));
  for (const script of result) {
    for (const fn of script.functions) {
      if (fn.functionName in counts && fn.ranges[0]) counts[fn.functionName] += fn.ranges[0].count;
    }
  }
  console.log(`[hover cost] iguana-c0, ${points.length} pointer moves on the crease pattern: ${JSON.stringify(counts)}`);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialogOutcome(page);
}

/**
 * A host order that puts a face inside a fold at a crease through it (D19),
 * forged from Edit's scene in the page: one face moved to just under another
 * on every spot the two share, tried pair by pair until the engine says the
 * order breaks such a fold. Kept on `window.__layerOrderCheck.inside` for
 * `openPanesDialog(…, { inside: true })`; answers what the engine named.
 */
async function foldInsideScene(page) {
  return page.evaluate(async () => {
    const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
    const { DEFAULT_FOLDED_MODEL } = await import('/src/lib/orieditaNativeMetadata.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const { layerOrderSceneRelations } = await import('/src/layer-order/engine/layerOrderSceneRelations.ts');
    const check = window.__layerOrderCheck;
    const { scene } = check;
    const source = layerOrderSourceOf(check.source, DEFAULT_FOLDED_MODEL);
    const runtime = createLayerOrderRuntime({ role: 'host' });
    const tried = new Set();
    try {
      for (const subface of scene.subfaces) {
        const stack = subface.faces_top_to_bottom;
        for (let i = 0; i < stack.length; i += 1) {
          for (let j = i + 1; j < stack.length; j += 1) {
            const [face, under] = [stack[i], stack[j]];
            const key = `${face},${under}`;
            if (tried.has(key)) continue;
            tried.add(key);
            const forged = {
              ...scene,
              subfaces: scene.subfaces.map((spot) => {
                const faces = spot.faces_top_to_bottom;
                if (!faces.includes(face) || !faces.includes(under)) return spot;
                const rest = faces.filter((f) => f !== face);
                const at = rest.indexOf(under) + 1;
                return { ...spot, faces_top_to_bottom: [...rest.slice(0, at), face, ...rest.slice(at)] };
              }),
            };
            const outcome = await runtime.engine.openShowing(source, layerOrderSceneRelations(forged), LAYER_ORDER_LIMITS.open);
            const on = outcome.status === 'refused' ? null : outcome.opened?.opened_on ?? outcome.opened_on;
            if (on?.kind === 'closest' && on.inside) {
              check.inside = forged;
              return { tries: tried.size, moved: on.moved, inside: on.inside };
            }
          }
        }
      }
      return { tries: tried.size, inside: null };
    } finally {
      runtime.dispose();
    }
  });
}

/**
 * D19: a host order that can't fold because a face sits inside a fold. The
 * dialog opens on the nearest order that folds, says so in its foot naming the
 * face, and lights the face and the fold's crease on both panes until a face
 * is picked; pointing at the note lights them again.
 */
async function inspectorNoticeCase(page, url, record) {
  await openFigureInEdit(page, url, { theme: null, file: 'flat-folder/kabuto.fold' });
  const found = await foldInsideScene(page);
  console.log(`[notice] forged in ${found.tries} tries: ${JSON.stringify(found.inside)} (moved ${found.moved})`);
  if (!found.inside) throw new Error('no forged order broke a fold on kabuto');
  const dialog = await openPanesDialog(page, 'Kabuto', { inside: true });
  const letters = await page.evaluate(async (face) => {
    const { faceLettersOf } = await import('/src/layer-order/engine/faceIndex.ts');
    return faceLettersOf(window.__layerOrderCheck.scene).letterOf(face);
  }, found.inside.face);
  const note = dialog.getByText(/can’t fold here: face \S+ sits inside the fold at a crease through it\. Showing the nearest order that folds\./);
  await note.waitFor({ state: 'visible', timeout: 30000 });
  const text = await note.textContent();
  console.log(`[notice] the foot: “${text}”`);
  if (!text.startsWith('Edit’s order can’t fold here: face ')) throw new Error(`the foot names the host: ${text}`);
  if (!text.includes(`face ${letters} `)) throw new Error(`the foot names face ${letters}: ${text}`);
  const lit = (pane) =>
    dialog.locator(`[data-layer-order-marks="${pane}"]`).evaluate(
      (marks, face) => ({
        crease: Number(marks.querySelector('[data-layer-order-crease]')?.getAttribute('data-layer-order-crease') ?? 0),
        ring: marks.querySelector(`[data-layer-order-ring="${face}"]`) !== null,
      }),
      found.inside.face
    );
  for (const pane of ['pattern', 'folded']) {
    const marks = await lit(pane);
    console.log(`[notice] ${pane}: crease segments ${marks.crease}, face ringed ${marks.ring}`);
    if (marks.crease < 1 || !marks.ring) throw new Error(`the ${pane} pane does not light the face and its crease`);
  }
  await record('inspector-notice-lit', await dialogShot(page));
  // A face picked takes the panes: the notice's marks step aside, and come back while the note is pointed at.
  const facts = await inspectorFacts(page);
  await pickSubjectFromMenu(page, dialog, facts.subjects.find((s) => s !== letters) ?? facts.subjects[0]);
  const aside = await lit('pattern');
  if (aside.crease !== 0) throw new Error('the crease stays lit with a subject picked');
  await note.hover();
  const back = await lit('pattern');
  if (back.crease < 1) throw new Error('pointing at the note does not light the crease again');
  await record('inspector-notice-hovered', { dialog: await steadyShot(page, dialog, { masked: false }) });
  // On a phone the note wraps, whole, over Cancel and Apply: no title to hover there (U10's review).
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(600);
  const phone = await note.evaluate((text) => {
    const line = text.closest('p');
    const actions = line.parentElement.lastElementChild.getBoundingClientRect();
    return {
      whole: text.scrollHeight <= text.clientHeight + 1 && text.scrollWidth <= text.clientWidth + 1,
      height: Math.round(text.clientHeight),
      above: line.getBoundingClientRect().bottom <= actions.top + 1,
    };
  });
  console.log(`[notice] on a phone: ${JSON.stringify(phone)}`);
  await record('inspector-notice-phone', await dialogShot(page));
  if (!phone.whole || !phone.above) throw new Error(`the note is cut on a phone: ${JSON.stringify(phone)}`);
  await page.setViewportSize(VIEWPORT);
  await dropInspectorFacts(page);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialogOutcome(page);
}

/**
 * The coarse-pointer lane (D6, A5's phone), in `browserName` (Chromium or
 * WebKit) at 390 × 844 with touch: the subject tapped on the folded figure,
 * two objects tapped, Add by tap; the grouped row has its trash and no
 * per-object ×; every action undone to an empty sentence with ⌘Z and redone
 * with ⇧⌘Z; the trash and its Undo by tap; a tap on a row puts its subject in
 * the builder.
 */
function inspectorCoarseCases(browserName) {
  return async (_page, url, record) => {
    const playwright = await import('playwright');
    const browser = await playwright[browserName].launch();
    try {
      const context = await browser.newContext({ viewport: PHONE, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
      await context.addInitScript(TINY_BUDGET_PROBE);
      if (browserName === 'webkit') {
        // WebKit refuses a module worker's imports from the dev server under its COEP unless each says
        // it may be embedded; a production build serves no such imports. The dev server's, here.
        const origin = new URL(url).origin;
        await context.route((asked) => asked.protocol === 'http:' && asked.origin === origin, async (route) => {
          const response = await route.fetch();
          await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-resource-policy': 'same-origin' } });
        });
      }
      const page = await context.newPage();
      page.on('pageerror', (error) => console.warn(`[coarse ${browserName}] page error: ${error.message}`));
      await openFigureInEdit(page, url, { theme: null, file: 'flat-folder/kabuto.fold' });
      const coarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
      console.log(`[coarse ${browserName}] (pointer: coarse) matches: ${coarse}`);
      if (!coarse) throw new Error(`${browserName}: the page is not under a coarse pointer`);
      const dialog = await openPanesDialog(page, 'Kabuto');
      const facts = await inspectorFacts(page);
      const subject = facts.subjects.find((s) => facts.partners[s].length >= 2) ?? facts.subjects[0];
      // The subject, tapped on the crease pattern (one pane at a time, D6): inside its face, where the
      // menu's pick rang it; faces never overlap there.
      const switchTo = (name) => dialog.getByRole('group', { name: 'Pane' }).getByRole('button', { name }).tap();
      await switchTo('Crease pattern');
      await pickSubjectFromMenu(page, dialog, subject);
      const at = await ringPoint(dialog, 'pattern', facts.faceOf[subject]);
      await dialog.getByRole('button', { name: `Clear ${subject} from the subject` }).tap();
      await page.touchscreen.tap(at.x, at.y);
      await page.waitForTimeout(500);
      await record(`inspector-coarse-${browserName}-subject`, { dialog: await steadyShot(page, dialog, { masked: false }) });
      await switchTo('Folded');
      const picked = await subjectSlot(dialog).getAttribute('aria-label');
      console.log(`[coarse ${browserName}] tapped ${subject}'s face: ${picked}`);
      if (!picked?.includes(`face ${subject}.`)) throw new Error(`a tap on ${subject} picked ${picked}`);
      // Two objects, tapped where their letters are: on the folded figure, else on the crease pattern.
      console.log(`[coarse ${browserName}] choosing objects: “${await hintText(dialog)}”`);
      const tapped = [];
      for (const pane of ['folded', 'pattern']) {
        if (pane === 'pattern') await switchTo('Crease pattern');
        for (const letter of facts.partners[subject]) {
          if (tapped.length === 2 || tapped.includes(letter)) continue;
          const point = await letterPoint(dialog, pane, letter);
          if (!point) continue;
          await page.touchscreen.tap(point.x, point.y);
          await page.waitForTimeout(500);
          tapped.push(`${letter} (${pane})`.split(' ')[0]);
        }
        if (tapped.length === 2) break;
      }
      await switchTo('Folded');
      if (tapped.length < 2) await pickObjectsFromMenu(page, dialog, facts.partners[subject].filter((l) => !tapped.includes(l)).slice(0, 2 - tapped.length));
      const hint = await previewKeptTrying(page, dialog);
      console.log(`[coarse ${browserName}] tapped objects ${tapped.join(', ')}: “${hint}”`);
      await record(`inspector-coarse-${browserName}-sentence`, { dialog: await steadyShot(page, dialog, { masked: false }) });

      // Keep trying under a finger (U10's review): the other verb's check, out of a tiny budget, and its
      // button whole inside the hint line, a 44 px target that nothing clips.
      await page.evaluate(() => {
        window.__layerOrderTinyBudget = true;
      });
      await setVerb(page, dialog, 'behind');
      const ranOut = await previewSettled(page, dialog);
      await page.evaluate(() => {
        window.__layerOrderTinyBudget = false;
      });
      const keep = dialog.getByRole('button', { name: 'Keep trying' });
      if (/in time/.test(ranOut) && (await keep.count()) > 0) {
        const fit = await keep.evaluate((button) => {
          const line = button.parentElement.getBoundingClientRect();
          const box = button.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 2);
          return { height: box.height, inside: box.top >= line.top - 0.5 && box.bottom <= line.bottom + 0.5, hitTop: button.contains(hit) };
        });
        console.log(`[coarse ${browserName}] Keep trying in “${ranOut}”: ${JSON.stringify(fit)}`);
        await record(`inspector-coarse-${browserName}-keep-trying`, { dialog: await steadyShot(page, dialog, { masked: false }) });
        if (fit.height < 44 || !fit.inside || !fit.hitTop) throw new Error(`${browserName}: Keep trying is clipped: ${JSON.stringify(fit)}`);
        await keep.tap();
        await previewKeptTrying(page, dialog);
      } else {
        const line = await keep.count();
        console.log(`[coarse ${browserName}] the other verb answered in a tiny budget (“${ranOut}”, ${line} Keep trying): no timeout to draw`);
      }
      await setVerb(page, dialog, 'in_front_of');
      await previewKeptTrying(page, dialog);
      await addButton(dialog).tap();
      const row = dialog.getByRole('listitem').first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      const [sentence] = await rowSentences(dialog);
      // A grouped row has no per-object × (your words, 2026-10-26): its trash is its one remove, and the row a
      // 44 px target, its commas right after each chip.
      const buttons = await rowButtonNames(row);
      const height = (await row.boundingBox())?.height ?? 0;
      const comma = await commaAfterFirstObject(row);
      console.log(`[coarse ${browserName}] the row “${sentence}”: ${JSON.stringify(buttons)}, ${height} px tall, comma ${JSON.stringify(comma)}`);
      if (JSON.stringify(buttons) !== JSON.stringify([sentence, `Remove ${sentence}`])) {
        throw new Error(`${browserName}: a grouped row should hold its own button and its trash only: ${JSON.stringify(buttons)}`);
      }
      if (height < 44) throw new Error(`${browserName}: the row is ${height} px tall, under a 44 px target`);
      if (sentence.includes(',') && (comma === null || comma.gap < 0 || comma.gap >= 6 || comma.opacity !== '1')) {
        throw new Error(`${browserName}: the comma should sit right after the first object: ${JSON.stringify(comma)}`);
      }
      await record(`inspector-coarse-${browserName}-row`, { dialog: await steadyShot(page, dialog, { masked: false }) });

      // Every action one undo step, under a finger with a keyboard: from an empty list, the sentence one pick at a
      // time from the menus, then Add by tap; ⌘Z back to the empty sentence, ⇧⌘Z forward to the row.
      const objects = sentence.replace(/^.* in front of /, '').split(', ');
      await dialog.getByRole('button', { name: 'Clear all' }).tap();
      await untilRows(page, dialog, [], 'Clear all before the undo walk');
      const walk = await undoEveryStep(page, dialog, {
        subject,
        objects,
        press: (button) => button.tap(),
        onEmpty: async () => record(`inspector-coarse-${browserName}-undone-to-empty`, { dialog: await steadyShot(page, dialog, { masked: false }) }),
      });
      console.log(
        `[coarse ${browserName}] ⌘Z took back ${walk.steps} actions to the empty sentence (the folded pane ${walk.moved} pixels off), and ⇧⌘Z took them again`
      );
      if (walk.moved !== 0) throw new Error(`${browserName}: ⌘Z did not put the order back exactly (${walk.moved} pixels differ)`);
      // The grouped row's trash by tap: the whole row, one step, which Undo's tap brings back.
      await row.getByRole('button', { name: `Remove ${sentence}`, exact: true }).tap();
      await untilRows(page, dialog, [], 'the row’s trash');
      await dialog.getByRole('button', { name: 'Undo', exact: true }).tap();
      await untilRows(page, dialog, [sentence], 'Undo of the trash');
      console.log(`[coarse ${browserName}] the trash took the whole row; Undo brought it back`);
      // A tap on the row, on its subject, puts that subject in the builder.
      await row.getByRole('button').first().tap({ position: { x: 14, y: 22 } });
      await page.waitForTimeout(300);
      const revealed = await subjectSlot(dialog).getAttribute('aria-label');
      console.log(`[coarse ${browserName}] a tap on the row: ${revealed}`);
      if (!revealed?.includes(`face ${subject}.`)) throw new Error(`${browserName}: a tap on the row put ${revealed} in the builder`);
      await dropInspectorFacts(page);
      await dialog.getByRole('button', { name: 'Apply' }).tap();
      const outcome = await dialogOutcome(page);
      console.log(`[coarse ${browserName}] Apply: ${JSON.stringify(outcome)}`);
      if (outcome.kind !== 'applied') throw new Error(`${browserName}: Apply answered ${outcome.kind}`);
    } finally {
      await browser.close();
    }
  };
}

// ---------------------------------------------------------------------------
// Edit's figure: display and Apply (H3)

/** Open `file` (repo-relative) in Edit as File ▸ Open does, in `theme` (a preset's name, or null). */
async function openFileInEdit(page, url, file, theme) {
  await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, {
    timeout: 120000,
  });
  const text = await readFile(path.join(repoRoot, file), 'utf8');
  await openTextInEdit(page, text, path.basename(file), theme);
}

/** Open `text` as a file named `name` in the Edit already loaded, in `theme`. */
async function openTextInEdit(page, text, name, theme) {
  await page.evaluate(
    async ({ text, name, theme }) => {
      const store = window.__treemakerWorkspaceStore;
      const files = { openTextFile: async () => ({ text, name, path: null }) };
      if (!(await store.getState().openProject(files, { confirmDiscard: false }))) throw new Error(`${name} did not open`);
      if (theme) {
        const { useThemeStore } = await import('/src/store/themeStore.ts');
        useThemeStore.getState().setThemeByName(theme);
      }
    },
    { text, name, theme }
  );
}

/** Every crease folded as one figure, as Fold (G) folds them, one undo entry; the figure selected. Its id. */
async function foldWholeAndSelect(page) {
  return page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const count = store.getState().oristudioCpDocument.summary.line_segments;
    const lineIds = Array.from({ length: count }, (_, i) => i + 1);
    const { foldedFigureGesture } = await import('/src/cp-workspace/folded/foldedFigureGesture.ts');
    await foldedFigureGesture.run('verb', 'Fold model', () =>
      store.getState().foldOristudioCpDocument({ startingFaceId: 1, lineIds })
    );
    const figure = store.getState().oristudioCpFoldedFigures.at(-1);
    if (!figure || figure.status !== 'ready') throw new Error('the fold made no figure');
    store.getState().setOristudioCpActiveFoldedFigure(figure.id);
    return figure.id;
  });
}

const FIGURE_TOOLBAR = { role: 'toolbar', name: 'Folded figure actions' };

/** Zoom the crease pattern out until the folded figure beside it is in view. */
async function zoomOutToFigure(page, times = 2) {
  for (let i = 0; i < times; i += 1) await page.getByRole('button', { name: 'Zoom Out', exact: true }).first().click();
  await page.mouse.move(1, 1);
}

/**
 * The selected figure as the canvas shows it, with its floating toolbar and
 * its Properties sheet; and, when `hover`, the toolbar again with the pointer
 * on Layer order…, so its tooltip (why it is held) is in the picture.
 */
async function figureShots(page, { hover = false, hoverName = 'Layer order…' } = {}) {
  const toolbar = page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name });
  const sheet = page.locator('[data-property-sheet]');
  await toolbar.waitFor({ state: 'visible', timeout: 30000 });
  await sheet.waitFor({ state: 'visible', timeout: 30000 });
  await page.mouse.move(1, 1);
  const shots = {
    canvas: await steadyShot(page, page.locator('canvas.cp-webgl-layer').locator('..'), { masked: false }),
    toolbar: await steadyShot(page, toolbar, { masked: false }),
    properties: await steadyShot(page, sheet, { masked: false }),
  };
  if (hover) {
    // The pointer over it, whatever takes the event: a disabled icon button's tooltip trigger wraps it.
    const target = await toolbar.getByRole('button', { name: hoverName }).boundingBox();
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
    await page.getByRole('tooltip').first().waitFor({ state: 'visible', timeout: 10000 });
    const box = await toolbar.boundingBox();
    await settle(page);
    shots.tooltip = await page.screenshot({
      clip: { x: Math.max(0, box.x - 120), y: Math.max(0, box.y - 70), width: box.width + 240, height: box.height + 140 },
      animations: 'disabled',
    });
    await page.mouse.move(1, 1);
  }
  return shots;
}

/** The selected figure, as the store holds it. */
function figureState(page, index = 0) {
  return page.evaluate((index) => {
    const figure = window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[index];
    if (!figure) return null;
    return {
      id: figure.id,
      handle: figure.handle,
      status: figure.status,
      shownOrder: figure.snapshot?.shown_order ?? 'searched',
      picture: JSON.stringify(figure.renderSnapshot),
      layerOrder: figure.layerOrder ? { kind: figure.layerOrder.kind, json: figure.layerOrder.json ?? null } : null,
    };
  }, index);
}

/**
 * An order the dialog's engine would hand over at Apply, chosen with no
 * dialog (U10 isn't built): the figure's fold opened on the Fold wasm, one
 * open pair constrained whichever way moves the order off Oriedita's first,
 * saved. In the page, through the engine's own worker.
 */
async function chosenOrder(page, figureId) {
  return page.evaluate(async (figureId) => {
    const store = window.__treemakerWorkspaceStore;
    const figure = store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === figureId);
    const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
    const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS, constraintSeen } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const source = layerOrderSourceOf(await runtime.getOristudioCpFoldedFigureSource(figure.handle), figure.snapshot.model);
    const engine = createLayerOrderRuntime({ role: 'dialog' });
    try {
      const opened = await engine.engine.open(source, LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
      const first = Array.from(await engine.engine.relations()).join();
      for (let i = 0; i < opened.open_pairs.length; i += 2) {
        const [lo, hi] = [opened.open_pairs[i], opened.open_pairs[i + 1]];
        for (const verb of ['in_front_of', 'behind']) {
          const constraint = constraintSeen(lo, verb, hi, 'front', opened.front_up[hi] === 1);
          const committed = await engine.engine.commit([constraint], LAYER_ORDER_LIMITS.commit);
          if (committed.verdict !== 'committed') continue;
          const relations = await engine.engine.relations();
          if (Array.from(relations).join() === first) continue;
          const saved = await engine.engine.save();
          if (saved.status !== 'ok') throw new Error(`save refused: ${JSON.stringify(saved.refusal)}`);
          window.__layerOrderApplied = { record: saved.record, relations, source };
          return { constraints: saved.record.constraints.length, relations: relations.length };
        }
      }
      throw new Error('no constraint moves the order');
    } finally {
      engine.dispose();
    }
  }, figureId);
}

/** Commit what `chosenOrder` left, as the dialog's Apply is committed: one undo entry. */
async function applyChosenOrder(page, figureId) {
  return page.evaluate(async (figureId) => {
    const { applyFoldedFigureLayerOrder } = await import('/src/cp-workspace/folded/openFoldedFigureLayerOrder.ts');
    const { markFoldPress } = await import('/src/cp-workspace/folded/foldPress.ts');
    const i18n = (await import('/src/i18n/index.ts')).default;
    const press = markFoldPress(window.__treemakerWorkspaceStore.getState());
    return applyFoldedFigureLayerOrder(figureId, window.__layerOrderApplied, press, i18n.t);
  }, figureId);
}

/** The project as Save writes it. */
async function savedProject(page) {
  return page.evaluate(async () => {
    let contents = null;
    const files = {
      surface: 'web',
      supportsNativeDialogs: false,
      saveTextFile: async (options) => {
        contents = options.contents;
        return { name: options.suggestedName, path: null };
      },
    };
    if (!(await window.__treemakerWorkspaceStore.getState().saveProjectAs(files))) throw new Error('save failed');
    return contents;
  });
}

/** Re-render figure `id` through its kernel, as a restyle does, and back: what its live fold draws. */
async function restyled(page, id) {
  return page.evaluate(async (id) => {
    const store = window.__treemakerWorkspaceStore;
    await store.getState().setOristudioCpFoldedFigureDisplayStyle(id, 'Transparent3');
    await store.getState().setOristudioCpFoldedFigureDisplayStyle(id, 'Paper5');
    return JSON.stringify(store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id).renderSnapshot);
  }, id);
}

/** Watch what the page loads of the Layer order dialog and its engine: its chunk, its worker, the Fold wasm. */
function watchLayerOrderLoads(page) {
  const seen = [];
  const spawned = [];
  const onRequest = (request) => seen.push(request.url());
  const onWorker = (worker) => {
    seen.push(worker.url());
    spawned.push(worker.url());
  };
  page.context().on('request', onRequest);
  page.on('worker', onWorker);
  return {
    loaded: () => seen.filter((url) => /layerOrderWorker|oristudio_fold_wasm|components\/layer-order\/LayerOrderDialog\.tsx/.test(url)),
    /** Workers started on the Layer order worker's script. */
    workers: () => spawned.filter((url) => /layerOrderWorker/.test(url)),
    stop: () => {
      page.context().off('request', onRequest);
      page.off('worker', onWorker);
    },
  };
}

/**
 * Edit's display and Apply on kabuto, in one theme: the figure and its entry
 * before and after an Apply (the order chosen through the engine, committed
 * as the dialog's Apply is); undo, a restyle, redo; Duplicate; the file saved
 * and opened again, with no worker until Layer order… is pressed; the press,
 * which folds the reopened figure with its record and opens the dialog;
 * Duplicate after it; and the file once more. The real dialog's Apply waits
 * for U10.
 */
function editFigureCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record, { dir }) => {
    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    const id = await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    const before = await figureState(page);
    const plain = await figureShots(page);
    await record(`edit-${tag}-enabled`, plain);

    const chosen = await chosenOrder(page, id);
    if (!(await applyChosenOrder(page, id))) throw new Error('Apply wrote nothing');
    const after = await figureState(page);
    if (after.handle === before.handle || after.shownOrder !== 'given' || after.layerOrder?.kind !== 'record') {
      throw new Error(`Apply did not land: ${JSON.stringify(after)}`);
    }
    if (after.picture === before.picture) throw new Error('the constrained order draws the same picture');
    const constrained = await figureShots(page);
    const moved = await pixelDiff(page, plain.canvas, constrained.canvas);
    if (!moved.differing) throw new Error('the canvas shows no change after Apply');
    console.log(`[${tag}] Apply of ${chosen.constraints} constraint: new fold, order given; ${moved.differing} canvas pixels changed`);
    await record(`edit-${tag}-constrained`, constrained);

    // Its creases moved: Refold and Layer order… are both held, until H4 refolds with the constraints.
    const fingerprint = await page.evaluate((id) => {
      const store = window.__treemakerWorkspaceStore;
      const figure = store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id);
      store.setState({
        oristudioCpFoldedFigures: store.getState().oristudioCpFoldedFigures.map((entry) =>
          entry.id === id ? { ...entry, sourceFingerprint: 'cs1:moved' } : entry
        ),
      });
      return figure.sourceFingerprint;
    }, id);
    const toolbar = page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name });
    await toolbar.getByRole('button', { name: 'Refold' }).waitFor({ state: 'visible' });
    if ((await toolbar.getByRole('button', { name: 'Refold' }).isDisabled()) !== true) throw new Error('Refold is not held');
    await record(`edit-${tag}-stale-constrained`, await figureShots(page, { hover: true, hoverName: 'Refold' }));
    await page.evaluate(
      ({ id, fingerprint }) => {
        const store = window.__treemakerWorkspaceStore;
        store.setState({
          oristudioCpFoldedFigures: store.getState().oristudioCpFoldedFigures.map((entry) =>
            entry.id === id ? { ...entry, sourceFingerprint: fingerprint } : entry
          ),
        });
      },
      { id, fingerprint }
    );
    console.log(`[${tag}] stale and constrained: Refold and Layer order… both held`);

    // Undo shows the order before, and a restyle redraws it from the old fold, not the new.
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    if ((await figureState(page)).handle !== before.handle) throw new Error('undo did not put the old fold back');
    if ((await restyled(page, id)) !== before.picture) throw new Error('a restyle after undo drew another order');
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().redo());
    if ((await figureState(page)).handle !== after.handle) throw new Error('redo did not put the new fold back');
    if ((await restyled(page, id)) !== after.picture) throw new Error('a restyle after redo drew another order');
    console.log(`[${tag}] undo, restyle, redo, restyle: each fold draws its own order`);

    // Duplicate keeps the order.
    await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Duplicate' }).click();
    await page.waitForFunction(() => window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[1]?.status === 'ready');
    const copy = await figureState(page, 1);
    if (copy.layerOrder?.json !== after.layerOrder.json || copy.picture !== after.picture) {
      throw new Error(`the copy lost the order: ${JSON.stringify(copy)}`);
    }
    console.log(`[${tag}] Duplicate carries the record and draws the same order`);

    // Saved and opened again: drawn from the file, with no worker, the Fold wasm or the dialog's code.
    const osf = await savedProject(page);
    if (!tag.includes('horizon')) await writeFile(path.join(dir, 'kabuto-constrained.osf'), osf);
    const watch = watchLayerOrderLoads(page);
    await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
    await openTextInEdit(page, osf, 'kabuto-constrained.osf', theme);
    await page.evaluate(() => {
      const store = window.__treemakerWorkspaceStore;
      store.getState().setOristudioCpActiveFoldedFigure(store.getState().oristudioCpFoldedFigures[0].id);
    });
    await zoomOutToFigure(page);
    const reopenedShots = await figureShots(page);
    await page.waitForTimeout(1500);
    if (watch.loaded().length > 0) throw new Error(`opening and selecting loaded ${watch.loaded().join(', ')}`);
    const reopened = await figureState(page);
    if (reopened.handle !== null || reopened.layerOrder?.json !== after.layerOrder.json || reopened.picture !== after.picture) {
      throw new Error(`the file did not keep the order: ${JSON.stringify(reopened)}`);
    }
    if ((await figureState(page, 1))?.layerOrder?.json !== after.layerOrder.json) throw new Error('the copy lost its record in the file');
    console.log(`[${tag}] reopened: both figures carry the record and draw the constrained order; no worker, no Fold wasm, no dialog code loaded`);
    await record(`edit-${tag}-reopened`, reopenedShots);

    // The canvas turned a step: the dialog's paper turns as the canvas shows the figure.
    await page.getByRole('button', { name: 'Rotate view right' }).first().click();
    await page.waitForFunction(() => (window.__treemakerWorkspaceStore.getState().oristudioCpCamera?.rotation ?? 0) !== 0, null, {
      timeout: 10000,
    });

    // The press: the host engine folds the figure with its record, and the dialog opens on it.
    await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Layer order…' }).click();
    const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    await dialog.getByRole('complementary', { name: 'Layer order details' }).waitFor({ state: 'visible', timeout: 60000 });
    const workers = watch.workers();
    watch.stop();
    if (workers.length < 2) throw new Error(`the press spawned ${workers.length} Layer order workers, not the host engine's and the dialog's`);
    const asked = await page.evaluate(async () => {
      const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
      const { request } = useLayerOrderDialogStore.getState().opening;
      const state = window.__treemakerWorkspaceStore.getState();
      const figure = state.oristudioCpFoldedFigures[0];
      const turned = ((((figure.placement.rotation + state.oristudioCpCamera.rotation) * 180) / Math.PI) % 360 + 540) % 360 - 180;
      const { look } = request;
      return {
        surface: request.surface,
        turnDeg: look.turnDeg,
        turned,
        shown: request.shown != null,
        record: request.record != null,
        side: look.side,
        pen: [look.lineStyle, look.lineWidth],
        editPen: [state.oristudioCpViewport.lineStyle ?? 'color', state.oristudioCpViewport.lineWidth ?? 1],
      };
    });
    if (
      asked.surface !== 'edit_figure' ||
      !asked.shown ||
      !asked.record ||
      Math.abs(asked.turnDeg - asked.turned) > 0.01 ||
      asked.turnDeg === 0 ||
      asked.side !== 'front' ||
      asked.pen.join() !== asked.editPen.join()
    ) {
      throw new Error(`the request is not what the canvas shows: ${JSON.stringify(asked)}`);
    }
    console.log(
      `[${tag}] on a canvas turned ${asked.turnDeg}°, the request turns the paper ${asked.turnDeg}°, on the ${asked.side}, creases ${asked.pen.join(' ')} as Edit draws them, surface ${asked.surface}`
    );
    await record(`edit-${tag}-dialog`, await dialogShot(page));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });
    const live = await figureState(page);
    if (live.handle === null || live.layerOrder?.json !== after.layerOrder.json || live.picture !== after.picture) {
      throw new Error(`the press did not fold it again with its record: ${JSON.stringify(live)}`);
    }
    console.log(`[${tag}] the press spawned ${workers.length} Layer order workers (host engine, dialog); the figure is live on its record`);

    // Live now, so it duplicates, with its record; and the file keeps all three.
    await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Duplicate' }).click();
    await page.waitForFunction(() => window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[2]?.status === 'ready');
    if ((await figureState(page, 2)).layerOrder?.json !== after.layerOrder.json) throw new Error('the reopened copy lost the order');
    const again = await savedProject(page);
    await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
    await openTextInEdit(page, again, 'kabuto-constrained.osf', theme);
    for (const index of [0, 1, 2]) {
      const figure = await figureState(page, index);
      if (figure.layerOrder?.json !== after.layerOrder.json || figure.picture !== after.picture) {
        throw new Error(`figure ${index} lost the order on reload`);
      }
    }
    console.log(`[${tag}] duplicate after reopen, then reload: all three keep the record`);
  };
}

/**
 * What #520's review found, on the real kernel (no pictures): after Another
 * solution and Undo, Layer order… opens on the order the figure shows, not
 * the one its handle was left on; a figure deleted and undone still draws
 * through its own fold; and a fold made after the delete never takes the
 * deleted figure's slot while its undo can put it back.
 */
async function editFigureReviewCases(page, url) {
  await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', null);
  const id = await foldWholeAndSelect(page);
  await zoomOutToFigure(page);

  // Another solution, then Undo, then Layer order… at once, as the reviewer's
  // script pressed it: the entry back on the first order, its handle still on
  // the second. The dialog opens on the entry's.
  const steps = await page.evaluate(async (id) => {
    const store = window.__treemakerWorkspaceStore;
    const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
    const { showAnotherFoldedSolution } = await import('/src/cp-workspace/folded/foldedFigureVerbs.ts');
    const i18n = (await import('/src/i18n/index.ts')).default;
    const figure = () => store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id);
    const first = JSON.stringify(await runtime.getOristudioCpFoldedFigurePaperScene(figure().handle));
    await showAnotherFoldedSolution(id, i18n.t);
    const second = JSON.stringify(await runtime.getOristudioCpFoldedFigurePaperScene(figure().handle));
    await store.getState().undo();
    const entryCase = figure().snapshot.current_fold_case;
    const opening = await store.getState().prepareOristudioCpFigureLayerOrder(id);
    const kernelCase = (await runtime.getOristudioCpFoldedFigureSnapshot(figure().handle)).current_fold_case;
    const shown = JSON.stringify(opening.shown);
    await opening.release();
    window.__layerOrderScenes = { first, second };
    return { differ: first !== second, entryCase, kernelCase, opensOn: shown === first ? 'first' : shown === second ? 'second' : 'other' };
  }, id);
  if (!steps.differ || steps.entryCase !== 1 || steps.kernelCase !== 2 || steps.opensOn !== 'first') {
    throw new Error(`after Another solution and Undo, Layer order… opened on another order: ${JSON.stringify(steps)}`);
  }
  // Pressed once the undo's model write has landed, it opens on whatever the figure shows then.
  await page.waitForTimeout(500);
  await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Layer order…' }).click();
  const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
  await dialog.waitFor({ state: 'visible', timeout: 60000 });
  const pressed = await page.evaluate(async () => {
    const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
    const shown = JSON.stringify(useLayerOrderDialogStore.getState().opening.request.shown);
    const figure = window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[0];
    const { first, second } = window.__layerOrderScenes;
    return { entryCase: figure.snapshot.current_fold_case, opensOn: shown === first ? 'first' : shown === second ? 'second' : 'other' };
  });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached' });
  if (pressed.opensOn !== (pressed.entryCase === 1 ? 'first' : 'second')) {
    throw new Error(`the press opened on an order the figure does not show: ${JSON.stringify(pressed)}`);
  }
  console.log(
    `[review] after Another solution and Undo (entry on ${steps.entryCase}, handle on ${steps.kernelCase}), Layer order… opens on the entry's order; pressed later, on the one the figure shows (${pressed.entryCase})`
  );

  // Delete, then Undo: the figure draws through its own fold again. On a fresh
  // fold: the one above is the undo drift's own case (its handle on another order).
  const fresh = await foldWholeAndSelect(page);
  const original = await figureState(page, 1);
  if (original.id !== fresh) throw new Error('the fresh fold is not the second figure');
  await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Delete' }).click();
  await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
  const back = await page.evaluate(async (id) => {
    const store = window.__treemakerWorkspaceStore;
    await store.getState().setOristudioCpFoldedFigureDisplayStyle(id, 'Transparent3');
    await store.getState().setOristudioCpFoldedFigureDisplayStyle(id, 'Paper5');
    const figure = store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === id);
    return { status: figure.status, error: store.getState().oristudioCpError, handle: figure.handle };
  }, fresh);
  if (back.status !== 'ready' || back.error || back.handle !== original.handle) {
    throw new Error(`Delete then Undo put back a figure that does not draw: ${JSON.stringify(back)}`);
  }

  // Delete, fold again, Undo twice: the first figure's slot was never the second's.
  await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Delete' }).click();
  await foldWholeAndSelect(page);
  const second = await figureState(page, 1);
  if (second.id === fresh || second.handle === original.handle) throw new Error('the next fold took the deleted figure’s slot');
  await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
  await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
  const redrawn = await restyled(page, fresh);
  const restored = await figureState(page, 1);
  if (restored.handle !== original.handle || redrawn !== original.picture) {
    throw new Error(`the undone figure draws another fold: ${JSON.stringify({ restored, second: second.handle })}`);
  }
  console.log('[review] Delete then Undo draws through its own fold; the next fold never took its slot');
}

/**
 * The entry and the Properties row in the states a figure can hold it in, in
 * one theme: held on a 3D figure (box_90), on a fold that found no layer
 * order (failing_global_flat_fold.ori), and on a newer build's record (on
 * kabuto); each with Layer order…'s tooltip.
 */
function editFigureStateCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openFileInEdit(page, url, 'tests/fixtures/fold-angle-3d/box_90.fold', theme);
    await foldWholeAndSelect(page);
    await record(`edit-${tag}-3d`, await figureShots(page, { hover: true }));

    await openFileInEdit(page, url, 'tests/fixtures/oriedita/failing_global_flat_fold.ori', theme);
    await foldWholeAndSelect(page);
    await record(`edit-${tag}-no-layer-order`, await figureShots(page, { hover: true }));

    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    const id = await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    await page.evaluate((id) => {
      const store = window.__treemakerWorkspaceStore;
      store.setState({
        oristudioCpFoldedFigures: store.getState().oristudioCpFoldedFigures.map((figure) =>
          figure.id === id
            ? { ...figure, layerOrder: { kind: 'newer', saved: { figureKey: 'fk9:later', record: '{"v":2}' } } }
            : figure
        ),
      });
    }, id);
    await record(`edit-${tag}-newer`, await figureShots(page, { hover: true }));
  };
}

// ---------------------------------------------------------------------------
// Edit's refold with constraints, a stale figure, 3D and attention (H4)

/** The selected figure's record as it reads: its constraints and the summary it stores. */
function recordState(page, index = 0) {
  return page.evaluate(async (index) => {
    const figure = window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[index];
    if (!figure) return null;
    const record = figure.layerOrder?.kind === 'record' ? figure.layerOrder.record : null;
    return {
      id: figure.id,
      handle: figure.handle,
      kind: figure.folded3d ? '3d' : 'flat',
      picture: JSON.stringify(figure.renderSnapshot),
      constraints: record?.constraints.length ?? null,
      attention: record?.attention ?? null,
      error: window.__treemakerWorkspaceStore.getState().oristudioCpError,
      stale: (await import('/src/cp-workspace/folded/foldedFigureStaleness.ts')).isFoldedFigureStale(
        window.__treemakerWorkspaceStore.getState().oristudioCpDocument.document,
        figure
      ),
    };
  }, index);
}

/**
 * A new valley crease across the paper corner that no crease reaches, half as
 * far in as the nearest crease on its two edges: it splits that corner's face
 * in two and adds no interior vertex, so the creases still fold flat. One
 * undo entry, as the Line tool's is.
 */
async function splitCornerFace(page) {
  return page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const lines = store.getState().oristudioCpDocument.document.crease_pattern.line_segments;
    const xs = lines.flatMap((line) => [line.a.x, line.b.x]);
    const ys = lines.flatMap((line) => [line.a.y, line.b.y]);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const near = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-9;
    const creases = lines.filter((line) => line.color !== 'Black0');
    for (const corner of [
      { x: maxX, y: minY },
      { x: minX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ]) {
      if (creases.some((line) => near(line.a, corner) || near(line.b, corner))) continue;
      // The nearest crease end on the corner's two edges.
      const onEdges = creases
        .flatMap((line) => [line.a, line.b])
        .filter((p) => Math.abs(p.x - corner.x) < 1e-9 || Math.abs(p.y - corner.y) < 1e-9)
        .map((p) => Math.hypot(p.x - corner.x, p.y - corner.y))
        .filter((d) => d > 1e-9);
      if (onEdges.length === 0) continue;
      const d = Math.min(...onEdges) / 2;
      const sx = corner.x === maxX ? -1 : 1;
      const sy = corner.y === maxY ? -1 : 1;
      const a = { x: corner.x + sx * d, y: corner.y };
      const b = { x: corner.x, y: corner.y + sy * d };
      const figureId = store.getState().oristudioCpActiveFoldedFigureId;
      // Drawn as the Draw crease tool draws one, so the border lines it ends on are split there.
      if (!(await store.getState().executeOristudioCpCommand('DrawCreaseFree', { points: [a, b] }))) {
        throw new Error('the crease did not land');
      }
      const after = store.getState().oristudioCpDocument.document.crease_pattern.line_segments;
      const drawn = after.find((line) => (near(line.a, a) && near(line.b, b)) || (near(line.a, b) && near(line.b, a)));
      if (!drawn) throw new Error('the drawn crease is not in the document');
      // The new crease took the selection: the figure takes it back, as a click on it would.
      store.getState().setOristudioCpActiveFoldedFigure(figureId);
      return { corner, d, a, b, color: drawn.color, lines: [lines.length, after.length] };
    }
    throw new Error('no corner that no crease reaches');
  });
}

/** Press a figure toolbar button by name and wait until no fold runs and the figure is at rest. */
async function pressFigureVerb(page, name) {
  await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name }).click();
  await page.waitForFunction(
    () => {
      const state = window.__treemakerWorkspaceStore.getState();
      return Object.keys(state.oristudioCpFoldRuns).length === 0 && state.oristudioCpFoldedFigures.every((f) => f.status !== 'loading');
    },
    null,
    { timeout: 120000 }
  );
  await settle(page);
}

/** The project saved, then opened again on a fresh page; what the page loaded of the Layer order engine meanwhile. */
async function reopenSaved(page, url, theme, name) {
  const osf = await savedProject(page);
  const watch = watchLayerOrderLoads(page);
  await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
  await openTextInEdit(page, osf, name, theme);
  await page.evaluate(() => {
    const store = window.__treemakerWorkspaceStore;
    store.getState().setOristudioCpActiveFoldedFigure(store.getState().oristudioCpFoldedFigures[0].id);
  });
  return watch;
}

/**
 * Edit's refold with constraints (H4), in one theme, on kabuto with an order
 * chosen through the engine (H3's synthetic approach; the real dialog's Apply
 * waits for U10): a new crease splits a face, and Refold restores the record
 * on the creases as they are now and draws the order that fits; then a record
 * whose constraints clash keeps the picture, flagged, with Review… (D10,
 * D14); Layer order… on the stale figure says Apply also refolds (D12); the
 * flag survives a reload with no worker. Then a released build's refold
 * after an edit, simulated: the reopened record shows "Not applied", with
 * Review…, whose Apply takes it up, and Dismiss, one entry an undo takes
 * back. Then a book fold whose crease gains
 * a fold angle: Refold shows it in 3D, its record kept and waiting (D13),
 * through a reload and the idle 3D rehydrate, with no worker.
 */
function editRefoldCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    const t0 = Date.now();
    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    const id = await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    const chosen = await chosenOrder(page, id);
    if (!(await applyChosenOrder(page, id))) throw new Error('Apply wrote nothing');
    const before = await recordState(page);
    console.log(`[${tag}] kabuto constrained: ${chosen.constraints} constraint, handle ${before.handle}`);

    // A new crease splits a face: the figure goes stale, and Refold (no longer held) folds it in its order.
    const split = await splitCornerFace(page);
    const stale = await recordState(page);
    if (!stale.stale) throw new Error('the new crease did not make the figure stale');
    console.log(
      `[${tag}] drew a ${split.color} crease across the corner face at ${JSON.stringify(split.corner)}, ${split.d.toFixed(4)} in ` +
        `(lines ${split.lines.join(' → ')}): figure stale`
    );
    const refoldButton = page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Refold' });
    if (await refoldButton.isDisabled()) throw new Error('Refold is still held on a constrained figure');
    const watch = watchLayerOrderLoads(page);
    const started = Date.now();
    await pressFigureVerb(page, 'Refold');
    const refolded = await recordState(page);
    const workers = watch.workers();
    watch.stop();
    console.log(
      `[${tag}] Refold in ${Date.now() - started} ms: handle ${refolded.handle}, ${refolded.kind}, stale ${refolded.stale}, ` +
        `attention ${JSON.stringify(refolded.attention)}, ${workers.length} host engine worker(s), error ${JSON.stringify(refolded.error)}`
    );
    if (workers.length !== 1) throw new Error(`Refold spawned ${workers.length} Layer order workers, not the host engine's one`);
    const applied = refolded.handle !== before.handle && !refolded.stale;
    const flaggedFirst = refolded.handle === before.handle && refolded.attention !== null;
    if (!applied && !flaggedFirst) throw new Error(`Refold neither drew the order nor flagged the record: ${JSON.stringify(refolded)}`);
    await record(`edit-refold-${tag}-${applied ? 'applied' : 'flagged'}`, await figureShots(page));

    // Stale again, its record whole: Layer order… opens the real dialog on the creases as they are now,
    // and an untouched Apply is the refold in its order (D12), one "Refold with layer order" entry.
    if (applied) {
      await splitCornerFace(page);
      const staleAgain = await recordState(page);
      if (!staleAgain.stale) throw new Error('the second crease did not make the figure stale');
      await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Layer order…' }).click();
      const staleDialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
      await staleDialog.getByRole('status').filter({ hasText: 'Apply also refolds' }).waitFor({ state: 'visible', timeout: 60000 });
      await page.waitForTimeout(500);
      await record(`edit-refold-${tag}-stale-apply-dialog`, await dialogShot(page));
      // Untouched: Apply waits on the dialog's own check, then goes.
      await staleDialog.getByRole('button', { name: 'Apply' }).click({ timeout: 60000 });
      await staleDialog.waitFor({ state: 'detached', timeout: 60000 });
      await page.waitForFunction(
        () => {
          const state = window.__treemakerWorkspaceStore.getState();
          return Object.keys(state.oristudioCpFoldRuns).length === 0 && state.oristudioCpFoldedFigures.every((f) => f.status !== 'loading');
        },
        null,
        { timeout: 120000 }
      );
      const appliedStale = await recordState(page);
      const staleLabel = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().oristudioCpHistoryPast.at(-1)?.label);
      console.log(
        `[${tag}] stale, its record whole, untouched Apply through the dialog: "${staleLabel}", handle ${staleAgain.handle} → ${appliedStale.handle}, ` +
          `stale ${appliedStale.stale}, record ${JSON.stringify(appliedStale.constraints)}`
      );
      if (staleLabel !== 'Refold with layer order' || appliedStale.stale || appliedStale.handle === staleAgain.handle || appliedStale.constraints === null) {
        throw new Error(`an untouched Apply on the stale constrained figure did not refold it: ${JSON.stringify({ staleLabel, appliedStale })}`);
      }
      await record(`edit-refold-${tag}-stale-applied`, await figureShots(page));
    }

    // Its record made to clash (its first constraint and its opposite), the creases changed again:
    // Refold keeps the picture and flags it (D10), with Review… (D14).
    await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const { foldedFigureLayerOrder } = await import('/src/lib/layerOrder/foldedFigureLayerOrder.ts');
      const figure = store.getState().oristudioCpFoldedFigures[0];
      const { record } = figure.layerOrder;
      const [f, g, sign] = record.constraints[0];
      const clashing = foldedFigureLayerOrder({ ...record, constraints: [...record.constraints, [f, g, -sign]] });
      store.setState({
        oristudioCpFoldedFigures: store
          .getState()
          .oristudioCpFoldedFigures.map((entry) => (entry.id === figure.id ? { ...entry, layerOrder: clashing.layerOrder } : entry)),
      });
    });
    await splitCornerFace(page);
    const pictureBefore = (await recordState(page)).picture;
    const handleBefore = (await recordState(page)).handle;
    await pressFigureVerb(page, 'Refold');
    const kept = await recordState(page);
    console.log(`[${tag}] clash: handle ${kept.handle}, attention ${JSON.stringify(kept.attention)}, stale ${kept.stale}`);
    if (kept.attention?.reason !== 'conflict' || kept.picture !== pictureBefore || kept.handle !== handleBefore || !kept.stale) {
      throw new Error(`the clash did not keep the picture and flag the record: ${JSON.stringify(kept)}`);
    }
    const sheet = page.locator('[data-property-sheet]');
    await sheet.getByRole('button', { name: 'Review…' }).waitFor({ state: 'visible', timeout: 10000 });
    const subtitle = await sheet.locator('[data-property-sheet-subtitle]').innerText();
    console.log(`[${tag}] Properties: "${subtitle}", Review… shown; the toolbar leads with the flag`);
    // Another solution's tooltip: ‹ › wait until the constraints are reviewed.
    await record(`edit-refold-${tag}-attention`, await figureShots(page, { hover: true, hoverName: 'Another solution' }));

    // Review… on the stale flagged figure: the dialog opens on its creases as they are now, and says Apply also refolds.
    // (Once the Refold's toast has gone, so it covers nothing in the picture.)
    await page.waitForTimeout(5000);
    await sheet.getByRole('button', { name: 'Review…' }).click();
    const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
    await dialog.waitFor({ state: 'visible', timeout: 60000 });
    await dialog.getByRole('complementary', { name: 'Layer order details' }).waitFor({ state: 'visible', timeout: 60000 });
    const note = await dialog.getByRole('status').filter({ hasText: 'Apply also refolds' }).innerText();
    const asked = await page.evaluate(async () => {
      const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
      const { request } = useLayerOrderDialogStore.getState().opening;
      return { review: request.review === true, applyRefolds: request.applyRefolds === true, record: request.record !== null };
    });
    console.log(`[${tag}] Review… opened the dialog: ${JSON.stringify(asked)}; its foot says "${note}"`);
    if (!asked.review || !asked.applyRefolds || !asked.record) throw new Error(`the request is not a stale review: ${JSON.stringify(asked)}`);
    await record(`edit-refold-${tag}-stale-dialog`, await dialogShot(page));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached' });

    // Saved and opened again: still flagged, from saved data, with no worker or Fold wasm loaded.
    const reopened = await reopenSaved(page, url, theme, 'kabuto-flagged.osf');
    await zoomOutToFigure(page);
    const reopenedShots = await figureShots(page);
    await page.waitForTimeout(1500);
    if (reopened.loaded().length > 0) throw new Error(`opening and selecting loaded ${reopened.loaded().join(', ')}`);
    reopened.stop();
    const back = await recordState(page);
    if (back.attention?.reason !== 'conflict' || back.picture !== kept.picture) throw new Error(`the flag did not survive a reload: ${JSON.stringify(back)}`);
    console.log(`[${tag}] reloaded: still flagged ${JSON.stringify(back.attention)}, no worker, no Fold wasm, no dialog code`);
    await record(`edit-refold-${tag}-reopened-attention`, reopenedShots);

    // A stale figure with no record: Layer order… opens on the order a plain Refold draws, so an
    // untouched Apply is that Refold — the same picture, and no record.
    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    await splitCornerFace(page);
    await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Layer order…' }).click();
    const plainDialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
    await plainDialog.getByRole('status').filter({ hasText: 'Apply also refolds' }).waitFor({ state: 'visible', timeout: 60000 });
    const plainAsked = await page.evaluate(async () => {
      const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
      const { request } = useLayerOrderDialogStore.getState().opening;
      return { record: request.record !== null, shown: request.shown != null, applyRefolds: request.applyRefolds === true };
    });
    if (plainAsked.record || !plainAsked.shown || !plainAsked.applyRefolds) throw new Error(`the stale opening is not the plain one: ${JSON.stringify(plainAsked)}`);
    await plainDialog.getByRole('button', { name: 'Apply' }).click();
    await plainDialog.waitFor({ state: 'detached', timeout: 60000 });
    await page.waitForFunction(
      () => {
        const state = window.__treemakerWorkspaceStore.getState();
        return Object.keys(state.oristudioCpFoldRuns).length === 0 && state.oristudioCpFoldedFigures.every((f) => f.status !== 'loading');
      },
      null,
      { timeout: 120000 }
    );
    const untouched = await recordState(page);
    const untouchedLabel = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().oristudioCpHistoryPast.at(-1)?.label);
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    await pressFigureVerb(page, 'Refold');
    const plainRefold = await recordState(page);
    console.log(
      `[${tag}] stale, no record, untouched Apply: "${untouchedLabel}", record ${JSON.stringify(untouched.constraints)}, stale ${untouched.stale}; ` +
        `same picture as a plain Refold: ${untouched.picture === plainRefold.picture}`
    );
    if (untouched.constraints !== null || untouched.stale || untouchedLabel !== 'Refold folded model' || untouched.picture !== plainRefold.picture) {
      throw new Error(`an untouched Apply is not the plain Refold: ${JSON.stringify({ untouched, untouchedLabel })}`);
    }

    // A released build edits a crease inside a constrained figure and refolds it, as it can: its Refold
    // knows no record, re-baselines the figure on the new creases and writes its own snapshot (no
    // `shown_order`), and it carries the bag as it came. Reopened here, the record detaches, flagged
    // "Not applied" with Review… and Dismiss, from saved data alone; Review… and an Apply take it up
    // again, and Dismiss lets it go, as one entry an undo takes back.
    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    const detachedId = await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    await chosenOrder(page, detachedId);
    if (!(await applyChosenOrder(page, detachedId))) throw new Error('Apply wrote nothing');
    const ours = JSON.parse(await savedProject(page));
    await page.evaluate((detachedId) => {
      const store = window.__treemakerWorkspaceStore;
      store.setState({
        oristudioCpFoldedFigures: store
          .getState()
          .oristudioCpFoldedFigures.map((entry) => (entry.id === detachedId ? { ...entry, layerOrder: undefined } : entry)),
      });
    }, detachedId);
    await splitCornerFace(page);
    await pressFigureVerb(page, 'Refold');
    const olderBuilds = JSON.parse(await savedProject(page));
    const olderFigure = olderBuilds.workspace.creasePattern.viewState.foldedFigures[0];
    delete olderFigure.snapshot.shown_order;
    olderBuilds.workspace.creasePattern.extensions = ours.workspace.creasePattern.extensions;
    const oursFigure = ours.workspace.creasePattern.viewState.foldedFigures[0];
    const linesIn = (file) => file.workspace.creasePattern.creasePattern.document.crease_pattern.line_segments.length;
    console.log(
      `[${tag}] an older build's refold after an edit: lines ${linesIn(ours)} → ${linesIn(olderBuilds)}, ` +
        `fingerprint changed ${oursFigure.sourceFingerprint !== olderFigure.sourceFingerprint}, the bag carried as it came`
    );
    if (oursFigure.sourceFingerprint === olderFigure.sourceFingerprint) throw new Error('the older build’s refold kept the fingerprint');
    const watchDetached = watchLayerOrderLoads(page);
    await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
    await openTextInEdit(page, JSON.stringify(olderBuilds), 'kabuto-older.osf', theme);
    await page.evaluate(() => {
      const store = window.__treemakerWorkspaceStore;
      store.getState().setOristudioCpActiveFoldedFigure(store.getState().oristudioCpFoldedFigures[0].id);
    });
    await zoomOutToFigure(page);
    const detachedShots = await figureShots(page);
    await page.waitForTimeout(1500);
    if (watchDetached.loaded().length > 0) throw new Error(`the detached figure loaded ${watchDetached.loaded().join(', ')}`);
    watchDetached.stop();
    const detachedState = await page.evaluate(async () => {
      const state = window.__treemakerWorkspaceStore.getState();
      const figure = state.oristudioCpFoldedFigures[0];
      const { isFoldedFigureStale } = await import('/src/cp-workspace/folded/foldedFigureStaleness.ts');
      return {
        own: figure.layerOrder?.kind ?? null,
        detached: figure.detachedLayerOrder?.record.constraints.length ?? null,
        stale: isFoldedFigureStale(state.oristudioCpDocument.document, figure),
      };
    });
    const detachedSheet = page.locator('[data-property-sheet]');
    const detachedSubtitle = await detachedSheet.locator('[data-property-sheet-subtitle]').innerText();
    const chip = await page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name }).getByRole('button', { name: 'Not applied' }).innerText();
    await detachedSheet.getByRole('button', { name: 'Dismiss' }).waitFor({ state: 'visible', timeout: 10000 });
    console.log(
      `[${tag}] detached by an older build: ${JSON.stringify(detachedState)}; Properties "${detachedSubtitle}" with Review… and Dismiss; chip "${chip}"; nothing loaded`
    );
    if (detachedState.own !== null || detachedState.detached === null || detachedState.stale) {
      throw new Error(`the record is not shown detached on an up-to-date figure: ${JSON.stringify(detachedState)}`);
    }
    await record(`edit-refold-${tag}-detached`, detachedShots);

    await detachedSheet.getByRole('button', { name: 'Review…' }).click();
    const detachedDialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
    await detachedDialog.getByRole('complementary', { name: 'Layer order details' }).waitFor({ state: 'visible', timeout: 60000 });
    const detachedAsked = await page.evaluate(async () => {
      const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
      const { request } = useLayerOrderDialogStore.getState().opening;
      return { review: request.review === true, attention: request.record?.attention ?? null };
    });
    if (!detachedAsked.review || detachedAsked.attention?.reason !== 'detached') {
      throw new Error(`Review… did not open on the detached record: ${JSON.stringify(detachedAsked)}`);
    }
    await page.waitForTimeout(500);
    await record(`edit-refold-${tag}-detached-dialog`, await dialogShot(page));
    // Untouched, the Apply still writes: it takes the record up.
    await detachedDialog.getByRole('button', { name: 'Apply' }).click();
    await detachedDialog.waitFor({ state: 'detached', timeout: 60000 });
    await page.waitForFunction(
      () => window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.layerOrder?.kind === 'record',
      null,
      { timeout: 60000 }
    );
    const takenUp = JSON.parse(await savedProject(page)).workspace.creasePattern.extensions['oristudio.foldedFigureLayerOrders'];
    console.log(`[${tag}] Review… and an untouched Apply took it up: the bag holds ${Object.keys(takenUp.figures ?? {}).length} record, ${takenUp.detached?.length ?? 0} detached`);
    if (!takenUp.figures || takenUp.detached) throw new Error(`the save kept the detached entry: ${JSON.stringify(takenUp)}`);
    await record(`edit-refold-${tag}-detached-taken`, await figureShots(page));

    // The Apply undone, the flag is back; Dismiss lets it go as one entry, and an undo takes that back.
    const flagShown = () =>
      page.evaluate(() => {
        const figure = window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[0];
        return figure.layerOrder == null && figure.detachedLayerOrder != null && figure.detachedLayerOrder.settled == null;
      });
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    await detachedSheet.getByRole('button', { name: 'Dismiss' }).waitFor({ state: 'visible', timeout: 10000 });
    if (!(await flagShown())) throw new Error('the undone Apply did not bring the flag back');
    await detachedSheet.getByRole('button', { name: 'Dismiss' }).click();
    await detachedSheet.getByRole('button', { name: 'Dismiss' }).waitFor({ state: 'detached', timeout: 10000 });
    const dismissedLabel = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().oristudioCpHistoryPast.at(-1)?.label);
    const dismissedBag = JSON.parse(await savedProject(page)).workspace.creasePattern.extensions['oristudio.foldedFigureLayerOrders'] ?? null;
    const dismissedShots = await figureShots(page);
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    await detachedSheet.getByRole('button', { name: 'Dismiss' }).waitFor({ state: 'visible', timeout: 10000 });
    const backAfterUndo = await flagShown();
    console.log(
      `[${tag}] Dismiss: "${dismissedLabel}", the bag after it ${JSON.stringify(dismissedBag)}; undone, the flag is back ${backAfterUndo}`
    );
    if (dismissedLabel !== 'Dismiss layer constraints' || dismissedBag !== null || !backAfterUndo) {
      throw new Error(`Dismiss did not let the record go as one entry: ${JSON.stringify({ dismissedLabel, dismissedBag, backAfterUndo })}`);
    }
    await record(`edit-refold-${tag}-detached-dismissed`, dismissedShots);

    // Deleted while it shows the flag, and the same creases folded again in this session with no save
    // between: the new figure never takes the deleted one's id, so neither it nor a reload shows the record.
    const reusedBefore = await page.evaluate(async () => {
      const store = window.__treemakerWorkspaceStore;
      const figure = store.getState().oristudioCpFoldedFigures[0];
      const { deleteFoldedFigure } = await import('/src/cp-workspace/folded/foldedFigureVerbs.ts');
      const i18n = (await import('/src/i18n/index.ts')).default;
      await deleteFoldedFigure(figure.id, i18n.t);
      return { id: figure.id, title: figure.title, left: store.getState().oristudioCpFoldedFigures.length };
    });
    const refoldedId = await foldWholeAndSelect(page);
    const flagAfterFold = await page.evaluate(() =>
      window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures.some((figure) => figure.detachedLayerOrder != null)
    );
    const reusedWatch = await reopenSaved(page, url, theme, 'kabuto-reused.osf');
    const reusedReopened = await page.evaluate(() => {
      const state = window.__treemakerWorkspaceStore.getState();
      return {
        ids: state.oristudioCpFoldedFigures.map((figure) => figure.id),
        shown: state.oristudioCpFoldedFigures.filter((figure) => figure.detachedLayerOrder != null).length,
        detached: (state.oristudioCpDocumentExtensions['oristudio.foldedFigureLayerOrders']?.detached ?? []).map((entry) => entry.reason),
      };
    });
    reusedWatch.stop();
    console.log(
      `[${tag}] deleted ${reusedBefore.id} ("${reusedBefore.title}") and folded again in the session: ${refoldedId}, flag ${flagAfterFold}; ` +
        `saved and reopened: ${JSON.stringify(reusedReopened)}`
    );
    // Its entry: gone with it (earlier saves here dropped it, settled, before the undos brought the flag back), or missing.
    if (refoldedId === reusedBefore.id || flagAfterFold || reusedReopened.shown !== 0 || reusedReopened.detached.includes('order-not-given')) {
      throw new Error(`a fold after the Delete was shown the record: ${JSON.stringify({ refoldedId, flagAfterFold, reusedReopened })}`);
    }

    // A book fold whose crease gains a fold angle: Refold shows it in 3D, its record kept and waiting (D13).
    const book = [
      '1 -200 -200 0 -200',
      '1 0 -200 200 -200',
      '1 200 -200 200 200',
      '1 200 200 0 200',
      '1 0 200 -200 200',
      '1 -200 200 -200 -200',
      '3 0 -200 0 200',
    ].join('\n');
    await openTextInEdit(page, book, 'book.cp', theme);
    const bookId = await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    await page.evaluate(async (bookId) => {
      const store = window.__treemakerWorkspaceStore;
      const { foldedFigureLayerOrder } = await import('/src/lib/layerOrder/foldedFigureLayerOrder.ts');
      const { FOLD_MAGNITUDE_UNITS_PER_DEGREE } = await import('/src/lib/foldAngle.ts');
      // Synthetic: one constraint between the two halves, which the fold forces anyway.
      const held = foldedFigureLayerOrder({
        faces: [
          { at: [-100, 0], area: 40000 },
          { at: [100, 0], area: 40000 },
        ],
        constraints: [[0, 1, 1]],
        order: [],
      });
      store.setState({
        oristudioCpFoldedFigures: store
          .getState()
          .oristudioCpFoldedFigures.map((entry) => (entry.id === bookId ? { ...entry, layerOrder: held.layerOrder } : entry)),
      });
      const lines = store.getState().oristudioCpDocument.document.crease_pattern.line_segments;
      const index = lines.findIndex((line) => line.color === 'Blue2');
      await store
        .getState()
        .replaceOristudioCpLineSegments([index + 1], [{ ...lines[index], fold_magnitude: 90 * FOLD_MAGNITUDE_UNITS_PER_DEGREE }], 'Set fold angle');
      // The edited crease took the selection: the figure takes it back.
      store.getState().setOristudioCpActiveFoldedFigure(bookId);
    }, bookId);
    await pressFigureVerb(page, 'Refold');
    const spatial = await recordState(page);
    console.log(`[${tag}] book refolded: ${spatial.kind}, record ${spatial.constraints} constraint, ${JSON.stringify(spatial.attention)}`);
    if (spatial.kind !== '3d' || spatial.constraints !== 1 || spatial.attention?.reason !== 'route-3d') {
      throw new Error(`the 3D refold did not keep the record waiting: ${JSON.stringify(spatial)}`);
    }
    await record(`edit-refold-${tag}-3d`, await figureShots(page, { hover: true }));
    const reopened3d = await reopenSaved(page, url, theme, 'book-3d.osf');
    await zoomOutToFigure(page);
    // The idle 3D rehydrate runs in the background: it makes the figure live and asks nothing of the record.
    await page.waitForFunction(() => window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.handle != null, null, {
      timeout: 60000,
    });
    const shots3d = await figureShots(page);
    await page.waitForTimeout(1500);
    if (reopened3d.loaded().length > 0) throw new Error(`the reopened 3D figure loaded ${reopened3d.loaded().join(', ')}`);
    reopened3d.stop();
    const back3d = await recordState(page);
    if (back3d.kind !== '3d' || back3d.attention?.reason !== 'route-3d') throw new Error(`the 3D record did not survive a reload: ${JSON.stringify(back3d)}`);
    console.log(`[${tag}] book reloaded and rehydrated in 3D: record kept ${JSON.stringify(back3d.attention)}, no worker, no Fold wasm`);
    await record(`edit-refold-${tag}-reopened-3d`, shots3d);
    console.log(`[${tag}] done in ${Math.round((Date.now() - t0) / 1000)} s`);
  };
}

// ---------------------------------------------------------------------------
// Edit's selection: Fold with layer order… (H5)

const SELECTION_TOOLBAR = { role: 'toolbar', name: 'Crease pattern actions' };
const FOLD_WITH_LAYER_ORDER = 'Fold with layer order…';

/** Every line of the open pattern selected, as Select All does: one whole sheet, so the selection toolbar shows. */
async function selectWholeSheet(page) {
  await page.evaluate(async () => {
    const { handleMenuAction } = await import('/src/commands/menuActions.ts');
    await handleMenuAction('edit.selectAll');
  });
  await page.getByRole(SELECTION_TOOLBAR.role, { name: SELECTION_TOOLBAR.name }).waitFor({ state: 'visible', timeout: 30000 });
}

/** The selection toolbar, and again with the pointer on Fold with layer order…, its tooltip in the picture. */
async function selectionToolbarShots(page) {
  const toolbar = page.getByRole(SELECTION_TOOLBAR.role, { name: SELECTION_TOOLBAR.name });
  await page.mouse.move(1, 1);
  const shots = { toolbar: await steadyShot(page, toolbar, { masked: false }) };
  const target = await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).boundingBox();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2);
  await page.getByRole('tooltip').first().waitFor({ state: 'visible', timeout: 10000 });
  const box = await toolbar.boundingBox();
  await settle(page);
  shots.tooltip = await page.screenshot({
    clip: { x: Math.max(0, box.x - 60), y: Math.max(0, box.y - 70), width: box.width + 120, height: box.height + 110 },
    animations: 'disabled',
  });
  await page.mouse.move(1, 1);
  return shots;
}

/** What the canvas holds and remembers: its figures, its undo entries' labels, whether a fold runs. */
function editCanvasState(page) {
  return page.evaluate(() => {
    const state = window.__treemakerWorkspaceStore.getState();
    return {
      figures: state.oristudioCpFoldedFigures.map((figure) => ({
        id: figure.id,
        status: figure.status,
        handle: figure.handle,
        shownOrder: figure.snapshot?.shown_order ?? 'searched',
        layerOrder: figure.layerOrder?.kind ?? null,
        picture: JSON.stringify(figure.renderSnapshot),
      })),
      history: state.oristudioCpHistoryPast.map((entry) => entry.label),
      folding: Object.keys(state.oristudioCpFoldRuns).length,
      dirty: state.dirty,
    };
  });
}

/** The request the open dialog was asked with, as far as the host decides it. */
function openedRequest(page) {
  return page.evaluate(async () => {
    const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
    const request = useLayerOrderDialogStore.getState().opening?.request;
    if (!request) return null;
    return {
      surface: request.surface,
      name: request.name,
      record: request.record,
      digest: request.source.digest,
      segments: request.source.segments.length,
      shown: Boolean(request.shown),
      side: request.look.side,
      turnDeg: request.look.turnDeg,
      xray: request.look.xray,
    };
  });
}

/**
 * Apply, with the order the dialog's engine would choose on the open dialog's
 * own source (U10 isn't built): one open pair constrained whichever way moves
 * the order off Oriedita's first, saved, and handed back as Apply hands it.
 */
async function applyEngineChosenOrder(page) {
  return page.evaluate(async () => {
    const { useLayerOrderDialogStore, settleLayerOrderDialog } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS, constraintSeen } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const opening = useLayerOrderDialogStore.getState().opening;
    const { source } = opening.request;
    const engine = createLayerOrderRuntime({ role: 'dialog' });
    try {
      const opened = await engine.engine.open(source, LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
      const first = Array.from(await engine.engine.relations()).join();
      for (let i = 0; i < opened.open_pairs.length; i += 2) {
        const [lo, hi] = [opened.open_pairs[i], opened.open_pairs[i + 1]];
        for (const verb of ['in_front_of', 'behind']) {
          const committed = await engine.engine.commit([constraintSeen(lo, verb, hi, 'front', opened.front_up[hi] === 1)], LAYER_ORDER_LIMITS.commit);
          if (committed.verdict !== 'committed') continue;
          const relations = await engine.engine.relations();
          if (Array.from(relations).join() === first) continue;
          const saved = await engine.engine.save();
          if (saved.status !== 'ok') throw new Error(`save refused: ${JSON.stringify(saved.refusal)}`);
          settleLayerOrderDialog(opening.id, { kind: 'applied', applied: { record: saved.record, relations, source } });
          return saved.record.constraints.length;
        }
      }
      throw new Error('no constraint moves the order');
    } finally {
      engine.dispose();
    }
  });
}

const PATTERN_CHANGED = 'The crease pattern changed meanwhile, so Layer order changed nothing.';

/** The toast a press whose crease pattern changed or went says (`foldPress.ts`). */
function patternChangedToast(page) {
  return page.locator('[data-sonner-toast]').filter({ hasText: PATTERN_CHANGED });
}

/** Forget the last error, and close every toast, so the next one is known to be new. */
async function clearCpError(page) {
  await page.evaluate(() => {
    window.__treemakerWorkspaceStore.setState({ oristudioCpError: null, error: null });
    for (const close of document.querySelectorAll('[data-sonner-toast] [data-close-button]')) close.click();
  });
  await page.waitForFunction(
    (text) => ![...document.querySelectorAll('[data-sonner-toast]')].some((toast) => toast.textContent.includes(text)),
    PATTERN_CHANGED,
    { timeout: 10000 }
  );
}

/**
 * The press said its crease pattern changed, on a toast, as the app's
 * ordinary message: no fault, so neither an error toast nor an error in the
 * store for `GlobalToasts` to show as one.
 */
async function saidPatternChanged(page) {
  const toast = patternChangedToast(page).first();
  await toast.waitFor({ state: 'visible', timeout: 30000 });
  const kind = await toast.getAttribute('data-type');
  const error = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().error);
  if (kind === 'error' || error) throw new Error(`the press said its crease pattern changed as an error (${kind}, ${JSON.stringify(error)})`);
}

/** One crease deleted, as Delete does on a selected crease. */
async function deleteOneCrease(page) {
  await page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    store.getState().setOristudioCpSelection({ ...store.getState().oristudioCpSelection, lines: [5] });
    const { handleMenuAction } = await import('/src/commands/menuActions.ts');
    await handleMenuAction('edit.delete');
  });
}

/** The dialog, open and ready on what it was asked. */
async function readyDialog(page) {
  const dialog = page.getByRole(DIALOG.role, { name: DIALOG.name });
  await dialog.waitFor({ state: 'visible', timeout: 60000 });
  await dialog.getByRole('complementary', { name: 'Layer order details' }).waitFor({ state: 'visible', timeout: 60000 });
  return dialog;
}

/**
 * Fold with layer order… on kabuto's whole sheet, in one theme: the selection
 * toolbar with the new button and its tooltip; the press, which folds the
 * sheet for the dialog and opens it on that fold; Cancel, which leaves no
 * figure and no entry; Apply on the order it opened on, one figure and one
 * entry, undone; the order the dialog's engine would choose, committed as its
 * Apply is (the real dialog's Apply waits for U10); Settings ▸ Shortcuts
 * listing it Unassigned after Fold estimate, a key bound there and pressed;
 * and the button held, with why, on creases that fold in 3D.
 */
function editSelectionCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    await selectWholeSheet(page);
    await record(`selection-${tag}-toolbar`, await selectionToolbarShots(page));

    // The press: the sheet folded for the dialog alone, which opens on it.
    const toolbar = page.getByRole(SELECTION_TOOLBAR.role, { name: SELECTION_TOOLBAR.name });
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    let dialog = await readyDialog(page);
    const asked = await openedRequest(page);
    if (asked?.surface !== 'edit_pattern' || asked.record !== null || !asked.shown || asked.side !== 'front' || asked.xray) {
      throw new Error(`the request: ${JSON.stringify(asked)}`);
    }
    const whileOpen = await editCanvasState(page);
    if (whileOpen.figures.length !== 0 || whileOpen.history.length !== 0) {
      throw new Error(`the press put something on the canvas: ${JSON.stringify(whileOpen)}`);
    }
    console.log(`[${tag}] the press opened the dialog on the sheet's fold (${asked.segments} creases, turned ${asked.turnDeg}°, "${asked.name}"); nothing on the canvas`);
    await record(`selection-${tag}-dialog`, await dialogShot(page));

    // Cancel: no figure, no entry.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30000 });
    const cancelled = await editCanvasState(page);
    if (cancelled.figures.length !== 0 || cancelled.history.length !== 0 || cancelled.folding !== 0 || cancelled.dirty) {
      throw new Error(`Cancel left something: ${JSON.stringify(cancelled)}`);
    }
    console.log(`[${tag}] Cancel: no figure, no undo entry, not dirty`);

    // Apply on the order it opened on: a figure as Fold makes it, one entry.
    await selectWholeSheet(page);
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    dialog = await readyDialog(page);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await page.waitForFunction(
      () => window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.status === 'ready',
      null,
      { timeout: 60000 }
    );
    const unchanged = await editCanvasState(page);
    if (unchanged.figures.length !== 1 || unchanged.history.join() !== 'Fold model' || unchanged.figures[0].layerOrder !== null) {
      throw new Error(`Apply unchanged: ${JSON.stringify(unchanged)}`);
    }
    console.log(`[${tag}] Apply on the order it opened on: one figure, no record, one entry "${unchanged.history[0]}"`);
    await zoomOutToFigure(page);
    await record(`selection-${tag}-applied-unchanged`, {
      canvas: await steadyShot(page, page.locator('canvas.cp-webgl-layer').locator('..'), { masked: false }),
    });

    // The order the dialog's engine would choose on the open dialog's source, handed back as its Apply hands it.
    const plain = unchanged.figures[0];
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    if ((await editCanvasState(page)).figures.length !== 0) throw new Error('undo left the figure');
    await selectWholeSheet(page);
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    await readyDialog(page);
    await applyEngineChosenOrder(page);
    await page.waitForFunction(
      () => window.__treemakerWorkspaceStore.getState().oristudioCpFoldedFigures[0]?.status === 'ready',
      null,
      { timeout: 60000 }
    );
    const applied = await editCanvasState(page);
    const [figure] = applied.figures;
    if (applied.figures.length !== 1 || figure.shownOrder !== 'given' || figure.layerOrder !== 'record' || applied.history.join() !== 'Fold model') {
      throw new Error(`the chosen order did not land: ${JSON.stringify(applied)}`);
    }
    if (figure.picture === plain.picture) throw new Error('the chosen order draws Oriedita’s picture');
    console.log(`[${tag}] the chosen order folded through fold_with_order: one figure, order given, record kept, one entry`);
    await record(`selection-${tag}-applied-chosen`, {
      canvas: await steadyShot(page, page.locator('canvas.cp-webgl-layer').locator('..'), { masked: false }),
    });
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    if ((await editCanvasState(page)).figures.length !== 0) throw new Error('undo left the chosen figure');
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().redo());
    const redone = await editCanvasState(page);
    if (redone.figures[0]?.handle !== figure.handle || redone.figures[0]?.layerOrder !== 'record') {
      throw new Error(`redo: ${JSON.stringify(redone)}`);
    }
    console.log(`[${tag}] undo and redo: the figure goes and comes back on its fold, with its record`);

    // Settings ▸ Shortcuts: Unassigned, right after Fold estimate; then a key bound there.
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/store/settingsStore.ts');
      useSettingsStore.getState().openSettings('shortcuts');
    });
    const row = (label) => page.locator('.settings-shortcuts__row').filter({ has: page.getByText(label, { exact: true }) });
    const ours = row(FOLD_WITH_LAYER_ORDER);
    await ours.waitFor({ state: 'visible', timeout: 30000 });
    const estimate = row('Fold estimate');
    const order = await page.evaluate(() =>
      [...document.querySelectorAll('.settings-shortcuts__copy span')].map((span) => span.textContent)
    );
    if (order[order.indexOf('Fold estimate') + 1] !== FOLD_WITH_LAYER_ORDER) throw new Error('not right after Fold estimate');
    if ((await ours.getByRole('button', { name: 'Unassigned' }).count()) !== 1) throw new Error('not Unassigned');
    await estimate.scrollIntoViewIfNeeded();
    await page.mouse.move(1, 1);
    const rows = async () => {
      const top = await estimate.boundingBox();
      const bottom = await ours.boundingBox();
      return page.screenshot({
        clip: { x: top.x - 8, y: top.y - 8, width: top.width + 16, height: bottom.y + bottom.height - top.y + 16 },
        animations: 'disabled',
      });
    };
    await record(`selection-${tag}-shortcuts-unassigned`, { rows: await rows() });
    await ours.getByRole('button', { name: 'Unassigned' }).click();
    await page.keyboard.press('Alt+Shift+KeyK');
    const bound = await page.evaluate(async () => {
      const { useShortcutStore } = await import('/src/store/shortcutStore.ts');
      return useShortcutStore.getState().overrides['cp.action.fold-with-layer-order'] ?? null;
    });
    if (!bound?.length) throw new Error('capture bound nothing');
    await page.mouse.move(1, 1);
    await record(`selection-${tag}-shortcuts-bound`, { rows: await rows() });
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/store/settingsStore.ts');
      useSettingsStore.getState().closeSettings();
    });
    await ours.waitFor({ state: 'detached', timeout: 30000 });
    console.log(`[${tag}] Settings: Unassigned after Fold estimate; bound to ${JSON.stringify(bound)}`);

    // The key, on the canvas, with the sheet selected: the dialog opens on it.
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    await selectWholeSheet(page);
    await page.keyboard.press('Alt+Shift+KeyK');
    dialog = await readyDialog(page);
    if ((await openedRequest(page))?.digest !== asked.digest) throw new Error('the key opened the dialog on another fold');
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'detached', timeout: 30000 });
    if ((await editCanvasState(page)).figures.length !== 0) throw new Error('Escape left a figure');
    console.log(`[${tag}] the bound key opened the dialog on the sheet's fold; Escape left nothing`);

    // A crease edited between the press and its fold: the press is held at its pre-fold
    // warning (a crease deleted first, so the sheet has errors), a second crease is deleted
    // meanwhile, and Yes lets it fold. It stops before its dialog opens: no dialog, no
    // figure, and the reason said.
    const figuresMade = async () => (await editCanvasState(page)).figures.length;
    await page.evaluate(async () => {
      const { useSettingsStore } = await import('/src/store/settingsStore.ts');
      useSettingsStore.setState({ foldWarningEnabled: true });
    });
    await deleteOneCrease(page);
    await clearCpError(page);
    await selectWholeSheet(page);
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    const warning = page.getByText('Detected errors in flat foldability. Continue to fold?');
    await warning.waitFor({ state: 'visible', timeout: 30000 });
    await deleteOneCrease(page);
    await page.getByRole('button', { name: 'Yes', exact: true }).click();
    await saidPatternChanged(page);
    if (await page.getByRole(DIALOG.role, { name: DIALOG.name }).isVisible()) throw new Error('the dialog opened on creases that changed');
    if ((await figuresMade()) !== 0) throw new Error('an edit behind the press still made a figure');
    console.log(`[${tag}] a crease edited between the press and its fold: no dialog, no figure, "${PATTERN_CHANGED}"`);
    await record(`selection-${tag}-edited-behind-press`, { toast: await steadyShot(page, patternChangedToast(page).first(), { masked: false }) });
    // Kabuto again: both deletions undone.
    await page.evaluate(async () => {
      await window.__treemakerWorkspaceStore.getState().undo();
      await window.__treemakerWorkspaceStore.getState().undo();
    });

    // A crease edited while the dialog is open (as a native menu could): Apply writes nothing.
    await clearCpError(page);
    await selectWholeSheet(page);
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    dialog = await readyDialog(page);
    await deleteOneCrease(page);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await saidPatternChanged(page);
    if ((await figuresMade()) !== 0) throw new Error('Apply after an edit made a figure');
    console.log(`[${tag}] a crease deleted while the dialog was open: Apply made no figure, and said why`);
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());

    // Another document opened while the dialog is open: Apply lands nothing in it.
    await clearCpError(page);
    await selectWholeSheet(page);
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    dialog = await readyDialog(page);
    const other = await readFile(path.join(repoRoot, 'tests/fixtures/oriedita/solution_sample_1.cp'), 'utf8');
    await openTextInEdit(page, other, 'solution_sample_1.cp', theme);
    if (!(await dialog.isVisible())) throw new Error('the dialog closed with the document');
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await saidPatternChanged(page);
    const replaced = await editCanvasState(page);
    if (replaced.figures.length !== 0 || replaced.history.length !== 0) {
      throw new Error(`Apply landed in the new document: ${JSON.stringify(replaced)}`);
    }
    console.log(`[${tag}] another document opened while the dialog was open: Apply landed nothing in it, and said why`);
    await page.mouse.move(1, 1);
    await record(`selection-${tag}-document-replaced`, {
      canvas: await steadyShot(page, page.locator('canvas.cp-webgl-layer').locator('..'), { masked: false }),
    });

    // Creases that fold in 3D: held, with why.
    await openFileInEdit(page, url, 'tests/fixtures/fold-angle-3d/box_90.fold', theme);
    await selectWholeSheet(page);
    if (!(await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).isDisabled())) throw new Error('not held on 3D creases');
    await record(`selection-${tag}-3d`, await selectionToolbarShots(page));
  };
}

// ---------------------------------------------------------------------------
// A document of many crease patterns: the dialog shows the one the fold came from

/**
 * A document of many small crease patterns, as `.cp` text: kabuto
 * (`tests/fixtures/flat-folder/kabuto.fold`) laid out `columns` by `rows`,
 * 40 units each, 60 apart, each with an aux line across it, as a sheet of a
 * designer's patterns is. Built here: nobody's file.
 */
async function manyKabutosCp(columns, rows) {
  const fold = JSON.parse(await readFile(path.join(repoRoot, 'tests/fixtures/flat-folder/kabuto.fold'), 'utf8'));
  const TYPE = { B: 1, M: 2, V: 3, F: 4 };
  const lines = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const ox = (column - columns / 2) * 60;
      const oy = (row - rows / 2) * 60;
      const at = ([x, y]) => [ox + x * 40, oy + y * 40];
      fold.edges_vertices.forEach(([a, b], edge) => {
        const type = TYPE[fold.edges_assignment[edge]];
        if (!type) return;
        lines.push(`${type} ${at(fold.vertices_coords[a]).join(' ')} ${at(fold.vertices_coords[b]).join(' ')}`);
      });
      lines.push(`4 ${ox} ${oy + 12} ${ox + 40} ${oy + 12}`);
    }
  }
  return lines.join('\n');
}

/** Edit on {@link manyKabutosCp}, in `theme`; the sheet nearest the middle of the canvas, and how many there are. */
async function openManyPatterns(page, url, theme, { columns = 10, rows = 10 } = {}) {
  await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
  await openTextInEdit(page, await manyKabutosCp(columns, rows), 'many-kabutos.cp', theme);
  return page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const { ensureCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
    const { sheetRegions } = await import('/src/cp-workspace/sheets/cpSheetRegions.ts');
    const regions = sheetRegions(await ensureCpSheetIndex(store.getState().oristudioCpDocument.document));
    const centre = ({ bounds }) => ({ x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 });
    const middle = regions.map(centre).reduce((sum, c) => ({ x: sum.x + c.x / regions.length, y: sum.y + c.y / regions.length }), { x: 0, y: 0 });
    const away = (region) => Math.hypot(centre(region).x - middle.x, centre(region).y - middle.y);
    const sheet = regions.reduce((best, region) => (away(region) < away(best) ? region : best));
    window.__layerOrderCheck = { ...(window.__layerOrderCheck ?? {}), sheet: sheet.id };
    return { sheets: regions.length, sheet: sheet.id, lineIds: [...sheet.lineIds], bounds: sheet.bounds };
  });
}

/** The region the open dialog was asked with, against its source: how much of the document it draws. */
function openedRegion(page) {
  return page.evaluate(async () => {
    const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
    const { ringsBounds } = await import('/src/layer-order/panes/layerPaneFigure.ts');
    const request = useLayerOrderDialogStore.getState().opening?.request;
    if (!request) return null;
    return {
      surface: request.surface,
      paper: request.region ? ringsBounds(request.region.paper) : null,
      regionAux: request.region?.auxSegments.length ?? null,
      documentAux: request.source.auxSegments.length,
      creases: request.source.segments.length,
    };
  });
}

/**
 * How much of a pane its content fills, in the pane's own pixels, across the
 * side that limits it: Fit fills 70% of it. Fit centres the content,
 * so its extent is the pane less twice its margin, read where nothing floats
 * over it: from the top, and from the nearer side, over the rows the zoom bar
 * along the foot leaves clear (a tall figure runs on under the bar). Ink is
 * any pixel unlike the pane's ground, read off its corner.
 */
async function paneFill(page, dialog, pane) {
  const canvas = dialog.locator(`[data-testid="layer-order-${pane}-canvas"]`);
  const bar = dialog.getByRole('toolbar', { name: pane === 'pattern' ? 'Crease pattern view' : 'Folded figure view' });
  await page.mouse.move(1, 1);
  const shot = await steadyShot(page, canvas, { masked: false });
  const [box, barBox] = [await canvas.boundingBox(), await bar.boundingBox()];
  // The bar's rows, and its shadow's, in the shot's pixels.
  const clear = barBox ? { from: barBox.y - box.y - 24, to: barBox.y + barBox.height - box.y + 24 } : { from: Infinity, to: -Infinity };
  return page.evaluate(
    async ({ data, clear }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const context = Object.assign(document.createElement('canvas'), { width: image.width, height: image.height }).getContext('2d');
      context.drawImage(image, 0, 0);
      const { data: rgba } = context.getImageData(0, 0, image.width, image.height);
      // Not the pane's own rim: the rule between the panes runs along one side.
      const RIM = 3;
      const ground = (RIM + 3) * image.width * 4 + (RIM + 3) * 4;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      for (let y = RIM; y < image.height - RIM; y += 1) {
        if (y >= clear.from && y <= clear.to) continue;
        for (let x = RIM; x < image.width - RIM; x += 1) {
          const k = (y * image.width + x) * 4;
          const unlike = Math.abs(rgba[k] - rgba[ground]) + Math.abs(rgba[k + 1] - rgba[ground + 1]) + Math.abs(rgba[k + 2] - rgba[ground + 2]);
          if (unlike < 30) continue;
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
        }
      }
      const side = Math.min(minX, image.width - 1 - maxX);
      const width = image.width - 2 * side;
      const height = image.height - 2 * minY;
      const fill = Math.max(width / image.width, height / image.height);
      return { pane: [image.width, image.height], content: [width, height], fill: Math.round(fill * 1000) / 1000 };
    },
    { data: shot.toString('base64'), clear }
  );
}

/** What Fit fills of a pane: `PaperPane`'s share, as every surface fits (`DEFAULT_FIT_SHARE`). */
const FIT_FILL = 0.7;

/** Fit both panes, then how much each fills; throws unless each fills about {@link FIT_FILL}. */
async function fitFills(page, dialog, what) {
  await dialog.getByRole('button', { name: 'Fit both views' }).first().click();
  const fills = { pattern: await paneFill(page, dialog, 'pattern'), folded: await paneFill(page, dialog, 'folded') };
  const readouts = await Promise.all(
    ['crease pattern', 'folded figure'].map((pane) => dialog.getByRole('button', { name: `Reset the ${pane} zoom` }).innerText())
  );
  console.log(`  ${what} at Fit: crease pattern ${JSON.stringify(fills.pattern)} at ${readouts[0]}, folded ${JSON.stringify(fills.folded)} at ${readouts[1]}`);
  for (const [pane, { fill }] of Object.entries(fills)) {
    if (Math.abs(fill - FIT_FILL) > 0.03 && !process.env.LAYER_ORDER_CHECK_LENIENT) {
      throw new Error(`${what}: the ${pane} pane fills ${fill} of itself at Fit, not about ${FIT_FILL}`);
    }
  }
  return fills;
}

/**
 * A face picked on the crease-pattern pane lights the same face on the
 * folded pane: the first subject on offer, from its menu, then cleared and
 * picked again by a click inside its ring on the crease pattern. Its face.
 */
async function patternPickLightsFolded(page, dialog, what) {
  await subjectSlot(dialog).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Subjects' });
  await menu.waitFor({ state: 'visible', timeout: 10000 });
  await menu.getByRole('menuitemradio').first().click();
  await menu.waitFor({ state: 'detached', timeout: 10000 });
  const letter = (await subjectSlot(dialog).getAttribute('aria-label'))?.match(/face ([^.\s]+)\./)?.[1];
  const face = Number(await dialog.locator('[data-layer-order-marks="pattern"] [data-layer-order-ring]').first().getAttribute('data-layer-order-ring'));
  if (!letter || !Number.isInteger(face)) throw new Error(`${what}: no subject to pick`);
  await pickSubjectOnPane(page, dialog, 'pattern', letter, face);
  const lit = await dialog.locator(`[data-layer-order-marks="folded"] [data-layer-order-ring="${face}"]`).count();
  if (lit === 0) throw new Error(`${what}: ${letter} picked on the crease pattern lights nothing on the folded figure`);
  console.log(`  ${what}: ${letter} (face ${face}) picked on the crease pattern, ringed on the folded figure`);
  return { letter, face };
}

/** The dialog's request and panes for one host: its region, a shot, Fit's fill, a pick's alignment; then Cancel. */
async function checkRegionDialog(page, record, shot, what) {
  const dialog = await readyDialog(page);
  const region = await openedRegion(page);
  console.log(`  ${what}: ${JSON.stringify(region)}`);
  if (!region?.paper && !process.env.LAYER_ORDER_CHECK_LENIENT) throw new Error(`${what}: the request names no region`);
  await page.waitForTimeout(500);
  await record(shot, await panesShot(page));
  await fitFills(page, dialog, what);
  const picked = await patternPickLightsFolded(page, dialog, what);
  await record(`${shot}-picked`, await panesShot(page));
  await dialog.getByRole('button', { name: `Clear ${picked.letter} from the subject` }).click();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'detached', timeout: 30000 });
}

/**
 * A document of a hundred patterns (panes-fit), in one theme: each host opens
 * the dialog on the pattern in the middle, and the crease-pattern pane shows
 * that pattern alone, framed on its paper, the folded pane the figure, each
 * filling about 70% at Fit; a face picked on the crease pattern lights the
 * same face on the folded figure. Fold with layer order… on the selection
 * (H5); Layer order… on a figure folded from it (H3); a Diagram step linked
 * to it (H7); and Pose on that step (H8).
 */
function manyPatternCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record) => {
    const middle = await openManyPatterns(page, url, theme);
    console.log(`[${tag}] ${middle.sheets} patterns; the middle one is sheet ${middle.sheet}, ${middle.lineIds.length} lines`);
    if (middle.sheets !== 100) throw new Error(`the document holds ${middle.sheets} patterns, not 100`);

    // Fold with layer order… on the middle pattern, selected (H5).
    await page.evaluate(async (lines) => {
      const store = window.__treemakerWorkspaceStore;
      const { emptyOristudioCpSelection } = await import('/src/lib/creasePatternViewport.ts');
      store.getState().setOristudioCpSelection({ ...emptyOristudioCpSelection(), lines });
    }, middle.lineIds);
    const toolbar = page.getByRole(SELECTION_TOOLBAR.role, { name: SELECTION_TOOLBAR.name });
    await toolbar.waitFor({ state: 'visible', timeout: 30000 });
    await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
    await checkRegionDialog(page, record, `many-${tag}-selection`, `[${tag}] Fold with layer order… (H5)`);

    // A figure folded from it, then its Layer order… (H3).
    const figureId = await page.evaluate(async (lineIds) => {
      const store = window.__treemakerWorkspaceStore;
      const { foldedFigureGesture } = await import('/src/cp-workspace/folded/foldedFigureGesture.ts');
      await foldedFigureGesture.run('verb', 'Fold model', () => store.getState().foldOristudioCpDocument({ startingFaceId: 1, lineIds }));
      const figure = store.getState().oristudioCpFoldedFigures.at(-1);
      if (!figure || figure.status !== 'ready') throw new Error('the fold made no figure');
      store.getState().setOristudioCpActiveFoldedFigure(figure.id);
      return figure.id;
    }, middle.lineIds);
    await page.evaluate(async (id) => {
      const { openFoldedFigureLayerOrder } = await import('/src/cp-workspace/folded/openFoldedFigureLayerOrder.ts');
      const { default: i18n } = await import('/src/i18n/index.ts');
      void openFoldedFigureLayerOrder(id, i18n.t);
    }, figureId);
    await checkRegionDialog(page, record, `many-${tag}-figure`, `[${tag}] Layer order… on a figure (H3)`);

    // A Diagram step linked to it, folded flat: the Step pane's Edit… (H7).
    await page.evaluate(async (sheetId) => {
      const store = window.__treemakerWorkspaceStore;
      const { useLayoutStore } = await import('/src/store/layoutStore.ts');
      const { ensureCpSheetIndex } = await import('/src/cp-workspace/sheets/cpSheetIndex.ts');
      const { sheetRegions } = await import('/src/cp-workspace/sheets/cpSheetRegions.ts');
      const { linkDiagramStep } = await import('/src/diagram/capture/stepCaptureActions.ts');
      useLayoutStore.getState().activateWorkspace('diagram');
      const sheet = sheetRegions(await ensureCpSheetIndex(store.getState().oristudioCpDocument.document))[sheetId];
      const stepId = store.getState().addDiagramStep();
      if (!(await linkDiagramStep(stepId, sheet, 'folded'))) throw new Error('the pattern did not link');
      store.getState().openDiagramStep(stepId);
      window.__layerOrderStep = stepId;
    }, middle.sheet);
    await captured(page);
    await page.evaluate(async () => {
      const { openDiagramStepLayerOrder } = await import('/src/diagram/capture/stepLayerOrderActions.ts');
      void openDiagramStepLayerOrder(window.__layerOrderStep);
    });
    await checkRegionDialog(page, record, `many-${tag}-step`, `[${tag}] a Diagram step (H7)`);

    // Pose on that step: its toolbar's Edit order… (H8).
    await reopenDetail(page);
    await poseToolbar(page).getByRole('button', { name: EDIT_ORDER }).click();
    await checkRegionDialog(page, record, `many-${tag}-pose`, `[${tag}] Pose (H8)`);
  };
}

/**
 * Creases Oriedita's search can't order (`oriedita/failing_global_flat_fold.ori`):
 * a plain Fold draws them see-through, and Fold with layer order… refuses
 * them in D3's words, not as creases with no flat folded form, and as the
 * app's ordinary message, not an "Ori Studio error": no fault. The toasts
 * each leaves, read and shot.
 */
async function unorderedCreasesToast(page, url, record) {
  await openFileInEdit(page, url, 'tests/fixtures/oriedita/failing_global_flat_fold.ori', null);
  await selectWholeSheet(page);
  const toolbar = page.getByRole(SELECTION_TOOLBAR.role, { name: SELECTION_TOOLBAR.name });
  await toolbar.getByRole('button', { name: FOLD_WITH_LAYER_ORDER }).click();
  const toast = page.locator('[data-sonner-toast]').first();
  await toast.waitFor({ state: 'visible', timeout: 120000 });
  const pressed = (await toast.innerText()).replace(/\s+/g, ' ').trim();
  const kind = await toast.getAttribute('data-type');
  const storeError = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().error);
  console.log(`Fold with layer order… on them: “${pressed}”, a ${kind} toast; the store's error: ${JSON.stringify(storeError)}`);
  if ((kind === 'error' || storeError || !/couldn’t be determined/.test(pressed)) && !process.env.LAYER_ORDER_CHECK_LENIENT) {
    throw new Error('the press refuses unordered creases as an error, or in other words than D3’s');
  }
  await record('unordered-press', { page: await page.screenshot({ animations: 'disabled' }) });
  await page.evaluate(() => {
    for (const close of document.querySelectorAll('[data-sonner-toast] [data-close-button]')) close.click();
    window.__treemakerWorkspaceStore.setState({ oristudioCpError: null, error: null });
  });
  await page.waitForTimeout(600);
  // The same creases, plainly folded.
  const plain = await page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    const count = store.getState().oristudioCpDocument.summary.line_segments;
    const lineIds = Array.from({ length: count }, (_, i) => i + 1);
    const { foldedFigureGesture } = await import('/src/cp-workspace/folded/foldedFigureGesture.ts');
    await foldedFigureGesture.run('verb', 'Fold model', () => store.getState().foldOristudioCpDocument({ startingFaceId: 1, lineIds }));
    const figure = store.getState().oristudioCpFoldedFigures.at(-1);
    return { figure: figure?.status ?? null, style: figure?.displayStyle ?? null, outcome: figure?.snapshot?.outcome ?? null, error: store.getState().oristudioCpError };
  });
  await page.waitForTimeout(600);
  const toasts = await page.locator('[data-sonner-toast]').allInnerTexts();
  console.log(`plain Fold on them: ${JSON.stringify(plain)}; toasts: ${JSON.stringify(toasts)}`);
  await record('unordered-plain-fold', { page: await page.screenshot({ animations: 'disabled' }) });
  if (/no flat folded form/.test(pressed) && !process.env.LAYER_ORDER_CHECK_LENIENT) {
    throw new Error('the press says “no flat folded form” of creases a plain Fold draws');
  }
}

// ---------------------------------------------------------------------------
// Fold's Import CP (H10)

const IMPORT_DIALOG = { role: 'dialog', name: 'Import crease pattern' };

/** The shown Fold sequence as the store holds it: its steps, the cursor, the history's labels. */
async function foldSequenceState(page) {
  return page.evaluate(() => {
    const state = window.__treemakerWorkspaceStore.getState();
    const held = state.foldSequences[0];
    const steps = held?.document.steps ?? [];
    return {
      steps: steps.length,
      kinds: steps.map((step) => step.op?.kind ?? null),
      last: steps.at(-1) ? { expect: steps.at(-1).expect ?? null, origin: steps.at(-1).op?.origin ?? null } : null,
      history: state.foldHistory.past.map((entry) => entry.label),
    };
  });
}

/**
 * Import CP of `file` as a user drops it on Import CP's dialog: the dialog
 * opened as the menu opens it, the file dropped on it.
 */
async function importIntoFold(page, file) {
  await page.evaluate(async () => {
    const { useFoldImportUiStore } = await import('/src/fold/io/foldImportUiStore.ts');
    useFoldImportUiStore.getState().open();
  });
  const dialog = page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name });
  await dialog.waitFor({ state: 'visible', timeout: 30000 });
  const text = await readFile(path.join(repoRoot, file), 'utf8');
  const dataTransfer = await page.evaluateHandle(
    ({ text, name }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name));
      return transfer;
    },
    { text, name: path.basename(file) }
  );
  await dialog.dispatchEvent('drop', { dataTransfer });
}

/**
 * The order the open dialog's engine lands on for one sentence added from
 * the order it opened on, worked out by a session of the check's own on the
 * same request (`inspectorFacts`): its relations, `[upper, lower, …]`.
 */
async function relationsAfter(page, { subject, verb, object }) {
  return page.evaluate(
    async ({ subject, verb, object }) => {
      const { constraintSeen, LAYER_ORDER_LIMITS } = await import('/src/layer-order/engine/layerOrderEngine.ts');
      const { runtime, open } = window.__layerOrderCheck.figure;
      const committed = await runtime.engine.commit(
        [constraintSeen(subject, verb, object, 'front', open.opened.front_up[object] === 1)],
        LAYER_ORDER_LIMITS.commit
      );
      if (committed.verdict !== 'committed') throw new Error(`the check's own commit: ${JSON.stringify(committed)}`);
      return Array.from(await runtime.engine.relations());
    },
    { subject, verb, object }
  );
}

/**
 * Which of the import's own orders the step on screen is, by Fold's own
 * chooser: `file` imported again where the step was (an empty sequence),
 * each listed order drawn over the dialog's faces and landed, and the one
 * whose state is the step's (`expect`, its fingerprint) found. Answers its
 * relations over the dialog's faces and how many orders there were.
 */
async function landedOrder(page, file, expect) {
  const text = await readFile(path.join(repoRoot, file), 'utf8');
  return page.evaluate(
    async ({ text, expect }) => {
      const { foldSession } = await import('/src/store/workspaceStore/foldSession.ts');
      const { selectFoldCursorNode } = await import('/src/fold/session/foldSessionState.ts');
      const { layerOrderSceneRelations } = await import('/src/layer-order/engine/layerOrderSceneRelations.ts');
      const session = foldSession();
      const release = session.retain();
      try {
        const node = selectFoldCursorNode(session.store.getState());
        const answer = await session.withState(node.state, async (worker) => {
          const opened = await worker.importCp({ format: 'fold', text }, { kind: 'empty' });
          if (opened.status !== 'ok') throw new Error(`reimport: ${JSON.stringify(opened.refusal)}`);
          let choices = [[]];
          for (const component of opened.components) {
            choices = choices.flatMap((choice) => Array.from({ length: component.orders }, (_, k) => [...choice, k]));
          }
          const found = [];
          for (const choice of choices) {
            const picked = await worker.importPick(opened.import, choice);
            if (picked.status !== 'ok') continue;
            await worker.release([picked.state]);
            if (picked.fingerprint !== expect) continue;
            const opening = await worker.importLayerOpening(opened.import, choice);
            if (opening.status !== 'ok') throw new Error(`opening: ${JSON.stringify(opening.refusal)}`);
            found.push({ choice, relations: Array.from(layerOrderSceneRelations(opening.shown)) });
          }
          await worker.releaseImports([opened.import]);
          return { found, orders: choices.length };
        });
        if (answer.status !== 'answered') throw new Error(`the engine: ${answer.status}`);
        return answer.value;
      } finally {
        release();
      }
    },
    { text, expect }
  );
}

/**
 * Fold's Import CP choosing its order in the Layer order dialog (H10), in one
 * theme: Import CP's open loads none of the dialog's code; kabuto dropped on
 * it opens the dialog on its default order, with no region (the import is
 * its one sheet, so the crease-pattern pane frames the source's creases),
 * the import's own dialog stepped aside; Cancel leaves the sequence as it
 * was; the browser's Back with the dialog open closes it with Import CP, and
 * Forward finds no dialog and no step; a constraint added and Applied lands
 * one step, one undo entry, whose order (found among the import's own by
 * Fold's chooser) is the order the dialog's engine lands on for that
 * constraint, relation for relation; and a pattern with one order imports
 * straight through, no dialog.
 */
function foldImportCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  const kabuto = 'tests/fixtures/flat-folder/kabuto.fold';
  return async (page, url, record) => {
    await openFold(page, url);
    if (theme) {
      await page.evaluate(async (theme) => {
        const { useThemeStore } = await import('/src/store/themeStore.ts');
        useThemeStore.getState().setThemeByName(theme);
      }, theme);
    }
    const before = await foldSequenceState(page);

    // Import CP opened with no file yet loads none of the dialog's code: that waits for an
    // import with several orders.
    const dialogCode = /components\/layer-order\/LayerOrderDialog\.tsx|layerOrderWorker/;
    const loaded = [];
    const onRequest = (request) => {
      if (dialogCode.test(request.url())) loaded.push(request.url());
    };
    page.context().on('request', onRequest);
    await page.evaluate(async () => {
      const { useFoldImportUiStore } = await import('/src/fold/io/foldImportUiStore.ts');
      useFoldImportUiStore.getState().open();
    });
    await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(2000);
    page.context().off('request', onRequest);
    if (loaded.length > 0) throw new Error(`Import CP's open loaded the dialog's code: ${loaded.join(', ')}`);
    await page.keyboard.press('Escape');
    await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).waitFor({ state: 'detached', timeout: 30000 });
    console.log(`[${tag}] Import CP opened with no file: none of the dialog's code loaded`);

    // Kabuto, dropped on Import CP: the Layer order dialog opens on it, alone.
    await importIntoFold(page, kabuto);
    let dialog = await readyDialog(page);
    const asked = await openedRequest(page);
    if (asked?.surface !== 'fold_import' || asked.record !== null || !asked.shown || asked.name !== 'kabuto.fold' || asked.xray) {
      throw new Error(`the request: ${JSON.stringify(asked)}`);
    }
    const framed = await openedRegion(page);
    if (framed?.paper !== null) throw new Error(`an import's request names a region: ${JSON.stringify(framed)}`);
    if (await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).isVisible()) {
      throw new Error('Import CP’s own dialog stayed up under the Layer order dialog');
    }
    console.log(`[${tag}] kabuto opened the Layer order dialog (${asked.segments} creases, ${asked.side}, turned ${asked.turnDeg}°, no region: the import is its one sheet); Import CP stepped aside`);
    await record(`fold-import-${tag}-dialog`, await dialogShot(page));

    // Cancel: the import is cancelled, the sequence as it was.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30000 });
    await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).waitFor({ state: 'detached', timeout: 30000 });
    const cancelled = await foldSequenceState(page);
    if (JSON.stringify(cancelled) !== JSON.stringify(before)) throw new Error(`Cancel changed the sequence: ${JSON.stringify(cancelled)}`);
    console.log(`[${tag}] Cancel: no step, no undo entry, Import CP closed`);

    // The browser's Back while the dialog is open: the dialog goes with Import CP, and nothing
    // lands, there or after Forward. An in-app visit to Edit first gives Back somewhere to go.
    const go = (to) =>
      page.evaluate(async (to) => {
        const { navigateTo } = await import('/src/routing/appRouter.tsx');
        navigateTo(to);
      }, to);
    await go('/edit');
    await page.waitForFunction(() => location.pathname === '/edit', null, { timeout: 30000 });
    await go('/fold');
    await page.locator(FOLDED).waitFor({ state: 'visible', timeout: 120000 });
    await importIntoFold(page, kabuto);
    dialog = await readyDialog(page);
    await page.goBack();
    await dialog.waitFor({ state: 'detached', timeout: 30000 });
    const backed = await page.evaluate(() => location.pathname);
    if (backed !== '/edit') throw new Error(`Back went to ${backed}`);
    if (await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).isVisible()) throw new Error('Import CP outlived Back');
    if (JSON.stringify(await foldSequenceState(page)) !== JSON.stringify(before)) throw new Error('Back left a step');
    await page.goForward();
    await page.locator(FOLDED).waitFor({ state: 'visible', timeout: 120000 });
    await settle(page);
    for (const name of [DIALOG.name, IMPORT_DIALOG.name]) {
      if (await page.getByRole('dialog', { name }).isVisible()) throw new Error(`${name} came back with Forward`);
    }
    const forward = await foldSequenceState(page);
    if (JSON.stringify(forward) !== JSON.stringify(before)) throw new Error(`Forward found a step: ${JSON.stringify(forward)}`);
    console.log(`[${tag}] Back with the dialog open: it closed with Import CP on Edit; Forward: no dialog, no step`);

    // A constraint added through the inspector, then Apply.
    await importIntoFold(page, kabuto);
    dialog = await readyDialog(page);
    await page.evaluate(async () => {
      const { useLayerOrderDialogStore } = await import('/src/layer-order/dialog/layerOrderDialogStore.ts');
      const { kernelFoldSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
      const { request } = useLayerOrderDialogStore.getState().opening;
      window.__layerOrderCheck = { source: kernelFoldSourceOf(request.source), scene: request.shown };
    });
    const facts = await inspectorFacts(page);
    // The first subject's first object, the way round the order it opened on doesn't have it: from
    // the front (whose viewer the relations' upper face is nearer), then as the side shown reads it.
    const subject = facts.subjects[0];
    const object = facts.partners[subject][0];
    const verb = await page.evaluate(
      async ({ subject, object }) => {
        const { layerOrderSceneRelations } = await import('/src/layer-order/engine/layerOrderSceneRelations.ts');
        const relations = layerOrderSceneRelations(window.__layerOrderCheck.scene);
        for (let i = 0; i < relations.length; i += 2) {
          if (relations[i] === subject && relations[i + 1] === object) return 'behind';
          if (relations[i] === object && relations[i + 1] === subject) return 'in_front_of';
        }
        throw new Error('the pair is not ordered in the scene the dialog opened on');
      },
      { subject: facts.faceOf[subject], object: facts.faceOf[object] }
    );
    const seenVerb = asked.side === 'back' ? (verb === 'behind' ? 'in_front_of' : 'behind') : verb;
    await buildSentence(page, dialog, { subject, verb: seenVerb, objects: [object] });
    await addSentence(page, dialog);
    await record(`fold-import-${tag}-constrained`, await dialogShot(page));
    const chosen = await relationsAfter(page, { subject: facts.faceOf[subject], verb, object: facts.faceOf[object] });
    await dropInspectorFacts(page);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await dialog.waitFor({ state: 'detached', timeout: 30000 });
    await page.waitForFunction((steps) => window.__treemakerWorkspaceStore.getState().foldSequences[0]?.document.steps.length === steps + 1, before.steps, { timeout: 60000 });
    await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).waitFor({ state: 'detached', timeout: 30000 });
    const applied = await foldSequenceState(page);
    if (applied.kinds.at(-1) !== 'cp-jump' || applied.last?.origin !== 'fold' || applied.history.length !== before.history.length + 1) {
      throw new Error(`Apply: ${JSON.stringify(applied)}`);
    }
    await page.mouse.move(1, 1);
    await record(`fold-import-${tag}-applied`, await foldPanes(page));
    const landed = await landedOrder(page, kabuto, applied.last.expect);
    if (landed.found.length !== 1) throw new Error(`the step is ${landed.found.length} of the import's ${landed.orders} orders`);
    const [order] = landed.found;
    // As sets of [upper, lower]: the scene's reading and the engine's list them in other orders.
    const pairsOf = (flat) => [...Array(flat.length / 2).keys()].map((i) => `${flat[2 * i]}>${flat[2 * i + 1]}`).sort().join(' ');
    if (pairsOf(order.relations) !== pairsOf(chosen)) {
      throw new Error(`the step's order is not the dialog's: ${JSON.stringify({ step: order.relations, dialog: chosen })}`);
    }
    if (order.choice.every((k) => k === 0)) throw new Error('the constraint left the default order');
    console.log(`[${tag}] "${subject} ${verb} ${object}", Applied: one step, one undo entry ("${applied.history.at(-1)}"); its order is the import's order [${order.choice}] of ${landed.orders}, relation for relation the dialog's (${chosen.length / 2} pairs)`);

    // Undo takes the one step away; redo brings it back.
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    const undone = await foldSequenceState(page);
    if (undone.steps !== before.steps) throw new Error(`undo left ${undone.steps} steps`);
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().redo());
    const redone = await foldSequenceState(page);
    if (redone.steps !== before.steps + 1 || redone.last?.expect !== applied.last.expect) throw new Error(`redo: ${JSON.stringify(redone)}`);
    console.log(`[${tag}] undo: the import gone in one entry; redo: back`);

    // One order: straight through, no Layer order dialog.
    await importIntoFold(page, 'tests/fixtures/fold-samples/preliminary-base.fold');
    await page.waitForFunction((steps) => window.__treemakerWorkspaceStore.getState().foldSequences[0]?.document.steps.length === steps + 2, before.steps, { timeout: 60000 });
    if (await page.getByRole(DIALOG.role, { name: DIALOG.name }).isVisible()) throw new Error('a pattern with one order opened the dialog');
    await page.getByRole(IMPORT_DIALOG.role, { name: IMPORT_DIALOG.name }).waitFor({ state: 'detached', timeout: 30000 });
    await page.mouse.move(1, 1);
    await record(`fold-import-${tag}-one-order`, await foldPanes(page));
    console.log(`[${tag}] a pattern with one order imported straight through, no dialog`);
  };
}

// ---------------------------------------------------------------------------
// Edit's figure: Another solution within constraints (H6)

/**
 * The constraint on kabuto that leaves the most pictures from the front
 * (three at least), chosen with no dialog (as `chosenOrder` does) and left
 * for `applyChosenOrder`: the figure's fold opened on the Fold wasm, each
 * open pair tried both ways and counted to the end, the best committed again
 * and saved.
 */
async function severalSolutionsOrder(page, figureId) {
  return page.evaluate(async (figureId) => {
    const store = window.__treemakerWorkspaceStore;
    const figure = store.getState().oristudioCpFoldedFigures.find((entry) => entry.id === figureId);
    const runtime = await import('/src/store/workspaceStore/oristudioCpRuntime.ts');
    const { layerOrderSourceOf } = await import('/src/lib/layerOrder/layerOrderSource.ts');
    const { createLayerOrderRuntime } = await import('/src/layer-order/engine/layerOrderRuntime.ts');
    const { LAYER_ORDER_LIMITS, constraintSeen } = await import('/src/layer-order/engine/layerOrderEngine.ts');
    const source = layerOrderSourceOf(await runtime.getOristudioCpFoldedFigureSource(figure.handle), figure.snapshot.model);
    const engine = createLayerOrderRuntime({ role: 'dialog' });
    try {
      const opened = await engine.engine.open(source, LAYER_ORDER_LIMITS.open);
      if (opened.status !== 'ok') throw new Error(`refused: ${JSON.stringify(opened.refusal)}`);
      let best = null;
      for (let i = 0; i < opened.open_pairs.length; i += 2) {
        for (const verb of ['in_front_of', 'behind']) {
          const [lo, hi] = [opened.open_pairs[i], opened.open_pairs[i + 1]];
          const constraint = constraintSeen(lo, verb, hi, 'front', opened.front_up[hi] === 1);
          const committed = await engine.engine.commit([constraint], LAYER_ORDER_LIMITS.commit);
          if (committed.verdict !== 'committed') continue;
          const counted = await engine.engine.countSlice(LAYER_ORDER_LIMITS.restore);
          if (counted.count.done && counted.count.front.n >= 3 && counted.count.front.n > (best?.pictures ?? 0)) {
            best = { constraint, pictures: counted.count.front.n };
          }
        }
      }
      if (!best) throw new Error('no one constraint on kabuto leaves three pictures');
      const committed = await engine.engine.commit([best.constraint], LAYER_ORDER_LIMITS.commit);
      if (committed.verdict !== 'committed') throw new Error('the best constraint no longer commits');
      const saved = await engine.engine.save();
      if (saved.status !== 'ok') throw new Error(`save refused: ${JSON.stringify(saved.refusal)}`);
      window.__layerOrderApplied = { record: saved.record, relations: await engine.engine.relations(), source };
      return { pictures: best.pictures };
    } finally {
      engine.dispose();
    }
  }, figureId);
}

/** The Properties pane's Layer order row: its readout, and its ‹ and ›. */
function layerOrderRow(page) {
  const row = page
    .locator('[data-property-sheet] [data-field-row]')
    .filter({ has: page.locator('[data-field-label]', { hasText: /^Layer order$/ }) });
  return {
    row,
    readout: async () => (await row.locator('[aria-live="polite"]').innerText()).trim(),
    note: async () => (await row.locator('[data-field-note]').innerText()).trim(),
    next: row.getByRole('button', { name: 'Another solution' }),
    previous: row.getByRole('button', { name: 'Previous solution' }),
  };
}

/** Whether a pager verb waits: refused, not disabled, so it keeps its focus (`Pager.tsx`). */
async function waits(verb) {
  return (await verb.getAttribute('aria-disabled')) === 'true';
}

/** Press `verb` and let the step it starts land, or answer that it moved nothing: the figure ready, no fold running. */
async function pressStep(page, verb) {
  await verb.click();
  await page.waitForFunction(
    () => {
      const state = window.__treemakerWorkspaceStore.getState();
      return state.oristudioCpFoldedFigures[0]?.status === 'ready' && Object.keys(state.oristudioCpFoldRuns).length === 0;
    },
    null,
    { timeout: 60000 }
  );
  await settle(page);
  return figureState(page);
}

/** How many undo entries Edit holds. */
function undoDepth(page) {
  return page.evaluate(() => window.__treemakerWorkspaceStore.getState().oristudioCpHistoryPast.length);
}

/**
 * H6 on kabuto, in one theme: a constraint that leaves several pictures,
 * applied; selecting the figure and drawing its pane starts no worker; the
 * first › makes the host engine's cursor (one worker), and ‹ › then step
 * through the solutions that fit, one entry each, the readout counting
 * them, each end waiting once reached; an undo shows the order before and
 * lets the cursor (and its worker) go; and a reload keeps the order the
 * figure was left on, with no cursor and no worker until the next press.
 */
function editFigureSolutionCases(theme) {
  const tag = theme ? theme.toLowerCase().replace(/\s+/g, '-') : 'default';
  return async (page, url, record, { dir }) => {
    await openFileInEdit(page, url, 'tests/fixtures/flat-folder/kabuto.fold', theme);
    const id = await foldWholeAndSelect(page);
    await zoomOutToFigure(page);
    const { pictures } = await severalSolutionsOrder(page, id);
    if (!(await applyChosenOrder(page, id))) throw new Error('Apply wrote nothing');
    const applied = await figureState(page);
    console.log(`[${tag}] applied one constraint that leaves ${pictures} pictures from the front`);

    // Selected again and its pane drawn, from saved data: ‹ › live, no readout, the note; no worker.
    const watch = watchLayerOrderLoads(page);
    const closed = [];
    page.on('worker', (worker) => worker.on('close', () => closed.push(worker.url())));
    await page.evaluate(() => {
      const store = window.__treemakerWorkspaceStore;
      store.getState().setOristudioCpActiveFoldedFigure(null);
      store.getState().setOristudioCpActiveFoldedFigure(store.getState().oristudioCpFoldedFigures[0].id);
    });
    const row = layerOrderRow(page);
    await row.row.waitFor({ state: 'visible', timeout: 30000 });
    const atRest = await figureShots(page);
    await page.waitForTimeout(1000);
    if (watch.workers().length > 0) throw new Error(`selecting it spawned ${watch.workers().join(', ')}`);
    if ((await row.readout()) !== '' || (await waits(row.next)) || (await waits(row.previous))) {
      throw new Error(`at rest the row reads "${await row.readout()}", or a verb waits`);
    }
    if ((await row.note()) !== '1 constraint') throw new Error(`the note reads "${await row.note()}"`);
    await record(`edit-${tag}-solutions-at-rest`, atRest);
    console.log(`[${tag}] selected, its pane drawn: no worker; ‹ › live, no readout, note "1 constraint"`);

    // Back to the first: the first press makes the cursor, one worker.
    const readouts = [];
    const depth = await undoDepth(page);
    let last = applied;
    for (let guard = 0; guard < 12 && !(await waits(row.previous)); guard += 1) {
      last = await pressStep(page, row.previous);
      readouts.push(await row.readout());
    }
    if (watch.workers().length !== 1) throw new Error(`the presses spawned ${watch.workers().length} workers, not one`);
    if (!(await waits(row.previous))) throw new Error('‹ never reached the first solution');
    if (!/^1 of \d+\+?$/.test(await row.readout())) throw new Error(`at the first it reads "${await row.readout()}"`);
    console.log(`[${tag}] ‹ to the first: ${readouts.join(' → ')}, on one worker; ‹ waits`);
    await record(`edit-${tag}-solutions-first`, await figureShots(page, { hover: true, hoverName: 'Another solution' }));

    // On through the solutions that fit: each press a new fold and an entry; the readout counts on.
    const firstPicture = (await figureState(page)).picture;
    const onward = [];
    for (let guard = 0; guard < 12 && !(await waits(row.next)); guard += 1) {
      const before = await figureState(page);
      const after = await pressStep(page, row.next);
      if (after.handle === before.handle || after.layerOrder?.json === before.layerOrder?.json) {
        throw new Error(`› wrote no new fold and record: ${JSON.stringify({ before: before.handle, after: after.handle })}`);
      }
      onward.push(await row.readout());
    }
    const expected = Array.from({ length: pictures - 1 }, (_, i) => `${i + 2} of ${pictures}`);
    if (onward.join() !== expected.join()) throw new Error(`› read ${onward.join(', ')}, not ${expected.join(', ')}`);
    if (!(await waits(row.next))) throw new Error('› never waited at the last solution');
    const lastShots = await figureShots(page);
    const moved = await pixelDiff(page, atRest.canvas, lastShots.canvas);
    console.log(`[${tag}] › to the last: ${onward.join(' → ')}; › waits; ${moved.differing} canvas pixels from where it started`);
    await record(`edit-${tag}-solutions-last`, lastShots);
    const entries = (await undoDepth(page)) - depth;
    if (entries !== readouts.length + onward.length) throw new Error(`${entries} undo entries for ${readouts.length + onward.length} steps`);

    // The toolbar's Another solution waits there too, saying why.
    const toolbar = page.getByRole(FIGURE_TOOLBAR.role, { name: FIGURE_TOOLBAR.name });
    if ((await toolbar.getByRole('button', { name: 'Another solution' }).isDisabled()) !== true) {
      throw new Error('the toolbar’s Another solution does not wait at the last solution');
    }
    await record(`edit-${tag}-solutions-last-toolbar`, await figureShots(page, { hover: true, hoverName: 'Another solution' }));

    // ‹ back one.
    await pressStep(page, row.previous);
    const backOne = await row.readout();
    if (backOne !== `${pictures - 1} of ${pictures}`) throw new Error(`‹ read "${backOne}"`);
    const leftOn = await figureState(page);
    console.log(`[${tag}] ‹ back one: ${backOne}`);

    // Undo: the order before, from its own fold; the cursor goes with its worker; nothing reads out.
    const beforeUndo = closed.length;
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().undo());
    await settle(page);
    const undone = await figureState(page);
    if (undone.layerOrder?.json === leftOn.layerOrder?.json || undone.handle === leftOn.handle) {
      throw new Error('undo did not put the order before back');
    }
    if ((await row.readout()) !== '') throw new Error(`after undo it reads "${await row.readout()}"`);
    for (let waited = 0; closed.length === beforeUndo && waited < 5000; waited += 100) await page.waitForTimeout(100);
    if (closed.length === beforeUndo) throw new Error('the cursor’s worker outlived the undo');
    if ((await restyled(page, undone.id)) !== undone.picture) throw new Error('a restyle after undo drew another order');
    console.log(`[${tag}] undo: the order before, from its own fold; the cursor's worker closed; no readout`);
    await record(`edit-${tag}-solutions-undone`, await figureShots(page));
    await page.evaluate(() => window.__treemakerWorkspaceStore.getState().redo());
    await settle(page);
    if ((await figureState(page)).layerOrder?.json !== leftOn.layerOrder?.json) throw new Error('redo did not bring the step back');
    watch.stop();

    // Saved and opened again: the order it was left on, no cursor, no worker until a press.
    const osf = await savedProject(page);
    if (!tag.includes('horizon')) await writeFile(path.join(dir, 'kabuto-solutions.osf'), osf);
    const reopenWatch = watchLayerOrderLoads(page);
    await page.goto(new URL('/edit', url).href, { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().engineReady === true, null, { timeout: 120000 });
    await openTextInEdit(page, osf, 'kabuto-solutions.osf', theme);
    await page.evaluate(() => {
      const store = window.__treemakerWorkspaceStore;
      store.getState().setOristudioCpActiveFoldedFigure(store.getState().oristudioCpFoldedFigures[0].id);
    });
    await zoomOutToFigure(page);
    const reopenedShots = await figureShots(page);
    await page.waitForTimeout(1000);
    const reopened = await figureState(page);
    if (reopened.handle !== null || reopened.layerOrder?.json !== leftOn.layerOrder?.json || reopened.picture !== leftOn.picture) {
      throw new Error(`the file did not keep the order it was left on: ${JSON.stringify(reopened)}`);
    }
    if (reopenWatch.workers().length > 0) throw new Error(`opening and selecting spawned ${reopenWatch.workers().join(', ')}`);
    const reopenedRow = layerOrderRow(page);
    if ((await reopenedRow.readout()) !== '') throw new Error(`reopened, it reads "${await reopenedRow.readout()}"`);
    await record(`edit-${tag}-solutions-reopened`, reopenedShots);
    // A press folds it from its creases as it steps, on a fresh cursor.
    await pressStep(page, reopenedRow.next);
    const afterReload = await reopenedRow.readout();
    if (afterReload !== `${pictures} of ${pictures}` || reopenWatch.workers().length !== 1) {
      throw new Error(`after the reload › read "${afterReload}" on ${reopenWatch.workers().length} workers`);
    }
    if ((await figureState(page)).handle === null) throw new Error('the press did not fold the reopened figure');
    reopenWatch.stop();
    console.log(`[${tag}] reloaded: left on ${pictures - 1} of ${pictures}, no readout, no worker; › folds it and reads ${afterReload}`);
    await record(`edit-${tag}-solutions-reopened-stepped`, await figureShots(page));
    if (firstPicture === leftOn.picture) throw new Error('the first and the last solutions draw alike');
  };
}

// ---------------------------------------------------------------------------
// The cases, in order. Later PRs add the dialog's.

const CASES = [
  { name: 'fold', run: foldCases },
  { name: 'fold-stack', run: foldStackCases },
  { name: 'dialog-shell', run: dialogShellCases(null) },
  { name: 'dialog-shell-horizon', run: dialogShellCases('Horizon') },
  { name: 'dialog-phone-locales', run: dialogPhoneLocales },
  { name: 'fold-import-frame', run: foldImportFrame },
  { name: 'diagram-step', run: diagramStepCases(null) },
  { name: 'diagram-step-horizon', run: diagramStepCases('Horizon') },
  { name: 'diagram-step-offline', run: diagramStepOfflineCases(null) },
  { name: 'diagram-step-offline-horizon', run: diagramStepOfflineCases('Horizon') },
  { name: 'panes', run: paneCases(null) },
  { name: 'panes-horizon', run: paneCases('Horizon') },
  { name: 'panes-phone', run: panePhoneCases },
  { name: 'panes-refusal', run: paneRefusalCases },
  { name: 'panes-creases', run: creaseCases(null) },
  { name: 'panes-creases-horizon', run: creaseCases('Horizon') },
  { name: 'host-looks', run: hostLookCases },
  { name: 'inspector', run: inspectorCases(null) },
  { name: 'inspector-horizon', run: inspectorCases('Horizon') },
  { name: 'inspector-timeout', run: inspectorTimeoutCase },
  { name: 'inspector-notice', run: inspectorNoticeCase },
  { name: 'inspector-hover-cost', run: inspectorHoverCost },
  { name: 'inspector-coarse-chromium', run: inspectorCoarseCases('chromium') },
  { name: 'inspector-coarse-webkit', run: inspectorCoarseCases('webkit') },
  { name: 'edit-figure', run: editFigureCases(null) },
  { name: 'edit-figure-horizon', run: editFigureCases('Horizon') },
  { name: 'edit-figure-review', run: editFigureReviewCases },
  { name: 'edit-figure-states', run: editFigureStateCases(null) },
  { name: 'edit-figure-states-horizon', run: editFigureStateCases('Horizon') },
  { name: 'edit-refold', run: editRefoldCases(null) },
  { name: 'edit-refold-horizon', run: editRefoldCases('Horizon') },
  { name: 'edit-selection', run: editSelectionCases(null) },
  { name: 'edit-selection-horizon', run: editSelectionCases('Horizon') },
  { name: 'edit-figure-solutions', run: editFigureSolutionCases(null) },
  { name: 'edit-figure-solutions-horizon', run: editFigureSolutionCases('Horizon') },
  { name: 'pose-toolbar', run: poseToolbarCases(null) },
  { name: 'pose-toolbar-horizon', run: poseToolbarCases('Horizon') },
  { name: 'diagram-solutions', run: diagramSolutionCases(null) },
  { name: 'diagram-solutions-horizon', run: diagramSolutionCases('Horizon') },
  { name: 'many-patterns', run: manyPatternCases(null) },
  { name: 'many-patterns-horizon', run: manyPatternCases('Horizon') },
  { name: 'unordered-toast', run: unorderedCreasesToast },
  { name: 'fold-import', run: foldImportCases(null) },
  { name: 'fold-import-horizon', run: foldImportCases('Horizon') },
];

// ---------------------------------------------------------------------------
// Commands

async function capture({ label, url, only }) {
  const dir = path.join(outputRoot, label);
  await mkdir(dir, { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const { name, run } of CASES) {
      if (only && !only.includes(name)) continue;
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
      page.on('pageerror', (error) => console.warn(`[${name}] page error: ${error.message}`));
      await run(
        page,
        url,
        async (shot, panes) => {
          for (const [pane, png] of Object.entries(panes)) {
            if (!(await darkBox(page, png))) throw new Error(`${shot}: the ${pane} pane drew nothing`);
            const file = path.join(dir, `${shot}-${pane}.png`);
            await writeFile(file, png);
            console.log(`wrote ${path.relative(repoRoot, file)}`);
          }
        },
        { dir }
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

async function compare(a, b) {
  const left = path.join(outputRoot, a);
  const right = path.join(outputRoot, b);
  const diffDir = path.join(outputRoot, `${b}-vs-${a}`);
  const names = (await readdir(left)).filter((name) => name.endsWith('.png')).sort();
  const browser = await chromium.launch();
  let failed = false;
  try {
    const page = await browser.newPage();
    console.log(['image', 'pixels', 'differing', 'max channel step'].join('\t'));
    for (const name of names) {
      let other;
      try {
        other = await readFile(path.join(right, name));
      } catch {
        console.log(`${name}\tmissing in ${b}`);
        failed = true;
        continue;
      }
      const result = await pixelDiff(page, await readFile(path.join(left, name)), other);
      if (!result.sameSize) {
        console.log(`${name}\tsizes differ: ${JSON.stringify(result.sizes)}`);
        failed = true;
        continue;
      }
      console.log([name, result.pixels, result.differing, result.maxDelta].join('\t'));
      if (result.diff) {
        failed = true;
        await mkdir(diffDir, { recursive: true });
        await writeFile(path.join(diffDir, name), Buffer.from(result.diff, 'base64'));
      }
    }
  } finally {
    await browser.close();
  }
  if (failed) {
    console.log(`Differences found; diff images in ${path.relative(repoRoot, diffDir)}`);
    process.exitCode = 1;
  } else {
    console.log(`${names.length} images identical`);
  }
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    label: { type: 'string', default: 'latest' },
    url: { type: 'string', default: `http://localhost:${process.env.DEV_SERVER_PORT ?? '5224'}` },
    only: { type: 'string', multiple: true },
  },
});
const [command, ...rest] = positionals;
if (command === 'capture') {
  await capture({ label: values.label, url: values.url, only: values.only ?? null });
} else if (command === 'compare' && rest.length === 2) {
  await compare(rest[0], rest[1]);
} else {
  console.error('usage: layer-order-dialog-check.mjs capture [--label L] [--url U] [--only CASE…] | compare A B');
  process.exitCode = 2;
}
