/**
 * The Fold session: the one place the document, the replay and the engine
 * meet (plan D6, D7, D14). Every Fold surface reads it.
 *
 * - **Replay follows the document.** While a surface holds the session, every
 *   change to the shown sequence — a commit, a delete, a note, marks, the
 *   paper, an undo, a redo, a load — replays it through `foldReplay`: the
 *   active path first, reporting progress; every path cached by `fh1`, so an
 *   undo or a note edit asks the engine nothing; a run for a document since
 *   replaced is superseded by the run its replacement starts, and its
 *   progress, which names the load it replayed, is never shown for another.
 * - **Kept a while after the last surface** (`linger`): leaving Fold for the
 *   Diagram and coming back finds every state where it was, so the step on
 *   screen is shown at once and nothing is replayed — or, after an edit made
 *   meanwhile, only what it changed. Nothing runs while it waits, and a load
 *   or a lost engine ends it at once.
 * - **Handles die with their engine.** A worker that is terminated or crashes
 *   takes every state with it, and its successor numbers states from 1 again
 *   (the generation rule, `foldEnginePort`). The session forgets every handle
 *   and everything folded from one, and replays. A crash that keeps
 *   recurring stops that after {@link MAX_RESTARTS} tries, until the next
 *   change or a retry.
 * - **The step a tool is folding** (D14 tier 3) is folded from the step on
 *   screen, latest request wins: `preview` lands it or says why not, with the
 *   engine's fixes; `commitStep` appends it through the store with `expect`
 *   the state's `fs1`, and hands the landed state to the replay that follows,
 *   so committing folds nothing twice. Committing anywhere but a tip makes a
 *   branch (the slice's append-only rule).
 * - **Queries** on any landed state go through {@link FoldSession.withState}:
 *   one line per call the bridge offers, and a handle that outlived its engine
 *   comes back unavailable rather than naming some other state.
 *
 * The document and the engine are injected (`FoldSessionDocumentSource`,
 * `FoldSessionRuntime`): the store and the worker in the app
 * (`store/workspaceStore/foldSession.ts`), fakes or the in-process bridge in
 * tests. No React.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import type { WasmErrorEnvelope } from '../../engine/types';
import type {
  FoldPreviewResult,
  FoldSequenceClientLossListener,
  FoldSequenceClientLossReason,
} from '../../store/workspaceStore/foldSequenceRuntime';
import type { FoldSequenceWorkerApi } from '../../workers/foldSequenceWorker';
import { resolveFoldReturn } from '../document/foldReturn';
import type { FoldStateFingerprint } from '../document/foldDigest';
import { foldReaderActivePath, type FoldReaderState } from '../document/foldReaderState';
import { createFoldReplayer, type FoldReplayer, type FoldReplayProgress } from '../document/foldReplay';
import type { FoldChoices, FoldOp, FoldPaperShape } from '../document/foldSequenceDocument';
import type { HeldFoldSequence } from '../document/foldSequenceFile';
import type { FoldStepDraft } from '../document/foldSequenceEdits';
import type { FoldCompoundReport } from '../engine/foldEngineCompoundWire';
import { foldStateLostError, type FoldEngineSource, type FoldEngineStateHandle } from '../engine/foldEnginePort';
import type { FoldEngineCrashCause } from '../engine/foldEngineTrap';
import { nextFoldTask, type FoldSearchTicket } from '../engine/foldSearch';
import type { FoldOrderQuery, FoldOrderSelection } from '../engine/foldEngineCompoundCalls';
import { foldPreviewWants, type FoldPreviewed, type FoldPreviewWants } from '../engine/foldEnginePreview';
import type { FoldRootSectionHint } from '../engine/foldEngineRoots';
import type {
  FoldAxiomCandidates,
  FoldAxiomLine,
  FoldEngineOp,
  FoldEngineOutcome,
  FoldEngineRefused,
  FoldStateSummary,
  FoldStepFingerprinted,
} from '../engine/foldEngineWire';
import { createFoldSessionAnswers } from './foldSessionAnswers';
import {
  FOLD_SCENE_QUERY,
  FOLD_STEP_SUMMARY_QUERY,
  foldActionQuery,
  foldCrossSectionQuery,
} from './foldStateQueries';
import { createFoldSessionEngine, foldStepInputKey, type FoldSessionEngine } from './foldSessionEngine';
import {
  deriveFoldSessionNodes,
  FOLD_BLANK_SEQUENCE,
  FOLD_IDLE,
  foldLandedAhead,
  foldProgressStillValid,
  foldSessionProgress,
  foldStateDetailsOf,
  sameFoldState,
  sameIds,
  sameProgress,
  selectFoldCursorNode,
  selectFoldNode,
  settlesLandedAhead,
  withLandedAhead,
  type FoldLandedAhead,
  type FoldPendingAnalysis,
  type FoldPendingStep,
  type FoldSessionSnapshot,
  type FoldStateDetails,
  type FoldStepRequest,
} from './foldSessionState';

// ---------------------------------------------------------------------------
// What the session is given

/** The engine's calls, as the worker exposes them: what a query is written against. */
export type FoldSessionWorker = FoldSequenceWorkerApi;

/** The shown sequence as the store holds it. */
export interface FoldSessionDocument {
  /** The slice's `foldLoadId`: a replacement of the sequences raises it. */
  loadId: number;
  /** The sequence shown; null for none, when the blank square is shown. */
  held: HeldFoldSequence | null;
  reader: FoldReaderState | null;
}

export interface FoldSessionDocumentSource {
  read(): FoldSessionDocument;
  /** Called after any change to what `read` returns. */
  subscribe(listener: () => void): () => void;
  /**
   * Commit a step under `draft.parent` of the shown sequence — creating it
   * for the first — and put the cursor on it: the slice's `commitFoldStep`.
   * Its id, or null when the parent is gone or locked, the sequence is a
   * newer build's, or `loadId` is no longer the current one.
   */
  commit(draft: FoldStepDraft, loadId: number): string | null;
}

/** A latest-request-wins stream to the engine (`createFoldPreviewChannel`). */
export interface FoldSessionChannel {
  request<T>(
    ask: (engine: FoldSessionWorker) => Promise<T>,
    discard?: (value: T) => void
  ): Promise<FoldPreviewResult<T>>;
  cancel(): void;
}

/** The engine's lifetime, as `foldSequenceRuntime` runs the worker. */
export interface FoldSessionRuntime {
  /** Take a reference to the engine, starting it if needed. */
  retain(): void;
  release(): void;
  /** Which engine handles belong to; it moves the moment one goes away. */
  generation(): number;
  /** Called when the engine goes away, before any call it took with it rejects; a crash says what crashed it. */
  onLost(listener: FoldSequenceClientLossListener): () => void;
  /** One call, rejected as `fold_sequence_client_lost` if the engine goes away under it. */
  ask<T>(call: (engine: FoldSessionWorker) => Promise<T>): Promise<T>;
  createChannel(): FoldSessionChannel;
  /** The engine as replay's port reads it. */
  readonly source: FoldEngineSource;
}

/**
 * What became of the restart after a crash: the replay that followed
 * finished (`recovered`), the engine crashed again first (`crashed_again`),
 * the session stopped restarting (`gave_up`), the replay failed some other
 * way (`failed`), or no surface held the session any more (`left`).
 */
export type FoldEngineRestartOutcome = 'recovered' | 'crashed_again' | 'gave_up' | 'failed' | 'left';

/** One crash of the engine, once the session knows what came of it. */
export interface FoldEngineRestart {
  readonly cause: FoldEngineCrashCause;
  /** How many times in a row the engine has crashed, this one included ({@link MAX_RESTARTS}). */
  readonly attempt: number;
  readonly outcome: FoldEngineRestartOutcome;
}

export interface FoldSessionOptions {
  document: FoldSessionDocumentSource;
  runtime: FoldSessionRuntime;
  /** An error the user should hear of: the app's error toast. */
  reportError?: (error: WasmErrorEnvelope) => void;
  /** Each crash of the engine, with what came of the restart: the app's analytics. */
  onEngineCrash?: (restart: FoldEngineRestart) => void;
  /** The replay cache's room beyond the states on screen (`createFoldReplayer`). */
  capacity?: number;
  /**
   * How long, in milliseconds, the engine and every state it landed are kept
   * once the last surface lets go, so a surface that holds the session again
   * within it shows the replayed sequence at once ({@link FoldSession.retain}).
   * 0, the default, stops the engine at once.
   */
  linger?: number;
}

// ---------------------------------------------------------------------------
// What it answers

/**
 * Why nothing can be folded from the step on screen right now: no surface
 * holds the session, the sequence is a newer build's, the step has no state
 * (pending, broken or locked), or a commit is already under way.
 */
export type FoldUnavailableReason = 'not-live' | 'read-only' | 'no-state' | 'busy';

export interface FoldUnavailable {
  readonly status: 'unavailable';
  readonly reason: FoldUnavailableReason;
}

/** A newer request, a cancel, or a move of the cursor replaced this one. */
export interface FoldSuperseded {
  readonly status: 'superseded';
}

export type FoldPreviewOutcome =
  | Extract<FoldPendingStep, { status: 'landed' | 'refused' | 'failed' }>
  | FoldSuperseded
  | FoldUnavailable;

export type FoldAnalyseOutcome =
  | Extract<FoldPendingAnalysis, { status: 'analysed' | 'refused' | 'failed' }>
  | FoldSuperseded
  | FoldUnavailable;

export type FoldCommitOutcome =
  | { readonly status: 'committed'; readonly stepId: string; readonly fingerprint: FoldStateFingerprint }
  /** The engine refused the step; the refusal is also the pending step, for the notice. */
  | { readonly status: 'refused'; readonly refused: FoldEngineRefused }
  | { readonly status: 'failed'; readonly error: WasmErrorEnvelope }
  /** The document or the engine moved on while the step was folding: nothing was committed. */
  | { readonly status: 'stale' }
  | FoldUnavailable;

/**
 * A step the engine landed outside the session's own folds — an Import CP or
 * Edit's folded figure (plan D16), or a compound fold its family's own call
 * landed (a crimp's or a tuck's order, a vertex fold's pick) — to commit as
 * it landed.
 */
export interface FoldLandedStep {
  /** The state it landed: a handle of the engine on now. */
  readonly state: FoldEngineStateHandle;
  /**
   * The state it was landed after: the step on screen when it was asked for.
   * Null for one that adopts a sheet, which lands from that sheet.
   */
  readonly parent: FoldEngineStateHandle | null;
  readonly op: FoldOp;
  /** What the step stores, when it landed one of several ways: the order picked, the openings chosen. */
  readonly choices?: FoldChoices;
  readonly fingerprint: FoldStateFingerprint;
  readonly summary: FoldStateSummary;
  /** What a compound fold did, of any family, kept as a replayed step's is. */
  readonly compound?: FoldCompoundReport;
  /** The sheet an empty sequence takes with it (`FoldStepDraft.adopt`). */
  readonly adopt?: FoldPaperShape;
}

/** A query on a state: its answer, or word that the state is not held (a re-replay brings a new handle). */
export type FoldStateQuery<T> = { readonly status: 'answered'; readonly value: T } | FoldUnavailable;

/** A query, given the engine and the state's number in it. */
export type FoldStateCall<T> = (engine: FoldSessionWorker, state: number) => Promise<T>;

export interface FoldSession {
  /** The snapshot, for `useStore` and plain subscribers. */
  readonly store: StoreApi<FoldSessionSnapshot>;
  /**
   * Hold the engine while a surface is open: the first hold starts it and
   * replays. Returns the release; the last one stops the engine and lets
   * every state go — after the session's `linger`, when it has one. A hold
   * taken within it finds every state where it was and asks the engine
   * nothing, unless the document changed meanwhile, when the replay asks only
   * for what changed. Nothing runs while it lingers, and it stops at once
   * when the sequences are replaced (a load) or the engine goes away.
   */
  retain(): () => void;
  /**
   * What a fold along a line would move, from the step on screen (D14 tier 2).
   * `choices` carries an axiom's root, which its line does not resolve without.
   */
  analyse(op: FoldEngineOp, choices?: FoldChoices): Promise<FoldAnalyseOutcome>;
  /** Fold a step from the step on screen without committing it (D14 tier 3). */
  preview(op: FoldEngineOp, choices?: FoldChoices): Promise<FoldPreviewOutcome>;
  /**
   * The layer orders a fold leaves from the step on screen (`orderSelection`).
   * The step they resolve is folded in the same turn of the engine and kept
   * for the {@link FoldSession.preview} that asks for it next, which then asks
   * the engine nothing; its analysis and picture are kept as the tool would
   * ask them (`foldEnginePreview.ts`).
   */
  resolveOrders(
    op: FoldEngineOp,
    choices: FoldChoices | undefined,
    query: FoldOrderQuery,
    search?: FoldSearchTicket
  ): Promise<FoldStateQuery<FoldEngineOutcome<FoldOrderSelection>>>;
  /**
   * An axiom line's roots on the step on screen (`axiomCandidates`), with the
   * layers at the root `hint` names asked in the same turn and kept for the
   * tool's `foldCrossSectionQuery` (`foldEngineRoots.ts`).
   */
  axiomRoots(
    line: FoldAxiomLine,
    hint: FoldRootSectionHint | null
  ): Promise<FoldStateQuery<FoldEngineOutcome<FoldAxiomCandidates>>>;
  /** Fold a step from the step on screen and append it to the shown sequence, the cursor moved onto it. */
  commitStep(op: FoldOp, choices?: FoldChoices): Promise<FoldCommitOutcome>;
  /**
   * Append a step the engine already landed after the step on screen, as it
   * landed: nothing is folded twice. The state is handed to the replay that
   * follows, or let go. `stale` when the step on screen is no longer the one
   * it was landed after — or, for one that adopts a sheet, when the sequence
   * has a step by now — and the state is let go.
   */
  commitLanded(landed: FoldLandedStep): Promise<FoldCommitOutcome>;
  /** Let go of the pending step and the analysis. */
  cancel(): void;
  /**
   * Stop a search asked with this ticket (`engine/foldSearch.ts`) — a pleat's
   * orders, a repeat's preparation — at its next slice, letting go of every
   * state it landed. Its call rejects with `fold_search_cancelled`. Nothing
   * to stop is no error.
   */
  cancelSearch(ticket: FoldSearchTicket): void;
  /** Ask the engine about a landed state. */
  withState<T>(state: FoldEngineStateHandle, call: FoldStateCall<T>): Promise<FoldStateQuery<T>>;
  /**
   * A pure query on a landed state — one whose answer the state alone
   * decides: a scene, landmarks, a step's summary or picture. Asked of the
   * engine once however many surfaces ask it, and the answer kept for the
   * next ({@link FoldSession.peek}). `call` must be module-level or memoised.
   */
  query<T>(state: FoldEngineStateHandle, call: FoldStateCall<T>): Promise<FoldStateQuery<T>>;
  /** The answer {@link FoldSession.query} already has for `call` on `state`, if any. */
  peek<T>(state: FoldEngineStateHandle, call: FoldStateCall<T>): { value: T } | null;
  /** Ask the engine about a step's state — the sheet's for null. */
  withNode<T>(id: string | null, call: FoldStateCall<T>): Promise<FoldStateQuery<T>>;
  /** Ask the engine about the state on screen. */
  withCursor<T>(call: FoldStateCall<T>): Promise<FoldStateQuery<T>>;
  /** Try again after the replay stopped short (the snapshot's `error`). */
  retry(): void;
  /** Stop listening to the document and the engine, releasing any hold. */
  dispose(): void;
}

/**
 * How many times in a row the engine may be lost — a crash, or a state it no
 * longer holds — before the session stops replaying: a step that crashes the
 * worker every time it is folded, or a query a surface asks again as soon as
 * the replay lands, would otherwise restart it forever. Only the user ends a
 * run of losses: a change to the document resets the count, as do a retry
 * and the first hold. A replay that finishes does not.
 */
export const MAX_RESTARTS = 2;

/** Why the session stopped restarting a crashing engine: the snapshot's error, and the toast. */
export const FOLD_ENGINE_KEPT_STOPPING: WasmErrorEnvelope = Object.freeze({
  code: 'fold_engine_kept_stopping',
  message: 'The fold engine kept stopping.',
});

/** The engine went away under a call, or a handle outlived it: a replay recovers. */
function isEngineLoss(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'fold_sequence_client_lost' || code === 'fold_state_lost';
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : null;
}

/**
 * A plain envelope for the store and the toast. Not `engineError`: that lives
 * in the TreeMaker runtime, which a module with no store must not import.
 */
function envelopeOf(error: unknown): WasmErrorEnvelope {
  const code = errorCode(error);
  if (code !== null && error && typeof error === 'object' && 'message' in error) {
    return { code, message: String(error.message) };
  }
  return { code: code ?? 'fold_session', message: error instanceof Error ? error.message : String(error) };
}

const SUPERSEDED: FoldSuperseded = Object.freeze({ status: 'superseded' });

const unavailable = (reason: FoldUnavailableReason): FoldUnavailable => ({ status: 'unavailable', reason });

function requestOf(op: FoldEngineOp, choices: FoldChoices | undefined): FoldStepRequest {
  return choices ? { op, choices } : { op };
}

/** An analysis the engine answered, which a later ask of the same line from the same state can reuse. */
type FoldAnalysisAnswer = Extract<FoldPendingAnalysis, { status: 'analysed' | 'refused' }>;

/** A preview the engine answered: landed, or refused. */
type FoldSettledPreview = Extract<FoldPendingStep, { status: 'landed' | 'refused' }>;

/** What a plain preview's turn reads besides the landed state: the tool asks the parent's own answers beside it. */
const LANDED_ONLY: FoldPreviewWants = { analysis: false, action: false };

/** How many analyses the session keeps. */
const ANALYSES_KEPT = 64;

/**
 * How many answers of each pure query the session keeps (`query`): the
 * states a reader steps among, with the one a tool previews. A scene is the
 * largest, a few hundred kilobytes for a busy model.
 */
const ANSWERS_KEPT = 48;

/** The step on screen, as a step folds from it. */
interface FoldingFrom {
  parent: FoldEngineStateHandle;
  /** The step's id; null for the sheet. */
  parentId: string | null;
  loadId: number;
}

export function createFoldSession({
  document: source,
  runtime,
  reportError,
  onEngineCrash,
  capacity,
  linger: lingerMs = 0,
}: FoldSessionOptions): FoldSession {
  let input = source.read();
  let holders = 0;
  /** No surface holds the session, but the engine is kept until this runs out (`linger`). */
  let lingering: ReturnType<typeof setTimeout> | null = null;
  /**
   * What the session shows may not be all the document asks for — a replay
   * was cut short, or the document changed while nothing replayed it — so
   * the next hold replays. Kept states answer every path that did not change.
   */
  let replayOwed = false;
  let engine: FoldSessionEngine | null = null;
  let replayer: FoldReplayer<FoldEngineStateHandle> | null = null;
  /** Bumped to drop an engine-version answer that outlived the start that asked for it. */
  let startTicket = 0;
  let starting = false;
  /** The newest replay started: a run reports only while it is the newest. */
  let runTicket = 0;
  let replayScheduled = false;
  let replaying = false;
  let progress: FoldReplayProgress<FoldEngineStateHandle> | null = null;
  let restarts = 0;
  /** The crash the session last restarted from, until the replay after it says what came of it. */
  let restarting: Omit<FoldEngineRestart, 'outcome'> | null = null;
  /** Replay stopped after too many restarts, until the next change or a retry. */
  let halted = false;
  let lastLoss: FoldSequenceClientLossReason | null = null;
  let error: WasmErrorEnvelope | null = null;
  let pending: FoldPendingStep = FOLD_IDLE;
  /** Bumped whenever the pending step is let go, so an answer for the one let go lands nothing. */
  let pendingTicket = 0;
  let pendingAnswer: Promise<FoldPreviewOutcome> | null = null;
  /**
   * The landed pending step's fingerprint, asked for the moment it landed, so
   * a commit of it expects it without asking: null when it could not be read.
   */
  let pendingFingerprint: { state: FoldEngineStateHandle; fingerprint: Promise<FoldStateFingerprint | null> } | null = null;
  /**
   * The step an order resolution folded in its own turn (`resolveOrders`),
   * kept until the tool previews it — or the cursor moves, the tool lets go,
   * or a newer resolution replaces it, when its state is released.
   */
  let offer: { key: string; settled: FoldSettledPreview } | null = null;
  let analysis: FoldPendingAnalysis = FOLD_IDLE;
  let analysisTicket = 0;
  /**
   * What the engine said of each line, by the state it was asked of and the
   * op (D14 tier 2: once per line, side and direction). A pointer that snaps
   * keeps landing on the same few lines, and a state's analyses never change,
   * so the newest are kept until the states go.
   */
  const analyses = new Map<string, FoldAnalysisAnswer>();
  /** The pure queries' answers (`query`), shared by every surface that asks. */
  const answers = createFoldSessionAnswers<FoldStateCall<unknown>>(ANSWERS_KEPT);
  let committing = false;
  /** A landed preview a commit took: still on screen until the commit lands it, and never released by a drop. */
  let taken: FoldEngineStateHandle | null = null;
  /** The step a commit just appended, shown at the state it landed until the replay settles it. */
  let ahead: FoldLandedAhead | null = null;
  /** The newest replay when it was committed: any run started after it has settled the step, or seen it go. */
  let aheadTicket = Number.POSITIVE_INFINITY;
  /** A commit is changing the document: publish once it is done, not on each of its changes. */
  let quiet = false;
  const previewChannel = runtime.createChannel();
  const analysisChannel = runtime.createChannel();

  const snapshotOf = (previous: FoldSessionSnapshot | null): FoldSessionSnapshot => {
    const { held, loadId } = input;
    const sequence = held?.document ?? null;
    const document = sequence ?? FOLD_BLANK_SEQUENCE;
    const reader = sequence && input.reader?.sequenceId === sequence.id ? input.reader : null;
    const path = sequence && reader ? foldReaderActivePath(sequence, reader).map((node) => node.id) : [];
    const activePath = previous ? sameIds(previous.activePath, path) : path;
    const { sheet, nodes } = deriveFoldSessionNodes(
      document,
      withLandedAhead(progress?.loadId === loadId ? progress : null, ahead, document),
      (state) => engine?.details(state),
      previous
    );
    const counts = foldSessionProgress(sheet, nodes, activePath, replaying);
    return {
      live: holders > 0,
      loadId,
      sequence,
      paper: document.paper,
      readOnly: held?.readOnlyRaw != null,
      cursor: reader?.cursor ?? null,
      activePath,
      sheet,
      nodes,
      progress: previous ? sameProgress(previous.progress, counts) : counts,
      pending,
      analysis,
      error,
    };
  };

  const store = createStore<FoldSessionSnapshot>(() => snapshotOf(null));

  /**
   * Let go of the pending step: its answer, if still coming, lands nothing; a
   * landed state is released, unless a commit has taken it.
   */
  const dropPending = () => {
    pendingTicket += 1;
    previewChannel.cancel();
    if (pending.status === 'landed' && !sameFoldState(pending.state, taken)) engine?.release(pending.state);
    pending = FOLD_IDLE;
    pendingAnswer = null;
    pendingFingerprint = null;
  };

  /** Let go of the step an order resolution folded, unpreviewed: its state is released. */
  const dropOffer = () => {
    if (offer?.settled.status === 'landed') engine?.release(offer.settled.state);
    offer = null;
  };

  const dropAnalysis = () => {
    analysisTicket += 1;
    analysisChannel.cancel();
    analysis = FOLD_IDLE;
  };

  /** Folded from a state that is no longer on screen. */
  const outgrown = (slot: FoldPendingStep | FoldPendingAnalysis, here: FoldEngineStateHandle | null) =>
    slot.status !== 'idle' && !sameFoldState(slot.parent, here);

  /**
   * Publish what the session knows. The pending step and the analysis belong
   * to the state they were folded from: when the cursor moves, the document
   * is replaced or the state is lost, they go.
   */
  const render = () => {
    if (quiet) return;
    const previous = store.getState();
    let next = snapshotOf(previous);
    const here = selectFoldCursorNode(next).state;
    if (offer && outgrown(offer.settled, here)) dropOffer();
    if (outgrown(pending, here) || outgrown(analysis, here)) {
      if (outgrown(pending, here)) dropPending();
      if (outgrown(analysis, here)) dropAnalysis();
      next = { ...next, pending, analysis };
    }
    const changed = (Object.keys(next) as (keyof FoldSessionSnapshot)[]).some((key) => next[key] !== previous[key]);
    if (changed) store.setState(next, true);
  };

  /** Say what came of the restart under way, if one is. */
  const settleRestart = (outcome: FoldEngineRestartOutcome) => {
    if (!restarting) return;
    const restart = { ...restarting, outcome };
    restarting = null;
    onEngineCrash?.(restart);
  };

  const fail = (failure: unknown) => {
    settleRestart('failed');
    error = envelopeOf(failure);
    render();
    reportError?.(error);
  };

  /** Forget every state, and everything folded from one: the engine lost them, or is being let go. */
  const forgetStates = () => {
    dropPending();
    dropOffer();
    dropAnalysis();
    analyses.clear();
    answers.clear();
    ahead = null;
    runTicket += 1;
    replaying = false;
    progress = null;
    startTicket += 1;
    starting = false;
  };

  const halt = (why: WasmErrorEnvelope) => {
    halted = true;
    error = why;
  };

  // -------------------------------------------------------------------------
  // Replay

  const replay = () => {
    const current = replayer;
    if (!current || holders === 0 || halted) return;
    replayOwed = false;
    const ticket = ++runTicket;
    const sequence = input.held?.document ?? FOLD_BLANK_SEQUENCE;
    const activeChild = input.reader?.sequenceId === sequence.id ? input.reader.activeChild : undefined;
    replaying = true;
    error = null;
    render();
    current
      .run({ loadId: input.loadId, sequence, activeChild }, (reported) => {
        if (ticket !== runTicket) return;
        progress = reported;
        render();
      })
      .then(
        (finished) => {
          if (ticket !== runTicket) return;
          replaying = false;
          if (finished) {
            progress = finished;
            // A run started after the commit settled the step, or the step is gone.
            if (ticket > aheadTicket || (ahead && settlesLandedAhead(finished, ahead))) ahead = null;
            settleRestart('recovered');
            engine?.releaseUnadopted(ticket);
          }
          render();
        },
        (failure: unknown) => {
          if (ticket !== runTicket) return;
          replaying = false;
          // The loss listener has already forgotten the states and replays.
          if (isEngineLoss(failure)) render();
          else if (errorCode(failure) === 'unknown_state') reland(failure);
          else fail(failure);
        }
      );
  };

  /**
   * Replay once the current turn's changes are all in — a commit sets the
   * sequences and the reader one after the other — in a task of its own, so
   * what the change publishes (a committed step, at the state its preview
   * landed) is painted before the replay's own publishes are rendered.
   */
  const scheduleReplay = () => {
    if (replayScheduled || !replayer || holders === 0 || halted) return;
    replayScheduled = true;
    void nextFoldTask().then(() => {
      replayScheduled = false;
      replay();
    });
  };

  /** Start the engine and replay: the engine's version first, once, since the cache is keyed by it. */
  const start = () => {
    if (holders === 0 || halted) return;
    if (replayer) {
      scheduleReplay();
      return;
    }
    if (starting) return;
    starting = true;
    const ticket = ++startTicket;
    runtime.ask((worker) => worker.engineVersion()).then(
      (version) => {
        if (ticket !== startTicket) return;
        starting = false;
        engine = createFoldSessionEngine(runtime.source, version);
        replayer = createFoldReplayer(engine.port, { capacity });
        scheduleReplay();
      },
      (failure: unknown) => {
        if (ticket !== startTicket) return;
        starting = false;
        // The loss listener starts again.
        if (!isEngineLoss(failure)) fail(failure);
      }
    );
  };

  /**
   * The engine no longer holds a state the session handed out — it was
   * released under a reader, which is a bug, but one a replay recovers from:
   * forget every state and land them again, as after a crash.
   */
  const reland = (failure: unknown) => {
    if (!replayer || holders === 0) return;
    forgetStates();
    replayer.clear();
    restarts += 1;
    if (restarts > MAX_RESTARTS) halt(envelopeOf(failure));
    else start();
    render();
  };

  /** The engine crashed: restart it and replay, or after too many in a row, stop and say so. */
  const crashed = (cause: FoldEngineCrashCause) => {
    settleRestart('crashed_again');
    restarts += 1;
    const crash = { cause, attempt: restarts };
    if (restarts <= MAX_RESTARTS) {
      restarting = crash;
      start();
      return;
    }
    // The document is not touched: its steps stay as they are, replayed after
    // the next change, a retry or a reload.
    const told = halted;
    halt(FOLD_ENGINE_KEPT_STOPPING);
    onEngineCrash?.({ ...crash, outcome: 'gave_up' });
    if (!told) reportError?.(FOLD_ENGINE_KEPT_STOPPING);
  };

  const stop = () => {
    if (lingering !== null) clearTimeout(lingering);
    lingering = null;
    replayOwed = false;
    settleRestart('left');
    forgetStates();
    // Released through the port's batch, which an engine stopped meanwhile drops.
    replayer?.clear();
    engine?.releaseUnadopted(Number.POSITIVE_INFINITY);
    runtime.release();
    render();
  };

  /**
   * The last surface let go: keep the engine, every state it landed and what
   * the surfaces asked of them for `lingerMs`, then stop. Nothing is left
   * running meanwhile: the replay under way stops after the step it is
   * folding (what it landed stays cached), and the step a tool was folding
   * goes with the tool.
   */
  const startLingering = () => {
    settleRestart('left');
    const shown = progress?.done === true && progress.loadId === input.loadId;
    if (replaying || replayScheduled || starting || !shown) replayOwed = true;
    dropPending();
    dropOffer();
    dropAnalysis();
    runTicket += 1;
    replaying = false;
    replayer?.cancel();
    lingering = setTimeout(stop, lingerMs);
    render();
  };

  /** A surface holds the session again within its linger: everything it kept is there. */
  const stopLingering = () => {
    if (lingering !== null) clearTimeout(lingering);
    lingering = null;
  };

  /** The session holds the engine — a surface does, or it is lingering after the last one — so its states can be asked. */
  const holdsEngine = () => holders > 0 || lingering !== null;

  const unsubscribeDocument = source.subscribe(() => {
    const before = input;
    input = source.read();
    if (lingering !== null && input.loadId !== before.loadId) {
      // A load: nothing kept is the new sequences', so nothing is worth keeping.
      stop();
      return;
    }
    if (lingering !== null && input.held !== before.held) {
      // Replayed when a surface comes back; until then a step the change rewrote shows no stale state.
      replayOwed = true;
      if (progress) progress = foldProgressStillValid(progress, input.held?.document ?? FOLD_BLANK_SEQUENCE);
    }
    const changed = input.loadId !== before.loadId || input.held !== before.held;
    // Another branch while a run is under way: put its path first.
    const rerouted = input.reader?.activeChild !== before.reader?.activeChild;
    // A change is worth another try after a halt or a start that failed —
    // one, since the restart count stays. Otherwise it ends a run of losses:
    // the document is no longer the one the engine crashed on.
    if (changed && halted) halted = false;
    else if (changed) restarts = 0;
    render();
    if (changed) start();
    else if (rerouted && replaying) scheduleReplay();
  });

  const unsubscribeLoss = runtime.onLost((reason, cause) => {
    lastLoss = reason;
    // Every state went with the engine. Nothing is released: there is no one to tell.
    forgetStates();
    replayer?.clear();
    engine?.clear();
    if (holders > 0 && reason === 'crashed') crashed(cause ?? 'worker_error');
    else if (holders > 0 && reason === 'stopped') start();
    else if (lingering !== null) {
      // Nothing is left to keep, and no surface to restart it for: the next hold starts afresh.
      stop();
      return;
    }
    render();
  });

  // -------------------------------------------------------------------------
  // Folding from the step on screen

  /** The state on screen, if a step can be folded from it now. */
  const foldingFrom = (): FoldingFrom | FoldUnavailable => {
    const snapshot = store.getState();
    if (!snapshot.live) return unavailable('not-live');
    if (snapshot.readOnly) return unavailable('read-only');
    const state = selectFoldCursorNode(snapshot).state;
    if (!state || state.generation !== runtime.generation()) return unavailable('no-state');
    return { parent: state, parentId: snapshot.cursor, loadId: snapshot.loadId };
  };

  /** The step on screen is pending, and a replay under way or about to start will land it. */
  const landing = () =>
    (replaying || replayScheduled || starting) && selectFoldCursorNode(store.getState()).status === 'pending';

  /**
   * The state on screen, waiting for it while a replay lands it: a commit
   * puts the cursor on a step the replay that follows has yet to land, and a
   * second commit, or the tool's next preview, folds from that step. Every
   * replay ends by publishing (`replaying` goes false, or the session stops),
   * so the wait always ends.
   */
  const foldableFrom = (): FoldingFrom | FoldUnavailable | Promise<FoldingFrom | FoldUnavailable> => {
    const ready = (from: FoldingFrom | FoldUnavailable) =>
      !('status' in from) || from.reason !== 'no-state' || !landing();
    const now = foldingFrom();
    if (ready(now)) return now;
    return new Promise((resolve) => {
      const unsubscribe = store.subscribe(() => {
        const next = foldingFrom();
        if (!ready(next)) return;
        unsubscribe();
        resolve(next);
      });
    });
  };

  /** `call`, unless `state` belongs to an engine that has since gone. */
  const guarded = <T>(state: FoldEngineStateHandle, call: () => Promise<T>): Promise<T> =>
    state.generation === runtime.generation() ? call() : Promise.reject(foldStateLostError(state));

  /** An unfold back to an earlier step: the states it returns through are the replay's (`resolveFoldReturn`). */
  const returnStep = (worker: FoldSessionWorker, parent: FoldEngineStateHandle, parentId: string | null,
    op: Extract<FoldEngineOp, { kind: 'unfold-to' }>): Promise<FoldEngineOutcome<FoldStepFingerprinted>> => {
    const snapshot = store.getState();
    const dependency = snapshot.sequence
      ? resolveFoldReturn(snapshot.sequence, parentId, op, snapshot.sheet, snapshot.nodes)
      : { code: 'return_state_unavailable' as const };
    if ('code' in dependency) return Promise.resolve({ status: 'refused' as const,
      refusal: { code: dependency.code }, fixes: [], faces: [], vertices: [] });
    for (const state of [dependency.target, ...dependency.history]) {
      if (state.generation !== parent.generation) return Promise.reject(foldStateLostError(state));
    }
    return worker.returnTo(parent.id, dependency.target.id, dependency.history.map((s) => s.id));
  };

  /** A step folded for a commit, with the fingerprint the commit expects: one call. */
  const foldStep = (worker: FoldSessionWorker, parent: FoldEngineStateHandle, parentId: string | null,
    op: FoldEngineOp, choices?: FoldChoices): Promise<FoldEngineOutcome<FoldStepFingerprinted>> =>
    op.kind === 'unfold-to' ? returnStep(worker, parent, parentId, op) : worker.step(parent.id, op, choices);

  /**
   * A step folded for a preview, in one turn of the engine: what the preview
   * shows of it is read with it (`previewStep`). An unfold answers with its
   * fingerprint as well, and nothing more.
   */
  const previewTurn = async (worker: FoldSessionWorker, parent: FoldEngineStateHandle, parentId: string | null,
    op: FoldEngineOp, choices?: FoldChoices): Promise<{ previewed: FoldPreviewed; fingerprint?: FoldStateFingerprint }> => {
    if (op.kind !== 'unfold-to') return { previewed: await worker.previewStep(parent.id, op, choices, LANDED_ONLY) };
    const landed = await returnStep(worker, parent, parentId, op);
    return {
      previewed: { op, ...(choices ? { choices } : {}), landed },
      ...(landed.status === 'ok' ? { fingerprint: landed.fingerprint } : {}),
    };
  };

  const analysisKeyOf = (parent: FoldEngineStateHandle, op: FoldEngineOp, choices: FoldChoices | undefined) =>
    `${parent.generation}:${parent.id}:${foldStepInputKey({ op, choices })}`;

  /**
   * What a preview's turn read of the parent — the fold's analysis and its
   * picture — kept where the tool asks for them (`analyse`, `foldActionQuery`).
   */
  const keepParentAnswers = (parent: FoldEngineStateHandle, request: FoldStepRequest, previewed: FoldPreviewed) => {
    const { op, choices } = request;
    if (previewed.analysis && 'value' in previewed.analysis) {
      const key = analysisKeyOf(parent, op, choices);
      const value = previewed.analysis.value;
      if (!analyses.has(key)) {
        remember(
          key,
          value.status === 'ok'
            ? { status: 'analysed', ...request, parent, analysis: value.analysis }
            : { status: 'refused', ...request, parent, refused: value }
        );
      }
    }
    if (previewed.action && 'value' in previewed.action) {
      answers.put(parent, foldActionQuery(op, choices) as FoldStateCall<unknown>, previewed.action.value);
    }
  };

  /**
   * A preview the engine answered, as the pending step shows it, with what
   * its turn read kept for the surfaces that ask: the landed state's scene
   * and step summary (`FOLD_SCENE_QUERY`, `FOLD_STEP_SUMMARY_QUERY`), and the
   * parent's answers.
   */
  const settlePreviewed = (parent: FoldEngineStateHandle, request: FoldStepRequest, previewed: FoldPreviewed): FoldSettledPreview => {
    keepParentAnswers(parent, request, previewed);
    const { landed } = previewed;
    if (landed.status !== 'ok') return { status: 'refused', request, parent, refused: landed };
    const state = { generation: parent.generation, id: landed.state };
    if (previewed.scene && 'value' in previewed.scene) {
      answers.put(state, FOLD_SCENE_QUERY as FoldStateCall<unknown>, previewed.scene.value);
    }
    if (previewed.stepSummary && 'value' in previewed.stepSummary) {
      answers.put(state, FOLD_STEP_SUMMARY_QUERY as FoldStateCall<unknown>, previewed.stepSummary.value);
    }
    return { status: 'landed', request, parent, state, ...foldStateDetailsOf(landed) };
  };

  /**
   * Ask the landed pending step's fingerprint now, so a commit of it asks
   * nothing; or keep the one its turn answered with. A failure is the
   * commit's to meet, when it asks again.
   */
  const askFingerprint = (state: FoldEngineStateHandle, known?: FoldStateFingerprint) => {
    const fingerprint = known
      ? Promise.resolve(known)
      : runtime.ask((worker) => guarded(state, () => worker.fingerprint(state.id))).catch(() => null);
    pendingFingerprint = { state, fingerprint };
  };

  /** The step an order resolution folded, when it is this one from this parent: taken, so nothing releases it. */
  const takeOffer = (parent: FoldEngineStateHandle, key: string): FoldSettledPreview | null => {
    if (!offer || offer.key !== key || !sameFoldState(offer.settled.parent, parent)) return null;
    const { settled } = offer;
    offer = null;
    return settled;
  };

  /** Keep the step an order resolution folded from `parent`, until the tool previews it. */
  const keepOffer = (parent: FoldEngineStateHandle, previewed: FoldPreviewed) => {
    // The engine that landed it is gone, and its states with it.
    if (!holdsEngine() || parent.generation !== runtime.generation()) return;
    const request = requestOf(previewed.op, previewed.choices);
    const here = selectFoldCursorNode(store.getState()).state;
    if (holders === 0 || !sameFoldState(here, parent)) {
      // The tool has gone, or the cursor moved meanwhile: nobody will preview it.
      if (previewed.landed.status === 'ok') engine?.release({ generation: parent.generation, id: previewed.landed.state });
      return;
    }
    dropOffer();
    offer = { key: foldStepInputKey(request), settled: settlePreviewed(parent, request, previewed) };
  };

  const resolveOrders = async (
    op: FoldEngineOp,
    choices: FoldChoices | undefined,
    query: FoldOrderQuery,
    search?: FoldSearchTicket
  ): Promise<FoldStateQuery<FoldEngineOutcome<FoldOrderSelection>>> => {
    const parent = selectFoldCursorNode(store.getState()).state;
    if (!parent) return unavailable('no-state');
    // The step is folded with the orders only where a preview of it could be.
    const from = foldingFrom();
    const wants = !('status' in from) && sameFoldState(from.parent, parent) ? foldPreviewWants(op) : null;
    const answer = await withState(parent, (worker, at) => worker.resolveOrders(at, op, choices, query, search, wants));
    if (answer.status !== 'answered') return answer;
    const { selection, preview: previewed } = answer.value;
    if (previewed) keepOffer(parent, previewed);
    return { status: 'answered', value: selection };
  };

  const axiomRoots = async (
    line: FoldAxiomLine,
    hint: FoldRootSectionHint | null
  ): Promise<FoldStateQuery<FoldEngineOutcome<FoldAxiomCandidates>>> => {
    const parent = selectFoldCursorNode(store.getState()).state;
    if (!parent) return unavailable('no-state');
    const answer = await withState(parent, (worker, at) => worker.axiomRoots(at, line, hint));
    if (answer.status !== 'answered') return answer;
    // The layers at the root the tool takes, where it will ask for them.
    for (const { line: at, side, section } of answer.value.sections) {
      if ('value' in section) answers.put(parent, foldCrossSectionQuery(at, side) as FoldStateCall<unknown>, section.value);
    }
    return { status: 'answered', value: answer.value.candidates };
  };

  const preview = (op: FoldEngineOp, choices?: FoldChoices): Promise<FoldPreviewOutcome> => {
    const from = foldableFrom();
    if (!(from instanceof Promise)) return previewFrom(from, op, choices);
    // A newer request while this one waits supersedes it.
    dropPending();
    const ticket = pendingTicket;
    return from.then((ready) => (ticket === pendingTicket ? previewFrom(ready, op, choices) : SUPERSEDED));
  };

  const previewFrom = (
    from: FoldingFrom | FoldUnavailable,
    op: FoldEngineOp,
    choices: FoldChoices | undefined
  ): Promise<FoldPreviewOutcome> => {
    if ('status' in from) return Promise.resolve(from);
    const { parent } = from;
    const request = requestOf(op, choices);
    // Folded already, in the turn that resolved its orders: nothing to ask.
    const offered = takeOffer(parent, foldStepInputKey(request));
    dropPending();
    if (offered) {
      pending = { ...offered, request };
      if (pending.status === 'landed') askFingerprint(pending.state);
      render();
      return Promise.resolve(pending);
    }
    const ticket = pendingTicket;
    pending = { status: 'working', request, parent };
    render();
    const answer = previewChannel
      .request(
        (worker) => guarded(parent, () => previewTurn(worker, parent, from.parentId, op, choices)),
        // Superseded on its way back: nobody will see it.
        ({ previewed: { landed: late } }) => {
          if (late.status === 'ok') engine?.release({ generation: parent.generation, id: late.state });
        }
      )
      .then(
        (result): FoldPreviewOutcome => {
          if (result.status === 'superseded') return SUPERSEDED;
          const { previewed, fingerprint } = result.value;
          if (ticket !== pendingTicket) {
            if (previewed.landed.status === 'ok') engine?.release({ generation: parent.generation, id: previewed.landed.state });
            return SUPERSEDED;
          }
          const settled = settlePreviewed(parent, request, previewed);
          pending = settled;
          pendingAnswer = null;
          if (settled.status === 'landed') askFingerprint(settled.state, fingerprint);
          render();
          return settled;
        },
        (failure: unknown): FoldPreviewOutcome => {
          if (ticket !== pendingTicket || isEngineLoss(failure)) return SUPERSEDED;
          const settled: FoldPreviewOutcome = { status: 'failed', request, parent, error: envelopeOf(failure) };
          pending = settled;
          pendingAnswer = null;
          render();
          return settled;
        }
      );
    pendingAnswer = answer;
    return answer;
  };

  const remember = (key: string, settled: FoldAnalysisAnswer) => {
    analyses.delete(key);
    analyses.set(key, settled);
    for (const oldest of analyses.keys()) {
      if (analyses.size <= ANALYSES_KEPT) break;
      analyses.delete(oldest);
    }
  };

  const analyse = (op: FoldEngineOp, choices?: FoldChoices): Promise<FoldAnalyseOutcome> => {
    const from = foldableFrom();
    if (!(from instanceof Promise)) return analyseFrom(from, op, choices);
    dropAnalysis();
    const ticket = analysisTicket;
    return from.then((ready) => (ticket === analysisTicket ? analyseFrom(ready, op, choices) : SUPERSEDED));
  };

  const analyseFrom = (
    from: FoldingFrom | FoldUnavailable,
    op: FoldEngineOp,
    choices: FoldChoices | undefined
  ): Promise<FoldAnalyseOutcome> => {
    if ('status' in from) return Promise.resolve(from);
    dropAnalysis();
    const ticket = analysisTicket;
    const { parent } = from;
    const key = analysisKeyOf(parent, op, choices);
    const known = analyses.get(key);
    if (known) {
      analysis = known;
      render();
      return Promise.resolve(known);
    }
    const asked = choices ? { op, choices } : { op };
    analysis = { status: 'working', ...asked, parent };
    render();
    return analysisChannel.request((worker) => guarded(parent, () => worker.analyse(parent.id, op, choices))).then(
      (result): FoldAnalyseOutcome => {
        if (result.status === 'superseded' || ticket !== analysisTicket) return SUPERSEDED;
        const value = result.value;
        const settled: FoldAnalysisAnswer =
          value.status === 'ok'
            ? { status: 'analysed', ...asked, parent, analysis: value.analysis }
            : { status: 'refused', ...asked, parent, refused: value };
        remember(key, settled);
        analysis = settled;
        render();
        return settled;
      },
      (failure: unknown): FoldAnalyseOutcome => {
        if (ticket !== analysisTicket || isEngineLoss(failure)) return SUPERSEDED;
        const settled: FoldAnalyseOutcome = { status: 'failed', ...asked, parent, error: envelopeOf(failure) };
        analysis = settled;
        render();
        return settled;
      }
    );
  };

  /** The pending step as it stands now; read through this after an await, when it may have changed. */
  const pendingNow = (): FoldPendingStep => pending;

  const commit = async (
    { parent, parentId, loadId }: FoldingFrom,
    op: FoldOp,
    choices: FoldChoices | undefined
  ): Promise<FoldCommitOutcome> => {
    const request = requestOf(op, choices);
    const key = foldStepInputKey(request);
    const isThis = (slot: FoldPendingStep) =>
      slot.status !== 'idle' && sameFoldState(slot.parent, parent) && foldStepInputKey(slot.request) === key;

    // The preview on screen, when it is this step: wait for it if it is still folding.
    if (pendingNow().status === 'working' && isThis(pendingNow())) await pendingAnswer;
    const shown = pendingNow();
    let landed: { state: FoldEngineStateHandle; details: FoldStateDetails } | null = null;
    /** The fingerprint already asked for: the preview's, or the fold's own answer's. */
    let known: Promise<FoldStateFingerprint | null> | null = null;
    if (shown.status === 'landed' && isThis(shown)) {
      // Taken, not released: the commit hands it to the replay. It stays on
      // screen meanwhile, so nothing goes back to the step it folds from.
      landed = { state: shown.state, details: foldStateDetailsOf(shown) };
      taken = shown.state;
      if (pendingFingerprint && sameFoldState(pendingFingerprint.state, shown.state)) known = pendingFingerprint.fingerprint;
    } else if (shown.status === 'refused' && isThis(shown)) {
      return { status: 'refused', refused: shown.refused };
    }

    let fingerprint: FoldStateFingerprint;
    try {
      if (!landed) {
        const answer = await runtime.ask((worker) => guarded(parent, () => foldStep(worker, parent, parentId, op, choices)));
        if (answer.status !== 'ok') {
          // Shown as a preview's refusal is, with its fixes.
          dropPending();
          pending = { status: 'refused', request, parent, refused: answer };
          render();
          return { status: 'refused', refused: answer };
        }
        landed = {
          state: { generation: parent.generation, id: answer.state },
          details: foldStateDetailsOf(answer),
        };
        known = Promise.resolve(answer.fingerprint);
      }
      const { state } = landed;
      fingerprint =
        (await known) ?? (await runtime.ask((worker) => guarded(state, () => worker.fingerprint(state.id))));
    } catch (failure) {
      if (landed) letGo(landed.state);
      const envelope = envelopeOf(failure);
      // A deliberate stop or teardown is no news; a crash under a commit is.
      if (!isEngineLoss(failure) || lastLoss === 'crashed') reportError?.(envelope);
      return { status: 'failed', error: envelope };
    }

    // The engine or the document may have moved on while it folded.
    if (!engine || input.loadId !== loadId || landed.state.generation !== runtime.generation()) {
      letGo(landed.state);
      return { status: 'stale' };
    }
    const withdraw = engine.adopt(parent, request, { ...landed, fingerprint }, runTicket);
    const draft: FoldStepDraft = { parent: parentId, op, ...(choices ? { choices } : {}), expect: fingerprint };
    return committed(() => source.commit(draft, loadId), landed.state, fingerprint, withdraw);
  };

  /**
   * Let go of a state a commit landed or took, and of the preview still
   * showing it: the commit did not happen.
   */
  const letGo = (state: FoldEngineStateHandle) => {
    if (sameFoldState(taken, state)) taken = null;
    if (pending.status === 'landed' && sameFoldState(pending.state, state)) {
      dropPending();
      render();
    } else {
      engine?.release(state);
    }
  };

  /**
   * The end of a commit: the step `commitDraft` appends through the document,
   * published with the cursor on it at the state it landed, in one go — the
   * replay the commit causes adopts that state, and says the same when it
   * gets there. With no step appended (null), the state is let go.
   */
  const committed = (
    commitDraft: () => string | null,
    state: FoldEngineStateHandle,
    fingerprint: FoldStateFingerprint,
    withdraw: () => void
  ): FoldCommitOutcome => {
    // The document's own changes publish nothing until the step is known.
    quiet = true;
    let stepId: string | null;
    try {
      stepId = commitDraft();
    } finally {
      quiet = false;
    }
    if (stepId === null) {
      // The adoption held it: the withdrawal releases it, so only the preview goes.
      if (sameFoldState(taken, state)) taken = null;
      if (pending.status === 'landed' && sameFoldState(pending.state, state)) {
        pendingTicket += 1;
        pending = FOLD_IDLE;
        pendingAnswer = null;
      }
      withdraw();
      render();
      return { status: 'stale' };
    }
    const document = input.held?.document;
    const landedAhead = document && foldLandedAhead(document, input.loadId, stepId, state, fingerprint);
    if (landedAhead) {
      ahead = landedAhead;
      aheadTicket = runTicket;
    }
    // The cursor moved: the preview goes with this publish, its state now the step's.
    render();
    taken = null;
    return { status: 'committed', stepId, fingerprint };
  };

  /**
   * A landed step: offered to the replay under the state it was landed
   * after, as a preview is, with the choices it stores and what it did. An
   * import that adopts a sheet is offered under the sheet on screen: the
   * same sheet takes it, a new one lands the step again and the offer is let
   * go when that replay finishes. The sheet it was landed after is the
   * engine's own, already let go; an import keeps no parent (nothing about
   * it is asked of one), so the state stands for the step as well as one
   * landed after the sheet on screen.
   */
  const commitLandedFrom = (
    { parent, parentId, loadId }: FoldingFrom,
    landed: FoldLandedStep
  ): FoldCommitOutcome => {
    const empty = (store.getState().sequence?.steps.length ?? 0) === 0;
    const fits = landed.adopt ? parentId === null && empty : sameFoldState(landed.parent, parent);
    if (!engine || !fits || input.loadId !== loadId || landed.state.generation !== runtime.generation()) {
      engine?.release(landed.state);
      return { status: 'stale' };
    }
    const { op, choices, fingerprint, summary, compound, adopt } = landed;
    const details = foldStateDetailsOf({ summary, report: null, compound });
    const withdraw = engine.adopt(parent, requestOf(op, choices), { state: landed.state, fingerprint, details }, runTicket);
    const draft: FoldStepDraft = {
      parent: parentId,
      op,
      ...(choices ? { choices } : {}),
      expect: fingerprint,
      ...(adopt ? { adopt } : {}),
    };
    // An import that brings a new sheet is shown once the replay lands it again: no
    // progress for the old sheet holds anything of the new paper's.
    return committed(() => source.commit(draft, loadId), landed.state, fingerprint, withdraw);
  };

  // A query is answered while the engine is kept, so a surface coming back
  // asks before its hold is taken (an effect of a child runs first) and is
  // answered rather than told the session is not live.
  const withState = async <T>(state: FoldEngineStateHandle, call: FoldStateCall<T>): Promise<FoldStateQuery<T>> => {
    if (!holdsEngine()) return unavailable('not-live');
    if (state.generation !== runtime.generation()) return unavailable('no-state');
    try {
      return { status: 'answered', value: await runtime.ask((worker) => guarded(state, () => call(worker, state.id))) };
    } catch (failure) {
      if (isEngineLoss(failure)) return unavailable('no-state');
      if (errorCode(failure) === 'unknown_state') {
        reland(failure);
        return unavailable('no-state');
      }
      throw failure;
    }
  };

  const withNode = <T>(id: string | null, call: FoldStateCall<T>): Promise<FoldStateQuery<T>> => {
    const state = selectFoldNode(store.getState(), id)?.state;
    return state ? withState(state, call) : Promise.resolve(unavailable('no-state'));
  };

  const query = <T>(state: FoldEngineStateHandle, call: FoldStateCall<T>): Promise<FoldStateQuery<T>> => {
    if (!holdsEngine()) return Promise.resolve(unavailable('not-live'));
    if (state.generation !== runtime.generation()) return Promise.resolve(unavailable('no-state'));
    return answers.get<T, FoldStateQuery<T>>(state, call as FoldStateCall<unknown>, () => withState(state, call));
  };

  const peek = <T>(state: FoldEngineStateHandle, call: FoldStateCall<T>): { value: T } | null =>
    holdsEngine() && state.generation === runtime.generation()
      ? answers.peek<T>(state, call as FoldStateCall<unknown>)
      : null;

  return {
    store,

    retain() {
      holders += 1;
      if (holders === 1) {
        const kept = lingering !== null;
        stopLingering();
        if (!kept) runtime.retain();
        halted = false;
        restarts = 0;
        error = null;
        if (!kept || replayOwed) start();
        render();
      }
      let held = true;
      return () => {
        if (!held) return;
        held = false;
        holders -= 1;
        if (holders > 0) return;
        // A halted engine is not worth keeping: the next hold starts it afresh.
        if (lingerMs > 0 && !halted) startLingering();
        else stop();
      };
    },

    analyse,
    preview,
    resolveOrders,
    axiomRoots,

    async commitStep(op, choices) {
      if (committing) return unavailable('busy');
      committing = true;
      try {
        const from = await foldableFrom();
        if ('status' in from) return from;
        return await commit(from, op, choices);
      } finally {
        committing = false;
      }
    },

    async commitLanded(landed) {
      if (committing) {
        engine?.release(landed.state);
        return unavailable('busy');
      }
      committing = true;
      try {
        const from = await foldableFrom();
        if (!('status' in from)) return commitLandedFrom(from, landed);
        engine?.release(landed.state);
        return from;
      } finally {
        committing = false;
      }
    },

    cancel() {
      dropPending();
      dropOffer();
      dropAnalysis();
      render();
    },

    cancelSearch(ticket) {
      // With no hold there is no worker, and no search on it. A lingering one
      // hears the cancel a tool sends as it goes, so nothing runs while it waits.
      if (!holdsEngine()) return;
      // An engine that has gone took its searches with it.
      runtime.ask((worker) => worker.cancelSearch?.(ticket.id) ?? Promise.resolve()).catch(() => undefined);
    },

    withState,
    withNode,
    withCursor: (call) => withNode(store.getState().cursor, call),
    query,
    peek,

    retry() {
      halted = false;
      restarts = 0;
      error = null;
      start();
      render();
    },

    dispose() {
      if (holdsEngine()) {
        holders = 0;
        stop();
      }
      unsubscribeDocument();
      unsubscribeLoss();
    },
  };
}
