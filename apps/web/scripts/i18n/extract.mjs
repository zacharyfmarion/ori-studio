#!/usr/bin/env node
// Regenerate the English catalogs from inline `t()` defaults, then ensure every namespace
// file exists (as `{}` if empty) for every locale so the http backend never 404s.
//
// English is rewritten from source each run; target-locale translations are preserved and
// only gain empty slots for new keys.

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { WEB_ROOT, LOCALES_DIR, LOCALES, NAMESPACES, SOURCE_LOCALE, assertInSync } from './_shared.mjs';

assertInSync();

// Delete the English catalogs so the parser rebuilds them purely from the inline defaults
// (English is a generated artifact and must always match source). Target locales are left
// in place so their translations are preserved.
for (const ns of NAMESPACES) {
  rmSync(join(LOCALES_DIR, SOURCE_LOCALE, `${ns}.json`), { force: true });
}

const result = spawnSync(
  'npx',
  ['i18next', '-c', 'i18next-parser.config.js'],
  { cwd: WEB_ROOT, stdio: 'inherit', env: process.env }
);
if (result.status !== 0) process.exit(result.status ?? 1);

// Seed empty namespace files the parser did not create (namespaces with no keys yet).
for (const locale of LOCALES) {
  const dir = join(LOCALES_DIR, locale);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const ns of NAMESPACES) {
    const file = join(dir, `${ns}.json`);
    if (!existsSync(file)) writeFileSync(file, '{}\n');
  }
}

console.log('i18n:extract complete.');
