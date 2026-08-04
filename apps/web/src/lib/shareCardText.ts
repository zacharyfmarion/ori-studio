/**
 * The text a share link unfurls with.
 *
 * Imported by **both** the Worker that writes the OpenGraph tags
 * (`functions/_lib/cpShareHtml.ts`) and the share modal that previews the embed, so the
 * preview cannot drift from what Discord actually receives. Deliberately dependency-free
 * and pure string work — it is bundled into a Worker, where anything browser-shaped would
 * be dead weight at best.
 */

export interface ShareCardText {
  title: string;
  author: string | null;
}

/** The embed's headline. */
export function shareCardTitle(card: ShareCardText): string {
  return `${card.title} — Ori Studio`;
}

/**
 * The line beneath it, or null to omit the tag entirely.
 *
 * An attribution and nothing else. A link preview is read in a fraction of a second while
 * scrolling a chat, so the only thing worth the second line is whose pattern it is —
 * everything else (what the app does, how to open it, how big the pattern is) is either
 * obvious from the image or of no interest to the reader. With no author there is nothing
 * left to say, and an absent description reads better than a padded one.
 */
export function shareCardDescription(card: ShareCardText): string | null {
  return card.author ? `by ${card.author}` : null;
}
