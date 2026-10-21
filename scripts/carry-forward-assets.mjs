#!/usr/bin/env node
/**
 * Carry the last few deploys' `/assets/` into this one, so a tab opened before a deploy
 * keeps working after it.
 *
 * A Pages deployment serves one build, so each deploy takes the previous build's hashed
 * files off the site, and a tab still running that build loses every lazy feature it has
 * not used yet: the workspace, the ZIP writer, an engine worker or its wasm. Pages does not
 * even 404 them — an unmatched path answers with `index.html` at 200, which the browser
 * refuses as a module. And every deploy renames every chunk, not only the changed ones:
 * the Sentry plugin stamps the release, and with it the commit, into each (ORI-STUDIO-X).
 *
 * So each deploy publishes {@link HISTORY_FILE} — its own files, and the previous deploys
 * it still carries — and the next deploy reads it off the live site, downloads what a kept
 * deploy emitted and the new build did not, and writes the history forward. A build is
 * kept {@link KEEP_DAYS} days after the deploy that replaced it, and at most
 * {@link KEEP_DEPLOYS} deploys back; past that a tab misses as before, and
 * `apps/web/src/lib/importOrReload.ts` is the fallback where reloading is safe.
 *
 * Only `/assets/` is carried: those names are content hashed, so an old file can never
 * stand in for a new one. The cost is the downloads, a few MB per kept deploy; wrangler
 * uploads only what the project does not already hold, so carried files go up once.
 *
 * It fails open. No history (the first deploy with this script), one that does not read,
 * an unreachable site, a file that does not come across: each costs only the carry-over,
 * with a warning, and the script still exits 0. The workflow step also runs with
 * `continue-on-error`.
 *
 *   node scripts/carry-forward-assets.mjs apps/web/dist --from https://oristudio.pages.dev
 *
 * `--id` names the deploy in the history (the workflows pass the commit); `--keep-days`
 * and `--keep-deploys` override the retention.
 */
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Served beside `index.html`, so the next deploy can read what this one carries. */
export const HISTORY_FILE = 'deploy-history.json';
const HISTORY_VERSION = 1;

/** How long after it was replaced a build's files stay on the site. */
export const KEEP_DAYS = 7;
/** How many previous deploys a deployment carries at most, whatever their age. */
export const KEEP_DEPLOYS = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Pages' limits: 25 MiB a file and 20,000 files a deployment. Every carried file was
 * deployed once already, so the first can only be crossed by a bug; the second is kept
 * well clear of rather than approached.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_DEPLOYMENT_FILES = 20_000;
const FILE_HEADROOM = 2_000;

const CONCURRENCY = 8;
const REQUEST_TIMEOUT_MS = 30_000;
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 1_000;
/** No download starts after this: a slow site costs the carry-over, never a stuck deploy. */
const DEADLINE_MS = 5 * 60_000;

/**
 * A path the history may name: one file directly under `assets/`, whose name cannot start
 * with a dot. The history is read off the network, and nothing it says may write outside
 * `dist/assets`.
 */
const ASSET_PATH = /^assets\/[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/**
 * @typedef {{ id: string, at: string, assets: string[] }} Deploy
 * @typedef {{ version: 1, deploys: Deploy[] }} History  newest deploy first
 */

/** This build's own `/assets/` files, as `assets/<name>`. */
export async function listAssets(dist) {
  const entries = await readdir(path.join(dist, 'assets'), { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => `assets/${entry.name}`)
    .filter((asset) => ASSET_PATH.test(asset))
    .sort();
}

async function countFiles(dist) {
  const entries = await readdir(dist, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).length;
}

/**
 * The history a deploy published, or null when `text` is not one.
 *
 * Pages answers a missing file with `index.html`, so "not JSON" is the ordinary answer
 * on the first deploy, not a corruption. Entries are checked one by one, and a path that
 * is not a plain `assets/` file is dropped.
 *
 * @returns {History | null}
 */
export function parseHistory(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.version !== HISTORY_VERSION || !Array.isArray(data.deploys)) return null;
  const deploys = [];
  for (const deploy of data.deploys) {
    if (typeof deploy?.id !== 'string' || deploy.id === '') continue;
    if (typeof deploy.at !== 'string' || !Number.isFinite(Date.parse(deploy.at))) continue;
    if (!Array.isArray(deploy.assets)) continue;
    const assets = deploy.assets.filter((asset) => typeof asset === 'string' && ASSET_PATH.test(asset));
    deploys.push({ id: deploy.id, at: deploy.at, assets });
  }
  return { version: HISTORY_VERSION, deploys };
}

/**
 * Which previous deploys to keep, and which of their files this build lacks.
 *
 * A deploy's age is counted from the deploy that *replaced* it, because that is when its
 * tabs started to go stale: the live deploy is replaced now, and each older one when the
 * next newer one went live. Deploys are kept newest first until one is too old, the count
 * is reached, or its files would not fit `fileBudget` — and everything older goes with it,
 * so the history stays one unbroken run of deploys.
 *
 * An entry with the current deploy's id is the same build deployed again (a re-run). It
 * adds nothing, so it is not kept, but its time still dates the deploy before it.
 *
 * @param {{ history: History | null, current: Deploy, now: number, keepMs: number,
 *   keepDeploys: number, fileBudget: number }} options
 * @returns {{ kept: Deploy[], carry: string[] }}
 */
export function planCarryForward({ history, current, now, keepMs, keepDeploys, fileBudget }) {
  const have = new Set(current.assets);
  const carry = new Set();
  const kept = [];
  let replacedAt = now;
  for (const deploy of history?.deploys ?? []) {
    if (kept.length >= keepDeploys || now - replacedAt > keepMs) break;
    if (deploy.id !== current.id) {
      const missing = deploy.assets.filter((asset) => !have.has(asset) && !carry.has(asset));
      if (carry.size + missing.length > fileBudget) break;
      for (const asset of missing) carry.add(asset);
      kept.push(deploy);
    }
    replacedAt = Date.parse(deploy.at);
  }
  return { kept, carry: [...carry].sort() };
}

/**
 * Whether a response is the file itself rather than Pages' `index.html` fallback, which
 * comes back at 200 for a file that is gone. Content type is the tell, as it is for the
 * browser that refuses the "module". A redirect is refused too: nothing under `/assets/`
 * redirects, so one means the answer is not the file.
 */
export function isServedAsset(response) {
  return (
    response.status === 200 &&
    !response.redirected &&
    !/\btext\/html\b/i.test(response.headers.get('content-type') ?? '')
  );
}

/**
 * GET `origin/file`, retrying what may be passing: a request that failed outright and a
 * 5xx. Any other answer is the site's, and is returned as it is.
 */
async function fetchFromSite(origin, file, fetchImpl, retryDelayMs) {
  const url = `${origin.replace(/\/+$/, '')}/${file}`;
  for (let attempt = 1; ; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (response.status < 500 || attempt === ATTEMPTS) return response;
    } catch (error) {
      if (attempt === ATTEMPTS) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
  }
}

/** The live history, or why there is none. */
async function fetchHistory(origin, fetchImpl, retryDelayMs) {
  const where = `${origin.replace(/\/+$/, '')}/${HISTORY_FILE}`;
  let response;
  try {
    response = await fetchFromSite(origin, HISTORY_FILE, fetchImpl, retryDelayMs);
  } catch (error) {
    return { history: null, warning: `could not read ${where}: ${error.message}` };
  }
  // Pages' answer for a file that is not there: the first deploy, whose live site predates
  // this script, or a PR's first preview, whose alias does not exist yet (404).
  const html = /\btext\/html\b/i.test(response.headers.get('content-type') ?? '');
  if ((response.status === 200 && html) || response.status === 404) {
    return { history: null, note: `${origin} publishes no ${HISTORY_FILE} yet; nothing to carry` };
  }
  if (!isServedAsset(response)) {
    return { history: null, warning: `could not read ${where}: ${response.status}` };
  }
  const history = parseHistory(await response.text());
  if (!history) return { history: null, warning: `${where} is not a deploy history` };
  return { history };
}

/** One carried file's bytes, or the reason it is not carried. */
async function download(origin, asset, fetchImpl, retryDelayMs) {
  try {
    const response = await fetchFromSite(origin, asset, fetchImpl, retryDelayMs);
    if (!isServedAsset(response)) {
      return { error: `${response.status} ${response.headers.get('content-type') ?? ''}`.trim() };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0) return { error: 'empty' };
    if (bytes.length > MAX_FILE_BYTES) return { error: `${bytes.length} bytes, over Pages' limit` };
    return { bytes };
  } catch (error) {
    return { error: error.message };
  }
}

async function eachLimited(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Download the kept deploys' files into `dist/assets` and write the history this
 * deployment will publish. Never throws for what the network or the live site does; see
 * the header.
 *
 * @returns {Promise<{ history: History, carried: string[], failed: string[], bytes: number }>}
 */
export async function carryForward({
  dist,
  from,
  id,
  now = Date.now(),
  keepDays = KEEP_DAYS,
  keepDeploys = KEEP_DEPLOYS,
  fetchImpl = globalThis.fetch,
  retryDelayMs = RETRY_DELAY_MS,
  log = console.log,
  warn = console.warn,
}) {
  const current = { id, at: new Date(now).toISOString(), assets: await listAssets(dist) };
  const fileBudget = Math.max(0, MAX_DEPLOYMENT_FILES - FILE_HEADROOM - (await countFiles(dist)));

  const live = await fetchHistory(from, fetchImpl, retryDelayMs);
  if (live.warning) warn(live.warning);
  if (live.note) log(live.note);

  const { kept, carry } = planCarryForward({
    history: live.history,
    current,
    now,
    keepMs: keepDays * DAY_MS,
    keepDeploys,
    fileBudget,
  });

  const carried = [];
  const failed = [];
  let bytes = 0;
  const deadline = Date.now() + DEADLINE_MS;
  await eachLimited(carry, CONCURRENCY, async (asset) => {
    const result =
      Date.now() < deadline
        ? await download(from, asset, fetchImpl, retryDelayMs)
        : { error: 'out of time' };
    if (result.bytes) {
      try {
        // `wx`: a name this build emitted is never overwritten, whatever the history says.
        await writeFile(path.join(dist, asset), result.bytes, { flag: 'wx' });
        carried.push(asset);
        bytes += result.bytes.length;
        return;
      } catch (error) {
        result.error = error.message;
      }
    }
    failed.push(asset);
    warn(`not carried: ${asset} (${result.error})`);
  });

  // What the history claims is what this deployment serves, so a file that did not come
  // across is not asked for again by the next deploy.
  const served = new Set([...current.assets, ...carried]);
  const servedOnly = (deploy) => ({ ...deploy, assets: deploy.assets.filter((asset) => served.has(asset)) });
  const history = { version: HISTORY_VERSION, deploys: [current, ...kept.map(servedOnly)] };
  await writeFile(path.join(dist, HISTORY_FILE), `${JSON.stringify(history, null, 1)}\n`);

  const ids = kept.map((deploy) => deploy.id.slice(0, 9)).join(', ');
  log(
    `carried ${carried.length} files (${(bytes / 1e6).toFixed(1)} MB) from ${kept.length} previous ` +
      `deploy${kept.length === 1 ? '' : 's'}${ids ? ` (${ids})` : ''}` +
      (failed.length ? `; ${failed.length} not carried` : '')
  );
  return { history, carried: carried.sort(), failed: failed.sort(), bytes };
}

function option(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const args = process.argv.slice(2);
  const dist = args[0];
  const from = option(args, '--from');
  if (!dist || dist.startsWith('--') || !from) {
    console.error('usage: node scripts/carry-forward-assets.mjs <dist> --from <origin> [--id <deploy id>]');
    process.exit(2);
  }
  // Under Actions, a warning is an annotation on the run rather than a line in its log.
  const annotate = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : '';
  const prefix = 'carry-forward-assets: ';
  const keepDays = Number(option(args, '--keep-days') ?? KEEP_DAYS);
  const keepDeploys = Number(option(args, '--keep-deploys') ?? KEEP_DEPLOYS);
  try {
    await carryForward({
      dist,
      from,
      id: option(args, '--id') ?? process.env.GITHUB_SHA ?? 'local',
      keepDays: Number.isFinite(keepDays) ? keepDays : KEEP_DAYS,
      keepDeploys: Number.isFinite(keepDeploys) ? keepDeploys : KEEP_DEPLOYS,
      log: (message) => console.log(`${prefix}${message}`),
      warn: (message) => console.log(`${annotate}${prefix}${message}`),
    });
  } catch (error) {
    // Failing open: this deploy goes out with its own build only. Whatever was carried
    // before the failure stays in `dist`, unlisted, and is harmless there.
    console.log(`${annotate}${prefix}carry-over skipped: ${error?.message ?? error}`);
    if (error?.stack) console.log(error.stack);
  }
}
