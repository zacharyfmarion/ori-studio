/**
 * The dialog's own undo history, independent of the workspace's
 * (spec §6.5; plan, "The inspector's behaviour").
 *
 * Every inspector action is one entry (your words, 2026-10-26: "cmd + z
 * should undo adding a single constraint or setting the subject (so basically
 * any action)"); what an entry holds is the reducer's (`LayerUndoEntry`,
 * `layerOrderState.ts`). An entry that changed the list holds the whole list,
 * never an order: as on the approved artboard (Round3 `undo`, `redo`),
 * stepping back commits the earlier list and shows the fitting order closest
 * to the one on screen, so undo never jumps the figure back to an order the
 * user has since moved away from.
 *
 * The history moves only when the commit or step it asks for lands: an undo
 * whose re-solve runs out of time leaves the history where it was. Edits to
 * the sentence go on at once, even while a commit or step is in flight; they
 * came after it, so they stay on top of it when it lands ({@link landed}).
 *
 * Pure: no React, no store, no engine calls.
 */

export interface LayerHistory<T> {
  /** What undo goes back to, oldest first. */
  readonly past: readonly T[];
  /** What redo goes forward to, the next redo first. */
  readonly future: readonly T[];
}

export function emptyHistory<T>(): LayerHistory<T> {
  return { past: [], future: [] };
}

/** A new edit from `present`: it goes on the past, and the future is gone (Round3 `commit` with no history given). */
export function recorded<T>(history: LayerHistory<T>, present: T): LayerHistory<T> {
  return { past: [...history.past, present], future: [] };
}

export function canUndo<T>(history: LayerHistory<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: LayerHistory<T>): boolean {
  return history.future.length > 0;
}

/** The entry undo goes back to, or null. */
export function undoTarget<T>(history: LayerHistory<T>): T | null {
  return history.past.length > 0 ? history.past[history.past.length - 1]! : null;
}

/** The entry redo goes forward to, or null. */
export function redoTarget<T>(history: LayerHistory<T>): T | null {
  return history.future.length > 0 ? history.future[0]! : null;
}

/** How the history moves once a commit or a step lands, or at once with nothing to wait for (`at` the past's length). */
export type LayerHistoryMove<T> =
  /** Not at all: a restored record's rows applied together (D10) are no edit of the user's. */
  | { readonly kind: 'none' }
  /** A new edit: `entry` is what undo goes back to. */
  | { readonly kind: 'record'; readonly entry: T }
  /** The last entry is undone: `present` is what redo goes forward to. */
  | { readonly kind: 'undo'; readonly present: T }
  /** The next entry is redone: `present` is what undo goes back to. */
  | { readonly kind: 'redo'; readonly present: T };

/**
 * The history once a commit or a step, asked when the past held `at`
 * entries, lands with `move`. The sentence's edits recorded since were made
 * while it was in flight, after it: they stay on top of it, and the future
 * they dropped stays dropped. Nothing else changes the history while a commit
 * or a step is in flight, or while a commit that ran out waits on Keep trying
 * (any other edit lets it go), so the past has only grown since `at`.
 */
export function landed<T>(history: LayerHistory<T>, at: number, move: LayerHistoryMove<T>): LayerHistory<T> {
  if (move.kind === 'none') return history;
  const before = history.past.slice(0, at);
  const since = history.past.slice(at);
  const edited = since.length > 0;
  switch (move.kind) {
    case 'record':
      return { past: [...before, move.entry, ...since], future: [] };
    case 'undo':
      return { past: [...before.slice(0, -1), ...since], future: edited ? [] : [move.present, ...history.future] };
    case 'redo':
      return { past: [...before, move.present, ...since], future: edited ? [] : history.future.slice(1) };
  }
}
