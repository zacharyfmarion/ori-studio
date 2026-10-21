import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  HISTORY_FILE,
  carryForward,
  isServedAsset,
  parseHistory,
  planCarryForward,
} from './carry-forward-assets.mjs';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-21T12:00:00Z');
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();
const deploy = (id, at, assets) => ({ id, at, assets });
const history = (...deploys) => ({ version: 1, deploys });

function plan(previous, currentAssets, options = {}) {
  return planCarryForward({
    history: previous,
    current: deploy('new', new Date(NOW).toISOString(), currentAssets),
    now: NOW,
    keepMs: 7 * DAY,
    keepDeploys: 10,
    fileBudget: 1000,
    ...options,
  });
}

test('the first deploy has nothing to carry', () => {
  assert.deepEqual(plan(null, ['assets/index-n.js']), { kept: [], carry: [] });
});

test('carries what the live deploy emitted and this build did not', () => {
  const live = deploy('live', daysAgo(1), ['assets/index-l.js', 'assets/kernel-k.wasm']);
  const { kept, carry } = plan(history(live), ['assets/index-n.js', 'assets/kernel-k.wasm']);
  assert.deepEqual(kept, [live]);
  assert.deepEqual(carry, ['assets/index-l.js']);
});

test('ages a deploy from the deploy that replaced it, not from its own', () => {
  // Live since a day ago, so the deploy before it went stale a day ago, though it went
  // live 20 days ago. The one before that was replaced 20 days ago: too long.
  const live = deploy('c', daysAgo(1), ['assets/c.js']);
  const previous = deploy('b', daysAgo(20), ['assets/b.js']);
  const oldest = deploy('a', daysAgo(30), ['assets/a.js']);
  const { kept, carry } = plan(history(live, previous, oldest), ['assets/n.js']);
  assert.deepEqual(kept.map((each) => each.id), ['c', 'b']);
  assert.deepEqual(carry, ['assets/b.js', 'assets/c.js']);
});

test('keeps the live deploy however long it was live', () => {
  const { kept } = plan(history(deploy('live', daysAgo(90), ['assets/l.js'])), []);
  assert.deepEqual(kept.map((each) => each.id), ['live']);
});

test('keeps at most keepDeploys deploys', () => {
  const deploys = [1, 2, 3, 4].map((n) => deploy(`d${n}`, daysAgo(n / 10), [`assets/d${n}.js`]));
  const { kept, carry } = plan(history(...deploys), [], { keepDeploys: 2 });
  assert.deepEqual(kept.map((each) => each.id), ['d1', 'd2']);
  assert.deepEqual(carry, ['assets/d1.js', 'assets/d2.js']);
});

test('stops before the file budget is crossed, and keeps nothing older', () => {
  const live = deploy('live', daysAgo(0.1), ['assets/a.js', 'assets/b.js']);
  const big = deploy('big', daysAgo(0.2), ['assets/c.js', 'assets/d.js', 'assets/e.js']);
  const small = deploy('small', daysAgo(0.3), ['assets/f.js']);
  const { kept, carry } = plan(history(live, big, small), [], { fileBudget: 4 });
  assert.deepEqual(kept.map((each) => each.id), ['live']);
  assert.deepEqual(carry, ['assets/a.js', 'assets/b.js']);
});

test('counts a file several deploys share once', () => {
  const live = deploy('live', daysAgo(0.1), ['assets/shared.wasm', 'assets/l.js']);
  const older = deploy('older', daysAgo(0.2), ['assets/shared.wasm', 'assets/o.js']);
  const { carry } = plan(history(live, older), [], { fileBudget: 3 });
  assert.deepEqual(carry, ['assets/l.js', 'assets/o.js', 'assets/shared.wasm']);
});

test('a re-run of the same build is not kept twice, but still dates the deploy before it', () => {
  const rerun = deploy('new', daysAgo(1), ['assets/n.js']);
  const previous = deploy('prev', daysAgo(3), ['assets/p.js']);
  const { kept, carry } = plan(history(rerun, previous), ['assets/n.js']);
  assert.deepEqual(kept.map((each) => each.id), ['prev']);
  assert.deepEqual(carry, ['assets/p.js']);
  // `prev` went stale when this build first went live, a day ago, so it is kept. Had that
  // been eight days ago, it would be past the window.
  const late = plan(history(deploy('new', daysAgo(8), ['assets/n.js']), previous), ['assets/n.js']);
  assert.deepEqual(late.kept, []);
});

test('reads a history, and nothing else as one', () => {
  const valid = history(deploy('a', daysAgo(1), ['assets/a-1.js']));
  assert.deepEqual(parseHistory(JSON.stringify(valid)), valid);
  // Pages' answer for a file that is not there.
  assert.equal(parseHistory('<!doctype html><html><head></head></html>'), null);
  assert.equal(parseHistory(JSON.stringify({ version: 2, deploys: [] })), null);
  assert.equal(parseHistory(JSON.stringify({ version: 1 })), null);
  assert.equal(parseHistory('null'), null);
});

test('drops malformed entries, and any path outside a plain assets/ file', () => {
  const parsed = parseHistory(
    JSON.stringify({
      version: 1,
      deploys: [
        { id: 'a', at: daysAgo(1), assets: ['assets/ok-1.js', 'assets/../index.html', 'assets/.hidden', 'index.html', 'assets/sub/x.js', '../x.js', 'assets/', 5] },
        { id: 'b', at: 'not a date', assets: [] },
        { id: '', at: daysAgo(2), assets: [] },
        { id: 'c', at: daysAgo(3) },
        'nonsense',
      ],
    })
  );
  assert.deepEqual(parsed, history(deploy('a', daysAgo(1), ['assets/ok-1.js'])));
});

test('tells a served file from the index.html Pages answers a missing one with', () => {
  const answer = (status, type) => new Response('x', { status, headers: { 'content-type': type } });
  assert.equal(isServedAsset(answer(200, 'application/javascript')), true);
  assert.equal(isServedAsset(answer(200, 'application/wasm')), true);
  assert.equal(isServedAsset(answer(200, 'text/html; charset=utf-8')), false);
  assert.equal(isServedAsset(answer(404, 'text/html')), false);
  assert.equal(isServedAsset(answer(503, 'application/javascript')), false);
});

/** A built `dist` with these `assets/` files. */
function dist(assets) {
  const root = mkdtempSync(join(tmpdir(), 'ori-carry-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html>');
  for (const [name, text] of Object.entries(assets)) writeFileSync(join(root, 'assets', name), text);
  return root;
}

/** The live site, as Pages serves it: these files, and `index.html` at 200 for anything else. */
function site(files) {
  const requests = [];
  const fetchImpl = async (url) => {
    const file = new URL(url).pathname.slice(1);
    requests.push(file);
    if (file in files) {
      const body = files[file];
      const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript';
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'content-type': type } });
    }
    return new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
  };
  return { fetchImpl, requests };
}

function run(root, fetchImpl, extra = {}) {
  const logs = [];
  const warnings = [];
  const done = carryForward({
    dist: root,
    from: 'https://oristudio.pages.dev/',
    id: 'new',
    now: NOW,
    fetchImpl,
    retryDelayMs: 0,
    log: (message) => logs.push(message),
    warn: (message) => warnings.push(message),
    ...extra,
  });
  return done.then((result) => ({ ...result, logs, warnings }));
}

test('downloads the kept files and publishes a history the next deploy can read', async () => {
  const root = dist({ 'index-n.js': 'new', 'kernel-k.wasm': 'kernel' });
  const live = deploy('live', daysAgo(0.5), ['assets/index-l.js', 'assets/lazy-l.js', 'assets/kernel-k.wasm']);
  const { fetchImpl, requests } = site({
    [HISTORY_FILE]: history(live),
    'assets/index-l.js': 'old entry',
    'assets/lazy-l.js': 'old lazy chunk',
    'assets/kernel-k.wasm': 'kernel',
  });

  const result = await run(root, fetchImpl);

  assert.deepEqual(result.carried, ['assets/index-l.js', 'assets/lazy-l.js']);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.warnings, []);
  // The unchanged kernel is this build's own: not downloaded, not written twice.
  assert.ok(!requests.includes('assets/kernel-k.wasm'));
  assert.equal(readFileSync(join(root, 'assets/lazy-l.js'), 'utf8'), 'old lazy chunk');
  assert.deepEqual(readdirSync(join(root, 'assets')).sort(), ['index-l.js', 'index-n.js', 'kernel-k.wasm', 'lazy-l.js']);

  const published = parseHistory(readFileSync(join(root, HISTORY_FILE), 'utf8'));
  assert.deepEqual(published, {
    version: 1,
    deploys: [
      deploy('new', new Date(NOW).toISOString(), ['assets/index-n.js', 'assets/kernel-k.wasm']),
      live,
    ],
  });
});

test('the first deploy publishes a history of its own build, without a warning', async () => {
  const root = dist({ 'index-n.js': 'new' });
  const result = await run(root, site({}).fetchImpl);
  assert.deepEqual(result.carried, []);
  assert.deepEqual(result.warnings, []);
  assert.match(result.logs.join('\n'), /publishes no deploy-history\.json yet/);
  assert.deepEqual(
    parseHistory(readFileSync(join(root, HISTORY_FILE), 'utf8')).deploys.map((each) => each.id),
    ['new']
  );
});

test('an unreachable site costs the carry-over and nothing else', async () => {
  const root = dist({ 'index-n.js': 'new' });
  let attempts = 0;
  const result = await run(root, async () => {
    attempts += 1;
    throw new TypeError('fetch failed');
  });
  assert.equal(attempts, 3);
  assert.match(result.warnings.join('\n'), /could not read https:\/\/oristudio\.pages\.dev\/deploy-history\.json/);
  assert.deepEqual(
    parseHistory(readFileSync(join(root, HISTORY_FILE), 'utf8')).deploys.map((each) => each.id),
    ['new']
  );
});

test('a PR’s first preview, whose alias does not exist yet, is a first deploy too', async () => {
  const root = dist({ 'index-n.js': 'new' });
  const result = await run(root, async () => new Response('Not found', { status: 404, headers: { 'content-type': 'text/html' } }));
  assert.deepEqual(result.warnings, []);
  assert.match(result.logs.join('\n'), /publishes no deploy-history\.json yet/);
});

test('a site that keeps failing is warned about, after retrying, and costs only the carry-over', async () => {
  const root = dist({ 'index-n.js': 'new' });
  let attempts = 0;
  const result = await run(root, async () => {
    attempts += 1;
    return new Response('', { status: 503 });
  });
  assert.equal(attempts, 3);
  assert.match(result.warnings.join('\n'), /could not read .*deploy-history\.json: 503/);
  assert.deepEqual(result.history.deploys.map((each) => each.id), ['new']);
});

test('a history that is not one is warned about and ignored', async () => {
  const root = dist({ 'index-n.js': 'new' });
  const result = await run(root, site({ [HISTORY_FILE]: '{"version":1' }).fetchImpl);
  assert.match(result.warnings.join('\n'), /is not a deploy history/);
  assert.deepEqual(result.history.deploys.map((each) => each.id), ['new']);
});

test('a file that does not come across is left out of the history it would be read from', async () => {
  const root = dist({ 'index-n.js': 'new' });
  const live = deploy('live', daysAgo(0.5), ['assets/gone-g.js', 'assets/kept-k.js']);
  // `gone-g.js` is listed but not served, so Pages answers it with index.html.
  const { fetchImpl } = site({ [HISTORY_FILE]: history(live), 'assets/kept-k.js': 'kept' });

  const result = await run(root, fetchImpl);

  assert.deepEqual(result.carried, ['assets/kept-k.js']);
  assert.deepEqual(result.failed, ['assets/gone-g.js']);
  assert.match(result.warnings.join('\n'), /not carried: assets\/gone-g\.js \(200 text\/html/);
  assert.deepEqual(result.history.deploys[1].assets, ['assets/kept-k.js']);
  assert.deepEqual(readdirSync(join(root, 'assets')).sort(), ['index-n.js', 'kept-k.js']);
});

test('retries a passing failure before giving a file up', async () => {
  const root = dist({ 'index-n.js': 'new' });
  const live = deploy('live', daysAgo(0.5), ['assets/flaky-f.js']);
  const { fetchImpl: serve } = site({ [HISTORY_FILE]: history(live), 'assets/flaky-f.js': 'flaky' });
  let failures = 1;
  const result = await run(root, async (url) => {
    if (url.endsWith('flaky-f.js') && failures-- > 0) return new Response('', { status: 502 });
    return serve(url);
  });
  assert.deepEqual(result.carried, ['assets/flaky-f.js']);
});
