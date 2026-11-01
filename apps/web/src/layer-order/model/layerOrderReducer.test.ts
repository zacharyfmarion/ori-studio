/**
 * The inspector reducer, behaviour by behaviour, against the approved
 * artboard (Round3 = `artifacts/layer-order-design/project/Round3.dc.html`)
 * and the Round 4 states board for the waiting, timed-out, attention and
 * refusal states. Behaviour that rests on a pending decision is tested once,
 * in `layerOrderDecisions.test.ts`, and not again here.
 */
import { describe, expect, it } from 'vitest';
import { LAYER_ORDER_COUNT_SLICE } from '../layerOrderBudgets';
import { constraintAddedFact, constraintBlockedFact, dialogClosedFact, dialogOpenedFact } from './layerOrderAnalytics';
import { LAYER_ORDER_LIMITS, keepTrying } from './layerOrderEngineFacts';
import {
  INIT,
  OPEN_PAIRS,
  SPOTS,
  SPOTS_TWO_OVER_ZERO,
  carried,
  changedSpots,
  commits,
  count,
  dispatch,
  effectsOf,
  fits,
  lastOf,
  openFactsOf,
  opened,
  orderOf,
  picked,
  play,
  position,
  rowKey,
  sidesOf,
  trashOf,
  withOneConstraint,
  type Played,
} from './layerOrderModel.fixtures';
import { chosenPreview, displayedPreview, initLayerOrderDialog, layerOrderReducer } from './layerOrderReducer';
import {
  addState,
  applyState,
  displayedStacks,
  hintLine,
  listControls,
  openingView,
  paneMarks,
  rowGroupsView,
  statusView,
} from './layerOrderSelectors';
import { EMPTY_SENTENCE } from './layerOrderSentence';
import { paneTurnDeg } from '../panes/layerPaneFigure';
import type { LayerOrderDialogState } from './layerOrderState';

const sentence = (subject: number | null, verb: 'in_front_of' | 'behind' | null, object: number | null) => ({
  subject,
  verb,
  objects: [object],
});

function previewAnswer(played: Played, facts: Parameters<typeof layerOrderReducer>[1] & { type: 'previewed' }) {
  return play(played.state, facts);
}

function lastPreviewRequest(played: Played): number {
  return lastOf(played.effects, 'preview').request;
}

// ---------------------------------------------------------------------------

describe('opening', () => {
  it('starts working, with one open: on the host’s order, or by restoring its record', () => {
    const showing = initLayerOrderDialog(INIT);
    expect(showing.state.phase).toEqual({ kind: 'opening', request: 1, limits: LAYER_ORDER_LIMITS.open });
    expect(showing.effects).toEqual([{ type: 'open', request: 1, how: 'showing', limits: LAYER_ORDER_LIMITS.open }]);
    expect(openingView(showing.state)).toEqual({ kind: 'working' });
    expect(applyState(showing.state)).toEqual({ enabled: false, why: 'opening' });

    const restoring = initLayerOrderDialog({ ...INIT, hasRecord: true });
    expect(restoring.effects).toEqual([
      { type: 'open', request: 1, how: 'restore', limits: LAYER_ORDER_LIMITS.restore },
    ]);
  });

  it('takes no pick while working', () => {
    const { state } = initLayerOrderDialog(INIT);
    expect(dispatch(state, { type: 'face_picked', face: 2, origin: 'pattern' }).state).toBe(state);
  });

  it('opens on the session’s answer: the figure, its open pairs, the order on screen, and a count', () => {
    const { state, effects } = opened();
    expect(state.phase).toEqual({ kind: 'open' });
    expect(openingView(state)).toBeNull();
    expect(state.figure?.faces).toBe(7);
    expect(Array.from(state.figure!.overlapping)).toEqual([1, 1, 1, 1, 1, 1, 0]);
    expect(state.shown).toEqual(sidesOf(SPOTS));
    expect(lastOf(effects, 'solutions_restart')).toEqual({
      type: 'solutions_restart',
      generation: 1,
      by: { picture: 'front' },
      count: true,
    });
    expect(lastOf(effects, 'track').fact).toEqual(dialogOpenedFact('edit_figure', 7, 'pending'));
    expect(applyState(state)).toEqual({ enabled: true });
  });

  it('drops an answer to an open it no longer waits on', () => {
    const start = initLayerOrderDialog(INIT);
    expect(layerOrderReducer(start.state, { type: 'opened', request: 9, facts: openFactsOf() }).state).toBe(start.state);
  });

  it('shows a refusal by its code, naming the face', () => {
    const start = initLayerOrderDialog(INIT);
    const { state } = play(start, { type: 'open_refused', request: 1, refusal: { code: 'source_non_convex_face', face: 3 } });
    expect(openingView(state)).toEqual({
      kind: 'refused',
      message: { key: 'non_convex_face', face: 3, retry: null },
    });
    expect(applyState(state)).toEqual({ enabled: false, why: 'refused' });
    // Nothing to try again.
    expect(dispatch(state, { type: 'keep_trying' }).effects).toEqual([]);
  });

  it('an open that ran out offers Keep trying, which opens again with a later deadline', () => {
    const start = initLayerOrderDialog(INIT);
    const refused = play(start, {
      type: 'open_refused',
      request: 1,
      refusal: { code: 'session_timed_out', limit: 'deadline', nodes: 10 },
    });
    expect(openingView(refused.state)).toEqual({
      kind: 'refused',
      message: { key: 'open_timed_out', retry: 'keep_trying' },
    });
    const again = dispatch(refused.state, { type: 'keep_trying' });
    expect(again.effects).toEqual([
      { type: 'open', request: 2, how: 'showing', limits: keepTrying(LAYER_ORDER_LIMITS.open) },
    ]);
    expect(again.state.phase).toMatchObject({ kind: 'opening', request: 2 });
  });

  it('a lost engine fails the dialog; Try again opens afresh', () => {
    const lost = play(opened().state, { type: 'engine_lost' });
    expect(openingView(lost.state)).toEqual({ kind: 'failed' });
    const again = dispatch(lost.state, { type: 'retry_open' });
    expect(lastOf(again.effects, 'open')).toMatchObject({ how: 'showing' });
  });
});

// ---------------------------------------------------------------------------

describe('the preview of a complete sentence', () => {
  it('runs at once; Add waits while it is checking', () => {
    const p = picked(opened().state, 2, 0);
    const preview = lastOf(p.effects, 'preview');
    expect(preview).toMatchObject({ constraints: [[2, 0, 1]], limits: LAYER_ORDER_LIMITS.preview });
    expect(chosenPreview(p.state)?.kind).toBe('pending');
    expect(addState(p.state)).toMatchObject({ enabled: false, why: 'checking' });
    expect(hintLine(p.state)).toEqual({
      tone: 'busy',
      action: null,
      text: { key: 'checking', sentence: sentence(2, 'in_front_of', 0) },
    });
  });

  it('a fit shows the fitting order closest to the one on screen and marks the spots it changes', () => {
    const f = fits(picked(opened().state, 2, 0));
    expect(displayedStacks(f.state)).toEqual(sidesOf(SPOTS_TWO_OVER_ZERO));
    expect(paneMarks(f.state).changed).toEqual(changedSpots([1], [1]));
    expect(addState(f.state)).toEqual({ enabled: true, label: 'add_constraint', sentence: sentence(2, 'in_front_of', 0) });
    // No routine status text: the hint says what a click does now (Round3:1395), and a pick adds or removes (D21).
    expect(hintLine(f.state)).toEqual({ tone: 'quiet', action: null, text: { key: 'more_objects' } });
  });

  it('a sentence the creases alone refuse needs no explaining: the reason names only it', () => {
    const p = picked(opened().state, 2, 3);
    const cant = previewAnswer(p, {
      type: 'previewed',
      request: lastPreviewRequest(p),
      facts: { verdict: 'cant_fit', constraints: [0] },
    });
    expect(effectsOf(cant.effects, 'explain')).toEqual([]);
    expect(hintLine(cant.state)).toEqual({
      tone: 'danger',
      action: null,
      text: { key: 'cant_fit', sentence: sentence(2, 'in_front_of', 3), clashes: [], minimal: true },
    });
    expect(paneMarks(cant.state).danger).toEqual([2, 3]);
    expect(addState(cant.state)).toMatchObject({ enabled: false, why: 'cant_fit' });
    expect(lastOf(cant.effects, 'track').fact).toEqual(constraintBlockedFact(0, 1));
  });

  it('a clash is explained: the sentence’s faces go danger at once, the smallest set and its rows when it arrives', () => {
    const one = withOneConstraint();
    const rowId = one.state.rows.committed[0]!.id;
    const p = picked(one.state, 2, 3);
    const cant = previewAnswer(p, {
      type: 'previewed',
      request: lastPreviewRequest(p),
      facts: { verdict: 'cant_fit', constraints: [0, 1] },
    });
    const explain = lastOf(cant.effects, 'explain');
    expect(explain).toMatchObject({ constraints: [[2, 0, 1], [2, 3, -1]], limits: LAYER_ORDER_LIMITS.explain });
    // Round 4 "A clash being explained".
    expect(hintLine(cant.state)).toEqual({
      tone: 'busy_danger',
      action: null,
      text: { key: 'cant_fit_explaining', sentence: sentence(2, 'in_front_of', 3) },
    });
    expect(paneMarks(cant.state)).toMatchObject({ danger: [2, 3], clashRows: [] });
    expect(lastOf(cant.effects, 'track').fact).toEqual(constraintBlockedFact(1, 1));

    const done = play(cant.state, {
      type: 'explained',
      request: explain.request,
      facts: { verdict: 'clash', constraints: [0, 1], faces: [0, 2, 3], minimal: true },
    });
    expect(paneMarks(done.state)).toMatchObject({ danger: [0, 2, 3], clashRows: [rowId] });
    expect(hintLine(done.state)).toEqual({
      tone: 'danger',
      action: null,
      text: {
        key: 'cant_fit',
        sentence: sentence(2, 'in_front_of', 3),
        clashes: [sentence(2, 'in_front_of', 0)],
        minimal: true,
      },
    });
    expect(rowGroupsView(done.state)[0]).toMatchObject({
      mark: 'clash',
      reason: { key: 'clashes', clashes: [sentence(2, 'in_front_of', 3)] },
    });
    // Pointing at the reason strengthens the tints (Round3:473, 883).
    expect(paneMarks(play(done.state, { type: 'reason_hovered', on: true }).state).dangerStrong).toBe(true);
    // Reported once.
    expect(effectsOf(done.effects, 'track')).toEqual([]);
  });

  it('when explaining runs out, the check’s own set is the reason, not claimed minimal', () => {
    const one = withOneConstraint();
    const p = picked(one.state, 2, 3);
    const cant = previewAnswer(p, {
      type: 'previewed',
      request: lastPreviewRequest(p),
      facts: { verdict: 'cant_fit', constraints: [0, 1] },
    });
    const done = play(cant.state, {
      type: 'explained',
      request: lastOf(cant.effects, 'explain').request,
      facts: { verdict: 'timed_out' },
    });
    expect(hintLine(done.state)?.text).toMatchObject({ key: 'cant_fit', minimal: false, clashes: [sentence(2, 'in_front_of', 0)] });
    expect(hintLine(done.state)?.action).toBe('keep_trying');
    expect(paneMarks(done.state).danger).toEqual([2, 0, 3]);
  });

  it('a preview that ran out says so in the quiet tone, with Keep trying, which checks again later', () => {
    const p = picked(opened().state, 2, 0);
    const out = previewAnswer(p, { type: 'previewed', request: lastPreviewRequest(p), facts: { verdict: 'timed_out' } });
    expect(hintLine(out.state)).toEqual({
      tone: 'quiet',
      action: 'keep_trying',
      text: { key: 'timed_out', sentence: sentence(2, 'in_front_of', 0) },
    });
    const again = dispatch(out.state, { type: 'keep_trying' });
    expect(lastOf(again.effects, 'preview')).toMatchObject({
      constraints: [[2, 0, 1]],
      limits: keepTrying(LAYER_ORDER_LIMITS.preview),
    });
    expect(chosenPreview(again.state)?.kind).toBe('pending');
  });

  it('the verb pointed at in the menu is previewed in place of the sentence’s; Add stands on the sentence’s own', () => {
    const p = picked(opened().state, 2, 0);
    const chosenRequest = lastPreviewRequest(p);
    const pointed = play(p.state, { type: 'verb_pointed', verb: 'behind' });
    expect(lastOf(pointed.effects, 'preview').constraints).toEqual([[2, 0, -1]]);
    const pointedCant = play(pointed.state, {
      type: 'previewed',
      request: lastPreviewRequest(pointed),
      facts: { verdict: 'cant_fit', constraints: [0] },
    });
    expect(displayedPreview(pointedCant.state)?.kind).toBe('cant_fit');
    expect(hintLine(pointedCant.state)?.text.key).toBe('cant_fit');
    // Not the sentence's verb: nothing is blocked yet.
    expect(effectsOf(pointedCant.effects, 'track')).toEqual([]);
    const chosenFits = play(pointedCant.state, {
      type: 'previewed',
      request: chosenRequest,
      facts: { verdict: 'fits', token: 3, changed: changedSpots([1]), stacks: sidesOf(SPOTS_TWO_OVER_ZERO) },
    });
    expect(addState(chosenFits.state).enabled).toBe(true);
    // The menu closes: both are kept for this order, so nothing runs again.
    const closed = play(chosenFits.state, { type: 'verb_pointed', verb: null });
    expect(effectsOf(closed.effects, 'preview')).toEqual([]);
    expect(displayedPreview(closed.state)?.kind).toBe('fits');
    // Picking the verb that can't fit blocks Add, and reports it once.
    const behind = play(closed.state, { type: 'verb_set', verb: 'behind' });
    expect(addState(behind.state)).toMatchObject({ enabled: false, why: 'cant_fit' });
    expect(lastOf(behind.effects, 'track').fact).toEqual(constraintBlockedFact(0, 1));
  });

  it('drops an answer to a preview it no longer waits on', () => {
    const p = picked(opened().state, 2, 0);
    // D21: a second object joins the sentence, which is checked again as a whole.
    const widened = play(p.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    expect(lastOf(widened.effects, 'preview').constraints).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    const stale = play(widened.state, {
      type: 'previewed',
      request: 999,
      facts: { verdict: 'timed_out' },
    });
    expect(stale.state).toBe(widened.state);
  });

  it('runs nothing while a commit is in flight, and catches up when it lands', () => {
    const added = play(fits(picked(opened().state, 2, 0)).state, { type: 'add' });
    const moved = play(added.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    // D21: the pick adds 3 to the sentence Add is committing.
    expect(moved.state.sentence).toMatchObject({ subject: 2, objects: [0, 3] });
    expect(effectsOf(moved.effects, 'preview')).toEqual([]);
    const landed = commits({ state: moved.state, effects: added.effects }, Uint32Array.of(2, 3, 4, 5));
    // A sentence changed since Add is kept, not cleared, less the object Add settled, and previewed now.
    expect(landed.state.sentence).toMatchObject({ subject: 2, objects: [3] });
    expect(lastOf(landed.effects, 'preview').constraints).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('Add (Round3 add, commit)', () => {
  it('commits by the preview’s token, then clears the whole sentence and flashes what changed', () => {
    const f = fits(picked(opened().state, 2, 0), 7);
    const added = play(f.state, { type: 'add' });
    expect(lastOf(added.effects, 'commit')).toMatchObject({
      constraints: [[2, 0, 1]],
      token: 7,
      limits: LAYER_ORDER_LIMITS.commit,
    });
    // It lands when the commit does; until then nothing else changes the list.
    expect(added.state.sentence.subject).toBe(2);
    expect(dispatch(added.state, { type: 'add' }).effects).toEqual([]);
    expect(applyState(added.state)).toEqual({ enabled: false, why: 'busy' });

    const landed = commits(added, Uint32Array.of(2, 3, 4, 5), SPOTS_TWO_OVER_ZERO);
    expect(landed.state.rows.committed.map((row) => row.constraint)).toEqual([[2, 0, 1]]);
    expect(landed.state.sentence).toEqual(EMPTY_SENTENCE);
    expect(landed.state.shown).toEqual(sidesOf(SPOTS_TWO_OVER_ZERO));
    expect(landed.state.flash).toEqual({ changed: changedSpots([1], [1]), n: 1 });
    expect(lastOf(landed.effects, 'flash')).toEqual({ type: 'flash', n: 1 });
    expect(lastOf(landed.effects, 'solutions_restart')).toEqual({
      type: 'solutions_restart',
      generation: 2,
      by: { picture: 'front' },
      count: true,
    });
    expect(lastOf(landed.effects, 'track').fact).toEqual(constraintAddedFact('in_front_of', 'pattern', 'folded', 1));
    expect(listControls(landed.state)).toMatchObject({ undo: true, redo: false, clearAll: true });
  });

  it('the flash fades once', () => {
    const { state } = withOneConstraint();
    expect(dispatch(state, { type: 'flash_ended', n: 0 }).state.flash).not.toBeNull();
    expect(dispatch(state, { type: 'flash_ended', n: 1 }).state.flash).toBeNull();
  });

  it('a commit with no changed spots has nothing to flash', () => {
    const added = play(fits(picked(opened().state, 2, 0)).state, { type: 'add' });
    const landed = commits(added, OPEN_PAIRS, SPOTS, changedSpots());
    expect(landed.state.flash).toBeNull();
    expect(effectsOf(landed.effects, 'flash')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('the constraints list and its history', () => {
  function removedAndLanded(): { one: Played; removed: Played; rowId: number } {
    const one = withOneConstraint();
    const rowId = one.state.rows.committed[0]!.id;
    const asked = play(one.state, trashOf(one.state, rowId));
    return { one, removed: commits(asked, OPEN_PAIRS, SPOTS), rowId };
  }

  it('remove re-solves for the order closest to the one on screen (Round3 removeCons)', () => {
    const one = withOneConstraint();
    const rowId = one.state.rows.committed[0]!.id;
    const asked = play(one.state, trashOf(one.state, rowId));
    expect(lastOf(asked.effects, 'commit')).toMatchObject({ constraints: [], token: null });
    const landed = commits(asked, OPEN_PAIRS, SPOTS, changedSpots([1]));
    expect(landed.state.rows.committed).toEqual([]);
    expect(landed.state.flash?.changed).toEqual(changedSpots([1]));
    // One undo step.
    expect(landed.state.history.past).toHaveLength(one.state.history.past.length + 1);
  });

  it('undo commits the earlier list, never an order, and redo the later (Round3 undo, redo)', () => {
    const { removed, rowId } = removedAndLanded();
    const undo = play(removed.state, { type: 'undo' });
    expect(lastOf(undo.effects, 'commit')).toMatchObject({ constraints: [[2, 0, 1]], token: null });
    const undone = commits(undo, Uint32Array.of(2, 3, 4, 5), SPOTS_TWO_OVER_ZERO);
    expect(undone.state.rows.committed.map((row) => row.id)).toEqual([rowId]);
    expect(undone.state.history.future).toHaveLength(1);
    expect(listControls(undone.state)).toMatchObject({ undo: true, redo: true });

    const redo = play(undone.state, { type: 'redo' });
    expect(lastOf(redo.effects, 'commit')).toMatchObject({ constraints: [] });
    const redone = commits(redo);
    expect(redone.state.rows.committed).toEqual([]);
    expect(listControls(redone.state).redo).toBe(false);
  });

  it('an undo that runs out leaves the list and the history as they were; Keep trying sends it again, later', () => {
    const { removed } = removedAndLanded();
    const undo = play(removed.state, { type: 'undo' });
    const commit = lastOf(undo.effects, 'commit');
    const out = play(undo.state, { type: 'committed', request: commit.request, facts: { verdict: 'timed_out' } });
    expect(out.state.rows).toBe(removed.state.rows);
    expect(out.state.history).toBe(removed.state.history);
    expect(hintLine(out.state)).toEqual({ tone: 'quiet', action: 'keep_trying', text: { key: 'commit_timed_out', via: 'undo' } });
    const again = dispatch(out.state, { type: 'keep_trying' });
    expect(lastOf(again.effects, 'commit')).toMatchObject({
      constraints: [[2, 0, 1]],
      token: null,
      limits: keepTrying(LAYER_ORDER_LIMITS.commit),
    });
  });

  it('Clear all is one entry that undo puts back (Round3 clearAll)', () => {
    const one = withOneConstraint();
    const cleared = commits(play(one.state, { type: 'clear_all' }), OPEN_PAIRS, SPOTS);
    expect(cleared.state.rows).toEqual({ committed: [], carried: [] });
    expect(listControls(cleared.state).clearAll).toBe(false);
    const undone = commits(play(cleared.state, { type: 'undo' }), Uint32Array.of(2, 3, 4, 5));
    expect(undone.state.rows.committed.map((row) => row.constraint)).toEqual([[2, 0, 1]]);
  });

  it('after a remove the builder keeps its sentence unless the object is no longer open (Round3 commit)', () => {
    const one = withOneConstraint(Uint32Array.of(2, 3, 4, 5));
    const built = picked(one.state, 2, 3);
    const removed = commits(play(built.state, trashOf(built.state, one.state.rows.committed[0]!.id)), Uint32Array.of(0, 2, 4, 5));
    expect(removed.state.sentence).toMatchObject({ subject: 2, objects: [] });
    // Undo brings back the sentence that was on screen before the remove, with the list.
    const undone = commits(play(removed.state, { type: 'undo' }), Uint32Array.of(2, 3, 4, 5));
    expect(undone.state.sentence).toMatchObject({ subject: 2, objects: [3] });
  });

  it('a row click puts its subject in the builder; with nothing left to choose the hint says so, quietly', () => {
    const one = withOneConstraint(Uint32Array.of(4, 5));
    const rowId = one.state.rows.committed[0]!.id;
    const clicked = play(one.state, { type: 'row_clicked', key: rowKey(one.state, rowId) });
    expect(clicked.state.sentence).toMatchObject({ subject: 2, subjectOrigin: 'list' });
    expect(paneMarks(clicked.state).active).toBe('subject');
    expect(hintLine(clicked.state)).toEqual({
      tone: 'quiet',
      action: null,
      text: { key: 'subject_stuck', subject: 2, why: 'settled' },
    });
  });

  it('hovering a row lights its two faces', () => {
    const one = withOneConstraint();
    const rowId = one.state.rows.committed[0]!.id;
    const hovered = play(one.state, { type: 'row_hovered', key: rowKey(one.state, rowId) });
    expect(paneMarks(hovered.state)).toMatchObject({ rowFaces: [2, 0], labelled: [2, 0] });
    expect(rowGroupsView(hovered.state)[0]).toMatchObject({ hot: true, mark: 'none', sentence: sentence(2, 'in_front_of', 0) });
  });

  it('rows read from the side shown: turning over reads “behind”', () => {
    const one = withOneConstraint();
    const back = play(one.state, { type: 'side_set', side: 'back' });
    expect(rowGroupsView(back.state)[0]!.sentence).toEqual(sentence(2, 'behind', 0));
  });
});

// ---------------------------------------------------------------------------

describe('the builder through the reducer', () => {
  it('a click on empty paper clears the object, then the subject', () => {
    const p = picked(opened().state, 2, 0);
    const once = play(p.state, { type: 'ground_clicked' });
    expect(once.state.sentence).toMatchObject({ subject: 2, objects: [] });
    expect(play(once.state, { type: 'ground_clicked' }).state.sentence).toMatchObject({ subject: null });
  });

  it('turning over keeps the sentence, which then reads as the other constraint, and drops the flash', () => {
    const one = withOneConstraint();
    const p = picked(one.state, 2, 3);
    const back = play(p.state, { type: 'side_set', side: 'back' });
    expect(back.state.flash).toBeNull();
    expect(lastOf(back.effects, 'preview').constraints).toEqual([
      [2, 0, 1],
      [2, 3, 1],
    ]);
    expect(lastOf(back.effects, 'solutions_position')).toEqual({
      type: 'solutions_position',
      generation: 2,
      by: { picture: 'back' },
    });
  });
});

// ---------------------------------------------------------------------------

describe('restored records: rows by status', () => {
  const AFTER_EDIT = openFactsOf({
    constraints: [[2, 0, 1]],
    restore: {
      outcome: { kind: 'applied' },
      carried: [
        carried({
          index: 2,
          status: { status: 'ambiguous' },
          subject: 4,
          object: 5,
          subjectState: 'ambiguous',
          sign: -1,
          constraint: null,
        }),
        carried({
          index: 3,
          status: { status: 'gone', cause: 'face_gone' },
          subject: null,
          object: 3,
          subjectState: 'gone',
          sign: -1,
          constraint: null,
        }),
      ],
    },
  });

  it('applies the intact rows and shows the others dimmed, each with its reason; a face that is gone has no letter', () => {
    const { state } = opened(AFTER_EDIT, { hasRecord: true });
    const rows = rowGroupsView(state);
    expect(rows.map((row) => [row.kind, row.mark])).toEqual([
      ['committed', 'none'],
      ['carried', 'not_applied'],
      ['carried', 'not_applied'],
    ]);
    expect(rows[1]!.reason).toEqual({ key: 'ambiguous', face: 4 });
    expect(rows[2]!).toMatchObject({
      sentence: sentence(null, 'in_front_of', 3),
      reason: { key: 'face_gone', gone: 'subject', sentence: sentence(null, 'in_front_of', 3) },
    });
    // The builder works as usual.
    expect(hintLine(state)?.text).toEqual({ key: 'pick_face', choosers: 5 });
  });

  it('gives each way a row can be gone its own reason', () => {
    const { state } = opened(
      openFactsOf({
        restore: {
          outcome: { kind: 'applied' },
          carried: [
            carried({ index: 0, status: { status: 'gone', cause: 'same_face' }, subject: 2, object: 2, constraint: null }),
            carried({ index: 1, status: { status: 'gone', cause: 'no_overlap' }, subject: 4, object: 0, constraint: null }),
            carried({
              index: 2,
              status: { status: 'gone', cause: 'face_gone' },
              subject: null,
              object: null,
              subjectState: 'gone',
              objectState: 'gone',
              constraint: null,
            }),
          ],
        },
      }),
      { hasRecord: true }
    );
    expect(rowGroupsView(state).map((row) => [row.mark, row.reason])).toEqual([
      ['not_applied', { key: 'same_face', sentence: sentence(2, 'in_front_of', 2) }],
      ['not_applied', { key: 'no_overlap', sentence: sentence(4, 'in_front_of', 0) }],
      ['not_applied', { key: 'face_gone', gone: 'both', sentence: sentence(null, null, null) }],
    ]);
    // Neither face of the last exists, so nothing lights for it.
    const last = rowKey(state, state.rows.carried[2]!.id);
    expect(paneMarks(play(state, { type: 'row_hovered', key: last }).state).rowFaces).toEqual([]);
  });

  it('pointing at a row not applied lights only its faces that exist and puts its reason in the hint line', () => {
    const { state } = opened(AFTER_EDIT, { hasRecord: true });
    const gone = state.rows.carried[1]!.id;
    const hovered = play(state, { type: 'row_hovered', key: rowKey(state, gone) });
    expect(paneMarks(hovered.state).rowFaces).toEqual([3]);
    expect(hintLine(hovered.state)).toEqual({
      tone: 'quiet',
      action: null,
      text: {
        key: 'row_not_applied',
        reason: { key: 'face_gone', gone: 'subject', sentence: sentence(null, 'in_front_of', 3) },
      },
    });
  });

  it('removing a carried row needs no commit, is an entry undo puts back, and Apply writes back only the rows kept', () => {
    const { state } = opened(AFTER_EDIT, { hasRecord: true });
    const ambiguous = state.rows.carried[0]!.id;
    const removed = play(state, trashOf(state, ambiguous));
    expect(effectsOf(removed.effects, 'commit')).toEqual([]);
    expect(removed.state.rows.carried.map((row) => row.facts.index)).toEqual([3]);
    const undone = play(removed.state, { type: 'undo' });
    expect(effectsOf(undone.effects, 'commit')).toEqual([]);
    expect(undone.state.rows.carried.map((row) => row.facts.index)).toEqual([2, 3]);

    const applied = play(removed.state, { type: 'apply', at: 2_000 });
    expect(lastOf(applied.effects, 'apply').result).toEqual({
      kind: 'changed',
      constraints: [[2, 0, 1]],
      keepCarried: [3],
    });
  });

  describe('a clash after an edit', () => {
    const CLASHING = openFactsOf({
      restore: {
        outcome: { kind: 'clash', constraints: [0, 1] },
        carried: [
          carried({ index: 0, status: { status: 'clashing' }, subject: 2, object: 0, constraint: [2, 0, 1] }),
          carried({ index: 1, status: { status: 'clashing' }, subject: 0, object: 2, constraint: [0, 2, 1] }),
          carried({ index: 2, subject: 4, object: 5, sign: -1, constraint: [4, 5, -1] }),
          carried({
            index: 3,
            status: { status: 'ambiguous' },
            subject: 3,
            object: 2,
            subjectState: 'ambiguous',
            constraint: null,
          }),
        ],
      },
    });

    function clashing(): LayerOrderDialogState {
      return opened(CLASHING, { hasRecord: true }).state;
    }

    it('marks the clashing rows, keeps the builder inert and says what clashes', () => {
      const state = clashing();
      const [first, second, waiting, ambiguous] = state.rows.carried.map((row) => row.id);
      expect(rowGroupsView(state).map((row) => [row.members[0]!.id, row.mark, row.reason?.key])).toEqual([
        [first, 'clash', 'clashes'],
        [second, 'clash', 'clashes'],
        [waiting, 'none', 'waiting'],
        [ambiguous, 'not_applied', 'ambiguous'],
      ]);
      expect(paneMarks(state)).toMatchObject({ danger: [2, 0], pickable: [], clashRows: [first, second] });
      expect(dispatch(state, { type: 'face_picked', face: 2, origin: 'pattern' }).state).toBe(state);
      expect(hintLine(state)).toEqual({
        tone: 'danger',
        action: null,
        text: {
          key: 'attention_clash',
          clashes: [sentence(2, 'in_front_of', 0), sentence(0, 'in_front_of', 2)],
          explaining: false,
        },
      });
      expect(statusView(state)).toEqual({
        dot: 'danger',
        text: { key: 'solutions', count: { n: 0, exact: true } },
        tooltip: null,
        stepper: null,
      });
    });

    it('removing a clashing row re-checks the rows left that can apply, and they land together', () => {
      const state = clashing();
      const [first, second, waiting, ambiguous] = state.rows.carried.map((row) => row.id);
      const removed = play(state, trashOf(state, first!));
      expect(lastOf(removed.effects, 'commit')).toMatchObject({ constraints: [[0, 2, 1], [4, 5, -1]], token: null });
      expect(hintLine(removed.state)).toEqual({ tone: 'busy', action: null, text: { key: 'attention_checking' } });

      const landed = commits(removed, Uint32Array.of(2, 3));
      expect(landed.state.settle).toEqual({ kind: 'settled' });
      expect(landed.state.rows.committed.map((row) => [row.id, row.constraint])).toEqual([
        [second, [0, 2, 1]],
        [waiting, [4, 5, -1]],
      ]);
      expect(landed.state.rows.carried.map((row) => row.id)).toEqual([ambiguous]);
      expect(hintLine(landed.state)?.text.key).toBe('pick_face');

      // The removal and its re-check are one undo step (#539's review): undo brings back the clash, with the
      // row and the order it had, and redo settles the rows again.
      expect(landed.state.history.past.map((entry) => entry.kind)).toEqual(['list']);
      const undo = dispatch(landed.state, { type: 'undo' });
      expect(lastOf(undo.effects, 'commit')).toMatchObject({ constraints: [], order: orderOf(SPOTS) });
      const undone = commits(undo, OPEN_PAIRS, SPOTS);
      expect(undone.state.settle).toEqual({ kind: 'clash', rows: [first, second], explain: null });
      expect(undone.state.rows).toEqual(state.rows);
      expect(applyState(undone.state)).toEqual({ enabled: false, why: 'clash' });
      expect(listControls(undone.state)).toMatchObject({ undo: false, redo: true });
      const redone = commits(play(undone.state, { type: 'redo' }), Uint32Array.of(2, 3));
      expect(redone.state.settle).toEqual({ kind: 'settled' });
      expect(redone.state.rows).toEqual(landed.state.rows);
    });

    it('removing a row outside the clashing set re-checks nothing: the set still clashes', () => {
      const state = clashing();
      const [first, second, , ambiguous] = state.rows.carried.map((row) => row.id);
      const removed = play(state, trashOf(state, ambiguous!));
      expect(effectsOf(removed.effects, 'commit')).toEqual([]);
      expect(removed.state.rows.carried.map((row) => row.id)).not.toContain(ambiguous);
      expect(removed.state.settle).toEqual({ kind: 'clash', rows: [first, second], explain: null });
    });

    it('rows that still clash after a removal are explained again, down to the smallest set', () => {
      const state = clashing();
      const [first, second, waiting] = state.rows.carried.map((row) => row.id);
      const removed = play(state, trashOf(state, first!));
      const commit = lastOf(removed.effects, 'commit');
      expect(commit.constraints).toEqual([[0, 2, 1], [4, 5, -1]]);
      const still = play(removed.state, {
        type: 'committed',
        request: commit.request,
        facts: { verdict: 'cant_fit', constraints: [0, 1] },
      });
      expect(still.state.settle).toMatchObject({ kind: 'clash', rows: [second, waiting] });
      expect(still.state.rows.committed).toEqual([]);
      const explain = lastOf(still.effects, 'explain');
      expect(explain.constraints).toEqual(commit.constraints);
      expect(hintLine(still.state)?.text).toMatchObject({ key: 'attention_clash', explaining: true });

      const done = play(still.state, {
        type: 'explained',
        request: explain.request,
        facts: { verdict: 'clash', constraints: [0], faces: [0, 2], minimal: true },
      });
      expect(done.state.settle).toEqual({ kind: 'clash', rows: [second], explain: null });
      expect(rowGroupsView(done.state).find((row) => row.members[0]!.id === waiting)).toMatchObject({
        mark: 'none',
        reason: { key: 'waiting' },
      });
    });
  });

  describe('a restore that ran out of time', () => {
    const OUT = openFactsOf({
      restore: {
        outcome: { kind: 'timed_out', limit: 'deadline', nodes: 100 },
        carried: [
          carried({ index: 0, subject: 2, object: 0, constraint: [2, 0, 1] }),
          carried({ index: 1, subject: 4, object: 5, sign: -1, constraint: [4, 5, -1] }),
        ],
      },
    });

    it('offers Keep trying, which restores again with a later deadline, keeping the figure on screen', () => {
      const { state } = opened(OUT, { hasRecord: true });
      expect(hintLine(state)).toEqual({ tone: 'quiet', action: 'keep_trying', text: { key: 'attention_timed_out' } });
      expect(rowGroupsView(state).map((row) => row.reason?.key)).toEqual(['waiting', 'waiting']);

      const again = dispatch(state, { type: 'keep_trying' });
      const open = lastOf(again.effects, 'open');
      expect(open).toMatchObject({ how: 'restore', limits: keepTrying(LAYER_ORDER_LIMITS.restore) });
      expect(again.state.phase).toEqual({ kind: 'open' });
      expect(hintLine(again.state)?.text.key).toBe('attention_checking');

      const restored = play(again.state, {
        type: 'opened',
        request: open.request,
        facts: openFactsOf({
          constraints: [[2, 0, 1], [4, 5, -1]],
          restore: { outcome: { kind: 'applied' }, carried: [] },
        }),
      });
      expect(restored.state.settle).toEqual({ kind: 'settled' });
      expect(restored.state.rows.committed.map((row) => row.constraint)).toEqual([[2, 0, 1], [4, 5, -1]]);
      // Opened once, reported once.
      expect(effectsOf(restored.effects, 'track')).toEqual([]);
    });

    it('after a removal, Keep trying retries the re-check, never the restore that would bring the row back', () => {
      const { state } = opened(OUT, { hasRecord: true });
      const removed = play(state, trashOf(state, state.rows.carried[0]!.id));
      const commit = lastOf(removed.effects, 'commit');
      expect(commit.constraints).toEqual([[4, 5, -1]]);
      const out = play(removed.state, { type: 'committed', request: commit.request, facts: { verdict: 'timed_out' } });
      expect(hintLine(out.state)).toEqual({ tone: 'quiet', action: 'keep_trying', text: { key: 'attention_timed_out' } });
      const again = dispatch(out.state, { type: 'keep_trying' });
      expect(effectsOf(again.effects, 'open')).toEqual([]);
      expect(lastOf(again.effects, 'commit')).toMatchObject({
        constraints: [[4, 5, -1]],
        limits: keepTrying(LAYER_ORDER_LIMITS.commit),
      });
      expect(commits({ state: again.state, effects: again.effects }).state.settle).toEqual({ kind: 'settled' });
    });
  });
});

// ---------------------------------------------------------------------------

describe('solutions: the count and the stepper', () => {
  it('nothing is said until the count arrives', () => {
    const { state } = opened();
    expect(statusView(state)).toEqual({ dot: 'open', text: { key: 'none' }, tooltip: null, stepper: null });
  });

  it('a count still running reads “at least N”, steps with the total unfinished, and asks for the next slice', () => {
    const { state } = opened();
    const counting = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(4, 3, 6, false),
      position: position(2, 4, false),
    });
    expect(counting.effects).toEqual([
      // Phase gate 2's slice, from the budgets: 1,000 nodes, 30 ms.
      { type: 'solutions_slice', generation: 1, by: { picture: 'front' }, limits: LAYER_ORDER_COUNT_SLICE },
    ]);
    expect(statusView(counting.state)).toEqual({
      dot: 'open',
      text: { key: 'pictures_and_orders', pictures: { n: 4, exact: false }, orders: { n: 6, exact: false } },
      tooltip: null,
      stepper: {
        index: 2,
        total: { n: 4, exact: false },
        previous: true,
        next: true,
        busy: false,
        waits: { previous: null, next: null },
      },
    });
  });

  it('a finished count stops slicing; the tooltip gives the layer orders only when there are more, exactly', () => {
    const { state } = opened();
    const done = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(9, 9, 12),
      position: position(9, 9),
    });
    expect(done.effects).toEqual([]);
    expect(statusView(done.state)).toMatchObject({
      text: { key: 'pictures_and_orders', pictures: { n: 9, exact: true }, orders: { n: 12, exact: true } },
      tooltip: { orders: 12, hidden: 3 },
      stepper: { index: 9, previous: true, next: false },
    });
    const same = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(9, 9, 9),
      position: position(1, 9),
    });
    expect(statusView(same.state)?.tooltip).toBeNull();
  });

  it('the dot turns to success when a single layer order fits (Round3:200)', () => {
    const { state } = opened();
    const decided = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(1, 1, 1),
      position: position(1, 1),
    });
    expect(statusView(decided.state)).toMatchObject({ dot: 'decided', stepper: { previous: false, next: false } });
  });

  it('a count for another generation is dropped', () => {
    const one = withOneConstraint();
    const stale = dispatch(one.state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(9, 9, 12),
      position: position(1, 9),
    });
    expect(stale.state).toBe(one.state);
    expect(stale.effects).toEqual([]);
  });

  it('the stepper shows another solution: no constraint changes, the previews go, the flash shows what moved', () => {
    const { state } = opened();
    const counted = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(9, 9, 12),
      position: position(2, 9),
    }).state;
    const built = fits(picked(counted, 2, 0));
    const stepping = play(built.state, { type: 'step', direction: 'next' });
    const step = lastOf(stepping.effects, 'step');
    expect(step).toMatchObject({ generation: 1, by: { picture: 'front' }, direction: 'next', limits: LAYER_ORDER_LIMITS.step });
    expect(statusView(stepping.state)?.stepper?.busy).toBe(true);
    expect(addState(stepping.state)).toMatchObject({ enabled: false, why: 'busy' });

    const moved = play(stepping.state, {
      type: 'stepped',
      request: step.request,
      facts: {
        verdict: 'moved',
        changed: changedSpots([0]),
        position: position(3, 9),
        stacks: sidesOf(SPOTS_TWO_OVER_ZERO),
        order: orderOf(SPOTS_TWO_OVER_ZERO),
      },
    });
    expect(moved.state.rows).toBe(built.state.rows);
    expect(moved.state.shown).toEqual(sidesOf(SPOTS_TWO_OVER_ZERO));
    expect(moved.state.flash?.changed).toEqual(changedSpots([0]));
    expect(statusView(moved.state)?.stepper).toMatchObject({ index: 3, busy: false });
    // The sentence is checked again against the stepped order.
    expect(lastOf(moved.effects, 'preview').constraints).toEqual([[2, 0, 1]]);
  });

  it('a step that finds no solution that way stops there', () => {
    const { state } = opened();
    const counting = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(4, 4, 4, false),
      position: position(4, 4, false),
    }).state;
    const stepping = play(counting, { type: 'step', direction: 'next' });
    const ended = play(stepping.state, {
      type: 'stepped',
      request: lastOf(stepping.effects, 'step').request,
      facts: { verdict: 'end' },
    });
    expect(statusView(ended.state)?.stepper).toMatchObject({ previous: true, next: false });
  });

  it('keeps ‹ at 1 until the total is exact: a solution the count lists before the first found may yet be (E9)', () => {
    const { state } = opened();
    const at = (index: number, exact: boolean) =>
      statusView(
        dispatch(state, {
          type: 'solutions_counted',
          generation: 1,
          by: { picture: 'front' },
          count: count(4, 4, 4, exact),
          position: position(index, 4, exact),
        }).state
      )?.stepper;
    expect(at(1, false)).toMatchObject({ index: 1, previous: true, next: true });
    expect(at(1, true)).toMatchObject({ index: 1, previous: false, next: true });
    expect(at(4, true)).toMatchObject({ index: 4, previous: true, next: false });
  });

  it('a ‹ that proves nothing lies before waits there, the total unfinished', () => {
    const { state } = opened();
    const counting = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(4, 4, 4, false),
      position: position(1, 4, false),
    }).state;
    const stepping = play(counting, { type: 'step', direction: 'previous' });
    const ended = play(stepping.state, {
      type: 'stepped',
      request: lastOf(stepping.effects, 'step').request,
      facts: { verdict: 'end' },
    });
    expect(statusView(ended.state)?.stepper).toMatchObject({ index: 1, previous: false, next: true });
  });

  it('a step that runs out says so calmly, and Keep trying steps that way again, later each time (E9)', () => {
    const { state } = opened();
    const counting = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(4, 4, 4, false),
      position: position(2, 4, false),
    }).state;
    const stepping = play(counting, { type: 'step', direction: 'previous' });
    const first = lastOf(stepping.effects, 'step');
    const ranOut = play(stepping.state, { type: 'stepped', request: first.request, facts: { verdict: 'timed_out' } });
    expect(hintLine(ranOut.state)).toEqual({
      tone: 'quiet',
      action: 'keep_trying',
      text: { key: 'step_timed_out', direction: 'previous' },
    });
    // Nothing moved, and the stepper is free.
    expect(statusView(ranOut.state)?.stepper).toMatchObject({ index: 2, previous: true, next: true, busy: false });

    const again = play(ranOut.state, { type: 'keep_trying' });
    const second = lastOf(again.effects, 'step');
    expect(second).toMatchObject({ direction: 'previous', by: { picture: 'front' }, limits: keepTrying(LAYER_ORDER_LIMITS.step) });
    const ranOutAgain = play(again.state, { type: 'stepped', request: second.request, facts: { verdict: 'timed_out' } });
    const third = lastOf(play(ranOutAgain.state, { type: 'keep_trying' }).effects, 'step');
    expect(third.limits).toEqual(keepTrying(keepTrying(LAYER_ORDER_LIMITS.step)));
  });

  it('a step that ran out gives the hint line back to a sentence under way', () => {
    const { state } = opened();
    const counting = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(4, 4, 4, false),
      position: position(2, 4, false),
    }).state;
    const stepping = play(counting, { type: 'step', direction: 'next' });
    const ranOut = play(stepping.state, {
      type: 'stepped',
      request: lastOf(stepping.effects, 'step').request,
      facts: { verdict: 'timed_out' },
    });
    expect(hintLine(ranOut.state)?.text).toEqual({ key: 'step_timed_out', direction: 'next' });
    const building = play(ranOut.state, { type: 'face_picked', face: 2, origin: 'pattern' });
    expect(hintLine(building.state)?.text.key).not.toBe('step_timed_out');
  });

  /** A press of ‹ or › from `from`, answered `verdict`. */
  function pressed(from: LayerOrderDialogState, direction: 'next' | 'previous', verdict: 'end' | 'timed_out'): Played {
    const stepping = play(from, { type: 'step', direction });
    return play(stepping.state, { type: 'stepped', request: lastOf(stepping.effects, 'step').request, facts: { verdict } });
  }

  /** `state` counted at `index` of `n`, the count unfinished. */
  function countingAt(state: LayerOrderDialogState, index: number, n: number): LayerOrderDialogState {
    return dispatch(state, {
      type: 'solutions_counted',
      generation: state.solutions.generation,
      by: { picture: 'front' },
      count: count(n, n, n, false),
      position: position(index, n, false),
    }).state;
  }

  it('a step that runs out while a sentence is under way is the newest on the line, until the next pick or Clear', () => {
    const subject = play(countingAt(opened().state, 2, 4), { type: 'face_picked', face: 2, origin: 'pattern' });
    expect(hintLine(subject.state)?.text.key).not.toBe('step_timed_out');
    const ranOut = pressed(subject.state, 'next', 'timed_out');
    expect(hintLine(ranOut.state)).toEqual({ tone: 'quiet', action: 'keep_trying', text: { key: 'step_timed_out', direction: 'next' } });
    // Pointing at a face doesn't take the line from it.
    expect(hintLine(play(ranOut.state, { type: 'face_hovered', face: 3 }).state)?.text.key).toBe('step_timed_out');
    // The next pick does, for good: a Clear later never brings the message back.
    const object = play(ranOut.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    expect(object.state.solutions.step).toEqual({ kind: 'idle' });
    expect(hintLine(object.state)?.text.key).not.toBe('step_timed_out');
    const cleared = play(object.state, { type: 'sentence_cleared' });
    expect(hintLine(cleared.state)?.text.key).not.toBe('step_timed_out');
    // A Clear lets it go as well.
    expect(play(ranOut.state, { type: 'sentence_cleared' }).state.solutions.step).toEqual({ kind: 'idle' });
  });

  it('a step that ran out lets the line go to a verb changed too: the sentence’s check is said', () => {
    const subject = play(countingAt(opened().state, 2, 4), { type: 'face_picked', face: 2, origin: 'pattern' });
    const sentence = play(subject.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    const ranOut = pressed(sentence.state, 'next', 'timed_out');
    expect(hintLine(ranOut.state)?.text.key).toBe('step_timed_out');
    const verb = ranOut.state.sentence.verb === 'behind' ? 'in_front_of' : 'behind';
    const changed = play(ranOut.state, { type: 'verb_set', verb });
    expect(changed.state.sentence.verb).toBe(verb);
    expect(changed.state.solutions.step).toEqual({ kind: 'idle' });
    // The changed sentence is checked, and the line says so rather than the step's old news.
    expect(lastOf(changed.effects, 'preview')).toBeDefined();
    expect(hintLine(changed.state)).toMatchObject({ tone: 'busy', text: { key: 'checking' } });
  });

  it('keeps both ends a step proved from the order on screen: neither undoes the other (E9)', () => {
    const counting = countingAt(opened().state, 1, 1);
    const back = pressed(counting, 'previous', 'end').state;
    expect(statusView(back)?.stepper).toMatchObject({ previous: false, next: true, waits: { previous: 'first', next: null } });
    // A › that runs out proves nothing, and takes nothing back.
    const ranOut = pressed(back, 'next', 'timed_out').state;
    expect(statusView(ranOut)?.stepper).toMatchObject({ previous: false, next: true });
    // A › that ends: both wait, the one solution there is, though the count is unfinished.
    const both = pressed(ranOut, 'next', 'end').state;
    expect(both.solutions.ended).toEqual({ previous: true, next: true });
    expect(statusView(both)?.stepper).toMatchObject({ previous: false, next: false, waits: { previous: 'only', next: 'only' } });
    // A slice of the count read at the same place keeps them.
    expect(countingAt(both, 1, 1).solutions.ended).toEqual({ previous: true, next: true });
  });

  it('keeps a proved end through the count’s slices, though the index moves as it finds solutions before (E9)', () => {
    const last = pressed(countingAt(opened().state, 5, 5), 'next', 'end').state;
    expect(statusView(last)?.stepper?.next).toBe(false);
    // The count finds three more, all before the order on screen: its index moves to 8, and › stays proved.
    const later = countingAt(last, 8, 8);
    expect(later.solutions.ended).toEqual({ previous: false, next: true });
    expect(statusView(later)?.stepper).toMatchObject({ index: 8, next: false, waits: { next: 'last' } });
    // And again on the next slice.
    expect(statusView(countingAt(later, 11, 11))?.stepper?.next).toBe(false);
  });

  it('keeps an end proved by a step that ran while the figure turned over and back, once its reads arrive', () => {
    const at = countingAt(opened().state, 5, 5);
    const stepping = play(at, { type: 'step', direction: 'next' });
    // Turned over and straight back while it ran: the stepper steps by the front again, its position read anew.
    const turned = play(stepping.state, { type: 'side_set', side: 'back' }, { type: 'side_set', side: 'front' });
    const ended = play(turned.state, {
      type: 'stepped',
      request: lastOf(stepping.effects, 'step').request,
      facts: { verdict: 'end' },
    }).state;
    expect(ended.solutions.ended).toEqual({ previous: false, next: true });
    // The reads asked by the turns land, the back's late: the front's proof stays.
    const backRead = dispatch(ended, {
      type: 'solutions_positioned',
      generation: ended.solutions.generation,
      by: { picture: 'back' },
      position: position(2, 5, false),
    }).state;
    const frontRead = dispatch(backRead, {
      type: 'solutions_positioned',
      generation: ended.solutions.generation,
      by: { picture: 'front' },
      position: position(5, 5, false),
    }).state;
    expect(frontRead.solutions.ended).toEqual({ previous: false, next: true });
    expect(statusView(frontRead)?.stepper?.next).toBe(false);
  });

  it('lets proved ends go when the order moves, or is stepped by something else', () => {
    const back = pressed(countingAt(opened().state, 2, 4), 'previous', 'end');
    expect(back.state.solutions.ended).toEqual({ previous: true, next: false });
    // Moved: another order, nothing proved of it.
    const stepping = play(back.state, { type: 'step', direction: 'next' });
    const moved = play(stepping.state, {
      type: 'stepped',
      request: lastOf(stepping.effects, 'step').request,
      facts: {
        verdict: 'moved',
        changed: changedSpots([0]),
        position: position(3, 4, false),
        stacks: sidesOf(SPOTS_TWO_OVER_ZERO),
        order: orderOf(SPOTS_TWO_OVER_ZERO),
      },
    });
    expect(moved.state.solutions.ended).toEqual({ previous: false, next: false });
    expect(statusView(moved.state)?.stepper?.previous).toBe(true);
    // X-ray: steps by every layer order now.
    expect(play(back.state, { type: 'xray_set', on: true }).state.solutions.ended).toEqual({ previous: false, next: false });
  });

  it('holds Keep trying back while a change to the list is in the worker, and ‹ › name no end then', () => {
    const one = withOneConstraint();
    const ranOut = pressed(countingAt(one.state, 2, 4), 'next', 'timed_out');
    const removing = play(ranOut.state, { type: 'clear_all' });
    expect(removing.state.commit.kind).toBe('pending');
    // Keep trying could ask nothing yet: the message stays, without it.
    expect(hintLine(removing.state)).toEqual({ tone: 'quiet', action: null, text: { key: 'step_timed_out', direction: 'next' } });
    expect(play(removing.state, { type: 'keep_trying' }).effects).toEqual([]);
    // Both wait for the check, at no end: neither says "This is the first solution".
    expect(statusView(removing.state)?.stepper).toMatchObject({
      previous: false,
      next: false,
      waits: { previous: null, next: null },
    });
  });
});

// ---------------------------------------------------------------------------

describe('Apply and Cancel (spec §6.8)', () => {
  it('Apply hands the host the constraints and the order on screen, and closes', () => {
    const one = withOneConstraint();
    const applied = play(one.state, { type: 'apply', at: 5_000 });
    expect(lastOf(applied.effects, 'apply').result).toEqual({ kind: 'changed', constraints: [[2, 0, 1]], keepCarried: [] });
    expect(lastOf(applied.effects, 'track').fact).toEqual(dialogClosedFact('applied', 1, 'pending', 4_000));
    expect(applied.state.phase).toEqual({ kind: 'closed', outcome: 'applied' });
  });

  it('Cancel hands the host nothing', () => {
    const one = withOneConstraint();
    const cancelled = play(one.state, { type: 'cancel', at: 4_000 });
    expect(effectsOf(cancelled.effects, 'apply')).toEqual([]);
    expect(lastOf(cancelled.effects, 'close')).toEqual({ type: 'close' });
    expect(lastOf(cancelled.effects, 'track').fact).toEqual(dialogClosedFact('cancelled', 1, 'pending', 3_000));
  });

  it('Cancel while opening closes without a closed event: the dialog never opened', () => {
    const start = initLayerOrderDialog(INIT);
    const cancelled = play(start.state, { type: 'cancel', at: 2_000 });
    expect(cancelled.effects).toEqual([{ type: 'close' }]);
  });

  it('an untouched Apply is closed as unchanged (D16)', () => {
    const applied = play(opened().state, { type: 'apply', at: 5_000 });
    expect(lastOf(applied.effects, 'apply').result).toEqual({ kind: 'no_change' });
    expect(lastOf(applied.effects, 'apply').turnDeg).toBeNull();
    expect(lastOf(applied.effects, 'track').fact).toEqual(dialogClosedFact('unchanged', 0, 'pending', 4_000));
  });
});

describe('Rotate (the folded pane’s turn, 2026-10-27)', () => {
  it('opens at the host’s turn and turns 15° a press, the host’s way from its side', () => {
    const start = opened(undefined, { side: 'front', turnDeg: 350 });
    expect(start.state.view.turnDeg).toBe(350);
    // Right is clockwise as seen: from the host's side, the host's way.
    expect(play(start.state, { type: 'turned', direction: 'right' }).state.view.turnDeg).toBe(5);
    expect(play(start.state, { type: 'turned', direction: 'left' }).state.view.turnDeg).toBe(335);
  });

  it('from the other side a press turns the host’s turn the other way, as the pane draws it', () => {
    const back = play(opened(undefined, { side: 'front', turnDeg: 30 }).state, { type: 'side_set', side: 'back' });
    const right = play(back.state, { type: 'turned', direction: 'right' });
    // Seen from the back the pane is turned 330°; Right makes it 345°, the host's 15°.
    expect(right.state.view.turnDeg).toBe(15);
    expect(paneTurnDeg(right.state.view.turnDeg, 'front', 'back')).toBe(345);
    // Turned back over, the host sees its own 15°.
    expect(paneTurnDeg(play(right.state, { type: 'side_set', side: 'front' }).state.view.turnDeg, 'front', 'front')).toBe(15);
  });

  it('is a view action: nothing goes on the history and nothing is asked of the engine', () => {
    const one = withOneConstraint();
    const turned = layerOrderReducer(one.state, { type: 'turned', direction: 'right' });
    expect(turned.effects).toEqual([]);
    expect(turned.state.history).toBe(one.state.history);
    // An undo moves the list, never the turn.
    expect(play(turned.state, { type: 'undo' }).state.view.turnDeg).toBe(15);
  });

  it('a turn alone writes no record: Apply is unchanged, with the turn, and counted as rotated', () => {
    const turned = play(opened(undefined, { turnDeg: 90 }).state, { type: 'turned', direction: 'left' });
    const applied = play(turned.state, { type: 'apply', at: 5_000 });
    expect(lastOf(applied.effects, 'apply')).toEqual({ type: 'apply', result: { kind: 'no_change' }, turnDeg: 75 });
    expect(lastOf(applied.effects, 'track').fact).toEqual(dialogClosedFact('unchanged', 0, 'pending', 4_000, null, true));
  });

  it('Apply hands the turn with the order, and none once turned back to the host’s', () => {
    const one = withOneConstraint();
    const right = play(one.state, { type: 'turned', direction: 'right' });
    expect(lastOf(play(right.state, { type: 'apply', at: 5_000 }).effects, 'apply')).toMatchObject({
      result: { kind: 'changed' },
      turnDeg: 15,
    });
    const back = play(right.state, { type: 'turned', direction: 'left' });
    const applied = play(back.state, { type: 'apply', at: 5_000 });
    expect(lastOf(applied.effects, 'apply').turnDeg).toBeNull();
    expect(lastOf(applied.effects, 'track').fact).toEqual(dialogClosedFact('applied', 1, 'pending', 4_000));
    // A whole turn round is the host's turn too.
    let round = one.state;
    for (let press = 0; press < 24; press += 1) round = play(round, { type: 'turned', direction: 'right' }).state;
    expect(lastOf(play(round, { type: 'apply', at: 5_000 }).effects, 'apply').turnDeg).toBeNull();
  });

  it('Cancel hands back no turn, and says it was rotated', () => {
    const turned = play(withOneConstraint().state, { type: 'turned', direction: 'right' });
    const cancelled = play(turned.state, { type: 'cancel', at: 4_000 });
    expect(effectsOf(cancelled.effects, 'apply')).toEqual([]);
    expect(lastOf(cancelled.effects, 'track').fact).toEqual(dialogClosedFact('cancelled', 1, 'pending', 3_000, null, true));
  });

  it('closing on a refused open says refused, with the refusal’s code and nothing of its details', () => {
    const start = initLayerOrderDialog(INIT);
    const refused = play(start.state, {
      type: 'open_refused',
      request: 1,
      refusal: { code: 'source_non_convex_face', face: 3 },
    });
    const closed = play(refused.state, { type: 'cancel', at: 3_000 });
    expect(lastOf(closed.effects, 'track').fact).toEqual(dialogClosedFact('refused', 0, 'pending', 2_000, 'source_non_convex_face'));
    expect(JSON.stringify(lastOf(closed.effects, 'track').fact)).not.toContain('"face"');
  });

  it('closing on an engine that stopped says crashed, opened or not', () => {
    const lostOpen = play(opened().state, { type: 'engine_lost' }, { type: 'cancel', at: 4_000 });
    expect(lastOf(lostOpen.effects, 'track').fact).toEqual(dialogClosedFact('crashed', 0, 'pending', 3_000));
    const lostOpening = play(initLayerOrderDialog(INIT).state, { type: 'engine_lost' }, { type: 'cancel', at: 2_000 });
    expect(lastOf(lostOpening.effects, 'track').fact).toEqual(dialogClosedFact('crashed', 0, 'pending', 1_000));
  });

  it('closing on an engine the browser couldn’t load says unavailable, not crashed', () => {
    const unloaded = play(initLayerOrderDialog(INIT).state, { type: 'engine_lost', unavailable: true }, { type: 'cancel', at: 2_000 });
    expect(lastOf(unloaded.effects, 'track').fact).toEqual(dialogClosedFact('unavailable', 0, 'pending', 1_000));
  });

  it('Try again after a loss opens with the limits the session last opened with, Keep trying’s included', () => {
    const start = initLayerOrderDialog(INIT);
    const first = lastOf(start.effects, 'open');
    const ranOut = play(start.state, {
      type: 'open_refused',
      request: first.request,
      refusal: { code: 'session_timed_out', limit: 'deadline', nodes: 4 },
    });
    const again = play(ranOut.state, { type: 'keep_trying' });
    const asked = lastOf(again.effects, 'open');
    expect(asked.limits).toEqual(keepTrying(first.limits));
    const reopened = play(
      again.state,
      { type: 'opened', request: asked.request, facts: openFactsOf() },
      { type: 'engine_lost' },
      { type: 'retry_open' }
    );
    expect(lastOf(reopened.effects, 'open').limits).toEqual(asked.limits);
  });

  it('once closed, nothing more happens', () => {
    const closed = play(opened().state, { type: 'cancel', at: 2_000 }).state;
    const late = dispatch(closed, { type: 'face_picked', face: 2, origin: 'pattern' });
    expect(late.state).toBe(closed);
    expect(late.effects).toEqual([]);
  });

  it('the closed event buckets the count of the side shown', () => {
    const { state } = opened();
    const counted = dispatch(state, {
      type: 'solutions_counted',
      generation: 1,
      by: { picture: 'front' },
      count: count(9, 4, 12),
      position: position(1, 9),
    }).state;
    const applied = play(counted, { type: 'apply', at: 2_000 });
    expect(lastOf(applied.effects, 'track').fact).toMatchObject({ properties: { solutions_bucket: '<=10' } });
  });
});
