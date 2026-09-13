import { WELCOME_PATH } from '../routing/paths';
import { SITE_DESCRIPTION, SITE_TITLE } from '../seo/siteMeta';

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
export type ContentPageId = 'download';
export type SitePageId = 'landing' | ContentPageId;

export interface SitePage<Id extends SitePageId = SitePageId> {
  id: Id;
  /**
   * The public path, and the form every link, the canonical and the sitemap use.
   *
   * `/` for the landing. Every other page ends in a slash, because that is the URL the host
   * actually answers with: the prerender writes `dist/<name>/index.html`, and Pages 308s
   * `/<name>` to `/<name>/` for a directory index. A canonical that names the redirecting
   * form points a crawler at a URL that does not itself return 200.
   */
  path: string;
  /**
   * The `<title>`, and the subject of the page's `<h1>`.
   *
   * English, and a constant rather than a `t()` call, on purpose — the same reasoning as
   * `SITE_TITLE`. The prerender writes this into the HTML; a localized runtime title would
   * mean the app writes a *different* string over it after boot, which is the shape of the
   * bug that had the landing indexed as "Untitled". Keep it under 60 characters, or a
   * result cuts it mid-phrase (there is a test).
   */
  title: string;
  /** The `<meta name="description">`, and the card description. English, as above. */
  description: string;
}

export const LANDING_PAGE: SitePage<'landing'> = {
  id: 'landing',
  path: '/',
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
};

/** The pages with a route of their own — every page but the landing, in nav order. */
export const CONTENT_PAGES: readonly SitePage<ContentPageId>[] = [
  {
    id: 'download',
    path: '/download/',
    title: 'Download Ori Studio for macOS, Windows and Linux',
    description:
      'Get the Ori Studio desktop app for macOS, Windows and Linux — the same free, ' +
      'open-source origami workspace as the browser version, with native menus, file ' +
      'dialogs and updates. Or open it in your browser with nothing to install.',
  },
];

export const SITE_PAGES: readonly SitePage[] = [LANDING_PAGE, ...CONTENT_PAGES];

/**
 * Every path worth putting in front of a crawler.
 *
 * Derived, not written: a page listed above is in the sitemap, and one that is not, is
 * not. `/welcome` is deliberately absent — it holds the landing and canonicalises to `/`.
 */
export const SITEMAP_PATHS: readonly string[] = SITE_PAGES.map((page) => page.path);

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

/**
 * The page a pathname shows, or `null` for an app route.
 *
 * `/welcome` answers with the landing: it is the same page at a second address, and the
 * title it should carry is the landing's, not a blank document's.
 */
export function sitePageForPath(pathname: string): SitePage | null {
  const path = withoutTrailingSlash(pathname);
  if (path === '/' || path === WELCOME_PATH) return LANDING_PAGE;
  return SITE_PAGES.find((page) => withoutTrailingSlash(page.path) === path) ?? null;
}
