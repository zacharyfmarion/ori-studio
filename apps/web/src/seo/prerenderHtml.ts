import { DEFAULT_LOCALE } from '../i18n/locales';
import { LANDING_PAGE, ogLocale, PAGE_LOCALES, pagePath, type SitePage } from '../site/sitePages';
import {
  setAlternateLinks,
  setDocumentTitle,
  setHtmlLang,
  setLinkHref,
  setMetaTag,
  stripJsonLd,
  verbatim,
} from './htmlMeta';
import { sitePageJsonLdScript } from './jsonLd';
import { SEO_CONTENT_ID, siteUrl } from './siteMeta';

/**
 * Assembling one site page's HTML from the built `index.html`: the crawler copy of the
 * page, its structured data, and a `<head>` that describes *this* page in *this* language.
 *
 * Pure string work, pulled out of `scripts/prerender-landing.mjs` so it can be tested
 * without a Vite server. The script does I/O; this decides what the bytes say — the same
 * split `cpShareHtml.ts` makes for the share route, and for the same reason: the failures
 * here are silent. A page carrying the homepage's canonical still deploys, still serves,
 * still 200s, and is simply never indexed as itself. A Chinese page still marked
 * `lang="en"` is indexed as English.
 */

const ROOT_ANCHOR = '<div id="root"></div>';

/** What a page says about itself, in the locale it is being written in. */
export interface PageMeta {
  title: string;
  description: string;
}

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

/** The `hreflang` set for a page: every locale it is served in, and `x-default` → English. */
export function alternateLinksForPage(page: SitePage): { hreflang: string; href: string }[] {
  return [
    ...PAGE_LOCALES.map((locale) => ({ hreflang: locale, href: siteUrl(pagePath(page, locale)) })),
    { hreflang: 'x-default', href: siteUrl(pagePath(page, DEFAULT_LOCALE)) },
  ];
}

/**
 * Make the `<head>` describe `page`, in `locale`.
 *
 * The template is written for the English landing, so for that one page this is a no-op in
 * effect — every value it writes is the one already there. For every other page it is the
 * difference between a page and a duplicate of the homepage: `index.html` hardcodes
 * `canonical → /` and `lang="en"`, and a content page carrying the first tells a crawler to
 * consolidate it into the landing, while a Chinese page carrying the second tells Baidu it
 * is English. Same for `og:url`.
 *
 * The canonical of a localized page is *itself*. A translation is a different page for a
 * different reader, not a duplicate of the English one; pointing it at English would have a
 * crawler drop it, which is the opposite of the point. The `hreflang` set is what says the
 * nine are the same page in nine languages.
 *
 * The card tags (`og:title`, `og:description`, the Twitter pair) are rewritten for every
 * page but the English landing. Its card is authored in `index.html` and deliberately says
 * more than its `<title>` — a social card has a different budget from a search result — so
 * the template's is the right one there.
 */
export function applyPageMeta(html: string, page: SitePage, locale: string, meta: PageMeta): string {
  const url = siteUrl(pagePath(page, locale));
  let next = setHtmlLang(html, locale);
  next = setDocumentTitle(next, meta.title);
  next = setMetaTag(next, 'name', 'description', meta.description);
  next = setLinkHref(next, 'canonical', url);
  next = setMetaTag(next, 'property', 'og:url', url);
  next = setMetaTag(next, 'property', 'og:locale', ogLocale(locale));
  next = setAlternateLinks(next, alternateLinksForPage(page));
  if (page.id === LANDING_PAGE.id && locale === DEFAULT_LOCALE) return next;
  next = setMetaTag(next, 'property', 'og:title', meta.title);
  next = setMetaTag(next, 'property', 'og:description', meta.description);
  next = setMetaTag(next, 'name', 'twitter:title', meta.title);
  next = setMetaTag(next, 'name', 'twitter:description', meta.description);
  return next;
}

/** The whole assembly: `markup` is the page rendered to static HTML in `locale`. */
export function buildPageHtml(
  template: string,
  page: SitePage,
  locale: string,
  markup: string,
  meta: PageMeta
): string {
  let html = injectContent(template, markup);
  html = applyPageMeta(html, page, locale, meta);
  // Last, so a second run over this output lands every appended tag in the same order —
  // the meta rewrites replace in place once the tag exists, and the JSON-LD is always
  // stripped and re-appended, so it has to be the final thing appended.
  html = injectJsonLd(html, sitePageJsonLdScript(page, locale, meta));
  if (!html.includes(`id="${SEO_CONTENT_ID}"`)) throw new Error('content injection produced no marker');
  return html;
}

/**
 * `dist`-relative output files for a page in a locale. The English landing also owns
 * `/welcome`; a localized landing is `<locale>/index.html`.
 */
export function outputFilesForPage(page: SitePage, locale: string = DEFAULT_LOCALE): string[] {
  const dir = pagePath(page, locale).replace(/^\/+|\/+$/g, '');
  const file = dir === '' ? 'index.html' : `${dir}/index.html`;
  if (page.id === LANDING_PAGE.id && locale === DEFAULT_LOCALE) return [file, 'welcome/index.html'];
  return [file];
}
