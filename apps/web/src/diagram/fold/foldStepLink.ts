/**
 * How a Diagram step linked to a Fold step stands (fold-workspace plan D17).
 * Derived, never stored, as every link's status is: a sequence changed while
 * the diagram was closed must reopen saying so.
 *
 * - `missing`: there is nothing to show — the sequence or the step is gone,
 *   or the step no longer folds (broken: its inputs no longer resolve).
 * - `unknown`: it cannot be told yet — the sequence is not the one Fold has
 *   replayed (only the shown sequence is), its replay has not reached the
 *   step, or the step was made by a newer build and is locked.
 * - `current`: the state the picture shows is the state the step's path
 *   lands now: the same `fs1`, along the same `fh1`.
 * - `stale`: it lands another state now; Refresh captures it again, and
 *   Refresh all counts it.
 *
 * One departure from the plan's wording, by design: a path whose `fh1`
 * changed under a step that still lands is `stale`, not `missing`. A step's
 * id never moves to another path — the tree is append-only (D6) — so its
 * path changes only when the sheet does under it: Front up / Back up keeps
 * every step and mirrors what it folds (`setFoldStartSide`). The step is
 * still there to capture, so Refresh, not Relink, is what the reader needs.
 * The engine version is diagnostic only: a new engine that lands the same
 * state leaves the link current.
 *
 * Pure: no React, no store, no engine.
 */

import { foldNodeDigest } from '../../fold/document/foldDigest';
import type { FoldStepStatus } from '../../fold/document/foldReplay';
import type { FoldSequenceDocument, FoldStepNode } from '../../fold/document/foldSequenceDocument';
import { foldStepTree, lockedIds, pathBetween } from '../../fold/document/foldStepTree';
import type { DiagramLinkStatus } from '../capture/linkStatus';
import { lastFoldStepOf, type DiagramFoldStepSource } from '../document/diagramDocument';

/** A replayed node as a link reads it: its status, and the `fs1` it landed once it has. */
export interface FoldReplayedNode {
  readonly status: FoldStepStatus;
  readonly fingerprint: string | null;
}

/** What the Fold session has replayed: the sequence it shows, its sheet and its steps. */
export interface FoldLinkReplay {
  /** The sequence replayed; null while there is none (Fold shows its blank square). */
  readonly sequenceId: string | null;
  readonly sheet: FoldReplayedNode;
  readonly nodes: ReadonlyMap<string, FoldReplayedNode>;
}

/** What a Fold step's link is told against. */
export interface FoldLinkContext {
  /** The project's sequences, as the store holds them. */
  readonly sequences: readonly { readonly document: FoldSequenceDocument }[];
  /** The Fold session's replay; null while nothing holds the session. */
  readonly replay: FoldLinkReplay | null;
}

/** The link context with no sequence and no replay: every Fold link is missing. */
export const NO_FOLD_LINKS: FoldLinkContext = { sequences: [], replay: null };

/** The sequence a link names, from the project's; null when it is gone. */
export function linkedFoldSequence(
  source: Pick<DiagramFoldStepSource, 'sequence'>,
  sequences: FoldLinkContext['sequences']
): FoldSequenceDocument | null {
  return sequences.find((held) => held.document.id === source.sequence)?.document ?? null;
}

/**
 * The replayed node whose state the picture shows: the step's own for
 * `after`, its parent's — or the sheet's — for `before`. Null when the replay
 * holds none.
 */
export function shownFoldNode(
  source: Pick<DiagramFoldStepSource, 'moment'>,
  parent: string | null,
  own: FoldReplayedNode,
  replay: FoldLinkReplay
): FoldReplayedNode | null {
  if (source.moment === 'after') return own;
  return parent === null ? replay.sheet : (replay.nodes.get(parent) ?? null);
}

/**
 * The step a link names and its sequence, when this build can fold to it —
 * for a run of steps (`through`), its first and its last, which must fold
 * from the first; otherwise the status no replay can change — gone
 * (`missing`), or a newer build's (`unknown`).
 */
function linkedFoldNode(
  source: DiagramFoldStepSource,
  sequences: FoldLinkContext['sequences']
): { document: FoldSequenceDocument; first: FoldStepNode; last: FoldStepNode } | 'missing' | 'unknown' {
  const document = linkedFoldSequence(source, sequences);
  if (!document) return 'missing';
  const tree = foldStepTree(document.steps);
  const run = pathBetween(tree, source.step, lastFoldStepOf(source));
  const first = run?.[0];
  const last = run?.at(-1);
  if (!first || !last) return 'missing';
  // A step locked behind a newer build's locks every step after it, the run's last too.
  return lockedIds(tree).has(last.id) ? 'unknown' : { document, first, last };
}

/**
 * Whether the Fold session's replay can tell this link: its step folds in
 * this build and is in the sequence Fold shows — the first (D7), the only one
 * the session replays. Every other link is told without the replay, so a
 * diagram holding only those has no reason to start the engine.
 */
export function foldLinkNeedsReplay(source: DiagramFoldStepSource, sequences: FoldLinkContext['sequences']): boolean {
  const linked = linkedFoldNode(source, sequences);
  return typeof linked !== 'string' && linked.document.id === sequences[0]?.document.id;
}

/** How a Fold step's link stands; see the module's comment for each word. */
export function foldStepLinkStatus(source: DiagramFoldStepSource, context: FoldLinkContext): DiagramLinkStatus {
  const linked = linkedFoldNode(source, context.sequences);
  if (typeof linked === 'string') return linked;
  const { document, first, last } = linked;
  const { replay } = context;
  if (!replay || replay.sequenceId !== document.id) return 'unknown';
  // A run has landed when its last step has: every step before it landed first.
  const replayed = replay.nodes.get(last.id);
  if (!replayed) return 'unknown';
  switch (replayed.status) {
    case 'pending':
    case 'locked':
      return 'unknown';
    case 'broken':
      return 'missing';
    case 'ok':
    case 'changed':
      break;
  }
  // Before a run, the state its first step folds from.
  const shown = shownFoldNode(source, first.parent, replayed, replay);
  if (!shown?.fingerprint) return 'unknown';
  // The last step's path names every step of the run: a change to any of them changes it.
  const samePath = foldNodeDigest(document, last.id) === source.path;
  return samePath && shown.fingerprint === source.state ? 'current' : 'stale';
}
