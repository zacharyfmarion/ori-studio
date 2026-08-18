#!/usr/bin/env node
/**
 * Builds the updater's `latest.json` from a release's actual assets.
 *
 * Two rules shape this. Assets are **discovered**, never predicted: the
 * bundler's naming has changed across Tauri versions and doubled extensions
 * (`.app.tar.gz`) make a guessed filename a silent miss. And a platform key is
 * emitted only when both its payload and its `.sig` are present — Tauri
 * validates the *whole* manifest before comparing versions, so one malformed
 * entry breaks updates on every platform, not just its own.
 *
 * Usage: compose-manifest.mjs <tag> <version> <assets.json> <out.json>
 *
 * `assets.json` is `gh release view <tag> --json assets`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Which manifest key each updater payload belongs under.
 *
 * `darwin-aarch64` and `darwin-x86_64` are separate builds here rather than one
 * universal binary, so each gets its own entry and its own signature.
 */
const PLATFORM_MATCHERS = [
  { key: 'darwin-aarch64', test: (n) => /\.app\.tar\.gz$/.test(n) && /aarch64|arm64/.test(n) },
  { key: 'darwin-x86_64', test: (n) => /\.app\.tar\.gz$/.test(n) && /x64|x86_64|intel/.test(n) },
  { key: 'windows-x86_64', test: (n) => /\.nsis\.zip$/.test(n) },
  // Tauri has shipped both shapes for AppImage across versions; accept either
  // rather than betting on one.
  { key: 'linux-x86_64', test: (n) => /\.AppImage(\.tar\.gz)?$/.test(n) },
];

export function composeManifest({ assets, version, notes, pubDate }) {
  const names = new Set(assets.map((a) => a.name));
  const platforms = {};
  const missing = [];

  for (const { key, test } of PLATFORM_MATCHERS) {
    const payload = assets.find((a) => test(a.name) && !a.name.endsWith('.sig'));
    if (!payload) {
      missing.push(`${key}: no payload`);
      continue;
    }
    if (!names.has(`${payload.name}.sig`)) {
      // A payload without its signature is worse than an absent platform: the
      // client would download the whole thing and then refuse it.
      missing.push(`${key}: ${payload.name} has no .sig`);
      continue;
    }
    platforms[key] = { url: payload.url, signature: `${payload.name}.sig` };
  }

  return { manifest: { version, notes, pub_date: pubDate, platforms }, missing };
}

function main() {
  const [, , tag, version, assetsPath, outPath] = process.argv;
  if (!tag || !version || !assetsPath || !outPath) {
    console.error('usage: compose-manifest.mjs <tag> <version> <assets.json> <out.json>');
    process.exit(1);
  }
  const release = JSON.parse(readFileSync(assetsPath, 'utf8'));
  const assets = (release.assets ?? release).map((a) => ({
    name: a.name,
    url: a.url ?? a.browser_download_url,
  }));

  const notesPath = process.env.RELEASE_NOTES_FILE;
  const { manifest, missing } = composeManifest({
    assets,
    version,
    notes: notesPath ? readFileSync(notesPath, 'utf8').trim() : '',
    pubDate: release.publishedAt ?? new Date().toISOString(),
  });

  if (missing.length > 0) {
    console.error('Refusing to compose an incomplete manifest:');
    for (const line of missing) console.error(`  ${line}`);
    process.exit(1);
  }

  // The signature field holds the .sig file's *contents*, not its name — the
  // filename here is a placeholder the signing step replaces once it has the
  // bytes. See scripts/sign-updater-manifest.sh.
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`composed ${outPath} for ${version} (tag ${tag}):`);
  for (const key of Object.keys(manifest.platforms)) console.log(`  ${key}`);
}

if (process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]))) main();
