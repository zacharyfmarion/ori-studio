/**
 * The reader's place in a Fold sequence (plan D6): which sequence is shown,
 * the step on screen, and which branch each step continues along.
 *
 * It lives in `workspace.viewState.fold`, outside the document and outside
 * undo, after References' reader state and the Diagram's view state: moving
 * the cursor or switching a branch records nothing, and never makes an edit
 * that changed nothing look like a change. So undo, redo and delete can take
 * away what it names, and each is followed by
 * {@link reconcileFoldReaderState}:
 *
 * - a cursor whose node is gone moves to its nearest surviving ancestor, or
 *   to the sheet;
 * - an active child that is gone is dropped, and the newest child applies;
 * - redo moves the cursor to the node it restores.
 *
 * Every function returns the state it was given when nothing changes, so a
 * store can skip the update.
 *
 * Pure: no React, no store.
 */

import { isRecord } from '../../lib/documentFile';
import type { FoldSequenceDocument, FoldStepNode } from './foldSequenceDocument';
import {
  activePath,
  foldStepTree,
  parentKey,
  pathTo,
  type FoldActiveChildren,
  type FoldStepTree,
} from './foldStepTree';

export const FOLD_READER_STATE_VERSION = 1;

export interface FoldReaderState {
  v: typeof FOLD_READER_STATE_VERSION;
  /** The sequence shown. */
  sequenceId: string;
  /** The step on screen; null for the flat sheet. */
  cursor: string | null;
  /**
   * Which child each step — and the sheet, under `FOLD_SHEET_KEY` — continues
   * along. A step with no entry, or one naming no child of it, takes its
   * newest child.
   */
  activeChild: FoldActiveChildren;
}

/** At the flat sheet of `sequenceId`, every step taking its newest child. */
export function initialFoldReaderState(sequenceId: string): FoldReaderState {
  return { v: FOLD_READER_STATE_VERSION, sequenceId, cursor: null, activeChild: {} };
}

/**
 * Read `workspace.viewState.fold` leniently: null for no reader state, or one
 * this build cannot read — a newer version, or no sequence. A cursor or an
 * active child that does not read is let go; the document decides later
 * whether the rest still names anything ({@link settleFoldReaderState}).
 */
export function readFoldReaderState(value: unknown): FoldReaderState | null {
  if (!isRecord(value) || value.v !== FOLD_READER_STATE_VERSION) return null;
  const { sequenceId, cursor } = value;
  if (typeof sequenceId !== 'string' || sequenceId.length === 0) return null;
  const activeChild = isRecord(value.activeChild)
    ? Object.fromEntries(
        Object.entries(value.activeChild).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0
        )
      )
    : {};
  return {
    v: FOLD_READER_STATE_VERSION,
    sequenceId,
    cursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null,
    activeChild,
  };
}

/** The reader state as written. */
export function writeFoldReaderState(state: FoldReaderState): Record<string, unknown> {
  return { v: state.v, sequenceId: state.sequenceId, cursor: state.cursor, activeChild: { ...state.activeChild } };
}

/** The active path the reader follows in `document`. */
export function foldReaderActivePath(document: FoldSequenceDocument, state: FoldReaderState): FoldStepNode[] {
  return activePath(foldStepTree(document.steps), state.activeChild);
}

/**
 * The state held to `document`: a reader state of another sequence starts
 * over at its sheet, a cursor on no node of it goes to the sheet, and an
 * active child that is no child of its step is dropped. For a state read from
 * a file, and for anything that replaces the document with no `before` to
 * find a cursor's ancestors in.
 */
export function settleFoldReaderState(state: FoldReaderState, document: FoldSequenceDocument): FoldReaderState {
  if (state.sequenceId !== document.id) return initialFoldReaderState(document.id);
  const tree = foldStepTree(document.steps);
  const cursor = state.cursor !== null && tree.byId.has(state.cursor) ? state.cursor : null;
  return withState(state, cursor, survivingChildren(tree, state.activeChild));
}

/**
 * Put the cursor on `id` — the sheet for null — and make the active path run
 * through it, so the step strip shows where the reader is. A node `document`
 * does not hold changes nothing.
 */
export function withFoldCursor(
  state: FoldReaderState,
  document: FoldSequenceDocument,
  id: string | null
): FoldReaderState {
  if (id === null) return withState(state, null, state.activeChild);
  const path = pathTo(foldStepTree(document.steps), id);
  if (!path) return state;
  // Built from entries, so every id is an own key, whatever it is spelled.
  const activeChild = Object.fromEntries([
    ...Object.entries(state.activeChild),
    ...path.map((node) => [parentKey(node), node.id] as const),
  ]);
  return withState(state, id, activeChild);
}

/** What took the document from `before` to `after`. */
export type FoldDocumentChangeCause = 'undo' | 'redo' | 'delete';

export interface FoldDocumentChange {
  before: FoldSequenceDocument;
  after: FoldSequenceDocument;
  cause: FoldDocumentChangeCause;
}

/**
 * The reader state after an undo, a redo or a delete took the document from
 * `before` to `after` (plan D6):
 *
 * - a cursor whose node is gone moves to its nearest ancestor `after` still
 *   holds, or to the sheet;
 * - an active child that is gone is dropped, so the newest child applies;
 * - a redo that restores steps moves the cursor to the one it restores — the
 *   topmost, for a subtree — and the active path through it.
 *
 * A change that replaced the sequence itself starts over at its sheet.
 */
export function reconcileFoldReaderState(
  state: FoldReaderState,
  { before, after, cause }: FoldDocumentChange
): FoldReaderState {
  if (state.sequenceId !== after.id) return initialFoldReaderState(after.id);
  const beforeTree = foldStepTree(before.steps);
  const afterTree = foldStepTree(after.steps);
  const cursor =
    state.cursor === null || afterTree.byId.has(state.cursor)
      ? state.cursor
      : survivingAncestor(beforeTree, afterTree, state.cursor);
  const reconciled = withState(state, cursor, survivingChildren(afterTree, state.activeChild));
  if (cause !== 'redo') return reconciled;
  const restored = after.steps.filter((node) => !beforeTree.byId.has(node.id));
  const topmost = restored.filter((node) => node.parent === null || beforeTree.byId.has(node.parent));
  const target = topmost[topmost.length - 1];
  return target ? withFoldCursor(reconciled, after, target.id) : reconciled;
}

/** The nearest ancestor of `id` in `before` that `after` still holds; null for the sheet. */
function survivingAncestor(before: FoldStepTree, after: FoldStepTree, id: string): string | null {
  const path = pathTo(before, id);
  if (!path) return null;
  for (let at = path.length - 2; at >= 0; at -= 1) {
    if (after.byId.has(path[at].id)) return path[at].id;
  }
  return null;
}

/** The active children that are still children of their step. */
function survivingChildren(tree: FoldStepTree, activeChild: FoldActiveChildren): FoldActiveChildren {
  const kept = Object.entries(activeChild).filter(([key, id]) => {
    const child = tree.byId.get(id);
    return child !== undefined && parentKey(child) === key;
  });
  return kept.length === Object.keys(activeChild).length ? activeChild : Object.fromEntries(kept);
}

/** `state` with this cursor and these active children: `state` itself when both are as they were. */
function withState(
  state: FoldReaderState,
  cursor: string | null,
  activeChild: FoldActiveChildren
): FoldReaderState {
  if (cursor === state.cursor && sameChildren(activeChild, state.activeChild)) return state;
  return { ...state, cursor, activeChild };
}

function sameChildren(a: FoldActiveChildren, b: FoldActiveChildren): boolean {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
