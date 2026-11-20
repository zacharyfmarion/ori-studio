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
 * So the deploy goes out twice:
 *
 * 1. `stage` copies the finished `dist` and puts back, in place of every HTML page and the
 *    service worker, what the live site serves at that path now. Published, that adds
 *    this build's files and changes nothing anybody loads: the pages still name the
 *    previous build, whose files the carry-forward step put in `dist`.
 * 2. `wait` polls the live site until every file this build emitted is served, then waits
 *    a little longer for the rest of the network.
 * 3. The workflow then publishes `dist` itself, as it always did.
 *
 * A deploy cancelled between the two leaves the site on the previous pages with this
 * build's files beside them, which is a working site.
 *
 * Poll a host with no zone cache in front of it (`oristudio.pages.dev`). Asking the custom
 * domain for a file before it is served is precisely how the 2026-11-19 entry got cached.
 *
 *   node scripts/assets-first-deploy.mjs stage apps/web/dist <out> --from https://oristudio.pages.dev
 *   node scripts/assets-first-deploy.mjs wait apps/web/dist --origin https://oristudio.pages.dev
 *
 * `stage` exits 1 when it cannot reproduce the live pages exactly, and the workflow then
 * deploys in one step, as before this script. `wait` exits 1 when the files never show up,
 * and the workflow then stops before any page names them.
 */
import { cp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HISTORY_FILE, isServedAsset, listAssets, parseHistory } from './carry-forward-assets.mjs';

/** The one file besides the pages that names this build's hashed files (its manifest). */
const SERVICE_WORKER = 'sw.js';

const REQUEST_TIMEOUT_MS = 15_000;
const CONCURRENCY = 16;
const POLL_INTERVAL_MS = 5_000;
export const WAIT_TIMEOUT_MS = 10 * 60_000;
/**
 * How long to wait after the poll sees every file. The poll asks one place; this is for
 * the others. The 2026-11-19 race was one second wide.
 */
export const SETTLE_MS = 30_000;

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

/** The files `stage` replaces: every HTML page, and the service worker. */
export async function pageFiles(dist) {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dist, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'))
    .filter((file) => !file.startsWith('assets/') && (file.endsWith('.html') || file === SERVICE_WORKER));
  return files.sort();
}

async function fetchLive(from, file, fetchImpl) {
  const url = `${from.replace(/\/+$/, '')}${servedPath(file)}`;
  return fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

/**
 * Copy `dist` to `out` with the live site's pages and service worker in place of this
 * build's. Throws when the result would not serve exactly what the live site serves: a
 * page it cannot read, or a file a live page names that `out` does not hold.
 *
 * A page this build adds is not live yet, and Pages answers it with the live `index.html`,
 * which is then what `out` holds there: the same answer the live site gives.
 *
 * @returns {Promise<{ replaced: string[], removed: string[], referenced: number }>}
 */
export async function stage({ dist, out, from, fetchImpl = globalThis.fetch }) {
  await rm(out, { recursive: true, force: true });
  await cp(dist, out, { recursive: true });

  const replaced = [];
  const removed = [];
  const referenced = new Set();
  for (const file of await pageFiles(out)) {
    const response = await fetchLive(from, file, fetchImpl);
    if (response.status !== 200 || response.redirected) {
      throw new Error(`the live site answers ${servedPath(file)} with ${response.status}`);
    }
    const target = path.join(out, file);
    if (file === SERVICE_WORKER && isHtml(response)) {
      // No worker live: the fallback page is Pages' answer, and no file is the same answer.
      await rm(target);
      removed.push(file);
      continue;
    }
    if (file === SERVICE_WORKER ? !isServedAsset(response) : !isHtml(response)) {
      throw new Error(`the live site answers ${servedPath(file)} with ${response.headers.get('content-type')}`);
    }
    const text = await response.text();
    for (const asset of assetReferences(text)) referenced.add(asset);
    await writeFile(target, text);
    replaced.push(file);
  }

  const held = new Set(await listAssets(out));
  const missing = [...referenced].filter((asset) => !held.has(asset)).sort();
  if (missing.length > 0) {
    throw new Error(
      `the live pages name ${missing.length} file${missing.length === 1 ? '' : 's'} this deployment ` +
        `would not serve, so publishing it would break them: ${missing.slice(0, 5).join(', ')}` +
        (missing.length > 5 ? ', …' : '')
    );
  }
  return { replaced, removed, referenced: referenced.size };
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
  const deadline = now() + timeoutMs;
  let pending = [...assets];
  for (;;) {
    const still = [];
    for (let start = 0; start < pending.length; start += CONCURRENCY) {
      const batch = pending.slice(start, start + CONCURRENCY);
      const results = await Promise.all(batch.map((asset) => served(origin, asset, fetchImpl)));
      batch.forEach((asset, index) => results[index] || still.push(asset));
    }
    pending = still;
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
  // A stage that fails costs only the ordering (the deploy goes out in one step), so it is a
  // warning; a wait that fails stops the deploy.
  const level = command === 'stage' ? 'warning' : 'error';
  const annotate = process.env.GITHUB_ACTIONS === 'true' ? `::${level}::` : '';
  try {
    if (command === 'stage' && dist && rest[0] && option(rest, '--from')) {
      const result = await stage({ dist, out: rest[0], from: option(rest, '--from') });
      const pages = result.replaced.filter((file) => file !== SERVICE_WORKER).length;
      const worker = result.replaced.includes(SERVICE_WORKER) ? ' and the live worker' : ' and no worker';
      console.log(`${prefix}staged ${pages} live pages${worker}; they name ${result.referenced} files, all present`);
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
