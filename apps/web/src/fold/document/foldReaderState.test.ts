import { describe, expect, it } from 'vitest';

import {
  foldReaderActivePath,
  initialFoldReaderState,
  readFoldReaderState,
  reconcileFoldReaderState,
  settleFoldReaderState,
  withFoldCursor,
  writeFoldReaderState,
  type FoldReaderState,
} from './foldReaderState';
import { appendFoldStep, deleteFoldStep } from './foldSequenceEdits';
import { sequenceOf, sequentialIds, step, valleyAt } from './foldSequence.fixtures';

/** A at the sheet; B and C under A (C the newer); D under B; E at the sheet beside A. */
function tree() {
  return sequenceOf([
    step('a', null),
    step('b', 'a', valleyAt(0.25)),
    step('c', 'a', valleyAt(0.75)),
    step('d', 'b', valleyAt(0.1)),
    step('e', null, valleyAt(0.3)),
  ]);
}

const at = (cursor: string | null, activeChild: Record<string, string> = {}): FoldReaderState => ({
  v: 1,
  sequenceId: 'fold-a',
  cursor,
  activeChild,
});

const pathIds = (state: FoldReaderState, document = tree()) =>
  foldReaderActivePath(document, state).map((node) => node.id);

describe('reading and writing the reader state', () => {
  it('writes what it reads', () => {
    const state = at('d', { '': 'a', a: 'b' });
    expect(readFoldReaderState(JSON.parse(JSON.stringify(writeFoldReaderState(state))))).toEqual(state);
  });

  it('is none for a state it cannot read, and lets go of a cursor or an active child that does not read', () => {
    for (const value of [undefined, 'x', { v: 2, sequenceId: 'fold-a' }, { v: 1 }, { v: 1, sequenceId: '' }]) {
      expect(readFoldReaderState(value), JSON.stringify(value)).toBeNull();
    }
    expect(readFoldReaderState({ v: 1, sequenceId: 'fold-a', cursor: 4, activeChild: { a: 'b', c: 3, d: '' } })).toEqual(
      at(null, { a: 'b' })
    );
  });
});

describe('the active path', () => {
  it('takes the newest child where the reader chose none', () => {
    expect(pathIds(at(null))).toEqual(['e']);
    expect(pathIds(at(null, { '': 'a' }))).toEqual(['a', 'c']);
  });

  it('follows the children the reader chose, and the newest where a choice names no child', () => {
    expect(pathIds(at(null, { '': 'a', a: 'b' }))).toEqual(['a', 'b', 'd']);
    expect(pathIds(at(null, { '': 'a', a: 'gone' }))).toEqual(['a', 'c']);
    expect(pathIds(at(null, { '': 'a', a: 'd' }))).toEqual(['a', 'c']);
  });

  it('runs through the cursor once it is put there', () => {
    const state = withFoldCursor(initialFoldReaderState('fold-a'), tree(), 'd');
    expect(state.cursor).toBe('d');
    expect(pathIds(state)).toEqual(['a', 'b', 'd']);
    expect(withFoldCursor(state, tree(), 'missing')).toBe(state);
    expect(withFoldCursor(state, tree(), null)).toEqual({ ...state, cursor: null });
  });

  it('keeps an active child under any id a file spells, `__proto__` included', () => {
    const document = sequenceOf([step('__proto__', null), step('x', '__proto__'), step('y', '__proto__')]);
    const state = withFoldCursor(initialFoldReaderState('fold-a'), document, 'x');
    expect(pathIds(state, document)).toEqual(['__proto__', 'x']);
    const read = readFoldReaderState(JSON.parse(JSON.stringify(writeFoldReaderState(state))))!;
    expect(pathIds(read, document)).toEqual(['__proto__', 'x']);
  });
});

describe('settleFoldReaderState', () => {
  it('starts over at the sheet of another sequence', () => {
    expect(settleFoldReaderState({ ...at('d'), sequenceId: 'fold-old' }, tree())).toEqual(initialFoldReaderState('fold-a'));
  });

  it('sends a cursor on no step to the sheet, and drops active children that are no children of their step', () => {
    expect(settleFoldReaderState(at('gone', { a: 'b', b: 'c', zz: 'd' }), tree())).toEqual(at(null, { a: 'b' }));
  });

  it('gives back the same state when it already holds', () => {
    const state = at('d', { '': 'a', a: 'b' });
    expect(settleFoldReaderState(state, tree())).toBe(state);
  });
});

describe('reconcileFoldReaderState', () => {
  it('after undoing a commit, moves the cursor from the step undone to its parent, and drops it as active', () => {
    const before = appendFoldStep(tree(), { parent: 'b', op: valleyAt(0.05) }, sequentialIds())!;
    const reader = withFoldCursor(at(null), before.document, before.id);
    const state = reconcileFoldReaderState(reader, { before: before.document, after: tree(), cause: 'undo' });
    expect(state.cursor).toBe('b');
    expect(state.activeChild).toEqual({ '': 'a', a: 'b' });
  });

  it('after a delete, moves a cursor deep in the subtree to the deleted step’s parent', () => {
    const before = tree();
    const reader = withFoldCursor(at(null), before, 'd');
    const state = reconcileFoldReaderState(reader, { before, after: deleteFoldStep(before, 'b'), cause: 'delete' });
    expect(state.cursor).toBe('a');
    // The deleted branch was active: the newest child applies again.
    expect(pathIds(state, deleteFoldStep(before, 'b'))).toEqual(['a', 'c']);
  });

  it('moves the cursor to the sheet when the step deleted folds from it', () => {
    const before = tree();
    const reader = withFoldCursor(at(null), before, 'd');
    const after = deleteFoldStep(before, 'a');
    expect(reconcileFoldReaderState(reader, { before, after, cause: 'delete' })).toEqual(at(null));
  });

  it('after a redo, moves the cursor to the step it restores, and the active path through it', () => {
    const after = appendFoldStep(tree(), { parent: 'a', op: valleyAt(0.6) }, sequentialIds())!;
    const reader = withFoldCursor(at(null), tree(), 'd');
    const state = reconcileFoldReaderState(reader, { before: tree(), after: after.document, cause: 'redo' });
    expect(state.cursor).toBe(after.id);
    expect(pathIds(state, after.document)).toEqual(['a', after.id]);
  });

  it('does not move the cursor when an undo restores steps', () => {
    const before = deleteFoldStep(tree(), 'b');
    const reader = withFoldCursor(at(null), before, 'a');
    const state = reconcileFoldReaderState(reader, { before, after: tree(), cause: 'undo' });
    expect(state).toBe(reader);
  });

  it('gives back the same state when nothing it names went', () => {
    const before = tree();
    const reader = withFoldCursor(at(null), before, 'c');
    expect(reconcileFoldReaderState(reader, { before, after: deleteFoldStep(before, 'e'), cause: 'delete' })).toBe(reader);
  });

  it('starts over when the change replaced the sequence', () => {
    const after = { ...tree(), id: 'fold-b' };
    expect(reconcileFoldReaderState(at('d'), { before: tree(), after, cause: 'undo' })).toEqual(
      initialFoldReaderState('fold-b')
    );
  });
});
