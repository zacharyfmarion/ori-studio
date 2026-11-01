/**
 * What the panes and the inspector draw from the inspector state
 * (`layerOrderState.ts`): faces to tint and label, the hint line, Add's and
 * Apply's state, the status and stepper, and the constraint rows. Text comes
 * out as a key with its values (faces by number, counts, sentences as
 * subject–verb–object); the component turns faces into letters and keys into
 * translated strings, so word order stays each locale's.
 *
 * The rules are the approved artboard's (Round3 `renderVals`) and the Round 4
 * states board's (`Round4-States.dc.html`, the current proposal for the
 * waiting, timed-out, attention and refusal states).
 *
 * A sentence names one subject and one or more objects (D21), and so does a
 * row of the list: constraints are stored one per object and drawn one row
 * per subject and verb (`layerOrderRowGroups.ts`, {@link rowGroupsView}).
 *
 * Pure: no React, no store, no engine calls.
 */
import { objectsPastLabelCap, hostOrderNotice, ADD_AFTER_PREVIEW_TIMEOUT, type LayerOpenNotice } from './layerOrderDecisions';
import {
  constraintVerb,
  layerPositionEnds,
  type LayerChangedSpots,
  type LayerConstraint,
  type LayerFace,
  type LayerRefusal,
  type LayerSide,
  type LayerSidesStacks,
  type LayerStacks,
  type LayerTally,
  type LayerVerb,
} from './layerOrderEngineFacts';
import { canRedo, canUndo } from './layerOrderHistory';
import {
  applyBlocker,
  builderLive,
  canTravel,
  chosenPreview,
  currentStepBy,
  displayedPreview,
  sentenceCandidates,
  stepByKey,
} from './layerOrderReducer';
import { rowGroupByKey, rowGroupsOf, rowParts, type LayerRowGroup, type LayerRowKey } from './layerOrderRowGroups';
import { facesWithChoices, hasChoices, openPartners, slotNow, subjectStuck, type LayerSlot } from './layerOrderSentence';
import type {
  LayerCarriedRow,
  LayerCommittedRow,
  LayerCommitVia,
  LayerOrderDialogState,
  LayerPreviewEntry,
  LayerRow,
  LayerRows,
  LayerStepDirection,
} from './layerOrderState';

// ---------------------------------------------------------------------------
// Sentences

/**
 * A sentence as the builder, a row or a reason reads it, from the side shown:
 * one subject and one or more objects, "D in front of H, K" (D21). A single
 * constraint has one object. A face that no longer exists is null, and has
 * no letter.
 */
export interface LayerSentenceView {
  readonly subject: LayerFace | null;
  /** Null when the object no longer exists, so its side can't be read. */
  readonly verb: LayerVerb | null;
  /** In letter order. */
  readonly objects: readonly (LayerFace | null)[];
}

function frontUpOf(state: LayerOrderDialogState, face: LayerFace): boolean {
  return state.figure?.frontUp[face] === 1;
}

/** One constraint, read from the side shown. */
export function constraintSentence(state: LayerOrderDialogState, constraint: LayerConstraint): LayerSentenceView {
  const [subject, object] = constraint;
  return { subject, verb: constraintVerb(constraint, state.view.side, frontUpOf(state, object)), objects: [object] };
}

/** A sentence's constraints, one subject and one verb with an object each, read from the side shown. */
export function candidatesSentence(state: LayerOrderDialogState, candidates: readonly LayerConstraint[]): LayerSentenceView {
  return { ...constraintSentence(state, candidates[0]!), objects: candidates.map((candidate) => candidate[1]) };
}

/** A stored row, read the way it was built, subject first (spec §6.5). */
export function rowSentence(state: LayerOrderDialogState, row: LayerRow): LayerSentenceView {
  if (row.kind === 'committed') return constraintSentence(state, row.constraint);
  const { subject, object, sign } = row.facts;
  const verb = object === null ? null : constraintVerb([subject ?? 0, object, sign], state.view.side, frontUpOf(state, object));
  return { subject, verb, objects: [object] };
}

/** A list row: its subject and verb, and every object it holds. */
function groupSentence(state: LayerOrderDialogState, group: LayerRowGroup): LayerSentenceView {
  const first = rowSentence(state, group.members[0]!);
  return { ...first, objects: group.members.map((row) => rowParts(row).object) };
}

function rowFaces(row: LayerRow): LayerFace[] {
  const { subject, object } = rowParts(row);
  return [subject, object].filter((face): face is LayerFace => face !== null);
}

function groupFaces(group: LayerRowGroup): LayerFace[] {
  return Array.from(new Set(group.members.flatMap(rowFaces)));
}

function findRow(state: LayerOrderDialogState, id: number | null): LayerRow | null {
  if (id === null) return null;
  return state.rows.committed.find((row) => row.id === id) ?? state.rows.carried.find((row) => row.id === id) ?? null;
}

function rowGroups(state: LayerOrderDialogState): LayerRowGroup[] {
  return rowGroupsOf(state.rows, state.figure);
}

/** Stored constraints as sentences, grouped one per subject and verb as the list groups them (D21). */
function sentencesOf(state: LayerOrderDialogState, rows: readonly LayerRow[]): LayerSentenceView[] {
  const subset: LayerRows = {
    committed: rows.filter((row): row is LayerCommittedRow => row.kind === 'committed'),
    carried: rows.filter((row): row is LayerCarriedRow => row.kind === 'carried'),
  };
  return rowGroupsOf(subset, state.figure).map((group) => groupSentence(state, group));
}

// ---------------------------------------------------------------------------
// The clash on screen

interface LayerClashView {
  /**
   * The sentence, when the clash is a preview's: whole while it is being
   * explained, then only its objects in the clash (D21).
   */
  readonly sentence: LayerSentenceView | null;
  /** The sentence's objects in the clash: marked on their chips. */
  readonly objects: readonly LayerFace[];
  /** The stored constraints in the clash, in the list's order. */
  readonly rows: readonly LayerRow[];
  readonly faces: readonly LayerFace[];
  readonly explaining: boolean;
  readonly minimal: boolean;
  /** Its explain ran out: the check's own set stands in, and Keep trying asks again. */
  readonly explainTimedOut: boolean;
}

/** A can't-fit preview's clash, or a restored record's (D10); null when nothing clashes. */
function clashOnScreen(state: LayerOrderDialogState): LayerClashView | null {
  if (state.settle.kind === 'clash') {
    const rows = state.settle.rows.map((id) => findRow(state, id)).filter((row): row is LayerRow => row !== null);
    return {
      sentence: null,
      objects: [],
      rows,
      faces: Array.from(new Set(rows.flatMap(rowFaces))),
      explaining: state.settle.explain !== null,
      minimal: state.settle.explain === null,
      explainTimedOut: false,
    };
  }
  const entry = displayedPreview(state);
  if (entry?.kind !== 'cant_fit') return null;
  const { candidates } = entry;
  const committed = state.rows.committed;
  // Indices past the committed list name the sentence's candidates, in order.
  const named = (indices: readonly number[]) =>
    candidates.filter((_, i) => indices.includes(committed.length + i));
  const inCheck = named(entry.constraints);
  const checked = inCheck.length > 0 ? inCheck : candidates;
  if (entry.explain.kind === 'pending') {
    // The sentence's faces in the check's own set go danger at once; the smallest set follows
    // (Round 4 "A clash being explained").
    const objects = checked.map((candidate) => candidate[1]);
    return {
      sentence: candidatesSentence(state, candidates),
      objects,
      rows: [],
      faces: [candidates[0]![0], ...objects],
      explaining: true,
      minimal: false,
      explainTimedOut: false,
    };
  }
  if (entry.explain.kind === 'none') {
    // No explain runs yet (it waits for a commit in flight): the check's own set is the reason, not claimed minimal.
    const rows = entry.constraints.filter((index) => index < committed.length).map((index) => committed[index]!);
    return {
      sentence: candidatesSentence(state, checked),
      objects: checked.map((candidate) => candidate[1]),
      rows,
      faces: Array.from(new Set([...rows.flatMap(rowFaces), ...checked.flatMap((candidate) => [candidate[0], candidate[1]])])),
      explaining: false,
      minimal: false,
      explainTimedOut: false,
    };
  }
  const inClash = named(entry.explain.constraints);
  const rows = entry.explain.constraints.filter((index) => index < committed.length).map((index) => committed[index]!);
  return {
    sentence: candidatesSentence(state, inClash.length > 0 ? inClash : candidates),
    objects: inClash.map((candidate) => candidate[1]),
    rows,
    faces: entry.explain.faces,
    explaining: false,
    minimal: entry.explain.minimal,
    explainTimedOut: entry.explain.kind === 'timed_out',
  };
}

// ---------------------------------------------------------------------------
// The hint line (Round3:1384-1395; Round 4's states)

export type LayerHintTone = 'quiet' | 'danger' | 'busy' | 'busy_danger';

/** Why a face has nothing left to choose (Round3 `settledReason`). */
export type LayerSettledWhy = 'settled' | 'no_overlap';

/** Why a saved row is not applied, or what it clashes with. */
export type LayerRowReason =
  /** A new crease split (or a removed one merged) its face: it could mean either part. */
  | { readonly key: 'ambiguous'; readonly face: LayerFace }
  /** A face it names no longer exists: "the face in front of D no longer exists". */
  | { readonly key: 'face_gone'; readonly sentence: LayerSentenceView; readonly gone: 'subject' | 'object' | 'both' }
  /** Its two faces are one face now. */
  | { readonly key: 'same_face'; readonly sentence: LayerSentenceView }
  /** Its faces no longer overlap. */
  | { readonly key: 'no_overlap'; readonly sentence: LayerSentenceView }
  /** It is in the clash shown: what it clashes with, grouped as the list groups rows. */
  | { readonly key: 'clashes'; readonly clashes: readonly LayerSentenceView[] }
  /** The clash is the row's own constraints and nothing else: "D in front of H, K can't all fit together". */
  | { readonly key: 'clash_within'; readonly sentence: LayerSentenceView }
  /** Intact, waiting for the rows that clash to settle. */
  | { readonly key: 'waiting' };

export type LayerHintText =
  /** "Pick a face · N faces have choices". */
  | { readonly key: 'pick_face'; readonly choosers: number }
  /** "Pick a face to replace C · N faces have choices". */
  | { readonly key: 'replace_subject'; readonly subject: LayerFace; readonly choosers: number }
  /** "Nothing left to choose: every overlap is settled". */
  | { readonly key: 'all_settled' }
  /** Pointing at a face while choosing a subject: "C · 3 faces to choose from". */
  | { readonly key: 'face_choices'; readonly face: LayerFace; readonly choices: number }
  /** "C · nothing left to choose: everything it overlaps is settled". */
  | { readonly key: 'face_nothing_left'; readonly face: LayerFace; readonly why: LayerSettledWhy }
  /** "Nothing left to choose for C: everything it overlaps is settled. Pick another face." */
  | { readonly key: 'subject_stuck'; readonly subject: LayerFace; readonly why: LayerSettledWhy }
  /** "Pick one of the N labelled faces", or "tinted" past the label cap (D7). */
  | { readonly key: 'pick_object'; readonly objects: number; readonly tinted: boolean }
  /** Once an object is picked: "Pick more faces to add them, or a picked face to remove it." (D21). */
  | { readonly key: 'more_objects' }
  /** The subject's one open face is picked: "D is the only face to choose". */
  | { readonly key: 'only_object'; readonly object: LayerFace }
  /** "Checking C behind D, E…". */
  | { readonly key: 'checking'; readonly sentence: LayerSentenceView }
  /** "Can't fit. Finding what it clashes with…". */
  | { readonly key: 'cant_fit_explaining'; readonly sentence: LayerSentenceView }
  /**
   * "Can't fit: with the creases, C in front of F clashes with C behind E", or
   * with no clashes, "the creases don't allow …". `sentence` names only the
   * objects in the clash.
   */
  | {
      readonly key: 'cant_fit';
      readonly sentence: LayerSentenceView;
      readonly clashes: readonly LayerSentenceView[];
      readonly minimal: boolean;
    }
  /** "Couldn't check C behind D in time." with Keep trying (D8). */
  | { readonly key: 'timed_out'; readonly sentence: LayerSentenceView }
  /** A change to the list ran out of time with Keep trying; nothing changed. */
  | { readonly key: 'commit_timed_out'; readonly via: LayerCommitVia }
  /** "Couldn't find the next solution in time." with Keep trying, which steps that way again (E9); nothing moved. */
  | { readonly key: 'step_timed_out'; readonly direction: LayerStepDirection }
  /** Pointing at a row that is not applied: its reason. */
  | { readonly key: 'row_not_applied'; readonly reason: LayerRowReason }
  /** "Can't fit: with the new creases, E in front of C clashes with C in front of F. Remove one to apply." */
  | { readonly key: 'attention_clash'; readonly clashes: readonly LayerSentenceView[]; readonly explaining: boolean }
  | { readonly key: 'attention_checking' }
  /** The restore ran out of time, with Keep trying. */
  | { readonly key: 'attention_timed_out' };

export interface LayerHint {
  readonly tone: LayerHintTone;
  /** A button inside the reserved line. */
  readonly action: 'keep_trying' | null;
  readonly text: LayerHintText;
}

const quietHint = (text: LayerHintText): LayerHint => ({ tone: 'quiet', action: null, text });

function settledWhy(state: LayerOrderDialogState, face: LayerFace): LayerSettledWhy {
  return state.figure?.overlapping[face] === 1 ? 'settled' : 'no_overlap';
}

/**
 * A list row's reason: what its constraints clash with, when the clash shown
 * names any of them (or, when the clash is two or more of its own constraints
 * and nothing else, that those can't all fit together); else, for carried
 * rows, why they are not applied, which is one reason for the whole row since
 * a row holds one status (D21).
 */
function groupReason(state: LayerOrderDialogState, group: LayerRowGroup, clash: LayerClashView | null): LayerRowReason | null {
  const ids = new Set(group.members.map((row) => row.id));
  const clashing = new Set(clash?.rows.map((row) => row.id) ?? []);
  const own = group.members.filter((row) => clashing.has(row.id));
  if (clash && own.length > 0) {
    const others = sentencesOf(state, clash.rows.filter((row) => !ids.has(row.id)));
    const clashes = clash.sentence ? [clash.sentence, ...others] : others;
    if (clashes.length > 0 || own.length < 2) return { key: 'clashes', clashes };
    const objects = own.map((row) => rowParts(row).object);
    return { key: 'clash_within', sentence: { ...groupSentence(state, group), objects } };
  }
  const first = group.members[0]!;
  if (first.kind === 'committed') return null;
  const reason = carriedReason(state, first);
  return reason && 'sentence' in reason && group.members.length > 1 ? { ...reason, sentence: groupSentence(state, group) } : reason;
}

/** A carried row's reason when it is not applied and not in the clash shown. */
function carriedReason(state: LayerOrderDialogState, row: LayerCarriedRow): LayerRowReason | null {
  const { status, subjectState, objectState, subject, object } = row.facts;
  const sentence = rowSentence(state, row);
  switch (status.status) {
    case 'intact':
    case 'clashing':
      return state.settle.kind === 'settled' ? null : { key: 'waiting' };
    case 'ambiguous': {
      const face = subjectState === 'ambiguous' ? subject : object;
      return face !== null ? { key: 'ambiguous', face } : { key: 'face_gone', sentence, gone: 'subject' };
    }
    case 'gone':
      if (status.cause === 'same_face') return { key: 'same_face', sentence };
      if (status.cause === 'no_overlap') return { key: 'no_overlap', sentence };
      return {
        key: 'face_gone',
        sentence,
        gone: subjectState === 'gone' && objectState === 'gone' ? 'both' : subjectState === 'gone' ? 'subject' : 'object',
      };
  }
}

/** The one line under the sentence: its height is always reserved, and it holds text only when something blocks or guides. */
export function hintLine(state: LayerOrderDialogState): LayerHint | null {
  if (state.phase.kind !== 'open' || !state.figure) return null;
  const clash = clashOnScreen(state);
  const hovered = rowGroupByKey(rowGroups(state), state.hover.row);
  const hoveredReason = hovered?.kind === 'carried' ? groupReason(state, hovered, clash) : null;

  // A restored record still settling (D10): the builder is inert, and the line speaks for the rows.
  if (state.settle.kind !== 'settled' || (state.commit.kind !== 'idle' && state.commit.via === 'settle')) {
    const inClash = hoveredReason?.key === 'clashes' || hoveredReason?.key === 'clash_within';
    if (hoveredReason && !inClash) return quietHint({ key: 'row_not_applied', reason: hoveredReason });
    if (state.commit.kind === 'pending' || state.settle.kind === 'restoring') {
      return { tone: 'busy', action: null, text: { key: 'attention_checking' } };
    }
    if (state.commit.kind === 'timed_out' || state.settle.kind === 'timed_out') {
      return { tone: 'quiet', action: 'keep_trying', text: { key: 'attention_timed_out' } };
    }
    return {
      tone: 'danger',
      action: null,
      text: { key: 'attention_clash', clashes: sentencesOf(state, clash?.rows ?? []), explaining: clash?.explaining ?? false },
    };
  }

  if (state.commit.kind === 'timed_out') {
    return { tone: 'quiet', action: 'keep_trying', text: { key: 'commit_timed_out', via: state.commit.via } };
  }
  if (hoveredReason) return quietHint({ key: 'row_not_applied', reason: hoveredReason });

  // A step that ran out (E9) is the newest thing on the line, until the next pick, Clear or step lets it
  // go. Keep trying waits while a change to the list is in the worker: a step can't be asked until then.
  const { step } = state.solutions;
  if (step.kind === 'timed_out') {
    const action = state.commit.kind === 'pending' ? null : 'keep_trying';
    return { tone: 'quiet', action, text: { key: 'step_timed_out', direction: step.direction } };
  }

  const preview = displayedPreview(state);
  if (preview) {
    const sentence = candidatesSentence(state, preview.candidates);
    if (preview.kind === 'pending') return { tone: 'busy', action: null, text: { key: 'checking', sentence } };
    if (preview.kind === 'timed_out') return { tone: 'quiet', action: 'keep_trying', text: { key: 'timed_out', sentence } };
    if (preview.kind === 'cant_fit' && clash) {
      if (clash.explaining) return { tone: 'busy_danger', action: null, text: { key: 'cant_fit_explaining', sentence } };
      const clashes = sentencesOf(state, clash.rows);
      return {
        tone: 'danger',
        // An explain that ran out names the check's own set, not the smallest: Keep trying looks further.
        action: clash.explainTimedOut ? 'keep_trying' : null,
        text: { key: 'cant_fit', sentence: clash.sentence ?? sentence, clashes, minimal: clash.minimal },
      };
    }
  }

  // Round3:1389-1395.
  const { sentence } = state;
  const active = slotNow(sentence, state.open);
  if (active === 'subject') {
    const face = state.hover.face;
    if (face !== null && state.hover.slot === null) {
      const choices = openPartners(state.open, face).length;
      return quietHint(
        choices > 0 ? { key: 'face_choices', face, choices } : { key: 'face_nothing_left', face, why: settledWhy(state, face) }
      );
    }
    if (subjectStuck(sentence, state.open)) {
      return quietHint({ key: 'subject_stuck', subject: sentence.subject!, why: settledWhy(state, sentence.subject!) });
    }
    const choosers = state.open.partners.size;
    if (choosers === 0) return quietHint({ key: 'all_settled' });
    return quietHint(
      sentence.subject === null
        ? { key: 'pick_face', choosers }
        : { key: 'replace_subject', subject: sentence.subject, choosers }
    );
  }
  const offered = openPartners(state.open, sentence.subject).length;
  if (sentence.objects.length === 0) {
    return quietHint({ key: 'pick_object', objects: offered, tinted: objectsPastLabelCap(offered) });
  }
  if (offered === 1) return quietHint({ key: 'only_object', object: sentence.objects[0]! });
  return quietHint({ key: 'more_objects' });
}

// ---------------------------------------------------------------------------
// Add, Clear, the history, Apply

/** Add's own text: "Add constraint" or "Add constraints", by the constraints it adds once any already committed are skipped (D21). */
export type LayerAddLabel = 'add_constraint' | 'add_constraints';

export type LayerAddState =
  | { readonly enabled: true; readonly label: LayerAddLabel; readonly sentence: LayerSentenceView }
  | {
      readonly enabled: false;
      readonly label: LayerAddLabel;
      readonly why:
        | 'inert'
        | 'busy'
        | 'pick_subject'
        | 'subject_stuck'
        | 'pick_object'
        | 'checking'
        | 'cant_fit'
        | 'timed_out';
      /** The face or sentence the reason names (Round3 `addTitle`). */
      readonly subject: LayerFace | null;
      readonly sentence: LayerSentenceView | null;
    };

/** Add: enabled only for a sentence its preview fit, every object at once (Round3 `addOk`; D8, D21). */
export function addState(state: LayerOrderDialogState): LayerAddState {
  const candidates = sentenceCandidates(state);
  const label: LayerAddLabel = (candidates?.length ?? 0) > 1 ? 'add_constraints' : 'add_constraint';
  const off = (why: Extract<LayerAddState, { enabled: false }>['why'], sentence: LayerSentenceView | null = null) =>
    ({ enabled: false, label, why, subject: state.sentence.subject, sentence }) as const;
  if (!builderLive(state)) return off('inert');
  const { sentence, open } = state;
  if (sentence.subject === null) return off('pick_subject');
  if (!hasChoices(open, sentence.subject)) return off('subject_stuck');
  if (!candidates) return off('pick_object');
  const view = candidatesSentence(state, candidates);
  if (state.commit.kind === 'pending' || state.solutions.step.kind === 'pending') return off('busy', view);
  const entry = chosenPreview(state);
  if (!entry || entry.kind === 'pending') return off('checking', view);
  if (entry.kind === 'cant_fit') return off('cant_fit', view);
  if (entry.kind === 'timed_out' && !ADD_AFTER_PREVIEW_TIMEOUT) return off('timed_out', view);
  return { enabled: true, label, sentence: view };
}

export interface LayerListControls {
  readonly undo: boolean;
  readonly redo: boolean;
  /** There is something to undo, once the change in flight lands: Undo's tooltip says it waits, not that there is nothing. */
  readonly undoWaits: boolean;
  readonly redoWaits: boolean;
  readonly clearAll: boolean;
  /** The sentence's Clear. */
  readonly clearSentence: boolean;
  /** Each row's trash. */
  readonly remove: boolean;
}

export function listControls(state: LayerOrderDialogState): LayerListControls {
  const open = state.phase.kind === 'open';
  const quietNow = state.commit.kind !== 'pending' && state.solutions.step.kind !== 'pending';
  const settled = open && state.settle.kind === 'settled' && quietNow;
  const rows = state.rows.committed.length + state.rows.carried.length;
  // Undo and redo move whenever nothing is in flight, a restore's clash included (D10).
  const travels = canTravel(state);
  const waits = open && !quietNow;
  return {
    undo: travels && canUndo(state.history),
    redo: travels && canRedo(state.history),
    undoWaits: waits && canUndo(state.history),
    redoWaits: waits && canRedo(state.history),
    clearAll: settled && rows > 0,
    clearSentence: builderLive(state) && (state.sentence.subject !== null || state.sentence.objects.length > 0),
    remove: open && quietNow && state.settle.kind !== 'restoring',
  };
}

export type LayerApplyState =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly why: 'opening' | 'refused' | 'busy' | 'clash' | 'unsettled' };

/** Apply waits while opening, while anything is changing the order, and while saved rows clash or are unsettled (D10). */
export function applyState(state: LayerOrderDialogState): LayerApplyState {
  const why = applyBlocker(state);
  return why === null ? { enabled: true } : { enabled: false, why };
}

// ---------------------------------------------------------------------------
// The panes

export interface LayerPaneMarks {
  /** The slot a face click fills now. */
  readonly active: LayerSlot;
  readonly subject: LayerFace | null;
  /** The sentence's objects, in letter order: tinted and ringed as picks (D20, D21). */
  readonly picked: readonly LayerFace[];
  /**
   * The faces a click can take in the active slot, faintly tinted: every face
   * with choices for the subject, the subject's open faces for the objects,
   * picked or not (a pick on a picked one removes it), whatever else is
   * picked. Every other face is inert. Empty while the builder is inert.
   */
  readonly pickable: readonly LayerFace[];
  /** The subject's open faces: the valid objects, labelled on both panes. */
  readonly objects: readonly LayerFace[];
  /** Every face that carries a letter: the subject, the picked objects, the valid objects, the clash's faces, the hovered row's. */
  readonly labelled: readonly LayerFace[];
  /**
   * The faces whose letters stay past the label cap (D7): the subject, the
   * picked objects, the clash's faces and the hovered row's. Past the cap the
   * panes letter these, the hovered face and the nearest of the rest (U8).
   */
  readonly alwaysLabelled: readonly LayerFace[];
  /** Whether the subject's valid objects are more than the label cap (D7). */
  readonly pastLabelCap: boolean;
  /**
   * The faces that light on both panes: a hovered slot's (every picked object,
   * for the object slot), else the hovered face when the active slot can take it.
   */
  readonly lit: readonly LayerFace[];
  /** The hovered row's faces that still exist: its subject and all its objects (D21). */
  readonly rowFaces: readonly LayerFace[];
  /** The clash's faces: danger tints and labels on both panes. */
  readonly danger: readonly LayerFace[];
  /** Pointing at the reason strengthens the danger tints (Round3:473, 883). */
  readonly dangerStrong: boolean;
  /** The stored constraints the clash marks, by id. */
  readonly clashRows: readonly number[];
  /** The picked objects in the clash: their chips are marked (D21). */
  readonly clashObjects: readonly LayerFace[];
  /** The spots a fitting preview would change, per side. */
  readonly changed: LayerChangedSpots | null;
  /** The spots of the last commit or step, fading once. */
  readonly flash: { readonly changed: LayerChangedSpots; readonly n: number } | null;
}

const NO_FACES: readonly LayerFace[] = [];

function distinctFaces(faces: readonly (LayerFace | null)[]): LayerFace[] {
  return Array.from(new Set(faces.filter((face): face is LayerFace => face !== null)));
}

export function paneMarks(state: LayerOrderDialogState): LayerPaneMarks {
  const { sentence, open, hover } = state;
  const live = builderLive(state);
  const active = slotNow(sentence, open);
  const objects = openPartners(open, sentence.subject);
  const pickable = !live ? NO_FACES : active === 'subject' ? facesWithChoices(open) : objects;
  const clash = clashOnScreen(state);
  const danger = clash?.faces ?? NO_FACES;
  const hoveredRow = rowGroupByKey(rowGroups(state), hover.row);
  const rowFacesNow = hoveredRow ? groupFaces(hoveredRow) : NO_FACES;
  const slotFaces =
    hover.slot === 'subject' ? distinctFaces([sentence.subject]) : hover.slot === 'object' ? sentence.objects : NO_FACES;
  const paneFace = hover.face !== null && pickable.includes(hover.face) ? [hover.face] : NO_FACES;
  const preview = displayedPreview(state);
  return {
    active,
    subject: sentence.subject,
    picked: sentence.objects,
    pickable,
    objects,
    labelled: distinctFaces([sentence.subject, ...sentence.objects, ...objects, ...danger, ...rowFacesNow]),
    alwaysLabelled: distinctFaces([sentence.subject, ...sentence.objects, ...danger, ...rowFacesNow]),
    pastLabelCap: objectsPastLabelCap(objects.length),
    lit: slotFaces.length > 0 ? slotFaces : paneFace,
    rowFaces: rowFacesNow,
    danger,
    dangerStrong: hover.reason && danger.length > 0,
    clashRows: clash?.rows.map((row) => row.id) ?? [],
    clashObjects: clash?.objects ?? NO_FACES,
    changed: preview?.kind === 'fits' ? preview.changed : null,
    flash: state.flash,
  };
}

/** The order the folded pane draws: a fitting preview's, else the order on screen. */
export function displayedStacks(state: LayerOrderDialogState): LayerSidesStacks | null {
  const preview: LayerPreviewEntry | null = displayedPreview(state);
  return preview?.kind === 'fits' ? preview.stacks : state.shown;
}

/**
 * Open spots (the switch, spec §6.2): the spots whose face in front is not
 * decided, from `side`. With every pair the creases and constraints decide
 * already in the order on screen, the face on top can change only for a face
 * it still has an open pair with.
 */
export function openSpotsOf(state: LayerOrderDialogState, side: LayerSide = state.view.side): number[] {
  const stacks: LayerStacks | undefined = displayedStacks(state)?.[side];
  if (!stacks) return [];
  const out: number[] = [];
  for (let spot = 0; spot + 1 < stacks.offsets.length; spot += 1) {
    const from = stacks.offsets[spot]!;
    const to = stacks.offsets[spot + 1]!;
    if (to - from < 2) continue;
    const partners = openPartners(state.open, stacks.faces[from]!);
    if (partners.length === 0) continue;
    for (let i = from + 1; i < to; i += 1) {
      if (partners.includes(stacks.faces[i]!)) {
        out.push(spot);
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The status and the stepper (spec §6.6; D5, D7)

export type LayerStatusText =
  /** "N solutions", or "at least N" when the tally is a lower bound. */
  | { readonly key: 'solutions'; readonly count: LayerTally }
  /** With X-ray on, the stepper steps through every layer order, and the status counts those (D5). */
  | { readonly key: 'layer_orders'; readonly count: LayerTally }
  /**
   * Without X-ray, when more layer orders fit than make different pictures:
   * both, "4 pictures · 256 layer orders" (the owner, 2026-10-27), so the
   * orders hidden layers tell apart are never only in a tooltip.
   */
  | { readonly key: 'pictures_and_orders'; readonly pictures: LayerTally; readonly orders: LayerTally }
  /** The count is skipped (D7): the status names the solution shown, "Solution 3". */
  | { readonly key: 'solution_n'; readonly index: number }
  /** Nothing counted yet. */
  | { readonly key: 'none' };

export interface LayerStepperView {
  /** From 1. */
  readonly index: number;
  /**
   * Null when there is no total to give (D7). Until it is exact the readout is
   * "Solution n", not "n of N+": `index` counts the solutions found so far, not their rank (E9).
   */
  readonly total: LayerTally | null;
  /** ‹: enabled at 1 until the total is exact, since a solution the count lists earlier may yet be found. */
  readonly previous: boolean;
  readonly next: boolean;
  readonly busy: boolean;
  /** Why each waits, for what it says while it does; null when it is at no end it can name. */
  readonly waits: { readonly previous: LayerStepperWait | null; readonly next: LayerStepperWait | null };
}

/**
 * Why a ‹ or › waits: a step is running, it is at the first or the last
 * (`layerPositionEnds`), or at the one solution there is. While a change to
 * the list is being checked it waits at no end, and says none.
 */
export type LayerStepperWait = 'stepping' | 'first' | 'last' | 'only';

export interface LayerStatusView {
  /** The dot: success once a single layer order fits (Round3:200), danger while saved rows clash. */
  readonly dot: 'open' | 'decided' | 'danger';
  readonly text: LayerStatusText;
  /** "24 layer orders fit; 12 differ only in hidden layers": only when larger and exact. */
  readonly tooltip: { readonly orders: number; readonly hidden: number } | null;
  readonly stepper: LayerStepperView | null;
}

export function statusView(state: LayerOrderDialogState): LayerStatusView | null {
  if (state.phase.kind !== 'open') return null;
  if (state.settle.kind === 'clash') {
    // Round 4 "The clashing set, Apply waiting": none fits, and there is nothing to step through.
    return { dot: 'danger', text: { key: 'solutions', count: { n: 0, exact: true } }, tooltip: null, stepper: null };
  }
  const { solutions, view } = state;
  const { count } = solutions;
  const position = solutions.positionBy === stepByKey(currentStepBy(state)) ? solutions.position : null;

  let text: LayerStatusText = { key: 'none' };
  if (!solutions.runs) text = position ? { key: 'solution_n', index: position.index } : { key: 'none' };
  else if (count && view.xray) text = { key: 'layer_orders', count: count.orders };
  else if (count && count.orders.n > count[view.side].n) {
    text = { key: 'pictures_and_orders', pictures: count[view.side], orders: count.orders };
  } else if (count) text = { key: 'solutions', count: count[view.side] };

  const pictures = count?.[view.side];
  const tooltip =
    solutions.runs && count && pictures && !view.xray && count.orders.exact && pictures.exact && count.orders.n > pictures.n
      ? { orders: count.orders.n, hidden: count.orders.n - pictures.n }
      : null;

  const settledNow = state.settle.kind === 'settled' && state.commit.kind !== 'pending';
  const { step } = solutions;
  // The hosts' pagers wait at the same ends (`layerPositionEnds`): ‹ stays at 1 until the total is exact,
  // and each way a step proved to end waits whatever the count says (E9).
  const ends = position ? layerPositionEnds(position, solutions.ended) : null;
  const busy = step.kind === 'pending';
  const wait = (atEnd: boolean, end: 'first' | 'last'): LayerStepperWait | null =>
    busy ? 'stepping' : !atEnd ? null : ends?.only ? 'only' : end;
  const stepper: LayerStepperView | null =
    position && ends
      ? {
          index: position.index,
          total: solutions.runs && count ? position.total : null,
          previous: settledNow && !ends.first,
          next: settledNow && !ends.last,
          busy,
          waits: { previous: wait(ends.first, 'first'), next: wait(ends.last, 'last') },
        }
      : null;

  const decided = solutions.runs && count !== null && count.orders.exact && count.orders.n === 1;
  return { dot: decided ? 'decided' : 'open', text, tooltip, stepper };
}

// ---------------------------------------------------------------------------
// The constraint rows (spec §6.5; D10, D14)

/** One object of a list row: the stored constraint behind it. */
export interface LayerRowMemberView {
  /** The stored constraint's id. */
  readonly id: number;
  /** Null when the face no longer exists. */
  readonly object: LayerFace | null;
  /** Whether the clash shown names it: a clash marks the clashing objects within their rows (D21). */
  readonly clash: boolean;
}

/**
 * One row of the constraints list: one subject, one verb, one or more
 * objects, "D in front of H, K" (D21).
 * - `row_hovered`, `row_clicked` and `row_removed` (its trash, the whole row)
 *   take its `key`, which stays the same as the figure turns over and as an
 *   undo takes back an Add that joined it.
 */
export interface LayerRowGroupView {
  readonly key: LayerRowKey;
  /** A committed row is applied; a carried one is a saved row a restore did not apply. */
  readonly kind: LayerRow['kind'];
  readonly sentence: LayerSentenceView;
  /** The dot: the clash shown marks its rows (danger); a saved row not applied is dimmed (warning). */
  readonly mark: 'none' | 'not_applied' | 'clash';
  /** For a row not applied or in a clash: its reason, for its tooltip and the hint line. */
  readonly reason: LayerRowReason | null;
  readonly hot: boolean;
  /** "Review…" opened on one of its constraints (D14). */
  readonly flagged: boolean;
  /** One per object, in the sentence's order. */
  readonly members: readonly LayerRowMemberView[];
}

function groupView(
  state: LayerOrderDialogState,
  group: LayerRowGroup,
  clash: LayerClashView | null,
  flagged: ReadonlySet<number>
): LayerRowGroupView {
  const reason = groupReason(state, group, clash);
  const inClash = reason?.key === 'clashes' || reason?.key === 'clash_within';
  const notApplied = group.kind === 'carried' && reason !== null && reason.key !== 'waiting' && !inClash;
  const clashing = new Set(clash?.rows.map((row) => row.id) ?? []);
  const members = group.members.map((row) => ({ id: row.id, object: rowParts(row).object, clash: clashing.has(row.id) }));
  return {
    key: group.key,
    kind: group.kind,
    sentence: groupSentence(state, group),
    mark: members.some((member) => member.clash) ? 'clash' : notApplied ? 'not_applied' : 'none',
    reason,
    hot: state.hover.row === group.key,
    flagged: members.some((member) => flagged.has(member.id)),
    members,
  };
}

/** The constraints list as it is drawn: one row per subject and verb, at its earliest constraint's place (D21). */
export function rowGroupsView(state: LayerOrderDialogState): LayerRowGroupView[] {
  const clash = clashOnScreen(state);
  const flagged = new Set(state.reviewRows ?? []);
  return rowGroups(state).map((group) => groupView(state, group, clash, flagged));
}

/** How many saved rows are not applied: what a host's flag counts. */
export function notAppliedCount(state: LayerOrderDialogState): number {
  return state.rows.carried.length;
}

// ---------------------------------------------------------------------------
// Opening, refusals and the notice

/** What a refusal says, by code: the face it names, and whether Keep trying can help. */
export type LayerRefusalMessage =
  | { readonly key: 'non_convex_face'; readonly face: LayerFace; readonly retry: null }
  | { readonly key: 'digest_mismatch'; readonly retry: null }
  | { readonly key: 'open_timed_out'; readonly retry: 'keep_trying' }
  | { readonly key: 'no_order'; readonly retry: null }
  | { readonly key: 'too_large'; readonly retry: null }
  | { readonly key: 'record_newer'; readonly retry: null }
  | { readonly key: 'record_unreadable'; readonly retry: null }
  | { readonly key: 'source_unreadable'; readonly code: LayerRefusal['code']; readonly retry: null };

export function refusalMessage(refusal: LayerRefusal): LayerRefusalMessage {
  switch (refusal.code) {
    case 'source_non_convex_face':
      return { key: 'non_convex_face', face: refusal.face, retry: null };
    case 'source_digest_mismatch':
      return { key: 'digest_mismatch', retry: null };
    case 'session_timed_out':
      return { key: 'open_timed_out', retry: 'keep_trying' };
    case 'session_no_order':
      return { key: 'no_order', retry: null };
    case 'source_too_many_faces':
    case 'source_stacked_too_deep':
    case 'record_over_budget':
      return { key: 'too_large', retry: null };
    case 'record_newer':
      return { key: 'record_newer', retry: null };
    case 'record_damaged':
    case 'session_bad_record':
      return { key: 'record_unreadable', retry: null };
    case 'source_no_faces':
    case 'source_kernel':
    case 'source_same_parity':
    case 'source_ambiguous_overlap':
    case 'source_tolerance':
      return { key: 'source_unreadable', code: refusal.code, retry: null };
  }
}

export type LayerOpeningView =
  /** "Working out the layer orders…", with Cancel; Apply waits. */
  | { readonly kind: 'working' }
  | { readonly kind: 'refused'; readonly message: LayerRefusalMessage }
  /** The engine went away: Try again. */
  | { readonly kind: 'failed' };

/** What the folded pane's place shows until the dialog is interactive; null once it is. */
export function openingView(state: LayerOrderDialogState): LayerOpeningView | null {
  switch (state.phase.kind) {
    case 'opening':
      return { kind: 'working' };
    case 'refused':
      return { kind: 'refused', message: refusalMessage(state.phase.refusal) };
    case 'failed':
      return { kind: 'failed' };
    default:
      return null;
  }
}

/** The line about the order the dialog opened on (D19), when it is not the host's. */
export function openNotice(state: LayerOrderDialogState): LayerOpenNotice | null {
  if (state.phase.kind !== 'open' || !state.openedOn) return null;
  return hostOrderNotice(state.openedOn, state.how === 'showing');
}
