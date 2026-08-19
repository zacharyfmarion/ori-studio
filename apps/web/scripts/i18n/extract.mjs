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
  GENERATED_NAMESPACES,
  SOURCE_LOCALE,
  TARGET_LOCALES,
  readCatalog,
  assertInSync,
} from './_shared.mjs';

assertInSync();

// Mirror the English nested structure into a target: every English key exists (empty string
// when the target has no translation yet), existing translations are kept, and target-only
// keys are pruned. Used to seed target skeletons for GENERATED namespaces, which the parser
// does not manage.
function mirrorStructure(enNode, targetNode) {
  const out = {};
  for (const [key, value] of Object.entries(enNode)) {
    if (value && typeof value === 'object') {
      out[key] = mirrorStructure(value, (targetNode && targetNode[key]) || {});
    } else {
      out[key] = targetNode && typeof targetNode[key] === 'string' ? targetNode[key] : '';
    }
  }
  return out;
}

// Snapshot generated-namespace target translations BEFORE the parser runs. A generated
// namespace (cpVocab) has a stray inline `t('cpVocab:...')` literal, so i18next-parser treats
// it as parser-managed and — with keepRemoved:false — prunes each target down to that one
// key. We restore the full structure from this snapshot after regeneration.
const generatedSnapshots = Object.fromEntries(
  GENERATED_NAMESPACES.map((ns) => [
    ns,
    Object.fromEntries(TARGET_LOCALES.map((locale) => [locale, readCatalog(locale, ns)])),
  ]),
);

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

// Seed target skeletons for generated namespaces (the parser only produces their English
// catalog), so every locale mirrors the English key structure and translators have slots to
// fill. Existing translations are preserved.
for (const ns of GENERATED_NAMESPACES) {
  const enCatalog = readCatalog(SOURCE_LOCALE, ns);
  for (const locale of TARGET_LOCALES) {
    const dir = join(LOCALES_DIR, locale);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    // Mirror from the pre-parser snapshot, not the on-disk file (which the parser pruned).
    const seeded = mirrorStructure(enCatalog, generatedSnapshots[ns][locale]);
    writeFileSync(join(dir, `${ns}.json`), JSON.stringify(seeded, null, 2) + '\n');
  }
}

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
