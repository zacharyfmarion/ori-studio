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
    // Runs in any modern browser; the desktop build is a shell around the same app.
    operatingSystem: 'Web browser, macOS',
    isAccessibleForFree: true,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    license: `${REPOSITORY_URL}/blob/main/LICENSE`,
    sameAs: [REPOSITORY_URL, DISCORD_URL],
  };
}

/**
 * Serialize for a `<script type="application/ld+json">` body.
 *
 * `<` is escaped because a `</script>` inside any string value would close the tag and
 * turn the rest of the document into markup — the same hazard `escapeJsonForScript` in
 * `functions/_lib/cpShare.ts` exists for. Nothing here is user input today, but the
 * values come from constants that anyone can edit.
 */
export function landingJsonLdScript(): string {
  return JSON.stringify(landingJsonLd()).replace(/</g, '\\u003c');
}
