#!/usr/bin/env node
/**
 * Publish the current detector model to R2 and point the registry at it.
 *
 * The model is 45 MB, over Cloudflare Pages' 25 MiB static-file cap, so it
 * lives in the `oristudio-models` bucket at an immutable versioned key and
 * `apps/web/functions/models/[[path]].ts` serves it from the site's origin.
 * This is the one way a model gets there. It reads the pointer file
 * (`scripts/cp-detect/current-model.json`), verifies the local file's sha256
 * against it, uploads the model and its manifest if the key is new, and
 * rewrites `registry.json` — appending the version and, unless `--no-promote`,
 * making it `current`. Every step is idempotent: run it twice and the second
 * run changes nothing.
 *
 * Needs `wrangler` logged in (locally, an OAuth login; in CI, an API token with
 * R2 read and write on the account).
 *
 * Usage:
 *   node scripts/cp-detect/publish-model.mjs [--bucket oristudio-models] [--no-promote]
 *                                            [--note "why this version"] [--dry-run]
 */

import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY_SCHEMA = 'oristudio/cp-detect-model-registry/v1';
const FAMILY = 'cp-detector';
const REGISTRY_KEY = 'registry.json';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
};
const bucket = option('--bucket', 'oristudio-models');
const promote = !flag('--no-promote');
const dryRun = flag('--dry-run');
const note = option('--note', null);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = join(repoRoot, 'apps', 'web');
const pointer = JSON.parse(readFileSync(join(repoRoot, 'scripts/cp-detect/current-model.json'), 'utf8'));
const modelDir = join(repoRoot, pointer.versioned_model_asset_dir);
const modelPath = join(modelDir, pointer.model_filename);
const manifestPath = join(modelDir, 'manifest.json');

if (!existsSync(modelPath) || !existsSync(manifestPath)) {
  console.error(`missing ${modelPath} or ${manifestPath} — copy the model assets first (see AGENTS.md)`);
  process.exit(2);
}
const sha = createHash('sha256').update(readFileSync(modelPath)).digest('hex');
if (sha !== pointer.model_sha256) {
  console.error(`sha256 mismatch: ${modelPath} hashes to ${sha}, current-model.json says ${pointer.model_sha256}`);
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.id !== pointer.model_id || manifest.model.sha256 !== sha) {
  console.error('manifest.json disagrees with current-model.json (id or sha256)');
  process.exit(2);
}
const size = statSync(modelPath).size;
const id = pointer.model_id;
const keyPrefix = `${FAMILY}/${id}`;

function wrangler(argv, { input, allowFailure } = {}) {
  const result = spawnSync('npx', ['wrangler', ...argv], {
    cwd: webDir,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    console.error(result.stderr || result.stdout);
    throw new Error(`wrangler ${argv.join(' ')} failed`);
  }
  return result;
}

function objectExists(key) {
  const result = wrangler(['r2', 'object', 'get', `${bucket}/${key}`, '--pipe', '--remote'], {
    allowFailure: true,
  });
  return result.status === 0;
}

function readRegistry() {
  const result = wrangler(['r2', 'object', 'get', `${bucket}/${REGISTRY_KEY}`, '--pipe', '--remote'], {
    allowFailure: true,
  });
  if (result.status !== 0) return { schema: REGISTRY_SCHEMA, families: {} };
  // wrangler prints a banner before the object body; the body is the JSON tail.
  const text = result.stdout.slice(result.stdout.indexOf('{'));
  const parsed = JSON.parse(text);
  if (parsed.schema !== REGISTRY_SCHEMA) throw new Error(`unexpected registry schema ${parsed.schema}`);
  return parsed;
}

function put(key, file, contentType, cacheControl) {
  if (dryRun) {
    console.log(`[dry-run] would upload ${file} → ${bucket}/${key}`);
    return;
  }
  execFileSync(
    'npx',
    [
      'wrangler', 'r2', 'object', 'put', `${bucket}/${key}`,
      '--file', file, '--content-type', contentType, '--cache-control', cacheControl, '--remote',
    ],
    { cwd: webDir, stdio: ['ignore', 'inherit', 'inherit'] }
  );
}

// 1. The model and its manifest, only if this version is new to the bucket.
if (objectExists(`${keyPrefix}/manifest.json`)) {
  console.log(`model ${id} already in ${bucket}; skipping upload`);
} else {
  console.log(`uploading ${id} (${(size / 1e6).toFixed(1)} MB) to ${bucket}/${keyPrefix}/`);
  put(`${keyPrefix}/model.onnx`, modelPath, 'application/octet-stream', 'public, max-age=31536000, immutable');
  put(`${keyPrefix}/manifest.json`, manifestPath, 'application/json', 'public, max-age=31536000, immutable');
}

// 2. The registry: append the version, and point at it unless told not to.
const registry = readRegistry();
const family = registry.families[FAMILY] ?? { current: '', versions: [] };
let entry = family.versions.find((version) => version.id === id);
if (!entry) {
  const nextVersion = family.versions.reduce((max, version) => Math.max(max, version.version), 0) + 1;
  entry = {
    id,
    version: nextVersion,
    released: manifest.created_at ?? new Date().toISOString().slice(0, 10),
    size_bytes: size,
    sha256: sha,
    manifest_url: `${keyPrefix}/manifest.json`,
    model_url: `${keyPrefix}/model.onnx`,
    ...(note ? { note } : {}),
  };
  family.versions.push(entry);
  console.log(`registry: added ${id} as version ${nextVersion}`);
} else {
  console.log(`registry: ${id} already listed as version ${entry.version}`);
}
const before = family.current;
if (promote) family.current = id;
registry.families[FAMILY] = family;
if (before !== family.current) console.log(`registry: current ${before || '(none)'} → ${family.current}`);

const tmp = join(mkdtempSync(join(tmpdir(), 'oristudio-registry-')), REGISTRY_KEY);
writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n');
put(REGISTRY_KEY, tmp, 'application/json', 'public, max-age=300, must-revalidate');
console.log(dryRun ? 'dry run complete' : `published: ${bucket}/${REGISTRY_KEY} now points at ${family.current}`);
