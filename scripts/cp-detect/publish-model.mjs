#!/usr/bin/env node
/** Publish verified immutable weights and promote the pointer's compatible registry.
 * Usage: publish-model.mjs [--dry-run] [--no-promote] [--note TEXT]
 *   [--initialize-from registry.json] [--registry KEY] [--pointer PATH] [--bucket NAME]
 * See RELEASE.md. Remote read failures stop publication; new channels require an
 * explicit existing seed registry. Legacy clients keep their compatible model.
 */
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTRY_KEYS, readRemoteJsonResult, planRegistryUpdate, assertImmutableManifest } from './publication-registry.mjs';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Missing value for ${name}`);
  return args[index + 1];
};
const bucket = option('--bucket', 'oristudio-models');
const dryRun = flag('--dry-run');
const note = option('--note', null);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const webDir = join(repoRoot, 'apps/web');
const pointer = JSON.parse(readFileSync(resolve(repoRoot, option('--pointer', 'scripts/cp-detect/current-model.json')), 'utf8'));
const registryKey = option('--registry', pointer.registry_key ?? 'registry.json');
const seedKey = option('--initialize-from', null);
if (!REGISTRY_KEYS.includes(registryKey) || (seedKey && !REGISTRY_KEYS.includes(seedKey))) throw new Error('Unknown registry channel');
const modelDir = join(repoRoot, pointer.versioned_model_asset_dir);
const modelPath = join(modelDir, pointer.model_filename);
const manifestPath = join(modelDir, 'manifest.json');
const bytes = readFileSync(modelPath);
const sha = createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (sha !== pointer.model_sha256 || manifest.id !== pointer.model_id || manifest.model.sha256 !== sha ||
    manifest.model.size_bytes !== bytes.length || manifest.model.url !== 'model.onnx') {
  throw new Error('Model bytes, manifest, and current-model pointer disagree');
}
if ('pixel_evidence' in manifest.outputs && registryKey === 'registry.json') {
  throw new Error('Pixel models cannot be published to the registry used by incompatible legacy clients');
}
const id = pointer.model_id;
const keyPrefix = `cp-detector/${id}`;

function readRemote(key, allowMissing = false) {
  const result = spawnSync('npx', ['wrangler', 'r2', 'object', 'get', `${bucket}/${key}`, '--pipe', '--remote'], {
    cwd: webDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  return readRemoteJsonResult(result, key, { allowMissing });
}

function put(key, file, contentType, cacheControl) {
  if (dryRun) {
    console.log(`[dry-run] would upload ${file} → ${bucket}/${key}`);
    return;
  }
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', file,
    '--content-type', contentType, '--cache-control', cacheControl, '--remote'],
  { cwd: webDir, stdio: ['ignore', 'inherit', 'inherit'] });
}

// Complete all reads and compatibility checks before the first write.
let registry = readRemote(registryKey, Boolean(seedKey));
if (!registry) {
  console.log(`Initializing ${registryKey} from ${seedKey}`);
  registry = readRemote(seedKey);
}
const remoteManifest = readRemote(`${keyPrefix}/manifest.json`, true);
assertImmutableManifest(remoteManifest, manifest);
const next = planRegistryUpdate(registry, {
  id, released: manifest.created_at, size_bytes: bytes.length, sha256: sha,
  manifest_url: `${keyPrefix}/manifest.json`, model_url: `${keyPrefix}/model.onnx`,
  ...(note ? { note } : {}),
}, !flag('--no-promote'));
console.log(`${registryKey}: ${registry.families['cp-detector'].current} → ${next.families['cp-detector'].current}`);
if (!remoteManifest) {
  put(`${keyPrefix}/model.onnx`, modelPath, 'application/octet-stream', 'public, max-age=31536000, immutable');
  put(`${keyPrefix}/manifest.json`, manifestPath, 'application/json', 'public, max-age=31536000, immutable');
}
const temp = mkdtempSync(join(tmpdir(), 'oristudio-registry-'));
try {
  const file = join(temp, registryKey);
  writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  put(registryKey, file, 'application/json', 'public, max-age=300, must-revalidate');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log(dryRun ? 'dry run complete' : `published ${bucket}/${registryKey}`);
