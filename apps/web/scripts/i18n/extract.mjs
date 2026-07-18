#!/usr/bin/env node
// Regenerate the English catalogs, then ensure every namespace file exists (as `{}` if
// empty) for every locale so the http backend never 404s.
//
// Parser-managed namespaces are rebuilt from inline `t()` defaults; the generated `cpVocab`
// namespace is rebuilt from the CP tool data module (via the gen test in write mode).
// English is rewritten each run; target-locale translations are preserved and only gain
// empty slots for new keys.

import { spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  WEB_ROOT,
  LOCALES_DIR,
  LOCALES,
  NAMESPACES,
  PARSER_NAMESPACES,
  SOURCE_LOCALE,
  assertInSync,
} from './_shared.mjs';

assertInSync();

// Delete the English parser-managed catalogs so the parser rebuilds them purely from the
// inline defaults (English is a generated artifact and must always match source). Target
// locales are left in place so their translations are preserved.
for (const ns of PARSER_NAMESPACES) {
  rmSync(join(LOCALES_DIR, SOURCE_LOCALE, `${ns}.json`), { force: true });
}

const parser = spawnSync('npx', ['i18next', '-c', 'i18next-parser.config.js'], {
  cwd: WEB_ROOT,
  stdio: 'inherit',
  env: process.env,
});
if (parser.status !== 0) process.exit(parser.status ?? 1);

// Regenerate the generated `cpVocab` English catalog from the data module.
const gen = spawnSync('npx', ['vitest', 'run', 'src/i18n/cpVocab.gen.test.ts'], {
  cwd: WEB_ROOT,
  stdio: 'inherit',
  env: { ...process.env, I18N_WRITE: '1' },
});
if (gen.status !== 0) process.exit(gen.status ?? 1);

// Seed empty namespace files not otherwise created (namespaces with no keys yet).
for (const locale of LOCALES) {
  const dir = join(LOCALES_DIR, locale);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const ns of NAMESPACES) {
    const file = join(dir, `${ns}.json`);
    if (!existsSync(file)) writeFileSync(file, '{}\n');
  }
}

console.log('i18n:extract complete.');
