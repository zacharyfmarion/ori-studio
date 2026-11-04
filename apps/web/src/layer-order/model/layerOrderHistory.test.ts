/** The dialog's local history (Round3 `commit`, `undo`, `redo`). */
import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  emptyHistory,
  landed,
  recorded,
  redoTarget,
  undoTarget,
  type LayerHistory,
} from './layerOrderHistory';

/** Undo and redo with nothing in flight: the move lands at once, from the past as it is. */
const undone = <T>(history: LayerHistory<T>, present: T) => landed(history, history.past.length, { kind: 'undo', present });
const redone = <T>(history: LayerHistory<T>, present: T) => landed(history, history.past.length, { kind: 'redo', present });

describe('the local history', () => {
  it('starts empty', () => {
    const history = emptyHistory<string>();
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undoTarget(history)).toBeNull();
    expect(redoTarget(history)).toBeNull();
  });

  it('an edit puts the present on the past and drops the future (Round3 commit)', () => {
    const history = recorded(recorded(emptyHistory<string>(), 'a'), 'b');
    expect(history).toEqual({ past: ['a', 'b'], future: [] });
    expect(recorded(undone(history, 'c'), 'b')).toEqual({ past: ['a', 'b'], future: [] });
  });

  it('undo steps back to the last entry and keeps the present for redo (Round3 undo)', () => {
    const history = recorded(recorded(emptyHistory<string>(), 'a'), 'b');
    expect(undoTarget(history)).toBe('b');
    const back = undone(history, 'c');
    expect(back).toEqual({ past: ['a'], future: ['c'] });
    expect(undoTarget(back)).toBe('a');
    expect(redoTarget(back)).toBe('c');
  });

  it('redo steps forward and puts the present back on the past (Round3 redo)', () => {
    const back = undone(undone(recorded(recorded(emptyHistory<string>(), 'a'), 'b'), 'c'), 'b');
    expect(back).toEqual({ past: [], future: ['b', 'c'] });
    const forward = redone(back, 'a');
    expect(forward).toEqual({ past: ['a'], future: ['c'] });
    expect(redone(forward, 'b')).toEqual({ past: ['a', 'b'], future: [] });
  });
});

describe('a commit or a step landing', () => {
  const start: LayerHistory<string> = { past: ['a', 'b'], future: ['x', 'y'] };

  it('with nothing recorded since, moves as a new edit, undo and redo do', () => {
    expect(landed(start, 2, { kind: 'record', entry: 'c' })).toEqual(recorded(start, 'c'));
    expect(landed(start, 2, { kind: 'undo', present: 'c' })).toEqual({ past: ['a'], future: ['c', 'x', 'y'] });
    expect(landed(start, 2, { kind: 'redo', present: 'c' })).toEqual({ past: ['a', 'b', 'c'], future: ['y'] });
    expect(landed(start, 2, { kind: 'none' })).toBe(start);
  });

  it('keeps the sentence’s edits made while it was in flight on top of it, with the future they dropped', () => {
    // Asked with two entries in the past; two edits went on while it ran, dropping the future.
    const since = recorded(recorded(start, 'e1'), 'e2');
    expect(landed(since, 2, { kind: 'record', entry: 'c' })).toEqual({ past: ['a', 'b', 'c', 'e1', 'e2'], future: [] });
    // An undo asked then takes back 'b', the entry before the edits; its redo went with the future.
    expect(landed(since, 2, { kind: 'undo', present: 'c' })).toEqual({ past: ['a', 'e1', 'e2'], future: [] });
    expect(landed(since, 2, { kind: 'redo', present: 'c' })).toEqual({ past: ['a', 'b', 'c', 'e1', 'e2'], future: [] });
    expect(landed(since, 2, { kind: 'none' })).toBe(since);
  });
});
