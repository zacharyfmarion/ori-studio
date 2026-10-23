/**
 * A workspace's starred tools, and their order: the store behind a phone's
 * Favorites section and the bar it fills. Edit's (`cpToolFavorites`) and
 * Fold's (`foldToolFavorites`) are each one of these, under keys of their own,
 * so a star in one workspace never shows in the other.
 *
 * # Absent means "use the defaults"
 *
 * The stored key is written on the first *edit*, not on first read. That is the
 * whole persistence design, and both of its consequences are wanted:
 *
 * - Someone who never customises tracks whatever we ship. Change a workspace's
 *   defaults in six months and they get the better list without a migration.
 * - Someone who un-stars a default persists an explicit list and is never
 *   surprised by a later default change. Their edit is the whole record.
 *
 * # Stored order is the displayed order
 *
 * Not catalogue order. This is what makes drag-reorder a splice and a write
 * rather than a second ordering concept kept in sync with the first — the array
 * *is* what the user sees.
 *
 * Module state with `useSyncExternalStore` rather than a store slice: one small
 * record, few subscribers, and no reason for the rest of the app to re-render
 * when a star is toggled.
 */
import { useSyncExternalStore } from 'react';
import { readJson, removeKey, writeJson } from './storage';

/** Version 1 of the stored shape. Present so a migration has something to branch on. */
const STORED_VERSION = 1;

interface StoredToolFavorites {
  version: number;
  ids: readonly string[];
}

export interface ToolFavoritesStore<Id extends string> {
  /** The starred tools, in the user's order. */
  ids: () => readonly Id[];
  isFavorite: (id: Id) => boolean;
  /**
   * Star or un-star, appending on add so the newest favorite lands at the end.
   *
   * Appending rather than inserting in catalogue order: a list the user can drag
   * should not also silently sort itself, and "the one I just added is at the
   * bottom" is the only rule that stays true after they have reordered it.
   */
  toggle: (id: Id) => void;
  /**
   * Move a favorite to `toIndex`, clamped into range.
   *
   * Called on every pointer move of a drag, so the no-op case has to be genuinely
   * free: an unchanged order returns before writing and before notifying, or a
   * finger held still would write to `localStorage` at pointer-event rate and
   * re-render the sheet with it.
   */
  move: (id: Id, toIndex: number) => void;
  /** Test seam. Drops the cache *and* the stored key, back to a first-run user. */
  reset: () => void;
  /** Reactive {@link ids}: the same array identity until something changes it. */
  useIds: () => readonly Id[];
}

export function createToolFavoritesStore<Id extends string>({
  key,
  defaults,
}: {
  /** The full storage key (`storageKey(...)`). */
  key: string;
  /** What a user who has never edited their list sees. */
  defaults: readonly Id[];
}): ToolFavoritesStore<Id> {
  /**
   * The stored list, or `null` when the user has never edited theirs.
   *
   * Every malformed case collapses to `null` — wrong type, wrong version, `ids`
   * not an array — so a hand-edited or stale key falls back to the defaults
   * rather than to an empty list. An empty *array* is a different thing and is
   * honoured: it means someone deliberately un-starred everything.
   */
  function readStored(): Id[] | null {
    const raw = readJson<unknown>(key, null);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const stored = raw as Partial<StoredToolFavorites>;
    if (stored.version !== STORED_VERSION || !Array.isArray(stored.ids)) return null;
    return stored.ids.filter((id): id is Id => typeof id === 'string');
  }

  /**
   * `null` until something reads or writes, then the resolved list.
   *
   * Cached because the list is read from render and from pointer handlers;
   * re-parsing JSON on each would be silly. It is only ever `null` again after
   * `reset`.
   */
  let current: readonly Id[] | null = null;
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };
  const commit = (next: readonly Id[]) => {
    current = next;
    writeJson(key, { version: STORED_VERSION, ids: next } satisfies StoredToolFavorites);
    notify();
  };
  const subscribe = (onChange: () => void) => {
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  };

  const ids = (): readonly Id[] => {
    current ??= readStored() ?? defaults;
    return current;
  };

  return {
    ids,
    isFavorite: (id) => ids().includes(id),
    toggle: (id) => {
      const list = ids();
      commit(list.includes(id) ? list.filter((each) => each !== id) : [...list, id]);
    },
    move: (id, toIndex) => {
      const list = ids();
      const from = list.indexOf(id);
      if (from === -1) return;
      const to = Math.max(0, Math.min(list.length - 1, Math.trunc(toIndex)));
      if (to === from) return;
      const next = [...list];
      next.splice(from, 1);
      next.splice(to, 0, id);
      commit(next);
    },
    reset: () => {
      current = null;
      removeKey(key);
      notify();
    },
    useIds: () => useSyncExternalStore(subscribe, ids, () => defaults),
  };
}
