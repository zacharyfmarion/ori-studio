/**
 * Which Fold tools are starred, and in what order: Edit's favorites
 * (`cpToolFavorites`) for the Fold rail's items, on the shared store
 * (`lib/toolFavorites`) under a key of their own, so a star in one workspace is
 * never one in the other.
 *
 * A phone has no rail, so every tool but the one in hand costs opening the
 * sheet and finding it; the starred ones head the sheet and fill the canvas's
 * bottom bar (`useFoldPhoneBarGroups`). Any rail item can be starred — a fold,
 * a line mode, Turn over — since each is one tap on the rail.
 *
 * React-free beyond the store's hook; the rail's groups resolve the ids, so an
 * id the catalogue no longer has is skipped rather than forgotten.
 */
import { trackFoldToolFavorited } from '../../analytics';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { createToolFavoritesStore } from '../../lib/toolFavorites';
import type { FoldRailGroup, FoldRailItem } from './foldRailGroups';
import type { FoldRailItemId } from './foldToolCatalog';

/**
 * The tools everyone starts with: the two folds every step is made of, the
 * precrease (a fold and unfold, the commonest step after them), and Turn over,
 * a one-tap verb that would otherwise cost a trip to the sheet. A product call:
 * Fold has no usage to rank yet, as Edit's defaults were ranked. Four, which is
 * {@link FOLD_TOOLBAR_FAVORITE_LIMIT}, so the shipped set fills the bar.
 */
export const FOLD_DEFAULT_FAVORITE_IDS: readonly FoldRailItemId[] = ['valley', 'mountain', 'precrease', 'turn-over'];

/**
 * How many favorites the phone's bottom bar shows: Edit's five
 * (`CP_TOOLBAR_FAVORITE_LIMIT`, five buttons and the overflow trigger in a
 * 375px row) less the place Fold's pane switch takes. While the free-point
 * latch is on it is on the bar too, and borrows the last of these places
 * ({@link foldBarFavoriteCount}), or the bar would wrap to a second row.
 */
export const FOLD_TOOLBAR_FAVORITE_LIMIT = 4;

/** How many favorites the bar has room for now. */
export function foldBarFavoriteCount(latched: boolean): number {
  return latched ? FOLD_TOOLBAR_FAVORITE_LIMIT - 1 : FOLD_TOOLBAR_FAVORITE_LIMIT;
}

const favorites = createToolFavoritesStore<FoldRailItemId>({
  key: storageKey(STORAGE_KEYS.foldToolFavorites),
  defaults: FOLD_DEFAULT_FAVORITE_IDS,
});

/** The starred items, in the user's order. */
export const foldToolFavoriteIds = favorites.ids;

export const isFoldToolFavorite = favorites.isFavorite;

/** Move a favorite to `toIndex`, clamped; see `ToolFavoritesStore.move`. */
export const moveFoldToolFavorite = favorites.move;

/** Test seam. Drops the cache *and* the stored key, back to a first-run user. */
export const resetFoldToolFavorites = favorites.reset;

/** Reactive {@link foldToolFavoriteIds}: the same array until a star changes it. */
export const useFoldToolFavoriteIds = favorites.useIds;

/**
 * Star or un-star, and report it (`fold tool favorited`): the direction read
 * before the toggle, the count after it, so the event says the state the user
 * is now in.
 */
export function toggleFoldToolFavorite(id: FoldRailItemId): void {
  const favorited = !isFoldToolFavorite(id);
  favorites.toggle(id);
  trackFoldToolFavorited({ tool: id, favorited, favoriteCount: foldToolFavoriteIds().length });
}

/** The starred items as the rail offers them, in the user's order; one the rail lacks is skipped. */
export function foldFavoriteItems(
  groups: readonly FoldRailGroup[],
  ids: readonly FoldRailItemId[]
): FoldRailItem[] {
  const byId = new Map(groups.flatMap((group) => group.items.map((item) => [item.id, item] as const)));
  return ids.flatMap((id) => byId.get(id) ?? []);
}
