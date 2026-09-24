#!/usr/bin/env node
/**
 * Hold the landing page's static first paint to the page React renders: zero differing pixels.
 *
 * A first visit to `/` paints the prerendered copy of the welcome page before the app has
 * loaded, and the app then swaps it for its own render in one frame
 * (`apps/web/src/seo/staticPaint.ts`, `staticCopy.ts`). That only works if the two look
 * exactly alike. The copy this replaced did not — no start screen, another palette — and it
 * flashed and then snapped into the real page. So this lane is the gate, not a smoke test:
 *
 * - The first paint, taken with the app's entry chunk blocked so only the HTML, the CSS and
 *   the two inline scripts run, against the live page once React has taken over. Compared
 *   at the top and scrolled into the landing, in Chromium and WebKit, on a desktop and a
 *   phone, in both default themes. The start figure is masked: its canvas and credit stay
 *   empty until its GL module loads at idle, which only the live page ever does.
 * - Every frame on the way there, which a screenshot of the settled page cannot see. The
 *   parser paints what it has so far, and it once painted the desktop copy on a phone
 *   before the script after it could swap in the phone one. So: no frame shows the copy
 *   before it is finished, or the wrong variant of it, and from the first frame with the
 *   copy to the live page there is always exactly one of them — no blank frame, no double.
 * - The visitors the copy cannot be guaranteed to match, each of whom must never see it:
 *   another language, the desktop app, "Show welcome on startup" off, a non-default theme,
 *   and the editor's URL (which Pages answers with this same file).
 *
 *   node scripts/static-paint-check.mjs        # needs apps/web/dist built *and* prerendered
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { servePagesLike } from './lib/serve-dist.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(repoRoot, 'apps/web/dist');

/**
 * The document arrives in pieces, so the browser renders frames of a half-parsed page —
 * which a local server otherwise never shows it, and which is where a copy shown before it
 * is finished would be seen.
 */
const TRICKLE = { chunkBytes: 8 * 1024, delayMs: 40 };

/** The app's entry chunk. Blocking it leaves exactly what paints before the app arrives. */
const ENTRY = /\/assets\/index-[^/]+\.js$/;

const PROFILES = {
  desktop: { viewport: { width: 1350, height: 940 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
};

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const TOOK_OVER = () => !document.getElementById('seo-content') && !!document.querySelector('#root .welcome-page');

/**
 * Installed before the page's own scripts: records what every rendered frame shows. An
 * animation-frame callback runs just before its frame renders, so each sample is that frame.
 */
function frameProbe() {
  const frames = [];
  Object.defineProperty(window, '__paintFrames', { value: frames });
  let live = 0;
  const sample = () => {
    const copy = document.getElementById('seo-content');
    const shown = !!copy && getComputedStyle(copy).display !== 'none';
    const frame = {
      copy: shown,
      finished: document.documentElement.getAttribute('data-static-paint') === 'shown',
      surface: shown ? (copy.querySelector('.app-layout')?.getAttribute('data-surface') ?? 'desktop') : null,
      live: !!document.querySelector('#root .welcome-page'),
    };
    frames.push(frame);
    if (frame.live) live += 1;
    if (frames.length < 1500 && live < 30) requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

const readFrames = (page) => page.evaluate(() => window.__paintFrames.slice());

/**
 * Let a render finish before it is photographed: fonts, the images in view loaded and
 * decoded, and two frames for React to act on the scroll. Network idle alone is not enough —
 * a scroll that needs no new image settles at once, before the page has answered it.
 */
async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(async () => {
    await document.fonts.ready;
    const inView = [...document.images].filter((image) => {
      const box = image.getBoundingClientRect();
      return box.width > 0 && box.bottom > 0 && box.top < innerHeight;
    });
    const loaded = (image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          });
    const ready = Promise.all(inView.map((image) => loaded(image).then(() => image.decode().catch(() => {}))));
    await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 10_000))]);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function shoot(page) {
  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    mask: [page.locator('.start-figure')],
  });
}

/** Scroll the welcome page's scroller the same distance in both renders, without easing. */
async function scrollLanding(page, viewports) {
  await page.evaluate((by) => {
    const scroller = document.querySelector('.welcome-page');
    scroller?.scrollTo({ top: Math.round(scroller.clientHeight * by), behavior: 'instant' });
  }, viewports);
}

/** The first paint and the live page, at the top and scrolled, for one combination. */
async function pair(browser, profile, colorScheme, url) {
  const first = await browser.newContext({ ...profile, colorScheme });
  await first.route(ENTRY, (route) => route.abort());
  await first.addInitScript(frameProbe);
  const firstPage = await first.newPage();
  await firstPage.goto(url, { waitUntil: 'load' });
  await settle(firstPage);
  const kept = await firstPage.evaluate(() => {
    const copy = document.getElementById('seo-content');
    return !!copy && getComputedStyle(copy).display !== 'none';
  });
  const firstFrames = await readFrames(firstPage);
  const firstTop = await shoot(firstPage);
  await scrollLanding(firstPage, 1.6);
  await settle(firstPage);
  const firstScrolled = await shoot(firstPage);
  await first.close();

  const live = await browser.newContext({ ...profile, colorScheme });
  await live.addInitScript(frameProbe);
  const livePage = await live.newPage();
  await livePage.goto(url, { waitUntil: 'load' });
  await livePage.waitForFunction(TOOK_OVER, null, { timeout: 30_000 });
  await settle(livePage);
  const liveFrames = await readFrames(livePage);
  const liveTop = await shoot(livePage);
  await scrollLanding(livePage, 1.6);
  await settle(livePage);
  const liveScrolled = await shoot(livePage);
  await live.close();

  return {
    kept,
    frames: { first: firstFrames, live: liveFrames },
    top: [firstTop, liveTop],
    scrolled: [firstScrolled, liveScrolled],
  };
}

/** What the frame samples say about one combination, as named checks. */
function frameChecks(name, device, frames) {
  const all = [...frames.first, ...frames.live];
  const withCopy = all.filter((frame) => frame.copy);
  const unfinished = withCopy.filter((frame) => !frame.finished).length;
  check(`${name}: no frame shows the copy unfinished`, unfinished === 0, unfinished ? `${unfinished} frame(s)` : '');
  const expected = device === 'phone' ? 'phone' : 'desktop';
  const wrong = withCopy.filter((frame) => frame.surface !== expected).length;
  check(`${name}: every frame with the copy shows the ${expected} copy`, wrong === 0, wrong ? `${wrong} frame(s)` : '');
  const start = frames.live.findIndex((frame) => frame.copy || frame.live);
  const handover = start === -1 ? [] : frames.live.slice(start);
  const gaps = handover.filter((frame) => frame.copy === frame.live).length;
  check(
    `${name}: the copy is the first frame with content, and hands over to the live page with no blank or doubled frame`,
    start !== -1 && frames.live[start].copy && handover.some((frame) => frame.live) && gaps === 0,
    start === -1 ? 'no frame with content was sampled' : gaps ? `${gaps} frame(s)` : ''
  );
}

/** Differing pixels between two PNGs, counted in a browser so this needs no image library. */
async function differingPixels(page, a, b) {
  if (a.equals(b)) return 0;
  return page.evaluate(
    async ([first, second]) => {
      const load = (src) =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = src;
        });
      const [x, y] = await Promise.all([load(first), load(second)]);
      if (x.width !== y.width || x.height !== y.height) return Number.POSITIVE_INFINITY;
      const read = (image) => {
        const canvas = new OffscreenCanvas(image.width, image.height);
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [p, q] = [read(x), read(y)];
      let count = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i] !== q[i] || p[i + 1] !== q[i + 1] || p[i + 2] !== q[i + 2]) count += 1;
      }
      return count;
    },
    [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`]
  );
}

/** Loads `url` with the app blocked and reports whether the copy survived the inline scripts. */
async function copySurvives(browser, url, setup = {}) {
  const context = await browser.newContext({ ...PROFILES.desktop, colorScheme: 'dark', ...setup.context });
  await context.route(ENTRY, (route) => route.abort());
  if (setup.init) await context.addInitScript(setup.init);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load' });
  const survives = await page.evaluate(() => !!document.getElementById('seo-content'));
  await context.close();
  return survives;
}

async function main() {
  const server = await servePagesLike(distDir, { trickleHtml: TRICKLE });
  const failures = mkdtempSync(path.join(tmpdir(), 'ori-static-paint-'));
  const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
  const comparer = await (await browsers.chromium.newContext()).newPage();
  try {
    for (const [engine, browser] of Object.entries(browsers)) {
      for (const [device, profile] of Object.entries(PROFILES)) {
        for (const scheme of ['dark', 'light']) {
          const name = `${engine} ${device} ${scheme}`;
          const shots = await pair(browser, profile, scheme, server.url);
          check(`${name}: the copy is the first paint`, shots.kept);
          frameChecks(name, device, shots.frames);
          for (const [where, [first, live]] of Object.entries({ top: shots.top, scrolled: shots.scrolled })) {
            const diff = await differingPixels(comparer, first, live);
            if (diff !== 0) {
              const stem = path.join(failures, `${name.replaceAll(' ', '-')}-${where}`);
              writeFileSync(`${stem}-first.png`, first);
              writeFileSync(`${stem}-live.png`, live);
            }
            check(`${name}: identical to the live page ${where === 'top' ? 'at the top' : 'scrolled'}`, diff === 0, diff ? `${diff} px differ` : '');
          }
        }
      }
    }

    const { chromium: browser } = browsers;
    check('/welcome paints its copy too', await copySurvives(browser, `${server.url}welcome`));
    const removed = {
      'a reader whose language is not English': { context: { locale: 'ja-JP' } },
      'the desktop app': { init: () => { window.__TAURI_INTERNALS__ = {}; } },
      '"Show welcome on startup" turned off': {
        init: () => localStorage.setItem('oristudio:show-welcome-on-startup', 'false'),
      },
      'a saved theme the copy was not painted in': { init: () => localStorage.setItem('oristudio:theme', 'Dracula') },
    };
    for (const [who, setup] of Object.entries(removed)) {
      check(`never shows the copy to ${who}`, !(await copySurvives(browser, server.url, setup)));
    }
    check('never shows the copy on the editor’s URL', !(await copySurvives(browser, `${server.url}edit`)));
  } finally {
    await Promise.all(Object.values(browsers).map((browser) => browser.close()));
    await server.close();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log(`Screenshots of every difference: ${failures}`);
    process.exit(1);
  }
}

await main().catch((error) => {
  console.error(`\nThe lane threw before it finished: ${error?.stack ?? error}`);
  process.exit(1);
});
