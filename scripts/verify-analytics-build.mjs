#!/usr/bin/env node
/**
 * Build-time assertion that the PostHog config actually made it into the bundle.
 *
 * `initializePostHog` returns false — no init, no capture, no network request —
 * when either build-time var is missing, and that is deliberate: it is the
 * dev/prod firewall that keeps local and preview builds out of the production
 * project. The cost of that design is that a *production* build with a misnamed
 * or empty secret is indistinguishable from a correct one. It deploys green and
 * captures nothing, and the only symptom is a dashboard that stays empty.
 *
 * That is not hypothetical: the first prod deploy shipped with
 * `VITE_PUBLIC_POSTHOG_HOST:""` because the repo secret was named
 * `VITE_POSTHOG_HOST`. GitHub substitutes the empty string for a secret that
 * does not exist, Vite inlined it, and Rollup then dead-code-eliminated the
 * entire `client.init(...)` call as unreachable.
 *
 * So check the artifact, not the environment: reading `process.env` here would
 * only prove the workflow set something, not that Vite inlined it.
 *
 *   node scripts/verify-analytics-build.mjs apps/web/dist
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = process.argv[2];
if (!distDir) {
  console.error('usage: verify-analytics-build.mjs <dist-dir>');
  process.exit(2);
}

const assetsDir = path.join(distDir, 'assets');

let entries;
try {
  entries = await readdir(assetsDir);
} catch (error) {
  console.error(`Could not read ${assetsDir} — was the web app built? (${error.message})`);
  process.exit(1);
}

const scripts = entries.filter((name) => name.endsWith('.js'));
if (scripts.length === 0) {
  console.error(`No .js assets in ${assetsDir} — nothing to verify.`);
  process.exit(1);
}

/**
 * Vite inlines `import.meta.env` as an object literal, so the values land in the
 * bundle as `VITE_PUBLIC_POSTHOG_HOST:"https://..."`. An empty string is the
 * exact failure this guards against, so the pattern requires a non-empty value.
 */
const patterns = {
  VITE_PUBLIC_POSTHOG_KEY: /VITE_PUBLIC_POSTHOG_KEY:\s*"phc_[^"]+"/,
  VITE_PUBLIC_POSTHOG_HOST: /VITE_PUBLIC_POSTHOG_HOST:\s*"https:\/\/[^"]+"/,
};

const found = new Set();

for (const name of scripts) {
  const source = await readFile(path.join(assetsDir, name), 'utf8');
  for (const [key, pattern] of Object.entries(patterns)) {
    if (pattern.test(source)) found.add(key);
  }
  if (found.size === Object.keys(patterns).length) break;
}

const missing = Object.keys(patterns).filter((key) => !found.has(key));

if (missing.length > 0) {
  console.error('Analytics config missing from the built bundle:');
  for (const key of missing) console.error(`  - ${key} is absent or empty`);
  console.error(
    '\nPostHog will never initialize in this build. Check the `env:` block on the\n' +
      'build step in .github/workflows/deploy-web.yml, and that any secret it\n' +
      'references exists under exactly that name (a missing secret is silently empty).'
  );
  process.exit(1);
}

console.log('ok   PostHog key and host are inlined in the production bundle');
