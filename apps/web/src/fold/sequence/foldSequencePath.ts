/**
 * The active path as the sequence chrome shows it (plan D6, D14): the flat
 * sheet and every step the reader follows, numbered as a diagram numbers
 * them, each with its standing and the branches beside it — and the moves
 * between them that the strip's chevrons, its ways row and the keys make.
 *
 * - **Numbers.** The sheet is 0 and every step that folds takes the next one;
 *   a turn over or a rotation takes none (plan, owner decisions), so the
 *   steps either side of it read 3 and 4.
 * - **Branches.** A step's branches are its siblings: the steps folded from
 *   the same state, in the order they were made. A step among two or more
 *   reads "1 of 2", and the up and down moves go to its neighbours — the
 *   cursor moves there, and the active path runs through it.
 * - **Standing** is the session's (`FoldSessionNode`), with one distinction
 *   the Step pane makes: a step under a broken one is not broken itself, it
 *   could not be reached.
 *
 * Pure: no React, no store, no engine.
 */
import {
  isLockedStep,
  type FoldSequenceDocument,
  type FoldStepNode,
} from '../document/foldSequenceDocument';
import { childrenOf, FOLD_SHEET_KEY, foldStepTree, subtreeIds } from '../document/foldStepTree';
import type { FoldStepStatus as FoldReplayStatus } from '../document/foldReplay';
import type { FoldSessionNode } from '../session/foldSessionState';

/** What an entry is: the flat sheet, a step that folds (numbered), or a turn (not). */
export type FoldPathEntryKind = 'sheet' | 'fold' | 'turn';

/** An entry's standing: the replay's, and `brokenAbove` for a step a broken one keeps from being reached. */
export type FoldEntryStatus = FoldReplayStatus | 'brokenAbove';

export interface FoldPathBranches {
  /** The step and its siblings, in the order they were made. */
  readonly ids: readonly string[];
  /** Which of them the entry is. */
  readonly index: number;
}

export interface FoldPathEntry {
  /** The step's id; null for the flat sheet. */
  readonly id: string | null;
  /** The key a list keys the entry by: the step's id, or {@link FOLD_SHEET_KEY}. */
  readonly key: string;
  readonly node: FoldStepNode | null;
  readonly kind: FoldPathEntryKind;
  /** The sheet is 0; each step that folds the next; a turn null. */
  readonly number: number | null;
  readonly status: FoldEntryStatus;
  /** Its replay, from the session. */
  readonly session: FoldSessionNode;
  /** Its branches, when it has siblings; null otherwise. The sheet has none. */
  readonly branches: FoldPathBranches | null;
}

/** Whether a step turns the model rather than folding it: unnumbered (plan, owner decisions). */
export function isTurnStep(node: FoldStepNode): boolean {
  return !isLockedStep(node) && (node.op.kind === 'turn' || node.op.kind === 'rotate');
}

function entryStatus(id: string | null, session: FoldSessionNode): FoldEntryStatus {
  if (session.status === 'broken' && session.refusal && session.refusal.at !== id) return 'brokenAbove';
  return session.status;
}

/**
 * The sheet and the active path, in order. `activePath` is the session's
 * (the step ids from the first); `nodes` and `sheet` its replay of them.
 */
export function foldPathEntries(
  document: FoldSequenceDocument,
  activePath: readonly string[],
  sheet: FoldSessionNode,
  nodes: ReadonlyMap<string, FoldSessionNode>,
  pendingNode: FoldSessionNode
): FoldPathEntry[] {
  const tree = foldStepTree(document.steps);
  const entries: FoldPathEntry[] = [
    {
      id: null,
      key: FOLD_SHEET_KEY,
      node: null,
      kind: 'sheet',
      number: 0,
      status: entryStatus(null, sheet),
      session: sheet,
      branches: null,
    },
  ];
  let number = 0;
  for (const id of activePath) {
    const node = tree.byId.get(id);
    if (!node) continue;
    const turn = isTurnStep(node);
    if (!turn) number += 1;
    const siblings = childrenOf(tree, node.parent);
    const session = nodes.get(id) ?? pendingNode;
    entries.push({
      id,
      key: id,
      node,
      kind: turn ? 'turn' : 'fold',
      number: turn ? null : number,
      status: entryStatus(id, session),
      session,
      branches: siblings.length > 1 ? { ids: siblings.map((each) => each.id), index: siblings.indexOf(node) } : null,
    });
  }
  return entries;
}

/** Where the cursor's entry is in the path; 0, the sheet, when the cursor is on no entry. */
export function cursorIndex(entries: readonly FoldPathEntry[], cursor: string | null): number {
  const index = entries.findIndex((entry) => entry.id === cursor);
  return index < 0 ? 0 : index;
}

/** How many steps in the path fold: the numbered ones, the header's count. */
export function foldedStepCount(entries: readonly FoldPathEntry[]): number {
  return entries.filter((entry) => entry.kind === 'fold').length;
}

/** The moves from the cursor: each the step it goes to (null for the sheet), or undefined where there is none. */
export interface FoldPathMoves {
  previous: string | null | undefined;
  next: string | null | undefined;
  previousBranch: string | undefined;
  nextBranch: string | undefined;
}

/**
 * The moves from the entry at `index`: along the path, back to the sheet at
 * most and on to its tip; and between the branches at it, without wrapping,
 * so the ends read as ends.
 */
export function foldPathMoves(entries: readonly FoldPathEntry[], index: number): FoldPathMoves {
  const here = entries[index];
  const branches = here?.branches ?? null;
  return {
    previous: index > 0 ? (entries[index - 1]?.id ?? null) : undefined,
    next: index + 1 < entries.length ? (entries[index + 1]?.id ?? undefined) : undefined,
    previousBranch: branches && branches.index > 0 ? branches.ids[branches.index - 1] : undefined,
    nextBranch: branches && branches.index + 1 < branches.ids.length ? branches.ids[branches.index + 1] : undefined,
  };
}

/**
 * The branch a tap on a phone's branch readout switches to from the entry at
 * `index`: the next, and the first after the last — one control that steps
 * through them all, where the keys and chevrons stop at the ends. Undefined
 * where the entry has no other branch.
 */
export function cycledBranch(entries: readonly FoldPathEntry[], index: number): string | undefined {
  const branches = entries[index]?.branches;
  if (!branches || branches.ids.length < 2) return undefined;
  return branches.ids[(branches.index + 1) % branches.ids.length];
}

/** The step at the path's tip; null for the sheet when there is none. */
export function foldPathTip(entries: readonly FoldPathEntry[]): string | null {
  return entries[entries.length - 1]?.id ?? null;
}

/** How many steps fold from `id`, on every branch: what deleting it takes with it. */
export function followerCount(document: FoldSequenceDocument, id: string): number {
  return Math.max(0, subtreeIds(foldStepTree(document.steps), id).size - 1);
}
