#!/usr/bin/env node
/**
 * Tauri's `beforeBuildCommand`.
 *
 * Normally this just runs the web build. In CI it can be told to reuse a bundle
 * that was already built: the web output is platform-independent, so the release
 * workflow builds it once on Linux and hands the same `dist` to all four native
 * jobs. Rebuilding it on a macOS runner to produce identical bytes is the most
 * expensive minute in the pipeline, and it would also mean four chances for the
 * four platforms to disagree about what they shipped.
 *
 * `ORI_PREBUILT_FRONTEND=1` opts into that. The existence check is not optional:
 * without it, a download-artifact step that silently produced nothing would ship
 * an installer containing an app with no frontend, and every other check in the
 * pipeline would pass.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distIndex = join(repoRoot, 'apps/web/dist/index.html');

if (process.env.ORI_PREBUILT_FRONTEND === '1') {
  if (!existsSync(distIndex)) {
    console.error(
      'ORI_PREBUILT_FRONTEND=1 but apps/web/dist/index.html is missing.\n' +
        'The prebuilt web bundle was not restored — refusing to bundle an app with no frontend.',
    );
    process.exit(1);
  }
  console.log('ORI_PREBUILT_FRONTEND=1 — reusing apps/web/dist');
  process.exit(0);
}

const result = spawnSync('npm', ['run', 'build'], {
  cwd: join(repoRoot, 'apps/web'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  console.error(`failed to run the web build: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
