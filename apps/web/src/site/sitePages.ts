import { DEFAULT_LOCALE, SUPPORTED_LOCALE_CODES } from '../i18n/locales';
import { WELCOME_PATH } from '../routing/paths';

/**
 * Every page of the site, as opposed to the app.
 *
 * "Site" is the landing plus the content pages beside it — download, getting started, the
 * pages a crawler can index and a search result can link to. The app is the workspaces,
 * which serve the same `index.html` under `canonical → /` and are not pages in this sense.
 *
 * One list, and everything reads from it: the router builds the content routes from it,
 * the prerender writes one HTML file per entry, the sitemap is generated from it, the nav
 * links every entry, and the window title looks the current path up in it. That is the
 * point of its existence. A page has four ways to be half-added — a file with no route
 * behind it, a route with no crawler copy, a copy carrying the homepage's canonical, a
 * title the app overwrites the moment it boots — and each of them ships a 200 that says
 * nothing. Listing a page here closes all four at once.
 *
 * Data only, no components, so the nav and the title hook can import it without dragging
 * every page's markup and stylesheet along. The components are keyed by id in
 * `sitePageContent.tsx`, and the `Record` type there is what refuses an entry with no page
 * behind it.
 */
export type ContentPageId = 'getting-started' | 'download' | 'oriedita' | 'faq';
export type SitePageId = 'landing' | ContentPageId;

export interface SitePage<Id extends SitePageId = SitePageId> {
  id: Id;
  /**
   * The public path in English, and the form every link, the canonical and the sitemap
   * use — see {@link pagePath} for the other locales.
   *
   * `/` for the landing. Every other page ends in a slash, because that is the URL the host
   * actually answers with: the prerender writes `dist/<name>/index.html`, and Pages 308s
   * `/<name>` to `/<name>/` for a directory index. A canonical that names the redirecting
   * form points a crawler at a URL that does not itself return 200.
   *
   * The title and description are not here. They are `t()` calls in `sitePageLabels.ts`,
   * because a page exists once per locale and each one's `<title>` is in its own language.
   * That is safe *because* the locale is in the URL: the runtime title on `/zh-CN/download/`
   * and the prerendered `<title>` there come from the same key with the same catalog loaded,
   * so the app never writes a different string over what the crawler read.
   */
  path: string;
}

export const LANDING_PAGE: SitePage<'landing'> = { id: 'landing', path: '/' };

/** The pages with a route of their own — every page but the landing, in nav order. */
export const CONTENT_PAGES: readonly SitePage<ContentPageId>[] = [
  { id: 'getting-started', path: '/getting-started/' },
  { id: 'download', path: '/download/' },
  { id: 'oriedita', path: '/oriedita/' },
  { id: 'faq', path: '/faq/' },
];

export const SITE_PAGES: readonly SitePage[] = [LANDING_PAGE, ...CONTENT_PAGES];

/**
 * The locales a site page exists in besides English: every one the app ships.
 *
 * Every one, not a chosen few, because the machinery is a list and the app already shows
 * each of these catalogs to its users — a localized page is those same strings on a URL.
 * The case that made this matter is China: nearly half the audience is there, search
 * there is Baidu, Baidu reads the raw HTML and nothing else, and the raw HTML was English.
 */
export const SITE_LOCALES: readonly string[] = SUPPORTED_LOCALE_CODES.filter(
  (code) => code !== DEFAULT_LOCALE
);

/** Every locale a page is served in, English first. */
export const PAGE_LOCALES: readonly string[] = [DEFAULT_LOCALE, ...SITE_LOCALES];

/**
 * A page's public path in a locale: `/download/` in English, `/zh-CN/download/` in Chinese.
 *
 * A prefix on site pages only, in the app's own locale codes verbatim — `zh-CN` and
 * `pt-BR` keep their region, which tells Baidu *simplified* and a Brazilian reader that
 * this one is theirs. The app routes take no prefix: nothing indexes them, and forcing
 * their UI language from the URL would regress every Chinese user who lands on `/edit`
 * from a link.
 */
export function pagePath(page: SitePage, locale: string = DEFAULT_LOCALE): string {
  return locale === DEFAULT_LOCALE ? page.path : `/${locale}${page.path}`;
}

/**
 * Every URL worth putting in front of a crawler: each page, in each locale.
 *
 * Derived, not written: a page listed above is in the sitemap in every locale, and one
 * that is not, is not. `/welcome` is deliberately absent — it holds the landing and
 * canonicalises to `/`.
 */
export const SITEMAP_PATHS: readonly string[] = PAGE_LOCALES.flatMap((locale) =>
  SITE_PAGES.map((page) => pagePath(page, locale))
);

/**
 * The `og:locale` form of a locale code — `ll_CC`, which is what the OpenGraph vocabulary
 * asks for and what a share on WeChat or Facebook reads.
 */
export function ogLocale(locale: string): string {
  const [language, region] = locale.split('-');
  if (region) return `${language}_${region}`;
  const defaultRegion: Record<string, string> = {
    en: 'US',
    ja: 'JP',
    es: 'ES',
    fr: 'FR',
    de: 'DE',
    ru: 'RU',
    ko: 'KR',
  };
  return `${language}_${defaultRegion[language] ?? language.toUpperCase()}`;
}

/**
 * The react-router `path` for a content page: `/download/` → `download`.
 *
 * Both slashes go. The router's matching already ignores a trailing slash, so the
 * segment form is what its route table wants, and the leading one would make the route
 * absolute inside a nested table.
 */
export function routeSegment(page: SitePage): string {
  return page.path.replace(/^\/+|\/+$/g, '');
}

/**
 * Strip a trailing slash so `/download/` and `/download` are the same path.
 *
 * Not hypothetical: `/download/` is what the deploy answers with (see {@link SitePage.path})
 * and react-router reports the pathname verbatim, while a client-side navigation may well
 * arrive without it.
 */
function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
}

/** A pathname resolved to the page it shows and the language it shows it in. */
export interface SitePageMatch {
  page: SitePage;
  locale: string;
}

/**
 * The page a pathname shows, and in which locale — or `null` for an app route.
 *
 * `/welcome` answers with the English landing: it is the same page at a second address,
 * and the title it should carry is the landing's, not a blank document's. A leading
 * segment that is one of {@link SITE_LOCALES} is the locale and is stripped before the
 * page is matched, so `/zh-CN/download/` is the download page in Chinese and `/zh-CN/`
 * is the landing in Chinese. Anything else in that position is not a locale — `/download`
 * is a page, `/edit` is not — and reads as English.
 */
export function sitePageForPath(pathname: string): SitePageMatch | null {
  const path = withoutTrailingSlash(pathname);
  const [, first = '', ...rest] = path.split('/');
  const locale = SITE_LOCALES.includes(first) ? first : DEFAULT_LOCALE;
  const remainder = locale === DEFAULT_LOCALE ? path : `/${rest.join('/')}`;
  if (remainder === '/' || remainder === WELCOME_PATH) return { page: LANDING_PAGE, locale };
  const page = SITE_PAGES.find((candidate) => withoutTrailingSlash(candidate.path) === remainder);
  return page ? { page, locale } : null;
}
