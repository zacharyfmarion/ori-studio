/**
 * The two favorites events, assembled in one place.
 *
 * Here rather than inline at the call sites because both carry a bucketed count
 * of the same list, and a second hand-rolled `bucketCount(...)` somewhere else
 * is how two events that should be comparable stop being comparable.
 */
import {
  ANALYTICS_EVENTS,
  bucketCount,
  CP_FAVORITE_COUNT_BUCKETS,
  type CpFavoriteReorderMethod,
  type CpFavoriteSurface,
} from './events';
import { track } from './runtime';

export function trackCpToolFavorited(input: {
  /** A CP action id — an enum from the shipped catalogue, not user content. */
  actionId: string;
  /** True when starring, false when un-starring. */
  favorited: boolean;
  surface: CpFavoriteSurface;
  /** How many are starred *after* the change. */
  favoriteCount: number;
}): void {
  track(ANALYTICS_EVENTS.cpToolFavorited, {
    action: input.actionId,
    favorited: input.favorited,
    source: input.surface,
    favorite_count_bucket: bucketCount(input.favoriteCount, CP_FAVORITE_COUNT_BUCKETS),
  });
}

/**
 * One event per completed reorder.
 *
 * `moved_to_front` rather than the destination index: the question worth
 * answering is whether anyone promotes a tool to the thumb position, and a raw
 * index across a variable-length list answers nothing cleanly. The permutation
 * itself is never sent — high cardinality, and it says nothing the favorited set
 * does not already say.
 */
export function trackCpToolFavoritesReordered(input: {
  method: CpFavoriteReorderMethod;
  surface: CpFavoriteSurface;
  toIndex: number;
  favoriteCount: number;
}): void {
  track(ANALYTICS_EVENTS.cpToolFavoritesReordered, {
    method: input.method,
    source: input.surface,
    moved_to_front: input.toIndex === 0,
    favorite_count_bucket: bucketCount(input.favoriteCount, CP_FAVORITE_COUNT_BUCKETS),
  });
}
