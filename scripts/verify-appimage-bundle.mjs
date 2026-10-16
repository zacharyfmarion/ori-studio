#!/usr/bin/env node
/**
 * Build-time assertion that the AppImage left GLib to the host.
 *
 * The AppImage used to ship its own `libgio-2.0.so.0.7200.4` — GLib 2.72.4,
 * whatever the pinned `ubuntu-22.04` runner had — while still letting that copy
 * scan the *host's* `/usr/lib/<arch>/gio/modules`. On any newer distro every
 * module there fails to load against it:
 *
 *   /usr/lib/x86_64-linux-gnu/gvfs/libgvfscommon.so: undefined symbol: g_task_set_static_name
 *
 * The fix is a patched linuxdeploy GTK plugin that deletes GLib from the AppDir
 * (`scripts/appimage/`), and it reaches the build through a chain that fails
 * *silently* in every link: tauri-bundler only uses our plugin because it skips
 * the download when the file already exists, the path it looks in depends on
 * `bundle.useLocalToolsDir`, and the sweep depends on linuxdeploy running
 * plugins after it deploys dependencies. Any one of those changing upstream
 * puts GLib back in the bundle, and nothing about the build would look wrong.
 *
 * So check the artifact. Extract the built AppImage and read what is actually
 * inside it — not the config, not the tools directory, not the plugin's own
 * output.
 *
 *   node scripts/verify-appimage-bundle.mjs <path-to-.AppImage>
 *
 * See implementation-plans/appimage-host-glib.md.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, chmodSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Libraries that must come from the host.
 *
 * GLib's four sonames plus libgthread, which is empty since 2.32 but would
 * still be a bundled GLib if it appeared. Matched on the basename, because the
 * arm64 leg puts them under `aarch64-linux-gnu` and the plugin's own symlinks
 * sit directly in `usr/lib`.
 */
export const HOST_OWNED_LIBRARIES = [
  'libglib-2.0.so',
  'libgobject-2.0.so',
  'libgio-2.0.so',
  'libgmodule-2.0.so',
  'libgthread-2.0.so',
];

/**
 * Libraries that must be inside.
 *
 * Without this half, an extraction that produced nothing — a moved output path,
 * a runtime that changed its extract flag — would pass as "no GLib found". The
 * two named here are the ones the app cannot run without and that the host is
 * never expected to provide at the right version.
 */
export const MUST_BE_BUNDLED = ['libgtk-3.so.0', 'libwebkit2gtk-4.1.so.0'];

/**
 * @param {string[]} files paths inside the AppDir, in any form; only basenames matter
 * @returns {string[]} problems, empty when the bundle is correct
 */
export function verifyAppImageBundle(files) {
  const names = new Set(files.map((file) => path.basename(file)));
  const problems = [];

  for (const name of [...names].sort()) {
    const soname = HOST_OWNED_LIBRARIES.find(
      (lib) => name === lib || name.startsWith(`${lib}.`)
    );
    if (soname) {
      problems.push(`${name} is bundled; ${soname} must come from the host`);
    }
  }

  for (const required of MUST_BE_BUNDLED) {
    if (!names.has(required)) {
      problems.push(`${required} is missing — did the AppImage extract correctly?`);
    }
  }

  return problems;
}

async function listFiles(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => !entry.isDirectory()).map((entry) => entry.name);
}

async function main() {
  const appImage = process.argv[2];
  if (!appImage) {
    console.error('usage: verify-appimage-bundle.mjs <path-to-.AppImage>');
    process.exit(2);
  }

  // `--appimage-extract` is handled by the AppImage runtime itself and needs no
  // FUSE, which the runner does not have. It always writes ./squashfs-root, so
  // it runs in a temp directory rather than the checkout.
  const workDir = mkdtempSync(path.join(tmpdir(), 'ori-appimage-'));
  try {
    chmodSync(appImage, 0o755);
    execFileSync(path.resolve(appImage), ['--appimage-extract'], {
      cwd: workDir,
      stdio: 'pipe',
    });

    const files = await listFiles(path.join(workDir, 'squashfs-root'));
    const problems = verifyAppImageBundle(files);

    if (problems.length > 0) {
      console.error(`${path.basename(appImage)} is not shippable:`);
      for (const problem of problems) console.error(`  - ${problem}`);
      console.error('\nSee implementation-plans/appimage-host-glib.md.');
      process.exit(1);
    }

    console.log(
      `${path.basename(appImage)}: ${files.length} files, no bundled GLib, GTK and WebKit present`
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await main();
}
