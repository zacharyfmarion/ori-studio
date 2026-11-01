/**
 * The Layer order dialog's inspector reducer (`implementation-plans/layer-order-dialog.md`,
 * U9): every action in, the next state and the effects for the hook to run
 * out. The state, actions and effects are in `layerOrderState.ts`; what the
 * panes and the inspector draw from it is in `layerOrderSelectors.ts`.
 *
 * The rules follow the approved artboard (Round3), cited by its function:
 * the builder's in `layerOrderSentence.ts`; here `add`, `commit`, `undo`,
 * `redo`, `removeCons`, `clearAll` and `stepLook`. Every change to the list
 * re-solves for the fitting order closest to the one on screen and flashes
 * the spots that changed (Round3 `commit`); the engine does the solving, so
 * here a change is a `commit` effect, and it lands when its answer does.
 *
 * A sentence may name several objects (D21). It is previewed and explained
 * as one list, the committed constraints plus one per object, and Add
 * commits that list as one undo step; a one-object sentence is the same
 * check it always was.
 *
 * **Every action is one undo step** (plan, "The inspector's behaviour";
 * `LayerUndoEntry`): each edit to the sentence, Add, a row's trash, Clear all
 * and a solution step. Undo of a sentence edit brings the sentence back with
 * no engine call; undo of a change to the list commits the earlier list, as
 * Round3 `undo` does, and brings back the sentence that was on screen before
 * it; undo of a step steps back. View toggles are no step.
 *
 * Pure: no React, no store, no engine calls.
 */
import { LAYER_ORDER_COUNT_SLICE } from '../layerOrderBudgets';
import {
  constraintAddedFact,
  constraintBlockedFact,
  dialogClosedFact,
  dialogOpenedFact,
  solutionsBucket,
  type LayerOrderClosedOutcome,
  type LayerOrderFact,
  type LayerOrderRefusalCode,
} from './layerOrderAnalytics';
import {
  ADD_AFTER_PREVIEW_TIMEOUT,
  applyChangedNothing,
  keepTryingLimits,
  openedBaseline,
  reviewRowsFor,
  solutionCountRuns,
  stepByFor,
} from './layerOrderDecisions';
import {
  LAYER_ORDER_LIMITS,
  NO_PROVED_ENDS,
  withProvedEnd,
  type LayerChangedSpots,
  type LayerCommitFacts,
  type LayerConstraint,
  type LayerExplainFacts,
  type LayerFace,
  type LayerOpenFacts,
  type LayerOrderBits,
  type LayerOrderLimits,
  type LayerPosition,
  type LayerPreviewFacts,
  type LayerStacks,
  type LayerStepBy,
  type LayerVerb,
} from './layerOrderEngineFacts';
import {
  emptyHistory,
  landed,
  recorded,
  redoTarget,
  undoTarget,
  type LayerHistoryMove,
} from './layerOrderHistory';
import { rowGroupByKey, rowGroupsOf, rowParts, withoutRow, type LayerRowKey } from './layerOrderRowGroups';
import {
  EMPTY_SENTENCE,
  activateSlot,
  candidatesKey,
  candidatesOf,
  clearSentence,
  clearSlot,
  constraintKey,
  groundClick,
  keepOpenObjects,
  objectOriginOf,
  openIndexOf,
  openPairCount,
  pickFace,
  removeObject,
  revealSubject,
  setVerb,
  type LayerSentence,
} from './layerOrderSentence';
import {
  LAYER_TURN_STEP_DEG,
  type LayerCarriedRow,
  type LayerClash,
  type LayerExplainState,
  type LayerCommitAsk,
  type LayerCommittedRow,
  type LayerOrderAction,
  type LayerOrderDialogInit,
  type LayerOrderDialogState,
  type LayerOrderEffect,
  type LayerOrderStep,
  type LayerPreviewEntry,
  type LayerRows,
  type LayerSentenceEntry,
  type LayerSettle,
  type LayerTurnDirection,
  type LayerUndoEntry,
} from './layerOrderState';

const NO_ROWS: LayerRows = { committed: [], carried: [] };

/**
 * What goes when the list or the order on screen changes (a commit lands, an
 * open): the previews, and the session's own (`lastPreview`). A step keeps
 * the can't-fits ({@link cantFitsOnly}).
 */
const NO_PREVIEWS = { previews: {}, lastPreview: null } satisfies Pick<LayerOrderDialogState, 'previews' | 'lastPreview'>;

/**
 * The previews a step leaves: a can't-fit, with its explain, is the list's and
 * the creases', whatever order is on screen; a fit carries the stacks it
 * would show, which a step has moved past, and goes.
 */
function cantFitsOnly(previews: LayerOrderDialogState['previews']): LayerOrderDialogState['previews'] {
  return Object.fromEntries(Object.entries(previews).filter(([, entry]) => entry.kind === 'cant_fit'));
}

function openLimits(how: LayerOrderDialogState['how']): LayerOrderLimits {
  return how === 'restore' ? LAYER_ORDER_LIMITS.restore : LAYER_ORDER_LIMITS.open;
}

/** The dialog as it opens: working, with one effect, the open. */
export function initLayerOrderDialog(init: LayerOrderDialogInit): LayerOrderStep {
  const how = init.hasRecord ? 'restore' : 'showing';
  const limits = openLimits(how);
  const state: LayerOrderDialogState = {
    surface: init.surface,
    how,
    review: init.review,
    recordNeedsAttention: init.recordNeedsAttention,
    openedAt: init.at,
    reportedOpen: false,
    nextRequest: 2,
    nextRowId: 1,
    flashes: 0,
    phase: { kind: 'opening', request: 1, limits },
    figure: null,
    openedOn: null,
    openedLimits: null,
    open: openIndexOf(new Uint32Array()),
    shown: null,
    shownOrder: null,
    rows: NO_ROWS,
    history: emptyHistory(),
    commit: { kind: 'idle' },
    settle: { kind: 'settled' },
    reviewRows: null,
    sentence: EMPTY_SENTENCE,
    pointedVerb: null,
    ...NO_PREVIEWS,
    blocked: null,
    solutions: freshSolutions(true, 0),
    hover: { face: null, slot: null, row: null, reason: false },
    view: { side: init.side ?? 'front', xray: init.xray, openSpots: false, turnDeg: wrapTurn(init.turnDeg ?? 0) },
    hostTurn: { side: init.side ?? 'front', deg: wrapTurn(init.turnDeg ?? 0) },
    flash: null,
    baseline: null,
  };
  return { state, effects: [{ type: 'open', request: 1, how, limits }] };
}

/** One action: the next state, and the effects to run. */
export function layerOrderReducer(state: LayerOrderDialogState, action: LayerOrderAction): LayerOrderStep {
  if (state.phase.kind === 'closed') return { state, effects: [] };
  const effects: LayerOrderEffect[] = [];
  const next = reduce(state, action, effects);
  return reconcile(next, effects);
}

// ---------------------------------------------------------------------------
// Small reads

/** The builder takes picks: the session is open and every saved row that can apply is applied. */
export function builderLive(state: LayerOrderDialogState): boolean {
  return state.phase.kind === 'open' && state.figure !== null && state.settle.kind === 'settled';
}

/** Neither a commit nor a step is in flight: the list and the order on screen can change. */
function quiet(state: LayerOrderDialogState): boolean {
  return state.commit.kind !== 'pending' && state.solutions.step.kind !== 'pending';
}

export function stepByKey(by: LayerStepBy): string {
  return typeof by === 'string' ? by : `picture:${by.picture}`;
}

export function currentStepBy(state: LayerOrderDialogState): LayerStepBy {
  return stepByFor(state.view.side, state.view.xray);
}

/** The committed list. */
export function committedConstraints(rows: LayerRows): LayerConstraint[] {
  return rows.committed.map((row) => row.constraint);
}

/**
 * What the sentence adds with `verb`, read from the side shown: one
 * constraint per object in letter order, less any the list already holds
 * (D21). Null unless the sentence is complete, or when it adds nothing.
 */
export function sentenceCandidates(
  state: LayerOrderDialogState,
  verb = state.sentence.verb
): readonly LayerConstraint[] | null {
  if (!state.figure) return null;
  const all = candidatesOf(state.sentence, state.open, verb, state.view.side, state.figure.frontUp);
  if (!all) return null;
  const held = new Set(state.rows.committed.map((row) => constraintKey(row.constraint)));
  const fresh = all.filter((candidate) => !held.has(constraintKey(candidate)));
  return fresh.length > 0 ? fresh : null;
}

/** The list a sentence's preview checks: the committed constraints, then its candidates. */
export function previewListOf(rows: LayerRows, candidates: readonly LayerConstraint[]): LayerConstraint[] {
  return [...committedConstraints(rows), ...candidates];
}

function previewOf(state: LayerOrderDialogState, verb: LayerVerb): LayerPreviewEntry | null {
  const candidates = sentenceCandidates(state, verb);
  return candidates ? (state.previews[candidatesKey(candidates)] ?? null) : null;
}

/** The sentence's preview as the folded pane shows it: with the menu's pointed verb when there is one. */
export function displayedPreview(state: LayerOrderDialogState): LayerPreviewEntry | null {
  return previewOf(state, state.pointedVerb ?? state.sentence.verb);
}

/** The preview Add stands on: the sentence's own verb. */
export function chosenPreview(state: LayerOrderDialogState): LayerPreviewEntry | null {
  return previewOf(state, state.sentence.verb);
}

/** Rows a restore can still apply: intact on today's faces, not yet committed (D10). */
function applicable(row: LayerCarriedRow): boolean {
  const { status } = row.facts.status;
  return row.facts.constraint !== null && (status === 'intact' || status === 'clashing');
}

function sameCommitted(a: readonly LayerCommittedRow[], b: readonly LayerCommittedRow[]): boolean {
  return a.length === b.length && a.every((row, i) => row.id === b[i]!.id);
}

function constraintFaces(constraints: readonly LayerConstraint[]): LayerFace[] {
  return Array.from(new Set(constraints.flatMap((c) => [c[0], c[1]])));
}

function hasChangedSpots(changed: LayerChangedSpots): boolean {
  return changed.front.length > 0 || changed.back.length > 0;
}

/** Each face's place in letter order, from the faces in that order; any face it leaves out goes last. */
function letterRanksOf(faces: number, letterOrder: readonly LayerFace[]): Uint32Array {
  const ranks = new Uint32Array(faces).fill(faces);
  letterOrder.forEach((face, rank) => {
    if (face >= 0 && face < faces) ranks[face] = rank;
  });
  return ranks;
}

function overlappingFaces(faces: number, stacks: LayerStacks): Uint8Array {
  const out = new Uint8Array(faces);
  for (let spot = 0; spot + 1 < stacks.offsets.length; spot += 1) {
    const from = stacks.offsets[spot]!;
    const to = stacks.offsets[spot + 1]!;
    if (to - from < 2) continue;
    for (let i = from; i < to; i += 1) out[stacks.faces[i]!] = 1;
  }
  return out;
}

function request(state: LayerOrderDialogState): [number, LayerOrderDialogState] {
  return [state.nextRequest, { ...state, nextRequest: state.nextRequest + 1 }];
}

// ---------------------------------------------------------------------------
// The reducer

function reduce(state: LayerOrderDialogState, action: LayerOrderAction, effects: LayerOrderEffect[]): LayerOrderDialogState {
  switch (action.type) {
    case 'opened':
      return opened(state, action.request, action.facts, effects);
    case 'open_refused': {
      const waiting =
        (state.phase.kind === 'opening' && state.phase.request === action.request) ||
        (state.settle.kind === 'restoring' && state.settle.request === action.request);
      if (!waiting) return state;
      // The limits that open ran with, so Keep trying goes further than they did.
      const limits =
        state.phase.kind === 'opening'
          ? state.phase.limits
          : state.settle.kind === 'restoring'
            ? state.settle.limits
            : LAYER_ORDER_LIMITS.restore;
      return { ...state, phase: { kind: 'refused', refusal: action.refusal, limits } };
    }
    case 'previewed':
      return previewed(state, action.request, action.facts);
    case 'explained':
      return explained(state, action.request, action.facts);
    case 'committed':
      return committed(state, action, effects);
    case 'solutions_counted': {
      const { solutions } = state;
      if (action.generation !== solutions.generation) return state;
      const count = action.count ?? solutions.count;
      if (solutions.runs && count && !count.done) {
        effects.push({
          type: 'solutions_slice',
          generation: solutions.generation,
          by: currentStepBy(state),
          limits: LAYER_ORDER_COUNT_SLICE,
        });
      }
      return { ...state, solutions: { ...positionedAt(solutions, action.position, action.by), count } };
    }
    case 'solutions_positioned':
      if (action.generation !== state.solutions.generation) return state;
      return { ...state, solutions: positionedAt(state.solutions, action.position, action.by) };
    case 'stepped':
      return stepped(state, action, effects);
    case 'engine_lost': {
      // Try again opens as the session last did (Keep trying's limits included), not the defaults.
      const limits = state.phase.kind === 'opening' ? state.phase.limits : (state.openedLimits ?? openLimits(state.how));
      return { ...state, phase: { kind: 'failed', limits, unavailable: action.unavailable === true } };
    }

    case 'face_hovered':
      return state.hover.face === action.face ? state : { ...state, hover: { ...state.hover, face: action.face } };
    case 'face_picked':
      if (!builderLive(state)) return state;
      return edited(
        state,
        withSentence(state, pickFace(state.sentence, state.open, action.face, action.origin, state.figure?.letterRank))
      );
    case 'ground_clicked':
      if (!builderLive(state)) return state;
      return edited(state, withSentence(state, groundClick(state.sentence)));
    case 'slot_activated':
      // Which slot the next pick fills is no edit: it changes no word of the sentence.
      if (!builderLive(state)) return state;
      return withSentence(state, activateSlot(state.sentence, state.open, action.slot));
    case 'slot_cleared':
      if (!builderLive(state)) return state;
      return edited(state, withSentence(state, clearSlot(state.sentence, action.slot)));
    case 'object_removed':
      if (!builderLive(state)) return state;
      return edited(state, withSentence(state, removeObject(state.sentence, action.face)));
    case 'slot_hovered':
      return state.hover.slot === action.slot ? state : { ...state, hover: { ...state.hover, slot: action.slot } };
    case 'sentence_cleared':
      if (!builderLive(state)) return state;
      // Clear starts afresh: a sentence built again is reported again if it is blocked.
      return { ...withoutStepRanOut(edited(state, withSentence(state, clearSentence(state.sentence)))), blocked: null };
    case 'verb_pointed':
      return state.pointedVerb === action.verb ? state : { ...state, pointedVerb: action.verb };
    case 'verb_set':
      if (!builderLive(state)) return state;
      // An edit like a pick: the line is the sentence's check now, a step's running out let go.
      return withoutStepRanOut(
        edited(state, { ...state, sentence: setVerb(state.sentence, action.verb), pointedVerb: null })
      );
    case 'reason_hovered':
      return state.hover.reason === action.on ? state : { ...state, hover: { ...state.hover, reason: action.on } };
    case 'add':
      return add(state, effects);
    case 'keep_trying':
      return keepTryingAgain(state, effects);

    case 'row_hovered':
      return state.hover.row === action.key ? state : { ...state, hover: { ...state.hover, row: action.key } };
    case 'row_clicked':
      return rowClicked(state, action.key);
    case 'row_removed':
      return rowRemoved(state, action.key, effects);
    case 'undo':
      return travel(state, 'undo', effects);
    case 'redo':
      return travel(state, 'redo', effects);
    case 'clear_all':
      return clearAll(state, effects);

    case 'side_set': {
      if (state.view.side === action.side) return state;
      // Round3 `setSide`: the flash and the hovered spot go; the sentence stays, and reads from the new side.
      const next: LayerOrderDialogState = {
        ...state,
        view: { ...state.view, side: action.side },
        flash: null,
        pointedVerb: null,
        hover: { ...state.hover, face: null },
      };
      return repositioned(state, next, effects);
    }
    case 'xray_set':
      if (state.view.xray === action.on) return state;
      return repositioned(state, { ...state, view: { ...state.view, xray: action.on } }, effects);
    case 'open_spots_set':
      return state.view.openSpots === action.on ? state : { ...state, view: { ...state.view, openSpots: action.on } };
    case 'turned':
      // A lens, as Side and X-ray are: nothing the engine answers changes, and nothing goes on the history.
      return { ...state, view: { ...state.view, turnDeg: turnedBy(state, action.direction) } };
    case 'step':
      return step(state, action.direction, effects);
    case 'flash_ended':
      return state.flash?.n === action.n ? { ...state, flash: null } : state;
    case 'retry_open': {
      if (state.phase.kind !== 'failed') return state;
      return reopen(state, state.phase.limits, effects);
    }

    case 'apply':
      return apply(state, action.at, effects);
    case 'cancel': {
      // A refused open and a stopped engine are counted however far the dialog got; Cancel only on an
      // open the dialog reported.
      const { phase } = state;
      if (phase.kind === 'refused') {
        effects.push({ type: 'track', fact: closedFact(state, 'refused', action.at, phase.refusal.code) });
      } else if (phase.kind === 'failed') {
        // A load failure is the browser's (offline, say), not the engine crashing.
        effects.push({ type: 'track', fact: closedFact(state, phase.unavailable ? 'unavailable' : 'crashed', action.at) });
      } else if (state.reportedOpen) {
        effects.push({ type: 'track', fact: closedFact(state, 'cancelled', action.at) });
      }
      effects.push({ type: 'close' });
      return { ...state, phase: { kind: 'closed', outcome: 'cancelled' } };
    }
  }
}

function withSentence(state: LayerOrderDialogState, sentence: LayerSentence): LayerOrderDialogState {
  if (sentence === state.sentence) return state;
  // A pick closes the verb menu and lets go of the reason (Round3 `setSubject`, `setObject`), and of a
  // step's running out: the line is the sentence's now, and the message never comes back stale.
  return withoutStepRanOut({ ...state, sentence, pointedVerb: null, hover: { ...state.hover, reason: false } });
}

/** The solutions of a new generation: nothing counted, read or proved yet. */
function freshSolutions(runs: boolean, generation: number): LayerOrderDialogState['solutions'] {
  return { runs, generation, count: null, position: null, positionBy: null, step: { kind: 'idle' }, ended: NO_PROVED_ENDS };
}

/** A step that ran out, said: let go, so the hint line is the builder's again (E9). */
function withoutStepRanOut(state: LayerOrderDialogState): LayerOrderDialogState {
  if (state.solutions.step.kind !== 'timed_out') return state;
  return { ...state, solutions: { ...state.solutions, step: { kind: 'idle' } } };
}

/**
 * The solutions with the order on screen read at `position` by `by`. A read
 * never moves the order, so the ends a step proved of it stay: before the
 * count is exact its index moves as the count finds solutions before it, and
 * a read for another side, late, proves nothing either way. What does move
 * the order or what the stepper steps by lets them go where it happens (a
 * step that moved, an order put back, an open or commit, `repositioned`), and
 * an end is only kept when proved by what the stepper steps by (`stepped`).
 */
function positionedAt(
  solutions: LayerOrderDialogState['solutions'],
  position: LayerPosition,
  by: LayerStepBy
): LayerOrderDialogState['solutions'] {
  return { ...solutions, position, positionBy: stepByKey(by) };
}

// ---------------------------------------------------------------------------
// The undo history: every action one step (`LayerUndoEntry`)

/** The sentence on screen and its block, as an entry holds them. */
function sentenceEntryOf(state: LayerOrderDialogState): LayerSentenceEntry {
  return { sentence: state.sentence, blocked: state.blocked };
}

/** The list, the order on screen, the restore's settling and the sentence, as an entry holds them. */
function listEntryOf(state: LayerOrderDialogState): Extract<LayerUndoEntry, { kind: 'list' }> {
  // A clash comes back to be explained again, if at all, not mid-explain.
  const settle: LayerSettle = state.settle.kind === 'clash' ? { ...state.settle, explain: null } : state.settle;
  return { kind: 'list', rows: state.rows, order: state.shownOrder, settle, ...sentenceEntryOf(state) };
}

/** Two orders the engine said, packed, the same. */
function sameOrder(a: LayerOrderBits | null, b: LayerOrderBits | null): boolean {
  return a === b || (a !== null && b !== null && a.length === b.length && a.every((byte, i) => byte === b[i]));
}

/**
 * `after`, a sentence edit of `before`'s, as one undo step: only when it
 * changes what the sentence says (its subject, verb or objects). Which slot
 * is active, and a pick that changes nothing, are no step. It goes on at
 * once, even while a commit or a step is in flight (`landed`).
 */
function edited(before: LayerOrderDialogState, after: LayerOrderDialogState): LayerOrderDialogState {
  if (sameSentence(before.sentence, after.sentence)) return after;
  return { ...after, history: recorded(after.history, { kind: 'sentence', ...sentenceEntryOf(before) }) };
}

/**
 * Any change but the sentence's lets go of a commit that ran out: the user
 * has moved on, and Keep trying no longer applies (`landed` relies on it). A
 * restore's re-check that ran out stays: it moves no history, and the rows
 * still wait on it (D10).
 */
function movedOn(state: LayerOrderDialogState): LayerOrderDialogState {
  return state.commit.kind === 'timed_out' && state.commit.via !== 'settle' ? { ...state, commit: { kind: 'idle' } } : state;
}

/**
 * The sentence an undo or redo brings back, less any object no longer open
 * with its subject. It never reports a block again: with the same subject and
 * verb as the sentence it replaces it is the same sentence, and keeps the
 * block reported; otherwise it brings back the one it had (D21's "once per
 * sentence").
 */
function restoredSentence(state: LayerOrderDialogState, entry: LayerSentenceEntry): LayerOrderDialogState {
  const restored = withSentence(state, keepOpenObjects(entry.sentence, state.open));
  const key = blockedKeyOf(restored);
  const same = key !== null && key === blockedKeyOf(state);
  return { ...restored, blocked: same ? state.blocked : entry.blocked };
}

/**
 * The side or X-ray changed: the stepper steps by something else now (D5), so
 * its position is read again. A step in flight stays in flight: the engine
 * moves the order whatever the view, and its answer reads the position again
 * when it stepped by something else (`stepped`).
 */
function repositioned(
  before: LayerOrderDialogState,
  next: LayerOrderDialogState,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  const by = currentStepBy(next);
  if (stepByKey(by) === stepByKey(currentStepBy(before)) || next.phase.kind !== 'open') return next;
  effects.push({ type: 'solutions_position', generation: next.solutions.generation, by });
  const { step } = next.solutions;
  return {
    ...next,
    solutions: {
      ...next.solutions,
      position: null,
      positionBy: null,
      step: step.kind === 'pending' ? step : { kind: 'idle' },
      // What a step proved, it proved by what it stepped by.
      ended: NO_PROVED_ENDS,
    },
  };
}

// ---------------------------------------------------------------------------
// Opening

function reopen(state: LayerOrderDialogState, limits: LayerOrderLimits, effects: LayerOrderEffect[]): LayerOrderDialogState {
  const [id, next] = request(state);
  effects.push({ type: 'open', request: id, how: state.how, limits });
  return { ...next, phase: { kind: 'opening', request: id, limits }, lastPreview: null };
}

function opened(
  state: LayerOrderDialogState,
  id: number,
  facts: LayerOpenFacts,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  const opening = state.phase.kind === 'opening' && state.phase.request === id;
  const restoring = state.settle.kind === 'restoring' && state.settle.request === id;
  if (!opening && !restoring) return state;
  const limits =
    state.phase.kind === 'opening'
      ? state.phase.limits
      : state.settle.kind === 'restoring'
        ? state.settle.limits
        : LAYER_ORDER_LIMITS.restore;

  let nextRowId = state.nextRowId;
  const committed: LayerCommittedRow[] = facts.constraints.map((constraint) => ({
    kind: 'committed',
    id: nextRowId++,
    constraint,
  }));
  const carried: LayerCarriedRow[] = (facts.restore?.carried ?? []).map((row) => ({
    kind: 'carried',
    id: nextRowId++,
    facts: row,
  }));

  let settle: LayerSettle = { kind: 'settled' };
  const outcome = facts.restore?.outcome;
  if (outcome?.kind === 'clash') {
    const clashing = new Set(outcome.constraints);
    const rows = carried.filter((row) => clashing.has(row.facts.index)).map((row) => row.id);
    settle = { kind: 'clash', rows, explain: null };
  } else if (outcome?.kind === 'timed_out') {
    settle = { kind: 'timed_out', limits };
  }

  const open = openIndexOf(facts.openPairs);
  const runs = solutionCountRuns(openPairCount(open));
  const generation = state.solutions.generation + 1;

  const next: LayerOrderDialogState = {
    ...state,
    nextRowId,
    phase: { kind: 'open' },
    figure: {
      faces: facts.faces,
      frontUp: facts.frontUp,
      overlapping: overlappingFaces(facts.faces, facts.stacks.front),
      letterRank: letterRanksOf(facts.faces, facts.letterOrder),
    },
    openedOn: facts.openedOn,
    openedLimits: limits,
    open,
    shown: facts.stacks,
    shownOrder: facts.order,
    rows: { committed, carried },
    history: emptyHistory(),
    commit: { kind: 'idle' },
    settle,
    reviewRows: reviewRowsFor(state.review, carried.map((row) => row.id)),
    sentence: EMPTY_SENTENCE,
    pointedVerb: null,
    ...NO_PREVIEWS,
    solutions: freshSolutions(runs, generation),
    hover: { face: null, slot: null, row: null, reason: false },
    flash: null,
    baseline: openedBaseline(facts, state.recordNeedsAttention),
    reportedOpen: true,
  };
  effects.push({ type: 'solutions_restart', generation, by: currentStepBy(next), count: runs });
  if (!state.reportedOpen) {
    effects.push({
      type: 'track',
      fact: dialogOpenedFact(state.surface, facts.faces, solutionsBucket(null, runs)),
    });
  }
  return next;
}

// ---------------------------------------------------------------------------
// Previews

/** Ask for a sentence's preview: one check of the committed list plus its candidates (D21). */
function askPreview(
  state: LayerOrderDialogState,
  candidates: readonly LayerConstraint[],
  limits: LayerOrderLimits,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  const [id, asked] = request(state);
  effects.push({ type: 'preview', request: id, constraints: previewListOf(asked.rows, candidates), limits });
  return {
    ...asked,
    lastPreview: id,
    previews: { ...asked.previews, [candidatesKey(candidates)]: { kind: 'pending', request: id, candidates, limits } },
  };
}

/**
 * Ask for the displayed can't-fit's explain: only the entry on display is
 * explained, when it comes on display, within the preview's short deadline
 * (`LAYER_ORDER_LIMITS.explain`); Keep trying asks again, later, after one
 * that ran out (`again`).
 */
function askExplain(
  state: LayerOrderDialogState,
  effects: LayerOrderEffect[],
  again: LayerOrderLimits | null = null
): LayerOrderDialogState {
  const candidates = sentenceCandidates(state, state.pointedVerb ?? state.sentence.verb);
  const entry = candidates ? state.previews[candidatesKey(candidates)] : undefined;
  if (!candidates || entry?.kind !== 'cant_fit') return state;
  if (entry.explain.kind !== (again ? 'timed_out' : 'none')) return state;
  const limits = again ?? LAYER_ORDER_LIMITS.explain;
  const [id, asked] = request(state);
  effects.push({
    type: 'explain',
    request: id,
    constraints: previewListOf(asked.rows, entry.candidates),
    limits,
  });
  return {
    ...asked,
    previews: { ...asked.previews, [candidatesKey(candidates)]: { ...entry, explain: { kind: 'pending', request: id, limits } } },
  };
}

/**
 * A sentence as `layer constraint blocked` counts it (D21): its subject and
 * its verb as read from the front, so turning over is no new sentence; its
 * objects are not part of it. Null with no subject.
 */
function blockedKeyOf(state: LayerOrderDialogState): string | null {
  const { subject, verb } = state.sentence;
  if (subject === null) return null;
  const fromFront = state.view.side === 'front' ? verb : verb === 'in_front_of' ? 'behind' : 'in_front_of';
  return `${subject}:${fromFront}`;
}

/**
 * `layer constraint blocked`, once per sentence (D21): until its subject or
 * its verb as read from the front changes, an Add, or a Clear. A commit, a
 * step, undo and redo change neither, so the same sentence blocked again
 * after one is not counted again. The bucket is the objects at its block.
 */
function reportBlocked(state: LayerOrderDialogState, effects: LayerOrderEffect[]): LayerOrderDialogState {
  const key = blockedKeyOf(state);
  // The subject or the verb changed: the next block is a new sentence's.
  const current = state.blocked !== null && state.blocked !== key ? { ...state, blocked: null } : state;
  const chosen = chosenPreview(current);
  if (chosen?.kind !== 'cant_fit' || key === null || current.blocked === key) return current;
  effects.push({ type: 'track', fact: constraintBlockedFact(current.rows.committed.length, current.sentence.objects.length) });
  return { ...current, blocked: key };
}

/**
 * After every action: a complete sentence the order on screen has no preview
 * for gets one (the one the folded pane shows, with the menu's pointed verb),
 * a can't-fit on display is explained, and the sentence's block is reported
 * once.
 */
function reconcile(state: LayerOrderDialogState, effects: LayerOrderEffect[]): LayerOrderStep {
  let next = state;
  if (builderLive(next) && quiet(next)) {
    const candidates = sentenceCandidates(next, next.pointedVerb ?? next.sentence.verb);
    if (candidates && !next.previews[candidatesKey(candidates)]) {
      next = askPreview(next, candidates, LAYER_ORDER_LIMITS.preview, effects);
    }
    next = askExplain(next, effects);
  }
  return { state: reportBlocked(next, effects), effects };
}

function previewKeyFor(state: LayerOrderDialogState, match: (entry: LayerPreviewEntry) => boolean): string | null {
  return Object.keys(state.previews).find((key) => match(state.previews[key]!)) ?? null;
}

function previewed(state: LayerOrderDialogState, id: number, facts: LayerPreviewFacts): LayerOrderDialogState {
  const key = previewKeyFor(state, (entry) => entry.kind === 'pending' && entry.request === id);
  if (key === null) return state;
  const entry = state.previews[key] as Extract<LayerPreviewEntry, { kind: 'pending' }>;
  const { candidates, limits } = entry;
  let result: LayerPreviewEntry;
  switch (facts.verdict) {
    case 'fits': {
      const { token, changed, stacks } = facts;
      result = { kind: 'fits', request: id, candidates, token, limits, changed, stacks };
      break;
    }
    case 'timed_out':
      result = { kind: 'timed_out', candidates, limits };
      break;
    case 'cant_fit': {
      const alone = aloneIndex(facts.constraints, state.rows.committed.length, candidates.length);
      const candidate = alone === null ? null : candidates[alone - state.rows.committed.length]!;
      // The creases alone refuse one of its constraints: nothing to explain. Otherwise the
      // explain is asked once the entry is on display (`askExplain`).
      const explain: LayerExplainState = candidate
        ? { kind: 'done', constraints: [alone!], faces: [candidate[0], candidate[1]], minimal: true }
        : { kind: 'none' };
      result = { kind: 'cant_fit', candidates, constraints: facts.constraints, explain };
      break;
    }
  }
  return { ...state, previews: { ...state.previews, [key]: result } };
}

/**
 * The one candidate a can't-fit's proof names when it names no other
 * constraint, so the creases alone refuse it and it is its own smallest set;
 * null when explain has more to find. A proof naming nothing means the only
 * candidate, as it always did with one object.
 */
function aloneIndex(proof: readonly number[], committed: number, candidates: number): number | null {
  if (proof.length === 0) return candidates === 1 ? committed : null;
  const index = proof[0]!;
  const one = proof.every((named) => named === index);
  return one && index >= committed && index < committed + candidates ? index : null;
}

function explained(state: LayerOrderDialogState, id: number, facts: LayerExplainFacts): LayerOrderDialogState {
  const key = previewKeyFor(
    state,
    (entry) => entry.kind === 'cant_fit' && entry.explain.kind === 'pending' && entry.explain.request === id
  );
  if (key !== null) {
    const entry = state.previews[key] as Extract<LayerPreviewEntry, { kind: 'cant_fit' }>;
    const clash = clashOf(facts, entry.constraints, previewListOf(state.rows, entry.candidates));
    const explain: LayerExplainState =
      facts.verdict === 'timed_out' && entry.explain.kind === 'pending'
        ? { kind: 'timed_out', limits: entry.explain.limits, ...clash }
        : { kind: 'done', ...clash };
    return { ...state, previews: { ...state.previews, [key]: { ...entry, explain } } };
  }
  const { settle } = state;
  if (settle.kind === 'clash' && settle.explain?.request === id) {
    // The list the settle commit sent, row for row: the rows did not move, since it did not land.
    const { listRows } = settle.explain;
    const live = new Set(state.rows.carried.map((row) => row.id));
    const clashing =
      facts.verdict === 'clash'
        ? facts.constraints.map((index) => listRows[index]).filter((rowId) => rowId !== undefined)
        : settle.rows;
    return { ...state, settle: { kind: 'clash', rows: clashing.filter((rowId) => live.has(rowId)), explain: null } };
  }
  return state;
}

/** The smallest clashing set explain found; when it couldn't (out of time, or no verdict), the check's own set, not minimal. */
function clashOf(facts: LayerExplainFacts, checked: readonly number[], list: readonly LayerConstraint[]): LayerClash {
  if (facts.verdict === 'clash') {
    return { constraints: facts.constraints, faces: facts.faces, minimal: facts.minimal };
  }
  const named = checked.map((index) => list[index]).filter((c): c is LayerConstraint => c !== undefined);
  return { constraints: checked, faces: constraintFaces(named), minimal: false };
}

// ---------------------------------------------------------------------------
// Commits: Add, remove, undo, redo, Clear all (Round3 `commit`)

function ask(state: LayerOrderDialogState, commitAsk: LayerCommitAsk, effects: LayerOrderEffect[]): LayerOrderDialogState {
  const [id, next] = request(state);
  effects.push({
    type: 'commit',
    request: id,
    constraints: commitAsk.constraints,
    token: commitAsk.token,
    order: commitAsk.order,
    limits: commitAsk.limits,
  });
  // A commit drops the preview the session holds, whatever it answers.
  return { ...next, commit: { kind: 'pending', request: id, ...commitAsk }, lastPreview: null };
}

/** A change to the list only, with no new list to commit: carried rows, which the order never depends on. */
function landNow(state: LayerOrderDialogState, rows: LayerRows, history: LayerOrderDialogState['history']): LayerOrderDialogState {
  // The hovered row stays hovered while any of its constraints remains.
  const stillThere = state.hover.row === null || rowGroupByKey(rowGroupsOf(rows, state.figure), state.hover.row) !== null;
  return { ...state, rows, history, hover: stillThere ? state.hover : { ...state.hover, row: null } };
}

/** Each of `a`'s limits or `b`'s, whichever goes further. */
function widestLimits(a: LayerOrderLimits, b: LayerOrderLimits): LayerOrderLimits {
  return {
    maxNodes: Math.max(a.maxNodes, b.maxNodes),
    fastNodes: Math.max(a.fastNodes, b.fastNodes),
    deadlineMs: Math.max(a.deadlineMs, b.deadlineMs),
  };
}

/**
 * Round3 `add`: commit the sentence the preview fit, as one undo step: one
 * constraint per object, less any already committed (D21). It lands (and the
 * sentence clears) when the commit does. While its preview is the one the
 * session holds, its token adopts it with no search; a preview the session
 * has moved past (a later preview, a commit or a step since) is committed by
 * a search, with limits at least as wide as the ones it fit under, so a
 * sentence that fit only after Keep trying can't run out on Add.
 */
function add(state: LayerOrderDialogState, effects: LayerOrderEffect[]): LayerOrderDialogState {
  if (!builderLive(state) || !quiet(state)) return state;
  const entry = chosenPreview(state);
  const searchAfterTimeout = entry?.kind === 'timed_out' && ADD_AFTER_PREVIEW_TIMEOUT;
  if (!entry || (entry.kind !== 'fits' && !searchAfterTimeout)) return state;
  const held = entry.kind === 'fits' && entry.request === state.lastPreview;
  const limits = held ? LAYER_ORDER_LIMITS.commit : widestLimits(LAYER_ORDER_LIMITS.commit, entry.limits);
  let nextRowId = state.nextRowId;
  const added = entry.candidates.map((constraint): LayerCommittedRow => ({ kind: 'committed', id: nextRowId++, constraint }));
  const rows = { ...state.rows, committed: [...state.rows.committed, ...added] };
  return ask(
    { ...state, nextRowId, blocked: null },
    {
      via: 'add',
      constraints: committedConstraints(rows),
      token: held && entry.kind === 'fits' ? entry.token : null,
      order: null,
      limits,
      rows,
      ...newEntry(state, listEntryOf(state)),
      sentence: state.sentence,
      restore: null,
      listRows: rows.committed.map((r) => r.id),
    },
    effects
  );
}

/** A new undo step, `entry`, once what is asked lands. */
function newEntry(state: LayerOrderDialogState, entry: LayerUndoEntry): { move: LayerHistoryMove<LayerUndoEntry>; at: number } {
  return { move: { kind: 'record', entry }, at: state.history.past.length };
}

function committed(
  state: LayerOrderDialogState,
  action: Extract<LayerOrderAction, { type: 'committed' }>,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  const { commit } = state;
  if (commit.kind !== 'pending' || commit.request !== action.request) return state;
  const { facts } = action;
  const { request: _request, kind: _kind, ...commitAsk } = commit;

  if (facts.verdict === 'timed_out') return { ...state, commit: { kind: 'timed_out', ...commitAsk } };
  if (facts.verdict === 'cant_fit') {
    if (commit.via !== 'settle') {
      // A list that fit once fits again with the creases unchanged; nothing to do but stay as we were.
      return { ...state, commit: { kind: 'idle' } };
    }
    // The rows still clash after a removal: mark the check's set, and find the smallest (D10).
    const [id, next] = request({ ...state, commit: { kind: 'idle' } });
    const rows = facts.constraints.map((index) => commit.listRows[index]).filter((rowId) => rowId !== undefined);
    effects.push({ type: 'explain', request: id, constraints: commit.constraints, limits: LAYER_ORDER_LIMITS.explain });
    return { ...next, settle: { kind: 'clash', rows, explain: { request: id, listRows: commit.listRows } } };
  }

  const open = openIndexOf(facts.openPairs);
  // The sentence the commit was asked with is still on screen: an edit since is newer, and stays.
  const untouched = sameSentence(commit.sentence, state.sentence);
  const history = landed(state.history, commit.at, commit.move);
  if ((commit.via === 'undo' || commit.via === 'redo') && sameCommitted(commit.rows.committed, state.rows.committed)) {
    return orderPutBack(state, commit, facts, history, untouched, effects);
  }
  let sentence = state.sentence;
  if (commit.via === 'add' && untouched) {
    // Round3 `add`: the whole sentence clears; the flash is what remains of it.
    sentence = EMPTY_SENTENCE;
  } else {
    sentence = keepOpenObjects(sentence, open);
  }
  const generation = state.solutions.generation + 1;
  // D7: whether the count starts again is decided on the open pairs this commit leaves.
  const runs = solutionCountRuns(openPairCount(open));
  let next: LayerOrderDialogState = landNow(
    {
      ...state,
      open,
      shown: facts.stacks,
      shownOrder: facts.order,
      commit: { kind: 'idle' },
      // Undo and redo bring back the restore's settling on the other side of the entry (D10).
      settle: commit.via === 'settle' ? { kind: 'settled' } : (commit.restore?.settle ?? state.settle),
      sentence,
      pointedVerb: commit.via === 'add' ? null : state.pointedVerb,
      ...NO_PREVIEWS,
      solutions: freshSolutions(runs, generation),
    },
    commit.rows,
    history
  );
  // Undo and redo bring back the sentence that was on screen on the other side of the entry.
  if (commit.restore && untouched) next = restoredSentence(next, commit.restore);
  next = flashed(next, facts.changed, effects);
  effects.push({ type: 'solutions_restart', generation, by: currentStepBy(next), count: runs });
  if (commit.via === 'add') {
    const { verb, subjectOrigin, objects } = commit.sentence;
    const objectOrigin = objectOriginOf(commit.sentence);
    const fact = constraintAddedFact(verb, subjectOrigin ?? 'pattern', objectOrigin ?? 'pattern', objects.length);
    effects.push({ type: 'track', fact });
  }
  return next;
}

/**
 * An undo or redo that put an order back on the same committed list (a
 * step's, or carried rows with an order): only the order on screen moved, as
 * a step moves it. The count and the stepper's cursor go on, the can't-fits
 * stay and the fits go, and the position is read again.
 */
function orderPutBack(
  state: LayerOrderDialogState,
  commit: Extract<LayerOrderDialogState['commit'], { kind: 'pending' }>,
  facts: Extract<LayerCommitFacts, { verdict: 'committed' }>,
  history: LayerOrderDialogState['history'],
  untouched: boolean,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  let next: LayerOrderDialogState = landNow(
    {
      ...state,
      open: openIndexOf(facts.openPairs),
      shown: facts.stacks,
      shownOrder: facts.order,
      commit: { kind: 'idle' },
      settle: commit.restore?.settle ?? state.settle,
      previews: cantFitsOnly(state.previews),
      lastPreview: null,
      // Another order on screen: nothing a step proved holds of it (E9).
      solutions: { ...state.solutions, position: null, positionBy: null, step: { kind: 'idle' }, ended: NO_PROVED_ENDS },
    },
    commit.rows,
    history
  );
  if (commit.restore && untouched) next = restoredSentence(next, commit.restore);
  effects.push({ type: 'solutions_position', generation: next.solutions.generation, by: currentStepBy(next) });
  return flashed(next, facts.changed, effects);
}

function sameSentence(a: LayerSentence, b: LayerSentence): boolean {
  return (
    a.subject === b.subject &&
    a.verb === b.verb &&
    a.objects.length === b.objects.length &&
    a.objects.every((object, i) => object === b.objects[i])
  );
}

function flashed(state: LayerOrderDialogState, changed: LayerChangedSpots, effects: LayerOrderEffect[]): LayerOrderDialogState {
  if (!hasChangedSpots(changed)) return { ...state, flash: null };
  const n = state.flashes + 1;
  effects.push({ type: 'flash', n });
  return { ...state, flashes: n, flash: { changed, n } };
}

/**
 * Round3 `removeCons`, and a carried row's trash (D10): a row's trash takes
 * every constraint the row shows (D21), as one undo step, and the other rows
 * keep their places (`withoutRow`).
 */
function rowRemoved(state: LayerOrderDialogState, key: LayerRowKey, effects: LayerOrderEffect[]): LayerOrderDialogState {
  if (state.phase.kind !== 'open' || !quiet(state) || state.settle.kind === 'restoring') return state;
  const { rows } = state;
  const target = withoutRow(rows, key, state.figure);
  if (target.committed.length < rows.committed.length) {
    if (state.settle.kind !== 'settled') return state;
    return ask(
      state,
      {
        via: 'remove',
        constraints: committedConstraints(target),
        token: null,
        order: null,
        limits: LAYER_ORDER_LIMITS.commit,
        rows: target,
        ...newEntry(state, listEntryOf(state)),
        sentence: state.sentence,
        restore: null,
        listRows: target.committed.map((row) => row.id),
      },
      effects
    );
  }
  if (target.carried.length === rows.carried.length) return state;
  // Carried rows the order never depended on: no commit, but an entry, so undo puts them back. While a
  // restore's rows settle (D10), the entry also brings back the clash, and the re-check the removal asks
  // lands under it, so the removal and its re-check are one step.
  const removed = landNow(movedOn(state), target, recorded(state.history, listEntryOf(state)));
  if (state.settle.kind === 'settled') return removed;
  const kept = new Set(target.carried.map((row) => row.id));
  const gone = new Set(rows.carried.filter((row) => !kept.has(row.id)).map((row) => row.id));
  return settleAfterRemoval(removed, gone, effects);
}

/**
 * Rows removed while the saved rows are unsettled: the rows left that can
 * apply are committed together, or not at all (D10). With none left, they
 * are settled as they stand.
 */
function settleAfterRemoval(
  state: LayerOrderDialogState,
  removed: ReadonlySet<number>,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  // A clashing set none of whose rows went still clashes: there is nothing to re-check.
  if (state.settle.kind === 'clash' && !state.settle.rows.some((rowId) => removed.has(rowId))) return state;
  const settle =
    state.settle.kind === 'clash'
      ? { ...state.settle, rows: state.settle.rows.filter((rowId) => !removed.has(rowId)), explain: null }
      : state.settle;
  const listed = state.rows.carried.filter(applicable);
  if (listed.length === 0) return { ...state, settle: { kind: 'settled' } };
  const promoted: LayerCommittedRow[] = listed.map((row) => ({
    kind: 'committed',
    id: row.id,
    constraint: row.facts.constraint!,
  }));
  const listedIds = new Set(listed.map((row) => row.id));
  const rows: LayerRows = {
    committed: [...state.rows.committed, ...promoted],
    carried: state.rows.carried.filter((row) => !listedIds.has(row.id)),
  };
  return ask(
    { ...state, settle },
    {
      via: 'settle',
      constraints: committedConstraints(rows),
      token: null,
      order: null,
      limits: LAYER_ORDER_LIMITS.commit,
      rows,
      // The rows a restore saved apply together, or not at all, under the removal's own entry (D10).
      move: { kind: 'none' },
      at: state.history.past.length,
      sentence: state.sentence,
      restore: null,
      listRows: rows.committed.map((row) => row.id),
    },
    effects
  );
}

/** Whether undo and redo can move: the session open, nothing in flight, and no restore running (D10's clash and timeout included). */
export function canTravel(state: LayerOrderDialogState): boolean {
  return state.phase.kind === 'open' && quiet(state) && state.settle.kind !== 'restoring';
}

/**
 * Undo and redo, of any entry. A sentence edit's sentence comes back at once.
 * An entry that changed the order on screen puts the order on its other side
 * back exactly (`show`, no search), with the list it had, and brings back the
 * sentence and the restore's settling once it lands (#539's review: a
 * relative step back stuck or landed on another picture). With the same list
 * and the same order, all of it comes back at once.
 */
function travel(state: LayerOrderDialogState, way: 'undo' | 'redo', effects: LayerOrderEffect[]): LayerOrderDialogState {
  if (!canTravel(state)) return state;
  const target = way === 'undo' ? undoTarget(state.history) : redoTarget(state.history);
  if (!target) return state;
  const at = state.history.past.length;
  if (target.kind === 'sentence') {
    const move = { kind: way, present: { kind: 'sentence', ...sentenceEntryOf(state) } } as const;
    return restoredSentence({ ...movedOn(state), history: landed(state.history, at, move) }, target);
  }
  const present: LayerUndoEntry = target.kind === 'list' ? listEntryOf(state) : { kind: 'step', order: state.shownOrder };
  const move = { kind: way, present } as const;
  const rows = target.kind === 'list' ? target.rows : state.rows;
  const restore = target.kind === 'list' ? target : null;
  if (sameCommitted(rows.committed, state.rows.committed) && (target.order === null || sameOrder(target.order, state.shownOrder))) {
    // Nothing for the engine to do: carried rows, a sentence, a settling.
    const moved = landNow(movedOn(state), rows, landed(state.history, at, move));
    return restore ? restoredSentence({ ...moved, settle: restore.settle }, restore) : moved;
  }
  return ask(
    state,
    {
      via: way,
      constraints: committedConstraints(rows),
      token: null,
      order: target.order,
      limits: LAYER_ORDER_LIMITS.commit,
      rows,
      move,
      at,
      sentence: state.sentence,
      restore,
      listRows: rows.committed.map((row) => row.id),
    },
    effects
  );
}

/** Round3 `clearAll`: every row goes, carried ones included, as one entry undo puts back. */
function clearAll(state: LayerOrderDialogState, effects: LayerOrderEffect[]): LayerOrderDialogState {
  if (state.phase.kind !== 'open' || state.settle.kind !== 'settled' || !quiet(state)) return state;
  if (state.rows.committed.length === 0 && state.rows.carried.length === 0) return state;
  const entry = listEntryOf(state);
  if (state.rows.committed.length === 0) return landNow(movedOn(state), NO_ROWS, recorded(state.history, entry));
  return ask(
    state,
    {
      via: 'clear_all',
      constraints: [],
      token: null,
      order: null,
      limits: LAYER_ORDER_LIMITS.commit,
      rows: NO_ROWS,
      ...newEntry(state, entry),
      sentence: state.sentence,
      restore: null,
      listRows: [],
    },
    effects
  );
}

/** Round3 `reveal`: a row's subject goes into the builder. A row whose subject no longer exists has none to give. */
function rowClicked(state: LayerOrderDialogState, key: LayerRowKey): LayerOrderDialogState {
  if (!builderLive(state)) return state;
  const row = rowGroupByKey(rowGroupsOf(state.rows, state.figure), key)?.members[0];
  const subject = row ? rowParts(row).subject : null;
  if (subject === null) return state;
  return edited(state, withSentence(state, revealSubject(state.sentence, subject)));
}

// ---------------------------------------------------------------------------
// Keep trying (D8, D10)

function keepTryingAgain(state: LayerOrderDialogState, effects: LayerOrderEffect[]): LayerOrderDialogState {
  const { phase, settle, commit } = state;
  if (phase.kind === 'refused') {
    if (phase.refusal.code !== 'session_timed_out') return state;
    return reopen(state, keepTryingLimits(phase.limits), effects);
  }
  if (phase.kind !== 'open') return state;
  // A re-check that ran out comes before the restore it followed: restoring again would bring back the rows removed since.
  if (commit.kind === 'timed_out') {
    const { kind: _kind, ...commitAsk } = commit;
    // A token commit can't run out, so this is a search: send it again, later.
    return ask(state, { ...commitAsk, token: null, limits: keepTryingLimits(commit.limits) }, effects);
  }
  if (settle.kind === 'timed_out') {
    const [id, next] = request(state);
    const limits = keepTryingLimits(settle.limits);
    effects.push({ type: 'open', request: id, how: 'restore', limits });
    return { ...next, settle: { kind: 'restoring', request: id, limits }, lastPreview: null };
  }
  // A step that ran out (E9), the newest on the line, before a sentence's check: the same way again,
  // later, going on from what it proved.
  const ranOut = state.solutions.step;
  if (ranOut.kind === 'timed_out') return step(state, ranOut.direction, effects, keepTryingLimits(ranOut.limits));
  const entry = displayedPreview(state);
  if (entry?.kind === 'timed_out' && quiet(state)) {
    return askPreview(state, entry.candidates, keepTryingLimits(entry.limits), effects);
  }
  // An explain that ran out: the same set, asked again with later limits.
  if (entry?.kind === 'cant_fit' && entry.explain.kind === 'timed_out' && quiet(state)) {
    return askExplain(state, effects, keepTryingLimits(entry.explain.limits));
  }
  return state;
}

// ---------------------------------------------------------------------------
// The stepper (Round3 `stepLook`; D5, D7)

/**
 * ‹ or ›: one undo step, once it moves the order on screen. Its entry holds
 * the order it moved from, which undo puts back exactly (`travel`).
 */
function step(
  state: LayerOrderDialogState,
  direction: 'next' | 'previous',
  effects: LayerOrderEffect[],
  limits: LayerOrderLimits = LAYER_ORDER_LIMITS.step
): LayerOrderDialogState {
  if (state.phase.kind !== 'open' || state.settle.kind !== 'settled' || !quiet(state)) return state;
  const by = currentStepBy(state);
  const [id, next] = request(movedOn(state));
  effects.push({ type: 'step', request: id, generation: state.solutions.generation, by, direction, limits });
  const move: LayerHistoryMove<LayerUndoEntry> = { kind: 'record', entry: { kind: 'step', order: state.shownOrder } };
  const at = state.history.past.length;
  return {
    ...next,
    solutions: { ...next.solutions, step: { kind: 'pending', request: id, direction, by, limits, move, at } },
  };
}

function stepped(
  state: LayerOrderDialogState,
  action: Extract<LayerOrderAction, { type: 'stepped' }>,
  effects: LayerOrderEffect[]
): LayerOrderDialogState {
  const pending = state.solutions.step;
  if (pending.kind !== 'pending' || pending.request !== action.request) return state;
  const { facts } = action;
  // A step that ends or runs out moves nothing, the history included, and the session keeps its preview.
  // An end is proved (E9), by what it stepped by: kept with any proved the other way from the same order,
  // unless the stepper steps by something else since (turned over, X-rayed while it ran).
  if (facts.verdict === 'end') {
    const { direction } = pending;
    const same = stepByKey(pending.by) === stepByKey(currentStepBy(state));
    const ended = same ? withProvedEnd(state.solutions.ended, direction) : state.solutions.ended;
    return { ...state, solutions: { ...state.solutions, step: { kind: 'end', direction }, ended } };
  }
  if (facts.verdict === 'timed_out') {
    const step = { kind: 'timed_out', direction: pending.direction, limits: pending.limits } as const;
    return { ...state, solutions: { ...state.solutions, step } };
  }
  // The order on screen changed, and no constraint did: the fits go (the session's preview too), a
  // can't-fit and its explain stay, and the flash shows what moved.
  const next: LayerOrderDialogState = {
    ...state,
    shown: facts.stacks,
    shownOrder: facts.order,
    previews: cantFitsOnly(state.previews),
    lastPreview: null,
    history: landed(state.history, pending.at, pending.move),
    solutions: {
      ...state.solutions,
      position: facts.position,
      positionBy: stepByKey(pending.by),
      step: { kind: 'idle' },
      // Another order: nothing is proved of it yet.
      ended: NO_PROVED_ENDS,
    },
  };
  // Turned over or X-rayed while it ran: the stepper reads its position again for what it steps by now.
  const by = currentStepBy(next);
  if (stepByKey(by) !== stepByKey(pending.by)) {
    effects.push({ type: 'solutions_position', generation: next.solutions.generation, by });
  }
  return flashed(next, facts.changed, effects);
}

// ---------------------------------------------------------------------------
// Apply and Cancel (spec §6.8; D10, D16)

/** Why Apply waits, or null when it can apply. */
export function applyBlocker(
  state: LayerOrderDialogState
): 'opening' | 'refused' | 'busy' | 'clash' | 'unsettled' | null {
  const { phase, settle, commit } = state;
  if (phase.kind === 'opening') return 'opening';
  if (phase.kind !== 'open') return 'refused';
  // A re-check after a removal comes first: the rows that clashed may not, once it lands.
  if (commit.kind !== 'idle' && commit.via === 'settle') return 'unsettled';
  if (settle.kind === 'clash') return 'clash';
  if (settle.kind !== 'settled') return 'unsettled';
  if (!quiet(state)) return 'busy';
  return null;
}

function apply(state: LayerOrderDialogState, at: number, effects: LayerOrderEffect[]): LayerOrderDialogState {
  if (applyBlocker(state) !== null || !state.shown || !state.baseline) return state;
  const constraints = committedConstraints(state.rows);
  const keepCarried = state.rows.carried.map((row) => row.facts.index);
  const unchanged = applyChangedNothing(state.baseline, { constraints, carried: keepCarried, stacks: state.shown });
  // A turn alone writes no record (D16): the host turns its picture, and that is all.
  effects.push({
    type: 'apply',
    result: unchanged ? { kind: 'no_change' } : { kind: 'changed', constraints, keepCarried },
    turnDeg: appliedTurn(state),
  });
  effects.push({ type: 'track', fact: closedFact(state, unchanged ? 'unchanged' : 'applied', at) });
  return { ...state, phase: { kind: 'closed', outcome: 'applied' } };
}

function closedFact(
  state: LayerOrderDialogState,
  outcome: LayerOrderClosedOutcome,
  at: number,
  refusal: LayerOrderRefusalCode | null = null
): LayerOrderFact {
  const { solutions, view } = state;
  const count = solutions.count ? (view.xray ? solutions.count.orders : solutions.count[view.side]) : null;
  return dialogClosedFact(
    outcome,
    state.rows.committed.length,
    solutionsBucket(count, solutions.runs),
    at - state.openedAt,
    refusal,
    appliedTurn(state) !== null
  );
}

// ---------------------------------------------------------------------------
// The turn

/** An angle in degrees, in [0, 360). */
function wrapTurn(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  // A hair under a whole turn, from float drift, is no turn.
  return wrapped > 360 - 1e-9 ? 0 : wrapped;
}

/**
 * The view's turn after one press of Rotate `direction`: 15° anticlockwise
 * (Left) or clockwise (Right) as the folded pane shows the paper, so, in the
 * host's terms, the same way from the host's side and the other way from the
 * other (`paneTurnDeg`).
 */
function turnedBy(state: LayerOrderDialogState, direction: LayerTurnDirection): number {
  const seen = direction === 'right' ? LAYER_TURN_STEP_DEG : -LAYER_TURN_STEP_DEG;
  const delta = state.view.side === state.hostTurn.side ? seen : -seen;
  return wrapTurn(state.view.turnDeg + delta);
}

/** The view's turn, in the host's terms, when Rotate moved it from the host's; null when it did not. */
export function appliedTurn(state: LayerOrderDialogState): number | null {
  const moved = wrapTurn(state.view.turnDeg - state.hostTurn.deg);
  return moved > 1e-6 && moved < 360 - 1e-6 ? state.view.turnDeg : null;
}
