/**
 * Rewriting the `<head>` of `index.html`: one implementation for the two places that do it.
 *
 * The share Worker (`functions/_lib/cpShareHtml.ts`) rewrites the title and card metadata
 * per crease pattern at request time; the prerender (`scripts/prerender-landing.mjs`, via
 * `prerenderHtml.ts`) rewrites them per site page at build time. Both edit the same
 * template, so they live on the same string surgery — a second copy is how the two learn
 * to disagree about attribute order, escaping, or what happens when a tag is missing.
 *
 * A leaf, deliberately: no React, no `import.meta.env`, no DOM. It is imported by a Pages
 * Function typechecked against `tsconfig.functions.json` (`lib: ES2022, DOM`), by a Node
 * build script, and by Vitest.
 */

/**
 * Escape a string for use inside a double-quoted HTML attribute (or text content).
 *
 * Every value substituted into the document passes through here first, which is what
 * makes the `[^>]*` tag scan in {@link setMetaTag} safe: nothing we write can contain a
 * literal `>`.
 */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap a replacement so `String.prototype.replace` inserts it verbatim.
 *
 * A *string* replacement expands `$&`, `$'`, `` $` `` and `$1`..`$9`. A share title is user
 * input, and {@link escapeHtmlAttribute} does not escape `$` — so a title of `x$'` would
 * splice the rest of the document into the attribute it lands in, `"` characters and all,
 * and break out of it. A *function* replacement is never interpreted, which closes the
 * class instead of escaping one more character and waiting for the next one. The landing
 * copy is not user input, but it can grow a `$` the day someone writes one into the
 * marketing text, and the failure would be just as silent.
 */
export function verbatim(replacement: string): () => string {
  return () => replacement;
}

/**
 * Set a meta tag, replacing an existing one or appending before `</head>`.
 *
 * Matches whole `<meta …>` tags and then tests them for the attribute, rather than
 * requiring `content` to directly follow `property` — `index.html` writes these across
 * several lines, and attribute order is not something a template should have to promise.
 */
export function setMetaTag(
  html: string,
  attr: 'property' | 'name',
  name: string,
  content: string
): string {
  const escaped = escapeHtmlAttribute(content);
  const replacement = `<meta ${attr}="${name}" content="${escaped}" />`;
  const matcher = new RegExp(`\\b${attr}\\s*=\\s*["']${escapeRegExp(name)}["']`, 'i');

  let replaced = false;
  const next = html.replace(/<meta\b[^>]*>/gi, (tag) => {
    if (replaced || !matcher.test(tag)) return tag;
    replaced = true;
    return replacement;
  });
  if (replaced) return next;

  return next.includes('</head>')
    ? next.replace('</head>', verbatim(`  ${replacement}\n  </head>`))
    : `${next}\n${replacement}`;
}

/** Replace the `<title>`. A document with none is returned unchanged. */
export function setDocumentTitle(html: string, title: string): string {
  const escaped = escapeHtmlAttribute(title);
  return /<title>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title>[\s\S]*?<\/title>/i, verbatim(`<title>${escaped}</title>`))
    : html;
}

/**
 * Set the `href` of a `<link rel="…">`, replacing an existing one or appending before
 * `</head>`.
 *
 * Exists for the canonical. `index.html` hardcodes `canonical → /`, which is right for the
 * landing and for every app route that folds into it — and wrong for every content page,
 * where it would tell a crawler the page *is* the homepage and have it consolidated away.
 * Same tag-scan shape as {@link setMetaTag}, for the same reasons.
 */
export function setLinkHref(html: string, rel: string, href: string): string {
  const escaped = escapeHtmlAttribute(href);
  const replacement = `<link rel="${rel}" href="${escaped}" />`;
  const matcher = new RegExp(`\\brel\\s*=\\s*["']${escapeRegExp(rel)}["']`, 'i');

  let replaced = false;
  const next = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (replaced || !matcher.test(tag)) return tag;
    replaced = true;
    return replacement;
  });
  if (replaced) return next;

  return next.includes('</head>')
    ? next.replace('</head>', verbatim(`  ${replacement}\n  </head>`))
    : `${next}\n${replacement}`;
}

/**
 * Remove every `<script type="application/ld+json">` block.
 *
 * The prerender injects the landing's structured data into `index.html`, so it is in the
 * template every other page is built from. A share page strips it because a `WebSite` node
 * is homepage-only by definition and a share is not the homepage; the prerender strips it
 * before injecting a page's own, so a second run over the same `dist` — the obvious way to
 * iterate on the script — cannot leave two.
 */
export function stripJsonLd(html: string): string {
  return html.replace(/[ \t]*<script type="application\/ld\+json">[\s\S]*?<\/script>\n?/g, '');
}

/**
 * Set the `lang` attribute on `<html>`.
 *
 * The template hardcodes `lang="en"`, and a localized page that keeps it tells every
 * crawler — Baidu in particular, which reads this and the words and nothing else — that a
 * page of Chinese is English. A document with no `<html>` tag is returned unchanged.
 */
export function setHtmlLang(html: string, lang: string): string {
  const escaped = escapeHtmlAttribute(lang);
  return html.replace(/<html\b([^>]*)>/i, (tag, attrs: string) => {
    if (/\blang\s*=/i.test(attrs)) {
      return `<html${attrs.replace(/\blang\s*=\s*(["'])[^"']*\1/i, `lang="${escaped}"`)}>`;
    }
    return `<html lang="${escaped}"${attrs}>`;
  });
}

/**
 * Replace the `hreflang` alternates with `links`, one `<link rel="alternate">` per entry.
 *
 * Replace, not append: the template carries none, but the prerender can run over its own
 * output, and a second set would make two claims about the same language. Every localized
 * copy of a page names every other copy and itself — that is the shape Google and Bing
 * require for the set to count; Baidu ignores it and reads `lang` instead.
 */
export function setAlternateLinks(
  html: string,
  links: ReadonlyArray<{ hreflang: string; href: string }>
): string {
  const stripped = html.replace(/[ \t]*<link rel="alternate" hreflang="[^"]*" href="[^"]*" \/>\n?/g, '');
  if (links.length === 0 || !stripped.includes('</head>')) return stripped;
  const tags = links
    .map(
      ({ hreflang, href }) =>
        `  <link rel="alternate" hreflang="${escapeHtmlAttribute(hreflang)}" href="${escapeHtmlAttribute(href)}" />`
    )
    .join('\n');
  return stripped.replace('</head>', verbatim(`${tags}\n  </head>`));
}
