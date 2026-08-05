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

/**
 * The embed's headline: the pattern, then whose it is.
 *
 * Attribution belongs on the headline rather than the line below, because the headline is
 * the part that survives — it is what a chat client bolds, what a search result shows, and
 * often all that fits on a phone. "Ori Studio" only takes the slot when there is no author
 * to put there; the description names the app either way, so it is never lost.
 */
export function shareCardTitle(card: ShareCardText): string {
  return `${card.title} — ${card.author ?? 'Ori Studio'}`;
}

/**
 * The line beneath it: what clicking will do.
 *
 * Constant on purpose. A link preview gets about a second of attention while someone
 * scrolls a chat, and by then the image has already said what the thing *is* — so the only
 * job left for the second line is telling them what happens if they tap it.
 */
export function shareCardDescription(): string {
  return 'View this crease pattern in Ori Studio';
}
