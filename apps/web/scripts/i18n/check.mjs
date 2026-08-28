#!/usr/bin/env node
// CI gate for translations (no network / no LLM). Fails when:
//   1. the committed English catalog does not match the inline `t()` defaults in source
//      (run `npm run i18n:extract`);
//   2. a target locale is missing a key or has an empty value (untranslated);
//   3. a target translation is stale — the English wording changed since it was stamped
//      (re-translate, then `npm run i18n:stamp`);
//   4. a Rust/WASM user-facing error code has no `errors:<code>` catalog entry;
//   5. a target translation drops or invents a `{{placeholder}}` or a `<Trans>` `<N>` tag.
//
// Prints a per-locale, per-namespace gap list so the translation agent has a worklist.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  WEB_ROOT,
  ERROR_CODES_FILE,
  SOURCE_LOCALE,
  TARGET_LOCALES,
  NAMESPACES,
  PARSER_NAMESPACES,
  readEnglishKeys,
  readCatalog,
  flatten,
  readHashes,
  shortHash,
  assertInSync,
} from './_shared.mjs';

assertInSync();

const problems = [];

// 1. English catalog matches source ------------------------------------------------------
const tmp = mkdtempSync(join(tmpdir(), 'i18n-check-'));
try {
  const res = spawnSync('npx', ['i18next', '-c', 'i18next-parser.config.js'], {
    cwd: WEB_ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, I18N_OUTPUT_DIR: tmp },
  });
  if (res.status !== 0) {
    console.error('i18next-parser failed to run.');
    process.exit(res.status ?? 1);
  }
  for (const ns of PARSER_NAMESPACES) {
    const freshFile = join(tmp, SOURCE_LOCALE, `${ns}.json`);
    const fresh = existsSync(freshFile) ? JSON.parse(readFileSync(freshFile, 'utf8')) : {};
    const committed = readCatalog(SOURCE_LOCALE, ns);
    if (JSON.stringify(fresh) !== JSON.stringify(committed)) {
      problems.push(`[en:${ns}] out of date with source — run \`npm run i18n:extract\``);
    }
  }
  // The generated cpVocab English catalog is verified separately by cpVocab.gen.test.ts.
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// 2 & 3. Target parity + staleness -------------------------------------------------------
const english = readEnglishKeys();
const hashes = readHashes();
const gaps = {}; // locale -> { missing: [], stale: [] }

// CLDR plural suffixes i18next appends per key+locale. A key's plural forms differ by
// locale (en: one/other; ja/zh/ko: other only; ru: one/few/many/other), so an English
// `_one` key legitimately has no counterpart in a single-category locale — treat the plural
// family as satisfied if the target has ANY non-empty form of the same base key.
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
function pluralFamilySatisfied(flatNs, key) {
  const base = key.replace(PLURAL_SUFFIX, '');
  return Object.entries(flatNs).some(
    ([k, v]) => (k === base || k.startsWith(`${base}_`)) && v !== '' && v !== undefined
  );
}

// A translation must interpolate exactly what its English source does. Dropping a `{{name}}`
// silently loses information at runtime, and dropping or inventing a `<Trans>` `<N>` tag breaks the
// render (an invented one shows literally; a dropped one loses the link it wrapped).
//
// The one legal addition is `{{count}}` on a plural-suffixed key: i18next always passes `count` to
// a pluralized key, so a locale may use the number even where English spells it out — `"This
// changes 1 shortcut."` is translated as `"Esto cambia {{count}} atajos."` in every Latin locale.
const PLACEHOLDER = /\{\{\s*([^}]*?)\s*\}\}/g;
const TRANS_TAG = /<\/?\d+>/g;

/** Describe how `translated` interpolates differently from `en`, or '' when they agree. */
function interpolationMismatch(key, en, translated) {
  const names = (s) => new Set([...s.matchAll(PLACEHOLDER)].map((m) => m[1]));
  const enNames = names(en);
  const trNames = names(translated);
  const allowed = new Set(enNames);
  if (PLURAL_SUFFIX.test(key)) allowed.add('count');

  const dropped = [...enNames].filter((n) => !trNames.has(n));
  const invented = [...trNames].filter((n) => !allowed.has(n));

  // Tags compare as a multiset: a duplicated `<2>` is as broken as a missing one.
  const tags = (s) => (s.match(TRANS_TAG) ?? []).sort();
  const enTags = tags(en);
  const trTags = tags(translated);

  const notes = [];
  if (dropped.length) notes.push(`drops {{${dropped.join('}}, {{')}}}`);
  if (invented.length) notes.push(`invents {{${invented.join('}}, {{')}}}`);
  if (enTags.join() !== trTags.join())
    notes.push(`tags [${enTags.join(' ')}] became [${trTags.join(' ')}]`);
  return notes.join('; ');
}

for (const locale of TARGET_LOCALES) {
  const bucket = hashes[locale] ?? {};
  const flatByNs = Object.fromEntries(NAMESPACES.map((ns) => [ns, flatten(readCatalog(locale, ns))]));
  const missing = [];
  const stale = [];
  const broken = [];
  for (const [id, enValue] of Object.entries(english)) {
    const [ns, ...rest] = id.split(':');
    const key = rest.join(':');
    const value = flatByNs[ns]?.[key];
    if (value === undefined || value === '') {
      // A plural-form English key may map to different plural categories in this locale;
      // don't flag it if the locale has the base key's plural family filled.
      if (PLURAL_SUFFIX.test(key) && pluralFamilySatisfied(flatByNs[ns] ?? {}, key)) continue;
      missing.push(id);
    } else {
      // Staleness and interpolation are independent: a correctly-stamped translation can still
      // have lost a placeholder, so check both rather than making these mutually exclusive.
      if (bucket[id] !== shortHash(enValue)) stale.push(id);
      const problem = interpolationMismatch(key, enValue, value);
      if (problem) broken.push([id, problem, value]);
    }
  }
  // Also flag any of this locale's OWN plural forms that were left empty.
  for (const ns of NAMESPACES) {
    for (const [key, value] of Object.entries(flatByNs[ns] ?? {})) {
      if (PLURAL_SUFFIX.test(key) && value === '') missing.push(`${ns}:${key}`);
    }
  }
  if (missing.length || stale.length || broken.length) gaps[locale] = { missing, stale, broken };
}

// 4. WASM error-code coverage ------------------------------------------------------------
if (existsSync(ERROR_CODES_FILE)) {
  const codes = JSON.parse(readFileSync(ERROR_CODES_FILE, 'utf8'));
  const errorsCatalog = flatten(readCatalog(SOURCE_LOCALE, 'errors'));
  for (const code of codes) {
    if (errorsCatalog[code] === undefined) {
      problems.push(`[errors] Rust error code '${code}' has no \`errors:${code}\` catalog entry`);
    }
  }
}

// Report ---------------------------------------------------------------------------------
const totalGaps = Object.values(gaps).reduce(
  (n, g) => n + g.missing.length + g.stale.length + g.broken.length,
  0
);
if (totalGaps) {
  console.error(`\nTranslation gaps (${totalGaps}):`);
  for (const [locale, g] of Object.entries(gaps)) {
    console.error(
      `  ${locale}: ${g.missing.length} missing, ${g.stale.length} stale, ${g.broken.length} broken`
    );
    for (const id of g.missing) console.error(`    missing  ${id}  ("${english[id]}")`);
    for (const id of g.stale) console.error(`    stale    ${id}  ("${english[id]}")`);
    for (const [id, problem, value] of g.broken) {
      console.error(`    broken   ${id}  ${problem}`);
      console.error(`               en: "${english[id]}"`);
      console.error(`               ${locale}: "${value}"`);
    }
  }
}
for (const p of problems) console.error(p);

if (problems.length || totalGaps) {
  console.error(`\ni18n:check failed (${problems.length} structural, ${totalGaps} translation gaps).`);
  process.exit(1);
}
console.log('i18n:check passed.');
