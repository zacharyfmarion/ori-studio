import { LANDING_PAGE, type SitePage } from '../site/sitePages';
import { setDocumentTitle, setLinkHref, setMetaTag, stripJsonLd, verbatim } from './htmlMeta';
import { sitePageJsonLdScript } from './jsonLd';
import { SEO_CONTENT_ID, siteUrl } from './siteMeta';

/**
 * Assembling one site page's HTML from the built `index.html`: the crawler copy of the
 * page, its structured data, and a `<head>` that describes *this* page.
 *
 * Pure string work, pulled out of `scripts/prerender-landing.mjs` so it can be tested
 * without a Vite server. The script does I/O; this decides what the bytes say — the same
 * split `cpShareHtml.ts` makes for the share route, and for the same reason: the failures
 * here are silent. A page carrying the homepage's canonical still deploys, still serves,
 * still 200s, and is simply never indexed as itself.
 */

const ROOT_ANCHOR = '<div id="root"></div>';

/**
 * Drop a block a previous run left behind, so injecting is idempotent.
 *
 * `vite build` empties `dist`, so the shipped path always starts clean — but running the
 * script directly is the obvious way to iterate on it without waiting on a wasm rebuild,
 * and doing that twice used to produce two copies of the landing page. Nothing downstream
 * would say so: the smoke test asserts the copy is *present*, never how often.
 */
function stripExistingContent(html: string): string {
  const start = html.indexOf(`<div id="${SEO_CONTENT_ID}">`);
  if (start === -1) return html;
  const end = html.indexOf(ROOT_ANCHOR, start);
  if (end === -1) {
    throw new Error(`index.html has a stale #${SEO_CONTENT_ID} block with no ${ROOT_ANCHOR} after it`);
  }
  return html.slice(0, start) + html.slice(end);
}

/**
 * Put the markup *before* `#root`, as a sibling, followed immediately by an inline script
 * that removes it.
 *
 * The script is the load-bearing part, and it has to be **inline and adjacent**. The
 * module bundle is deferred: it does not execute until the document is parsed, and ~1MB of
 * JS takes far longer to arrive than the render-blocking CSS ahead of it. That window is
 * real, and in it the browser paints this block. On `/welcome` that is landing-then-landing
 * and nearly invisible; on `/edit` — where anyone who turned off "show welcome on startup"
 * lands from `/` — it is a full marketing page flashing before the editor.
 *
 * An inline `<script>` runs synchronously at its position in the parse, before the parser
 * reaches `#root` and before first paint, so the node never reaches the screen on any
 * route. None of the SEO value depends on it surviving: a crawler that reads bytes has
 * already received the markup, and one that renders gets React's identical copy.
 *
 * `main.tsx` removes it too. That is not redundancy for its own sake — it is the fallback
 * if a future CSP blocks inline scripts, which would otherwise silently restore the flash.
 */
export function injectContent(html: string, markup: string): string {
  if (!html.includes(ROOT_ANCHOR)) throw new Error(`index.html has no ${ROOT_ANCHOR}`);
  const stripped = stripExistingContent(html);
  const remove = `<script>document.getElementById(${JSON.stringify(SEO_CONTENT_ID)}).remove()</script>`;
  return stripped.replace(
    ROOT_ANCHOR,
    verbatim(`<div id="${SEO_CONTENT_ID}">${markup}</div>${remove}\n    ${ROOT_ANCHOR}`)
  );
}

/** Replace the JSON-LD block rather than appending another — same idempotency as above. */
export function injectJsonLd(html: string, script: string): string {
  if (!html.includes('</head>')) throw new Error('index.html has no </head>');
  return stripJsonLd(html).replace(
    '</head>',
    verbatim(`  <script type="application/ld+json">${script}</script>\n  </head>`)
  );
}

/**
 * Make the `<head>` describe `page`.
 *
 * The template is written for the landing, so for the landing this is a no-op in effect
 * — every value it writes is the one already there. For every other page it is the
 * difference between a page and a duplicate of the homepage: `index.html` hardcodes
 * `canonical → /`, and a content page carrying that tells a crawler to consolidate it into
 * the landing and never index it as itself. Same for `og:url`.
 *
 * The card tags (`og:title`, `og:description`, the Twitter pair) are rewritten for content
 * pages and left alone for the landing. The landing's card is authored in `index.html`
 * and deliberately says more than its `<title>` — a social card has a different budget
 * from a search result — so the template's is the right one there.
 */
export function applyPageMeta(html: string, page: SitePage): string {
  const url = siteUrl(page.path);
  let next = setDocumentTitle(html, page.title);
  next = setMetaTag(next, 'name', 'description', page.description);
  next = setLinkHref(next, 'canonical', url);
  next = setMetaTag(next, 'property', 'og:url', url);
  if (page.id === LANDING_PAGE.id) return next;
  next = setMetaTag(next, 'property', 'og:title', page.title);
  next = setMetaTag(next, 'property', 'og:description', page.description);
  next = setMetaTag(next, 'name', 'twitter:title', page.title);
  next = setMetaTag(next, 'name', 'twitter:description', page.description);
  return next;
}

/** The whole assembly: `markup` is the page rendered to static HTML. */
export function buildPageHtml(template: string, page: SitePage, markup: string): string {
  let html = injectContent(template, markup);
  html = injectJsonLd(html, sitePageJsonLdScript(page));
  html = applyPageMeta(html, page);
  if (!html.includes(`id="${SEO_CONTENT_ID}"`)) throw new Error('content injection produced no marker');
  return html;
}

/** `dist`-relative output files for a page. The landing also owns `/welcome`. */
export function outputFilesForPage(page: SitePage): string[] {
  if (page.id === LANDING_PAGE.id) return ['index.html', 'welcome/index.html'];
  return [`${page.path.replace(/^\/+|\/+$/g, '')}/index.html`];
}
