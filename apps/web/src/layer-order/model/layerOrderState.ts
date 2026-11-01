/**
 * The Layer order dialog's inspector state, the actions that change it and
 * the effects it asks its hook to run (`implementation-plans/layer-order-dialog.md`,
 * U9; the reducer is `layerOrderReducer.ts`).
 *
 * **Effects are data.** The reducer never calls the engine, a timer or the
 * analytics layer: each step returns the effects to run, and the hook
 * (`useLayerOrderDialog`, U10) runs them and dispatches what they answer.
 * Every call that answers carries the `request` it was asked with; an answer
 * for a request the state no longer waits on is dropped, which is how a
 * superseded preview, a commit after Cancel or a stale count goes nowhere.
 *
 * Pure: no React, no store, no engine calls.
 */
import type { LayerOrderOutcome, LayerOrderFact, LayerOrderSurface } from './layerOrderAnalytics';
import type { LayerOrderBaseline } from './layerOrderDecisions';
import type {
  LayerCarriedFacts,
  LayerChangedSpots,
  LayerCommitFacts,
  LayerConstraint,
  LayerExplainFacts,
  LayerFace,
  LayerOpenedOn,
  LayerOpenFacts,
  LayerOrderBits,
  LayerOrderLimits,
  LayerPosition,
  LayerPreviewFacts,
  LayerProvedEnds,
  LayerRefusal,
  LayerSide,
  LayerSidesStacks,
  LayerSolutionCount,
  LayerStepBy,
  LayerStepFacts,
  LayerVerb,
} from './layerOrderEngineFacts';
import type { LayerHistory, LayerHistoryMove } from './layerOrderHistory';
import type { LayerRowKey } from './layerOrderRowGroups';
import type { LayerLetterRanks, LayerOpenIndex, LayerPickOrigin, LayerSentence, LayerSlot } from './layerOrderSentence';

// ---------------------------------------------------------------------------
// Rows

/** A constraint the session holds, as built. */
export interface LayerCommittedRow {
  readonly kind: 'committed';
  readonly id: number;
  /** `[subject, object, sign]`: the row reads subject first, its verb from the side shown. */
  readonly constraint: LayerConstraint;
}

/** A saved constraint a restore did not apply (E5's carried rows): shown by its status, written back unless removed. */
export interface LayerCarriedRow {
  readonly kind: 'carried';
  readonly id: number;
  readonly facts: LayerCarriedFacts;
}

export type LayerRow = LayerCommittedRow | LayerCarriedRow;

/** The constraints list: the committed rows, then the carried ones, as `layer_save` writes them. */
export interface LayerRows {
  readonly committed: readonly LayerCommittedRow[];
  readonly carried: readonly LayerCarriedRow[];
}

// ---------------------------------------------------------------------------
// The figure and the phase

export interface LayerFigure {
  readonly faces: number;
  /** Per face, 1 when it shows its front from the front side. */
  readonly frontUp: Uint8Array;
  /** Per face, 1 when it shares a spot with another face: "everything it overlaps is settled" or "it overlaps no other face". */
  readonly overlapping: Uint8Array;
  /** Per face, its place in letter order: a sentence's and a row's objects read in it (D21). */
  readonly letterRank: LayerLetterRanks;
}

/** How the session opens: on the host's order, or by restoring its saved record. */
export type LayerOpenHow = 'showing' | 'restore';

export type LayerPhase =
  /** Working out the layer orders; Cancel stops it. */
  | { readonly kind: 'opening'; readonly request: number; readonly limits: LayerOrderLimits }
  | { readonly kind: 'open' }
  /** No session: the refusal says why, by code. `session_timed_out` offers Keep trying. */
  | { readonly kind: 'refused'; readonly refusal: LayerRefusal; readonly limits: LayerOrderLimits }
  /**
   * The engine went away (a rejected call): Try again reopens. `unavailable`
   * when the browser failed to load it (offline, say), not a crash.
   */
  | { readonly kind: 'failed'; readonly limits: LayerOrderLimits; readonly unavailable: boolean }
  | { readonly kind: 'closed'; readonly outcome: LayerOrderOutcome };

// ---------------------------------------------------------------------------
// The preview of a complete sentence

/**
 * The smallest clashing set, once explained: indices into the list checked,
 * the committed constraints first, then the sentence's candidates in their
 * order (so an index past the committed ones names one of the objects).
 */
export interface LayerClash {
  readonly constraints: readonly number[];
  readonly faces: readonly LayerFace[];
  readonly minimal: boolean;
}

/**
 * A can't-fit's explain: not asked yet (it is asked when the entry comes on
 * display, so a set the sentence has moved past costs nothing), running, or
 * done; or out of time, within the preview's short deadline so it never holds
 * the worker from the next preview or Apply. Then the check's own set stands
 * in, not claimed smallest, and Keep trying asks again with later `limits`.
 */
export type LayerExplainState =
  | { readonly kind: 'none' }
  | { readonly kind: 'pending'; readonly request: number; readonly limits: LayerOrderLimits }
  | ({ readonly kind: 'done' } & LayerClash)
  | ({ readonly kind: 'timed_out'; readonly limits: LayerOrderLimits } & LayerClash);

/**
 * One sentence's preview against the order on screen: the committed list plus
 * its `candidates`, one constraint per object in letter order, less any the
 * list holds already (D21). Each is kept until the order on screen changes.
 */
export type LayerPreviewEntry =
  /** The check is running: Add waits. */
  | {
      readonly kind: 'pending';
      readonly request: number;
      readonly candidates: readonly LayerConstraint[];
      readonly limits: LayerOrderLimits;
    }
  /**
   * The fitting order closest to the one on screen, and the spots that would
   * change. Its `token` adopts it with no search only while it is the
   * session's last preview ({@link LayerOrderDialogState.lastPreview}).
   */
  | {
      readonly kind: 'fits';
      readonly request: number;
      readonly candidates: readonly LayerConstraint[];
      readonly token: number;
      /** What it fit under: a later Add that has to search gets at least this. */
      readonly limits: LayerOrderLimits;
      readonly changed: LayerChangedSpots;
      readonly stacks: LayerSidesStacks;
    }
  /** No order fits: the check's set, refined by explain into the smallest clashing set. */
  | {
      readonly kind: 'cant_fit';
      readonly candidates: readonly LayerConstraint[];
      readonly constraints: readonly number[];
      readonly explain: LayerExplainState;
    }
  /** "Couldn't check in time" (D8): Keep trying runs it again, later. */
  | { readonly kind: 'timed_out'; readonly candidates: readonly LayerConstraint[]; readonly limits: LayerOrderLimits };

// ---------------------------------------------------------------------------
// Commits

/** What a commit is for. `settle` applies a restore's remaining rows together after a removal (D10). */
export type LayerCommitVia = 'add' | 'remove' | 'undo' | 'redo' | 'clear_all' | 'settle';

/** A commit asked for, and what lands with it. */
export interface LayerCommitAsk {
  readonly via: LayerCommitVia;
  /** The list sent: the committed rows' constraints once it lands. */
  readonly constraints: readonly LayerConstraint[];
  /** For Add: the preview's token, when it is the session's last preview, so it is adopted with no search; else null, a search. */
  readonly token: number | null;
  /**
   * For undo and redo: the order to put back exactly (`show`), no search;
   * null for a new change, which re-solves for the fitting order closest to
   * the one on screen.
   */
  readonly order: LayerOrderBits | null;
  readonly limits: LayerOrderLimits;
  /** The rows once it lands. */
  readonly rows: LayerRows;
  /** How the history moves once it lands, from the past's length when it was asked (`landed`). */
  readonly move: LayerHistoryMove<LayerUndoEntry>;
  readonly at: number;
  /**
   * The sentence on screen when it was asked: Add's own, which it clears, and
   * the one an undo or redo replaces with {@link restore}. Either only if it
   * is still on screen: an edit since is newer, and stays.
   */
  readonly sentence: LayerSentence;
  /** For undo and redo of a change to the list: the sentence and the restore's settling the entry brings back. */
  readonly restore: (LayerSentenceEntry & { readonly settle: LayerSettle }) | null;
  /** The row each constraint of the list came from, by id. */
  readonly listRows: readonly number[];
}

// ---------------------------------------------------------------------------
// The undo history (`layerOrderHistory.ts`)

/** The sentence an entry brings back, and the block `layer constraint blocked` had reported for it (see {@link LayerOrderDialogState.blocked}). */
export interface LayerSentenceEntry {
  readonly sentence: LayerSentence;
  readonly blocked: string | null;
}

/**
 * One undo step: every inspector action is one (plan, "The inspector's
 * behaviour"). In the past it is what undo goes back to; in the future, what
 * redo goes forward to, as it was when undone. View toggles (Front/Back,
 * X-ray, Undecided) and the pointer are no step: they change what is seen,
 * never what Apply writes.
 *
 * An entry that changed the order on screen holds the order on its side of
 * the change, packed (`order`), and undo and redo put that order back
 * exactly, with no search (#539's review: stepping back relatively stuck or
 * landed on another picture). It is null only when the engine never said.
 */
export type LayerUndoEntry =
  /** A sentence edit (a pick, a ×, the verb, Clear, a row click): the sentence on the other side of it. No engine call. */
  | ({ readonly kind: 'sentence' } & LayerSentenceEntry)
  /**
   * A change to the list (Add, a row's trash, Clear all, a saved row's
   * removal while the restore settles): the rows, the order on screen, the
   * restore's settling and the sentence on the other side of it.
   */
  | ({
      readonly kind: 'list';
      readonly rows: LayerRows;
      readonly order: LayerOrderBits | null;
      readonly settle: LayerSettle;
    } & LayerSentenceEntry)
  /** A solution step (‹ ›), which only moved the order on screen: the order on the other side of it. */
  | { readonly kind: 'step'; readonly order: LayerOrderBits | null };

export type LayerCommitState =
  | { readonly kind: 'idle' }
  | ({ readonly kind: 'pending'; readonly request: number } & LayerCommitAsk)
  /** It ran out; nothing changed. Keep trying sends it again, later. */
  | ({ readonly kind: 'timed_out' } & LayerCommitAsk);

// ---------------------------------------------------------------------------
// A restored record's rows (D10)

export type LayerSettle =
  /** Every row that can apply is applied: the builder and Apply work as usual. */
  | { readonly kind: 'settled' }
  /**
   * The rows that can apply clash: none is committed, the builder is inert and
   * Apply waits until one is removed. `explain` refines the set after a re-check.
   */
  | {
      readonly kind: 'clash';
      /** The clashing rows, by id. */
      readonly rows: readonly number[];
      readonly explain: { readonly request: number; readonly listRows: readonly number[] } | null;
    }
  /** The restore ran out of time: none is committed. Keep trying restores again, later. */
  | { readonly kind: 'timed_out'; readonly limits: LayerOrderLimits }
  | { readonly kind: 'restoring'; readonly request: number; readonly limits: LayerOrderLimits };

// ---------------------------------------------------------------------------
// Solutions

export type LayerStepDirection = 'next' | 'previous';

export type LayerStepState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'pending';
      readonly request: number;
      readonly direction: LayerStepDirection;
      readonly by: LayerStepBy;
      readonly limits: LayerOrderLimits;
      /** How the history moves once it moves the order: an entry holding the order before (an undo or redo of it is an exact `show`). */
      readonly move: LayerHistoryMove<LayerUndoEntry>;
      readonly at: number;
    }
  /** No solution lies that way: proved (E9), whatever the count says, and kept in {@link LayerSolutionsState.ended}. */
  | { readonly kind: 'end'; readonly direction: LayerStepDirection }
  /**
   * The search for the next solution that way ran out (E9): nothing moved.
   * Keep trying steps that way again, with later limits than `limits`.
   */
  | { readonly kind: 'timed_out'; readonly direction: LayerStepDirection; readonly limits: LayerOrderLimits };

export interface LayerSolutionsState {
  /** Whether the background count runs (D7), by the open pairs at the open and after each commit; the stepper steps either way. */
  readonly runs: boolean;
  /** Bumped by every open and commit: a count or a position for another generation is dropped. */
  readonly generation: number;
  readonly count: LayerSolutionCount | null;
  /** Where the order on screen lies in the stepper's order, for {@link positionBy}. */
  readonly position: LayerPosition | null;
  readonly positionBy: string | null;
  readonly step: LayerStepState;
  /**
   * The ways a step proved nothing lies from the order on screen (E9), both
   * kept: a › that runs out or ends after a ‹ that ended leaves ‹ waiting.
   * Let go when the order moves or the generation or what it steps by
   * changes; never by a read of its position, whose index moves with the
   * count until the total is exact.
   */
  readonly ended: LayerProvedEnds;
}

// ---------------------------------------------------------------------------
// What the pointer is on, and the view

export interface LayerHover {
  /** The face under the pointer on either pane (on the folded pane, the face on top there). */
  readonly face: LayerFace | null;
  /** A builder slot under the pointer: its face wins over the panes. */
  readonly slot: LayerSlot | null;
  /** A row of the list under the pointer, pressed or focused (D6), by its key: it stays on the row as its constraints go. */
  readonly row: LayerRowKey | null;
  /** Pointing at the can't-fit reason strengthens the clash's tints. */
  readonly reason: boolean;
}

export interface LayerView {
  /** Front/Back is a lens: constraints are paper-relative, and Apply never turns the host over. */
  readonly side: LayerSide;
  readonly xray: boolean;
  readonly openSpots: boolean;
  /**
   * How far the folded pane turns the paper, in degrees in [0, 360), in the
   * host's terms (`LayerOrderLook.turnDeg`): clockwise on screen from the
   * host's side ({@link LayerHostTurn.side}), the other way round from the
   * other side (`paneTurnDeg`). It opens at the host's turn; Rotate Left and
   * Right move it, and Apply hands it back when it moved.
   */
  readonly turnDeg: number;
}

/** The turn the host opened the dialog at, and the side it is read from (`look.turnDeg`, `look.side`). */
export interface LayerHostTurn {
  readonly side: LayerSide;
  readonly deg: number;
}

/** Which way a press of Rotate turns the folded pane, as seen: Left anticlockwise, Right clockwise. */
export type LayerTurnDirection = 'left' | 'right';

/** How far one press of Rotate Left or Right turns the folded pane, as the Diagram's Pose controls do. */
export const LAYER_TURN_STEP_DEG = 15;

/** The changed spots' one fade, after a commit or a step. `n` tells one flash from the next. */
export interface LayerFlash {
  readonly changed: LayerChangedSpots;
  readonly n: number;
}

// ---------------------------------------------------------------------------
// The state

export interface LayerOrderDialogState {
  /** Which host asked, when it says: the analytics' `surface`. */
  readonly surface: LayerOrderSurface | null;
  readonly how: LayerOpenHow;
  /** Opened from the host's "Review…" (D14). */
  readonly review: boolean;
  /** Whether the record came flagged by its host, so even an untouched Apply writes (D16). */
  readonly recordNeedsAttention: boolean;
  /** When the dialog opened, by the hook's clock, for `elapsed_ms_bucket`. */
  readonly openedAt: number;
  readonly reportedOpen: boolean;
  readonly nextRequest: number;
  readonly nextRowId: number;
  readonly flashes: number;

  readonly phase: LayerPhase;
  readonly figure: LayerFigure | null;
  readonly openedOn: LayerOpenedOn | null;
  /** The limits the session last opened or restored with: what Try again opens with after a loss. */
  readonly openedLimits: LayerOrderLimits | null;
  readonly open: LayerOpenIndex;
  /** The order on screen's stacks, top first, per side. */
  readonly shown: LayerSidesStacks | null;
  /** The order on screen, packed, as the engine last said it: what an undo entry holds. */
  readonly shownOrder: LayerOrderBits | null;

  readonly rows: LayerRows;
  readonly history: LayerHistory<LayerUndoEntry>;
  readonly commit: LayerCommitState;
  readonly settle: LayerSettle;
  /** The rows "Review…" opened on (D14). */
  readonly reviewRows: readonly number[] | null;

  readonly sentence: LayerSentence;
  /** The verb under the pointer or focus in the open verb menu: previewed in place of the sentence's (Round3:457, 893). */
  readonly pointedVerb: LayerVerb | null;
  /**
   * Each sentence's preview, by its candidates' key (`candidatesKey`): emptied when the list changes
   * (a commit) or the session opens again; a step keeps the can't-fits, which no order on screen
   * changes, and drops the fits.
   */
  readonly previews: Readonly<Record<string, LayerPreviewEntry>>;
  /**
   * The request of the preview the session holds: the last one asked, until
   * a commit, a step that moves or an open drops it. Only its token adopts
   * with no search.
   */
  readonly lastPreview: number | null;
  /**
   * The sentence `layer constraint blocked` last went out for, by its subject
   * and its verb as read from the front (D21): once per sentence, until the
   * subject or that verb changes, an Add, or a Clear. A commit and a step
   * leave it, so a sentence blocked again after one is not counted again; an
   * undo or redo never reports one: it keeps this while the sentence it
   * brings back has the same subject and verb, and otherwise brings back the
   * one that sentence had.
   */
  readonly blocked: string | null;

  readonly solutions: LayerSolutionsState;
  readonly hover: LayerHover;
  readonly view: LayerView;
  /** The host's turn: what the view's turn opened at, and what Apply compares it with. */
  readonly hostTurn: LayerHostTurn;
  readonly flash: LayerFlash | null;
  /** What the dialog opened on, for an Apply that changed nothing (D16). */
  readonly baseline: LayerOrderBaseline | null;
}

// ---------------------------------------------------------------------------
// Effects

/** What Apply hands the hook: nothing to write (D16), or the session's order with these rows. */
export type LayerOrderApplyResult =
  | { readonly kind: 'no_change' }
  | {
      readonly kind: 'changed';
      /** The committed constraints, as built: what the session saves first. */
      readonly constraints: readonly LayerConstraint[];
      /**
       * The carried rows to write back, by record index: the save's `keep`
       * (`layer_save`), which leaves the session's carried rows as they are,
       * so a save the host refuses has removed nothing an undo would want
       * back. Then the hook reads the order on screen
       * (`layer_oriedita_relations`) for the host.
       */
      readonly keepCarried: readonly number[];
    };

export type LayerOrderEffect =
  /**
   * Open the session: on the host's order (`layer_open_showing`), or by
   * restoring the record (`layer_restore`, or `layer_restore_record` on a
   * session already open). Then read both sides' stacks and a paper scene's
   * letters (`faceLettersOf(scene).inLetterOrder`, `engine/faceIndex.ts`), and
   * answer `opened` (`openFacts(…, letterOrder)`) or `open_refused`.
   */
  | { readonly type: 'open'; readonly request: number; readonly how: LayerOpenHow; readonly limits: LayerOrderLimits }
  /**
   * Check `constraints` (`layer_preview_list`): the committed list, then the
   * sentence's candidates, one per object (D21). Answer `previewed`; a fit's
   * token adopts exactly this list (`commit` with the token).
   */
  | {
      readonly type: 'preview';
      readonly request: number;
      readonly constraints: readonly LayerConstraint[];
      readonly limits: LayerOrderLimits;
    }
  /**
   * Find the smallest clashing set of `constraints` (`layer_explain_list`): a
   * preview's list, or a restore's rows after a removal. Answer `explained`.
   */
  | {
      readonly type: 'explain';
      readonly request: number;
      readonly constraints: readonly LayerConstraint[];
      readonly limits: LayerOrderLimits;
    }
  /**
   * Make `constraints` the committed list (`layer_commit`, or
   * `layer_commit_preview` with a token), and read the order it landed on
   * (`layer_order`): answer `committed`. With an `order` (undo, redo), put
   * that order back exactly instead (`layer_show`), or, should that be
   * refused, commit the list as a commit does.
   */
  | {
      readonly type: 'commit';
      readonly request: number;
      readonly constraints: readonly LayerConstraint[];
      readonly token: number | null;
      readonly order: LayerOrderBits | null;
      readonly limits: LayerOrderLimits;
    }
  /**
   * Close any solutions cursor and start one for the committed list; read its
   * position by `by`, and with `count`, one slice of the count first. Answer
   * `solutions_counted`.
   */
  | { readonly type: 'solutions_restart'; readonly generation: number; readonly by: LayerStepBy; readonly count: boolean }
  /** One more slice of the count, then the position by `by`: answer `solutions_counted`. */
  | { readonly type: 'solutions_slice'; readonly generation: number; readonly by: LayerStepBy; readonly limits: LayerOrderLimits }
  /** The position by `by` (the side or X-ray changed): answer `solutions_positioned`. */
  | { readonly type: 'solutions_position'; readonly generation: number; readonly by: LayerStepBy }
  /** Show the next or previous solution (`layer_step`): answer `stepped`. */
  | {
      readonly type: 'step';
      readonly request: number;
      readonly generation: number;
      readonly by: LayerStepBy;
      readonly direction: LayerStepDirection;
      readonly limits: LayerOrderLimits;
    }
  /** Fade the changed spots once; answer `flash_ended` with `n` when the fade is over. */
  | { readonly type: 'flash'; readonly n: number }
  /**
   * Apply: hand the host its result (or nothing to write), then close.
   * `turnDeg` is the folded pane's turn in the host's terms when Rotate moved
   * it from the host's, else null: the host turns its picture to it.
   */
  | { readonly type: 'apply'; readonly result: LayerOrderApplyResult; readonly turnDeg: number | null }
  /** Cancel: close and leave the host untouched. */
  | { readonly type: 'close' }
  | { readonly type: 'track'; readonly fact: LayerOrderFact };

export interface LayerOrderStep {
  readonly state: LayerOrderDialogState;
  readonly effects: readonly LayerOrderEffect[];
}

// ---------------------------------------------------------------------------
// Actions

export type LayerOrderAction =
  // The engine's answers, each with the request it answers.
  | { readonly type: 'opened'; readonly request: number; readonly facts: LayerOpenFacts }
  | { readonly type: 'open_refused'; readonly request: number; readonly refusal: LayerRefusal }
  | { readonly type: 'previewed'; readonly request: number; readonly facts: LayerPreviewFacts }
  | { readonly type: 'explained'; readonly request: number; readonly facts: LayerExplainFacts }
  | { readonly type: 'committed'; readonly request: number; readonly facts: LayerCommitFacts }
  | {
      readonly type: 'solutions_counted';
      readonly generation: number;
      readonly by: LayerStepBy;
      /** Null when the count does not run (D7): a cursor for the stepper only. */
      readonly count: LayerSolutionCount | null;
      readonly position: LayerPosition;
    }
  | { readonly type: 'solutions_positioned'; readonly generation: number; readonly by: LayerStepBy; readonly position: LayerPosition }
  | { readonly type: 'stepped'; readonly request: number; readonly facts: LayerStepFacts }
  /**
   * A call rejected: the engine is gone, and so is its session; `unavailable`
   * when the browser failed to load it (`isLayerOrderLoadFailure`).
   */
  | { readonly type: 'engine_lost'; readonly unavailable?: boolean }
  // The panes.
  | { readonly type: 'face_hovered'; readonly face: LayerFace | null }
  | { readonly type: 'face_picked'; readonly face: LayerFace; readonly origin: LayerPickOrigin }
  | { readonly type: 'ground_clicked' }
  // The builder.
  | { readonly type: 'slot_activated'; readonly slot: LayerSlot }
  /** A slot's ×: the object slot's clears every object. */
  | { readonly type: 'slot_cleared'; readonly slot: LayerSlot }
  /** An object chip's ×: that one object goes, whichever slot is active; the subject stays (D21). */
  | { readonly type: 'object_removed'; readonly face: LayerFace }
  | { readonly type: 'slot_hovered'; readonly slot: LayerSlot | null }
  | { readonly type: 'sentence_cleared' }
  | { readonly type: 'verb_pointed'; readonly verb: LayerVerb | null }
  | { readonly type: 'verb_set'; readonly verb: LayerVerb }
  | { readonly type: 'reason_hovered'; readonly on: boolean }
  | { readonly type: 'add' }
  /** The hint line's Keep trying, or a refusal's: whatever ran out runs again, later. */
  | { readonly type: 'keep_trying' }
  // The constraints list, by row key.
  | { readonly type: 'row_hovered'; readonly key: LayerRowKey | null }
  | { readonly type: 'row_clicked'; readonly key: LayerRowKey }
  /**
   * A row's trash, the one way to remove constraints: every constraint the
   * row shows goes, as one undo step. A row has no per-object remove (D21,
   * your words after trying it, 2026-10-26).
   */
  | { readonly type: 'row_removed'; readonly key: LayerRowKey }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'clear_all' }
  // The view and the stepper.
  | { readonly type: 'side_set'; readonly side: LayerSide }
  | { readonly type: 'xray_set'; readonly on: boolean }
  | { readonly type: 'open_spots_set'; readonly on: boolean }
  /** Rotate Left or Right on the folded pane: a view action, on no undo history. */
  | { readonly type: 'turned'; readonly direction: LayerTurnDirection }
  | { readonly type: 'step'; readonly direction: LayerStepDirection }
  | { readonly type: 'flash_ended'; readonly n: number }
  /** The failed state's Try again. */
  | { readonly type: 'retry_open' }
  // The footer, with the hook's clock.
  | { readonly type: 'apply'; readonly at: number }
  | { readonly type: 'cancel'; readonly at: number };

/** What the host's opening request decides, and the hook's clock. */
export interface LayerOrderDialogInit {
  /** Which host asked (`LayerOrderRequest.surface`), or null when it doesn't say: sent as the opened event's `surface`. */
  readonly surface: LayerOrderSurface | null;
  /** Whether the host hands a saved record: the session restores it, else opens on the host's order. */
  readonly hasRecord: boolean;
  /** Whether the record came with `attention` set: `recordNeedsAttentionOf(request.record)`, as the dialog shell asks it. */
  readonly recordNeedsAttention: boolean;
  /** Opened from the host's "Review…" action (D14). */
  readonly review: boolean;
  /** The host's `look.xray`: X-ray on for an Edit figure in Transparent3. */
  readonly xray: boolean;
  /** The side the host's picture shows (`look.side`): the folded pane opens on it. The front when left out. */
  readonly side?: LayerSide;
  /** How far the host turns its picture from that side (`look.turnDeg`). None when left out. */
  readonly turnDeg?: number;
  readonly at: number;
}
