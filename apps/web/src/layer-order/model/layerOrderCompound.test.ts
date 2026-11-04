/**
 * Compound constraints (`implementation-plans/layer-order-dialog.md`, D21):
 * one subject, one or more objects, previewed, explained and added as one
 * sentence, stored one constraint per object, and shown one row per subject
 * and verb. The builder's own rules are in `layerOrderSentence.test.ts`; here
 * they meet the engine's answers, the history and the list.
 */
import { describe, expect, it } from 'vitest';
import { constraintAddedFact, constraintBlockedFact } from './layerOrderAnalytics';
import { LAYER_ORDER_LABEL_CAP } from '../layerOrderBudgets';
import { LAYER_ORDER_LIMITS, keepTrying, type LayerOpenFacts } from './layerOrderEngineFacts';
import {
  OPEN_PAIRS,
  SPOTS,
  SPOTS_TWO_OVER_ZERO,
  carried,
  changedSpots,
  commits,
  dispatch,
  effectsOf,
  fits,
  lastOf,
  openFactsOf,
  opened,
  orderOf,
  play,
  position,
  rowKey,
  sidesOf,
  stacksOf,
  trashOf,
  type Played,
} from './layerOrderModel.fixtures';
import { chosenPreview } from './layerOrderReducer';
import { addState, hintLine, listControls, paneMarks, rowGroupsView } from './layerOrderSelectors';
import type { LayerOrderDialogState } from './layerOrderState';

const view = (subject: number | null, verb: 'in_front_of' | 'behind' | null, ...objects: (number | null)[]) => ({
  subject,
  verb,
  objects,
});

/** Pick `subject`, then each of `objects`, on the crease pattern. */
function sentenceOf(state: LayerOrderDialogState, subject: number, ...objects: number[]): Played {
  return play(
    state,
    { type: 'face_picked', face: subject, origin: 'pattern' },
    ...objects.map((face) => ({ type: 'face_picked' as const, face, origin: 'folded' as const }))
  );
}

function previewed(played: Played, facts: Extract<Parameters<typeof dispatch>[1], { type: 'previewed' }>['facts']): Played {
  return play(played.state, { type: 'previewed', request: lastOf(played.effects, 'preview').request, facts });
}

/** Open on the fixture, pick 2 in front of 0 and 3 (from the front: [2, 0, 1] and [2, 3, -1]), and fit it. */
function twoObjectsFit(token = 9): Played {
  return fits(sentenceOf(opened().state, 2, 0, 3), token);
}

/** …then Add it and land the commit: two committed rows from one Add. */
function twoObjectsAdded(openPairsAfter: Uint32Array = Uint32Array.of(4, 5)): Played {
  return commits(play(twoObjectsFit().state, { type: 'add' }), openPairsAfter, SPOTS_TWO_OVER_ZERO);
}

// ---------------------------------------------------------------------------

describe('the builder with several objects', () => {
  it('toggles objects through the reducer, keeps the offered faces still, and says how to add or remove', () => {
    const subject = dispatch(opened().state, { type: 'face_picked', face: 2, origin: 'pattern' });
    expect(hintLine(subject.state)?.text).toEqual({ key: 'pick_object', objects: 2, tinted: false });

    const one = dispatch(subject.state, { type: 'face_picked', face: 0, origin: 'menu' });
    expect(one.state.sentence).toMatchObject({ subject: 2, objects: [0], objectPicks: [{ face: 0, origin: 'menu' }] });
    // Picking one never changes which others are offered, so the tints hold still.
    expect(paneMarks(one.state)).toMatchObject({ pickable: [0, 3], objects: [0, 3], picked: [0] });

    const two = play(one.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    expect(two.state.sentence).toMatchObject({
      objects: [0, 3],
      objectPicks: [
        { face: 0, origin: 'menu' },
        { face: 3, origin: 'pattern' },
      ],
    });
    expect(paneMarks(two.state)).toMatchObject({ pickable: [0, 3], picked: [0, 3], labelled: [2, 0, 3] });
    expect(hintLine(fits(two).state)?.text).toEqual({ key: 'more_objects' });

    // The keyboard face menu's checked item is the same toggle; the origin left is the remaining object's.
    const back = dispatch(two.state, { type: 'face_picked', face: 0, origin: 'menu' });
    expect(back.state.sentence).toMatchObject({ objects: [3], objectPicks: [{ face: 3, origin: 'pattern' }] });
  });

  it('objects read in letter order, from the letters the hook hands the open', () => {
    // Face 3 reads before face 0.
    const lettered = openFactsOf({ letterOrder: [3, 2, 0, 1, 4, 5, 6] });
    const s = sentenceOf(opened(lettered).state, 2, 0, 3);
    expect(s.state.sentence.objects).toEqual([3, 0]);
    expect(lastOf(s.effects, 'preview').constraints).toEqual([
      [2, 3, -1],
      [2, 0, 1],
    ]);
  });

  it('a hovered object slot lights every picked object', () => {
    const s = sentenceOf(opened().state, 2, 0, 3);
    expect(paneMarks(dispatch(s.state, { type: 'slot_hovered', slot: 'object' }).state).lit).toEqual([0, 3]);
  });

  it('an object chip’s × in the object step is the same as picking that object again', () => {
    const s = fits(sentenceOf(opened().state, 2, 0, 3)).state;
    const removed = dispatch(s, { type: 'object_removed', face: 3 });
    expect(removed).toEqual(dispatch(s, { type: 'face_picked', face: 3, origin: 'pattern' }));
    expect(removed.state.sentence).toMatchObject({ subject: 2, objects: [0], active: 'object' });
  });

  it('an object chip’s × checks what is left, and the hint follows', () => {
    // 2 in front of 3 alone was never checked: removing 0 asks for it.
    const s = fits(sentenceOf(opened().state, 2, 0, 3)).state;
    const removed = dispatch(s, { type: 'object_removed', face: 0 });
    expect(effectsOf(removed.effects, 'preview').map((effect) => effect.constraints)).toEqual([[[2, 3, -1]]]);
    expect(hintLine(removed.state)?.text).toEqual({ key: 'checking', sentence: view(2, 'in_front_of', 3) });
    expect(addState(removed.state)).toMatchObject({ enabled: false, why: 'checking', label: 'add_constraint' });
  });

  it('an object chip’s × with the subject slot active removes the object, not the subject', () => {
    const s = play(sentenceOf(opened().state, 2, 0, 3).state, { type: 'slot_activated', slot: 'subject' }).state;
    expect(dispatch(s, { type: 'object_removed', face: 3 }).state.sentence).toMatchObject({
      subject: 2,
      objects: [0],
      active: 'subject',
    });
    // A pick there would have made 3 the subject instead.
    expect(dispatch(s, { type: 'face_picked', face: 3, origin: 'pattern' }).state.sentence).toMatchObject({ subject: 3 });
  });

  it('the last object’s × leaves the object slot active, with nothing to check', () => {
    const s = fits(sentenceOf(opened().state, 2, 0)).state;
    const removed = dispatch(s, { type: 'object_removed', face: 0 });
    expect(removed.state.sentence).toMatchObject({ subject: 2, objects: [], active: 'object' });
    expect(paneMarks(removed.state).active).toBe('object');
    expect(effectsOf(removed.effects, 'preview')).toEqual([]);
    expect(hintLine(removed.state)?.text).toEqual({ key: 'pick_object', objects: 2, tinted: false });
    expect(addState(removed.state)).toMatchObject({ enabled: false, why: 'pick_object' });
  });

  it('an object chip’s × does nothing for a face that is not an object, or while the builder is inert', () => {
    const s = sentenceOf(opened().state, 2, 0).state;
    expect(dispatch(s, { type: 'object_removed', face: 3 })).toEqual({ state: s, effects: [] });
    const committing = play(fits(sentenceOf(opened().state, 2, 0)).state, { type: 'add' }).state;
    const inert = { ...committing, settle: { kind: 'timed_out' as const, limits: LAYER_ORDER_LIMITS.restore } };
    expect(dispatch(inert, { type: 'object_removed', face: 0 }).state).toBe(inert);
  });

  it('a click on empty paper clears every object, then the subject', () => {
    const s = sentenceOf(opened().state, 2, 0, 3);
    const once = play(s.state, { type: 'ground_clicked' });
    expect(once.state.sentence).toMatchObject({ subject: 2, objects: [] });
    expect(effectsOf(once.effects, 'preview')).toEqual([]);
    expect(play(once.state, { type: 'ground_clicked' }).state.sentence).toMatchObject({ subject: null, objects: [] });
  });

  it('past the label cap, the subject and the picked objects keep their letters', () => {
    // Face 0 overlaps every other face, every pair open.
    const faces = LAYER_ORDER_LABEL_CAP + 4;
    const others = Array.from({ length: faces - 1 }, (_, i) => i + 1);
    const wide = openFactsOf({
      faces,
      frontUp: new Uint8Array(faces).fill(1),
      openPairs: Uint32Array.from(others.flatMap((face) => [0, face])),
      stacks: { front: stacksOf([[0, ...others]]), back: stacksOf([[...others].reverse().concat(0)]) },
    });
    const s = sentenceOf(opened(wide).state, 0, 9, 5);
    const marks = paneMarks(s.state);
    expect(marks.pastLabelCap).toBe(true);
    expect(marks.alwaysLabelled).toEqual([0, 5, 9]);
    expect([...marks.labelled].sort((a, b) => a - b)).toEqual([0, ...others]);
    // Under the cap nothing is capped, and the picks are among those lettered either way.
    const narrow = paneMarks(sentenceOf(opened().state, 2, 0).state);
    expect(narrow).toMatchObject({ pastLabelCap: false, alwaysLabelled: [2, 0] });
  });
});

// ---------------------------------------------------------------------------

describe('one preview per sentence, over the whole set', () => {
  it('checks the committed list plus one constraint per object, in one call; Add waits and says how many', () => {
    const s = sentenceOf(opened().state, 2, 0, 3);
    // One preview for the first object, then one for the pair: never one per object.
    const previews = effectsOf(s.effects, 'preview');
    expect(previews.map((effect) => effect.constraints)).toEqual([
      [[2, 0, 1]],
      [
        [2, 0, 1],
        [2, 3, -1],
      ],
    ]);
    expect(previews[1]!.limits).toEqual(LAYER_ORDER_LIMITS.preview);
    expect(chosenPreview(s.state)).toMatchObject({ kind: 'pending', candidates: [[2, 0, 1], [2, 3, -1]] });
    expect(addState(s.state)).toMatchObject({ enabled: false, why: 'checking', label: 'add_constraints' });
    expect(hintLine(s.state)?.text).toEqual({ key: 'checking', sentence: view(2, 'in_front_of', 0, 3) });
  });

  it('keeps each sentence’s preview for the order on screen: toggling back runs nothing again', () => {
    const f = twoObjectsFit();
    const one = play(f.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    // The one-object sentence was checked on the way: it is answered already, or still pending; either way no new call.
    expect(effectsOf(one.effects, 'preview')).toEqual([]);
    const again = play(one.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    expect(effectsOf(again.effects, 'preview')).toEqual([]);
    expect(chosenPreview(again.state)?.kind).toBe('fits');
  });

  it('a fit enables Add with the plural label and the whole sentence', () => {
    const f = twoObjectsFit();
    expect(addState(f.state)).toEqual({ enabled: true, label: 'add_constraints', sentence: view(2, 'in_front_of', 0, 3) });
    // With one object it reads singular, as it always did.
    expect(addState(fits(sentenceOf(opened().state, 2, 0)).state)).toMatchObject({ label: 'add_constraint' });
  });

  it('a compound sentence that ran out of time offers Keep trying, which checks the whole set again, later', () => {
    const out = previewed(sentenceOf(opened().state, 2, 0, 3), { verdict: 'timed_out' });
    expect(hintLine(out.state)).toMatchObject({
      action: 'keep_trying',
      text: { key: 'timed_out', sentence: view(2, 'in_front_of', 0, 3) },
    });
    expect(lastOf(dispatch(out.state, { type: 'keep_trying' }).effects, 'preview')).toEqual({
      type: 'preview',
      request: expect.any(Number),
      constraints: [
        [2, 0, 1],
        [2, 3, -1],
      ],
      limits: keepTrying(LAYER_ORDER_LIMITS.preview),
    });
  });
});

// ---------------------------------------------------------------------------

describe('a clash on a compound sentence', () => {
  /** 4 in front of 5 is committed; 2 is still open with 0 and 3. */
  const WITH_ROW: LayerOpenFacts = openFactsOf({ constraints: [[4, 5, -1]], openPairs: OPEN_PAIRS });

  it('marks the object that clashes, not its sibling, on its chip, both panes and the reason', () => {
    const start = opened(WITH_ROW).state;
    const rowId = start.rows.committed[0]!.id;
    const p = sentenceOf(start, 2, 0, 3);
    // The list checked: the committed row (0), then 2 in front of 0 (1) and of 3 (2).
    const cant = previewed(p, { verdict: 'cant_fit', constraints: [0, 2] });
    const explain = lastOf(cant.effects, 'explain');
    expect(explain).toEqual({
      type: 'explain',
      request: explain.request,
      constraints: [
        [4, 5, -1],
        [2, 0, 1],
        [2, 3, -1],
      ],
      limits: LAYER_ORDER_LIMITS.explain,
    });
    // While it is explained, the check's own set already names 3.
    expect(paneMarks(cant.state)).toMatchObject({ danger: [2, 3], clashObjects: [3], clashRows: [] });
    expect(hintLine(cant.state)?.text).toEqual({ key: 'cant_fit_explaining', sentence: view(2, 'in_front_of', 0, 3) });

    const done = play(cant.state, {
      type: 'explained',
      request: explain.request,
      facts: { verdict: 'clash', constraints: [0, 2], faces: [2, 3, 4, 5], minimal: true },
    });
    expect(paneMarks(done.state)).toMatchObject({ danger: [2, 3, 4, 5], clashObjects: [3], clashRows: [rowId] });
    // The reason names only the object in the clash.
    expect(hintLine(done.state)?.text).toEqual({
      key: 'cant_fit',
      sentence: view(2, 'in_front_of', 3),
      clashes: [view(4, 'in_front_of', 5)],
      minimal: true,
    });
    expect(rowGroupsView(done.state)[0]).toMatchObject({
      mark: 'clash',
      reason: { key: 'clashes', clashes: [view(2, 'in_front_of', 3)] },
    });
    expect(addState(done.state)).toMatchObject({ enabled: false, why: 'cant_fit', label: 'add_constraints' });
  });

  it('a constraint the creases alone refuse needs no explaining, and names only its object', () => {
    const cant = previewed(sentenceOf(opened().state, 2, 0, 3), { verdict: 'cant_fit', constraints: [1] });
    expect(effectsOf(cant.effects, 'explain')).toEqual([]);
    expect(paneMarks(cant.state)).toMatchObject({ danger: [2, 3], clashObjects: [3] });
    expect(hintLine(cant.state)?.text).toEqual({
      key: 'cant_fit',
      sentence: view(2, 'in_front_of', 3),
      clashes: [],
      minimal: true,
    });
  });

  it('a proof that names both objects is explained down to the smallest set', () => {
    const cant = previewed(sentenceOf(opened().state, 2, 0, 3), { verdict: 'cant_fit', constraints: [0, 1] });
    expect(lastOf(cant.effects, 'explain').constraints).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
  });

  it('is reported once per sentence, with its objects bucketed', () => {
    const cant = previewed(sentenceOf(opened().state, 2, 0, 3), { verdict: 'cant_fit', constraints: [1] });
    expect(effectsOf(cant.effects, 'track').map((effect) => effect.fact)).toEqual([constraintBlockedFact(0, 2)]);
    expect(effectsOf(dispatch(cant.state, { type: 'face_hovered', face: 0 }).effects, 'track')).toEqual([]);
  });

  describe('once per sentence (D21): until its subject or its verb as read from the front changes, an Add or a Clear', () => {
    const tracked = (played: Played) => effectsOf(played.effects, 'track').map((effect) => effect.fact);
    const CANT = { verdict: 'cant_fit', constraints: [0] } as const;
    const FIT = { verdict: 'fits', token: 4, changed: changedSpots([1]), stacks: sidesOf(SPOTS_TWO_OVER_ZERO) } as const;
    /** 2 in front of 0, blocked: reported once, with one object. */
    function blocked(): Played {
      const one = previewed(sentenceOf(opened().state, 2, 0), CANT);
      expect(tracked(one)).toEqual([constraintBlockedFact(0, 1)]);
      return one;
    }

    it('a sentence that grows is the same sentence', () => {
      const two = play(blocked().state, { type: 'face_picked', face: 3, origin: 'pattern' });
      expect(tracked(previewed(two, CANT))).toEqual([]);
    });

    it('a verb away and back is a new sentence each time it changes', () => {
      const behind = play(blocked().state, { type: 'verb_set', verb: 'behind' });
      const behindBlocked = previewed(behind, CANT);
      expect(tracked(behindBlocked)).toEqual([constraintBlockedFact(0, 1)]);
      // Back to the first verb: its can't-fit is known, so no preview, and it is reported again.
      const front = play(behindBlocked.state, { type: 'verb_set', verb: 'in_front_of' });
      expect(effectsOf(front.effects, 'preview')).toEqual([]);
      expect(tracked(front)).toEqual([constraintBlockedFact(0, 1)]);
      // A verb that fits away and back changed the verb too.
      const fitAway = previewed(play(blocked().state, { type: 'verb_set', verb: 'behind' }), FIT);
      expect(tracked(play(fitAway.state, { type: 'verb_set', verb: 'in_front_of' }))).toEqual([constraintBlockedFact(0, 1)]);
    });

    it('a subject away and back is a new sentence', () => {
      const swap = play(
        blocked().state,
        { type: 'slot_activated', slot: 'subject' },
        { type: 'face_picked', face: 4, origin: 'pattern' }
      );
      expect(swap.state.sentence).toMatchObject({ subject: 4, objects: [] });
      expect(tracked(swap)).toEqual([]);
      const back = play(
        swap.state,
        { type: 'slot_activated', slot: 'subject' },
        { type: 'face_picked', face: 2, origin: 'pattern' },
        { type: 'face_picked', face: 0, origin: 'pattern' }
      );
      expect(effectsOf(back.effects, 'preview')).toEqual([]);
      expect(tracked(back)).toEqual([constraintBlockedFact(0, 1)]);
    });

    it('turning over keys the sentence by its verb as read from the front', () => {
      // From the back the same words are the opposite constraint, 2 behind 0 as read from the front: a new sentence.
      const back = play(blocked().state, { type: 'side_set', side: 'back' });
      expect(lastOf(back.effects, 'preview').constraints).toEqual([[2, 0, -1]]);
      const backBlocked = previewed(back, CANT);
      expect(tracked(backBlocked)).toEqual([constraintBlockedFact(0, 1)]);
      // “2 behind 0” from the back is “2 in front of 0” from the front: the same sentence.
      const sameFromBack = play(
        opened().state,
        { type: 'side_set', side: 'back' },
        { type: 'face_picked', face: 2, origin: 'pattern' },
        { type: 'verb_set', verb: 'behind' },
        { type: 'face_picked', face: 0, origin: 'folded' }
      );
      expect(lastOf(sameFromBack.effects, 'preview').constraints).toEqual([[2, 0, 1]]);
      const blockedFromBack = previewed(sameFromBack, CANT);
      expect(tracked(blockedFromBack)).toEqual([constraintBlockedFact(0, 1)]);
      expect(blockedFromBack.state.blocked).toBe(blocked().state.blocked);
    });

    it('a step keeps the can’t-fit and its explain, and asks and reports nothing more', () => {
      const stepping = play(blocked().state, { type: 'step', direction: 'next' });
      const moved = play(stepping.state, {
        type: 'stepped',
        request: lastOf(stepping.effects, 'step').request,
        facts: {
          verdict: 'moved',
          changed: changedSpots([0]),
          position: position(2, 9),
          stacks: sidesOf(SPOTS_TWO_OVER_ZERO),
          order: orderOf(SPOTS_TWO_OVER_ZERO),
        },
      });
      expect(chosenPreview(moved.state)).toEqual(chosenPreview(blocked().state));
      expect(effectsOf(moved.effects, 'preview')).toEqual([]);
      expect(effectsOf(moved.effects, 'explain')).toEqual([]);
      expect(tracked(moved)).toEqual([]);
    });

    it('a fit does not survive a step: the order it would show has moved on', () => {
      const fit = fits(sentenceOf(opened().state, 2, 0));
      const stepping = play(fit.state, { type: 'step', direction: 'next' });
      const moved = play(stepping.state, {
        type: 'stepped',
        request: lastOf(stepping.effects, 'step').request,
        facts: { verdict: 'moved', changed: changedSpots([0]), position: position(2, 9), stacks: sidesOf(SPOTS), order: orderOf(SPOTS) },
      });
      expect(effectsOf(moved.effects, 'preview')).toHaveLength(1);
    });

    it('an undo and a redo of the sentence’s edits never report it again', () => {
      const one = commits(play(fits(sentenceOf(opened().state, 2, 0)).state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5));
      const first = previewed(sentenceOf(one.state, 2, 3), { verdict: 'cant_fit', constraints: [0, 1] });
      expect(tracked(first)).toEqual([constraintBlockedFact(1, 1)]);
      // Undo takes the pick of 3 back, with no engine call.
      const undone = play(first.state, { type: 'undo' });
      expect(undone.state.sentence).toMatchObject({ subject: 2, objects: [] });
      expect(effectsOf(undone.effects, 'commit')).toEqual([]);
      // Redo brings the blocked sentence back from its known can't-fit, and reports nothing.
      const redone = dispatch(undone.state, { type: 'redo' });
      expect(redone.state.sentence).toMatchObject({ subject: 2, objects: [3] });
      expect(chosenPreview(redone.state)?.kind).toBe('cant_fit');
      expect(effectsOf(redone.effects, 'preview')).toEqual([]);
      expect(tracked(redone)).toEqual([]);
      // Picking 3 again after the undo is the same sentence, already counted.
      expect(tracked(dispatch(undone.state, { type: 'face_picked', face: 3, origin: 'pattern' }))).toEqual([]);
      // A new subject after the undo is a new sentence, counted when it is blocked.
      const other = play(undone.state, { type: 'slot_activated', slot: 'subject' }, { type: 'face_picked', face: 4, origin: 'pattern' });
      expect(tracked(previewed(play(other.state, { type: 'face_picked', face: 5, origin: 'pattern' }), CANT))).toEqual([
        constraintBlockedFact(1, 1),
      ]);
    });

    it('an undo and a redo through the list never report it again either', () => {
      const one = commits(play(fits(sentenceOf(opened().state, 2, 0)).state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5));
      const first = previewed(sentenceOf(one.state, 2, 3), { verdict: 'cant_fit', constraints: [0, 1] });
      // Back past the Add: the two picks, then the Add, whose commit brings back 2 in front of 0.
      const picksUndone = play(first.state, { type: 'undo' }, { type: 'undo' });
      expect(picksUndone.state.sentence.subject).toBeNull();
      const undone = commits(play(picksUndone.state, { type: 'undo' }), OPEN_PAIRS);
      expect(undone.state.rows.committed).toEqual([]);
      expect(undone.state.sentence).toMatchObject({ subject: 2, objects: [0] });
      expect(tracked(fits(undone))).toEqual([]);
      // Forward again: the Add's commit, then the picks, whose sentence is checked again after the commit.
      const added = commits(play(fits(undone).state, { type: 'redo' }), Uint32Array.of(2, 3, 4, 5));
      expect(added.state.sentence).toMatchObject({ subject: null, objects: [] });
      const repicked = play(added.state, { type: 'redo' }, { type: 'redo' });
      expect(repicked.state.sentence).toMatchObject({ subject: 2, objects: [3] });
      const again = previewed(repicked, { verdict: 'cant_fit', constraints: [0, 1] });
      expect(chosenPreview(again.state)?.kind).toBe('cant_fit');
      expect(tracked(again)).toEqual([]);
    });

    it('an Add starts the count afresh, for the same subject and verb too', () => {
      // 2 in front of 0 and 3 is blocked; without 3 it fits, still the same sentence, and is added.
      const built = sentenceOf(opened().state, 2, 0, 3);
      const [first] = effectsOf(built.effects, 'preview');
      const both = previewed(built, CANT);
      expect(tracked(both)).toEqual([constraintBlockedFact(0, 2)]);
      const alone = play(
        both.state,
        { type: 'object_removed', face: 3 },
        { type: 'previewed', request: first!.request, facts: FIT }
      );
      expect(chosenPreview(alone.state)?.kind).toBe('fits');
      expect(tracked(alone)).toEqual([]);
      expect(alone.state.blocked).toBe(both.state.blocked);
      const added = commits(play(alone.state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5));
      expect(added.state.blocked).toBeNull();
      // 2 in front of 3 now: the same subject and verb, blocked again, counted again.
      expect(tracked(previewed(sentenceOf(added.state, 2, 3), CANT))).toEqual([constraintBlockedFact(1, 1)]);
    });

    it('after a Clear, the same sentence built again is reported again', () => {
      const cleared = play(blocked().state, { type: 'sentence_cleared' });
      expect(tracked(cleared)).toEqual([]);
      expect(tracked(sentenceOf(cleared.state, 2, 0))).toEqual([constraintBlockedFact(0, 1)]);
    });
  });
});

describe('explains, only for the set on display', () => {
  // 4 in front of 5 is committed, so a can't-fit names it and needs explaining; 2 is open with 0, 3 and 5.
  const WIDE: LayerOpenFacts = openFactsOf({ constraints: [[4, 5, -1]], openPairs: Uint32Array.of(0, 2, 2, 3, 2, 5) });

  it('an explain gets the preview’s 3 s; one that runs out keeps the check’s set, and Keep trying asks again, later', () => {
    const cant = previewed(sentenceOf(opened(WIDE).state, 2, 0), { verdict: 'cant_fit', constraints: [0, 1] });
    const asked = lastOf(cant.effects, 'explain');
    expect(asked.limits).toEqual(LAYER_ORDER_LIMITS.preview);
    const ranOut = play(cant.state, { type: 'explained', request: asked.request, facts: { verdict: 'timed_out' } });
    expect(hintLine(ranOut.state)).toMatchObject({ tone: 'danger', action: 'keep_trying', text: { key: 'cant_fit', minimal: false } });
    // The check's own set stands in on the panes, not claimed smallest.
    expect(paneMarks(ranOut.state).danger).toEqual(expect.arrayContaining([2, 0, 4, 5]));
    const again = play(ranOut.state, { type: 'keep_trying' });
    expect(lastOf(again.effects, 'explain').limits).toEqual(keepTrying(LAYER_ORDER_LIMITS.explain));
    expect(hintLine(again.state)?.text.key).toBe('cant_fit_explaining');
  });

  it('building “2 in front of 0, 3, 5” through can’t-fit prefixes asks one explain, not three', () => {
    const built = sentenceOf(opened(WIDE).state, 2, 0, 3, 5);
    const [first, second, third] = effectsOf(built.effects, 'preview');
    expect(third!.constraints).toHaveLength(4);
    // Every answer lands after the sentence has moved on: only the last set is on display.
    const answered = play(
      built.state,
      { type: 'previewed', request: first!.request, facts: { verdict: 'cant_fit', constraints: [0, 1] } },
      { type: 'previewed', request: second!.request, facts: { verdict: 'cant_fit', constraints: [0, 1] } },
      { type: 'previewed', request: third!.request, facts: { verdict: 'cant_fit', constraints: [0, 1] } }
    );
    const explains = effectsOf(answered.effects, 'explain');
    expect(explains.map((effect) => effect.constraints)).toEqual([
      [
        [4, 5, -1],
        [2, 0, 1],
        [2, 3, -1],
        [2, 5, -1],
      ],
    ]);
    // Coming back to a set it moved past asks for that set's explain then.
    const back = play(answered.state, { type: 'face_picked', face: 5, origin: 'pattern' });
    expect(effectsOf(back.effects, 'explain').map((effect) => effect.constraints)).toEqual([
      [
        [4, 5, -1],
        [2, 0, 1],
        [2, 3, -1],
      ],
    ]);
    expect(hintLine(back.state)?.text.key).toBe('cant_fit_explaining');
  });

  it('a can’t-fit that lands for a set the sentence has moved past asks nothing', () => {
    const p = sentenceOf(opened(WIDE).state, 2, 0);
    const moved = play(p.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    const late = play(moved.state, {
      type: 'previewed',
      request: lastOf(p.effects, 'preview').request,
      facts: { verdict: 'cant_fit', constraints: [0, 1] },
    });
    expect(effectsOf(late.effects, 'explain')).toEqual([]);
  });
});

describe('Add by a token the session no longer holds', () => {
  const fitsFacts = (token: number) =>
    ({ verdict: 'fits', token, changed: changedSpots([1], [1]), stacks: sidesOf(SPOTS_TWO_OVER_ZERO) }) as const;

  it('after a later preview, Add searches instead, with the commit’s limits', () => {
    const fitOne = previewed(sentenceOf(opened().state, 2, 0), fitsFacts(5));
    // A second object asks a second preview, which replaces the first in the session; it can't fit.
    const widened = play(fitOne.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    const cant = previewed(widened, { verdict: 'cant_fit', constraints: [1] });
    const back = play(cant.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    expect(chosenPreview(back.state)).toMatchObject({ kind: 'fits', token: 5 });
    expect(lastOf(play(back.state, { type: 'add' }).effects, 'commit')).toMatchObject({
      constraints: [[2, 0, 1]],
      token: null,
      limits: LAYER_ORDER_LIMITS.commit,
    });
  });

  it('a set that fit only after Keep trying gets at least those limits when Add has to search', () => {
    const out = previewed(sentenceOf(opened().state, 2, 0), { verdict: 'timed_out' });
    const again = play(out.state, { type: 'keep_trying' });
    const retried = keepTrying(LAYER_ORDER_LIMITS.preview);
    expect(lastOf(again.effects, 'preview').limits).toEqual(retried);
    const fitted = previewed(again, fitsFacts(5));
    // While it is the session's last preview, its token adopts it.
    expect(lastOf(play(fitted.state, { type: 'add' }).effects, 'commit')).toMatchObject({
      token: 5,
      limits: LAYER_ORDER_LIMITS.commit,
    });
    // After another preview, Add searches with the wider of the two limits.
    const widened = play(fitted.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    const back = play(widened.state, { type: 'face_picked', face: 3, origin: 'pattern' });
    const commit = lastOf(play(back.state, { type: 'add' }).effects, 'commit');
    expect(commit).toMatchObject({ token: null });
    expect(commit.limits).toEqual({
      maxNodes: Math.max(retried.maxNodes, LAYER_ORDER_LIMITS.commit.maxNodes),
      fastNodes: Math.max(retried.fastNodes, LAYER_ORDER_LIMITS.commit.fastNodes),
      deadlineMs: Math.max(retried.deadlineMs, LAYER_ORDER_LIMITS.commit.deadlineMs),
    });
    expect(commit.limits.maxNodes).toBe(retried.maxNodes);
  });

  it('a step that ends or runs out keeps the session’s preview; one that moves drops it, and checks again', () => {
    const fitted = previewed(sentenceOf(opened().state, 2, 0), fitsFacts(5));
    const stepping = play(fitted.state, { type: 'step', direction: 'next' });
    const request = lastOf(stepping.effects, 'step').request;
    for (const verdict of ['end', 'timed_out'] as const) {
      const still = play(stepping.state, { type: 'stepped', request, facts: { verdict } });
      expect(still.state.lastPreview).toBe(fitted.state.lastPreview);
      expect(lastOf(play(still.state, { type: 'add' }).effects, 'commit')).toMatchObject({
        token: 5,
        limits: LAYER_ORDER_LIMITS.commit,
      });
    }
    const moved = play(stepping.state, {
      type: 'stepped',
      request,
      facts: {
        verdict: 'moved',
        changed: changedSpots([1]),
        position: { index: 2, total: { n: 3, exact: true } },
        stacks: sidesOf(SPOTS),
        order: orderOf(SPOTS),
      },
    });
    // The old preview is gone with the order it was for; the sentence is checked again against the new one.
    const again = lastOf(moved.effects, 'preview');
    expect(moved.state.lastPreview).toBe(again.request);
    expect(lastOf(play(previewed(moved, fitsFacts(6)).state, { type: 'add' }).effects, 'commit')).toMatchObject({ token: 6 });
  });
});

describe('the hint before an explain runs', () => {
  it('says plainly that it can’t fit, in the danger tone, until the explain starts', () => {
    // A preview answers can't-fit while a removal is in flight: its explain waits for the commit.
    const one = commits(play(fits(sentenceOf(opened().state, 2, 0)).state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5));
    const p = sentenceOf(one.state, 4, 5);
    const removing = play(p.state, trashOf(p.state, one.state.rows.committed[0]!.id));
    const landed = play(removing.state, {
      type: 'previewed',
      request: lastOf(p.effects, 'preview').request,
      facts: { verdict: 'cant_fit', constraints: [0, 1] },
    });
    expect(effectsOf(landed.effects, 'explain')).toEqual([]);
    expect(hintLine(landed.state)).toEqual({
      tone: 'danger',
      action: null,
      text: { key: 'cant_fit', sentence: view(4, 'in_front_of', 5), clashes: [view(2, 'in_front_of', 0)], minimal: false },
    });
    expect(paneMarks(landed.state)).toMatchObject({ danger: [2, 0, 4, 5], clashObjects: [5] });
  });
});

// ---------------------------------------------------------------------------

describe('Add with several objects', () => {
  it('commits one constraint per object by the preview’s token, as one entry, and clears the sentence', () => {
    const added = play(twoObjectsFit(9).state, { type: 'add' });
    expect(lastOf(added.effects, 'commit')).toMatchObject({
      constraints: [
        [2, 0, 1],
        [2, 3, -1],
      ],
      token: 9,
    });
    const landed = commits(added, Uint32Array.of(4, 5), SPOTS_TWO_OVER_ZERO);
    expect(landed.state.rows.committed.map((row) => row.constraint)).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    // One undo step, however many objects.
    expect(landed.state.history.past).toHaveLength(added.state.history.past.length + 1);
    expect(landed.state.history.past.at(-1)).toMatchObject({ kind: 'list', rows: { committed: [] } });
    expect(landed.state.sentence).toMatchObject({ subject: null, objects: [] });
    // Once per Add, with the objects it named.
    expect(effectsOf(landed.effects, 'track').map((effect) => effect.fact)).toEqual([
      constraintAddedFact('in_front_of', 'pattern', 'folded', 2),
    ]);
  });

  it('reports where the first object still in the sentence was picked, not one removed since', () => {
    const s = play(
      opened().state,
      { type: 'face_picked', face: 2, origin: 'pattern' },
      { type: 'face_picked', face: 0, origin: 'menu' },
      { type: 'face_picked', face: 3, origin: 'folded' },
      { type: 'face_picked', face: 0, origin: 'menu' }
    );
    const landed = commits(play(fits(s).state, { type: 'add' }), Uint32Array.of(4, 5));
    expect(lastOf(landed.effects, 'track').fact).toEqual(constraintAddedFact('in_front_of', 'pattern', 'folded', 1));
  });

  it('undo takes the whole Add back in one step, and redo puts it back', () => {
    const added = twoObjectsAdded();
    const undo = play(added.state, { type: 'undo' });
    expect(lastOf(undo.effects, 'commit')).toMatchObject({ constraints: [], token: null });
    const undone = commits(undo, OPEN_PAIRS, SPOTS);
    expect(undone.state.rows.committed).toEqual([]);
    // The sentence Add took comes back, and is checked again against the list it now stands on.
    expect(undone.state.sentence).toMatchObject({ subject: 2, objects: [0, 3] });
    expect(lastOf(undone.effects, 'preview').constraints).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    // The picks before it are steps of their own.
    expect(listControls(undone.state)).toMatchObject({ undo: true, redo: true });

    const redo = play(undone.state, { type: 'redo' });
    expect(lastOf(redo.effects, 'commit').constraints).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    const redone = commits(redo, Uint32Array.of(4, 5), SPOTS_TWO_OVER_ZERO);
    expect(redone.state.rows.committed.map((row) => row.id)).toEqual(added.state.rows.committed.map((row) => row.id));
  });

  it('skips a constraint the list already holds: the preview checks, and Add commits, only the new ones', () => {
    // 2 in front of 0 is committed, and deduction still offers 0 to 2.
    const start = opened(openFactsOf({ constraints: [[2, 0, 1]], openPairs: OPEN_PAIRS })).state;
    const s = sentenceOf(start, 2, 0, 3);
    expect(lastOf(s.effects, 'preview').constraints).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    // Add's label counts what it would add: one constraint, so singular, though two objects are picked.
    expect(addState(fits(s, 4).state)).toMatchObject({ enabled: true, label: 'add_constraint' });
    const added = play(fits(s, 4).state, { type: 'add' });
    expect(lastOf(added.effects, 'commit')).toMatchObject({ constraints: [[2, 0, 1], [2, 3, -1]], token: 4 });
    const landed = commits(added, Uint32Array.of(4, 5));
    expect(landed.state.rows.committed.map((row) => row.constraint)).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    // A sentence that would add nothing has nothing to check or add.
    const nothing = sentenceOf(start, 2, 0);
    expect(effectsOf(nothing.effects, 'preview')).toEqual([]);
    expect(addState(nothing.state)).toMatchObject({ enabled: false, why: 'pick_object' });
  });
});

// ---------------------------------------------------------------------------

describe('the list: one row per subject and verb', () => {
  it('a compound Add reads as one row, whatever each object’s sign, from either side', () => {
    const added = twoObjectsAdded();
    const [first, second] = added.state.rows.committed.map((row) => row.id);
    expect(rowGroupsView(added.state)).toEqual([
      {
        key: rowKey(added.state, first!),
        kind: 'committed',
        sentence: view(2, 'in_front_of', 0, 3),
        mark: 'none',
        reason: null,
        hot: false,
        flagged: false,
        members: [
          { id: first, object: 0, clash: false },
          { id: second, object: 3, clash: false },
        ],
      },
    ]);
    // Stored one constraint each.
    expect(added.state.rows.committed).toHaveLength(2);
    const back = play(added.state, { type: 'side_set', side: 'back' });
    expect(rowGroupsView(back.state)[0]!.sentence).toEqual(view(2, 'behind', 0, 3));
  });

  /** 2 in front of 0, then 4 in front of 5, then 2 in front of 3: two rows, the first holding the first and last. */
  function threeAdds(): Played {
    const first = commits(play(fits(sentenceOf(opened().state, 2, 0)).state, { type: 'add' }), Uint32Array.of(2, 3, 4, 5));
    const second = commits(play(fits(sentenceOf(first.state, 4, 5)).state, { type: 'add' }), Uint32Array.of(2, 3));
    return commits(play(fits(sentenceOf(second.state, 2, 3)).state, { type: 'add' }), new Uint32Array());
  }

  it('a later Add for the same subject and verb joins its row, at the earliest one’s place', () => {
    const third = threeAdds();
    const [twoZero, fourFive, twoThree] = third.state.rows.committed.map((row) => row.id);
    expect(rowGroupsView(third.state).map((row) => [row.sentence, row.members.map((m) => m.id)])).toEqual([
      [view(2, 'in_front_of', 0, 3), [twoZero, twoThree]],
      [view(4, 'in_front_of', 5), [fourFive]],
    ]);
  });

  it('a row keeps its key, its place and its hover when an undo takes back the Add that joined it, and across a turn', () => {
    const third = threeAdds();
    const [twoZero, fourFive, twoThree] = third.state.rows.committed.map((row) => row.id);
    const [twoRow, fourRow] = rowGroupsView(third.state);
    const hovered = play(third.state, { type: 'row_hovered', key: twoRow!.key });
    const asked = play(hovered.state, { type: 'undo' });
    expect(lastOf(asked.effects, 'commit').constraints).toEqual([
      [2, 0, 1],
      [4, 5, -1],
    ]);
    const undone = commits(asked, Uint32Array.of(2, 3));
    expect(undone.state.rows.committed.map((row) => row.id)).toEqual([twoZero, fourFive]);
    const after = rowGroupsView(undone.state);
    expect(after.map((row) => [row.key, row.sentence])).toEqual([
      [twoRow!.key, view(2, 'in_front_of', 0)],
      [fourRow!.key, view(4, 'in_front_of', 5)],
    ]);
    expect(undone.state.hover.row).toBe(twoRow!.key);
    expect(after.map((row) => row.hot)).toEqual([true, false]);
    // Turned over, every row keeps its key, its members and its place, and reads the other verb.
    const back = rowGroupsView(play(third.state, { type: 'side_set', side: 'back' }).state);
    expect(back.map((row) => [row.key, row.members.map((m) => m.id), row.sentence])).toEqual([
      [twoRow!.key, [twoZero, twoThree], view(2, 'behind', 0, 3)],
      [fourRow!.key, [fourFive], view(4, 'behind', 5)],
    ]);
    // Redo puts the list back as it was.
    const redone = commits(play(undone.state, { type: 'redo' }), new Uint32Array());
    expect(redone.state.rows.committed.map((row) => row.id)).toEqual([twoZero, fourFive, twoThree]);
  });

  it('a different verb for the same subject is a row of its own', () => {
    const start = opened(openFactsOf({ constraints: [[2, 0, 1], [2, 3, 1]] })).state;
    expect(rowGroupsView(start).map((row) => row.sentence)).toEqual([view(2, 'in_front_of', 0), view(2, 'behind', 3)]);
  });

  it('the row’s trash removes every object in it, as one undo step: a row has no per-object remove', () => {
    const added = twoObjectsAdded();
    const row = rowGroupsView(added.state)[0]!;
    const asked = play(added.state, { type: 'row_removed', key: row.key });
    expect(effectsOf(asked.effects, 'commit').map((effect) => effect.constraints)).toEqual([[]]);
    const removed = commits(asked, OPEN_PAIRS, SPOTS);
    expect(rowGroupsView(removed.state)).toEqual([]);
    expect(removed.state.history.past).toHaveLength(added.state.history.past.length + 1);

    const undone = commits(play(removed.state, { type: 'undo' }), Uint32Array.of(4, 5), SPOTS_TWO_OVER_ZERO);
    expect(rowGroupsView(undone.state)[0]!.members.map((member) => member.object)).toEqual([0, 3]);
    // A key no row has removes nothing.
    expect(dispatch(added.state, { type: 'row_removed', key: 'committed:9:in_front_of' }).effects).toEqual([]);
  });

  it('hovering a row lights its subject and all its objects; a click puts its subject in the builder', () => {
    const added = twoObjectsAdded(Uint32Array.of(2, 5, 4, 5));
    const row = rowGroupsView(added.state)[0]!;
    const hovered = play(added.state, { type: 'row_hovered', key: row.key });
    expect(paneMarks(hovered.state)).toMatchObject({ rowFaces: [2, 0, 3], labelled: [2, 0, 3] });
    expect(rowGroupsView(hovered.state)[0]!.hot).toBe(true);
    const clicked = play(added.state, { type: 'row_clicked', key: row.key });
    expect(clicked.state.sentence).toMatchObject({ subject: 2, subjectOrigin: 'list', objects: [] });
  });

  it('a clash marks the clashing objects within their row', () => {
    // 2 in front of 0 and 3 are committed as one row; 4 is still open with 5.
    const start = opened(openFactsOf({ constraints: [[2, 0, 1], [2, 3, -1]], openPairs: Uint32Array.of(4, 5) })).state;
    const [zero, three] = start.rows.committed.map((row) => row.id);
    const cant = previewed(sentenceOf(start, 4, 5), { verdict: 'cant_fit', constraints: [1, 2] });
    const done = play(cant.state, {
      type: 'explained',
      request: lastOf(cant.effects, 'explain').request,
      facts: { verdict: 'clash', constraints: [1, 2], faces: [2, 3, 4, 5], minimal: true },
    });
    const [row] = rowGroupsView(done.state);
    expect(row).toMatchObject({
      mark: 'clash',
      members: [
        { id: zero, clash: false },
        { id: three, clash: true },
      ],
    });
    expect(paneMarks(done.state).clashRows).toEqual([three]);
  });

  it('the can’t-fit hint groups what clashes as the list does', () => {
    const start = opened(openFactsOf({ constraints: [[2, 0, 1], [2, 3, -1]], openPairs: Uint32Array.of(4, 5) })).state;
    const cant = previewed(sentenceOf(start, 4, 5), { verdict: 'cant_fit', constraints: [0, 1, 2] });
    const done = play(cant.state, {
      type: 'explained',
      request: lastOf(cant.effects, 'explain').request,
      facts: { verdict: 'clash', constraints: [0, 1, 2], faces: [0, 2, 3, 4, 5], minimal: true },
    });
    expect(hintLine(done.state)?.text).toEqual({
      key: 'cant_fit',
      sentence: view(4, 'in_front_of', 5),
      clashes: [view(2, 'in_front_of', 0, 3)],
      minimal: true,
    });
    expect(rowGroupsView(done.state)[0]).toMatchObject({
      mark: 'clash',
      reason: { key: 'clashes', clashes: [view(4, 'in_front_of', 5)] },
    });
  });

  describe('carried rows', () => {
    const SPLIT_SUBJECT = { status: { status: 'ambiguous' }, subjectState: 'ambiguous', constraint: null } as const;
    const SPLIT_OBJECT = { status: { status: 'ambiguous' }, objectState: 'ambiguous', constraint: null } as const;
    const NO_OVERLAP = { status: { status: 'gone', cause: 'no_overlap' }, constraint: null } as const;
    const RESTORED = openFactsOf({
      constraints: [[2, 0, 1]],
      restore: {
        outcome: { kind: 'applied' },
        carried: [
          // Two split subjects, same verb: one row.
          carried({ index: 1, ...SPLIT_SUBJECT, subject: 2, object: 3, sign: -1 }),
          carried({ index: 2, ...SPLIT_SUBJECT, subject: 2, object: 5, sign: -1 }),
          // Same subject and verb, another status: a row of its own.
          carried({ index: 3, ...NO_OVERLAP, subject: 2, object: 4, sign: 1 }),
          // A split object: its reason names its own face, so it stays alone.
          carried({ index: 4, ...SPLIT_OBJECT, subject: 2, object: 6, sign: 1 }),
        ],
      },
    });

    it('group within one status, never with the committed rows, and give the row its one reason', () => {
      const { state } = opened(RESTORED, { hasRecord: true });
      const ids = [...state.rows.committed, ...state.rows.carried].map((row) => row.id);
      expect(rowGroupsView(state).map((row) => [row.members[0]!.id, row.kind, row.sentence, row.mark, row.reason])).toEqual([
        [ids[0], 'committed', view(2, 'in_front_of', 0), 'none', null],
        [ids[1], 'carried', view(2, 'in_front_of', 3, 5), 'not_applied', { key: 'ambiguous', face: 2 }],
        [ids[3], 'carried', view(2, 'in_front_of', 4), 'not_applied', { key: 'no_overlap', sentence: view(2, 'in_front_of', 4) }],
        [ids[4], 'carried', view(2, 'in_front_of', 6), 'not_applied', { key: 'ambiguous', face: 6 }],
      ]);
    });

    it('pointing at a grouped carried row gives the row’s reason, and its trash removes it whole, as one undo step', () => {
      const { state } = opened(RESTORED, { hasRecord: true });
      const row = rowGroupsView(state)[1]!;
      const hovered = play(state, { type: 'row_hovered', key: row.key });
      expect(hintLine(hovered.state)?.text).toEqual({ key: 'row_not_applied', reason: { key: 'ambiguous', face: 2 } });
      expect(paneMarks(hovered.state).rowFaces).toEqual([2, 3, 5]);

      const removedRow = play(state, { type: 'row_removed', key: row.key });
      expect(effectsOf(removedRow.effects, 'commit')).toEqual([]);
      expect(removedRow.state.rows.carried.map((r) => r.facts.index)).toEqual([3, 4]);
      expect(removedRow.state.history.past).toHaveLength(1);
      expect(play(removedRow.state, { type: 'undo' }).state.rows.carried.map((r) => r.facts.index)).toEqual([1, 2, 3, 4]);
    });

    it('a grouped row’s removal while the saved rows clash re-checks once', () => {
      const clashing = openFactsOf({
        restore: {
          outcome: { kind: 'clash', constraints: [0, 1] },
          carried: [
            carried({ index: 0, status: { status: 'clashing' }, subject: 2, object: 0, constraint: [2, 0, 1] }),
            carried({ index: 1, status: { status: 'clashing' }, subject: 2, object: 3, sign: -1, constraint: [2, 3, -1] }),
            carried({ index: 2, subject: 4, object: 5, sign: -1, constraint: [4, 5, -1] }),
          ],
        },
      });
      const { state } = opened(clashing, { hasRecord: true });
      const [row, waiting] = rowGroupsView(state);
      expect(row).toMatchObject({
        sentence: view(2, 'in_front_of', 0, 3),
        mark: 'clash',
        members: [{ clash: true }, { clash: true }],
      });
      expect(waiting).toMatchObject({ sentence: view(4, 'in_front_of', 5), mark: 'none', reason: { key: 'waiting' } });
      const removed = play(state, { type: 'row_removed', key: row!.key });
      expect(effectsOf(removed.effects, 'commit').map((effect) => effect.constraints)).toEqual([[[4, 5, -1]]]);
      expect(commits(removed).state.settle).toEqual({ kind: 'settled' });
    });

    it('a clash inside one grouped row: its trash takes both, as one undo step that brings them back with the clash (#539’s review)', () => {
      const facts = openFactsOf({
        restore: {
          outcome: { kind: 'clash', constraints: [0, 1] },
          carried: [
            carried({ index: 0, status: { status: 'clashing' }, subject: 2, object: 0, sign: 1, constraint: [2, 0, 1] }),
            carried({ index: 1, status: { status: 'clashing' }, subject: 2, object: 3, sign: -1, constraint: [2, 3, -1] }),
            carried({ index: 2, status: { status: 'intact' }, subject: 4, object: 5, sign: -1, constraint: [4, 5, -1] }),
          ],
        },
      });
      const { state } = opened(facts, { hasRecord: true });
      const rows = rowGroupsView(state);
      expect(rows.map((r) => r.members.length)).toEqual([2, 1]);
      const trashed = play(state, { type: 'row_removed', key: rows[0]!.key });
      expect(trashed.state.rows.carried.map((r) => r.facts.index)).toEqual([2]);
      expect(trashed.state.history.past.map((entry) => entry.kind)).toEqual(['list']);
      expect(lastOf(trashed.effects, 'commit').constraints).toEqual([[4, 5, -1]]);
      const settled = commits(trashed, Uint32Array.of(0, 2, 2, 3));
      expect(settled.state.settle).toEqual({ kind: 'settled' });
      expect(listControls(settled.state).undo).toBe(true);
      // Undo: the two clashing rows are back, unsettled, and Apply waits on them again.
      const undone = commits(play(settled.state, { type: 'undo' }), OPEN_PAIRS);
      expect(undone.state.rows.carried.map((r) => r.facts.index)).toEqual([0, 1, 2]);
      expect(undone.state.rows.committed).toEqual([]);
      expect(undone.state.settle).toMatchObject({ kind: 'clash' });
      expect(rowGroupsView(undone.state)[0]).toMatchObject({ mark: 'clash', members: [{ clash: true }, { clash: true }] });
    });

    it('a row whose own constraints are the whole clash says they can’t all fit together, naming them', () => {
      // 2 in front of 0 and of 3 clash with each other and nothing else; 4 in front of 5 waits.
      const clashing = openFactsOf({
        restore: {
          outcome: { kind: 'clash', constraints: [0, 1] },
          carried: [
            carried({ index: 0, status: { status: 'clashing' }, subject: 2, object: 0, constraint: [2, 0, 1] }),
            carried({ index: 1, status: { status: 'clashing' }, subject: 2, object: 3, sign: -1, constraint: [2, 3, -1] }),
            carried({ index: 2, subject: 4, object: 5, sign: -1, constraint: [4, 5, -1] }),
          ],
        },
      });
      const { state } = opened(clashing, { hasRecord: true });
      const [row] = rowGroupsView(state);
      expect(row).toMatchObject({ mark: 'clash', reason: { key: 'clash_within', sentence: view(2, 'in_front_of', 0, 3) } });
      // The attention line groups the clash as the list does.
      expect(hintLine(state)?.text).toEqual({
        key: 'attention_clash',
        clashes: [view(2, 'in_front_of', 0, 3)],
        explaining: false,
      });
      // Pointing at the row leaves the line on the clash, as a clashing row always has.
      expect(hintLine(play(state, { type: 'row_hovered', key: row!.key }).state)?.text.key).toBe('attention_clash');
      // With a third member outside the clash, the reason names only the two that clash.
      const wider = openFactsOf({
        restore: {
          outcome: { kind: 'clash', constraints: [0, 1] },
          carried: [
            carried({ index: 0, status: { status: 'clashing' }, subject: 2, object: 0, constraint: [2, 0, 1] }),
            carried({ index: 1, status: { status: 'clashing' }, subject: 2, object: 3, sign: -1, constraint: [2, 3, -1] }),
            carried({ index: 2, subject: 2, object: 5, sign: -1, constraint: [2, 5, -1] }),
          ],
        },
      });
      const [three] = rowGroupsView(opened(wider, { hasRecord: true }).state);
      expect(three).toMatchObject({
        sentence: view(2, 'in_front_of', 0, 3, 5),
        members: [{ clash: true }, { clash: true }, { clash: false }],
        reason: { key: 'clash_within', sentence: view(2, 'in_front_of', 0, 3) },
      });
    });

    it('rows that can still apply group together, intact or clashing, and mark their clash per constraint', () => {
      // 2 in front of 0 clashed at the restore, 2 in front of 3 was intact: one row.
      const facts = openFactsOf({
        restore: {
          outcome: { kind: 'clash', constraints: [0, 2] },
          carried: [
            carried({ index: 0, status: { status: 'clashing' }, subject: 2, object: 0, constraint: [2, 0, 1] }),
            carried({ index: 1, subject: 2, object: 3, sign: -1, constraint: [2, 3, -1] }),
            carried({ index: 2, status: { status: 'clashing' }, subject: 4, object: 5, sign: -1, constraint: [4, 5, -1] }),
          ],
        },
      });
      const { state } = opened(facts, { hasRecord: true });
      expect(rowGroupsView(state).map((row) => [row.sentence, row.members.map((m) => m.clash)])).toEqual([
        [view(2, 'in_front_of', 0, 3), [true, false]],
        [view(4, 'in_front_of', 5), [true]],
      ]);
      // After 4 in front of 5 goes, the re-check finds the two left clash: one row, both marked.
      const fourFive = state.rows.carried[2]!.id;
      const removed = play(state, trashOf(state, fourFive));
      const commit = lastOf(removed.effects, 'commit');
      const still = play(removed.state, {
        type: 'committed',
        request: commit.request,
        facts: { verdict: 'cant_fit', constraints: [0, 1] },
      });
      expect(rowGroupsView(still.state).map((row) => [row.sentence, row.mark, row.members.map((m) => m.clash)])).toEqual([
        [view(2, 'in_front_of', 0, 3), 'clash', [true, true]],
      ]);
    });
  });
});

// ---------------------------------------------------------------------------

describe('a one-object sentence behaves as it always did', () => {
  it('previews, adds and lists one constraint, with the same effects as before', () => {
    const p = sentenceOf(opened().state, 2, 0);
    expect(effectsOf(p.effects, 'preview')).toEqual([
      { type: 'preview', request: 2, constraints: [[2, 0, 1]], limits: LAYER_ORDER_LIMITS.preview },
    ]);
    const added = play(fits(p, 7, SPOTS_TWO_OVER_ZERO, changedSpots([1], [1])).state, { type: 'add' });
    expect(lastOf(added.effects, 'commit')).toMatchObject({ constraints: [[2, 0, 1]], token: 7 });
    const landed = commits(added, Uint32Array.of(2, 3, 4, 5));
    expect(rowGroupsView(landed.state).map((row) => row.members.length)).toEqual([1]);
    expect(lastOf(landed.effects, 'track').fact).toEqual(constraintAddedFact('in_front_of', 'pattern', 'folded', 1));
  });
});
