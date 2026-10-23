import { prepareRepeatSearch, REPEAT_PREPARATION_MS, type RepeatPrepared, type RepeatRequest } from '../fold/repeat/repeatPreparation';
import { repeatSymmetries } from '../fold/repeat/repeatGeometry';
import type { FoldOrderQuery, FoldOrderSelection } from '../fold/engine/foldEngineCompoundCalls';
import {
  createFoldEngineTurns,
  createFoldSearchRunner,
  FoldSearchStopped,
  type FoldSearchTicket,
} from '../fold/engine/foldSearch';
/**
 * The Fold engine's bridge (`crates/oristudio-fold-wasm`), alone in a worker.
 *
 * One `FoldEngine` holds every state this worker has landed, by handle: a
 * replay's cache, the step on screen and the preview under the pointer. The
 * calls are `fold/engine/foldEngineCalls.ts`, which checks every argument and
 * takes `fs1` fingerprints here, so a step's answer is a handle, a summary
 * and sixteen hex digits however large the state. Errors leave as
 * `{ code, message }` envelopes like every other bridge; refusals are values.
 * A failure that is not an envelope — a trap — leaves the engine dead, and
 * this call and every one after it answer `fold_engine_trapped`
 * (`fold/engine/foldEngineTrap.ts`), which the runtime replaces the worker on.
 *
 * An engine call cannot be interrupted. The searches written over the calls —
 * a pleat's orders, a repeat's preparation (`fold/engine/foldSearch.ts`) — run
 * in slices instead, giving the thread back between engine calls: a cancel
 * for one ({@link api.cancelSearch}) stops it there, and the calls that only
 * read the engine (`&self` in the bridge) are answered meanwhile, so the
 * canvas keeps drawing. Every call that changes the engine waits its turn
 * behind the search ({@link changing}), as it always waited behind any call:
 * nothing lands, lets a state go or replaces the engine's order search under
 * a search between its slices. The runtime that owns the worker
 * (`store/workspaceStore/foldSequenceRuntime.ts`) can still stop everything
 * by terminating it, and every handle goes with it.
 *
 * Same shape as `precreaseWorker.ts`: lazy `init()`, one `call()` wrapper.
 */
import { expose } from 'comlink';
import init, {
  FoldEngine,
  fold_engine_version,
} from '../generated/oristudio-fold-wasm/oristudio_fold_wasm';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { WasmErrorEnvelope } from '../engine/types';
import type { FoldStateFingerprint } from '../fold/document/foldDigest';
import type { FoldChoices, FoldModelLine, FoldPaper, SheetPoint } from '../fold/document/foldSequenceDocument';
import { createFoldEngineCalls, type FoldEngineCalls } from '../fold/engine/foldEngineCalls';
import { createFoldEngineCompoundCalls, type FoldEngineCompoundCalls } from '../fold/engine/foldEngineCompoundCalls';
import { isFoldPlacementOp } from '../fold/engine/foldPlacementSearch';
import {
  axiomRootsWithSections,
  type FoldRootSectionHint,
  type FoldRootsAnswered,
} from '../fold/engine/foldEngineRoots';
import {
  previewStep,
  resolveOrdersWithPreview,
  type FoldOrdersPreviewed,
  type FoldPreviewed,
  type FoldPreviewWants,
} from '../fold/engine/foldEnginePreview';
import type { FoldCompoundAnalysis, FoldEngineCompoundOp } from '../fold/engine/foldEngineCompoundWire';
import {
  createFoldEngineCrimpTuckCalls,
  type FoldCrimpTuckOutcome,
  type FoldEngineCrimpTuckCalls,
} from '../fold/engine/foldEngineCrimpTuckCalls';
import type { FoldEngineCrimpOp, FoldEngineTuckOp } from '../fold/engine/foldEngineCrimpTuckWire';
import { createFoldEngineIoCalls, type FoldEngineIoCalls } from '../fold/engine/foldEngineIoCalls';
import { createFoldEngineSinkCalls, type FoldEngineSinkCalls } from '../fold/engine/foldEngineSinkCalls';
import type {
  FoldEngineSinkOp,
  FoldSinkOrders,
  FoldSinkPicked,
  FoldSunkPoints,
} from '../fold/engine/foldEngineSinkWire';
import { createFoldEngineVertexCalls, type FoldEngineVertexCalls } from '../fold/engine/foldEngineSquashCalls';
import { foldEngineTrapOf, type FoldEngineTrapped } from '../fold/engine/foldEngineTrap';
import type { FoldVertexFingerprinted, FoldVertexTried } from '../fold/engine/foldEngineSquashWire';
import type { FoldVertexOp } from '../fold/document/foldSequenceDocument';
import { swivelReach, type FoldSwivelReach, type FoldSwivelReachAsk } from '../fold/tools/vertex/swivelReach';
import type {
  FoldExported,
  FoldImportFingerprinted,
  FoldImportLimits,
  FoldImportOpened,
  FoldImportSource,
  FoldSheetFound,
  FoldImportTarget,
} from '../fold/engine/foldEngineIoWire';
import type {
  FoldActed,
  FoldAnalysed,
  FoldAxiomCandidates,
  FoldAxiomLine,
  FoldDepthChosen,
  FoldEngineOp,
  FoldEngineOutcome,
  FoldLandmarks,
  FoldModelPoint,
  FoldScene,
  FoldSectioned,
  FoldSheetLanded,
  FoldSide,
  FoldStateSummary,
  FoldStepActed,
  FoldStepFingerprinted,
  FoldStepLanded,
  FoldStepSummarised,
  FoldTopVisible,
} from '../fold/engine/foldEngineWire';

/** The step calls, the io calls, the compound question and each compound family's own calls, over one engine. */
type FoldWorkerCalls = FoldEngineCalls &
  FoldEngineIoCalls &
  FoldEngineCompoundCalls &
  FoldEngineCrimpTuckCalls &
  FoldEngineVertexCalls &
  FoldEngineSinkCalls;

let ready: Promise<FoldWorkerCalls> | null = null;

/**
 * The module, and the one engine every call shares. A start that failed — a
 * fetch of the `.wasm` that did not arrive, a compile that ran out of memory —
 * is forgotten, so the next call starts it again: the session's retry asks
 * this same worker, which nothing replaces while it is alive.
 */
function ensureReady(): Promise<FoldWorkerCalls> {
  if (ready) return ready;
  const starting = init().then(() => {
    const engine = new FoldEngine();
    return {
      ...createFoldEngineCalls(engine),
      ...createFoldEngineIoCalls(engine),
      ...createFoldEngineCompoundCalls(engine),
      ...createFoldEngineCrimpTuckCalls(engine),
      ...createFoldEngineVertexCalls(engine),
      ...createFoldEngineSinkCalls(engine),
    };
  });
  ready = starting;
  starting.catch(() => {
    if (ready === starting) ready = null;
  });
  return starting;
}

function normalizeError(error: unknown): WasmErrorEnvelope {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return error as WasmErrorEnvelope;
  }
  return {
    code: 'oristudio_fold_wasm_error',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * The failure that killed the engine, once one has (`foldEngineTrap.ts`):
 * every later call answers it without touching the instance, until the
 * runtime, which replaces the worker on the first answer, terminates this one.
 */
let trapped: FoldEngineTrapped | null = null;

/**
 * A call that only reads the engine: answered at once, between a search's
 * slices too. A search is awaited here, so a trap in any of its slices is
 * caught like one in a plain call.
 */
async function call<T>(fn: (calls: FoldWorkerCalls) => T | Promise<T>): Promise<T> {
  if (trapped) throw trapped;
  let calls: FoldWorkerCalls;
  try {
    calls = await ensureReady();
  } catch (error) {
    // A start that failed: nothing ran, and the next call starts again.
    throw normalizeError(error);
  }
  if (trapped) throw trapped;
  try {
    return await fn(calls);
  } catch (error) {
    // A search stopped at a yield it did not answer is our own control flow, not the engine failing.
    if (error instanceof FoldSearchStopped) throw normalizeError(error);
    const trap = foldEngineTrapOf(error);
    if (!trap) throw normalizeError(error);
    trapped = trap;
    console.error('[ori-studio] the fold engine failed mid-call; this worker answers nothing more', error);
    throw trap;
  }
}

const turns = createFoldEngineTurns();

/**
 * A call that changes the engine — lands a state, lets one go, moves its
 * order search — or runs a search over it: run after every such call before
 * it has finished, in the order they came.
 */
function changing<T>(fn: (calls: FoldWorkerCalls) => T | Promise<T>): Promise<T> {
  return turns(() => call(fn));
}

/** This worker's searches, which a ticket cancels. */
const searches = createFoldSearchRunner();

/**
 * A fold's orders: a pleat's, and a valley's or mountain's placements for
 * as long as the query asks, as a search in slices; any other fold's in one
 * call.
 */
function selectOrders(
  calls: FoldWorkerCalls,
  state: number,
  op: FoldEngineOp,
  choices: FoldChoices | undefined,
  query: FoldOrderQuery,
  search: FoldSearchTicket | undefined
): FoldEngineOutcome<FoldOrderSelection> | Promise<FoldEngineOutcome<FoldOrderSelection>> {
  if (op.kind === 'pleat') {
    const pleat = calls.pleatOrderSearch(state, op, choices, query);
    return searches.run(pleat.search, pleat.budgetMs, search);
  }
  if (query.searchMs !== undefined && isFoldPlacementOp(op)) {
    const placing = calls.placementOrderSearch(state, op, choices, query);
    return searches.run(placing.search, placing.budgetMs, search);
  }
  return calls.orderSelection(state, op, choices, query);
}

const api = {
  async repeatAxes(state: number) {
    return call((calls) => repeatSymmetries(calls.scene(state), calls.summary(state).sheet));
  },
  /** A repeat's preparation, in slices; rejects with `fold_search_cancelled` once its ticket is cancelled. */
  async prepareRepeat(request: RepeatRequest, search?: FoldSearchTicket): Promise<RepeatPrepared> {
    return changing((calls) => searches.run(prepareRepeatSearch(calls, request), REPEAT_PREPARATION_MS, search));
  },
  /** Stop the ticket's search at its next slice, or before it starts. Not queued behind it. */
  async cancelSearch(id: number): Promise<void> {
    searches.cancel(id);
  },
  /** `FOLD_ENGINE_VERSION`, stored beside every cached state. */
  async engineVersion(): Promise<number> {
    return call(() => fold_engine_version());
  },

  /** The flat sheet a sequence starts from, with its fingerprint. */
  async sheet(paper: FoldPaper): Promise<FoldEngineOutcome<FoldSheetLanded>> {
    return changing((calls) => calls.sheet(paper));
  },

  async returnTo(current: number, target: number, history: readonly number[]): Promise<FoldEngineOutcome<FoldStepFingerprinted>> {
    return changing((calls) => calls.returnTo(current, target, history));
  },

  /** One step for a preview (D14 tier 3): a new handle, no fingerprint. */
  async apply(state: number, op: FoldEngineOp, choices?: FoldChoices): Promise<FoldEngineOutcome<FoldStepLanded>> {
    return changing((calls) => calls.apply(state, op, choices));
  },

  /**
   * One step for a preview, with what the preview shows of it read in the
   * same turn (`fold/engine/foldEnginePreview.ts`): one round trip.
   */
  async previewStep(state: number, op: FoldEngineOp, choices: FoldChoices | undefined, wants: FoldPreviewWants): Promise<FoldPreviewed> {
    return changing((calls) => previewStep(calls, state, op, choices, wants));
  },

  /** One step with its fingerprint: what a replay and a commit take. */
  async step(
    state: number,
    op: FoldEngineOp,
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldStepFingerprinted>> {
    return changing((calls) => calls.step(state, op, choices));
  },

  async summary(state: number): Promise<FoldStateSummary> {
    return call((calls) => calls.summary(state));
  },

  async fingerprint(state: number): Promise<FoldStateFingerprint> {
    return call((calls) => calls.fingerprint(state));
  },

  /** Let states go; how many were held. */
  async release(states: readonly number[]): Promise<number> {
    return changing((calls) => calls.release(states));
  },

  /** Let every state go. */
  async clear(): Promise<void> {
    return changing((calls) => calls.clear());
  },

  /** How many states are held, for diagnostics and tests. */
  async live(): Promise<number> {
    return call((calls) => calls.live());
  },

  // Queries on a handle (plan D12, D14): the panes' and the tools'.

  /** What a fold along a line would move, without folding (D14 tier 2). */
  async analyse(state: number, op: FoldEngineOp, choices?: FoldChoices): Promise<FoldEngineOutcome<FoldAnalysed>> {
    return call((calls) => calls.analyse(state, op, choices));
  },

  /** That fold's picture on `state`, before it lands. */
  async action(state: number, op: FoldEngineOp, choices?: FoldChoices): Promise<FoldEngineOutcome<FoldActed>> {
    return call((calls) => calls.action(state, op, choices));
  },

  /** The moving sets a depth seed at the sheet point `at` can pick. */
  async depthChoices(
    state: number,
    op: FoldEngineOp,
    at: SheetPoint,
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldDepthChosen>> {
    return call((calls) => calls.depthChoices(state, op, at, choices));
  },

  /** The layers along a model line on one side of it, with their joins (D14 tier 2). */
  async crossSection(
    state: number,
    line: FoldModelLine,
    side: FoldSide
  ): Promise<FoldEngineOutcome<FoldSectioned>> {
    return call((calls) => calls.crossSection(state, line, side));
  },

  /** An axiom line's folds here, for the candidate chooser. */
  async axiomCandidates(state: number, line: FoldAxiomLine): Promise<FoldEngineOutcome<FoldAxiomCandidates>> {
    return call((calls) => calls.axiomCandidates(state, line));
  },

  /**
   * An axiom line's folds here, with the layers at the one the tool takes,
   * which it asks for next (`fold/engine/foldEngineRoots.ts`): one round trip.
   */
  async axiomRoots(state: number, line: FoldAxiomLine, hint: FoldRootSectionHint | null): Promise<FoldRootsAnswered> {
    return call((calls) => axiomRootsWithSections(calls, state, line, hint));
  },

  /** The summary of the step that landed `state`, while its parent is held. */
  async stepSummary(state: number): Promise<FoldEngineOutcome<FoldStepSummarised>> {
    return call((calls) => calls.stepSummary(state));
  },

  /** The picture of the step that landed `state`, while its parent is held. */
  async stepAction(state: number): Promise<FoldEngineOutcome<FoldStepActed>> {
    return call((calls) => calls.stepAction(state));
  },

  async scene(state: number): Promise<FoldScene> {
    return call((calls) => calls.scene(state));
  },

  /** Landmarks with provenance and visibility; Divide-line marks as sheet points. */
  async landmarks(state: number, marks: readonly SheetPoint[]): Promise<FoldLandmarks> {
    return call((calls) => calls.landmarks(state, marks));
  },

  /** The face seen at a model-frame point, and the sheet point there. */
  async topVisibleAt(state: number, at: FoldModelPoint): Promise<FoldTopVisible | null> {
    return call((calls) => calls.topVisibleAt(state, at));
  },

  /** The pinch length a partial precrease's tool offers on the state's sheet. */
  async defaultPinchLength(state: number): Promise<number> {
    return call((calls) => calls.defaultPinchLength(state));
  },

  // Import CP, Edit's folded figure, Send to Edit and the FOLD export
  // (`fold/engine/foldEngineIoCalls.ts`).

  /** Import CP: read the file, import it against the target, complete its order. */
  async importCp(
    source: FoldImportSource,
    target: FoldImportTarget,
    limits?: FoldImportLimits
  ): Promise<FoldEngineOutcome<FoldImportOpened>> {
    return changing((calls) => calls.importCp(source, target, limits));
  },

  /** Import starting sheet: the sheet the pattern's border outlines; nothing is held. */
  async importSheet(source: FoldImportSource): Promise<FoldEngineOutcome<FoldSheetFound>> {
    return call((calls) => calls.importSheet(source));
  },

  /** Land one listed order per component as a step, with its fingerprint and op. */
  async importSearch(importHandle: number, choice: readonly number[], limits?: import('../fold/engine/foldEngineIoWire').FoldImportLimits) {
    return changing((calls) => calls.importSearch(importHandle, choice, limits));
  },

  async importPick(
    importHandle: number,
    choice: readonly number[]
  ): Promise<FoldEngineOutcome<FoldImportFingerprinted>> {
    return changing((calls) => calls.importPick(importHandle, choice));
  },

  /** Start from Edit's folded figure: the kernel's paper scene of it. */
  async importEditFoldedFigure(
    scene: OristudioCpFoldedPaperScene,
    target: FoldImportTarget,
    limits?: FoldImportLimits
  ): Promise<FoldEngineOutcome<FoldImportFingerprinted>> {
    return changing((calls) => calls.importEditFoldedFigure(scene, target, limits));
  },

  /** Let imports go; how many were held. */
  async releaseImports(imports: readonly number[]): Promise<number> {
    return changing((calls) => calls.releaseImports(imports));
  },

  async liveImports(): Promise<number> {
    return call((calls) => calls.liveImports());
  },

  /** Send to Edit: the state's crease pattern as FOLD text. */
  async sendToEdit(state: number, title?: string): Promise<string> {
    return call((calls) => calls.sendToEdit(state, title));
  },

  /** The FOLD file of a path of states. */
  async exportFold(states: readonly number[], title?: string): Promise<FoldEngineOutcome<FoldExported>> {
    return call((calls) => calls.exportFold(states, title));
  },

  // Compound folds (`fold/engine/foldEngineCompoundCalls.ts`): one question
  // for every family, then each family's own choosing calls.

  /** What a compound fold is before it lands, as its family's tools ask; tagged by `family`. */
  async releaseOrderSearch(state: number): Promise<void> {
    return changing((calls) => calls.releaseOrderSearch?.(state));
  },

  /**
   * The orders a fold leaves. A pleat's are a search over the engine's calls,
   * run in slices: with a ticket, cancelling it rejects this with
   * `fold_search_cancelled`.
   */
  async orderSelection(
    state: number,
    op: FoldEngineOp,
    choices: FoldChoices | undefined,
    query: FoldOrderQuery,
    search?: FoldSearchTicket
  ): Promise<FoldEngineOutcome<FoldOrderSelection>> {
    return changing((calls) => selectOrders(calls, state, op, choices, query, search));
  },

  /**
   * The orders a fold leaves, as {@link api.orderSelection} answers them,
   * and — when `wants` is given — the step they resolve previewed in the same
   * turn (`resolveOrdersWithPreview`), which the tool asks for next.
   */
  async resolveOrders(
    state: number,
    op: FoldEngineOp,
    choices: FoldChoices | undefined,
    query: FoldOrderQuery,
    search: FoldSearchTicket | undefined,
    wants: FoldPreviewWants | null
  ): Promise<FoldOrdersPreviewed> {
    return changing((calls) =>
      resolveOrdersWithPreview(calls, () => selectOrders(calls, state, op, choices, query, search), state, op, choices, wants)
    );
  },

  async compoundAnalysis(
    state: number,
    op: FoldEngineCompoundOp,
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldCompoundAnalysis>> {
    return call((calls) => calls.compoundAnalysis(state, op, choices));
  },

  // The crimp and the tuck (`fold/engine/foldEngineCrimpTuckCalls.ts`).

  /** Fold a crimp: landed, an opening to choose, or the orders to choose from. */
  async crimp(state: number, op: FoldEngineCrimpOp, choices?: FoldChoices): Promise<FoldCrimpTuckOutcome<'crimp'>> {
    return changing((calls) => calls.crimp(state, op, choices));
  },

  /** Fold a tuck: landed, or the orders to choose from. */
  async tuck(state: number, op: FoldEngineTuckOp, choices?: FoldChoices): Promise<FoldCrimpTuckOutcome<'tuck'>> {
    return changing((calls) => calls.tuck(state, op, choices));
  },

  // The vertex folds: squash, petal fold, rabbit ear, swivel
  // (`fold/engine/foldEngineSquashCalls.ts`).

  /** Fold it: landed with its fingerprint, or a choice of orders held under a handle. */
  async vertexFold(
    state: number,
    op: FoldVertexOp,
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldVertexTried>> {
    return changing((calls) => calls.vertexFold(state, op, choices));
  },

  /** Land one listed order per component, with the choices the step stores. */
  async vertexPick(pending: number, choice: readonly number[]): Promise<FoldEngineOutcome<FoldVertexFingerprinted>> {
    return changing((calls) => calls.vertexPick(pending, choice));
  },

  /** Let pending choices go; how many were held. */
  async releaseVertexChoices(pending: readonly number[]): Promise<number> {
    return changing((calls) => calls.releaseVertexChoices(pending));
  },

  /**
   * What a swivel can do from where its creases meet: every edge offered
   * against every line, through the compound question here, what lands kept
   * (`fold/tools/vertex/swivelReach.ts`) — one round trip for a pick.
   */
  async swivelReach(state: number, ask: FoldSwivelReachAsk): Promise<FoldSwivelReach> {
    return call((calls) => swivelReach((op) => calls.compoundAnalysis(state, op), ask));
  },

  // A sink tool's own queries (`fold/engine/foldEngineSinkCalls.ts`); a sink
  // itself lands through `step`.

  /** How many orders the sink leaves with these choices. */
  async sinkOrders(
    state: number,
    op: FoldEngineSinkOp,
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldSinkOrders>> {
    return call((calls) => calls.sinkOrders(state, op, choices));
  },

  /** The completion a step stores for one listed order per component. */
  async sinkPick(
    state: number,
    op: FoldEngineSinkOp,
    choice: readonly number[],
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldSinkPicked>> {
    return call((calls) => calls.sinkPick(state, op, choice, choices));
  },

  /** The sunk points an unsink op's line can pull back out, on its side. */
  async sunkPoints(
    state: number,
    op: FoldEngineSinkOp,
    choices?: FoldChoices
  ): Promise<FoldEngineOutcome<FoldSunkPoints>> {
    return call((calls) => calls.sunkPoints(state, op, choices));
  },
};

export type FoldSequenceWorkerApi = typeof api;

expose(api);
