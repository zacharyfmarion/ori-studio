import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCpVocabCatalog } from './cpVocab';

// English source of truth for the CP tool vocabulary is lib/oristudioCpActions.ts. This
// test regenerates public/locales/en/cpVocab.json from it and asserts the committed file is
// in sync. Run `npm run i18n:extract` (which sets I18N_WRITE=1) to regenerate after changing
// the data module; CI runs it read-only so a drift fails the build.
const CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'public',
  'locales',
  'en',
  'cpVocab.json',
);

describe('cpVocab English catalog', () => {
  it('is in sync with lib/oristudioCpActions.ts', () => {
    const catalog = buildCpVocabCatalog();
    const serialized = JSON.stringify(catalog, null, 2) + '\n';

    if (process.env.I18N_WRITE) {
      writeFileSync(CATALOG_PATH, serialized);
      return;
    }

    const committed = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
    expect(catalog).toEqual(committed);
  });
});
