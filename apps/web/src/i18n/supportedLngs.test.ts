import { describe, expect, it } from 'vitest';
import i18n from './index';
import { SUPPORTED_LOCALE_CODES } from './locales';

/**
 * Every supported locale resolves to itself. `zh-CN` and `pt-BR` did not for a year: with
 * `nonExplicitSupportedLngs: true`, i18next compared only `zh` against a list holding
 * `zh-CN`, rejected it, and resolved Chinese and Brazilian Portuguese to English — an
 * English app under `<html lang="zh-CN">`. The other six locales carry no region and never
 * hit it, so a full translation pass and a visual sweep in Japanese both looked fine.
 *
 * `languageUtils` exists from the synchronous half of `init`, so this needs no catalog
 * to load and holds under jsdom.
 */
describe('supported locales', () => {
  it.each(SUPPORTED_LOCALE_CODES)('resolves %s to itself, not to the fallback', (code) => {
    const hierarchy = (
      i18n.services.languageUtils as { toResolveHierarchy: (code: string) => string[] }
    ).toResolveHierarchy(code);
    expect(hierarchy[0]).toBe(code);
  });
});
