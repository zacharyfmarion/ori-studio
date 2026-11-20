import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { HISTORY_FILE } from './carry-forward-assets.mjs';
import {
  assertUncachedHost,
  assetReferences,
  ownAssets,
  servedPath,
  stage,
  waitUntilServed,
} from './assets-first-deploy.mjs';

const ORIGIN = 'https://oristudio.pages.dev';
const HTML = 'text/html; charset=utf-8';
const JS = 'application/javascript';
const JSON_TYPE = 'application/json';

/** A built `dist`: `files` maps a path under it to its text. */
function dist(files) {
  const root = mkdtempSync(join(tmpdir(), 'ori-assets-first-'));
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

const stageDir = () => join(mkdtempSync(join(tmpdir(), 'ori-stage-')), 'stage');

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
const run = (root, out, fetchImpl) => stage({ dist: root, out, from: ORIGIN, fetchImpl, retryDelayMs: 0 });

test('serves a page where Pages does, index files at their directory', () => {
  assert.equal(servedPath('index.html'), '/');
  assert.equal(servedPath('ja/faq/index.html'), '/ja/faq/');
  assert.equal(servedPath('about.html'), '/about');
  assert.equal(servedPath('sw.js'), '/sw.js');
});

test('reads the hashed files a page or the worker names', () => {
  const text = `${page('/assets/index-A1.js')}<link href="/assets/index-B2.css">` +
    `const m={entry:"/assets/index-A1.js",assets:["/assets/kernel-C3.wasm","/assets/index-A1.js.map"]}`;
  assert.deepEqual(
    [...assetReferences(text)].sort(),
    ['assets/index-A1.js', 'assets/index-A1.js.map', 'assets/index-B2.css', 'assets/kernel-C3.wasm']
  );
});

// Both commands ask for files that may not exist yet. On the custom domain that request
// is what caches the fallback at the edge.
test('talks only to a host with no zone cache in front of it', () => {
  assert.doesNotThrow(() => assertUncachedHost('https://oristudio.pages.dev'));
  assert.doesNotThrow(() => assertUncachedHost('https://pr-604.oristudio.pages.dev/'));
  assert.throws(() => assertUncachedHost('https://oristudio.dev'), /not a \*\.pages\.dev host/);
  assert.throws(() => assertUncachedHost('https://oristudio.dev.evil.example'), /not a \*\.pages\.dev host/);
});

test('stages this build’s files behind the live pages, worker and history', async () => {
  const liveHistory = JSON.stringify({ version: 1, deploys: [{ id: 'old', at: '2026-11-19T22:14:00Z', assets: ['assets/index-OLD.js'] }] });
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'ja/index.html': page('/assets/index-NEW.js'),
    'sw.js': 'const manifest={entry:"/assets/index-NEW.js"}',
    [HISTORY_FILE]: '{"version":1,"deploys":[{"id":"new"}]}',
    'assets/index-NEW.js': 'new entry',
    // Carried forward from the live deploy.
    'assets/index-OLD.js': 'old entry',
    'locales/en/common.json': '{}',
  });
  const out = stageDir();
  const { fetchImpl } = site({
    '/': [HTML, page('/assets/index-OLD.js')],
    '/ja/': [HTML, page('/assets/index-OLD.js').replace('root', 'root" lang="ja')],
    '/sw.js': [JS, 'const manifest={entry:"/assets/index-OLD.js"}'],
    [`/${HISTORY_FILE}`]: [JSON_TYPE, liveHistory],
  });

  const result = await run(root, out, fetchImpl);

  assert.deepEqual(result.replaced, [HISTORY_FILE, 'index.html', 'ja/index.html', 'sw.js']);
  assert.deepEqual(result.dead, []);
  assert.match(readFileSync(join(out, 'index.html'), 'utf8'), /index-OLD\.js/);
  assert.match(readFileSync(join(out, 'ja/index.html'), 'utf8'), /lang="ja"/);
  assert.match(readFileSync(join(out, 'sw.js'), 'utf8'), /index-OLD\.js/);
  assert.equal(readFileSync(join(out, HISTORY_FILE), 'utf8'), liveHistory);
  // Everything else is this build's, the new entry included, and dist itself is untouched.
  assert.equal(readFileSync(join(out, 'assets/index-NEW.js'), 'utf8'), 'new entry');
  assert.ok(existsSync(join(out, 'locales/en/common.json')));
  assert.match(readFileSync(join(root, 'index.html'), 'utf8'), /index-NEW\.js/);
  assert.match(readFileSync(join(root, HISTORY_FILE), 'utf8'), /"new"/);
});

test('a page this build adds is staged as the live site answers it: the live index.html', async () => {
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'new-page/index.html': page('/assets/index-NEW.js'),
    'assets/index-NEW.js': 'new',
    'assets/index-OLD.js': 'old',
  });
  const out = stageDir();
  const { fetchImpl } = site({ '/': [HTML, page('/assets/index-OLD.js')] });

  await run(root, out, fetchImpl);

  assert.match(readFileSync(join(out, 'new-page/index.html'), 'utf8'), /index-OLD\.js/);
});

test('with no worker or history live, stages neither rather than the fallback page under its name', async () => {
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'sw.js': 'new worker',
    [HISTORY_FILE]: '{}',
    'assets/index-OLD.js': 'old',
  });
  const out = stageDir();
  const { fetchImpl } = site({ '/': [HTML, page('/assets/index-OLD.js')] });

  const result = await run(root, out, fetchImpl);

  assert.deepEqual(result.removed, [HISTORY_FILE, 'sw.js']);
  assert.ok(!existsSync(join(out, 'sw.js')));
  assert.ok(!existsSync(join(out, HISTORY_FILE)));
});

// The production worker's manifest is written while the sourcemaps still exist, and the
// Sentry plugin deletes them after. So the live worker always names files nobody serves.
// Refusing over those made every real deploy fall back to one step.
test('ignores names the live site does not serve either, such as deleted sourcemaps', async () => {
  const root = dist({
    'index.html': page('/assets/index-NEW.js'),
    'sw.js': 'new worker',
    'assets/index-OLD.js': 'old',
  });
  const out = stageDir();
  const { fetchImpl, requests } = site({
    '/': [HTML, page('/assets/index-OLD.js')],
    '/sw.js': [JS, 'const manifest={assets:["/assets/index-OLD.js","/assets/index-OLD.js.map"]}'],
  });

  const result = await run(root, out, fetchImpl);

  assert.deepEqual(result.dead, ['assets/index-OLD.js.map']);
  assert.ok(requests.includes('HEAD /assets/index-OLD.js.map'));
  // A name the stage holds is never probed.
  assert.ok(!requests.some((request) => request.endsWith('/assets/index-OLD.js')));
});

// The carry-forward step fails open. If it did not bring a live file across, staging would
// take it away from the live pages for the length of the wait.
test('refuses when a live page names a file the live site serves and the stage lacks', async () => {
  const root = dist({ 'index.html': page('/assets/index-NEW.js'), 'assets/index-NEW.js': 'new' });
  const out = stageDir();
  const { fetchImpl } = site({
    '/': [HTML, page('/assets/index-OLD.js')],
    '/assets/index-OLD.js': [JS, 'old entry'],
  });

  await assert.rejects(run(root, out, fetchImpl), /name 1 file the live site serves .*index-OLD\.js/);
});

test('retries a page the live site fails to answer once', async () => {
  const root = dist({ 'index.html': page('/assets/index-NEW.js'), 'assets/index-OLD.js': 'old' });
  const out = stageDir();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) return new Response('busy', { status: 503 });
    return new Response(page('/assets/index-OLD.js'), { headers: { 'content-type': HTML } });
  };

  const result = await run(root, out, fetchImpl);

  assert.deepEqual(result.replaced, ['index.html']);
  assert.equal(calls, 2);
});

test('refuses when the live site keeps failing to answer a page', async () => {
  const root = dist({ 'index.html': page('/assets/index-NEW.js') });
  const out = stageDir();
  const fetchImpl = async () => new Response('busy', { status: 503 });

  await assert.rejects(run(root, out, fetchImpl), /answers \/ with 503/);
});

test('refuses a host with a zone cache before asking it anything', async () => {
  const root = dist({ 'index.html': page('/assets/index-NEW.js') });
  const { fetchImpl, requests } = site({});
  await assert.rejects(
    stage({ dist: root, out: stageDir(), from: 'https://oristudio.dev', fetchImpl }),
    /not a \*\.pages\.dev host/
  );
  assert.deepEqual(requests, []);
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
  const fetchImpl = async (url) => {
    const { pathname } = new URL(url);
    requests.push(pathname);
    const type = live.has(pathname) ? JS : HTML;
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

test('will not poll a zone-cached host for files that may not exist yet', async () => {
  await assert.rejects(
    waitUntilServed({ origin: 'https://oristudio.dev', assets: ['assets/a.js'], log: () => {} }),
    /not a \*\.pages\.dev host/
  );
});
