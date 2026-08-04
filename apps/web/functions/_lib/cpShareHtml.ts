/**
 * Rewriting `index.html` for a shared crease pattern.
 *
 * Pure string work, kept apart from the route so it can be tested without a Worker,
 * a KV binding, or a fetch. The route does I/O; this decides what the bytes say.
 */

import { escapeHtmlAttribute, escapeJsonForScript } from './cpShare';
// Shared with the share modal's embed preview, so the preview cannot claim a card the
// crawler never receives. Pure strings, no browser or Worker dependencies either way.
import { shareCardDescription, shareCardTitle } from '../../src/lib/shareCardText';
// One owner for the script id, because a drift here fails silently — see the module.
import { SHARED_CP_SCRIPT_ID } from '../../src/lib/sharedCpContract';

/** Everything the card and the inlined bootstrap need. */
export interface ShareCardMeta {
  id: string;
  title: string;
  author: string | null;
  shareUrl: string;
  imageUrl: string;
}

export { shareCardDescription, shareCardTitle, SHARED_CP_SCRIPT_ID };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Set a meta tag, replacing an existing one or appending before `</head>`.
 *
 * Matches whole `<meta …>` tags and then tests them for the attribute, rather than
 * requiring `content` to directly follow `property` — `index.html` writes these across
 * several lines, and attribute order is not something a template should have to promise.
 *
 * The `[^>]*` tag scan would mis-split a tag whose attribute value contained a literal
 * `>`. Nothing we write can: every value goes through {@link escapeHtmlAttribute} first.
 */
function setMetaTag(html: string, attr: 'property' | 'name', name: string, content: string): string {
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
    ? next.replace('</head>', `  ${replacement}\n  </head>`)
    : `${next}\n${replacement}`;
}

function setDocumentTitle(html: string, title: string): string {
  const escaped = escapeHtmlAttribute(title);
  return /<title>[\s\S]*?<\/title>/i.test(html)
    ? html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escaped}</title>`)
    : html;
}

/**
 * Inline the payload so the SPA needs no fetch to render the shared pattern.
 *
 * This is the load-bearing half of the design: it removes the second KV read per click,
 * and it means the crease pattern is present at first paint, so there is no blank-canvas
 * flash and no loading state to build.
 */
function inlineSharedPayload(html: string, meta: ShareCardMeta, payload: string): string {
  const data = escapeJsonForScript({
    id: meta.id,
    payload,
    title: meta.title,
    author: meta.author,
  });
  const script = `<script type="application/json" id="${SHARED_CP_SCRIPT_ID}">${data}</script>`;
  return html.includes('</head>')
    ? html.replace('</head>', `  ${script}\n  </head>`)
    : `${html}\n${script}`;
}

/** Apply the card metadata only — used when the share is missing but the SPA still serves. */
export function renderShareCardMeta(html: string, meta: ShareCardMeta): string {
  const title = shareCardTitle(meta);
  const description = shareCardDescription();

  let next = setDocumentTitle(html, title);
  next = setMetaTag(next, 'name', 'description', description);
  next = setMetaTag(next, 'property', 'og:title', title);
  next = setMetaTag(next, 'property', 'og:description', description);
  next = setMetaTag(next, 'property', 'og:image', meta.imageUrl);
  next = setMetaTag(next, 'property', 'og:url', meta.shareUrl);
  next = setMetaTag(next, 'property', 'og:type', 'website');
  // Unconditionally `summary_large_image`: the thumbnail endpoint always serves bytes,
  // falling back to the generic card, so there is never a case where the large layout
  // would render a broken image.
  next = setMetaTag(next, 'name', 'twitter:card', 'summary_large_image');
  next = setMetaTag(next, 'name', 'twitter:title', title);
  next = setMetaTag(next, 'name', 'twitter:description', description);
  next = setMetaTag(next, 'name', 'twitter:image', meta.imageUrl);
  return next;
}

/** The full transform: card metadata plus the inlined payload. */
export function renderSharedCpHtml(html: string, meta: ShareCardMeta, payload: string): string {
  return inlineSharedPayload(renderShareCardMeta(html, meta), meta, payload);
}
