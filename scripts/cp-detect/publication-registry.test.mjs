import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY_SCHEMA, readRemoteJsonResult, planRegistryUpdate, assertImmutableManifest } from './publication-registry.mjs';

const old = { id: 'old', version: 1, sha256: 'aaa', size_bytes: 100, manifest_url: 'old/manifest.json', model_url: 'old/model.onnx' };
const candidate = { id: 'new', sha256: 'bbb', size_bytes: 20, manifest_url: 'new/manifest.json', model_url: 'new/model.onnx' };
const registry = { schema: REGISTRY_SCHEMA, families: { 'cp-detector': { current: 'old', versions: [old] } } };

test('failed remote reads cannot silently replace the live registry', () => {
  for (const stderr of ['Authentication error', 'fetch failed', 'Forbidden']) {
    assert.throws(() => readRemoteJsonResult({ status: 1, stderr }, 'registry.json', { allowMissing: true }), /publication stopped/);
  }
  const absent = { status: 1, stderr: 'The specified key does not exist.' };
  assert.throws(() => readRemoteJsonResult(absent, 'registry.json'), /publication stopped/);
  assert.equal(readRemoteJsonResult(absent, 'new.json', { allowMissing: true }), null);
  assert.throws(() => readRemoteJsonResult({ status: 0, stdout: '<html>error</html>' }, 'registry.json'), /No JSON/);
});

test('new channel keeps its rollback version and leaves the seed untouched', () => {
  const next = planRegistryUpdate(registry, candidate, true);
  assert.equal(next.families['cp-detector'].current, 'new');
  assert.deepEqual(next.families['cp-detector'].versions, [old, { ...candidate, version: 2 }]);
  assert.equal(registry.families['cp-detector'].current, 'old');
  assert.equal(planRegistryUpdate(registry, candidate, false).families['cp-detector'].current, 'old');
  assert.deepEqual(planRegistryUpdate(next, candidate, true), next);
  assert.equal(planRegistryUpdate(next, old, true).families['cp-detector'].current, 'old');
});

test('existing immutable identities and malformed registries cannot be overwritten', () => {
  assert.throws(() => planRegistryUpdate(registry, { ...old, sha256: 'changed' }, true), /Immutable/);
  assert.throws(() => planRegistryUpdate({ ...registry, families: {} }, candidate, true), /valid current/);
  assert.throws(() => assertImmutableManifest({ id: 'same', outputs: 'old' }, { id: 'same', outputs: 'new' }), /Immutable/);
  assert.doesNotThrow(() => assertImmutableManifest(null, { id: 'new' }));
});
