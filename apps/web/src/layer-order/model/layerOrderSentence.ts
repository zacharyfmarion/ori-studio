/**
 * The constraint builder's sentence, `[subject] [in front of ▾] [objects]`
 * (spec §6.4), and the open pairs it is built from. Each rule mirrors the
 * approved artboard's function of the same name
 * (`artifacts/layer-order-design/project/Round3.dc.html`, cited as Round3):
 * where the plan's research and the artboard disagree, the artboard wins.
 *
 * **Compound constraints (D21).** The subject is one face; the objects are
 * one or more. In the object step a pick toggles: an unpicked face is added,
 * a picked one removed, by pointer, tap or the keyboard face menu alike; each
 * object's chip has a × that removes it whichever slot is active. The
 * objects read in letter order ("H, K") whatever order they were picked in,
 * and the rules that carried one object carry each: a new subject keeps each
 * object still open with it, and a click on empty paper clears every object,
 * then the subject. Which faces are offered as objects never depends on what
 * else is picked.
 *
 * Which faces are open comes from deduction (the engine's open pairs), not a
 * search, so an offered object can still fail its preview: that is the
 * preview's to catch, not the sentence's.
 *
 * Every rule returns the sentence it was given when nothing changes.
 *
 * Pure: no React, no store, no engine calls.
 */
import { constraintSeen, type LayerConstraint, type LayerFace, type LayerSide, type LayerVerb } from './layerOrderEngineFacts';

/** The verbs, in the menu's order, from one list: later verbs (spec §6.10) add entries, not UI. The first is the default. */
export const LAYER_VERBS: readonly LayerVerb[] = ['in_front_of', 'behind'];

export type LayerSlot = 'subject' | 'object';

/**
 * Where a face in the sentence was picked: on the crease pattern, on the
 * folded figure, from the keyboard face menu, or from a constraint row (the
 * analytics' `subject_origin` and `object_origin`).
 */
export type LayerPickOrigin = 'pattern' | 'folded' | 'menu' | 'list';

/**
 * Each face's place in letter order, by face (`engine/faceIndex.ts`'s
 * reading order, A first): what the objects are sorted by. Without one, a
 * face's place is its own number.
 */
export type LayerLetterRanks = ArrayLike<number>;

/** One object, and where it was picked. */
export interface LayerObjectPick {
  readonly face: LayerFace;
  readonly origin: LayerPickOrigin;
}

export interface LayerSentence {
  readonly subject: LayerFace | null;
  readonly verb: LayerVerb;
  /** The objects, in letter order (D21); empty until the first is picked. */
  readonly objects: readonly LayerFace[];
  /** The same objects in the order they were picked, each with its origin ({@link objectOriginOf}). */
  readonly objectPicks: readonly LayerObjectPick[];
  /** The slot the next face click fills, unless the subject has nothing left to choose ({@link slotNow}). */
  readonly active: LayerSlot;
  readonly subjectOrigin: LayerPickOrigin | null;
}

const NO_OBJECTS: readonly LayerFace[] = [];
const NO_PICKS: readonly LayerObjectPick[] = [];

/** The sentence after Add: subject, verb (back to the first) and objects cleared, the subject slot active (Round3 `emptySentence`). */
export const EMPTY_SENTENCE: LayerSentence = {
  subject: null,
  verb: LAYER_VERBS[0]!,
  objects: NO_OBJECTS,
  objectPicks: NO_PICKS,
  active: 'subject',
  subjectOrigin: null,
};

/** `object_origin`: where the first of the objects still in the sentence was picked; null with none. */
export function objectOriginOf(sentence: LayerSentence): LayerPickOrigin | null {
  return sentence.objectPicks[0]?.origin ?? null;
}

// ---------------------------------------------------------------------------
// Open pairs

/** The pairs deduction leaves open, indexed by face. */
export interface LayerOpenIndex {
  readonly pairs: Uint32Array;
  /** Per face with choices, its open partners, ascending. */
  readonly partners: ReadonlyMap<LayerFace, readonly LayerFace[]>;
}

const NO_FACES: readonly LayerFace[] = [];

/** Index the engine's open pairs, `[lo, hi, …]`. */
export function openIndexOf(pairs: Uint32Array): LayerOpenIndex {
  const partners = new Map<LayerFace, LayerFace[]>();
  const add = (a: LayerFace, b: LayerFace) => {
    const list = partners.get(a);
    if (list) list.push(b);
    else partners.set(a, [b]);
  };
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    add(pairs[i]!, pairs[i + 1]!);
    add(pairs[i + 1]!, pairs[i]!);
  }
  partners.forEach((list) => list.sort((a, b) => a - b));
  return { pairs, partners };
}

/** How many pairs are open: what D7's count threshold reads. */
export function openPairCount(open: LayerOpenIndex): number {
  return Math.floor(open.pairs.length / 2);
}

/** A face's open faces: the only valid objects for it as a subject (spec §5). */
export function openPartners(open: LayerOpenIndex, face: LayerFace | null): readonly LayerFace[] {
  return face === null ? NO_FACES : (open.partners.get(face) ?? NO_FACES);
}

/** Whether `face` has at least one open face, so it can be a subject. */
export function hasChoices(open: LayerOpenIndex, face: LayerFace): boolean {
  return open.partners.has(face);
}

/** Every face that can be a subject, ascending. */
export function facesWithChoices(open: LayerOpenIndex): readonly LayerFace[] {
  return Array.from(open.partners.keys()).sort((a, b) => a - b);
}

function isOpenWith(open: LayerOpenIndex, subject: LayerFace | null, object: LayerFace | null): boolean {
  return subject !== null && object !== null && openPartners(open, subject).includes(object);
}

// ---------------------------------------------------------------------------
// The rules

/**
 * The slot the next face click fills: the subject's while it is empty, and
 * also while the subject has nothing left to choose (a row click or an undo
 * can leave it so). Round3 `slotNow`.
 */
export function slotNow(sentence: LayerSentence, open: LayerOpenIndex): LayerSlot {
  if (sentence.subject === null || !hasChoices(open, sentence.subject)) return 'subject';
  return sentence.active;
}

/** Whether the subject is set but has nothing left to choose. */
export function subjectStuck(sentence: LayerSentence, open: LayerOpenIndex): boolean {
  return sentence.subject !== null && !hasChoices(open, sentence.subject);
}

/** A face's place in letter order; its own number without ranks. */
function rankOf(ranks: LayerLetterRanks | undefined, face: LayerFace): number {
  return ranks?.[face] ?? face;
}

/** `faces` in letter order (D21: "H, K" whatever order they were picked in). */
export function inLetterOrder(faces: readonly LayerFace[], ranks?: LayerLetterRanks): LayerFace[] {
  return [...faces].sort((a, b) => rankOf(ranks, a) - rankOf(ranks, b) || a - b);
}

/** The sentence with `objects`: each kept object keeps its pick, and `added`, a new one, joins them last. */
function withObjects(sentence: LayerSentence, objects: readonly LayerFace[], added?: LayerObjectPick): LayerSentence {
  if (objects.length === 0) return { ...sentence, objects: NO_OBJECTS, objectPicks: NO_PICKS };
  const kept = sentence.objectPicks.filter((pick) => objects.includes(pick.face));
  return { ...sentence, objects, objectPicks: added ? [...kept, added] : kept };
}

/**
 * A face click fills the active slot, and only with a face that slot can
 * take: a subject needs an open face, an object must be one of the subject's.
 * In the object step a pick toggles (D21): an unpicked object is added, a
 * picked one removed. Every other face is inert; the click does nothing.
 * Round3 `pickFace`.
 */
export function pickFace(
  sentence: LayerSentence,
  open: LayerOpenIndex,
  face: LayerFace,
  origin: LayerPickOrigin,
  ranks?: LayerLetterRanks
): LayerSentence {
  if (slotNow(sentence, open) === 'subject') {
    return hasChoices(open, face) ? setSubject(sentence, open, face, origin) : sentence;
  }
  return isOpenWith(open, sentence.subject, face) ? toggleObject(sentence, face, origin, ranks) : sentence;
}

/**
 * The subject, keeping each object still open with the new subject and
 * quietly dropping the rest; so a pick of one of the objects as the subject
 * removes it from the objects, since no face is open with itself. The object
 * slot is active next. Round3 `setSubject`, per object (D21).
 */
export function setSubject(
  sentence: LayerSentence,
  open: LayerOpenIndex,
  face: LayerFace,
  origin: LayerPickOrigin
): LayerSentence {
  const kept = sentence.objects.filter((object) => isOpenWith(open, face, object));
  const objects = kept.length === sentence.objects.length ? sentence.objects : kept;
  return { ...withObjects(sentence, objects), subject: face, subjectOrigin: origin, active: 'object' };
}

/**
 * An object pick (D21): an unpicked face joins the objects, in letter order,
 * with where it was picked; a picked one leaves them, with its pick. Round3
 * `setObject`, which replaced the object.
 */
export function toggleObject(
  sentence: LayerSentence,
  face: LayerFace,
  origin: LayerPickOrigin,
  ranks?: LayerLetterRanks
): LayerSentence {
  if (sentence.objects.includes(face)) return { ...removeObject(sentence, face), active: 'object' };
  return { ...withObjects(sentence, inLetterOrder([...sentence.objects, face], ranks), { face, origin }), active: 'object' };
}

/**
 * An object chip's ×: that object leaves the sentence, whichever slot is
 * active, and the subject and the active slot stay as they are (so with the
 * object slot active, removing the last object leaves it active). A face that
 * is not an object changes nothing.
 */
export function removeObject(sentence: LayerSentence, face: LayerFace): LayerSentence {
  if (!sentence.objects.includes(face)) return sentence;
  return withObjects(sentence, sentence.objects.filter((object) => object !== face));
}

/**
 * Clicking a filled slot makes it the active one: the next pick replaces the
 * subject, or toggles an object; the object slot can't be made active with no
 * subject or a stuck one. Round3 `activate`.
 */
export function activateSlot(sentence: LayerSentence, open: LayerOpenIndex, slot: LayerSlot): LayerSentence {
  if (slot === 'object' && (sentence.subject === null || !hasChoices(open, sentence.subject))) return sentence;
  return sentence.active === slot ? sentence : { ...sentence, active: slot };
}

/**
 * A slot's ×: the object slot's clears every object. Clearing the subject
 * keeps the objects, which the next subject keeps where they are open with it
 * (Round3 `clearSlot`, then `setSubject`).
 */
export function clearSlot(sentence: LayerSentence, slot: LayerSlot): LayerSentence {
  if (slot === 'object') return { ...withObjects(sentence, NO_OBJECTS), active: 'object' };
  return { ...sentence, subject: null, subjectOrigin: null, active: 'subject' };
}

/** Clear: every face goes; the verb stays (Round3 `clearSentence`, unlike Add's {@link EMPTY_SENTENCE}). */
export function clearSentence(sentence: LayerSentence): LayerSentence {
  if (sentence.subject === null && sentence.objects.length === 0) return sentence;
  return { ...withObjects(sentence, NO_OBJECTS), subject: null, subjectOrigin: null, active: 'subject' };
}

/**
 * A click on empty paper clears every object when that is the slot being
 * filled, otherwise the subject, otherwise the sentence. Round3 `groundClick`.
 */
export function groundClick(sentence: LayerSentence): LayerSentence {
  if (sentence.subject !== null && sentence.active === 'object' && sentence.objects.length > 0) {
    return clearSlot(sentence, 'object');
  }
  if (sentence.subject !== null) return clearSlot(sentence, 'subject');
  return clearSentence(sentence);
}

/** Picking a verb from the menu. Round3 `pickVerb`. */
export function setVerb(sentence: LayerSentence, verb: LayerVerb): LayerSentence {
  return sentence.verb === verb ? sentence : { ...sentence, verb };
}

/**
 * A constraint row's click: its subject goes into the builder, ready for its
 * next constraint, with the object slot active; when the subject has nothing
 * left to choose, {@link slotNow} makes the subject slot active again and the
 * hint says so. Round3 `reveal`.
 */
export function revealSubject(sentence: LayerSentence, face: LayerFace): LayerSentence {
  return { ...withObjects(sentence, NO_OBJECTS), subject: face, subjectOrigin: 'list', active: 'object' };
}

/**
 * After a commit, the builder keeps its sentence, less any object no longer
 * open with the subject. Round3 `commit`, per object.
 */
export function keepOpenObjects(sentence: LayerSentence, open: LayerOpenIndex): LayerSentence {
  if (sentence.subject === null) return sentence;
  const kept = sentence.objects.filter((object) => isOpenWith(open, sentence.subject, object));
  return kept.length === sentence.objects.length ? sentence : withObjects(sentence, kept);
}

/** Whether the sentence names a subject and one or more of its open faces. */
export function isComplete(sentence: LayerSentence, open: LayerOpenIndex): boolean {
  return sentence.objects.length > 0 && sentence.objects.every((object) => isOpenWith(open, sentence.subject, object));
}

/**
 * The sentence as constraints, one per object in letter order, read from
 * `side` with `verb` (the menu's pointed verb, or the sentence's own); null
 * unless the sentence is complete. Stored paper-relative, so the list reads
 * back what was built from either side (Round3 `sentenceCons`). One verb from
 * one side can be either sign, by how each object faces.
 */
export function candidatesOf(
  sentence: LayerSentence,
  open: LayerOpenIndex,
  verb: LayerVerb,
  side: LayerSide,
  frontUp: Uint8Array
): LayerConstraint[] | null {
  if (!isComplete(sentence, open)) return null;
  const subject = sentence.subject!;
  return sentence.objects.map((object) => constraintSeen(subject, verb, object, side, frontUp[object] === 1));
}

/** A constraint's key: its two faces and sign. */
export function constraintKey(constraint: LayerConstraint): string {
  return `${constraint[0]},${constraint[1]},${constraint[2]}`;
}

/** A sentence's constraints' key, for the preview cache: one sentence, one preview. */
export function candidatesKey(candidates: readonly LayerConstraint[]): string {
  return candidates.map(constraintKey).join(';');
}
