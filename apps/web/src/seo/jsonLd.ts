import { DISCORD_URL, REPOSITORY_URL } from '../constants/release';
import { SITE_DESCRIPTION, SITE_NAME, SITE_OG_IMAGE, SITE_ORIGIN } from './siteMeta';

/**
 * `SoftwareApplication` structured data for the landing page.
 *
 * This is the strongest signal available for "there is a free web app called Ori Studio",
 * which is the thing a branded query has to resolve before it can rank — and this name is
 * contested by two commercial design studios, so leaving the entity implicit loses.
 * `sameAs` is what ties this page to the GitHub repository Google already knows about.
 *
 * `offers` at price 0 is not decoration: it is how a free application says so in a
 * vocabulary Google reads, and it is what makes the "free" in the title verifiable rather
 * than a claim in a string.
 */
export function landingJsonLd(): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
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
