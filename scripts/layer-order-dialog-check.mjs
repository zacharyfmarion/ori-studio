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
async function steadyShot(page, locator, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const floating = [page.locator('section[data-pin]'), page.locator('[data-viewport-toolbar]')];
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
// The cases, in order. Later PRs add the dialog's.

const CASES = [
  { name: 'fold', run: foldCases },
  { name: 'fold-stack', run: foldStackCases },
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
      await run(page, url, async (shot, panes) => {
        for (const [pane, png] of Object.entries(panes)) {
          if (!(await darkBox(page, png))) throw new Error(`${shot}: the ${pane} pane drew nothing`);
          const file = path.join(dir, `${shot}-${pane}.png`);
          await writeFile(file, png);
          console.log(`wrote ${path.relative(repoRoot, file)}`);
        }
      });
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
