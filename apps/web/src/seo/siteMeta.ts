/**
 * One place that knows the site's public identity.
 *
 * The origin used to be written down in four files — `index.html`, `robots.txt`,
 * `sitemap.xml` and `scripts/seo-smoke.mjs` — with nothing making them agree. The smoke
 * test pinned all four at deploy time, which caught drift but caught it late, and only
 * once something had already shipped. The prerender now generates the first three from
 * here, so the smoke test confirms a single source instead of standing in for one.
 *
 * No browser dependencies: this is imported by React components, by the prerender entry
 * running under Node, and by the build script.
 */

/** Scheme + host, no trailing slash. Everything absolute is built from this. */
export const SITE_ORIGIN = 'https://oristudio.dev';

export const SITE_NAME = 'Ori Studio';

/**
 * The `<title>`, and the `<h1>` the prerender puts above the landing.
 *
 * Written for the query rather than the brand, deliberately. "Ori Studio" alone competes
 * with two commercial design studios of the same name that hold `oristudio.app` and
 * `ori.studio`; naming the category is what separates this from them in a result set
 * containing all three. See `implementation-plans/seo-discoverability.md`.
 */
export const SITE_TITLE =
  'Ori Studio — free online origami crease pattern editor and folding simulator';

export const SITE_DESCRIPTION =
  'Ori Studio is a free, open-source workspace for origami design: draw and edit crease ' +
  'patterns, design from a tree structure or a box-pleating grid, and fold the result in ' +
  'the simulator. Runs in your browser, or as a desktop app for macOS, Windows and Linux.';

/** The social card. 1200×630 is what every platform asks for. */
export const SITE_OG_IMAGE = `${SITE_ORIGIN}/og-default.png`;

/**
 * Every path worth putting in front of a crawler.
 *
 * One entry, on purpose. `/welcome` holds the same content and canonicalises to `/`, and
 * the workspace routes are an app shell with nothing to rank. Localised variants would be
 * added here (Phase 6) rather than in a hand-maintained XML file.
 */
export const SITEMAP_PATHS = ['/'] as const;

/** Absolute URL for a site-relative path. */
export function siteUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}

/**
 * The id of the node the prerender writes its markup into, and that `main.tsx` removes
 * before React mounts.
 *
 * It lives here, in the one module with no dependencies, because both ends need it: the
 * prerender entry pulls in `react-dom/server` and its own i18next instance, and importing
 * *that* from `main.tsx` would ship a server renderer to every browser. A drift between
 * the two ends fails silently in the worst way available — the app boots with the crawler
 * copy still on the page, underneath the real one.
 */
export const SEO_CONTENT_ID = 'seo-content';
