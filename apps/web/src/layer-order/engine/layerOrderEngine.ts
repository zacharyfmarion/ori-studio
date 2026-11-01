/**
 * The Layer order dialog's engine, as TypeScript sees it: one constraint
 * session over a flat fold, and the solution count beside it
 * (`implementation-plans/layer-order-dialog.md`, approach 1 and 5).
 *
 * It is the Fold bridge's `layer_*` calls (E7, `layerOrderWire.ts`) call for
 * call, and the answers are the bridge's own shapes, re-exported from the
 * wire, so the worker's backend over the bridge
 * (`workers/layerOrderBridgeBackend.ts`) is close to a pass-through. What the
 * contract adds to the bridge:
 *
 * - **One session per worker, and no handle.** The worker that hosts it
 *   (`workers/layerOrderWorker.ts`) holds at most one; an open or a restore
 *   replaces it. One worker file serves both roles, each in a worker of its
 *   own: the dialog's session and the hosts' engine (H2).
 * - **One solutions cursor per session, and no handle either.** The worker
 *   starts it on the first count slice, step or position, and starts it
 *   again whenever the committed constraints change (an open, a restore, a
 *   commit); a step keeps it. The count, the stepper's "3 of 12" and its
 *   steps all read that one cursor. {@link LayerOrderSolutionCalls.countSlice}
 *   advances it by one short slice; the dialog's runtime asks for one after
 *   each answer (`layerOrderRuntime.ts`), so the count runs between the
 *   dialog's other calls in the same worker, and a call waits behind one
 *   slice at most.
 * - **Limits are always given, deadline included** ({@link
 *   LayerOrderLimits}). The wasm has no cancel channel: a call runs until it
 *   answers, so the deadline bounds it and terminating the worker is the
 *   only stop (`layerOrderRuntime.ts`). "Keep trying" is the same call again
 *   with {@link keepTrying}'s limits.
 * - **Constraints as tuples** ({@link LayerConstraint}), and the record as
 *   the host's own `LayerOrderRecord` (`lib/layerOrder/`), where the bridge
 *   takes packed triples and JSON.
 *
 * As on the bridge: outputs are snake_case, large data typed arrays, small
 * results plain objects. **A refusal is an answer; a rejection is the call
 * failing.** What the engine can't do with the user's fold (a source it can't
 * order, an open that ran out of time) resolves as `{ status: 'refused' }`; a
 * check's verdict resolves as `fits`, `cant_fit` or `timed_out`. A rejection
 * is a `{ code, message }` envelope: a caller's mistake or a defect (the
 * bridge's {@link LayerCallErrorCode}s), the worker's own
 * ({@link LAYER_ORDER_CALL_FAILURES}), or the runtime's word that the worker
 * went away.
 *
 * Faces are the host kernel's own (`faceIndex.ts`): dialog face *k* is
 * Oriedita face *k*.
 *
 * Types and a few pure helpers. React-free, store-free and engine-free.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { LayerOrderRecord, LayerOrderSign } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import type { LayerFace } from './faceIndex';
import type {
  LayerCarriedRow,
  LayerCommitted,
  LayerExplained,
  LayerOpened,
  LayerOpenedOn,
  LayerOrderBits,
  LayerPosition,
  LayerPreviewed,
  LayerRefused,
  LayerRestored,
  LayerShown,
  LayerSide,
  LayerSolutionCount,
  LayerStacks,
  LayerStepBy,
  LayerStepped,
} from './layerOrderWire';

// ---------------------------------------------------------------------------
// The bridge's shapes, as the bridge answers them

export type {
  LayerBudgetLimit,
  LayerCallErrorCode,
  LayerCantFit,
  LayerCantFitProof,
  LayerCarriedRow,
  LayerChangedSpots,
  LayerCheckStage,
  LayerCommitted,
  LayerExplained,
  LayerOpenedOn,
  LayerOrderBits,
  LayerPosition,
  LayerPreviewed,
  LayerRefusal,
  LayerRefused,
  LayerShown,
  LayerRestoreOutcomeKind,
  LayerSavedConstraintStatus,
  LayerSide,
  LayerSolutionCaps,
  LayerSolutionCount,
  LayerStacks,
  LayerStepBy,
  LayerStepped,
  LayerTally,
  LayerTimedOut,
  LayerToleranceCause,
} from './layerOrderWire';
export {
  SAVED_FACE_AMBIGUOUS,
  SAVED_FACE_GONE,
  SAVED_FACE_INTACT,
  SAVED_PAIR_KEPT,
  SAVED_PAIR_MOVED,
  SAVED_PAIR_UNRESOLVED,
} from './layerOrderWire';

// ---------------------------------------------------------------------------
// Constraints

/**
 * One constraint: `subject` lies on `object`'s `sign` side wherever the two
 * overlap, by FOLD's `faceOrders` rule (1: the object's front side, -1: its
 * back), as the saved record writes them. Relative to the paper, so turning
 * the view over never changes it.
 */
export type LayerConstraint = readonly [subject: LayerFace, object: LayerFace, sign: LayerOrderSign];

/** The verb of a constraint, as the sentence reads it from the side shown. */
export type LayerVerb = 'in_front_of' | 'behind';

/**
 * "`subject` `verb` `object`" read from `side`, as a constraint: E5's
 * `Constraint::seen`. `objectFrontUp` is whether the object shows its front
 * from the front side ({@link LayerOrderOpened.front_up}).
 */
export function constraintSeen(
  subject: LayerFace,
  verb: LayerVerb,
  object: LayerFace,
  side: LayerSide,
  objectFrontUp: boolean
): LayerConstraint {
  // Nearer a viewer of the front: in front of from the front, behind from the back.
  const nearerTheFront = (verb === 'in_front_of') === (side === 'front');
  // FOLD's rule: the side above a face is its front side exactly when it shows its front.
  return [subject, object, nearerTheFront === objectFrontUp ? 1 : -1];
}

/** How a constraint reads from `side`: E5's `Constraint::verb`, the inverse of {@link constraintSeen}. */
export function constraintVerb(constraint: LayerConstraint, side: LayerSide, objectFrontUp: boolean): LayerVerb {
  const nearerTheFront = (constraint[2] === 1) === objectFrontUp;
  return nearerTheFront === (side === 'front') ? 'in_front_of' : 'behind';
}

/** Constraints as the bridge takes them: `[subject, object, sign, …]`. */
export function packConstraints(constraints: readonly LayerConstraint[]): Int32Array {
  const triples = new Int32Array(constraints.length * 3);
  constraints.forEach((constraint, i) => triples.set(constraint, i * 3));
  return triples;
}

/** The bridge's triples as constraints; a sign that is not ±1 reads as -1, which the bridge never writes. */
export function unpackConstraints(triples: Int32Array): LayerConstraint[] {
  const constraints: LayerConstraint[] = [];
  for (let i = 0; i + 2 < triples.length; i += 3) {
    constraints.push([triples[i]!, triples[i + 1]!, triples[i + 2] === 1 ? 1 : -1]);
  }
  return constraints;
}

/** How many spots a stack set covers. */
export function spotCount(stacks: LayerStacks): number {
  return Math.max(0, stacks.offsets.length - 1);
}

// ---------------------------------------------------------------------------
// The stepper's ends

/**
 * The ways a step proved nothing lies from the order on screen (its `end`,
 * E9), each kept once proved: ‹ proved first stays proved after a › that ran
 * out or ended too. They hold for that order only, so whoever keeps them lets
 * them go when the order moves or the stepper steps by something else.
 */
export interface LayerProvedEnds {
  readonly previous: boolean;
  readonly next: boolean;
}

/** Neither way proved. */
export const NO_PROVED_ENDS: LayerProvedEnds = Object.freeze({ previous: false, next: false });

/** `proved`, with a step's `end` that way proved too. */
export function withProvedEnd(
  proved: LayerProvedEnds | null | undefined,
  direction: 'next' | 'previous'
): LayerProvedEnds {
  return { ...(proved ?? NO_PROVED_ENDS), [direction]: true };
}

/**
 * Whether `position` is at either end of the stepper's fixed order, for every
 * ‹ and › that steps through it, the dialog's and the hosts' alike: the first
 * and the last once the total is exact, or a way a step proved nothing lies
 * (`proved`, E9) whatever the count says.
 *
 * Before the total is exact, `index` counts the solutions found so far, not
 * their rank: a step back may still find one the count lists before the
 * first found, so ‹ stays even at 1. `only` is the one solution there is:
 * both ends at once, so an unfinished count says it once both are proved.
 */
export function layerPositionEnds(
  position: LayerPosition,
  proved?: LayerProvedEnds | null
): { first: boolean; last: boolean; only: boolean } {
  const { index, total } = position;
  const first = proved?.previous === true || (total.exact && index <= 1);
  const last = proved?.next === true || (total.exact && index >= total.n);
  return { first, last, only: first && last && total.n <= 1 };
}

// ---------------------------------------------------------------------------
// Limits

/**
 * What one call may spend: E5's `Limits`, every field given. A count slice
 * spends them on counting: one node per search node and per combination
 * walked.
 */
export interface LayerOrderLimits {
  /** Search nodes for the open's first order and a check's exhaustive search. */
  readonly maxNodes: number;
  /** Nodes for each of a check's quick attempts, the ones steered by the order on screen. */
  readonly fastNodes: number;
  /**
   * How long the call may search, in milliseconds from the moment the engine
   * starts it, by the worker's own clock, so the two threads' clocks never
   * meet. Building the source runs to its end first.
   */
  readonly deadlineMs: number;
}

/** E5's defaults: 200,000 nodes, 128 quick nodes. */
const NODES = { maxNodes: 200_000, fastNodes: 128 } as const;

/**
 * The limits the dialog asks with: a preview's about 3 s (approach 5), the
 * rest generous. Census 2 (E8, `scripts/layer-order-census.mjs`) measured
 * them in wasm over cpoogle and kept them: opens took at most 2.3 s (p95
 * 0.82 s), previews 57 ms (p95 10 ms), a commit that searched 3.7 ms and a
 * restore 2.3 s. On iguana-c0 the open took 2.3 s, previews 0.66 s at the
 * median, a restore 2.8 s, and one preview of eleven ran past 30 s, so it
 * reads "couldn't check in time" at 3 s. A step checks one solution, as a
 * preview does. An explain runs a few checks, but gets the preview's 3 s too:
 * a wasm call can't be stopped, so a longer one would hold the worker from the
 * user's next preview or Apply; one that runs out offers Keep trying. The
 * count's slice is `LAYER_ORDER_COUNT_SLICE` (`layerOrderBudgets.ts`).
 *
 * An open and a restore get a minute: the dialog opens behind "Working out
 * the layer orders…" with Cancel, which ends its worker at once, and a host's
 * restore (H2's resolve, which a refold or a reopen makes) behind its Stop.
 * The figures stacked deepest take that long: the source admits stacks up to
 * `LAYER_ORDER_MAX_STACKED_TRIPLES` (`crates/oristudio-fold/src/steer/source.rs`),
 * whose deepest real design opened in 33–39 s and restored in 30–37 s.
 */
export const LAYER_ORDER_LIMITS = {
  open: { ...NODES, deadlineMs: 60_000 },
  preview: { ...NODES, deadlineMs: 3_000 },
  commit: { ...NODES, deadlineMs: 10_000 },
  restore: { ...NODES, deadlineMs: 60_000 },
  step: { ...NODES, deadlineMs: 3_000 },
  explain: { ...NODES, deadlineMs: 3_000 },
} as const satisfies Record<string, LayerOrderLimits>;

/** How much further {@link keepTrying} lets a call go each time. */
export const KEEP_TRYING_FACTOR = 4;

/**
 * The limits for asking again after a call ran out ("Keep trying"): a later
 * deadline and more nodes. Both grow, because the search is deterministic: a
 * call that ran out of nodes would stop at the same node again however late
 * its deadline.
 */
export function keepTrying(limits: LayerOrderLimits, factor: number = KEEP_TRYING_FACTOR): LayerOrderLimits {
  return {
    maxNodes: Math.ceil(limits.maxNodes * factor),
    fastNodes: limits.fastNodes,
    deadlineMs: Math.ceil(limits.deadlineMs * factor),
  };
}

// ---------------------------------------------------------------------------
// The session's results: the bridge's, with no handle and constraints as tuples

/** A session, opened: the bridge's `LayerOpened`, with no handle. */
export type LayerOrderOpened = Omit<LayerOpened, 'session'>;

export type LayerOrderOpenOutcome = LayerOrderOpened | LayerRefused;

/**
 * A record restored onto the creases as they are now (D10): the session it
 * opened, each part of the record found again, and the saved constraints it
 * did not apply ({@link LayerCarriedRow}), which a save writes back.
 */
export type LayerOrderRestored = Omit<LayerRestored, 'session' | 'constraints'> & {
  /** The constraints committed: the intact ones when applied, none otherwise. */
  constraints: LayerConstraint[];
};

export type LayerOrderRestoreOutcome = LayerOrderRestored | LayerRefused;

/** The record to save, and its compact JSON, byte for byte `encodeLayerOrderRecord`'s. */
export type LayerOrderSaveOutcome = { status: 'ok'; record: LayerOrderRecord; json: string } | LayerRefused;

/**
 * One slice of the solution count: what the worker's cursor has counted so
 * far. `epoch` names the cursor: it moves each time the worker starts
 * counting again, so a slice of an older count is told from the current one.
 */
export interface LayerOrderCountSlice {
  epoch: number;
  count: LayerSolutionCount;
}

// ---------------------------------------------------------------------------
// The engine

/** The session's calls (E5, through E7's bridge). */
export interface LayerOrderSessionCalls {
  /** Open a session over `source` on the solver's first order. Replaces any session open. */
  open(source: LayerOrderSource, limits: LayerOrderLimits): Promise<LayerOrderOpenOutcome>;
  /**
   * Open a session over `source` on the order the host shows: `relations`,
   * `[upper, lower, …]` as `layerOrderSceneRelations` reads them off the
   * host's paper scene. `opened_on` says whether it was held whole or the
   * closest fitting order stands in for it (D19). Replaces any session open.
   */
  openShowing(source: LayerOrderSource, relations: Uint32Array, limits: LayerOrderLimits): Promise<LayerOrderOpenOutcome>;
  /**
   * Open a session over `source` and restore `record` onto it, its points in
   * the crease pattern's coordinates (`paperFrame.ts`). Replaces any session open.
   */
  restore(source: LayerOrderSource, record: LayerOrderRecord, limits: LayerOrderLimits): Promise<LayerOrderRestoreOutcome>;
  /** Restore `record` again on the session open (a retry, Keep trying). */
  restoreRecord(record: LayerOrderRecord, limits: LayerOrderLimits): Promise<LayerOrderRestoreOutcome>;
  /** Where the order on screen came from, at the open or the last restore. */
  openedOn(): Promise<LayerOpenedOn>;
  /** The pairs still open, as {@link LayerOrderOpened.open_pairs}. */
  openPairs(): Promise<Uint32Array>;
  /** The committed constraints, as built. */
  constraints(): Promise<LayerConstraint[]>;
  /**
   * Whether the committed constraints and `candidate` leave an order. Never
   * changes the session; a fit carries the `token` Add adopts it by.
   */
  preview(candidate: LayerConstraint, limits: LayerOrderLimits): Promise<LayerPreviewed>;
  /** The same for any list (the dialog's rows after a clash, plus one); `cant_fit.constraints` index it. */
  previewList(constraints: readonly LayerConstraint[], limits: LayerOrderLimits): Promise<LayerPreviewed>;
  /**
   * Make `constraints` the committed list (remove and Clear all each send
   * the whole list). A list the order on screen still fits, as any list that
   * only lost constraints does, keeps it exactly.
   */
  commit(constraints: readonly LayerConstraint[], limits: LayerOrderLimits): Promise<LayerCommitted>;
  /** The order on screen, packed one bit per pair: what {@link show} puts back. */
  order(): Promise<LayerOrderBits>;
  /**
   * Undo and redo: commit `constraints` and put `order` ({@link order}'s,
   * from earlier) back on screen exactly, with no search. `refused` when it
   * does not fit the creases and the constraints; nothing changes then. A
   * solutions cursor counting the same constraints stays good.
   */
  show(constraints: readonly LayerConstraint[], order: LayerOrderBits, limits: LayerOrderLimits): Promise<LayerShown>;
  /**
   * Add: commit `constraints`, the list a preview checked, by that preview's
   * `token`. Adopted with no search (`adopted`, so it cannot time out) while
   * it is the session's last preview; otherwise committed by a search within
   * `limits`.
   */
  commitPreview(token: number, constraints: readonly LayerConstraint[], limits: LayerOrderLimits): Promise<LayerCommitted>;
  /** The saved constraints the last restore did not apply, in record order. */
  carried(): Promise<LayerCarriedRow[]>;
  /**
   * Remove the carried row whose record index is `index` (`LayerCarriedRow.index`, never its place
   * in {@link carried}) from the session; whether there was one. The dialog never does: a removal it
   * can still undo is left out of {@link save}'s `keepCarried` instead.
   */
  removeCarried(index: number): Promise<boolean>;
  /** Drop every carried row (Clear all). */
  clearCarried(): Promise<void>;
  /** The order on screen's stacks from `side`. */
  stacks(side: LayerSide): Promise<LayerStacks>;
  /**
   * The paper scene of the order on screen from `side`, drawn by the kernel's
   * own builder with the source's model, so the dialog draws what Apply's new
   * fold will; null when the figure has no subfaces.
   */
  scene(side: LayerSide): Promise<OristudioCpFoldedPaperScene | null>;
  /**
   * The record to save: the committed constraints, then the carried rows as saved, and the order's
   * free pairs. `keepCarried` names the carried rows to write back by record index (every one when
   * left out); the session keeps them all, so a save the host refuses has removed nothing.
   */
  save(keepCarried?: readonly number[]): Promise<LayerOrderSaveOutcome>;
  /**
   * The order on screen as Oriedita's relations, flat `[upper, lower, …]` over
   * the kernel's faces: what the host seeds its fold with
   * (`LayerOrderApplied.relations`).
   */
  relations(): Promise<Uint32Array>;
  /** Let the session go, with its cursor. The worker stays, for the next open. */
  close(): Promise<void>;
}

/** Why a sentence can't fit, and the solutions (E6). */
export interface LayerOrderSolutionCalls {
  /**
   * The smallest set among the committed constraints and `candidate` (or the
   * committed alone, for null) that clashes with the creases. Never commits.
   */
  explain(candidate: LayerConstraint | null, limits: LayerOrderLimits): Promise<LayerExplained>;
  /** The same for any list. */
  explainList(constraints: readonly LayerConstraint[], limits: LayerOrderLimits): Promise<LayerExplained>;
  /**
   * Advance the session's solutions cursor by one slice within `limits`
   * (`LAYER_ORDER_COUNT_SLICE`, `layerOrderBudgets.ts`), starting it if there is none. Any
   * slicing ends equal to a one-shot count; a done count only reads.
   */
  countSlice(limits: LayerOrderLimits): Promise<LayerOrderCountSlice>;
  /** Where the order on screen lies in the stepper's fixed order ("3 of 12"): by picture from a side, or by layer order. */
  position(by: LayerStepBy): Promise<LayerPosition>;
  /**
   * Show the next or previous solution. Only the order on screen changes and
   * the cursor stays good, so the count goes on; a preview kept from before
   * is dropped (Add then commits from the stepped order).
   */
  step(by: LayerStepBy, direction: 'next' | 'previous', limits: LayerOrderLimits): Promise<LayerStepped>;
}

/** What the worker exposes, and what the runtime hands its owner, guarded. */
export interface LayerOrderEngine extends LayerOrderSessionCalls, LayerOrderSolutionCalls {}

/**
 * The name a worker is spawned with for each role (`layerOrderRuntime.ts`):
 * how the one worker file knows whose it is, and so whether a step also
 * counts on (`layerOrderStepsCount`, E9).
 */
export const LAYER_ORDER_WORKER_NAMES = { dialog: 'layer-order-dialog', host: 'layer-order-host' } as const;

/** A worker's role, by the name it was spawned with: the dialog's, or else a host's. */
export function layerOrderWorkerRole(name: string): keyof typeof LAYER_ORDER_WORKER_NAMES {
  return name === LAYER_ORDER_WORKER_NAMES.dialog ? 'dialog' : 'host';
}

// ---------------------------------------------------------------------------
// When a call fails: the codes and the trap envelope, in a leaf of their own
// (`layerOrderCallFailures.ts`) so the dialog's gateway can read them without
// loading this contract.

export {
  LAYER_ORDER_CALL_FAILURES,
  isLayerOrderEngineTrapped,
  type LayerOrderEngineTrapped,
  type LayerOrderTrapKind,
} from './layerOrderCallFailures';
