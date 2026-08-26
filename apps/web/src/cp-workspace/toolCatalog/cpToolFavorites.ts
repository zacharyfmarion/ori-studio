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
 * # Absent means "use the defaults"
 *
 * The stored key is written on the first *edit*, not on first read. That is the
 * whole persistence design, and both of its consequences are wanted:
 *
 * - Someone who never customises tracks whatever we ship. Re-run the usage
 *   ranking in six months, change {@link CP_DEFAULT_FAVORITE_ACTION_IDS}, and
 *   they get the better list without a migration.
 * - Someone who un-stars a default persists an explicit list and is never
 *   surprised by a later default change. Their edit is the whole record.
 *
 * # Stored order is the displayed order
 *
 * Not catalogue order. This is what makes drag-reorder a splice and a write
 * rather than a second ordering concept kept in sync with the first — the array
 * *is* what the user sees.
 *
 * Module state with `useSyncExternalStore` rather than a store slice, the same
 * shape as `cpToolSurface` and `touchModifiers/shiftLatch`: one small record,
 * few subscribers, and no reason for the rest of the app to re-render when a
 * star is toggled.
 */
import { useSyncExternalStore } from 'react';
import { STORAGE_KEYS, readJson, removeKey, storageKey, writeJson } from '../../lib/storage';
import {
  cpActionById,
  type OristudioCpActionDefinition,
  type OristudioCpActionId,
} from '../../lib/oristudioCpActions';

const KEY = storageKey(STORAGE_KEYS.cpToolFavorites);

/**
 * The six tools everyone starts with, most-used first.
 *
 * Taken from PostHog's `cp tool used`, ranked by distinct users over the full
 * life of that event: `CreaseSelect` (109 users), `LineSegmentDelete` (67),
 * `DrawCreaseFree` (63), `DrawCreaseRestricted` (41), `CreaseToggleMv` (33),
 * `DrawCreaseAngleRestricted5` (28). Filtering the same query to phone and
 * tablet sessions returns the same six, which is what makes the cut defensible
 * on the surface this ships to first. Seventh place is a cliff — 23 users and
 * an order of magnitude fewer invocations.
 *
 * Written out rather than computed. The ranking was a one-time input; the list
 * that ships should be a reviewable line in a diff, and a test asserts every id
 * still resolves against the catalogue.
 *
 * `DrawCreaseFree`'s action id is `cp.action.draw-crease`, **not**
 * `cp.action.draw-crease-free` — it is the one command with an id override in
 * `ORIEDITA_RAIL_ACTION_OVERRIDES`. Deriving these by hand from the operation
 * name is exactly how this list goes silently wrong.
 */
export const CP_DEFAULT_FAVORITE_ACTION_IDS: readonly OristudioCpActionId[] = [
  'cp.action.crease-select',
  'cp.action.line-segment-delete',
  'cp.action.draw-crease',
  'cp.action.draw-crease-restricted',
  'cp.action.crease-toggle-mv',
  'cp.action.draw-crease-angle-restricted5',
];

/** Version 1 of the stored shape. Present so a migration has something to branch on. */
const STORED_VERSION = 1;

interface StoredCpToolFavorites {
  version: number;
  ids: string[];
}

/**
 * The stored list, or `null` when the user has never edited theirs.
 *
 * Every malformed case collapses to `null` — wrong type, wrong version, `ids`
 * not an array — so a hand-edited or stale key falls back to the defaults rather
 * than to an empty list. An empty *array* is a different thing and is honoured:
 * it means someone deliberately un-starred everything.
 */
function readStored(): OristudioCpActionId[] | null {
  const raw = readJson<unknown>(KEY, null);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const stored = raw as Partial<StoredCpToolFavorites>;
  if (stored.version !== STORED_VERSION || !Array.isArray(stored.ids)) return null;
  return stored.ids.filter((id): id is OristudioCpActionId => typeof id === 'string');
}

function writeStored(ids: readonly OristudioCpActionId[]): void {
  writeJson(KEY, { version: STORED_VERSION, ids } satisfies StoredCpToolFavorites);
}

/**
 * `null` until something reads or writes, then the resolved list.
 *
 * Cached because `cpToolFavoriteIds` is called from render and from pointer
 * handlers; re-parsing JSON on each would be silly. It is only ever `null` again
 * after {@link resetCpToolFavorites}.
 */
let current: readonly OristudioCpActionId[] | null = null;
const listeners = new Set<() => void>();

/** The starred tools, in the user's order. */
export function cpToolFavoriteIds(): readonly OristudioCpActionId[] {
  current ??= readStored() ?? CP_DEFAULT_FAVORITE_ACTION_IDS;
  return current;
}

export function isCpToolFavorite(actionId: OristudioCpActionId): boolean {
  return cpToolFavoriteIds().includes(actionId);
}

/**
 * Star or un-star, appending on add so the newest favorite lands at the end.
 *
 * Appending rather than inserting in catalogue order: a list the user can drag
 * should not also silently sort itself, and "the one I just added is at the
 * bottom" is the only rule that stays true after they have reordered it.
 */
export function toggleCpToolFavorite(actionId: OristudioCpActionId): void {
  const ids = cpToolFavoriteIds();
  commit(ids.includes(actionId) ? ids.filter((id) => id !== actionId) : [...ids, actionId]);
}

/**
 * Move a favorite to `toIndex`, clamped into range.
 *
 * Called on every pointer move of a drag, so the no-op case has to be genuinely
 * free: an unchanged order returns before writing and before notifying, or a
 * finger held still would write to `localStorage` at pointer-event rate and
 * re-render the sheet with it.
 */
export function moveCpToolFavorite(actionId: OristudioCpActionId, toIndex: number): void {
  const ids = cpToolFavoriteIds();
  const from = ids.indexOf(actionId);
  if (from === -1) return;
  const to = Math.max(0, Math.min(ids.length - 1, Math.trunc(toIndex)));
  if (to === from) return;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, actionId);
  commit(next);
}

/**
 * The favorited tools as catalogue definitions, in the user's order.
 *
 * Unresolvable ids are dropped *here* rather than at read time, so a tool that
 * is temporarily absent from the catalogue does not permanently delete itself
 * from someone's favorites — it comes back when the catalogue does.
 */
export function cpFavoriteToolActions(): readonly OristudioCpActionDefinition[] {
  return cpToolFavoriteIds()
    .map((id) => cpActionById(id))
    .filter((action): action is OristudioCpActionDefinition => action !== undefined);
}

/** Test seam. Drops the cache *and* the stored key, back to a first-run user. */
export function resetCpToolFavorites(): void {
  current = null;
  removeKey(KEY);
  notify();
}

function commit(next: readonly OristudioCpActionId[]): void {
  current = next;
  writeStored(next);
  notify();
}

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export interface CpToolFavorites {
  ids: readonly OristudioCpActionId[];
  isFavorite: (actionId: OristudioCpActionId) => boolean;
  toggle: (actionId: OristudioCpActionId) => void;
  move: (actionId: OristudioCpActionId, toIndex: number) => void;
}

/** Reactive {@link cpToolFavoriteIds}, plus the verbs that change it. */
export function useCpToolFavorites(): CpToolFavorites {
  const ids = useSyncExternalStore(
    subscribe,
    cpToolFavoriteIds,
    () => CP_DEFAULT_FAVORITE_ACTION_IDS
  );
  return {
    ids,
    isFavorite: isCpToolFavorite,
    toggle: toggleCpToolFavorite,
    move: moveCpToolFavorite,
  };
}
