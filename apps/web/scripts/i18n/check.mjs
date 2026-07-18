#!/usr/bin/env node
// CI gate for translations (no network / no LLM). Fails when:
//   1. the committed English catalog does not match the inline `t()` defaults in source
//      (run `npm run i18n:extract`);
//   2. a target locale is missing a key or has an empty value (untranslated);
//   3. a target translation is stale — the English wording changed since it was stamped
//      (re-translate, then `npm run i18n:stamp`);
//   4. a Rust/WASM user-facing error code has no `errors:<code>` catalog entry.
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

for (const locale of TARGET_LOCALES) {
  const bucket = hashes[locale] ?? {};
  const flatByNs = Object.fromEntries(NAMESPACES.map((ns) => [ns, flatten(readCatalog(locale, ns))]));
  const missing = [];
  const stale = [];
  for (const [id, enValue] of Object.entries(english)) {
    const [ns, ...rest] = id.split(':');
    const key = rest.join(':');
    const value = flatByNs[ns]?.[key];
    if (value === undefined || value === '') {
      missing.push(id);
    } else if (bucket[id] !== shortHash(enValue)) {
      stale.push(id);
    }
  }
  if (missing.length || stale.length) gaps[locale] = { missing, stale };
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
const totalGaps = Object.values(gaps).reduce((n, g) => n + g.missing.length + g.stale.length, 0);
if (totalGaps) {
  console.error(`\nTranslation gaps (${totalGaps}):`);
  for (const [locale, g] of Object.entries(gaps)) {
    console.error(`  ${locale}: ${g.missing.length} missing, ${g.stale.length} stale`);
    for (const id of g.missing) console.error(`    missing  ${id}  ("${english[id]}")`);
    for (const id of g.stale) console.error(`    stale    ${id}  ("${english[id]}")`);
  }
}
for (const p of problems) console.error(p);

if (problems.length || totalGaps) {
  console.error(`\ni18n:check failed (${problems.length} structural, ${totalGaps} translation gaps).`);
  process.exit(1);
}
console.log('i18n:check passed.');
