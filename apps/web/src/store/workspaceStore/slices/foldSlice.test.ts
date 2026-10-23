import { beforeEach, describe, expect, it } from 'vitest';
import { initialFoldReaderState } from '../../../fold/document/foldReaderState';
import { valleyAt, writtenSequence } from '../../../fold/document/foldSequence.fixtures';
import {
  FOLD_SEQUENCE_FORMAT_VERSION,
  isLockedStep,
  regularPolygonShape,
  type FoldMark,
  type FoldOp,
} from '../../../fold/document/foldSequenceDocument';
import { readFoldSequences, writeFoldSequences } from '../../../fold/document/foldSequenceFile';
import type { FoldStepDraft } from '../../../fold/document/foldSequenceEdits';
import { selectWorkspaceCapabilities } from '../capabilities';
import { useWorkspaceStore } from '../store';

/** The Fold slice through the store's entry points (plan D6, D7). */
const state = () => useWorkspaceStore.getState();
const shown = () => state().foldSequences[0]!.document;
const stepIds = () => shown().steps.map((node) => node.id);
const cursor = () => state().foldReader?.cursor;

const valley = (parent: string | null, y = 0.5): FoldStepDraft => ({ parent, op: valleyAt(y) });

/** sheet → a → b, as the author folds it. */
function foldTwo() {
  const a = state().commitFoldStep(valley(null))!;
  const b = state().commitFoldStep(valley(a, 0.25))!;
  return { a, b };
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('the Fold slice', () => {
  it('creates the sequence with its first step, and undoing that step removes it again', () => {
    expect(state().foldSequences).toEqual([]);
    expect(state().foldReader).toBeNull();

    const a = state().commitFoldStep(valley(null))!;

    expect(stepIds()).toEqual([a]);
    expect(shown().paper.shape).toEqual({ kind: 'square' });
    expect(state().dirty).toBe(true);
    expect(state().foldHistory.past.map((entry) => entry.label)).toEqual(['Valley fold']);
    // The step just folded is the one on screen.
    expect(state().foldReader).toMatchObject({ sequenceId: shown().id, cursor: a });

    expect(state().undoFold()).toBe(true);
    expect(state().foldSequences).toEqual([]);
    expect(state().foldReader).toBeNull();

    // A redo moves the cursor to the step it restores.
    expect(state().redoFold()).toBe(true);
    expect(stepIds()).toEqual([a]);
    expect(cursor()).toBe(a);
    expect(state().redoFold()).toBe(false);
  });

  it('records nothing for an edit that changes nothing, and makes no sequence for one', () => {
    expect(state().commitFoldStep(valley('missing'))).toBeNull();
    expect(state().setFoldPaperShape({ kind: 'square' })).toBe(false);
    expect(state().setFoldStepSpread('missing', 'off')).toBe(false);
    expect(state().setFoldMarks(null, [])).toBe(false);
    expect(state().deleteFoldStep('missing')).toBe(false);
    expect(state().foldSequences).toEqual([]);
    expect(state().dirty).toBe(false);

    const { a } = foldTwo();
    const past = state().foldHistory.past.length;
    // Fold's default is no spread, so a step's first spread is the change; the same again is none.
    const spread = { kind: 'depth' as const, amount: 0.05, toward: 'down' as const };
    expect(state().setFoldStepSpread(a, spread)).toBe(true);
    expect(state().setFoldStepSpread(a, spread)).toBe(false);
    expect(state().foldHistory.past).toHaveLength(past + 1);
  });

  it('makes a branch when a step is committed where one already follows, and follows it', () => {
    const { a, b } = foldTwo();
    const c = state().commitFoldStep(valley(a, 0.75))!;

    expect(shown().steps.map((node) => [node.id, node.parent])).toEqual([
      [a, null],
      [b, a],
      [c, a],
    ]);
    expect(state().foldReader).toMatchObject({ cursor: c, activeChild: { '': a, [a]: c } });
  });

  it('treats where the reader is as neither history nor unsaved work', () => {
    const { a, b } = foldTwo();
    useWorkspaceStore.setState({ dirty: false });
    const past = state().foldHistory.past.length;

    expect(state().moveFoldCursor(a)).toBe(true);
    expect(state().moveFoldCursor(a)).toBe(false);
    expect(state().moveFoldCursor(null)).toBe(true);
    // A step the sequence does not hold cannot be put on screen.
    expect(state().moveFoldCursor('missing')).toBe(false);
    expect(cursor()).toBeNull();

    expect(state().dirty).toBe(false);
    expect(state().foldHistory.past).toHaveLength(past);
    expect(state().moveFoldCursor(b)).toBe(true);
  });

  it('deletes a step and what follows as one undo step, the cursor going to what survives', () => {
    const { a, b } = foldTwo();
    const c = state().commitFoldStep(valley(b, 0.1))!;
    state().moveFoldCursor(c);
    const past = state().foldHistory.past.length;

    expect(state().deleteFoldStep(b)).toBe(true);
    expect(stepIds()).toEqual([a]);
    expect(state().foldHistory.past).toHaveLength(past + 1);
    expect(state().foldHistory.past.at(-1)?.label).toBe('Delete step');
    expect(cursor()).toBe(a);

    // Undo brings both back and leaves the reader where it is.
    state().undoFold();
    expect(stepIds()).toEqual([a, b, c]);
    expect(cursor()).toBe(a);
    // Redoing the delete takes the cursor off the steps it removes again.
    state().moveFoldCursor(c);
    state().redoFold();
    expect(stepIds()).toEqual([a]);
    expect(cursor()).toBe(a);
  });

  it('moves the cursor off a step an undo takes away, to its parent', () => {
    const { a, b } = foldTwo();
    expect(cursor()).toBe(b);
    state().undoFold();
    expect(stepIds()).toEqual([a]);
    expect(cursor()).toBe(a);
    // And an active child that is gone is dropped.
    expect(state().foldReader?.activeChild).toEqual({ '': a });
  });

  it('makes one sitting at a step’s spread one undo step, until something else is recorded', () => {
    const { a, b } = foldTwo();
    const past = state().foldHistory.past.length;
    const amount = (value: number) => ({ kind: 'depth' as const, amount: value, toward: 'down' as const });

    for (const value of [0.03, 0.05, 0.08]) state().setFoldStepSpread(a, amount(value), { session: 7 });
    expect(state().foldHistory.past).toHaveLength(past + 1);
    expect(shown().steps[0]).toMatchObject({ spread: amount(0.08) });

    state().undoFold();
    expect(shown().steps[0]).not.toHaveProperty('spread');
    // Another step, or another session, is an entry of its own.
    state().setFoldStepSpread(a, amount(0.04), { session: 7 });
    state().setFoldStepSpread(b, amount(0.06), { session: 7 });
    state().setFoldStepSpread(b, amount(0.09), { session: 8 });
    expect(state().foldHistory.past).toHaveLength(past + 3);
  });

  it('makes a drag of a step’s spread one undo step, and a toggle another', () => {
    const { a, b } = foldTwo();
    const past = state().foldHistory.past.length;
    const amount = (value: number) => ({ kind: 'depth' as const, amount: value, toward: 'down' as const });

    // A drag: every value it passes is one entry, landing on the last.
    for (const value of [0.03, 0.05, 0.08]) state().setFoldStepSpread(b, amount(value), { session: 3 });
    expect(state().foldHistory.past).toHaveLength(past + 1);
    expect(shown().steps[1]).toMatchObject({ spread: amount(0.08) });
    // A toggle on the step before — its spread on, as Fold starts every step off — is an entry of its own,
    // and reaches the step no more than its own setting lets it.
    expect(state().setFoldStepSpread(a, amount(0.04))).toBe(true);
    expect(state().foldHistory.past).toHaveLength(past + 2);
    expect(shown().steps[1]).toMatchObject({ spread: amount(0.08) });
    expect(state().setFoldStepSpread(a, amount(0.04))).toBe(false);

    state().undoFold();
    expect(shown().steps[0]).not.toHaveProperty('spread');
    state().undoFold();
    expect(shown().steps[1]).not.toHaveProperty('spread');
    expect(state().foldHistory.past).toHaveLength(past);
  });

  it('marks a step or the sheet as one undo step each, and clears them', () => {
    const { a } = foldTwo();
    const mark: FoldMark = { id: 'fmark-1', from: [0, 0], to: [1, 0], divide: { mode: 'count', parts: 3 } };
    const another: FoldMark = { id: 'fmark-2', from: [0, 0], to: [0, 1], divide: { mode: 'count', parts: 2 } };
    const past = state().foldHistory.past.length;

    expect(state().setFoldMarks(null, [mark])).toBe(true);
    expect(state().setFoldMarks(a, [mark])).toBe(true);
    // A second mark on the same step, as the Divide line appends it, is an entry of its own.
    expect(state().setFoldMarks(a, [mark, another])).toBe(true);
    expect(state().foldHistory.past).toHaveLength(past + 3);
    expect(shown().sheetMarks).toEqual([mark]);
    expect(shown().steps[0]).toMatchObject({ marks: [mark, another] });

    // Clearing every mark made on a step is one entry, and one undo brings them all back.
    expect(state().setFoldMarks(a, [])).toBe(true);
    expect(state().foldHistory.past).toHaveLength(past + 4);
    expect(shown().steps[0]).not.toHaveProperty('marks');
    expect(state().undoFold()).toBe(true);
    expect(shown().steps[0]).toMatchObject({ marks: [mark, another] });
    expect(state().undoFold()).toBe(true);
    expect(shown().steps[0]).toMatchObject({ marks: [mark] });
  });

  it('changes the shape as one undo step that empties the steps, and the reader goes to the sheet', () => {
    foldTwo();
    const steps = shown().steps;
    const hexagon = regularPolygonShape(6)!;

    expect(state().setFoldPaperShape(hexagon)).toBe(true);
    expect(shown().paper.shape).toEqual(hexagon);
    expect(shown().steps).toEqual([]);
    expect(state().foldReader).toMatchObject({ cursor: null, activeChild: {} });

    state().undoFold();
    expect(shown().steps).toBe(steps);
    expect(shown().paper.shape).toEqual({ kind: 'square' });
  });

  it('turns the sheet over before the first step as one undo step, keeping the steps and the reader', () => {
    const { b } = foldTwo();
    const reader = state().foldReader;

    expect(state().setFoldStartSide('back')).toBe(true);
    expect(shown().paper.startSide).toBe('back');
    expect(stepIds()).toHaveLength(2);
    expect(state().foldReader).toBe(reader);
    expect(state().foldHistory.past.at(-1)?.label).toBe('Change start side');
    expect(state().setFoldStartSide('back')).toBe(false);

    state().undoFold();
    expect(shown().paper.startSide).toBe('front');
    expect(cursor()).toBe(b);
  });

  it('renames the sequence as one undo step, and the same name records nothing', () => {
    expect(state().setFoldSequenceTitle('Crane')).toBe(true);
    expect(shown().title).toBe('Crane');
    expect(state().setFoldSequenceTitle('Crane')).toBe(false);
    expect(state().foldHistory.past.map((entry) => entry.label)).toEqual(['Rename sequence']);
  });

  it('creates the sequence with a shape chosen before the first step', () => {
    const rectangle = { kind: 'rectangle', aspect: [1, 0.5] } as const;
    expect(state().setFoldPaperShape(rectangle)).toBe(true);
    expect(shown().paper.shape).toEqual(rectangle);
    expect(state().foldReader).toEqual(initialFoldReaderState(shown().id));
  });

  it('drops a step folded against sequences that have since been replaced', () => {
    foldTwo();
    const loadId = state().foldLoadId;
    state().installFoldSequences(state().foldSequences, state().foldReader);

    expect(state().commitFoldStep(valley(null, 0.9), { loadId })).toBeNull();
    expect(state().setFoldStepSpread(stepIds()[0], 'off', { loadId })).toBe(false);
    expect(stepIds()).toHaveLength(2);
    expect(state().commitFoldStep(valley(null, 0.9), { loadId: state().foldLoadId })).not.toBeNull();
  });

  it('commits only a step the project file keeps: one along a tool’s model-frame line is refused, recording nothing', () => {
    // The tools' own form, which the document never writes: saved, the step would come back locked.
    const op = { kind: 'valley', line: { via: 'model', line: { n: [0, 1], d: 0.5 } }, side: 'positive', seed: { scope: 'all' } };
    expect(state().commitFoldStep({ parent: null, op: op as unknown as FoldOp })).toBeNull();
    expect(state().foldSequences).toEqual([]);
    expect(state().dirty).toBe(false);

    // What the store does commit comes back from the file as it was, never locked.
    const { a, b } = foldTwo();
    const reread = readFoldSequences(writeFoldSequences(state().foldSequences));
    expect(reread[0]!.document.steps.map((node) => [node.id, isLockedStep(node)])).toEqual([
      [a, false],
      [b, false],
    ]);
  });

  it('installs sequences read from a file over an empty history, the reader held to the one shown', () => {
    foldTwo();
    const loadId = state().foldLoadId;
    const read = readFoldSequences([writtenSequence()]);
    const reader = { ...initialFoldReaderState('fold-full'), cursor: 'fstep-4' };

    state().installFoldSequences(read, reader);

    expect(state().foldSequences).toBe(read);
    expect(state().foldHistory).toEqual({ past: [], future: [] });
    expect(state().foldLoadId).not.toBe(loadId);
    expect(state().foldReader).toEqual(reader);
    // A reader state of no sequence it holds starts at the sheet of the first.
    state().installFoldSequences(read, initialFoldReaderState('fold-elsewhere'));
    expect(state().foldReader).toEqual(initialFoldReaderState('fold-full'));
    state().installFoldSequences([], reader);
    expect(state().foldReader).toBeNull();
  });

  it('changes nothing in a newer build’s sequence, and still lets the reader move', () => {
    // Newer than this build writes, whatever that is now.
    const raw = { ...writtenSequence(), formatVersion: FOLD_SEQUENCE_FORMAT_VERSION + 1 };
    const read = readFoldSequences([raw]);
    state().installFoldSequences(read, null);
    expect(read[0].readOnlyRaw).toBe(raw);

    expect(state().commitFoldStep(valley('fstep-9'))).toBeNull();
    expect(state().deleteFoldStep('fstep-9')).toBe(false);
    expect(state().setFoldStepSpread('fstep-1', 'off')).toBe(false);
    expect(state().setFoldPaperShape({ kind: 'square' })).toBe(false);
    expect(state().foldSequences).toBe(read);
    expect(state().foldHistory.past).toEqual([]);
    expect(state().moveFoldCursor('fstep-9')).toBe(true);
  });

  it('undoes and redoes the sequence from Fold, and Edit’s Undo is live off its stack', async () => {
    state().setActivePanelId('fold');
    expect(state().activeEditingContext).toBe('fold');
    expect(selectWorkspaceCapabilities(state())['edit.undo'].enabled).toBe(false);
    const { a } = foldTwo();
    const cpPast = state().oristudioCpHistoryPast;

    expect(selectWorkspaceCapabilities(state())['edit.undo'].enabled).toBe(true);
    expect(selectWorkspaceCapabilities(state())['edit.redo'].enabled).toBe(false);
    await state().undo();
    expect(stepIds()).toEqual([a]);
    expect(selectWorkspaceCapabilities(state())['edit.redo'].enabled).toBe(true);
    await state().redo();
    expect(stepIds()).toHaveLength(2);
    expect(state().oristudioCpHistoryPast).toBe(cpPast);
  });
});
