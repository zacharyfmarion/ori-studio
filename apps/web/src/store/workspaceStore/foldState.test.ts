import { describe, expect, it } from 'vitest';
import { initialFoldReaderState, withFoldCursor } from '../../fold/document/foldReaderState';
import { sequenceOf, step } from '../../fold/document/foldSequence.fixtures';
import type { FoldSequenceDocument } from '../../fold/document/foldSequenceDocument';
import {
  foldReaderAfter,
  foldSequenceDataBytes,
  isShownFoldSequenceReadOnly,
  settledFoldReader,
  shownFoldSequence,
  type FoldSequences,
} from './foldState';

const held = (...documents: FoldSequenceDocument[]): FoldSequences =>
  documents.map((document) => ({ document, readOnlyRaw: null }));

/** sheet → a → b, and a branch a → c. */
const tree = sequenceOf([step('a', null), step('b', 'a'), step('c', 'a')]);

describe('the shown fold sequence', () => {
  it('is the first, and none for none', () => {
    const second = sequenceOf([], undefined, 'fold-b');
    expect(shownFoldSequence({ foldSequences: held(tree, second) })?.document).toBe(tree);
    expect(shownFoldSequence({ foldSequences: [] })).toBeNull();
  });

  it('is read-only when a newer build wrote it', () => {
    expect(isShownFoldSequenceReadOnly({ foldSequences: held(tree) })).toBe(false);
    expect(isShownFoldSequenceReadOnly({ foldSequences: [{ document: tree, readOnlyRaw: { formatVersion: 2 } }] })).toBe(true);
    expect(isShownFoldSequenceReadOnly({ foldSequences: [] })).toBe(false);
  });
});

describe('settledFoldReader', () => {
  it('holds a read reader state to the sequence shown', () => {
    const reader = withFoldCursor(initialFoldReaderState(tree.id), tree, 'b');
    expect(settledFoldReader(reader, held(tree))).toBe(reader);
    // A cursor on no step of it goes to the sheet.
    expect(settledFoldReader({ ...reader, cursor: 'gone' }, held(tree))?.cursor).toBeNull();
  });

  it('starts at the sheet of the sequence shown for none, or for another sequence', () => {
    expect(settledFoldReader(null, held(tree))).toEqual(initialFoldReaderState(tree.id));
    expect(settledFoldReader(initialFoldReaderState('fold-other'), held(tree))).toEqual(initialFoldReaderState(tree.id));
  });

  it('is none without a sequence', () => {
    expect(settledFoldReader(initialFoldReaderState(tree.id), [])).toBeNull();
  });
});

describe('foldReaderAfter', () => {
  const atB = withFoldCursor(initialFoldReaderState(tree.id), tree, 'b');
  const withoutB = { ...tree, steps: tree.steps.filter((node) => node.id !== 'b') };

  it('moves a cursor whose step a delete took to its nearest surviving ancestor', () => {
    const after = foldReaderAfter(atB, held(tree), held(withoutB), 'delete');
    expect(after?.cursor).toBe('a');
    // The active child that went is dropped, so the newest child applies.
    expect(after?.activeChild).toEqual({ '': 'a' });
  });

  it('leaves the reader as it was when nothing it names went', () => {
    const atC = withFoldCursor(initialFoldReaderState(tree.id), tree, 'c');
    expect(foldReaderAfter(atC, held(tree), held(withoutB), 'delete')).toBe(atC);
    expect(foldReaderAfter(atB, held(tree), held(tree), 'undo')).toBe(atB);
  });

  it('takes a redo to the step it restores', () => {
    const atA = withFoldCursor(initialFoldReaderState(tree.id), withoutB, 'a');
    const after = foldReaderAfter(atA, held(withoutB), held(tree), 'redo');
    expect(after?.cursor).toBe('b');
    expect(after?.activeChild).toMatchObject({ a: 'b' });
  });

  it('leaves the cursor where it is when an undo brings steps back', () => {
    const atA = withFoldCursor(initialFoldReaderState(tree.id), withoutB, 'a');
    expect(foldReaderAfter(atA, held(withoutB), held(tree), 'undo')).toBe(atA);
  });

  it('starts at the sheet of a sequence it was not in, and a redo of one takes it to the restored step', () => {
    const first = sequenceOf([step('a', null)]);
    expect(foldReaderAfter(null, [], held(first), 'delete')).toEqual(initialFoldReaderState(first.id));
    expect(foldReaderAfter(null, [], held(first), 'redo')?.cursor).toBe('a');
  });

  it('is none once there is no sequence', () => {
    expect(foldReaderAfter(atB, held(tree), [], 'undo')).toBeNull();
  });
});

describe('foldSequenceDataBytes', () => {
  it('counts what Import CP embeds and what a newer build carries, and nothing else', () => {
    const locked = { id: 'x', parent: null, op: { kind: 'sink', pocketJson: '0123456789' } };
    const document = sequenceOf([
      step('a', null),
      step('b', 'a', { kind: 'cp-jump', cpJson: '12345', orderJson: '67', origin: 'cp' }),
      { id: 'x', parent: null, unknown: locked },
    ]);
    expect(foldSequenceDataBytes(held(document))).toBe(5 + 2 + JSON.stringify(locked).length);
    expect(foldSequenceDataBytes(held(tree))).toBe(0);
  });
});
