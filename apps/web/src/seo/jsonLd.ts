import { DISCORD_URL, REPOSITORY_URL } from '../constants/release';
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG_IMAGE, SITE_ORIGIN } from './siteMeta';

/**
 * Structured data for the landing page: the **site** and the **app** it serves, as one
 * graph.
 *
 * Two nodes because Google asks two different questions of this page. "What site is this,
 * and what is it called" is answered by `WebSite`; "what is the thing on it" by
 * `SoftwareApplication`. Answering only the second left the result printing `oristudio.dev`
 * where a named site prints its name.
 */
export function landingJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    // A graph rather than two `<script>` blocks, because the prerender replaces every
    // `ld+json` block with the one it injects — two tags would leave whichever came last.
    '@graph': [website(), softwareApplication()],
  };
}

/**
 * The node Google reads for the **site name** — the line printed above the URL in a
 * result, which says `oristudio.dev` when nothing declares one and `Ori Studio` when
 * something does. `og:site_name` is the other input; Google reads both and still chooses.
 *
 * Homepage-only by definition, which is why `cpShareHtml` strips this whole block from a
 * share page rather than leaving it to claim the site from a URL that is not the site.
 */
function website(): Record<string, unknown> {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_ORIGIN}/#website`,
    name: SITE_NAME,
    url: `${SITE_ORIGIN}/`,
    description: SITE_DESCRIPTION,
    publisher: { '@id': `${SITE_ORIGIN}/#software` },
  };
}

/**
 * The strongest signal available for "there is a free web app called Ori Studio", which is
 * the thing a branded query has to resolve before it can rank — and this name is contested
 * by two commercial design studios, so leaving the entity implicit loses. `sameAs` is what
 * ties this page to the GitHub repository Google already knows about.
 *
 * `offers` at price 0 is not decoration: it is how a free application says so in a
 * vocabulary Google reads. It carries more weight now than it did, because "free" used to
 * be in the title as well and no longer is — see {@link SITE_TITLE}.
 */
function softwareApplication(): Record<string, unknown> {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_ORIGIN}/#software`,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: `${SITE_ORIGIN}/`,
    image: SITE_OG_IMAGE,
    applicationCategory: 'DesignApplication',
    // Runs in any modern browser; the desktop builds are a shell around the same
    // app, and every platform the release workflow ships is named here — this is
    // the field a "download for Windows" query is matched against.
    operatingSystem: 'Web browser, macOS, Windows, Linux',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    // `LICENSE.txt`, not `LICENSE` — GitHub blob paths are exact and do not fall back
    // to a same-stem file, so the shorter spelling publishes a 404 in machine-readable
    // metadata. It is also the URL GitHub's own license API reports for this repo.
    license: `${REPOSITORY_URL}/blob/main/LICENSE.txt`,
    sameAs: [REPOSITORY_URL, DISCORD_URL],
  };
}

/**
 * Escape `<` so no value can close the surrounding `<script>` tag.
 *
 * A `</script>` inside any string value would end the tag and turn the rest of the document
 * into markup — the same hazard `escapeJsonForScript` in `functions/_lib/cpShare.ts` exists
 * for. Nothing here is user input today, but the values come from constants anyone can edit.
 *
 * Exported and applied separately from {@link landingJsonLdScript} so the guarantee can be
 * tested against a hostile string. Asserting on the live output proves nothing: none of the
 * current constants contains a `<`, so such an assertion passes whether or not this runs.
 */
export function escapeForScriptTag(json: string): string {
  return json.replace(/</g, '\\u003c');
}

/** Serialize for a `<script type="application/ld+json">` body. */
export function landingJsonLdScript(): string {
  return escapeForScriptTag(JSON.stringify(landingJsonLd()));
}
