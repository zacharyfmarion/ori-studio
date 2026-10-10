/**
 * The flow path's colour while it is being picked in the Page pane's swatch.
 *
 * Deliberately outside the store, for the reason `folded3dRuntime.ts` gives
 * for a figure's camera mid-orbit. A colour picker reports every pointer move,
 * and a store write per move was a new diagram per move: every page laid out
 * again, every page in view composed again and its image decoded again — 120
 * of each for a two-second drag across the picker's square on the heart, which
 * then took six seconds to catch up (artifacts/diagram-second-pass/26).
 *
 * So the *live* colour is here and the *stored* colour stays on the page
 * setup: the pick is written to the document once, as it settles
 * (`usePathColorPick`), where its one undo step and its one count land, and
 * the store stays exactly what would be saved. Meanwhile the swatch and the
 * Pages view's band read it from here — the view draws the band under each
 * page's art (`DiagramPageBand`), so a move repaints one path and nothing
 * else.
 *
 * Lifetime is one pick: published by its moves, dropped after the store has
 * been written, so no frame shows the colour from before it.
 */

let live: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** The colour the picker is at, or null when nothing is being picked. */
export function livePathColor(): string | null {
  return live;
}

/** Subscribe to the live colour changing or going away. For `useSyncExternalStore`. */
export function subscribePathColorPick(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publish the colour a pick has reached. */
export function publishPathColorPick(color: string): void {
  if (color === live) return;
  live = color;
  notify();
}

/**
 * Drop the live colour — after the store has been written. A no-op, waking
 * nothing, when there was none.
 */
export function clearPathColorPick(): void {
  if (live === null) return;
  live = null;
  notify();
}
