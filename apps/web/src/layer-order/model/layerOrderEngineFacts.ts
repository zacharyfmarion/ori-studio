/**
 * What the inspector model reads from the engine, and the one module where it
 * meets the engine's types (`implementation-plans/layer-order-dialog.md`, U9).
 *
 * The model is typed against E7's wire (`engine/layerOrderWire.ts`), not the
 * worker contract (`engine/layerOrderEngine.ts`), which U6 is aligning to the
 * wire now. Everything the model takes from either comes through here: the
 * shapes it re-exports, the helpers it calls, and a converter per answer from
 * the wire's shape to the model's. When U6 settles the contract's names, this
 * file is the one that changes.
 *
 * The converters drop what the model never reads (search stages, node counts,
 * proofs) and turn the small typed arrays (a clash's constraint indices and
 * faces) into plain arrays. Stacks and open pairs stay typed: they are large
 * and the panes read them as they are.
 *
 * Pure: no React, no store, no engine calls.
 */
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerFace } from '../engine/faceIndex';
import {
  LAYER_ORDER_LIMITS,
  constraintSeen,
  constraintVerb,
  keepTrying,
  layerPositionEnds,
  NO_PROVED_ENDS,
  unpackConstraints,
  withProvedEnd,
  type LayerConstraint,
  type LayerOrderLimits,
  type LayerProvedEnds,
  type LayerVerb,
} from '../engine/layerOrderEngine';
import {
  SAVED_FACE_AMBIGUOUS,
  SAVED_FACE_GONE,
  type LayerChangedSpots,
  type LayerCommitted,
  type LayerExplained,
  type LayerOpened,
  type LayerOpenedOn,
  type LayerOrderBits,
  type LayerPosition,
  type LayerPreviewed,
  type LayerRefusal,
  type LayerRestored,
  type LayerRestoreOutcomeKind,
  type LayerSavedConstraintStatus,
  type LayerShown,
  type LayerSide,
  type LayerSolutionCount,
  type LayerStacks,
  type LayerStepBy,
  type LayerStepped,
  type LayerTally,
} from '../engine/layerOrderWire';

export type {
  LayerChangedSpots,
  LayerConstraint,
  LayerFace,
  LayerOpenedOn,
  LayerOrderBits,
  LayerOrderLimits,
  LayerPosition,
  LayerProvedEnds,
  LayerRefusal,
  LayerRestoreOutcomeKind,
  LayerSavedConstraintStatus,
  LayerSide,
  LayerSolutionCount,
  LayerStacks,
  LayerStepBy,
  LayerTally,
  LayerVerb,
};
/**
 * The limits each call the model asks for runs with: the contract's, one per
 * call (`LAYER_ORDER_LIMITS`: explain's 10 s among them). A count slice is not
 * here: it is phase gate 2's `LAYER_ORDER_COUNT_SLICE`
 * (`layer-order/layerOrderBudgets.ts`), its one source. The stepper's ends
 * are every pager's (`layerPositionEnds`), the hosts' too.
 */
export {
  LAYER_ORDER_LIMITS,
  NO_PROVED_ENDS,
  constraintSeen,
  constraintVerb,
  keepTrying,
  layerPositionEnds,
  withProvedEnd,
};

// ---------------------------------------------------------------------------
// The model's shapes

export interface LayerSidesStacks {
  readonly front: LayerStacks;
  readonly back: LayerStacks;
}

/** Where a saved face's point lies now: in a face of its own area, in a split or merged one, or on no face. */
export type LayerSavedFaceState = 'intact' | 'ambiguous' | 'gone';

/** A saved constraint a restore did not apply: a row the dialog shows by its status, and writes back unless removed. */
export interface LayerCarriedFacts {
  /** Its index among the record's constraints: what the engine's carried-row calls take. */
  readonly index: number;
  readonly status: LayerSavedConstraintStatus;
  /** The face each saved point lies in now; null when it lies in none, which has no letter. */
  readonly subject: LayerFace | null;
  readonly object: LayerFace | null;
  readonly subjectState: LayerSavedFaceState;
  readonly objectState: LayerSavedFaceState;
  /** FOLD's sign, as saved: paper-relative. */
  readonly sign: 1 | -1;
  /** The constraint on today's faces when both are intact and overlap; null otherwise. */
  readonly constraint: LayerConstraint | null;
}

export interface LayerRestoreFacts {
  readonly outcome: LayerRestoreOutcomeKind;
  readonly carried: readonly LayerCarriedFacts[];
}

/** A session opened, with the order on screen's stacks, which the hook reads before it reports the open. */
export interface LayerOpenFacts {
  readonly faces: number;
  /** Per face, 1 when it shows its front from the front side. */
  readonly frontUp: Uint8Array;
  /** `[lo, hi, …]`: the pairs deduction leaves open. */
  readonly openPairs: Uint32Array;
  readonly openedOn: LayerOpenedOn;
  readonly stacks: LayerSidesStacks;
  /** The order on screen, packed (`layer_order`): what undo puts back exactly. */
  readonly order: LayerOrderBits;
  /** The constraints committed: a restore's applied ones; none for an open. */
  readonly constraints: readonly LayerConstraint[];
  /** Set for a restore: how it went, and the rows it did not apply. */
  readonly restore: LayerRestoreFacts | null;
  /**
   * The faces in letter order, A first: what a sentence's and a row's objects
   * are sorted by (D21). The hook reads it from the paper scene it draws,
   * `faceLettersOf(scene).inLetterOrder` (`engine/faceIndex.ts`), at every
   * open and restore.
   */
  readonly letterOrder: readonly LayerFace[];
}

/** A proof that no order fits: `constraints` index the list checked (the committed list, then the sentence's candidates). */
export interface LayerCantFitFacts {
  readonly verdict: 'cant_fit';
  readonly constraints: readonly number[];
}

export interface LayerTimedOutFacts {
  readonly verdict: 'timed_out';
}

export type LayerPreviewFacts =
  | {
      readonly verdict: 'fits';
      readonly token: number;
      readonly changed: LayerChangedSpots;
      readonly stacks: LayerSidesStacks;
    }
  | LayerCantFitFacts
  | LayerTimedOutFacts;

/**
 * A commit's answer, or an exact restore's (`show`) as one: the order it
 * landed on, packed, is what an undo from there puts back.
 */
export type LayerCommitFacts =
  | {
      readonly verdict: 'committed';
      readonly changed: LayerChangedSpots;
      readonly stacks: LayerSidesStacks;
      readonly openPairs: Uint32Array;
      readonly order: LayerOrderBits;
    }
  | LayerCantFitFacts
  | LayerTimedOutFacts;

export type LayerExplainFacts =
  | { readonly verdict: 'fits' }
  | {
      readonly verdict: 'clash';
      /** Indices into the list explained, ascending. */
      readonly constraints: readonly number[];
      /** The faces those constraints name: the danger tints. */
      readonly faces: readonly LayerFace[];
      readonly minimal: boolean;
    }
  | LayerTimedOutFacts;

export type LayerStepFacts =
  | {
      readonly verdict: 'moved';
      readonly changed: LayerChangedSpots;
      readonly position: LayerPosition;
      readonly stacks: LayerSidesStacks;
      readonly order: LayerOrderBits;
    }
  | { readonly verdict: 'end' }
  | LayerTimedOutFacts;

// ---------------------------------------------------------------------------
// From the wire

function savedFaceState(status: number | undefined): LayerSavedFaceState {
  if (status === SAVED_FACE_GONE || status === undefined) return 'gone';
  return status === SAVED_FACE_AMBIGUOUS ? 'ambiguous' : 'intact';
}

/**
 * An open or a restore as either side of the worker answers it: the bridge's
 * (a session handle, constraints packed in threes) or the engine contract's
 * (`LayerOrderOpened`, `LayerOrderRestored`: no handle, constraints as
 * tuples), which is what the dialog's hook holds.
 */
export type LayerOpenAnswer =
  | Omit<LayerOpened, 'session'>
  | (Omit<LayerRestored, 'session' | 'constraints'> & {
      readonly constraints: LayerRestored['constraints'] | readonly LayerConstraint[];
    });

/**
 * The facts of an open (`layer_open`, `layer_open_showing`) or a restore,
 * with the stacks, the letters (`faceLettersOf(scene).inLetterOrder`) and the
 * order on screen packed (`layer_order`) the hook read after it.
 */
export function openFacts(
  opened: LayerOpenAnswer,
  stacks: LayerSidesStacks,
  record: LayerOrderRecord | null,
  letterOrder: readonly LayerFace[],
  order: LayerOrderBits
): LayerOpenFacts {
  const restored = 'carried' in opened ? opened : null;
  return {
    faces: opened.faces,
    frontUp: opened.front_up,
    openPairs: opened.open_pairs,
    openedOn: opened.opened_on,
    stacks,
    order,
    constraints: restored ? restoredConstraints(restored.constraints) : [],
    restore: restored ? restoreFacts(restored, record) : null,
    letterOrder,
  };
}

/** A restore's committed constraints, packed (the bridge's) or as tuples (the contract's). */
function restoredConstraints(constraints: LayerRestored['constraints'] | readonly LayerConstraint[]): LayerConstraint[] {
  // Not `instanceof`: an array that crossed a worker may be of another realm's Int32Array.
  return ArrayBuffer.isView(constraints) ? unpackConstraints(constraints) : [...constraints];
}

function restoreFacts(
  restored: Pick<LayerRestored, 'saved_faces' | 'outcome' | 'carried'>,
  record: LayerOrderRecord | null
): LayerRestoreFacts {
  const faceNow = (savedFace: number | undefined): { face: LayerFace | null; state: LayerSavedFaceState } => {
    if (savedFace === undefined) return { face: null, state: 'gone' };
    const state = savedFaceState(restored.saved_faces.status[savedFace]);
    const face = restored.saved_faces.face[savedFace];
    return { face: state === 'gone' || face === undefined || face < 0 ? null : face, state };
  };
  return {
    outcome: restored.outcome,
    carried: restored.carried.map((row) => {
      const saved = record?.constraints[row.index];
      const subject = faceNow(saved?.[0]);
      const object = faceNow(saved?.[1]);
      const { index, sign, constraint } = row;
      const status: LayerSavedConstraintStatus =
        row.status === 'gone' ? { status: 'gone', cause: row.cause } : { status: row.status };
      return {
        index,
        status,
        subject: subject.face,
        object: object.face,
        subjectState: subject.state,
        objectState: object.state,
        sign,
        constraint,
      };
    }),
  };
}

export function previewFacts(previewed: LayerPreviewed): LayerPreviewFacts {
  switch (previewed.verdict) {
    case 'fits':
      return {
        verdict: 'fits',
        token: previewed.token,
        changed: previewed.changed,
        stacks: previewed.stacks,
      };
    case 'cant_fit':
      return { verdict: 'cant_fit', constraints: Array.from(previewed.constraints) };
    case 'timed_out':
      return { verdict: 'timed_out' };
  }
}

/** A commit's answer; `order` is the order on screen the hook read after it landed (`layer_order`), unread otherwise. */
export function commitFacts(committed: LayerCommitted, order: LayerOrderBits): LayerCommitFacts {
  switch (committed.verdict) {
    case 'committed':
      return {
        verdict: 'committed',
        changed: committed.changed,
        stacks: committed.stacks,
        openPairs: committed.open_pairs,
        order,
      };
    case 'cant_fit':
      return { verdict: 'cant_fit', constraints: Array.from(committed.constraints) };
    case 'timed_out':
      return { verdict: 'timed_out' };
  }
}

/** An exact restore that landed (`show`), as the commit it is: `order` is the one it put back. */
export function shownFacts(shown: Extract<LayerShown, { verdict: 'shown' }>, order: LayerOrderBits): LayerCommitFacts {
  return { verdict: 'committed', changed: shown.changed, stacks: shown.stacks, openPairs: shown.open_pairs, order };
}

export function explainFacts(explained: LayerExplained): LayerExplainFacts {
  switch (explained.verdict) {
    case 'fits':
      return { verdict: 'fits' };
    case 'clash':
      return {
        verdict: 'clash',
        constraints: Array.from(explained.constraints),
        faces: Array.from(explained.faces),
        minimal: explained.minimal,
      };
    case 'timed_out':
      return { verdict: 'timed_out' };
  }
}

/** A step's answer; `order` is the order on screen the hook read after it moved (`layer_order`), unread otherwise. */
export function stepFacts(stepped: LayerStepped, order: LayerOrderBits): LayerStepFacts {
  switch (stepped.verdict) {
    case 'moved':
      return { verdict: 'moved', changed: stepped.changed, position: stepped.position, stacks: stepped.stacks, order };
    case 'end':
      return { verdict: 'end' };
    case 'timed_out':
      return { verdict: 'timed_out' };
  }
}
