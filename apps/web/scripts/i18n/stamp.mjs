#!/usr/bin/env node
// Stamp the current English-source hash for every non-empty target translation.
//
// Run this immediately after translating a surface: it records "this translation matches
// the English wording as of now" so `i18n:check` can later detect when the English source
// changes out from under a translation (staleness). Do NOT run it to silence a stale
// warning you have not actually re-translated.

import { writeFileSync } from 'node:fs';
import {
  HASHES_FILE,
  TARGET_LOCALES,
  NAMESPACES,
  readEnglishKeys,
  readCatalog,
  flatten,
  readHashes,
  shortHash,
  assertInSync,
} from './_shared.mjs';

assertInSync();

const english = readEnglishKeys();
const hashes = readHashes();

let stamped = 0;
for (const locale of TARGET_LOCALES) {
  const bucket = (hashes[locale] ??= {});
  for (const ns of NAMESPACES) {
    const flat = flatten(readCatalog(locale, ns));
    for (const [key, value] of Object.entries(flat)) {
      const id = `${ns}:${key}`;
      if (value !== '' && english[id] !== undefined) {
        const h = shortHash(english[id]);
        if (bucket[id] !== h) {
          bucket[id] = h;
          stamped++;
        }
      }
    }
  }
  // Drop hashes for keys that no longer have a translation.
  for (const id of Object.keys(bucket)) {
    const [ns, ...rest] = id.split(':');
    const flat = flatten(readCatalog(locale, ns));
    if (flat[rest.join(':')] === undefined || flat[rest.join(':')] === '') delete bucket[id];
  }
}

writeFileSync(HASHES_FILE, JSON.stringify(hashes, null, 2) + '\n');
console.log(`i18n:stamp complete (${stamped} hashes updated).`);
