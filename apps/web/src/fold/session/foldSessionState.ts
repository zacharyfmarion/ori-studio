/**
 * What the Fold session tells its surfaces (plan D6, D14): every node's
 * status and state, the step on screen, how far the replay has come, and the
 * step a tool is folding before it is committed.
 *
 * A snapshot is derived, never stored: from the document the store holds, the
 * newest replay progress for it (`foldReplay`), and what the engine said of
 * each landed state. The derivation keeps a node's object while nothing about
 * it changed, so a selector on one node re-renders only when that node does.
 *
 * Pure: no React, no store, no worker.
 */

import type { WasmErrorEnvelope } from '../../engine/types';
import { foldPathDigest, type FoldPathDigest, type FoldStateFingerprint } from '../document/foldDigest';
import type {
  FoldNodeReplay,
  FoldReplayProgress,
  FoldReplayRefusal,
  FoldStepStatus,
} from '../document/foldReplay';
import {
  createFoldSequence,
  SQUARE_PAPER,
  type FoldChoices,
  type FoldPaper,
  type FoldSequenceDocument,
} from '../document/foldSequenceDocument';
import { foldStepTree, pathTo } from '../document/foldStepTree';
import type { FoldCompoundReport } from '../engine/foldEngineCompoundWire';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import type {
  FoldAnalysis,
  FoldEngineOp,
  FoldEngineRefused,
  FoldReport,
  FoldStateSummary,
  FoldStepLanded,
} from '../engine/foldEngineWire';

/**
 * What a project with no sequence shows: the flat square its first edit
 * creates (the slice's `base`), so a tool can fold it before anything is
 * saved. Never written; its id names nothing in a file.
 */
export const FOLD_BLANK_SEQUENCE: FoldSequenceDocument = createFoldSequence(SQUARE_PAPER, '', () => 'fold-blank');

/** What the engine said of a landed state, beside its handle. */
export interface FoldStateDetails {
  readonly summary: FoldStateSummary;
  /** What a plain fold did; null for the sheet, a turn, a rotation, an import and a compound fold. */
  readonly report: FoldReport | null;
  /** What a compound fold of any family did, tagged by its family; absent for any other step. */
  readonly compound?: FoldCompoundReport;
}

/**
 * What the engine said of a state it landed, from its answer: the one way a
 * landed step's summary and reports reach the session — a replay's step, a
 * preview, a commit, or a step a compound family's own call landed — so a
 * compound fold of any family keeps its report wherever it landed.
 */
export function foldStateDetailsOf(answer: Pick<FoldStepLanded, 'summary' | 'report' | 'compound'>): FoldStateDetails {
  return {
    summary: answer.summary,
    report: answer.report,
    ...(answer.compound ? { compound: answer.compound } : {}),
  };
}

/** A node of the shown sequence, or its sheet, as the surfaces read it. */
export interface FoldSessionNode {
  readonly status: FoldStepStatus;
  /** Its path's identity (`fh1`) once replayed; null while pending. */
  readonly path: FoldPathDigest | null;
  /** Its landed state while ok or changed: a handle of the engine that landed it. */
  readonly state: FoldEngineStateHandle | null;
  readonly fingerprint: FoldStateFingerprint | null;
  /** The state at a glance, once landed. */
  readonly summary: FoldStateSummary | null;
  /** What the step did, once landed; null for the sheet, a turn and a rotation. */
  readonly report: FoldReport | null;
  /** What a compound fold of any family did, once landed; absent for any other step. */
  readonly compound?: FoldCompoundReport;
  /** Set when broken: the node that refused (null for the sheet) and the engine's code. */
  readonly refusal: FoldReplayRefusal | null;
}

export const FOLD_PENDING_NODE: FoldSessionNode = Object.freeze({
  status: 'pending',
  path: null,
  state: null,
  fingerprint: null,
  summary: null,
  report: null,
  refusal: null,
});

/** How far the replay of the shown sequence has come. */
export interface FoldSessionProgress {
  /** A replay is under way. */
  readonly replaying: boolean;
  /** Steps of the active path with their status, and how many it has: what the step on screen waits for. */
  readonly activeSettled: number;
  readonly activeTotal: number;
  /** Every step with its status, and how many there are. */
  readonly settled: number;
  readonly total: number;
  /** The sheet and every step have their status. */
  readonly done: boolean;
}

/** A step a tool asks about: an op and its choices, folded from the step on screen. */
export interface FoldStepRequest {
  readonly op: FoldEngineOp;
  readonly choices?: FoldChoices;
}

/**
 * The step a tool is folding before it is committed (plan D14 tier 3): the
 * landed state, with what it did, or the refusal and its fixes. Always from
 * the step on screen (`parent`); a new cursor, load or engine lets it go.
 */
export type FoldPendingStep =
  | { readonly status: 'idle' }
  | { readonly status: 'working'; readonly request: FoldStepRequest; readonly parent: FoldEngineStateHandle }
  | {
      readonly status: 'landed';
      readonly request: FoldStepRequest;
      readonly parent: FoldEngineStateHandle;
      readonly state: FoldEngineStateHandle;
      readonly summary: FoldStateSummary;
      readonly report: FoldReport | null;
      readonly compound?: FoldCompoundReport;
    }
  | {
      readonly status: 'refused';
      readonly request: FoldStepRequest;
      readonly parent: FoldEngineStateHandle;
      readonly refused: FoldEngineRefused;
    }
  | {
      readonly status: 'failed';
      readonly request: FoldStepRequest;
      readonly parent: FoldEngineStateHandle;
      readonly error: WasmErrorEnvelope;
    };

/**
 * What a fold along a line would move, before anything is folded (plan D14
 * tier 2). `choices` is an axiom's root, when the op was asked with one.
 */
export type FoldPendingAnalysis =
  | { readonly status: 'idle' }
  | {
      readonly status: 'working';
      readonly op: FoldEngineOp;
      readonly choices?: FoldChoices;
      readonly parent: FoldEngineStateHandle;
    }
  | {
      readonly status: 'analysed';
      readonly op: FoldEngineOp;
      readonly choices?: FoldChoices;
      readonly parent: FoldEngineStateHandle;
      readonly analysis: FoldAnalysis;
    }
  | {
      readonly status: 'refused';
      readonly op: FoldEngineOp;
      readonly choices?: FoldChoices;
      readonly parent: FoldEngineStateHandle;
      readonly refused: FoldEngineRefused;
    }
  | {
      readonly status: 'failed';
      readonly op: FoldEngineOp;
      readonly choices?: FoldChoices;
      readonly parent: FoldEngineStateHandle;
      readonly error: WasmErrorEnvelope;
    };

export const FOLD_IDLE: { readonly status: 'idle' } = Object.freeze({ status: 'idle' });

export interface FoldSessionSnapshot {
  /** A surface holds the session, so the engine is running and replays. */
  readonly live: boolean;
  /** The load these describe: the slice's `foldLoadId`. */
  readonly loadId: number;
  /** The shown sequence; null before the first edit, when the flat square is shown. */
  readonly sequence: FoldSequenceDocument | null;
  /** The sheet the shown sequence starts from. */
  readonly paper: FoldPaper;
  /** The shown sequence is a newer build's: shown, replayed, never changed. */
  readonly readOnly: boolean;
  /** The step on screen; null for the sheet. */
  readonly cursor: string | null;
  /** The active path's step ids, the first step first. */
  readonly activePath: readonly string[];
  readonly sheet: FoldSessionNode;
  /** Every step of the shown sequence, by id. */
  readonly nodes: ReadonlyMap<string, FoldSessionNode>;
  readonly progress: FoldSessionProgress;
  readonly pending: FoldPendingStep;
  readonly analysis: FoldPendingAnalysis;
  /** Why the replay stopped short, when a re-replay cannot help; the next change or a retry tries again. */
  readonly error: WasmErrorEnvelope | null;
}

// ---------------------------------------------------------------------------
// Selectors

/** The node on screen: the cursor's step, or the sheet. */
export function selectFoldCursorNode(snapshot: FoldSessionSnapshot): FoldSessionNode {
  return snapshot.cursor === null ? snapshot.sheet : (snapshot.nodes.get(snapshot.cursor) ?? FOLD_PENDING_NODE);
}

/** A step of the shown sequence — the sheet for null — or null for none. */
export function selectFoldNode(snapshot: FoldSessionSnapshot, id: string | null): FoldSessionNode | null {
  return id === null ? snapshot.sheet : (snapshot.nodes.get(id) ?? null);
}

export function selectFoldReplayProgress(snapshot: FoldSessionSnapshot): FoldSessionProgress {
  return snapshot.progress;
}

export function selectFoldActivePath(snapshot: FoldSessionSnapshot): readonly string[] {
  return snapshot.activePath;
}

// ---------------------------------------------------------------------------
// Derivation

/** Whether two handles name one state. */
export function sameFoldState(a: FoldEngineStateHandle | null, b: FoldEngineStateHandle | null): boolean {
  return a === b || (a !== null && b !== null && a.generation === b.generation && a.id === b.id);
}

/**
 * A node's replay as a surface reads it, or `previous` when that says the
 * same. A run reports the nodes it has not reached yet as pending; one the
 * last run settled at the same path keeps what it had, since a path lands one
 * state, so a branch nobody is looking at does not flicker while the active
 * path replays.
 */
function sessionNode(
  replay: FoldNodeReplay<FoldEngineStateHandle>,
  details: (state: FoldEngineStateHandle) => FoldStateDetails | undefined,
  previous: FoldSessionNode | undefined
): FoldSessionNode {
  if (replay.status === 'pending') {
    return previous && previous.status !== 'pending' && previous.path === replay.path ? previous : FOLD_PENDING_NODE;
  }
  const known = replay.state ? details(replay.state) : undefined;
  const node: FoldSessionNode = {
    status: replay.status,
    path: replay.path,
    state: replay.state,
    fingerprint: replay.fingerprint,
    summary: known?.summary ?? null,
    report: known?.report ?? null,
    ...(known?.compound ? { compound: known.compound } : {}),
    refusal: replay.refusal,
  };
  return previous && sameNode(previous, node) ? previous : node;
}

function sameNode(a: FoldSessionNode, b: FoldSessionNode): boolean {
  return (
    a.status === b.status &&
    a.path === b.path &&
    sameFoldState(a.state, b.state) &&
    a.fingerprint === b.fingerprint &&
    a.summary === b.summary &&
    a.report === b.report &&
    a.compound === b.compound &&
    a.refusal?.at === b.refusal?.at &&
    a.refusal?.code === b.refusal?.code
  );
}

const SHEET_PATHS = new WeakMap<FoldPaper, FoldPathDigest>();

/** The flat sheet's path: the paper alone. Memoised on the paper, which a document never mutates. */
export function foldSheetPath(paper: FoldPaper): FoldPathDigest {
  let path = SHEET_PATHS.get(paper);
  if (path === undefined) {
    path = foldPathDigest(paper, []);
    SHEET_PATHS.set(paper, path);
  }
  return path;
}

/**
 * What of `progress` still holds for `document`, which changed while nothing
 * replayed it: a step keeps its state only while its path is the one that
 * state was landed for. An edit that rewrites a step in place (a repeat's or
 * an import's refresh, a rebuilt return) or an undo of one leaves that step
 * and every step after it pending until a replay lands them again, rather
 * than showing the state they had before. `progress` itself when every step
 * it holds is still there, and for another sequence or another paper, of
 * which {@link deriveFoldSessionNodes} shows no step anyway.
 */
export function foldProgressStillValid(
  progress: FoldReplayProgress<FoldEngineStateHandle>,
  document: FoldSequenceDocument
): FoldReplayProgress<FoldEngineStateHandle> {
  if (progress.sequenceId !== document.id || progress.sheet.path !== foldSheetPath(document.paper)) return progress;
  const tree = foldStepTree(document.steps);
  const steps = new Map<string, FoldNodeReplay<FoldEngineStateHandle>>();
  for (const node of document.steps) {
    const replay = progress.steps.get(node.id);
    if (replay && replay.path === foldPathDigest(document.paper, pathTo(tree, node.id) ?? [node])) {
      steps.set(node.id, replay);
    }
  }
  return steps.size === progress.steps.size ? progress : { ...progress, steps, done: false };
}

/**
 * Every node of `document` from the newest replay progress of its load.
 *
 * Every path begins with the paper, so progress made for another paper holds
 * nothing of this document: neither its sheet nor any step, whose ids a
 * change of start side keeps. For the same paper, a step's path never
 * changes under its id — commits append, and a change of shape empties the
 * steps — so a step the progress already holds keeps its status while a
 * replay of a newer edit runs, and a step it does not hold yet is pending.
 * The sheet is matched by its path, so it survives the first commit giving
 * the blank sequence an id.
 */
export function deriveFoldSessionNodes(
  document: FoldSequenceDocument,
  progress: FoldReplayProgress<FoldEngineStateHandle> | null,
  details: (state: FoldEngineStateHandle) => FoldStateDetails | undefined,
  previous: Pick<FoldSessionSnapshot, 'sheet' | 'nodes'> | null
): { sheet: FoldSessionNode; nodes: ReadonlyMap<string, FoldSessionNode> } {
  const samePaper = progress !== null && progress.sheet.path === foldSheetPath(document.paper);
  const sheet = samePaper ? sessionNode(progress.sheet, details, previous?.sheet) : FOLD_PENDING_NODE;
  const steps = samePaper && progress.sequenceId === document.id ? progress.steps : null;
  const nodes = new Map<string, FoldSessionNode>();
  let unchanged = previous !== null && previous.nodes.size === document.steps.length;
  for (const { id } of document.steps) {
    const replay = steps?.get(id);
    const before = previous?.nodes.get(id);
    const node = replay ? sessionNode(replay, details, before) : FOLD_PENDING_NODE;
    if (node !== before) unchanged = false;
    nodes.set(id, node);
  }
  return { sheet, nodes: unchanged && previous ? previous.nodes : nodes };
}

/**
 * A step just committed with the state it landed — a preview's, or an
 * import's — shown at that state at once rather than pending until the
 * replay the commit causes reaches it. That replay adopts the same state
 * (`FoldSessionEngine.adopt`), so it says the same thing when it does.
 */
export interface FoldLandedAhead {
  readonly loadId: number;
  readonly sequenceId: string;
  readonly id: string;
  readonly replay: FoldNodeReplay<FoldEngineStateHandle>;
}

/** The committed step `id` of `document` at the state it landed; null when the document has no such step. */
export function foldLandedAhead(
  document: FoldSequenceDocument,
  loadId: number,
  id: string,
  state: FoldEngineStateHandle,
  fingerprint: FoldStateFingerprint
): FoldLandedAhead | null {
  const path = pathTo(foldStepTree(document.steps), id);
  if (!path) return null;
  return {
    loadId,
    sequenceId: document.id,
    id,
    // Committed at this fingerprint: its `expect`, so `ok`.
    replay: { status: 'ok', path: foldPathDigest(document.paper, path), state, fingerprint, refusal: null },
  };
}

/** Whether `progress` has settled the step `ahead` names: then it speaks for that step itself. */
export function settlesLandedAhead(
  progress: FoldReplayProgress<FoldEngineStateHandle>,
  ahead: FoldLandedAhead
): boolean {
  if (progress.loadId !== ahead.loadId || progress.sequenceId !== ahead.sequenceId) return false;
  const step = progress.steps.get(ahead.id);
  return step !== undefined && step.status !== 'pending';
}

/**
 * `progress` with a step committed ahead of the replay in it, while the
 * replay has not settled that step and the document is the one it was
 * committed to. The sheet is the progress's: with none, nothing can be shown
 * ahead of it.
 */
export function withLandedAhead(
  progress: FoldReplayProgress<FoldEngineStateHandle> | null,
  ahead: FoldLandedAhead | null,
  document: FoldSequenceDocument
): FoldReplayProgress<FoldEngineStateHandle> | null {
  if (!progress || !ahead || ahead.loadId !== progress.loadId || ahead.sequenceId !== document.id) return progress;
  if (settlesLandedAhead(progress, ahead)) return progress;
  // The first commit gives the blank sequence an id: none of the progress's steps are its.
  const steps = new Map(progress.sequenceId === document.id ? progress.steps : []);
  steps.set(ahead.id, ahead.replay);
  return { ...progress, sequenceId: document.id, steps };
}

/** How far the replay has come, from the nodes as derived. */
export function foldSessionProgress(
  sheet: FoldSessionNode,
  nodes: ReadonlyMap<string, FoldSessionNode>,
  activePath: readonly string[],
  replaying: boolean
): FoldSessionProgress {
  const settledIn = (ids: Iterable<string>) => {
    let count = 0;
    for (const id of ids) if ((nodes.get(id)?.status ?? 'pending') !== 'pending') count += 1;
    return count;
  };
  const settled = settledIn(nodes.keys());
  return {
    replaying,
    activeSettled: settledIn(activePath),
    activeTotal: activePath.length,
    settled,
    total: nodes.size,
    done: sheet.status !== 'pending' && settled === nodes.size,
  };
}

/** `next`, or `previous` when it holds the same ids in the same order. */
export function sameIds(previous: readonly string[], next: readonly string[]): readonly string[] {
  return previous.length === next.length && previous.every((id, k) => id === next[k]) ? previous : next;
}

/** `next`, or `previous` when every field is the same. */
export function sameProgress(previous: FoldSessionProgress, next: FoldSessionProgress): FoldSessionProgress {
  return (Object.keys(next) as (keyof FoldSessionProgress)[]).every((key) => previous[key] === next[key])
    ? previous
    : next;
}
