import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeManifest } from './compose-manifest.mjs';

const asset = (name) => ({ name, url: `https://example.test/${name}` });

const FULL = [
  asset('OriStudio_0.3.0_aarch64.app.tar.gz'),
  asset('OriStudio_0.3.0_aarch64.app.tar.gz.sig'),
  asset('OriStudio_0.3.0_x64.app.tar.gz'),
  asset('OriStudio_0.3.0_x64.app.tar.gz.sig'),
  asset('OriStudio_0.3.0_x64-setup.nsis.zip'),
  asset('OriStudio_0.3.0_x64-setup.nsis.zip.sig'),
  asset('OriStudio_0.3.0_amd64.AppImage.tar.gz'),
  asset('OriStudio_0.3.0_amd64.AppImage.tar.gz.sig'),
  // Installer downloads live on the same release and must not be mistaken for
  // updater payloads.
  asset('OriStudio_0.3.0_aarch64.dmg'),
  asset('OriStudio_0.3.0_amd64.deb'),
];

test('emits one entry per platform from the real asset list', () => {
  const { manifest, missing } = composeManifest({
    assets: FULL,
    version: '0.3.0',
    notes: 'notes',
    pubDate: '2026-08-20T00:00:00Z',
  });
  assert.deepEqual(missing, []);
  assert.deepEqual(Object.keys(manifest.platforms).sort(), [
    'darwin-aarch64',
    'darwin-x86_64',
    'linux-x86_64',
    'windows-x86_64',
  ]);
  assert.equal(manifest.version, '0.3.0');
});

test('keeps the two macOS architectures apart', () => {
  // They ship as separate builds, so an arm64 machine must not be handed the
  // Intel tarball.
  const { manifest } = composeManifest({ assets: FULL, version: '0.3.0' });
  assert.match(manifest.platforms['darwin-aarch64'].url, /aarch64/);
  assert.match(manifest.platforms['darwin-x86_64'].url, /x64/);
});

test('never treats a .dmg or .deb as an updater payload', () => {
  // Those are for humans to download; the updater installs the tarball.
  const { manifest } = composeManifest({ assets: FULL, version: '0.3.0' });
  for (const entry of Object.values(manifest.platforms)) {
    assert.doesNotMatch(entry.url, /\.dmg$|\.deb$/);
  }
});

test('refuses a payload whose signature is missing', () => {
  // Emitting it anyway would make every client download the whole update and
  // then reject it.
  const withoutSig = FULL.filter((a) => a.name !== 'OriStudio_0.3.0_x64-setup.nsis.zip.sig');
  const { missing } = composeManifest({ assets: withoutSig, version: '0.3.0' });
  assert.equal(missing.length, 1);
  assert.match(missing[0], /windows-x86_64/);
});

test('reports a platform that produced nothing', () => {
  const macOnly = FULL.filter((a) => /app\.tar\.gz/.test(a.name));
  const { missing } = composeManifest({ assets: macOnly, version: '0.3.0' });
  assert.equal(missing.length, 2);
  assert.ok(missing.some((m) => m.startsWith('windows-x86_64')));
  assert.ok(missing.some((m) => m.startsWith('linux-x86_64')));
});

test('accepts either AppImage shape Tauri has shipped', () => {
  const bare = FULL.filter((a) => !a.name.includes('AppImage')).concat([
    asset('OriStudio_0.3.0_amd64.AppImage'),
    asset('OriStudio_0.3.0_amd64.AppImage.sig'),
  ]);
  const { manifest, missing } = composeManifest({ assets: bare, version: '0.3.0' });
  assert.deepEqual(missing, []);
  assert.match(manifest.platforms['linux-x86_64'].url, /\.AppImage$/);
});
