/**
 * Generic snapshot-based undo/redo, shared by the document types whose history is
 * "restore a whole previous snapshot" rather than command replay (BP now, CP
 * next). Each domain supplies its own snapshot type `S` plus capture/restore; this
 * module owns only the past/future bookkeeping so there is one implementation
 * instead of a bespoke copy per document.
 *
 * `past` is a stack (last element = next undo). `future` is a stack in the other
 * direction (first element = next redo), matching how a just-undone state is
 * pushed back for redo.
 */

export const MAX_SNAPSHOT_HISTORY = 100;

export interface SnapshotEntry<S> {
  snapshot: S;
  label: string;
  timestamp: string;
}

export interface SnapshotHistory<S> {
  past: SnapshotEntry<S>[];
  future: SnapshotEntry<S>[];
}

export function emptySnapshotHistory<S>(): SnapshotHistory<S> {
  return { past: [], future: [] };
}

export function snapshotEntry<S>(snapshot: S, label: string): SnapshotEntry<S> {
  return { snapshot, label, timestamp: new Date().toISOString() };
}

/**
 * Record a committed change: push the pre-change `entry` onto `past` and clear
 * the redo `future` (a new edit invalidates any redo branch).
 */
export function recordSnapshot<S>(
  history: SnapshotHistory<S>,
  entry: SnapshotEntry<S>,
): SnapshotHistory<S> {
  return {
    past: [...history.past, entry].slice(-MAX_SNAPSHOT_HISTORY),
    future: [],
  };
}

/**
 * Undo: pop the newest `past` entry to restore, pushing the caller-supplied
 * `current` snapshot onto `future` for redo. Returns `null` when there is
 * nothing to undo.
 */
export function undoSnapshot<S>(
  history: SnapshotHistory<S>,
  current: SnapshotEntry<S>,
): { restore: SnapshotEntry<S>; history: SnapshotHistory<S> } | null {
  const restore = history.past.at(-1);
  if (!restore) return null;
  return {
    restore,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future].slice(0, MAX_SNAPSHOT_HISTORY),
    },
  };
}

/**
 * Redo: take the first `future` entry to restore, pushing the caller-supplied
 * `current` snapshot back onto `past`. Returns `null` when there is nothing to
 * redo.
 */
export function redoSnapshot<S>(
  history: SnapshotHistory<S>,
  current: SnapshotEntry<S>,
): { restore: SnapshotEntry<S>; history: SnapshotHistory<S> } | null {
  const restore = history.future[0];
  if (!restore) return null;
  return {
    restore,
    history: {
      past: [...history.past, current].slice(-MAX_SNAPSHOT_HISTORY),
      future: history.future.slice(1),
    },
  };
}
