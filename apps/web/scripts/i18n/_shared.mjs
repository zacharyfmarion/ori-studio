// Shared helpers for the i18n tooling scripts.
//
// The locale + namespace lists must stay in sync with src/i18n/locales.ts. `assertInSync()`
// parses that file and fails loudly if they diverge, so there is nothing to hand-maintain.

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const WEB_ROOT = join(HERE, '..', '..');
export const LOCALES_DIR = join(WEB_ROOT, 'public', 'locales');
export const HASHES_FILE = join(LOCALES_DIR, '.hashes.json');
export const ERROR_CODES_FILE = join(WEB_ROOT, 'src', 'generated', 'error-codes.json');

export const SOURCE_LOCALE = 'en';
export const LOCALES = ['en', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ko'];
export const TARGET_LOCALES = LOCALES.filter((l) => l !== SOURCE_LOCALE);
export const NAMESPACES = ['common', 'menu', 'panels', 'dialogs', 'tools', 'toasts', 'errors'];

/** Fail if the hardcoded lists here drift from src/i18n/locales.ts. */
export function assertInSync() {
  const src = readFileSync(join(WEB_ROOT, 'src', 'i18n', 'locales.ts'), 'utf8');
  const codes = [...src.matchAll(/code:\s*'([^']+)'/g)].map((m) => m[1]);
  const ns = [...src.matchAll(/^\s*'([a-z]+)',?\s*$/gm)]
    .map((m) => m[1])
    .filter((n) => NAMESPACES.includes(n));
  const mismatch = [];
  if (codes.join(',') !== LOCALES.join(','))
    mismatch.push(`locales: locales.ts=[${codes}] vs scripts=[${LOCALES}]`);
  for (const n of NAMESPACES)
    if (!ns.includes(n)) mismatch.push(`namespace '${n}' missing from locales.ts`);
  if (mismatch.length) {
    console.error('i18n config out of sync with src/i18n/locales.ts:\n  ' + mismatch.join('\n  '));
    process.exit(1);
  }
}

export function shortHash(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex').slice(0, 12);
}

/** Read a locale namespace file, returning {} if absent. */
export function readCatalog(locale, ns) {
  const file = join(LOCALES_DIR, locale, `${ns}.json`);
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Flatten a nested catalog into { 'key.path': value } using '.' as separator. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** All English keys as { '<ns>:<key.path>': value }. */
export function readEnglishKeys() {
  const out = {};
  for (const ns of NAMESPACES) {
    const flat = flatten(readCatalog(SOURCE_LOCALE, ns));
    for (const [k, v] of Object.entries(flat)) out[`${ns}:${k}`] = v;
  }
  return out;
}

export function readHashes() {
  if (!existsSync(HASHES_FILE)) return {};
  return JSON.parse(readFileSync(HASHES_FILE, 'utf8'));
}

export function localeDirs() {
  if (!existsSync(LOCALES_DIR)) return [];
  return readdirSync(LOCALES_DIR).filter((d) => LOCALES.includes(d));
}
