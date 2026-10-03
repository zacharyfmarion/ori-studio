/**
 * Run the Diagram's SVG sanitizer (apps/web/src/diagram/upload/svgSanitize.ts)
 * in real Chromium and WebKit, over the fixture corpus, and hold it to the
 * three things vitest cannot see from jsdom:
 *
 * 1. **Nothing it lets through does anything.** Every hostile fixture is either
 *    refused or, sanitized, loaded live — as an `<img>`, which is how the app
 *    shows it, and inlined into the page, which it never does but a copy the
 *    user exports and opens elsewhere might be — without a request leaving the
 *    page, a dialog, or an error. The fixtures report to `http://canary.test/`,
 *    so a payload that fires is a request this script sees.
 * 2. **A load changes no bytes, whichever engine saved the file.** Uploads are
 *    sanitized again every time a project opens (D7), and the desktop app is
 *    WebKit while the web app is mostly Chromium. So each engine's stored
 *    output — rasters re-encoded, as an upload finishes — must come back
 *    byte-identical when either engine sanitizes it again.
 * 3. **The engines and jsdom agree.** Every unit test of the sanitizer runs in
 *    jsdom; this is what makes those tests evidence about the browsers. Before
 *    rasters are re-encoded (canvas PNG bytes differ by engine), the three
 *    outputs are byte-identical, and the three refuse the same files.
 *
 * The corpus is the committed fixtures: the hostile set, the synthetic
 * imitations of other tools' output, and our own folded-figure exports. Extra
 * directories of SVGs can be named on the command line — the real Inkscape and
 * third-party files from Phase 0 live in `artifacts/diagram-phase0/sanitize/
 * corpus/`, untracked, and are worth a local run after any sanitizer change:
 *
 *   node scripts/diagram-svg-sanitize-check.mjs
 *   node scripts/diagram-svg-sanitize-check.mjs artifacts/diagram-phase0/sanitize/corpus/real-inkscape
 *
 * Needs the Playwright browsers (`npx playwright install chromium webkit`).
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { chromium, webkit } from 'playwright';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(repoRoot, 'apps/web/src/diagram/upload/fixtures');
const corpusDirs = [
  path.join(fixtures, 'hostile'),
  path.join(fixtures, 'synthetic'),
  path.join(fixtures, 'own-output'),
  ...process.argv.slice(2).map((dir) => path.resolve(dir)),
];

/** The prefix an upload's ids get: its asset id. */
const ID_PREFIX = 'asset-check';
/** How long a live load gets to fire something before it counts as quiet. */
const SETTLE_MS = 250;
/**
 * Raw hostile files that fire in both engines when shown the same way: the
 * control that makes the silence above mean something. If one of these stops
 * firing raw, the harness has stopped seeing payloads, not the sanitizer
 * started stopping them.
 */
const LIVE_CONTROLS = ['hostile/h01-script.svg', 'hostile/h03-handlers.svg'];

async function loadCorpus() {
  const files = [];
  for (const dir of corpusDirs) {
    for (const name of (await readdir(dir)).sort()) {
      if (!name.endsWith('.svg')) continue;
      files.push({
        name: `${path.basename(dir)}/${name}`,
        hostile: path.basename(dir) === 'hostile',
        text: await readFile(path.join(dir, name), 'utf8'),
      });
    }
  }
  return files;
}

/** The sanitizer as one script that defines `OriSanitize`, for a page and for jsdom. */
async function bundleSanitizer() {
  const result = await build({
    entryPoints: [path.join(repoRoot, 'apps/web/src/diagram/upload/svgSanitize.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'OriSanitize',
    platform: 'browser',
    target: 'es2020',
    // A `var` at the top of an eval does not always become a global (jsdom's
    // window.eval), so the bundle says where it goes.
    footer: { js: 'globalThis.OriSanitize = OriSanitize;' },
    write: false,
    logLevel: 'silent',
  });
  return result.outputFiles[0].text;
}

/**
 * What runs inside each engine: sanitize every file, finish its rasters as an
 * upload does (decode, cap at 2048 px, re-encode), and re-sanitize the result.
 */
const PAGE_RUN = async ({ files, prefix }) => {
  const { sanitizeSvg, finishRasters, browserSanitizeEnv, EMBEDDED_RASTER_MAX_SIDE } = window.OriSanitize;
  const env = browserSanitizeEnv();
  const reencode = (raster) =>
    new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, EMBEDDED_RASTER_MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/png'));
      };
      image.onerror = () => resolve(null);
      image.src = raster.dataUrl;
    });
  const out = [];
  for (const file of files) {
    const first = sanitizeSvg(file.text, { idPrefix: prefix, mode: 'import', env });
    if (!first.ok) {
      out.push({ name: file.name, ok: false, error: first.error });
      continue;
    }
    const raw = first.svg;
    const finished = await finishRasters(first, env, reencode);
    const again = sanitizeSvg(finished.svg, { idPrefix: prefix, mode: 'load', env });
    out.push({
      name: file.name,
      ok: true,
      raw,
      stored: finished.svg,
      reloaded: again.ok ? again.svg : null,
    });
  }
  return out;
};

/** Re-sanitize another engine's stored outputs here, as a load would. */
const PAGE_RELOAD = ({ outputs, prefix }) => {
  const { sanitizeSvg, browserSanitizeEnv } = window.OriSanitize;
  const env = browserSanitizeEnv();
  return outputs.map(({ name, svg }) => {
    const result = sanitizeSvg(svg, { idPrefix: prefix, mode: 'load', env });
    return { name, svg: result.ok ? result.svg : null };
  });
};

/** Show one output live, both ways, and give it time to fire. */
const PAGE_SHOW = async ({ svg, settleMs }) => {
  const errors = [];
  window.addEventListener('error', (event) => errors.push(String(event.message)));
  const bytes = new TextEncoder().encode(svg);
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  await new Promise((resolve) => {
    const image = new Image();
    image.onload = image.onerror = resolve;
    image.src = `data:image/svg+xml;base64,${btoa(binary)}`;
    document.body.append(image);
  });
  const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  document.body.append(document.importNode(parsed.documentElement, true));
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  return errors;
};

async function runEngine(engineName, browserType, sanitizer, files) {
  const browser = await browserType.launch();
  try {
    const page = await browser.newPage();
    // Every request is recorded and refused: nothing a sanitized file says may
    // reach the network, and nothing here needs it.
    const requests = [];
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url === 'about:blank') return route.continue();
      requests.push(url);
      return route.abort();
    });
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
    await page.goto('about:blank');
    await page.addScriptTag({ content: sanitizer });
    const results = await page.evaluate(PAGE_RUN, {
      files: files.map(({ name, text }) => ({ name, text })),
      prefix: ID_PREFIX,
    });

    const fired = [];
    for (const result of results) {
      if (!result.ok) continue;
      const before = { requests: requests.length, dialogs: dialogs.length };
      const errors = await page.evaluate(PAGE_SHOW, { svg: result.stored, settleMs: SETTLE_MS });
      const newRequests = requests.slice(before.requests);
      const newDialogs = dialogs.slice(before.dialogs);
      if (newRequests.length || newDialogs.length || errors.length) {
        fired.push({ name: result.name, requests: newRequests, dialogs: newDialogs, errors });
      }
      // A fresh document per file, so one output's leftovers cannot hide another's.
      await page.evaluate(() => {
        document.body.replaceChildren();
      });
    }
    // The control: the same showing, of files that must fire raw.
    const silentControls = [];
    for (const name of LIVE_CONTROLS) {
      const file = files.find((candidate) => candidate.name === name);
      const before = { requests: requests.length, dialogs: dialogs.length };
      const errors = file ? await page.evaluate(PAGE_SHOW, { svg: file.text, settleMs: SETTLE_MS }) : [];
      const quiet = requests.length === before.requests && dialogs.length === before.dialogs && !errors.length;
      if (!file || quiet) silentControls.push(name);
      await page.evaluate(() => {
        document.body.replaceChildren();
      });
    }
    return { engineName, page, browser, results, fired, silentControls };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function runJsdom(sanitizer, files) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(sanitizer);
  const { sanitizeSvg, browserSanitizeEnv } = dom.window.OriSanitize;
  const env = browserSanitizeEnv();
  return files.map((file) => {
    const result = sanitizeSvg(file.text, { idPrefix: ID_PREFIX, mode: 'import', env });
    return result.ok ? { name: file.name, ok: true, raw: result.svg } : { name: file.name, ok: false };
  });
}

const problems = [];
const problem = (message) => problems.push(message);

const files = await loadCorpus();
const sanitizer = await bundleSanitizer();
const jsdom = runJsdom(sanitizer, files);
const engines = [];
try {
  for (const [name, type] of [
    ['chromium', chromium],
    ['webkit', webkit],
  ]) {
    engines.push(await runEngine(name, type, sanitizer, files));
  }

  for (const engine of engines) {
    for (const name of engine.silentControls) {
      problem(`${engine.engineName}: the raw control ${name} did not fire, so this check sees nothing`);
    }
    for (const hit of engine.fired) {
      problem(`${engine.engineName}: ${hit.name} fired: ${JSON.stringify(hit)}`);
    }
    for (const result of engine.results) {
      if (result.ok && result.reloaded !== result.stored) {
        problem(`${engine.engineName}: ${result.name} changes when loaded again`);
      }
    }
  }

  // The engines and jsdom: the same files refused, the same bytes otherwise.
  for (const [index, file] of files.entries()) {
    const reference = jsdom[index];
    for (const engine of engines) {
      const result = engine.results[index];
      if (result.ok !== reference.ok) {
        problem(`${file.name}: ${engine.engineName} ${result.ok ? 'accepts' : 'refuses'} it, jsdom does not`);
      } else if (result.ok && result.raw !== reference.raw) {
        problem(`${file.name}: ${engine.engineName}'s output differs from jsdom's`);
      }
    }
  }

  // Each engine's stored output, loaded by the other.
  for (const from of engines) {
    for (const into of engines) {
      if (from === into) continue;
      const outputs = from.results.filter((result) => result.ok).map(({ name, stored }) => ({ name, svg: stored }));
      const reloaded = await into.page.evaluate(PAGE_RELOAD, { outputs, prefix: ID_PREFIX });
      for (const [index, entry] of reloaded.entries()) {
        if (entry.svg !== outputs[index].svg) {
          problem(`${entry.name}: saved in ${from.engineName}, changes when ${into.engineName} loads it`);
        }
      }
    }
  }
} finally {
  await Promise.all(engines.map((engine) => engine.browser.close()));
}

const accepted = jsdom.filter((result) => result.ok).length;
const hostile = files.filter((file) => file.hostile).length;
console.log(
  `diagram-svg-sanitize-check: ${files.length} files (${hostile} hostile), ${accepted} accepted, ` +
    `in ${engines.map((engine) => engine.engineName).join(' and ')} and jsdom`
);
if (problems.length > 0) {
  for (const message of problems) console.error(`  ✗ ${message}`);
  process.exit(1);
}
console.log(
  `  ✓ nothing fired (the ${LIVE_CONTROLS.length} raw controls did), every load is byte-stable ` +
    'across engines, and the engines agree with jsdom'
);
