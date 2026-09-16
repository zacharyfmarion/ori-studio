import { isDeepStrictEqual } from 'node:util';

export const REGISTRY_SCHEMA = 'oristudio/cp-detect-model-registry/v1';
export const REGISTRY_KEYS = ['registry.json', 'registry-pixel-v1.json'];

export function readRemoteJsonResult(result, key, { allowMissing = false } = {}) {
  if (result.status !== 0) {
    // Only R2's explicit missing-key response means absence. Auth/network errors
    // must never initialize an empty registry or overwrite an immutable object.
    if (allowMissing && /The specified key does not exist\./.test(result.stderr ?? '')) return null;
    throw new Error(`Could not read ${key}; publication stopped. ${result.stderr || result.error || result.stdout}`);
  }
  const start = result.stdout.indexOf('{');
  if (start < 0) throw new Error(`No JSON object in ${key}`);
  return JSON.parse(result.stdout.slice(start));
}

export function planRegistryUpdate(registry, entry, promote) {
  if (registry.schema !== REGISTRY_SCHEMA || !registry.families || Array.isArray(registry.families)) {
    throw new Error('Unexpected registry structure');
  }
  const next = structuredClone(registry);
  const family = next.families['cp-detector'];
  if (!family || !Array.isArray(family.versions) || !family.versions.length ||
      !family.versions.some(version => version.id === family.current) ||
      family.versions.some(version => !Number.isSafeInteger(version.version) || version.version < 1)) {
    throw new Error('Registry must contain an existing, valid current detector');
  }
  const existing = family.versions.find(version => version.id === entry.id);
  if (existing) {
    for (const field of ['sha256', 'size_bytes', 'manifest_url', 'model_url']) {
      if (existing[field] !== entry[field]) throw new Error(`Immutable registry entry differs: ${entry.id} ${field}`);
    }
  } else {
    family.versions.push({ ...entry, version: Math.max(...family.versions.map(version => version.version)) + 1 });
  }
  if (promote) family.current = entry.id;
  return next;
}

export function assertImmutableManifest(remote, local) {
  if (remote && !isDeepStrictEqual(remote, local)) {
    throw new Error(`Immutable manifest already exists with different content: ${local.id}`);
  }
}
