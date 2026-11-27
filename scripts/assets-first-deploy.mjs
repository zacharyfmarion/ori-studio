#!/usr/bin/env node
/**
 * Publish a build's `/assets/` before any page names them: the first half of a two-step
 * deploy.
 *
 * A Pages deploy puts the new pages and the new hashed files live at the same moment, and
 * that moment is not the same everywhere. On 2026-11-19 a request for the new entry script
 * reached oristudio.dev one second before the file did. Pages answers a missing file with
 * `index.html` at 200, `public/_headers` marks everything under `/assets/` cacheable for a
 * year, and Cloudflare's edge kept that HTML as the entry until the zone was purged: the
 * site rendered nothing for every visitor that edge served. Nothing in the response can
 * tell a missing file from a present one, so the fix is the order instead: no page may
 * name a file before that file is served.
 *
 * This is one of two layers. The other is in `_headers`: `Cloudflare-CDN-Cache-Control:
 * no-store` keeps the zone from holding any `/assets/` answer at all. The order protects
 * the browsers that would otherwise race a deploy, which keep the fallback for a year on
 * their own; the header protects every visitor at an edge from a name that was asked for
 * while it did not exist, which the order cannot reach (a rollback past the carry window
 * and a fix forward that brings an unchanged worker's name back, or a name requested
 * before it is ever deployed). Neither covers what the other does.
 *
 * So the deploy goes out twice:
 *
 * 1. `stage` copies the finished `dist` and puts back what the live site serves now in
 *    place of every HTML page, the service worker and `deploy-history.json`. Published,
 *    that adds this build's files without any page or worker naming them; the pages still
 *    name the previous build, whose files the carry-forward step put in `dist`. It does
 *    publish this build's Functions, `_headers` and unhashed public files (locales,
 *    images) under the previous pages, which is the pairing every tab left open across
 *    a deploy already gets, so those must stay compatible with the previous pages anyway.
 * 2. `wait` polls the live site until every file this build emitted is served, then waits
 *    a little longer for the rest of the network.
 * 3. The workflow then publishes `dist` itself, as it always did.
 *
 * A deploy cancelled between the two leaves the site on the previous pages, worker and
 * history, with this build's files beside them: a working site, and one the next deploy
 * reads as exactly what it is.
 *
 * Both commands ask for files that may not exist yet, so both talk only to a `*.pages.dev`
 * host, which has no zone cache in front of it. Asking oristudio.dev for a file before it
 * is served is precisely how the 2026-11-19 entry got cached.
 *
 *   node scripts/assets-first-deploy.mjs stage apps/web/dist <out> --from https://oristudio.pages.dev
 *   node scripts/assets-first-deploy.mjs wait apps/web/dist --origin https://oristudio.pages.dev
 *
 * `stage` exits 1 when it cannot reproduce the live site exactly, and the workflow then
 * deploys in one step and fails the run once the deploy is out, so the skipped ordering is
 * seen. `wait` exits 1 when the files never show up, and the workflow then stops before
 * any page names them.
 */
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  HISTORY_FILE,
  fetchFromSite,
  isServedAsset,
  listAssets,
  parseHistory,
} from './carry-forward-assets.mjs';

/** The one file besides the pages that names this build's hashed files (its manifest). */
const SERVICE_WORKER = 'sw.js';

const REQUEST_TIMEOUT_MS = 15_000;
const CONCURRENCY = 16;
const POLL_INTERVAL_MS = 5_000;
export const WAIT_TIMEOUT_MS = 10 * 60_000;
/**
 * How long to wait after the poll sees every file. A heuristic: the poll asks one place,
 * and Cloudflare documents no bound on how fast a Pages deployment reaches the others. The
 * 2026-11-19 race was one second wide; the edge-cache header bounds what any lag can cost.
 */
export const SETTLE_MS = 60_000;

/**
 * Throw unless `origin` is a `*.pages.dev` host. Both commands request files that may not
 * exist yet, and on a host with a zone cache that request is what caches the fallback.
 */
export function assertUncachedHost(origin) {
  const { hostname } = new URL(origin);
  if (!hostname.endsWith('.pages.dev')) {
    throw new Error(
      `${origin} is not a *.pages.dev host: asking a zone-cached domain for a file that is not ` +
        'there yet caches the fallback page under its name'
    );
  }
}

/** The URL path Pages serves a built file at: `ja/faq/index.html` at `/ja/faq/`. */
export function servedPath(file) {
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return `/${file.slice(0, -'index.html'.length)}`;
  if (file.endsWith('.html')) return `/${file.slice(0, -'.html'.length)}`;
  return `/${file}`;
}

/** Every `/assets/` file a page or worker names, as `assets/<name>`. */
export function assetReferences(text) {
  return new Set([...text.matchAll(/\/assets\/([A-Za-z0-9_-][A-Za-z0-9._-]*)/g)].map((match) => `assets/${match[1]}`));
}

const isHtml = (response) => /\btext\/html\b/i.test(response.headers.get('content-type') ?? '');

/**
 * The files `stage` puts back from the live site: every HTML page, the service worker, and
 * the deploy history (see {@link stage}).
 */
export async function liveFiles(dist) {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dist, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter(
      (file) =>
        !file.startsWith('assets/') &&
        (file.endsWith('.html') || file === SERVICE_WORKER || file === HISTORY_FILE)
    );
  return files.sort();
}

async function inBatches(items, task) {
  const results = [];
  for (let start = 0; start < items.length; start += CONCURRENCY) {
    results.push(...(await Promise.all(items.slice(start, start + CONCURRENCY).map(task))));
  }
  return results;
}

/**
 * Copy `dist` to `out` with what the live site serves now in place of this build's pages,
 * service worker and deploy history. Throws when the result would not serve what the live
 * site serves: a file it cannot read after retrying, or a file a live page names, that the
 * live site serves, and that `out` does not hold.
 *
 * A page this build adds is not live yet, and Pages answers it with the live `index.html`,
 * which is then what `out` holds there: the same answer the live site gives. The worker and
 * the history are files, not pages, so one the live site lacks is removed instead.
 *
 * The history is staged because the next deploy reads it to date the builds it carries.
 * This build's, published under the previous pages, would claim this build had replaced
 * them; if step 2 then never ran, the previous build would age out of the carry while
 * every open tab still runs it.
 *
 * A name the live site does not serve either is not a reason to refuse: the staged
 * deployment cannot break what is already gone. The live worker names such files today:
 * its manifest is written while the build's sourcemaps still exist, and the Sentry plugin
 * deletes them afterwards.
 *
 * @returns {Promise<{ replaced: string[], removed: string[], referenced: number, dead: string[] }>}
 */
export async function stage({ dist, out, from, fetchImpl = globalThis.fetch, retryDelayMs }) {
  assertUncachedHost(from);
  await rm(out, { recursive: true, force: true });
  await cp(dist, out, { recursive: true });

  const replaced = [];
  const removed = [];
  const referenced = new Set();
  for (const file of await liveFiles(out)) {
    const where = servedPath(file);
    const response = await fetchFromSite(from, where.slice(1), fetchImpl, retryDelayMs);
    if (response.status !== 200 || response.redirected) {
      throw new Error(`the live site answers ${where} with ${response.status}`);
    }
    const target = path.join(out, file);
    const isPage = file.endsWith('.html');
    if (!isPage && isHtml(response)) {
      // Not a file the live site has: the fallback page is its answer, and so is no file.
      await rm(target);
      removed.push(file);
      continue;
    }
    if (isPage ? !isHtml(response) : !isServedAsset(response)) {
      throw new Error(`the live site answers ${where} with ${response.headers.get('content-type')}`);
    }
    const text = await response.text();
    // The history names files of builds no page loads any more; only pages and the worker
    // name what a visitor will ask for.
    if (file !== HISTORY_FILE) for (const asset of assetReferences(text)) referenced.add(asset);
    await writeFile(target, text);
    replaced.push(file);
  }

  const held = new Set(await listAssets(out));
  const absent = [...referenced].filter((asset) => !held.has(asset)).sort();
  const answers = await inBatches(absent, (asset) =>
    fetchFromSite(from, asset, fetchImpl, retryDelayMs, { method: 'HEAD' })
  );
  const missing = [];
  const dead = [];
  absent.forEach((asset, index) => {
    const answer = answers[index];
    if (isServedAsset(answer)) missing.push(asset);
    else if (answer.status === 200 && isHtml(answer)) dead.push(asset);
    else throw new Error(`the live site answers /${asset} with ${answer.status}`);
  });
  if (missing.length > 0) {
    throw new Error(
      `the live pages name ${missing.length} file${missing.length === 1 ? '' : 's'} the live site ` +
        `serves and this deployment would not, so publishing it would break them: ` +
        `${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`
    );
  }
  return { replaced, removed, referenced: referenced.size, dead };
}

/**
 * This build's own files: the newest deploy in the history the carry-forward step wrote, or,
 * without one, everything under `assets/`.
 */
export async function ownAssets(dist) {
  try {
    const history = parseHistory(await readFile(path.join(dist, HISTORY_FILE), 'utf8'));
    const own = history?.deploys[0]?.assets;
    if (own?.length) return own;
  } catch {
    // No history: fall through to every file, carried ones included. Slower, never wrong.
  }
  return listAssets(dist);
}

async function served(origin, asset, fetchImpl) {
  try {
    const response = await fetchImpl(`${origin.replace(/\/+$/, '')}/${asset}`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return isServedAsset(response);
  } catch {
    return false;
  }
}

/**
 * Resolve once `origin` serves every file in `assets`, plus {@link SETTLE_MS}; reject when
 * it has not after `timeoutMs`. A file seen once is not asked for again.
 */
export async function waitUntilServed({
  origin,
  assets,
  fetchImpl = globalThis.fetch,
  timeoutMs = WAIT_TIMEOUT_MS,
  pollMs = POLL_INTERVAL_MS,
  settleMs = SETTLE_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  log = console.log,
}) {
  assertUncachedHost(origin);
  const deadline = now() + timeoutMs;
  let pending = [...assets];
  for (;;) {
    const results = await inBatches(pending, (asset) => served(origin, asset, fetchImpl));
    pending = pending.filter((_, index) => !results[index]);
    log(`${assets.length - pending.length} of ${assets.length} files served`);
    if (pending.length === 0) break;
    if (now() >= deadline) {
      throw new Error(`${pending.length} files still not served, e.g. ${pending.slice(0, 3).join(', ')}`);
    }
    await sleep(pollMs);
  }
  log(`waiting ${settleMs / 1000}s for the rest of the network`);
  await sleep(settleMs);
}

function option(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [command, dist, ...rest] = process.argv.slice(2);
  const prefix = 'assets-first-deploy: ';
  // A stage that fails costs the ordering: the deploy goes out in one step, and the workflow
  // fails the run afterwards. A wait that fails stops the deploy.
  const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::error::' : '';
  try {
    if (command === 'stage' && dist && rest[0] && option(rest, '--from')) {
      const result = await stage({ dist, out: rest[0], from: option(rest, '--from') });
      const pages = result.replaced.filter((file) => file.endsWith('.html')).length;
      const others = [...result.replaced.filter((file) => !file.endsWith('.html')).map((file) => `the live ${file}`)];
      const gone = result.removed.length ? `; removed ${result.removed.join(', ')} (not live)` : '';
      const dead = result.dead.length
        ? `, and ${result.dead.length} the live site does not serve either (e.g. ${result.dead[0]})`
        : '';
      console.log(
        `${prefix}staged ${pages} live pages${others.length ? `, ${others.join(', ')}` : ''}${gone}; ` +
          `they name ${result.referenced - result.dead.length} files this deployment serves${dead}`
      );
    } else if (command === 'wait' && dist && option(rest, '--origin')) {
      await waitUntilServed({
        origin: option(rest, '--origin'),
        assets: await ownAssets(dist),
        log: (message) => console.log(`${prefix}${message}`),
      });
    } else {
      console.error(
        'usage: node scripts/assets-first-deploy.mjs stage <dist> <out> --from <origin>\n' +
          '       node scripts/assets-first-deploy.mjs wait <dist> --origin <origin>'
      );
      process.exit(2);
    }
  } catch (error) {
    console.log(`${annotate}${prefix}${error?.message ?? error}`);
    process.exit(1);
  }
}
