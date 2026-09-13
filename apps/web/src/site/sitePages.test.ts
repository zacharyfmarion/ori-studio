import { describe, expect, it } from 'vitest';
import { DESIGN_PATH, EDIT_PATH, SIMULATE_PATH, WELCOME_PATH } from '../routing/paths';
import { SITE_TITLE } from '../seo/siteMeta';
import {
  CONTENT_PAGES,
  LANDING_PAGE,
  routeSegment,
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
    expect(LANDING_PAGE.title).toBe(SITE_TITLE);
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

  it('keeps every title short enough for a result to print it whole', () => {
    // Google gives a title roughly 600px, near enough 60 characters. The landing's first
    // title ran to 76 and was cut mid-phrase every time it displayed.
    for (const page of SITE_PAGES) {
      expect(page.title.length, page.id).toBeLessThanOrEqual(60);
    }
  });

  it('gives every page a description a result can print', () => {
    for (const page of SITE_PAGES) {
      expect(page.description.length, page.id).toBeGreaterThan(50);
      expect(page.description.length, page.id).toBeLessThanOrEqual(320);
    }
  });

  it('puts every page, and only pages, in the sitemap', () => {
    expect(SITEMAP_PATHS).toEqual(SITE_PAGES.map((page) => page.path));
    expect(SITEMAP_PATHS).toContain('/');
    expect(SITEMAP_PATHS).not.toContain(WELCOME_PATH);
  });
});

describe('routeSegment', () => {
  it('strips both slashes for the router', () => {
    expect(routeSegment({ ...LANDING_PAGE, path: '/download/' })).toBe('download');
  });
});

/**
 * What separates a site page from a document, which is what decides whether the tab
 * is titled for the page or for the open project. Getting this wrong is not a cosmetic
 * bug — the title the app renders is the one Google indexes, so a `/welcome` that answers
 * `null` here shows up in the result as "Untitled".
 */
describe('sitePageForPath', () => {
  it('answers the landing for both paths that hold it', () => {
    expect(sitePageForPath('/')).toBe(LANDING_PAGE);
    expect(sitePageForPath(WELCOME_PATH)).toBe(LANDING_PAGE);
  });

  it('answers a content page with or without its trailing slash', () => {
    // The deploy answers with the slash and react-router reports it verbatim; a
    // client-side navigation may well arrive without it.
    for (const page of CONTENT_PAGES) {
      expect(sitePageForPath(page.path)).toBe(page);
      expect(sitePageForPath(page.path.replace(/\/$/, ''))).toBe(page);
    }
  });

  it('matches the trailing-slash form the deploy redirects the landing alias to', () => {
    expect(sitePageForPath('/welcome/')).toBe(LANDING_PAGE);
  });

  it('answers null for a workspace, which has a document to be named after', () => {
    expect(sitePageForPath(EDIT_PATH)).toBeNull();
    expect(sitePageForPath(DESIGN_PATH)).toBeNull();
    expect(sitePageForPath(SIMULATE_PATH)).toBeNull();
  });

  it('does not match a path that merely starts with one', () => {
    expect(sitePageForPath('/welcome-back')).toBeNull();
    expect(sitePageForPath('/download-old/')).toBeNull();
  });
});
