import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import { SITE_DESCRIPTION, SITE_TITLE } from '../seo/siteMeta';
import { loadLocaleResources } from '../seo/prerenderEntry';
import { sitePageDescription, sitePageTitle } from './sitePageLabels';
import { PAGE_LOCALES, SITE_PAGES } from './sitePages';

/** A `t` for one locale, from the catalogs on disk — English from the inline defaults. */
function tFor(locale: string) {
  const instance = createInstance();
  void instance.init({
    lng: locale,
    fallbackLng: 'en',
    resources: locale === 'en' ? {} : loadLocaleResources(locale),
    returnEmptyString: false,
    initImmediate: false,
  });
  return instance.t.bind(instance);
}

describe('site page titles and descriptions', () => {
  /**
   * `index.html` carries the English landing title and description as literal markup —
   * it is Vite's entry, read before any of our code runs — and `siteMeta.ts` holds the
   * same two strings as constants for it and for the share Worker. The runtime and the
   * prerender now read them through `t()`, so the copies can drift, and this is what
   * says they have not. A drift here is the "Untitled" bug in a new coat: a crawler
   * watching the title change under it.
   */
  it('keeps the English landing title and description equal to the siteMeta constants', () => {
    const t = tFor('en');
    expect(sitePageTitle(t, 'landing')).toBe(SITE_TITLE);
    expect(sitePageDescription(t, 'landing')).toBe(SITE_DESCRIPTION);
  });

  it.each(PAGE_LOCALES)('keeps every title in %s short enough for a result to print whole', (locale) => {
    // Google gives a title roughly 600px, near enough 60 Latin characters — CJK is wider
    // per character and lands well under that in count anyway.
    const t = tFor(locale);
    for (const page of SITE_PAGES) {
      const title = sitePageTitle(t, page.id);
      expect(title.length, `${locale} ${page.id}`).toBeLessThanOrEqual(60);
      expect(title, `${locale} ${page.id}`).toContain('Ori Studio');
    }
  });

  it.each(PAGE_LOCALES)('gives every page in %s a description a result can print', (locale) => {
    const t = tFor(locale);
    for (const page of SITE_PAGES) {
      const description = sitePageDescription(t, page.id);
      expect(description.length, `${locale} ${page.id}`).toBeGreaterThan(50);
      expect(description.length, `${locale} ${page.id}`).toBeLessThanOrEqual(320);
    }
  });

  it('actually translates: no locale falls back to the English title', () => {
    const english = tFor('en');
    for (const locale of PAGE_LOCALES.filter((code) => code !== 'en')) {
      const t = tFor(locale);
      for (const page of SITE_PAGES) {
        expect(sitePageTitle(t, page.id), `${locale} ${page.id}`).not.toBe(sitePageTitle(english, page.id));
      }
    }
  });
});
