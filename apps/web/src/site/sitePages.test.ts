import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALE_CODES } from '../i18n/locales';
import { DESIGN_PATH, EDIT_PATH, SIMULATE_PATH, WELCOME_PATH } from '../routing/paths';
import {
  CONTENT_PAGES,
  LANDING_PAGE,
  ogLocale,
  PAGE_LOCALES,
  pagePath,
  routeSegment,
  SITE_LOCALES,
  SITE_PAGES,
  SITEMAP_PATHS,
  sitePageForPath,
} from './sitePages';

/**
 * The registry is the one place a page is declared, so the invariants every consumer
 * relies on are asserted here, once, rather than discovered by each of them.
 */
describe('SITE_PAGES', () => {
  it('leads with the landing at the root', () => {
    expect(SITE_PAGES[0]).toBe(LANDING_PAGE);
    expect(LANDING_PAGE.path).toBe('/');
  });

  it('gives every page a distinct path', () => {
    const paths = SITE_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every page a distinct id', () => {
    const ids = SITE_PAGES.map((page) => page.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('writes every content path in the form the host answers with', () => {
    // The prerender writes `dist/<name>/index.html`, and Pages 308s `/<name>` to
    // `/<name>/` for a directory index — so the slash-terminated form is the URL that
    // returns 200, and the one a canonical, a sitemap and every link must name.
    for (const page of CONTENT_PAGES) {
      expect(page.path).toMatch(/^\/[a-z0-9-]+\/$/);
    }
  });
});

describe('SITE_LOCALES', () => {
  it('is every locale the app ships, except English', () => {
    // Every one, not a chosen few: the machinery is a list, and the app already shows each
    // of these catalogs to its users — a localized page is those strings on a URL.
    expect(SITE_LOCALES).toEqual(SUPPORTED_LOCALE_CODES.filter((code) => code !== DEFAULT_LOCALE));
    expect(SITE_LOCALES.length).toBe(8);
    expect(PAGE_LOCALES[0]).toBe(DEFAULT_LOCALE);
  });

  it('keeps the region in the code, so /zh-CN/ says simplified and /pt-BR/ says Brazil', () => {
    expect(SITE_LOCALES).toContain('zh-CN');
    expect(SITE_LOCALES).toContain('pt-BR');
  });
});

describe('pagePath', () => {
  it('leaves English unprefixed and prefixes every other locale', () => {
    expect(pagePath(LANDING_PAGE)).toBe('/');
    expect(pagePath(LANDING_PAGE, 'zh-CN')).toBe('/zh-CN/');
    const [download] = CONTENT_PAGES;
    expect(pagePath(download)).toBe('/download/');
    expect(pagePath(download, 'zh-CN')).toBe('/zh-CN/download/');
    expect(pagePath(download, 'pt-BR')).toBe('/pt-BR/download/');
  });

  it('puts every page in every locale in the sitemap, and nothing else', () => {
    expect(SITEMAP_PATHS).toHaveLength(PAGE_LOCALES.length * SITE_PAGES.length);
    expect(SITEMAP_PATHS).toContain('/');
    expect(SITEMAP_PATHS).toContain('/zh-CN/');
    expect(SITEMAP_PATHS).toContain('/ja/download/');
    expect(SITEMAP_PATHS).not.toContain(WELCOME_PATH);
    expect(new Set(SITEMAP_PATHS).size).toBe(SITEMAP_PATHS.length);
  });
});

describe('ogLocale', () => {
  it('writes the ll_CC form OpenGraph asks for', () => {
    expect(ogLocale('en')).toBe('en_US');
    expect(ogLocale('zh-CN')).toBe('zh_CN');
    expect(ogLocale('pt-BR')).toBe('pt_BR');
    expect(ogLocale('ja')).toBe('ja_JP');
  });
});

describe('routeSegment', () => {
  it('strips both slashes for the router', () => {
    expect(routeSegment({ ...LANDING_PAGE, path: '/download/' })).toBe('download');
  });
});

/**
 * What separates a site page from a document, which is what decides whether the tab
 * is titled for the page or for the open project — and, now, in which language. Getting
 * this wrong is not a cosmetic bug: the title the app renders is the one Google indexes,
 * so a `/welcome` that answers `null` here shows up in the result as "Untitled", and a
 * `/zh-CN/` that answers English shows up as English.
 */
describe('sitePageForPath', () => {
  it('answers the English landing for both paths that hold it', () => {
    expect(sitePageForPath('/')).toEqual({ page: LANDING_PAGE, locale: 'en' });
    expect(sitePageForPath(WELCOME_PATH)).toEqual({ page: LANDING_PAGE, locale: 'en' });
  });

  it('answers a content page with or without its trailing slash', () => {
    // The deploy answers with the slash and react-router reports it verbatim; a
    // client-side navigation may well arrive without it.
    for (const page of CONTENT_PAGES) {
      expect(sitePageForPath(page.path)).toEqual({ page, locale: 'en' });
      expect(sitePageForPath(page.path.replace(/\/$/, ''))).toEqual({ page, locale: 'en' });
    }
  });

  it('reads a leading locale, for every locale and every page, with or without the slash', () => {
    for (const locale of SITE_LOCALES) {
      for (const page of SITE_PAGES) {
        const path = pagePath(page, locale);
        expect(sitePageForPath(path), path).toEqual({ page, locale });
        expect(sitePageForPath(path.replace(/\/$/, '')), path).toEqual({ page, locale });
      }
    }
  });

  it('matches the trailing-slash form the deploy redirects the landing alias to', () => {
    expect(sitePageForPath('/welcome/')).toEqual({ page: LANDING_PAGE, locale: 'en' });
  });

  it('answers null for a workspace, which has a document to be named after', () => {
    expect(sitePageForPath(EDIT_PATH)).toBeNull();
    expect(sitePageForPath(DESIGN_PATH)).toBeNull();
    expect(sitePageForPath(SIMULATE_PATH)).toBeNull();
  });

  it('does not take a workspace under a locale, or an unknown locale, for a page', () => {
    expect(sitePageForPath('/zh-CN/edit')).toBeNull();
    expect(sitePageForPath('/xx/download/')).toBeNull();
    expect(sitePageForPath('/xx/')).toBeNull();
  });

  it('does not match a path that merely starts with one', () => {
    expect(sitePageForPath('/welcome-back')).toBeNull();
    expect(sitePageForPath('/download-old/')).toBeNull();
    expect(sitePageForPath('/zh-CN-old/')).toBeNull();
  });
});
