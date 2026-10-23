/**
 * The edits a Fold sequence takes (plan D6, D7). Each is one undo entry, and
 * each returns the document it was given when it changes nothing, so the
 * store kit records nothing for it.
 *
 * - **Committing is append-only.** A step is added under its parent, never
 *   inserted; committing at a node that already has children makes a branch.
 *   A linked Collapse may be explicitly updated in place. A step is appended only as the file
 *   keeps it, so none comes back locked when the project is opened again.
 * - **Other in-place edits of a step are annotations** — its note, the
 *   marks made on it or on the sheet, and how its picture spreads its layers.
 *   None can break a step: inputs hold resolved points, and all are outside
 *   `fh1` and `fs1`. The sequence's title is outside both too.
 * - **Delete takes a step and everything that follows it**, locked or not.
 * - **Changing the shape empties the sequence**: it replaces the shape and
 *   the steps as one edit, never appending a hidden sequence. Changing the
 *   side that starts up keeps the steps, and mirrors what they fold.
 *
 * Nothing locked is edited: a step this build cannot read, and everything
 * that folds from one, can only be deleted.
 *
 * Pure: no React, no store.
 */

import { foldReturnPath } from './foldReturn';
import { sameSpread } from '../../cp-workspace/folded/layerSpreadSettings';
import { xmlText } from '../../lib/xmlEscape';
import { snapshotDocumentPaperStyle, type DocumentPaperStyle } from '../../lib/paper/documentPaperStyle';
import { paperStyleEquals } from '../../lib/paper/paperStyle';
import { canonicalJson, foldPaperKey, foldPathDigest } from './foldDigest';
import {
  FOLD_DEFAULT_PAPER_STYLE,
  isKnownSpread,
  isLockedStep,
  randomFoldId,
  type FoldChoices,
  type FoldCpJumpOp,
  type FoldReturnOp,
  type FoldIdFactory,
  type FoldMarkEntry,
  type FoldOp,
  type FoldPaperShape,
  type FoldSequenceDocument,
  type FoldSpreadSetting,
  type FoldStartSide,
  type FoldStep,
} from './foldSequenceDocument';
import { readBackFoldStep } from './foldSequenceFile';
import { normalizeFoldLandingOp } from './foldLandingMigration';
import { foldInheritedSpread, sameAsInherited } from './foldStepSpread';
import { foldStepTree, lockedIds, subtreeIds, pathTo } from './foldStepTree';

/** A step to commit: everything but its id, which the commit makes. */
export interface FoldStepDraft {
  parent: string | null;
  op: FoldOp;
  choices?: FoldChoices;
  /** The `fs1` of the state the preview landed. */
  expect?: string;
  /**
   * The sheet the sequence takes with its first step: an Import CP into an
   * empty sequence adopts the crease pattern's square or rectangle (plan
   * D16), and the step folds from that sheet. Only for a first step.
   */
  adopt?: FoldPaperShape;
}

/**
 * Whether the file keeps a draft's step as it folds: its op written and read
 * back is the same op — nothing the file leaves out, which would change the
 * fold — and its choices read back at all. A step the file did not keep
 * would fold one way now and, once the project is opened again, come back
 * locked or folding another way.
 */
function keptAsFolded({ op, choices }: FoldStepDraft): boolean {
  const back = readBackFoldStep(op, choices);
  return back !== null && canonicalJson(back.op) === canonicalJson(normalizeFoldLandingOp(op));
}

/**
 * Commit a step under `draft.parent`: the document with it appended, and its
 * id. Null when the parent is not a step of the document, or is locked, or
 * when the draft adopts a sheet for a sequence that already has steps — or
 * when the file would not keep the step as it folds (a tool's line in the
 * parent's model frame, which only the bridge reads).
 *
 * A draft that adopts a sheet changes the shape as {@link setFoldPaperShape}
 * does, in the same edit — one undo entry for the import.
 */
export function appendFoldStep(
  document: FoldSequenceDocument,
  draft: FoldStepDraft,
  newId: FoldIdFactory = randomFoldId
): { document: FoldSequenceDocument; id: string } | null {
  const { parent } = draft;
  if (!keptAsFolded(draft)) return null;
  if (draft.op.kind === 'unfold-to' && !foldReturnPath(document, parent, draft.op.target)) return null;
  if (draft.adopt) {
    if (parent !== null || document.steps.length > 0) return null;
    document = setFoldPaperShape(document, draft.adopt);
  }
  if (parent !== null) {
    const tree = foldStepTree(document.steps);
    if (!tree.byId.has(parent) || lockedIds(tree).has(parent)) return null;
  }
  const step: FoldStep = {
    id: newId('fstep'),
    parent,
    op: draft.op,
    ...(draft.choices ? { choices: draft.choices } : {}),
    ...(draft.expect !== undefined ? { expect: draft.expect } : {}),
  };
  return { document: { ...document, steps: [...document.steps, step] }, id: step.id };
}

/** Publish a prepared sequence as one editor transaction, or publish nothing. */
export function appendFoldSteps(document: FoldSequenceDocument, parent: string | null,
  entries: readonly (Omit<FoldStepDraft, 'parent' | 'adopt'> & { returnTo?: number })[], newId: FoldIdFactory = randomFoldId) {
  if (!entries.length || entries.length > 128) return null;
  let next = document;
  let id = parent;
  const ids: (string | null)[] = [parent];
  for (const entry of entries) {
    let op = entry.op;
    if (op.kind === 'unfold-to') {
      const target = entry.returnTo;
      if (target === undefined || !Number.isInteger(target) || target < 0 || target >= ids.length) return null;
      const path = id === null ? [] : pathTo(foldStepTree(next.steps), id);
      if (!path) return null;
      op = { ...op, target: ids[target]!, source: { ...op.source, path: foldPathDigest(next.paper, path) } };
    }
    const result = appendFoldStep(next, { ...entry, op, parent: id }, newId);
    if (!result) return null;
    next = result.document;
    id = result.id;
    ids.push(id);
  }
  return { document: next, id: id! };
}

export function updateFoldRepeat(document: FoldSequenceDocument, id: string,
  expected: import('./foldSequenceDocument').FoldRepeatOp,
  op: import('./foldSequenceDocument').FoldRepeatOp, expect: string) {
  return editStep(document, id, (step) => {
    if (canonicalJson(step.op) !== canonicalJson(expected) || !keptAsFolded({ parent: step.parent, op })) return step;
    return { ...step, op, expect };
  });
}

/** "Delete this step and what follows": the step and its subtree, locked or not. */
export function deleteFoldStep(document: FoldSequenceDocument, id: string): FoldSequenceDocument {
  const doomed = subtreeIds(foldStepTree(document.steps), id);
  if (doomed.size === 0) return document;
  return { ...document, steps: document.steps.filter((node) => !doomed.has(node.id)) };
}

/** Set a step's note; an empty note clears it. Locked steps keep theirs. */
export function setFoldStepNote(document: FoldSequenceDocument, id: string, note: string): FoldSequenceDocument {
  const text = xmlText(note);
  return editStep(document, id, (step) => {
    if ((step.note ?? '') === text) return step;
    const { note: _previous, ...rest } = step;
    return text.length > 0 ? { ...rest, note: text } : rest;
  });
}

/**
 * Set a step's own layer spread — a spread, or `'off'` — or, for null, let it
 * take an earlier step's again (`foldStepSpread`). A setting the steps before
 * would give it anyway is no setting of its own, and is not kept: a change
 * earlier on still reaches it, and turning a spread off and on again leaves
 * the document as it was. A locked step keeps its own.
 */
export function setFoldStepSpread(
  document: FoldSequenceDocument,
  id: string,
  spread: FoldSpreadSetting | null
): FoldSequenceDocument {
  const own = spread === null || sameAsInherited(spread, foldInheritedSpread(document, id)) ? undefined : spread;
  return editStep(document, id, (step) => {
    if (sameEntry(step.spread, own)) return step;
    const { spread: _previous, ...rest } = step;
    return own === undefined ? rest : { ...rest, spread: own };
  });
}

/** Whether a step's spread entry is `setting` already: both none, both off, or one spread. A carried one is never. */
function sameEntry(entry: FoldStep['spread'], setting: FoldSpreadSetting | undefined): boolean {
  if (entry === undefined || setting === undefined) return entry === setting;
  if (!isKnownSpread(entry)) return false;
  if (entry === 'off' || setting === 'off') return entry === setting;
  return sameSpread(entry, setting);
}

/**
 * Replace the marks made on step `id`, or on the flat sheet for null. An
 * empty list clears them. A locked step keeps its marks.
 */
export function setFoldMarks(
  document: FoldSequenceDocument,
  id: string | null,
  marks: readonly FoldMarkEntry[]
): FoldSequenceDocument {
  if (id === null) {
    if (marks === document.sheetMarks || (marks.length === 0 && !document.sheetMarks?.length)) return document;
    const { sheetMarks: _previous, ...rest } = document;
    return marks.length > 0 ? { ...rest, sheetMarks: marks } : rest;
  }
  return editStep(document, id, (step) => {
    if (marks === step.marks || (marks.length === 0 && !step.marks?.length)) return step;
    const { marks: _previous, ...rest } = step;
    return marks.length > 0 ? { ...rest, marks } : rest;
  });
}

/**
 * Change the sheet's shape: the shape replaced, and the steps emptied, as one
 * edit (plan D7). The marks made on the flat sheet go too — the plan names
 * only the steps, but a mark divides an edge of the old sheet, which the new
 * one need not have, and an annotation at a place that is no longer one is
 * worse than none. The same shape changes nothing.
 */
export function setFoldPaperShape(document: FoldSequenceDocument, shape: FoldPaperShape): FoldSequenceDocument {
  const paper = { ...document.paper, shape };
  if (foldPaperKey(paper) === foldPaperKey(document.paper)) return document;
  const { sheetMarks: _marks, ...rest } = document;
  return { ...rest, paper, steps: [] };
}

/**
 * Set the paper style the sequence is drawn in, keeping its steps: a style
 * paints, it never folds. A style drawn the same as the one it has changes
 * nothing — a carried newer style is dropped once another is chosen.
 */
export function setFoldPaperStyle(document: FoldSequenceDocument, style: DocumentPaperStyle): FoldSequenceDocument {
  const next = snapshotDocumentPaperStyle(style);
  const current = document.style ?? FOLD_DEFAULT_PAPER_STYLE;
  const samePreset = ('preset' in next ? next.preset : null) === ('preset' in current ? current.preset : null);
  if (samePreset && paperStyleEquals(next.style, current.style) && !document.carried?.style) return document;
  const { style: _carried, ...carried } = document.carried ?? {};
  const { carried: _previous, ...rest } = document;
  return { ...rest, style: next, ...(Object.keys(carried).length > 0 ? { carried } : {}) };
}

/** Set the sequence's title; surrounding space is dropped, and the same title changes nothing. */
export function setFoldSequenceTitle(document: FoldSequenceDocument, title: string): FoldSequenceDocument {
  const text = xmlText(title).trim();
  return text === document.title ? document : { ...document, title: text };
}

/**
 * Change which side of the sheet faces the viewer before the first step,
 * keeping the steps. A step's direction is a valley or a mountain as the
 * viewer sees it (plan D6), so every step still folds — the mirror image of
 * what it folded — but no step lands where it landed when it was committed.
 * So each step's `expect` goes with the change: a mismatch would say the
 * engine changed (*changed*, plan D6), when it was the author who did. The
 * same side changes nothing.
 */
export function setFoldStartSide(document: FoldSequenceDocument, startSide: FoldStartSide): FoldSequenceDocument {
  if (document.paper.startSide === startSide) return document;
  const steps = document.steps.map((node) => {
    if (isLockedStep(node) || node.expect === undefined) return node;
    const { expect: _landed, ...rest } = node;
    return rest;
  });
  return { ...document, paper: { ...document.paper, startSide }, steps };
}

/**
 * Apply `edit` to step `id` when it is a step this build may edit; the
 * document itself otherwise, or when `edit` changes nothing.
 */
function editStep(
  document: FoldSequenceDocument,
  id: string,
  edit: (step: FoldStep) => FoldStep
): FoldSequenceDocument {
  const tree = foldStepTree(document.steps);
  const node = tree.byId.get(id);
  if (!node || isLockedStep(node) || lockedIds(tree).has(id)) return document;
  const edited = edit(node);
  if (edited === node) return document;
  return { ...document, steps: document.steps.map((step) => (step === node ? edited : step)) };
}

/** Explicit source refresh: keep the node, branches and notes, and let replay
 * compare every descendant against its saved fingerprint. Never retarget it. */
export function updateFoldCollapse(
  document: FoldSequenceDocument,
  stepId: string,
  expected: FoldCpJumpOp,
  op: FoldCpJumpOp,
  expect: string
): FoldSequenceDocument {
  const step = document.steps.find((node) => node.id === stepId);
  if (!step?.op || step.op.kind !== 'cp-jump' || !step.op.source || !op.source ||
      canonicalJson(step.op) !== canonicalJson(expected) ||
      lockedIds(foldStepTree(document.steps)).has(stepId) ||
      !keptAsFolded({ parent: step.parent, op })) return document;
  if (canonicalJson(step.op) === canonicalJson(op) && step.expect === expect) return document;
  return { ...document, steps: document.steps.map((node) => node.id === stepId ? { ...step, op, expect } : node) };
}

/** Rebuild a recorded return only against the revision the preview opened on. */
export function updateFoldReturn(document: FoldSequenceDocument, stepId: string,
  expected: FoldReturnOp, op: FoldReturnOp, expect: string): FoldSequenceDocument {
  const step = document.steps.find((node) => node.id === stepId);
  if (!step?.op || step.op.kind !== 'unfold-to' || !foldReturnPath(document, step.parent, op.target) ||
      canonicalJson(step.op) !== canonicalJson(expected) ||
      lockedIds(foldStepTree(document.steps)).has(stepId) ||
      !keptAsFolded({ parent: step.parent, op })) return document;
  if (canonicalJson(step.op) === canonicalJson(op) && step.expect === expect) return document;
  return { ...document, steps: document.steps.map((node) => node.id === stepId ? { ...step, op, expect } : node) };
}
