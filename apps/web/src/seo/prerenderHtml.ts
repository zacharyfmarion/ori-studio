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
import { PHONE_COPY_TEMPLATE_ID, STATIC_PAINT_ATTRIBUTE, STATIC_PAINT_SHOWN } from './staticPaint';

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
export function stripExistingContent(html: string): string {
  const start = html.indexOf(`<div id="${SEO_CONTENT_ID}"`);
  if (start === -1) return html;
  const end = html.indexOf(ROOT_ANCHOR, start);
  if (end === -1) {
    throw new Error(`index.html has a stale #${SEO_CONTENT_ID} block with no ${ROOT_ANCHOR} after it`);
  }
  return html.slice(0, start) + html.slice(end);
}

/**
 * Put the markup *before* `#root`, as a sibling, with an inline script right after it.
 *
 * The script is the load-bearing part, and it has to be **inline and adjacent**: it runs
 * synchronously at its position in the parse, before the parser reaches `#root` and before
 * first paint. For most pages it removes the copy. A crawler that reads bytes already has
 * it, and a copy React will not render identically must never paint first — on `/edit`,
 * where `/` sends anyone who turned off "show welcome on startup", it would be a whole
 * marketing page flashing before the editor. A page whose copy *can* be its first paint
 * (`paint`) gets the body half of the static paint instead, which finishes or removes it
 * (`staticPaint.ts`); {@link buildPageHtml} adds the head half.
 *
 * The `:has()` rule is the fallback for when no script runs (a future CSP blocking inline
 * scripts, say): whatever React renders into `#root` hides the copy. A painted page's scripts
 * have no such fallback — the body one is what starts the app — so any CSP must allow them by
 * hash. The desktop shell's does: `tauri.conf.json` has no `'unsafe-inline'`, and Tauri
 * hashes every inline script of the bundled HTML into the CSP at compile time, unless
 * `dangerousDisableAssetCspModification` covers `script-src` (a test pins that).
 */
export function injectContent(html: string, markup: string, paint?: StaticPaint): string {
  if (!html.includes(ROOT_ANCHOR)) throw new Error(`index.html has no ${ROOT_ANCHOR}`);
  const stripped = stripExistingContent(html);
  const block = paint ? paintedCopy(markup, paint) : removedCopy(markup);
  return stripped.replace(ROOT_ANCHOR, verbatim(`${block}\n    ${ROOT_ANCHOR}`));
}

/** Hides the copy once React has rendered anything, if no script got to it first. */
const HIDE_WHEN_RENDERED = `<style>body:has(#root > *) > #${SEO_CONTENT_ID}{display:none}</style>`;

function removedCopy(markup: string): string {
  const remove = `<script>document.getElementById(${JSON.stringify(SEO_CONTENT_ID)}).remove()</script>`;
  return `<div id="${SEO_CONTENT_ID}">${markup}</div>${HIDE_WHEN_RENDERED}${remove}`;
}

/** What `#root` is given by `index.css`, so the copy lays out exactly as the live page will. */
const COPY_BOX = 'width:100%;height:100%';

/**
 * A page whose copy may be the first paint (see `staticPaint.ts`): the copy in `#root`'s box,
 * its phone variant held inert in a `<template>`, and the body script that finishes one of
 * them or removes both. The style also covers any render that does not take the copy over
 * (an error screen, say).
 */
function paintedCopy(markup: string, paint: StaticPaint): string {
  return (
    `<div id="${SEO_CONTENT_ID}" style="${COPY_BOX}">${markup}</div>` +
    `<template id="${PHONE_COPY_TEMPLATE_ID}"><div id="${SEO_CONTENT_ID}" style="${COPY_BOX}">${paint.phoneMarkup}</div></template>` +
    HIDE_WHEN_RENDERED +
    inlineScript(paint.bodyScript)
  );
}

/** A script to inline, refused if it could end its own tag early. */
function inlineScript(script: string, id?: string): string {
  if (/<\/script/i.test(script)) throw new Error('an inline script contains </script>');
  return `<script${id ? ` id="${id}"` : ''}>${script}</script>`;
}

/**
 * A painted page preloads the app's entry instead of running it, and its body script starts
 * it once the copy has been presented (`startApp` in `staticPaintBody.ts`).
 *
 * At low priority, because the first paint no longer needs it and it should not compete with
 * the stylesheet that paint does need. That is also what PageSpeed's simulation reads: it
 * cannot see a module being evaluated, so a high-priority script that finished downloading
 * before first paint is charged to first paint whether or not it ran.
 */
const ENTRY_SCRIPT = /<script type="module" crossorigin src="(\/assets\/[^"]+\.js)"><\/script>/;
/** The same entry after an earlier run preloaded it, so a re-run over the output still finds it. */
const PRELOADED_ENTRY = /<link rel="modulepreload" crossorigin fetchpriority="low" href="(\/assets\/[^"]+\.js)">/;

/** The app's entry module, as Vite wrote it into `index.html` (or as this file rewrote it). */
export function entryScriptPath(html: string): string | null {
  return ENTRY_SCRIPT.exec(html)?.[1] ?? PRELOADED_ENTRY.exec(html)?.[1] ?? null;
}

function preloadEntryInstead(html: string): string {
  const src = entryScriptPath(html);
  if (!src) throw new Error('index.html has no module entry script to defer');
  const preload = `<link rel="modulepreload" crossorigin fetchpriority="low" href="${src}">`;
  return html.replace(ENTRY_SCRIPT, preload).replace(PRELOADED_ENTRY, preload);
}

/**
 * From the moment the head script records its decision until the body script has finished
 * the copy, the copy is hidden — so no frame can show a part of it, or the wrong variant.
 * Without JavaScript there is no decision, and the copy shows as written.
 */
const HIDE_UNTIL_FINISHED =
  `html[${STATIC_PAINT_ATTRIBUTE}]:not([${STATIC_PAINT_ATTRIBUTE}=${STATIC_PAINT_SHOWN}]) #${SEO_CONTENT_ID}` +
  '{display:none}';
const HEAD_BLOCK_ID = 'static-paint';
/** The head block an earlier run wrote, so a re-run replaces it rather than adding another. */
const EXISTING_HEAD_BLOCK = new RegExp(
  `<style id="${HEAD_BLOCK_ID}">[^<]*</style><script id="${HEAD_BLOCK_ID}-head">[\\s\\S]*?</script>\\s*`
);

/**
 * The head half of a painted page: the stylesheet above, and the script that decides. Just
 * ahead of the entry's preload — after the viewport meta tag, which the phone test needs, and
 * before the app's stylesheet, which an inline script would otherwise wait for.
 */
function injectStaticPaintHead(html: string, headScript: string): string {
  const block =
    `<style id="${HEAD_BLOCK_ID}">${HIDE_UNTIL_FINISHED}</style>` + inlineScript(headScript, `${HEAD_BLOCK_ID}-head`);
  const stripped = html.replace(EXISTING_HEAD_BLOCK, '');
  if (!PRELOADED_ENTRY.test(stripped)) throw new Error('index.html has no entry preload to put the head script before');
  return stripped.replace(PRELOADED_ENTRY, (link) => `${block}\n    ${link}`);
}

/** A page's copy made fit to be its first paint. */
export interface StaticPaint {
  /** The page as a phone-shaped touch screen renders it. */
  phoneMarkup: string;
  /** `staticPaintHead.ts`, bundled and already called with this page's config. */
  headScript: string;
  /** `staticPaintBody.ts`, likewise. */
  bodyScript: string;
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
  meta: PageMeta,
  paint?: StaticPaint
): string {
  let html = injectContent(template, markup, paint);
  if (paint) html = injectStaticPaintHead(preloadEntryInstead(html), paint.headScript);
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
