/**
 * The favorites events, Edit's and Fold's, assembled in one place.
 *
 * Here rather than inline at the call sites because each carries a bucketed
 * count of the same list, and a second hand-rolled `bucketCount(...)` somewhere
 * else is how two events that should be comparable stop being comparable.
 * Edit's and Fold's are separate events, as their picker events are, but one
 * shape: Fold's want the same dashboard, filtered to the other workspace.
 */
import {
  ANALYTICS_EVENTS,
  bucketCount,
  CP_FAVORITE_COUNT_BUCKETS,
  FOLD_FAVORITE_COUNT_BUCKETS,
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
  surface: CpFavoriteSurface;
  toIndex: number;
  favoriteCount: number;
}): void {
  track(ANALYTICS_EVENTS.cpToolFavoritesReordered, {
    source: input.surface,
    moved_to_front: input.toIndex === 0,
    favorite_count_bucket: bucketCount(input.favoriteCount, CP_FAVORITE_COUNT_BUCKETS),
  });
}

/**
 * Edit's `cp tool favorited`, for Fold. No `source`: the sheet is the one place
 * a Fold tool is starred, so it would be a constant.
 */
export function trackFoldToolFavorited(input: {
  /** A Fold rail item id — an enum from the shipped catalogue, not user content. */
  tool: string;
  favorited: boolean;
  /** How many are starred *after* the change. */
  favoriteCount: number;
}): void {
  track(ANALYTICS_EVENTS.foldToolFavorited, {
    tool: input.tool,
    favorited: input.favorited,
    favorite_count_bucket: bucketCount(input.favoriteCount, FOLD_FAVORITE_COUNT_BUCKETS),
  });
}

/** Edit's `cp tool favorites reordered`, for Fold. */
export function trackFoldToolFavoritesReordered(input: { toIndex: number; favoriteCount: number }): void {
  track(ANALYTICS_EVENTS.foldToolFavoritesReordered, {
    moved_to_front: input.toIndex === 0,
    favorite_count_bucket: bucketCount(input.favoriteCount, FOLD_FAVORITE_COUNT_BUCKETS),
  });
}

/** Whether people find the Tools pill that stands in for Fold's rail on a phone. */
export function trackFoldToolPickerOpened(): void {
  track(ANALYTICS_EVENTS.foldToolPickerOpened);
}
