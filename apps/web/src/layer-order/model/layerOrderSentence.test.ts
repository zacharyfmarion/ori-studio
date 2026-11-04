/**
 * The builder's rules, each against the approved artboard's function it
 * mirrors (Round3 = `artifacts/layer-order-design/project/Round3.dc.html`).
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_SENTENCE,
  LAYER_VERBS,
  activateSlot,
  candidatesOf,
  clearSentence,
  clearSlot,
  facesWithChoices,
  groundClick,
  isComplete,
  keepOpenObjects,
  objectOriginOf,
  openIndexOf,
  openPartners,
  pickFace,
  removeObject,
  revealSubject,
  setVerb,
  slotNow,
  subjectStuck,
  type LayerSentence,
} from './layerOrderSentence';

// The fixture figure's (`layerOrderModel.fixtures.ts`): open pairs 0–2, 2–3, 4–5; 1 is settled, 6 overlaps nothing.
const OPEN_PAIRS = Uint32Array.of(0, 2, 2, 3, 4, 5);
const FRONT_UP = Uint8Array.of(1, 0, 1, 0, 1, 0, 1);
const open = openIndexOf(OPEN_PAIRS);
const pick = (sentence: LayerSentence, ...faces: number[]) =>
  faces.reduce((s, face) => pickFace(s, open, face, 'pattern'), sentence);

describe('open pairs', () => {
  it('index each face’s open faces both ways, ascending', () => {
    expect(openPartners(open, 2)).toEqual([0, 3]);
    expect(openPartners(open, 0)).toEqual([2]);
    expect(openPartners(open, 1)).toEqual([]);
    expect(openPartners(open, null)).toEqual([]);
    expect(facesWithChoices(open)).toEqual([0, 2, 3, 4, 5]);
  });

  it('the verbs come from one list, “in front of” first and the default', () => {
    expect(LAYER_VERBS).toEqual(['in_front_of', 'behind']);
    expect(EMPTY_SENTENCE.verb).toBe('in_front_of');
  });
});

describe('picking a face (Round3 pickFace, slotNow)', () => {
  it('fills the subject slot first, then the object', () => {
    expect(slotNow(EMPTY_SENTENCE, open)).toBe('subject');
    const s = pick(EMPTY_SENTENCE, 2);
    expect(s).toMatchObject({ subject: 2, objects: [], active: 'object', subjectOrigin: 'pattern' });
    expect(slotNow(s, open)).toBe('object');
    expect(pick(s, 3)).toMatchObject({ subject: 2, objects: [3], active: 'object' });
  });

  it('only faces with open faces can be the subject; any other is inert', () => {
    // 1 overlaps faces it is settled with; 6 overlaps nothing.
    expect(pick(EMPTY_SENTENCE, 1)).toBe(EMPTY_SENTENCE);
    expect(pick(EMPTY_SENTENCE, 6)).toBe(EMPTY_SENTENCE);
  });

  it('a subject’s offered objects are its open faces; any other is inert', () => {
    const s = pick(EMPTY_SENTENCE, 0);
    expect(pick(s, 3)).toBe(s);
    expect(pick(s, 4)).toBe(s);
    expect(pick(s, 2).objects).toEqual([2]);
  });

  it('records where each face was picked, for the analytics', () => {
    const s = pickFace(pickFace(EMPTY_SENTENCE, open, 2, 'folded'), open, 3, 'menu');
    expect(s).toMatchObject({ subjectOrigin: 'folded', objectPicks: [{ face: 3, origin: 'menu' }] });
    expect(objectOriginOf(s)).toBe('menu');
  });
});

describe('changing the subject (Round3 setSubject)', () => {
  it('keeps the object when it is still open with the new subject', () => {
    const s = activateSlot(pick(EMPTY_SENTENCE, 0, 2), open, 'subject');
    // 3 is open with 2: picking 3 as the subject keeps 2.
    expect(pick(s, 3)).toMatchObject({ subject: 3, objects: [2], active: 'object' });
  });

  it('clears the object quietly when it is not', () => {
    const s = activateSlot(pick(EMPTY_SENTENCE, 2, 3), open, 'subject');
    expect(pick(s, 4)).toMatchObject({ subject: 4, objects: [], objectPicks: [], active: 'object' });
  });
});

describe('a click on empty paper (Round3 groundClick)', () => {
  it('clears the object, then the subject, then nothing is left', () => {
    const full = pick(EMPTY_SENTENCE, 2, 3);
    const once = groundClick(full);
    expect(once).toMatchObject({ subject: 2, objects: [], active: 'object' });
    const twice = groundClick(once);
    expect(twice).toMatchObject({ subject: null, objects: [], active: 'subject' });
    expect(groundClick(twice)).toBe(twice);
  });

  it('clears the subject when the subject slot is the one being filled', () => {
    const s = activateSlot(pick(EMPTY_SENTENCE, 2, 3), open, 'subject');
    expect(groundClick(s)).toMatchObject({ subject: null, objects: [3], active: 'subject' });
  });
});

describe('the slots (Round3 activate, clearSlot, clearSentence)', () => {
  it('the object slot can’t be made active with no subject, or a subject with nothing left', () => {
    expect(activateSlot(EMPTY_SENTENCE, open, 'object')).toBe(EMPTY_SENTENCE);
    const stuck = revealSubject(EMPTY_SENTENCE, 1);
    expect(activateSlot({ ...stuck, active: 'subject' }, open, 'object').active).toBe('subject');
  });

  it('clearing the subject keeps the object, which the next subject keeps if it is open with it', () => {
    const s = clearSlot(pick(EMPTY_SENTENCE, 2, 3), 'subject');
    expect(s).toMatchObject({ subject: null, objects: [3], active: 'subject' });
    expect(pick(s, 2)).toMatchObject({ subject: 2, objects: [3] });
  });

  it('Clear empties both faces but keeps the verb; Add’s empty sentence resets it', () => {
    const s = setVerb(pick(EMPTY_SENTENCE, 2, 3), 'behind');
    expect(clearSentence(s)).toMatchObject({ subject: null, objects: [], verb: 'behind', active: 'subject' });
    expect(EMPTY_SENTENCE).toMatchObject({ subject: null, objects: [], verb: 'in_front_of', active: 'subject' });
  });
});

describe('a row’s subject in the builder (Round3 reveal)', () => {
  it('puts the subject in, with the object slot active', () => {
    const s = revealSubject(pick(EMPTY_SENTENCE, 4, 5), 2);
    expect(s).toMatchObject({ subject: 2, objects: [], active: 'object', subjectOrigin: 'list' });
    expect(slotNow(s, open)).toBe('object');
  });

  it('a subject with nothing left to choose keeps the subject slot active', () => {
    const s = revealSubject(EMPTY_SENTENCE, 1);
    expect(subjectStuck(s, open)).toBe(true);
    expect(slotNow(s, open)).toBe('subject');
    // The next click replaces it.
    expect(pick(s, 2)).toMatchObject({ subject: 2, active: 'object' });
  });
});

describe('after a commit (Round3 commit)', () => {
  it('keeps the sentence unless the object is no longer open with the subject', () => {
    const s = pick(EMPTY_SENTENCE, 2, 3);
    expect(keepOpenObjects(s, open)).toBe(s);
    const later = openIndexOf(Uint32Array.of(0, 2, 4, 5));
    expect(keepOpenObjects(s, later)).toMatchObject({ subject: 2, objects: [] });
    expect(isComplete(keepOpenObjects(s, later), later)).toBe(false);
  });
});

describe('the sentence as a constraint (Round3 sentenceCons)', () => {
  it('is paper-relative: the same sentence read from the back is the other constraint', () => {
    const s = pick(EMPTY_SENTENCE, 2, 0);
    expect(candidatesOf(s, open, 'in_front_of', 'front', FRONT_UP)).toEqual([[2, 0, 1]]);
    expect(candidatesOf(s, open, 'in_front_of', 'back', FRONT_UP)).toEqual([[2, 0, -1]]);
    expect(candidatesOf(s, open, 'behind', 'back', FRONT_UP)).toEqual([[2, 0, 1]]);
  });

  it('is null until the sentence is complete', () => {
    expect(candidatesOf(pick(EMPTY_SENTENCE, 2), open, 'in_front_of', 'front', FRONT_UP)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// D21: compound constraints. One subject, one or more objects.

// Face 2 is open with 0, 3 and 5 here, so it can take three objects.
const wide = openIndexOf(Uint32Array.of(0, 2, 2, 3, 2, 5, 4, 5));
// Letters by reading order: 5 is A, 3 is B, 0 is C, so letter order is 5, 3, 0 (ranks by face).
const RANKS = Uint32Array.of(2, 6, 3, 1, 4, 0, 5);
const pickWide = (sentence: LayerSentence, ...faces: number[]) =>
  faces.reduce((s, face) => pickFace(s, wide, face, 'pattern', RANKS), sentence);

describe('compound constraints (D21)', () => {
  it('in the object step a pick on an unpicked face adds it, and on a picked one removes it', () => {
    const two = pickWide(EMPTY_SENTENCE, 2, 0, 3);
    expect(two).toMatchObject({ subject: 2, objects: [3, 0], active: 'object' });
    expect(pickWide(two, 0)).toMatchObject({ subject: 2, objects: [3], active: 'object' });
    // Removing the last leaves the object step, with no objects and no origin.
    expect(pickWide(two, 0, 3)).toMatchObject({ subject: 2, objects: [], objectPicks: [], active: 'object' });
  });

  it('objects read in letter order, whatever order they were picked in', () => {
    expect(pickWide(EMPTY_SENTENCE, 2, 0, 5, 3).objects).toEqual([5, 3, 0]);
    expect(pickWide(EMPTY_SENTENCE, 2, 3, 0, 5).objects).toEqual([5, 3, 0]);
    // Without letters, faces read by number.
    expect(pick(pick(EMPTY_SENTENCE, 2, 3), 0).objects).toEqual([0, 3]);
  });

  it('a face the subject is not open with stays inert, picked objects or not', () => {
    const s = pickWide(EMPTY_SENTENCE, 2, 0);
    expect(pickWide(s, 4)).toBe(s);
    expect(pickWide(s, 2)).toBe(s);
  });

  it('keeps each object’s origin, in pick order: the object origin is the first remaining one’s', () => {
    const s = pickFace(pickFace(pickFace(EMPTY_SENTENCE, wide, 2, 'pattern'), wide, 0, 'menu'), wide, 3, 'folded');
    expect(s.objectPicks).toEqual([
      { face: 0, origin: 'menu' },
      { face: 3, origin: 'folded' },
    ]);
    expect(objectOriginOf(s)).toBe('menu');
    // The first object goes: the origin is the next one's, not the removed one's.
    const without = pickFace(s, wide, 0, 'menu');
    expect(without).toMatchObject({ objects: [3], objectPicks: [{ face: 3, origin: 'folded' }] });
    expect(objectOriginOf(without)).toBe('folded');
    expect(objectOriginOf(removeObject(without, 3))).toBeNull();
  });

  it('a new subject keeps each object still open with it and drops the rest quietly', () => {
    // 2 with 0 and 5; 5 is open with 2 and 4, 0 only with 2. With 4 as the subject, 5 stays.
    const s = activateSlot(pickWide(EMPTY_SENTENCE, 2, 0, 5), wide, 'subject');
    expect(pickWide(s, 4)).toMatchObject({
      subject: 4,
      objects: [5],
      objectPicks: [{ face: 5, origin: 'pattern' }],
      active: 'object',
    });
  });

  it('a pick of one of the objects as the subject removes it from the objects', () => {
    // 2, 3 and 5 are each open with the other two: 2 with 3 and 5, then 3 as the subject keeps 5 alone.
    const triangle = openIndexOf(Uint32Array.of(2, 3, 2, 5, 3, 5));
    const built = [2, 3, 5].reduce((sentence, face) => pickFace(sentence, triangle, face, 'pattern'), EMPTY_SENTENCE);
    const s = activateSlot(built, triangle, 'subject');
    expect(s.objects).toEqual([3, 5]);
    expect(pickFace(s, triangle, 3, 'folded')).toMatchObject({ subject: 3, objects: [5], subjectOrigin: 'folded' });
  });

  it('a click on empty paper clears every object, then the subject', () => {
    const once = groundClick(pickWide(EMPTY_SENTENCE, 2, 0, 3, 5));
    expect(once).toMatchObject({ subject: 2, objects: [], active: 'object' });
    expect(groundClick(once)).toMatchObject({ subject: null, objects: [] });
  });

  it('an object chip’s × removes that object whichever slot is active, and never the subject', () => {
    const s = pickWide(EMPTY_SENTENCE, 2, 0, 3);
    expect(removeObject(s, 3)).toMatchObject({ subject: 2, objects: [0], objectPicks: [{ face: 0 }], active: 'object' });
    const replacing = activateSlot(s, wide, 'subject');
    expect(removeObject(replacing, 0)).toMatchObject({ subject: 2, objects: [3], active: 'subject' });
    // The last object: none left, and the object slot stays active.
    expect(removeObject(pickWide(EMPTY_SENTENCE, 2, 0), 0)).toMatchObject({
      subject: 2,
      objects: [],
      objectPicks: [],
      active: 'object',
    });
    // A face that is not an object changes nothing.
    expect(removeObject(s, 5)).toBe(s);
    expect(removeObject(s, 2)).toBe(s);
  });

  it('the object slot’s × clears every object', () => {
    expect(clearSlot(pickWide(EMPTY_SENTENCE, 2, 0, 3), 'object')).toMatchObject({ subject: 2, objects: [], objectPicks: [] });
  });

  it('after a commit, each object no longer open with the subject goes, and the rest stay', () => {
    const s = pickWide(EMPTY_SENTENCE, 2, 0, 3, 5);
    const later = openIndexOf(Uint32Array.of(2, 3, 2, 5));
    expect(keepOpenObjects(s, later)).toMatchObject({
      subject: 2,
      objects: [5, 3],
      objectPicks: [{ face: 3 }, { face: 5 }],
    });
    expect(keepOpenObjects(s, wide)).toBe(s);
  });

  it('is one constraint per object, in letter order, each signed by how its object faces', () => {
    // From the front, 2 in front of 0 (front up) is sign 1, of 3 and 5 (back up) sign -1.
    const s = pickWide(EMPTY_SENTENCE, 2, 0, 3, 5);
    expect(candidatesOf(s, wide, 'in_front_of', 'front', FRONT_UP)).toEqual([
      [2, 5, -1],
      [2, 3, -1],
      [2, 0, 1],
    ]);
    expect(isComplete(s, wide)).toBe(true);
  });
});
