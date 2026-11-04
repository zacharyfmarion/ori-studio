/**
 * What the panes and the inspector read: the hint line's quiet rules
 * (Round3:1384-1395), the tints and labels (Round3:1301-1326), open spots,
 * and the refusal messages. The waiting and attention lines are tested with
 * the reducer, where those states are made.
 */
import { describe, expect, it } from 'vitest';
import { dispatch, openFactsOf, opened, picked, play } from './layerOrderModel.fixtures';
import { hintLine, listControls, openSpotsOf, paneMarks, refusalMessage } from './layerOrderSelectors';

const hint = (text: unknown) => ({ tone: 'quiet', action: null, text });

describe('the hint line, choosing a subject', () => {
  it('with nothing hovered: “Pick a face · N faces have choices”', () => {
    expect(hintLine(opened().state)).toEqual(hint({ key: 'pick_face', choosers: 5 }));
  });

  it('pointing at a face says what it would offer, pickable or not', () => {
    const { state } = opened();
    expect(hintLine(dispatch(state, { type: 'face_hovered', face: 2 }).state)).toEqual(
      hint({ key: 'face_choices', face: 2, choices: 2 })
    );
    expect(hintLine(dispatch(state, { type: 'face_hovered', face: 1 }).state)).toEqual(
      hint({ key: 'face_nothing_left', face: 1, why: 'settled' })
    );
    expect(hintLine(dispatch(state, { type: 'face_hovered', face: 6 }).state)).toEqual(
      hint({ key: 'face_nothing_left', face: 6, why: 'no_overlap' })
    );
  });

  it('a hovered slot wins over the panes', () => {
    const hovered = play(opened().state, { type: 'face_hovered', face: 2 }, { type: 'slot_hovered', slot: 'subject' });
    expect(hintLine(hovered.state)).toEqual(hint({ key: 'pick_face', choosers: 5 }));
  });

  it('with the subject slot active again over a subject: “Pick a face to replace C”', () => {
    const replacing = play(
      opened().state,
      { type: 'face_picked', face: 2, origin: 'pattern' },
      { type: 'slot_activated', slot: 'subject' }
    );
    expect(hintLine(replacing.state)).toEqual(hint({ key: 'replace_subject', subject: 2, choosers: 5 }));
  });

  it('when every overlap is settled, it says so', () => {
    expect(hintLine(opened(openFactsOf({ openPairs: new Uint32Array() })).state)).toEqual(hint({ key: 'all_settled' }));
  });
});

describe('the hint line, choosing an object', () => {
  it('“Pick one of the N labelled faces”', () => {
    const subject = dispatch(opened().state, { type: 'face_picked', face: 2, origin: 'pattern' });
    expect(hintLine(subject.state)).toEqual(hint({ key: 'pick_object', objects: 2, tinted: false }));
  });

  it('a subject with one open face: “D is the only face to choose”', () => {
    const full = picked(opened().state, 4, 5);
    // The preview runs; the line says it is checking until the answer arrives.
    expect(hintLine(full.state)?.text.key).toBe('checking');
    const fitted = play(full.state, {
      type: 'previewed',
      request: 2,
      facts: {
        verdict: 'fits',
        token: 1,
        changed: { front: new Uint32Array(), back: new Uint32Array() },
        stacks: full.state.shown!,
      },
    });
    expect(hintLine(fitted.state)).toEqual(hint({ key: 'only_object', object: 5 }));
  });
});

describe('the panes’ tints and labels', () => {
  it('choosing a subject, every face with choices is pickable and faint; nothing is labelled', () => {
    const marks = paneMarks(opened().state);
    expect(marks).toMatchObject({ active: 'subject', subject: null, pickable: [0, 2, 3, 4, 5], labelled: [], lit: [] });
  });

  it('a face lights only when the active slot can take it', () => {
    const { state } = opened();
    expect(paneMarks(dispatch(state, { type: 'face_hovered', face: 1 }).state).lit).toEqual([]);
    expect(paneMarks(dispatch(state, { type: 'face_hovered', face: 2 }).state).lit).toEqual([2]);
  });

  it('with a subject, its open faces are the pickable objects, labelled with it on both panes', () => {
    const subject = dispatch(opened().state, { type: 'face_picked', face: 2, origin: 'pattern' });
    expect(paneMarks(subject.state)).toMatchObject({
      active: 'object',
      subject: 2,
      pickable: [0, 3],
      objects: [0, 3],
      labelled: [2, 0, 3],
    });
    // A face outside them is inert: it doesn't light.
    expect(paneMarks(dispatch(subject.state, { type: 'face_hovered', face: 4 }).state).lit).toEqual([]);
  });

  it('a hovered slot lights its face', () => {
    const full = picked(opened().state, 2, 0);
    expect(paneMarks(dispatch(full.state, { type: 'slot_hovered', slot: 'subject' }).state).lit).toEqual([2]);
    expect(paneMarks(dispatch(full.state, { type: 'slot_hovered', slot: 'object' }).state).lit).toEqual([0]);
  });

  it('nothing is pickable while the dialog is still opening', () => {
    const { state } = opened();
    const closing = { ...state, phase: { kind: 'opening' as const, request: 9, limits: { maxNodes: 1, fastNodes: 1, deadlineMs: 1 } } };
    expect(paneMarks(closing).pickable).toEqual([]);
    expect(hintLine(closing)).toBeNull();
    expect(listControls(closing)).toMatchObject({ undo: false, clearAll: false, clearSentence: false, remove: false });
  });
});

describe('open spots', () => {
  it('are the spots whose face in front still has an open pair there, from the side shown', () => {
    const { state } = opened();
    expect(openSpotsOf(state, 'front')).toEqual([1, 2, 4]);
    expect(openSpotsOf(state, 'back')).toEqual([1, 2, 4]);
    expect(openSpotsOf(opened(openFactsOf({ openPairs: Uint32Array.of(4, 5) })).state)).toEqual([4]);
  });
});

describe('refusals, by code', () => {
  it('name the face, and offer Keep trying only for a timeout', () => {
    expect(refusalMessage({ code: 'source_non_convex_face', face: 4 })).toEqual({ key: 'non_convex_face', face: 4, retry: null });
    expect(refusalMessage({ code: 'source_digest_mismatch', expected: 'a', actual: 'b' })).toEqual({
      key: 'digest_mismatch',
      retry: null,
    });
    expect(refusalMessage({ code: 'session_timed_out', limit: 'nodes', nodes: 1 })).toEqual({
      key: 'open_timed_out',
      retry: 'keep_trying',
    });
    expect(refusalMessage({ code: 'source_too_many_faces', face_count: 5000, limit: 4096 }).key).toBe('too_large');
    expect(refusalMessage({ code: 'record_newer' }).key).toBe('record_newer');
    expect(refusalMessage({ code: 'record_damaged', damage: 'not-json' }).key).toBe('record_unreadable');
    expect(refusalMessage({ code: 'source_kernel', kernel_code: 'x' })).toEqual({
      key: 'source_unreadable',
      code: 'source_kernel',
      retry: null,
    });
  });
});
