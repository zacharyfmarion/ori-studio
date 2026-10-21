import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyAppImageBundle } from './verify-appimage-bundle.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The files a correct AppImage has, as `--appimage-extract` would list them. */
const SHIPPABLE = [
  'squashfs-root/AppRun',
  'squashfs-root/usr/bin/ori-studio',
  'squashfs-root/usr/lib/libgtk-3.so.0',
  'squashfs-root/usr/lib/libwebkit2gtk-4.1.so.0',
  'squashfs-root/usr/lib/libgdk_pixbuf-2.0.so.0',
];

test('a bundle that leaves GLib to the host passes', () => {
  assert.deepEqual(verifyAppImageBundle(SHIPPABLE), []);
});

test('every bundled GLib file is reported, by name', () => {
  const problems = verifyAppImageBundle([
    ...SHIPPABLE,
    'squashfs-root/usr/lib/libgio-2.0.so',
    'squashfs-root/usr/lib/libgio-2.0.so.0',
    'squashfs-root/usr/lib/libgio-2.0.so.0.7200.4',
    'squashfs-root/usr/lib/libglib-2.0.so.0',
    'squashfs-root/usr/lib/libgmodule-2.0.so.0',
    'squashfs-root/usr/lib/libgobject-2.0.so.0.7200.4',
  ]);
  assert.equal(problems.length, 6);
  assert.match(problems[0], /libgio-2\.0\.so is bundled/);
  assert.ok(problems.some((problem) => problem.includes('libglib-2.0.so.0')));
});

test('the arm64 leg is covered, where the libraries sit under a different triple', () => {
  const problems = verifyAppImageBundle([
    ...SHIPPABLE,
    'squashfs-root/usr/lib/aarch64-linux-gnu/libgio-2.0.so.0.7200.4',
  ]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /libgio-2\.0\.so\.0\.7200\.4 is bundled/);
});

// libgiognutls.so is the TLS backend the GTK plugin deliberately bundles, and
// it is deliberately not GLib. A prefix match without the dot separator would
// have deleted it along with libgio, and the AppImage would have shipped with
// no TLS at all.
test('the bundled GIO TLS module is not mistaken for GLib', () => {
  const tls = 'squashfs-root/usr/lib/x86_64-linux-gnu/gio/modules/libgiognutls.so';
  assert.deepEqual(verifyAppImageBundle([...SHIPPABLE, tls]), []);
});

test('an empty extraction fails rather than reading as clean', () => {
  const problems = verifyAppImageBundle([]);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((problem) => problem.includes('did the AppImage extract correctly?')));
});

// The plugin's sweep and the verifier's list have to name the same sonames, and
// they live in two different languages in two different files.
test('the vendored plugin sweeps exactly what the verifier refuses', () => {
  const plugin = readFileSync(join(repoRoot, 'scripts/appimage/linuxdeploy-plugin-gtk.sh'), 'utf8');
  const sweep = plugin.match(/^for soname in (.+); do$/m);
  assert.ok(sweep, 'the plugin no longer has a `for soname in ...` sweep');
  assert.deepEqual(sweep[1].split(' ').sort(), [
    'libgio-2.0.so',
    'libglib-2.0.so',
    'libgmodule-2.0.so',
    'libgobject-2.0.so',
    'libgthread-2.0.so',
  ]);
});

/**
 * A stand-in for the AppImage.
 *
 * The verifier's only Linux-specific move is running the artifact with
 * `--appimage-extract` and reading the `squashfs-root` it drops in the working
 * directory. A script that writes the same tree exercises that path exactly —
 * the temp directory, the extraction, the walk, the exit code — on a machine
 * with no AppImage runtime, which is what lets this run on every PR rather than
 * only on a Linux release leg.
 */
function fakeAppImage(files) {
  const dir = mkdtempSync(join(tmpdir(), 'ori-fake-appimage-'));
  const path = join(dir, 'Fake.AppImage');
  const mkdirs = [...new Set(files.map((file) => dirname(`squashfs-root/${file}`)))];
  const script = [
    '#!/bin/sh',
    'set -e',
    `mkdir -p ${mkdirs.join(' ')}`,
    ...files.map((file) => `: > squashfs-root/${file}`),
    '',
  ].join('\n');
  writeFileSync(path, script, { mode: 0o755 });
  return path;
}

function runVerifier(appImage) {
  const verifier = join(repoRoot, 'scripts/verify-appimage-bundle.mjs');
  const result = spawnSync(process.execPath, [verifier, appImage], { encoding: 'utf8' });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test('the extract path passes a bundle that leaves GLib to the host', () => {
  const { status, out } = runVerifier(
    fakeAppImage(['AppRun', 'usr/lib/libgtk-3.so.0', 'usr/lib/libwebkit2gtk-4.1.so.0'])
  );
  assert.equal(status, 0, out);
  assert.match(out, /no bundled GLib/);
});

test('the extract path fails a bundle carrying GLib, and names it', () => {
  const { status, out } = runVerifier(
    fakeAppImage([
      'AppRun',
      'usr/lib/libgtk-3.so.0',
      'usr/lib/libwebkit2gtk-4.1.so.0',
      'usr/lib/libgio-2.0.so.0.7200.4',
    ])
  );
  assert.equal(status, 1, out);
  assert.match(out, /libgio-2\.0\.so\.0\.7200\.4 is bundled/);
});

test('install-appimage-tools.sh puts the patched plugin where the bundler looks', () => {
  const target = mkdtempSync(join(tmpdir(), 'ori-tools-'));
  execFileSync(join(repoRoot, 'scripts/appimage/install-appimage-tools.sh'), [target], {
    stdio: 'pipe',
  });

  const installed = join(target, '.tauri', 'linuxdeploy-plugin-gtk.sh');
  assert.ok(existsSync(installed), '.tauri/linuxdeploy-plugin-gtk.sh was not created');
  assert.ok(statSync(installed).mode & 0o111, 'the plugin is not executable');
  assert.equal(
    readFileSync(installed, 'utf8'),
    readFileSync(join(repoRoot, 'scripts/appimage/linuxdeploy-plugin-gtk.sh'), 'utf8')
  );
});
