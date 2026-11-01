/**
 * The inspector's behaviour that rests on a decision in
 * `implementation-plans/layer-order-dialog.md` ("Decisions"), one export per
 * decision, each built to its recommendation. D5 is decided; D7, D8, D10,
 * D14, D16 and D19 still wait on the owner. Changing one changes the export
 * here and the one test named after it (`layerOrderDecisions.test.ts`); the
 * reducer and the selectors only call these.
 *
 * Pure: no React, no store, no engine calls.
 */
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import { LAYER_ORDER_LABEL_CAP, layerOrderCountStarts } from '../layerOrderBudgets';
import {
  keepTrying,
  type LayerConstraint,
  type LayerFace,
  type LayerOpenedOn,
  type LayerOpenFacts,
  type LayerOrderLimits,
  type LayerSide,
  type LayerSidesStacks,
  type LayerStacks,
  type LayerStepBy,
} from './layerOrderEngineFacts';

// ---------------------------------------------------------------------------
// D5 (decided): X-ray steps through every layer order.

/**
 * What the stepper steps by: the distinct pictures from the side shown, or,
 * with X-ray on, every layer order, because hidden layers are visible then.
 * The status counts what the stepper steps through, so its N is the
 * stepper's.
 */
export function stepByFor(side: LayerSide, xray: boolean): LayerStepBy {
  return xray ? 'layer_order' : { picture: side };
}

// ---------------------------------------------------------------------------
// D7: large figures.

/**
 * Whether a subject's objects are past the label cap
 * (`LAYER_ORDER_LABEL_CAP`, 50, set by phase gate 2 in `layerOrderBudgets.ts`,
 * the cap's one source): past it only the hovered face and the nearest few
 * keep letters (the panes choose which, U8), and the hint counts tinted faces
 * instead of labelled ones ("tinted").
 */
export function objectsPastLabelCap(objects: number): boolean {
  return objects > LAYER_ORDER_LABEL_CAP;
}

/**
 * Whether the background count runs on a session that leaves `openPairs`
 * pairs open: decided at the open and again after each commit, by phase gate
 * 2's threshold (`layerOrderCountStarts`, 20,000 open pairs, in
 * `layerOrderBudgets.ts`, its one source). When it is skipped the stepper
 * still steps, with no total: the status names the solution shown
 * ("Solution 3").
 */
export function solutionCountRuns(openPairs: number): boolean {
  return layerOrderCountStarts(openPairs);
}

// ---------------------------------------------------------------------------
// D8: Add after a preview runs out of time.

/**
 * A preview that ran out leaves Add disabled: a timeout is never "can't fit",
 * and never a fit either. The hint line offers Keep trying, which runs the
 * same check with {@link keepTryingLimits}'s later deadline.
 */
export const ADD_AFTER_PREVIEW_TIMEOUT = false;

/** Keep trying: the same call, with a later deadline and more nodes. Every call that ran out retries through this. */
export function keepTryingLimits(limits: LayerOrderLimits): LayerOrderLimits {
  return keepTrying(limits);
}

// ---------------------------------------------------------------------------
// D10: saved constraints that clash after an edit, or a restore that ran out.

/**
 * Apply waits while any row clashes, or while the saved rows are not yet
 * settled (a restore that ran out of time, or a re-check after a removal).
 * Nothing is applied greedily: the rows that can apply are committed together
 * or not at all, and a clash is never resolved by dropping a row for the user.
 */
export function applyWaitsOnRows(clashing: number, unsettled: boolean): boolean {
  return clashing > 0 || unsettled;
}

// ---------------------------------------------------------------------------
// D14: constraints that need attention.

/**
 * The rows the dialog opens on: the flagged ones, when it was opened from the
 * host's "Review…" action, and none otherwise. The dialog never opens by
 * itself; the host's flag is the only way in to a review.
 */
export function reviewRowsFor(review: boolean, flagged: readonly number[]): readonly number[] | null {
  return review && flagged.length > 0 ? flagged : null;
}

// ---------------------------------------------------------------------------
// D16: Apply.

/** What the dialog opened on, for telling an Apply that changed nothing. */
export interface LayerOrderBaseline {
  readonly constraints: readonly LayerConstraint[];
  /** The record indices of the carried rows. */
  readonly carried: readonly number[];
  readonly stacks: LayerSidesStacks;
  /**
   * Whether the order opened on is the one the host shows, with nothing left
   * over from an edit: no row carried, no attention, held whole.
   */
  readonly matchesHost: boolean;
}

/** What is on screen at Apply. */
export interface LayerOrderAtApply {
  readonly constraints: readonly LayerConstraint[];
  readonly carried: readonly number[];
  readonly stacks: LayerSidesStacks;
}

/**
 * Whether the host handed a record it flagged after an edit (its
 * `attention`, set by H4 and H7): then even an untouched Apply writes, so the
 * host can clear the flag. The one test of it, for both deciders of D16: the
 * dialog shell asks it of its request, and the reducer's init carries its
 * answer (`LayerOrderDialogInit.recordNeedsAttention`).
 */
export function recordNeedsAttentionOf(record: LayerOrderRecord | null): boolean {
  return record?.attention !== undefined;
}

/**
 * Whether even an untouched Apply writes, as the reducer's
 * {@link openedBaseline} takes it (read from a request through
 * `layer-order/dialog/layerOrderDialogInit.ts`): the host flagged its record
 * after an edit ({@link recordNeedsAttentionOf}); or its picture was folded
 * from creases that changed since (the request's `applyRefolds`, D12) and it
 * hands a record, which the Apply is then the refold in. A stale host with no
 * record opens on the order a plain Refold draws, so an untouched Apply there
 * answers "unchanged", and the host runs that Refold.
 */
export function untouchedApplyWrites(record: LayerOrderRecord | null, applyRefolds: boolean | undefined): boolean {
  return recordNeedsAttentionOf(record) || (applyRefolds === true && record !== null);
}

/**
 * What a session opened on: the reducer keeps it at its open (`opened`), and
 * an Apply decided outside the reducer asks it too, the dialog shell's before
 * an inspector (U4's `useLayerOrderSettle`). The order is the host's when it
 * was held whole (or the closest fit moved nothing), the host flagged nothing
 * ({@link recordNeedsAttentionOf}), and a restore applied every saved row.
 */
export function openedBaseline(facts: LayerOpenFacts, recordNeedsAttention: boolean): LayerOrderBaseline {
  const carried = (facts.restore?.carried ?? []).map((row) => row.index);
  const restoredWhole = facts.restore === null || (facts.restore.outcome.kind === 'applied' && carried.length === 0);
  return {
    constraints: facts.constraints,
    carried,
    stacks: facts.stacks,
    matchesHost: openedOnHostOrder(facts.openedOn) && !recordNeedsAttention && restoredWhole,
  };
}

/**
 * Why Apply waits on what a session opened on, before an inspector has
 * changed anything (D10): a restore whose saved rows clash waits for one to
 * be removed (`clash`), and one that ran out of time for its rows to be
 * checked (`unsettled`). The reducer's `applyBlocker` says the same at its
 * open (held equal by a test); the dialog shell asks this until U10's
 * inspector, which asks the reducer, takes over. Null when it can apply.
 */
export function openedApplyBlocker(facts: LayerOpenFacts): 'clash' | 'unsettled' | null {
  switch (facts.restore?.outcome.kind) {
    case 'clash':
      return 'clash';
    case 'timed_out':
      return 'unsettled';
    default:
      return null;
  }
}

/**
 * An Apply that changed nothing writes nothing: the same constraints, the
 * same carried rows and the same order as the host shows. An Apply with no
 * constraints but a browsed solution changed the order, so it writes a
 * record with no constraints.
 */
export function applyChangedNothing(baseline: LayerOrderBaseline, now: LayerOrderAtApply): boolean {
  return (
    baseline.matchesHost &&
    sameConstraints(baseline.constraints, now.constraints) &&
    sameNumbers(baseline.carried, now.carried) &&
    sameStacks(baseline.stacks.front, now.stacks.front) &&
    sameStacks(baseline.stacks.back, now.stacks.back)
  );
}

function sameConstraints(a: readonly LayerConstraint[], b: readonly LayerConstraint[]): boolean {
  return a.length === b.length && a.every((c, i) => c[0] === b[i]![0] && c[1] === b[i]![1] && c[2] === b[i]![2]);
}

function sameNumbers(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function sameStacks(a: LayerStacks, b: LayerStacks): boolean {
  return a === b || (sameNumbers(a.offsets, b.offsets) && sameNumbers(a.faces, b.faces));
}

// ---------------------------------------------------------------------------
// D19: when the order Edit shows can't fold.

/** A line the dialog shows from the moment it opens, about the order it opened on. */
export type LayerOpenNotice =
  /**
   * The host's order can't fold; the dialog shows the nearest one that does.
   * Apply writes it. `face` is the face that sits inside a fold whose crease
   * runs through it, and `crease` the two faces that fold meets at, when the
   * engine found one (D19); null otherwise.
   */
  | {
      readonly key: 'host_order_cant_fold';
      readonly moved: number;
      readonly face: LayerFace | null;
      readonly crease: readonly [LayerFace, LayerFace] | null;
    }
  /** Holding the host's order and the search toward it both ran out: the solver's first order is shown. */
  | { readonly key: 'host_order_timed_out' };

/**
 * Opened on the host's order (not a record): when it can't fold, open on the
 * closest valid order and say why in one line, naming the face that sits
 * inside a fold whose crease runs through it, and that fold's two faces, when
 * the engine found one in the host's order (`opened_on.inside`).
 */
export function hostOrderNotice(openedOn: LayerOpenedOn, openedOnHostOrder: boolean): LayerOpenNotice | null {
  if (!openedOnHostOrder) return null;
  if (openedOn.kind === 'closest' && openedOn.moved > 0) {
    const inside = openedOn.inside ?? null;
    return {
      key: 'host_order_cant_fold',
      moved: openedOn.moved,
      face: inside?.face ?? null,
      crease: inside ? [inside.crease[0], inside.crease[1]] : null,
    };
  }
  if (openedOn.kind === 'first' && openedOn.timed_out) return { key: 'host_order_timed_out' };
  return null;
}

/** Whether the order opened on is the host's own, for {@link LayerOrderBaseline.matchesHost}. */
export function openedOnHostOrder(openedOn: LayerOpenedOn): boolean {
  return openedOn.kind === 'held' || (openedOn.kind === 'closest' && openedOn.moved === 0);
}
