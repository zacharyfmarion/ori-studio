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
  creaseCount: number;
}

/** What appears as the embed's headline. */
export function shareCardTitle(card: ShareCardText): string {
  return `${card.title} — Ori Studio`;
}

/** The line beneath it. Names the author when there is one; always states the size. */
export function shareCardDescription(card: ShareCardText): string {
  const creases =
    card.creaseCount === 1 ? '1 crease' : `${card.creaseCount.toLocaleString('en-US')} creases`;
  const subject = card.author ? `A crease pattern by ${card.author}` : 'A crease pattern';
  return `${subject} · ${creases}. Open it in Ori Studio to fold, edit, and export.`;
}
