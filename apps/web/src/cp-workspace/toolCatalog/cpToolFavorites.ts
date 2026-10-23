/**
 * Which crease-pattern tools are starred, and in what order.
 *
 * The catalogue is 52 tools deep. On a phone there is no rail, so every tool
 * that is not the active one costs opening the sheet and scrolling to it — which
 * is what this collapses: a short, user-owned list pinned to the top of the
 * sheet, below the crease types.
 *
 * # Nothing here knows about phones
 *
 * The sheet is the only surface that renders favorites today, but a favorite is
 * a preference about *tools*, not about a viewport. The store, the defaults, the
 * toggle and the move are all surface-neutral so the tablet rail and a future
 * pinned toolbar can adopt them without re-deciding anything; the phone-only
 * decision lives at the one render site.
 *
 * The persistence — absent means the defaults, stored order is the displayed
 * order — is the shared store's (`lib/toolFavorites`), which Fold's favorites
 * use too under a key of their own; what is Edit's here is the key, the
 * defaults, the bar's cap and the catalogue the ids resolve against.
 */
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { createToolFavoritesStore } from '../../lib/toolFavorites';
import {
  cpActionById,
  type OristudioCpActionDefinition,
  type OristudioCpActionId,
} from '../../lib/oristudioCpActions';

/**
 * The tools everyone starts with, most-used first.
 *
 * Taken from PostHog's `cp tool used`, ranked by distinct users over the full
 * life of that event: `CreaseSelect` (109 users), `LineSegmentDelete` (67),
 * `DrawCreaseRestricted` (41), `CreaseToggleMv` (33),
 * `DrawCreaseAngleRestricted5` (28). Filtering the same query to phone and
 * tablet sessions returns the same set, which is what makes the cut defensible
 * on the surface this ships to first.
 *
 * **`DrawCreaseFree` — plain Line — is deliberately absent**, and it is the one
 * omission the ranking does not explain: it sits third by users (63) and second
 * by invocations. Held out as a product call rather than a data one. Nothing
 * stops anyone starring it, and it is the first row of the Draw group when they
 * go looking.
 *
 * Five of them, which is {@link CP_TOOLBAR_FAVORITE_LIMIT} exactly — so the
 * shipped set fills the phone's bar with nothing left over and hidden. That is a
 * happy accident of this edit rather than a constraint: the two numbers answer
 * different questions and nothing keeps them equal.
 *
 * Written out rather than computed. The ranking was a one-time input; the list
 * that ships should be a reviewable line in a diff, and a test asserts every id
 * still resolves against the catalogue.
 *
 * Watch the ids: `DrawCreaseFree` would have been `cp.action.draw-crease`, not
 * `cp.action.draw-crease-free`, because it is the one command carrying an id
 * override in `ORIEDITA_RAIL_ACTION_OVERRIDES`. Deriving these by hand from the
 * operation name is exactly how this list goes silently wrong.
 */
export const CP_DEFAULT_FAVORITE_ACTION_IDS: readonly OristudioCpActionId[] = [
  'cp.action.crease-select',
  'cp.action.line-segment-delete',
  'cp.action.draw-crease-restricted',
  'cp.action.crease-toggle-mv',
  'cp.action.draw-crease-angle-restricted5',
];

/**
 * How many favorites the phone's bottom toolbar shows.
 *
 * The store itself has no cap — starring is free, and a list that refused a
 * seventh would be refusing the thing the sheet is for. The bar has one because
 * it is a single row on a 375px screen, and this is where the two meet: the
 * first N in the user's order go on the bar, the rest live in the sheet.
 *
 * **Five because six does not fit**, measured rather than guessed. On a 375px
 * viewport the bar has 351px of usable width, each control is a 44px touch
 * target with a 10px gap, and the overflow trigger and its separator take a
 * further 56px. Six tools want 296px, which leaves 351 − 296 − 56 = −1: the
 * group wraps as a unit, so the trigger drops to a second row and the bar
 * doubles in height over the canvas it floats on. Five want 242px and leave 53px
 * spare — comfortable, and enough that a wider glyph or a locale with a fatter
 * separator does not tip it back.
 *
 * One constant because three places need the same number for different reasons:
 * the bar slices by it, the sheet's helper text names it, and the test asserts
 * it. A bar showing six while the text promised five is the sort of thing
 * nothing catches.
 */
export const CP_TOOLBAR_FAVORITE_LIMIT = 5;

const favorites = createToolFavoritesStore<OristudioCpActionId>({
  key: storageKey(STORAGE_KEYS.cpToolFavorites),
  defaults: CP_DEFAULT_FAVORITE_ACTION_IDS,
});

/** The starred tools, in the user's order. */
export const cpToolFavoriteIds = favorites.ids;

export const isCpToolFavorite = favorites.isFavorite;

/** Star or un-star; see `ToolFavoritesStore.toggle`. */
export const toggleCpToolFavorite = favorites.toggle;

/** Move a favorite to `toIndex`, clamped; see `ToolFavoritesStore.move`. */
export const moveCpToolFavorite = favorites.move;

/** Test seam. Drops the cache *and* the stored key, back to a first-run user. */
export const resetCpToolFavorites = favorites.reset;

/**
 * The favorited tools as catalogue definitions, in the user's order.
 *
 * Unresolvable ids are dropped *here* rather than at read time, so a tool that
 * is temporarily absent from the catalogue does not permanently delete itself
 * from someone's favorites — it comes back when the catalogue does.
 *
 * Takes the ids rather than only reading them, so a caller memoizing on the
 * stored array can name that array as its dependency and have the claim be
 * true. Reading the store internally would make every such memo a lie the
 * exhaustive-deps rule is right to flag.
 */
export function cpFavoriteToolActions(
  ids: readonly OristudioCpActionId[] = cpToolFavoriteIds()
): readonly OristudioCpActionDefinition[] {
  return ids
    .map((id) => cpActionById(id))
    .filter((action): action is OristudioCpActionDefinition => action !== undefined);
}

export interface CpToolFavorites {
  ids: readonly OristudioCpActionId[];
  isFavorite: (actionId: OristudioCpActionId) => boolean;
  toggle: (actionId: OristudioCpActionId) => void;
  move: (actionId: OristudioCpActionId, toIndex: number) => void;
}

/** Reactive {@link cpToolFavoriteIds}, plus the verbs that change it. */
export function useCpToolFavorites(): CpToolFavorites {
  const ids = favorites.useIds();
  return {
    ids,
    isFavorite: isCpToolFavorite,
    toggle: toggleCpToolFavorite,
    move: moveCpToolFavorite,
  };
}
