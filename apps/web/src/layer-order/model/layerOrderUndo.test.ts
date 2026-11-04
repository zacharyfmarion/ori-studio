/**
 * Every inspector action is one undo step (`implementation-plans/layer-order-dialog.md`,
 * "The inspector's behaviour"; your words, 2026-10-26: "cmd + z should undo
 * adding a single constraint or setting the subject (so basically any
 * action)"). An edit to the sentence comes back with no engine call; a change
 * to the list commits again and brings back the sentence that was on screen
 * before it; a solution step steps back. View toggles are no step.
 *
 * The fixture figure's faces read A to G by number; A–C, C–D and E–F are open.
 */
import { describe, expect, it } from 'vitest';
import { LAYER_ORDER_LIMITS } from './layerOrderEngineFacts';
import {
  OPEN_PAIRS,
  SPOTS,
  SPOTS_TWO_OVER_ZERO,
  carried,
  commits,
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
  steps,
  trashOf,
  withOneConstraint,
  type Played,
} from './layerOrderModel.fixtures';
import { hintLine, listControls } from './layerOrderSelectors';
import type { LayerOrderAction, LayerOrderDialogState } from './layerOrderState';

/** What the sentence says: the subject, the verb and the objects. */
const says = (state: LayerOrderDialogState) => {
  const { subject, verb, objects } = state.sentence;
  return { subject, verb, objects };
};

/** No engine call but, at most, a preview the sentence had not had. */
function enginesQuiet(played: Played) {
  expect(effectsOf(played.effects, 'commit')).toEqual([]);
  expect(effectsOf(played.effects, 'step')).toEqual([]);
}

/** A step answered as moving the order on screen to `spots`. */
const moved = (played: Played, spots = SPOTS_TWO_OVER_ZERO, at = position(2, 9)): Played => steps(played, spots, at);

// ---------------------------------------------------------------------------

describe('the sentence’s edits', () => {
  it('are a step each, undone and redone with no engine call, back to an empty sentence and forward again', () => {
    const walk: LayerOrderAction[] = [
      { type: 'face_picked', face: 2, origin: 'pattern' }, // the subject, C
      { type: 'face_picked', face: 0, origin: 'folded' }, // an object, A
      { type: 'face_picked', face: 3, origin: 'menu' }, // another, D
      { type: 'verb_set', verb: 'behind' },
      { type: 'object_removed', face: 0 }, // a builder chip's click
      { type: 'face_picked', face: 3, origin: 'pattern' }, // the same face again removes it
      { type: 'face_picked', face: 0, origin: 'pattern' },
      { type: 'slot_cleared', slot: 'object' }, // the object slot's ×
      { type: 'slot_cleared', slot: 'subject' }, // the subject slot's ×
    ];
    const seen = [opened().state];
    for (const action of walk) seen.push(dispatch(seen.at(-1)!, action).state);
    const end = seen.at(-1)!;
    expect(end.history.past).toHaveLength(walk.length);
    expect(end.history.past.every((entry) => entry.kind === 'sentence')).toBe(true);

    let now = end;
    for (let i = walk.length - 1; i >= 0; i -= 1) {
      const undone = dispatch(now, { type: 'undo' });
      enginesQuiet(undone);
      // Every sentence on the way was checked when it was built: its preview is known, so nothing is asked.
      expect(effectsOf(undone.effects, 'preview')).toEqual([]);
      expect(says(undone.state)).toEqual(says(seen[i]!));
      now = undone.state;
    }
    expect(listControls(now)).toMatchObject({ undo: false, redo: true });
    for (let i = 1; i <= walk.length; i += 1) {
      const redone = dispatch(now, { type: 'redo' });
      enginesQuiet(redone);
      expect(says(redone.state)).toEqual(says(seen[i]!));
      now = redone.state;
    }
    expect(listControls(now)).toMatchObject({ undo: true, redo: false });
  });

  it('a new edit after an undo drops what redo had', () => {
    const p = picked(opened().state, 2, 0);
    const undone = dispatch(p.state, { type: 'undo' });
    expect(listControls(undone.state).redo).toBe(true);
    const other = dispatch(undone.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    expect(other.state.history.future).toEqual([]);
    expect(says(other.state)).toMatchObject({ subject: 2, objects: [3] });
  });

  it('Clear, a click on empty paper and a row click are steps too', () => {
    const one = withOneConstraint();
    const s = picked(one.state, 2, 3).state;
    for (const action of [
      { type: 'sentence_cleared' },
      { type: 'ground_clicked' },
      { type: 'row_clicked', key: rowKey(s, s.rows.committed[0]!.id) },
    ] as const) {
      const done = dispatch(s, action);
      expect(says(done.state)).not.toEqual(says(s));
      expect(done.state.history.past).toHaveLength(s.history.past.length + 1);
      const undone = dispatch(done.state, { type: 'undo' });
      enginesQuiet(undone);
      expect(says(undone.state)).toEqual(says(s));
    }
  });

  it('which slot is active, and a pick that changes nothing, are no step', () => {
    const s = picked(opened().state, 2, 0).state;
    const active = dispatch(s, { type: 'slot_activated', slot: 'subject' });
    expect(active.state.history).toBe(s.history);
    // The subject picked again keeps its object: the sentence says the same.
    expect(dispatch(active.state, { type: 'face_picked', face: 2, origin: 'pattern' }).state.history).toBe(s.history);
    // A face with nothing to choose is inert.
    expect(dispatch(active.state, { type: 'face_picked', face: 6, origin: 'pattern' }).state.history).toBe(s.history);
    expect(dispatch(s, { type: 'verb_set', verb: 'in_front_of' }).state.history).toBe(s.history);
  });

  it('a sentence brought back previews again when the list has changed since its preview', () => {
    // C in front of A is added; E in front of F is built and fits.
    const built = fits(picked(withOneConstraint().state, 4, 5));
    // Back past the Add (the two picks, then the Add's commit), and forward again.
    const back = commits(play(built.state, { type: 'undo' }, { type: 'undo' }, { type: 'undo' }), OPEN_PAIRS);
    expect(back.state.rows.committed).toEqual([]);
    const forward = commits(play(back.state, { type: 'redo' }), Uint32Array.of(2, 3, 4, 5));
    const again = play(forward.state, { type: 'redo' }, { type: 'redo' });
    enginesQuiet(again);
    expect(says(again.state)).toMatchObject({ subject: 4, objects: [5] });
    expect(lastOf(again.effects, 'preview')).toMatchObject({
      constraints: [
        [2, 0, 1],
        [4, 5, -1],
      ],
      limits: LAYER_ORDER_LIMITS.preview,
    });
  });
});

// ---------------------------------------------------------------------------

describe('changes to the list', () => {
  it('Add is one step: undo commits the list before it and brings back its sentence, which previews again', () => {
    const f = fits(picked(opened().state, 2, 0));
    const added = commits(play(f.state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5), SPOTS_TWO_OVER_ZERO);
    expect(added.state.history.past.map((entry) => entry.kind)).toEqual(['sentence', 'sentence', 'list']);

    const undo = dispatch(added.state, { type: 'undo' });
    expect(lastOf(undo.effects, 'commit')).toMatchObject({ constraints: [], token: null });
    // The sentence waits for the list: it comes back when the commit lands.
    expect(says(undo.state)).toMatchObject({ subject: null });
    const undone = commits(undo, OPEN_PAIRS, SPOTS);
    expect(undone.state.rows.committed).toEqual([]);
    expect(says(undone.state)).toEqual({ subject: 2, verb: 'in_front_of', objects: [0] });
    expect(lastOf(undone.effects, 'preview').constraints).toEqual([[2, 0, 1]]);

    const redone = commits(play(undone.state, { type: 'redo' }), Uint32Array.of(2, 3, 4, 5), SPOTS_TWO_OVER_ZERO);
    expect(redone.state.rows.committed.map((row) => row.id)).toEqual(added.state.rows.committed.map((row) => row.id));
    expect(says(redone.state)).toMatchObject({ subject: null, objects: [] });
  });

  it('a row’s trash and Clear all are one step each, and undo brings back the list and the sentence on screen', () => {
    const one = withOneConstraint();
    const s = picked(one.state, 4, 5).state;
    for (const action of [trashOf(s, s.rows.committed[0]!.id), { type: 'clear_all' } as const]) {
      const done = commits(play(s, action), OPEN_PAIRS, SPOTS);
      expect(done.state.rows.committed).toEqual([]);
      expect(done.state.history.past).toHaveLength(s.history.past.length + 1);
      const undone = commits(play(done.state, { type: 'undo' }), Uint32Array.of(2, 3, 4, 5));
      expect(undone.state.rows.committed.map((row) => row.constraint)).toEqual([[2, 0, 1]]);
      expect(says(undone.state)).toEqual(says(s));
    }
  });

  it('carried rows come back at once: the order never depended on them', () => {
    const facts = openFactsOf({
      restore: {
        outcome: { kind: 'applied' },
        carried: [carried({ index: 0, status: { status: 'gone', cause: 'no_overlap' }, subject: 4, object: 0, constraint: null })],
      },
    });
    const { state } = opened(facts, { hasRecord: true });
    const s = play(state, { type: 'face_picked', face: 2, origin: 'pattern' }).state;
    const cleared = play(s, { type: 'clear_all' });
    enginesQuiet(cleared);
    const undone = dispatch(cleared.state, { type: 'undo' });
    enginesQuiet(undone);
    expect(undone.state.rows.carried.map((row) => row.facts.index)).toEqual([0]);
    expect(says(undone.state)).toEqual(says(s));
  });

  it('an edit to the sentence while a commit is in flight goes on top of it once it lands', () => {
    // Add C in front of A, and pick D while it lands.
    const f = fits(picked(opened().state, 2, 0));
    const add = play(f.state, { type: 'add' });
    const picking = play(add.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    const landed = commits({ state: picking.state, effects: add.effects }, Uint32Array.of(2, 3, 4, 5));
    expect(landed.state.history.past.map((entry) => entry.kind)).toEqual(['sentence', 'sentence', 'list', 'sentence']);
    expect(says(landed.state)).toMatchObject({ subject: 2, objects: [3] });
    // The pick comes off first, with no engine call; A is settled now, so it does not come back.
    const pickUndone = dispatch(landed.state, { type: 'undo' });
    enginesQuiet(pickUndone);
    expect(says(pickUndone.state)).toMatchObject({ subject: 2, objects: [] });
    // Then the Add.
    expect(lastOf(dispatch(pickUndone.state, { type: 'undo' }).effects, 'commit').constraints).toEqual([]);
  });

  it('an edit while an undo is in flight stays, and drops what redo had', () => {
    const one = withOneConstraint();
    const undo = play(one.state, { type: 'undo' });
    const picking = play(undo.state, { type: 'face_picked', face: 4, origin: 'pattern' });
    const landed = commits({ state: picking.state, effects: undo.effects }, OPEN_PAIRS);
    expect(landed.state.rows.committed).toEqual([]);
    // The sentence the undo would bring back is older than the pick, which stays.
    expect(says(landed.state)).toMatchObject({ subject: 4, objects: [] });
    expect(landed.state.history.future).toEqual([]);
    expect(landed.state.history.past.map((entry) => entry.kind)).toEqual(['sentence', 'sentence', 'sentence']);
  });

  it('an undo of the sentence lets go of a commit that ran out: Keep trying no longer applies', () => {
    const one = withOneConstraint();
    const s = play(one.state, { type: 'face_picked', face: 4, origin: 'pattern' }).state;
    const removing = play(s, trashOf(s, s.rows.committed[0]!.id));
    const out = play(removing.state, {
      type: 'committed',
      request: lastOf(removing.effects, 'commit').request,
      facts: { verdict: 'timed_out' },
    });
    expect(hintLine(out.state)?.action).toBe('keep_trying');
    // The list is as it was, and so is the history: undo takes back the pick, and the stalled remove with it.
    expect(out.state.history).toBe(s.history);
    const undone = dispatch(out.state, { type: 'undo' });
    enginesQuiet(undone);
    expect(undone.state.commit).toEqual({ kind: 'idle' });
    expect(says(undone.state)).toMatchObject({ subject: null });
    expect(effectsOf(dispatch(undone.state, { type: 'keep_trying' }).effects, 'commit')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('solution steps: undo and redo put the exact order back (#539’s review)', () => {
  const OPENING = orderOf(SPOTS);
  const STEPPED = orderOf(SPOTS_TWO_OVER_ZERO);

  it('a step is one step: undo puts back the order it left, redo the one it landed on, and the count goes on', () => {
    const stepped = moved(play(opened().state, { type: 'step', direction: 'next' }));
    expect(stepped.state.shownOrder).toEqual(STEPPED);
    expect(stepped.state.history.past).toEqual([{ kind: 'step', order: OPENING }]);

    // Turned over: no step. Undo puts the very order back, with the list as it is, no relative step.
    const back = play(stepped.state, { type: 'side_set', side: 'back' });
    expect(back.state.history).toBe(stepped.state.history);
    const undo = dispatch(back.state, { type: 'undo' });
    expect(lastOf(undo.effects, 'commit')).toMatchObject({ constraints: [], token: null, order: OPENING });
    expect(effectsOf(undo.effects, 'step')).toEqual([]);
    // It waits for the engine: nothing else undoes or redoes meanwhile.
    expect(undo.state.history).toBe(back.state.history);
    expect(listControls(undo.state)).toMatchObject({ undo: false, redo: false });
    expect(dispatch(undo.state, { type: 'undo' }).effects).toEqual([]);
    const undone = commits(undo, OPEN_PAIRS, SPOTS);
    expect(undone.state.shown).toEqual(sidesOf(SPOTS));
    expect(undone.state.shownOrder).toEqual(OPENING);
    expect(undone.state.history).toEqual({ past: [], future: [{ kind: 'step', order: STEPPED }] });
    // The list did not change: the count and its cursor go on, and the position is read again for the side shown.
    expect(undone.state.solutions.generation).toBe(stepped.state.solutions.generation);
    expect(effectsOf(undone.effects, 'solutions_restart')).toEqual([]);
    expect(lastOf(undone.effects, 'solutions_position')).toMatchObject({ by: { picture: 'back' } });
    expect(undone.state.flash).not.toBeNull();

    const redo = dispatch(undone.state, { type: 'redo' });
    expect(lastOf(redo.effects, 'commit')).toMatchObject({ constraints: [], order: STEPPED });
    const redone = commits(redo, OPEN_PAIRS, SPOTS_TWO_OVER_ZERO);
    expect(redone.state.shownOrder).toEqual(STEPPED);
    expect(redone.state.history).toEqual({ past: [{ kind: 'step', order: OPENING }], future: [] });
  });

  it('› then Add then ⌘Z ×4 puts back each order exactly, to the opening, which Apply calls unchanged (D16)', () => {
    const stepped = moved(play(opened().state, { type: 'step', direction: 'next' }));
    const added = commits(play(fits(picked(stepped.state, 2, 3)).state, { type: 'add' }), Uint32Array.of(0, 2, 4, 5), SPOTS);
    expect(added.state.shownOrder).toEqual(OPENING);
    // The Add, with the order the step left; then the two picks, with no engine call.
    const undoAdd = dispatch(added.state, { type: 'undo' });
    expect(lastOf(undoAdd.effects, 'commit')).toMatchObject({ constraints: [], order: STEPPED });
    const picks = play(commits(undoAdd, OPEN_PAIRS, SPOTS_TWO_OVER_ZERO).state, { type: 'undo' }, { type: 'undo' });
    enginesQuiet(picks);
    expect(picks.state.history.past).toEqual([{ kind: 'step', order: OPENING }]);
    // The step: the opening order, never `end`, never another picture.
    const undoStep = dispatch(picks.state, { type: 'undo' });
    expect(lastOf(undoStep.effects, 'commit')).toMatchObject({ constraints: [], order: OPENING });
    const opening = commits(undoStep, OPEN_PAIRS, SPOTS);
    expect(opening.state.history.past).toEqual([]);
    expect(opening.state.shown).toEqual(sidesOf(SPOTS));
    expect(lastOf(dispatch(opening.state, { type: 'apply', at: 2_000 }).effects, 'apply').result).toEqual({ kind: 'no_change' });
  });

  it('turning over or X-ray while a step runs keeps it running: its answer lands, and the position is read again', () => {
    const stepping = play(opened().state, { type: 'step', direction: 'next' });
    for (const view of [{ type: 'side_set', side: 'back' }, { type: 'xray_set', on: true }] as const) {
      const turned = play(stepping.state, view);
      expect(turned.state.solutions.step.kind).toBe('pending');
      const landed = moved({ state: turned.state, effects: stepping.effects });
      expect(landed.state.shown).toEqual(sidesOf(SPOTS_TWO_OVER_ZERO));
      expect(landed.state.history.past).toEqual([{ kind: 'step', order: OPENING }]);
      expect(lastOf(landed.effects, 'solutions_position').by).toEqual(view.type === 'side_set' ? { picture: 'back' } : 'layer_order');
    }
  });

  it('a step that ends or runs out moves nothing; an undo that runs out leaves the history, and Keep trying asks for the same order', () => {
    const start = opened().state;
    const stepping = play(start, { type: 'step', direction: 'next' });
    for (const verdict of ['end', 'timed_out'] as const) {
      const answered = play(stepping.state, { type: 'stepped', request: lastOf(stepping.effects, 'step').request, facts: { verdict } });
      expect(answered.state.history).toBe(start.history);
    }
    const stepped = moved(stepping);
    const undo = play(stepped.state, { type: 'undo' });
    const out = play(undo.state, { type: 'committed', request: lastOf(undo.effects, 'commit').request, facts: { verdict: 'timed_out' } });
    expect(out.state.history).toBe(stepped.state.history);
    expect(hintLine(out.state)?.action).toBe('keep_trying');
    expect(lastOf(dispatch(out.state, { type: 'keep_trying' }).effects, 'commit')).toMatchObject({ order: OPENING });
  });
});

// ---------------------------------------------------------------------------

describe('what is no step', () => {
  it('turning over, X-ray and Undecided change what is seen, never what Apply writes', () => {
    const s = picked(opened().state, 2, 0).state;
    for (const action of [
      { type: 'side_set', side: 'back' },
      { type: 'xray_set', on: true },
      { type: 'open_spots_set', on: true },
      { type: 'face_hovered', face: 3 },
      { type: 'row_hovered', key: null },
      { type: 'verb_pointed', verb: 'behind' },
    ] as const) {
      expect(dispatch(s, action).state.history).toBe(s.history);
    }
  });
});
