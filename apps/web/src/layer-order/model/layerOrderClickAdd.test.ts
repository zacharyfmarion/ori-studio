/**
 * A plain click adds (`clickAdd`): once a subject is picked, a plain click on
 * one of its faces adds the sentence as soon as its check fits, as Add would;
 * Shift+click and the face menus only pick (`adds` left out), so a sentence of
 * several objects is built with Shift and added with Add or one more click.
 */
import { describe, expect, it } from 'vitest';
import { constraintAddedFact } from './layerOrderAnalytics';
import {
  SPOTS_TWO_OVER_ZERO,
  changedSpots,
  commits,
  effectsOf,
  fits,
  lastOf,
  opened,
  play,
  sidesOf,
  type Played,
} from './layerOrderModel.fixtures';
import { addState, hintLine } from './layerOrderSelectors';
import { EMPTY_SENTENCE } from './layerOrderSentence';
import type { LayerOrderAction } from './layerOrderState';

/** A plain click on the folded pane. */
const click = (face: number): LayerOrderAction => ({ type: 'face_picked', face, origin: 'folded', adds: true });
/** A Shift+click on the crease pattern: a pick, no add. */
const shift = (face: number): LayerOrderAction => ({ type: 'face_picked', face, origin: 'pattern' });
const OPEN_AFTER_TWO_OVER_ZERO = Uint32Array.of(2, 3, 4, 5);

/** Open, then plain-click subject 2 and its face 0: "2 in front of 0", checking. */
function clickedTwoOverZero(): Played {
  return play(opened().state, { type: 'face_picked', face: 2, origin: 'pattern', adds: true }, click(0));
}

function cantFit(played: Played): Played {
  return play(played.state, {
    type: 'previewed',
    request: lastOf(played.effects, 'preview').request,
    facts: { verdict: 'cant_fit', constraints: [0] },
  });
}

describe('a plain click adds', () => {
  it('a click on the subject only picks it; a click on one of its faces checks the sentence, then adds it', () => {
    const subject = play(opened().state, { type: 'face_picked', face: 2, origin: 'pattern', adds: true });
    expect(subject.state.clickAdd).toBeNull();
    expect(subject.state.sentence).toMatchObject({ subject: 2, objects: [] });

    const clicked = play(subject.state, click(0));
    expect(clicked.state.clickAdd).toBe('checking');
    expect(clicked.state.sentence).toMatchObject({ subject: 2, objects: [0] });
    expect(lastOf(clicked.effects, 'preview').constraints).toEqual([[2, 0, 1]]);
    expect(effectsOf(clicked.effects, 'commit')).toEqual([]);

    // The check fits: added at once, with its token, as Add would.
    const fit = fits(clicked, 9);
    expect(fit.state.clickAdd).toBe('adding');
    expect(lastOf(fit.effects, 'commit')).toMatchObject({ constraints: [[2, 0, 1]], token: 9 });

    const landed = commits(fit, OPEN_AFTER_TWO_OVER_ZERO, SPOTS_TWO_OVER_ZERO);
    expect(landed.state.clickAdd).toBeNull();
    expect(landed.state.rows.committed.map((row) => row.constraint)).toEqual([[2, 0, 1]]);
    // Add clears the sentence, whatever added it.
    expect(landed.state.sentence).toEqual(EMPTY_SENTENCE);
    expect(lastOf(landed.effects, 'track').fact).toEqual(constraintAddedFact('in_front_of', 'pattern', 'folded', 1, 'click'));
  });

  it('a sentence already checked and fitting is added by the click at once', () => {
    const built = fits(play(opened().state, shift(2), shift(0)));
    const dropped = play(built.state, shift(0));
    const clicked = play(dropped.state, click(0));
    expect(effectsOf(clicked.effects, 'preview')).toEqual([]);
    expect(lastOf(clicked.effects, 'commit')).toMatchObject({ constraints: [[2, 0, 1]], token: 7 });
    expect(clicked.state.clickAdd).toBe('adding');
  });

  it('Shift+click only picks; a plain click on one more face adds them all, as one Add', () => {
    const gathered = play(opened().state, shift(2), shift(0));
    expect(gathered.state.clickAdd).toBeNull();
    expect(gathered.state.sentence.objects).toEqual([0]);
    expect(effectsOf(fits(gathered).effects, 'commit')).toEqual([]);

    const clicked = play(fits(gathered).state, click(3));
    expect(clicked.state.sentence.objects).toEqual([0, 3]);
    const landed = commits(fits(clicked), Uint32Array.of(4, 5));
    expect(landed.state.rows.committed.map((row) => row.constraint)).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    expect(lastOf(landed.effects, 'track').fact).toEqual(constraintAddedFact('in_front_of', 'pattern', 'pattern', 2, 'click'));
  });

  it('a sentence that can’t fit is not added: the reason shows, and the next click tries its face instead', () => {
    const refused = cantFit(clickedTwoOverZero());
    expect(refused.state.clickAdd).toBeNull();
    expect(effectsOf(refused.effects, 'commit')).toEqual([]);
    expect(refused.state.sentence).toMatchObject({ subject: 2, objects: [0] });
    expect(hintLine(refused.state)?.text.key).toBe('cant_fit');
    expect(addState(refused.state)).toMatchObject({ enabled: false, why: 'cant_fit' });

    // 0 was only this click's: a click on 3 tries "2 in front of 3", not "0, 3".
    const next = play(refused.state, click(3));
    expect(next.state.sentence.objects).toEqual([3]);
    expect(lastOf(next.effects, 'preview').constraints).toEqual([[2, 3, -1]]);
    expect(next.state.clickAdd).toBe('checking');
  });

  it('a check that runs out is not added: Keep trying checks again, and Add or a click adds once it fits', () => {
    const clicked = clickedTwoOverZero();
    const out = play(clicked.state, {
      type: 'previewed',
      request: lastOf(clicked.effects, 'preview').request,
      facts: { verdict: 'timed_out' },
    });
    expect(out.state.clickAdd).toBeNull();
    expect(hintLine(out.state)).toMatchObject({ action: 'keep_trying', text: { key: 'timed_out' } });
    const again = fits(play(out.state, { type: 'keep_trying' }));
    expect(effectsOf(again.effects, 'commit')).toEqual([]);
    expect(addState(again.state).enabled).toBe(true);
    // A click on the face again adds it.
    expect(lastOf(play(again.state, click(0)).effects, 'commit')).toMatchObject({ constraints: [[2, 0, 1]] });
  });

  it('takes no picks and no empty-paper clicks while its add is checking or adding', () => {
    const clicked = clickedTwoOverZero();
    for (const action of [click(3), shift(3), { type: 'ground_clicked' } as const]) {
      const ignored = play(clicked.state, action);
      expect(ignored.state).toBe(clicked.state);
      expect(ignored.effects).toEqual([]);
    }
    const adding = fits(clicked);
    for (const action of [click(3), shift(4), { type: 'ground_clicked' } as const]) {
      expect(play(adding.state, action).state).toBe(adding.state);
    }
    // Once it lands, a click picks again: a new subject, since the sentence cleared.
    const landed = commits(adding, OPEN_AFTER_TWO_OVER_ZERO, SPOTS_TWO_OVER_ZERO);
    expect(play(landed.state, click(3)).state.sentence).toMatchObject({ subject: 3, objects: [] });
  });

  it('while it checks, another edit of the sentence lets go of it: Escape’s Clear, the verb, the side', () => {
    const clicked = clickedTwoOverZero();
    const preview = lastOf(clicked.effects, 'preview');
    const fitFacts = { verdict: 'fits', token: 7, changed: changedSpots([1]), stacks: sidesOf(SPOTS_TWO_OVER_ZERO) } as const;

    const cleared = play(clicked.state, { type: 'sentence_cleared' });
    expect(cleared.state.clickAdd).toBeNull();
    expect(cleared.state.sentence).toMatchObject({ subject: null, objects: [] });
    const late = play(cleared.state, { type: 'previewed', request: preview.request, facts: fitFacts });
    expect(effectsOf(late.effects, 'commit')).toEqual([]);

    const verb = play(clicked.state, { type: 'verb_set', verb: 'behind' });
    expect(verb.state.clickAdd).toBeNull();
    expect(effectsOf(play(verb.state, { type: 'previewed', request: preview.request, facts: fitFacts }).effects, 'commit')).toEqual([]);

    const turned = play(clicked.state, { type: 'side_set', side: 'back' });
    expect(turned.state.clickAdd).toBeNull();
    // The same verb again is no edit: it still adds.
    expect(play(clicked.state, { type: 'verb_set', verb: 'in_front_of' }).state.clickAdd).toBe('checking');
  });

  it('once it is committing it lands whatever happens: Escape clears the sentence, and the sentence stays clear', () => {
    const adding = fits(clickedTwoOverZero());
    // Carried on from the commit asked, which nothing asks again.
    const cleared = play(adding, { type: 'sentence_cleared' });
    expect(cleared.state.clickAdd).toBe('adding');
    expect(effectsOf(cleared.effects, 'commit')).toHaveLength(1);
    const landed = commits(cleared, OPEN_AFTER_TWO_OVER_ZERO, SPOTS_TWO_OVER_ZERO);
    expect(landed.state.rows.committed).toHaveLength(1);
    expect(landed.state.clickAdd).toBeNull();
    expect(landed.state.sentence).toMatchObject({ subject: null, objects: [] });
    expect(lastOf(landed.effects, 'track').fact).toMatchObject({ properties: { added_by: 'click' } });
  });

  it('says what it adds while the commit is in the worker, for a click and for Add alike', () => {
    const adding = fits(clickedTwoOverZero());
    const addingHint = {
      tone: 'busy',
      action: null,
      text: { key: 'adding', sentence: { subject: 2, verb: 'in_front_of', objects: [0] } },
    };
    expect(hintLine(adding.state)).toEqual(addingHint);
    const byButton = play(fits(play(opened().state, shift(2), shift(0))).state, { type: 'add' });
    expect(hintLine(byButton.state)).toEqual(addingHint);
  });

  it('a click while Add’s own commit is in the worker waits for it, then adds what is left', () => {
    const byButton = play(fits(play(opened().state, shift(2), shift(0))).state, { type: 'add' });
    const clicked = play(byButton, click(3));
    expect(clicked.state.clickAdd).toBe('checking');
    expect(clicked.state.sentence.objects).toEqual([0, 3]);
    // Add's commit lands: 0 is settled, 3 is left, checked, and added by the click.
    const landed = commits(clicked, OPEN_AFTER_TWO_OVER_ZERO, SPOTS_TWO_OVER_ZERO);
    expect(lastOf(landed.effects, 'track').fact).toMatchObject({ properties: { added_by: 'button' } });
    expect(landed.state.sentence.objects).toEqual([3]);
    expect(landed.state.clickAdd).toBe('checking');
    const second = commits(fits(landed), Uint32Array.of(4, 5));
    expect(second.state.rows.committed.map((row) => row.constraint)).toEqual([
      [2, 0, 1],
      [2, 3, -1],
    ]);
    expect(lastOf(second.effects, 'track').fact).toMatchObject({ properties: { added_by: 'click' } });
  });

  it('a lost engine lets go of it', () => {
    const lost = play(clickedTwoOverZero().state, { type: 'engine_lost' });
    expect(lost.state.clickAdd).toBeNull();
  });
});
