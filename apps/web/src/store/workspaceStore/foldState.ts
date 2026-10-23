import {
  initialFoldReaderState,
  reconcileFoldReaderState,
  settleFoldReaderState,
  type FoldDocumentChangeCause,
  type FoldReaderState,
} from '../../fold/document/foldReaderState';
import { isLockedStep } from '../../fold/document/foldSequenceDocument';
import type { HeldFoldSequence } from '../../fold/document/foldSequenceFile';
import { loadIdSequence, pickScopedState } from './projectDocumentHistory';
import { emptySnapshotHistory, type SnapshotHistory } from './snapshotHistory';
import type { WorkspaceState } from './types';

/**
 * The project's fold sequences as the store holds them (plan D7): each with
 * the value a read-only one is written back as, in the file's order. Empty
 * for none — the key is then left out of the file.
 */
export type FoldSequences = readonly HeldFoldSequence[];

/** The history holds the whole array, so an edit that creates the first sequence is undone to none. */
export type FoldHistory = SnapshotHistory<FoldSequences>;

/**
 * The keys whose values belong to *the project's fold sequences*, and must all
 * be replaced together when the project is. A project-level document, like
 * the Diagram's (`DIAGRAM_SCOPED_KEYS`), so it survives everything that
 * replaces the crease pattern or a design.
 *
 * A tuple rather than only a type so a test can prove each project-replacing
 * entry point resets every key without keeping its own copy of the list.
 */
export const FOLD_SCOPED_KEYS = ['foldSequences', 'foldHistory', 'foldLoadId', 'foldReader'] as const;

/**
 * Everything scoped to the fold sequences. Not `Partial`: adding a key to
 * {@link FOLD_SCOPED_KEYS} is a compile error until every producer says what
 * happens to it when the project is replaced.
 */
export type FoldScopedState = {
  [K in (typeof FOLD_SCOPED_KEYS)[number]]: WorkspaceState[K];
};

/**
 * A new load id. Every replacement of the sequences takes one, so work
 * started against them — a replay, a preview the worker is still folding —
 * can tell they have been replaced before it writes into their successor
 * (`foldReplay`'s `loadId`).
 */
export const nextFoldLoadId = loadIdSequence();

/** Let go of the project's fold sequences, for a replacement that brings its own (or none). */
export function discardFoldState(): FoldScopedState {
  return {
    foldSequences: [],
    foldHistory: emptySnapshotHistory(),
    foldLoadId: nextFoldLoadId(),
    foldReader: null,
  };
}

/** The fold-scoped state as it stands, to put back with one `set`. */
export function pickFoldState(state: WorkspaceState): FoldScopedState {
  return pickScopedState(state, FOLD_SCOPED_KEYS);
}

/**
 * The sequence on screen: the first. Several are saved, one is shown (plan
 * D7), so showing another is a change to this and the UI only. Null for none:
 * the first edit creates one.
 */
export function shownFoldSequence(state: Pick<WorkspaceState, 'foldSequences'>): HeldFoldSequence | null {
  return state.foldSequences[0] ?? null;
}

/** Whether the sequence on screen is a newer build's: shown, never changed. */
export function isShownFoldSequenceReadOnly(state: Pick<WorkspaceState, 'foldSequences'>): boolean {
  return shownFoldSequence(state)?.readOnlyRaw != null;
}

/**
 * The reader state for sequences read from a file, held to the one shown
 * (`settleFoldReaderState`): a state naming another, or none, starts at its
 * sheet. Null with no sequence.
 */
export function settledFoldReader(reader: FoldReaderState | null, sequences: FoldSequences): FoldReaderState | null {
  const shown = sequences[0];
  if (!shown) return null;
  return settleFoldReaderState(reader ?? initialFoldReaderState(shown.document.id), shown.document);
}

/**
 * The reader state once the sequences went from `before` to `after` (plan D6,
 * `reconcileFoldReaderState`): a cursor whose step is gone moves to its
 * nearest surviving ancestor, an active child that is gone is dropped, and a
 * redo moves the cursor to the step it restores. A sequence the reader was
 * not in — the first one made, or one a redo brings back — starts at its
 * sheet, and a redo then takes the cursor to its restored step, as for any
 * other. Null once there is none. `reader` itself when nothing moves.
 */
export function foldReaderAfter(
  reader: FoldReaderState | null,
  before: FoldSequences,
  after: FoldSequences,
  cause: FoldDocumentChangeCause
): FoldReaderState | null {
  const shown = after[0];
  if (!shown) return null;
  const document = shown.document;
  const state = reader?.sequenceId === document.id ? reader : initialFoldReaderState(document.id);
  // A sequence the change brought into being held no steps before it.
  const was = before.find((held) => held.document.id === document.id)?.document ?? { ...document, steps: [] };
  return reconcileFoldReaderState(state, { before: was, after: document, cause });
}

const lockedBytes = new WeakMap<object, number>();

/** The JSON size of a step this build carries unread, measured once. */
function carriedBytes(value: object): number {
  const cached = lockedBytes.get(value);
  if (cached !== undefined) return cached;
  const size = JSON.stringify(value)?.length ?? 0;
  lockedBytes.set(value, size);
  return size;
}

/**
 * About how many bytes of embedded data the sequences put in the file, for
 * the save notice: the crease patterns and orders Import CP embeds (plan
 * D16), and the steps a newer build wrote, which may embed them too.
 * Everything else is a few fields a step.
 */
export function foldSequenceDataBytes(sequences: FoldSequences): number {
  let total = 0;
  for (const { document } of sequences) {
    for (const node of document.steps) {
      if (isLockedStep(node)) total += carriedBytes(node.unknown);
      else if (node.op.kind === 'cp-jump') total += node.op.cpJson.length + node.op.orderJson.length;
    }
  }
  return total;
}
