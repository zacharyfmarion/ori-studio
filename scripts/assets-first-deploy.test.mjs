import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { HISTORY_FILE } from './carry-forward-assets.mjs';
import {
  assetReferences,
  ownAssets,
  servedPath,
  stage,
  waitUntilServed,
} from './assets-first-deploy.mjs';

const ORIGIN = 'https://oristudio.pages.dev';
const HTML = 'text/html; charset=utf-8';

/** A built `dist`: `files` maps a path under it to its text. */
function dist(files) {
  const root = mkdtempSync(join(tmpdir(), 'ori-assets-first-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/**
 * The live site as Pages serves it: these paths, and `index.html` at 200 for anything else.
 * `files` maps a served path to [content type, body].
 */
function site(files) {
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    requests.push(`${init.method ?? 'GET'} ${pathname}`);
    const [type, body] = files[pathname] ?? [HTML, files['/']?.[1] ?? '<!doctype html>'];
    return new Response(init.method === 'HEAD' ? null : body, { headers: { 'content-type': type } });
  };
  return { fetchImpl, requests };
}

const page = (entry) => `<!doctype html><link rel="modulepreload" href="${entry}"><div id="root"></div>`;

test('serves a page where Pages does, index files at their directory', () => {
  assert.equal(servedPath('index.html'), '/');
  assert.equal(servedPath('ja/faq/index.html'), '/ja/faq/');
  assert.equal(servedPath('about.html'), '/about');
  assert.equal(servedPath('sw.js'), '/sw.js');
});

test('reads the hashed files a page or the worker names', () => {
  const text = `${page('/assets/index-A1.js')}<link href="/assets/index-B2.css">` +
    `const m={entry:"/assets/index-A1.js",assets:["/assets/kernel-C3.wasm"]}`;
  assert.deepEqual([...assetReferences(text)].sort(), ['assets/index-A1.js', 'assets/index-B2.css', 'assets/kernel-C3.wasm']);
});

test('stages this build’s files behind the live pages and worker', async () => {
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'ja/index.html': page('/assets/index-NEW.js'),
    'sw.js': 'const manifest={entry:"/assets/index-NEW.js"}',
    'assets/index-NEW.js': 'new entry',
    // Carried forward from the live deploy.
    'assets/index-OLD.js': 'old entry',
    'locales/en/common.json': '{}',
  });
  const out = join(mkdtempSync(join(tmpdir(), 'ori-stage-')), 'stage');
  const { fetchImpl } = site({
    '/': [HTML, page('/assets/index-OLD.js')],
    '/ja/': [HTML, page('/assets/index-OLD.js').replace('root', 'root" lang="ja')],
    '/sw.js': ['application/javascript', 'const manifest={entry:"/assets/index-OLD.js"}'],
  });

  const result = await stage({ dist: root, out, from: ORIGIN, fetchImpl });

  assert.deepEqual(result.replaced, ['index.html', 'ja/index.html', 'sw.js']);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /index-OLD\.js/);
  assert.match(readFileSync(join(out, 'ja/index.html'), 'utf8'), /lang="ja"/);
  assert.match(readFileSync(join(out, 'sw.js'), 'utf8'), /index-OLD\.js/);
  // Everything else is this build's, the new entry included, and dist itself is untouched.
  assert.equal(readFileSync(join(out, 'assets/index-NEW.js'), 'utf8'), 'new entry');
  assert.ok(existsSync(join(out, 'locales/en/common.json')));
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /index-NEW\.js/);
});

test('a page this build adds is staged as the live site answers it: the live index.html', async () => {
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'new-page/index.html': page('/assets/index-NEW.js'),
    'assets/index-NEW.js': 'new',
    'assets/index-OLD.js': 'old',
  });
  const out = join(mkdtempSync(join(tmpdir(), 'ori-stage-')), 'stage');
  const { fetchImpl } = site({ '/': [HTML, page('/assets/index-OLD.js')] });

  await stage({ dist: root, out, from: ORIGIN, fetchImpl });

  assert.match(readFileSync(join(out, 'new-page/index.html'), 'utf8'), /index-OLD\.js/);
});

test('with no worker live, stages none rather than the fallback page under its name', async () => {
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'sw.js': 'new worker',
    'assets/index-OLD.js': 'old',
  });
  const out = join(mkdtempSync(join(tmpdir(), 'ori-stage-')), 'stage');
  const { fetchImpl } = site({ '/': [HTML, page('/assets/index-OLD.js')] });

  const result = await stage({ dist: root, out, from: ORIGIN, fetchImpl });

  assert.deepEqual(result.removed, ['sw.js']);
  assert.ok(!existsSync(join(out, 'sw.js')));
});

// The carry-forward step fails open. If it did not bring the live entry across, staging
// would take the live site's own entry away for the length of the wait.
test('refuses when a live page names a file the staged deployment would not serve', async () => {
  const root = dist({ 'index.html': page('/assets/index-NEW.js'), 'assets/index-NEW.js': 'new' });
  const out = join(mkdtempSync(join(tmpdir(), 'ori-stage-')), 'stage');
  const { fetchImpl } = site({ '/': [HTML, page('/assets/index-OLD.js')] });

  await assert.rejects(stage({ dist: root, out, from: ORIGIN, fetchImpl }), /name 1 file .*index-OLD\.js/);
});

test('refuses when the live site does not answer a page', async () => {
  const root = dist({ 'index.html': page('/assets/index-NEW.js') });
  const out = join(mkdtempSync(join(tmpdir(), 'ori-stage-')), 'stage');
  const fetchImpl = async () => new Response('busy', { status: 503 });

  await assert.rejects(stage({ dist: root, out, from: ORIGIN, fetchImpl }), /answers \/ with 503/);
});

test('waits for this build’s own files, from the history the carry-forward step wrote', async () => {
  const history = {
    version: 1,
    deploys: [
      { id: 'new', at: '2026-11-19T23:48:00Z', assets: ['assets/index-NEW.js'] },
      { id: 'old', at: '2026-11-19T22:14:00Z', assets: ['assets/index-OLD.js'] },
    ],
  };
  const root = dist({
    [HISTORY_FILE]: JSON.stringify(history),
    'assets/index-NEW.js': 'new',
    'assets/index-OLD.js': 'old',
  });
  assert.deepEqual(await ownAssets(root), ['assets/index-NEW.js']);
  assert.deepEqual(await ownAssets(dist({ 'assets/a.js': 'a', 'assets/b.js': 'b' })), ['assets/a.js', 'assets/b.js']);
});

test('polls until every file is served, asks again only for the rest, then settles', async () => {
  const live = new Set(['/assets/a.js']);
  const requests = [];
  const fetchImpl = async (url, init) => {
    const { pathname } = new URL(url);
    requests.push(pathname);
    const type = live.has(pathname) ? 'application/javascript' : HTML;
    return new Response(null, { status: 200, headers: { 'content-type': type } });
  };
  const sleeps = [];
  const sleep = async (ms) => {
    sleeps.push(ms);
    live.add('/assets/b.js');
  };

  await waitUntilServed({
    origin: ORIGIN,
    assets: ['assets/a.js', 'assets/b.js'],
    fetchImpl,
    pollMs: 5,
    settleMs: 30,
    sleep,
    log: () => {},
  });

  assert.deepEqual(requests, ['/assets/a.js', '/assets/b.js', '/assets/b.js']);
  assert.deepEqual(sleeps, [5, 30]);
});

test('gives up when a file never shows up, rather than publishing pages that name it', async () => {
  let clock = 0;
  const fetchImpl = async () => new Response(null, { headers: { 'content-type': HTML } });
  await assert.rejects(
    waitUntilServed({
      origin: ORIGIN,
      assets: ['assets/missing.js'],
      fetchImpl,
      timeoutMs: 20,
      pollMs: 5,
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: () => {},
    }),
    /1 files still not served, e.g. assets\/missing\.js/
  );
});
