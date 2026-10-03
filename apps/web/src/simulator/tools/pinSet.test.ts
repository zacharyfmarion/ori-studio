import { describe, expect, it } from 'vitest';
import { applyPinPick, EMPTY_PIN_SET, pinPickOutcome, pinSetsEqual } from './pinSet';

describe('applyPinPick', () => {
  it('replaces the set, sorted and without repeats', () => {
    expect(applyPinPick([1, 2], [9, 3, 9], 'replace')).toEqual([3, 9]);
  });

  it('empties the set when a replacing pick finds nothing', () => {
    // A plain box or click on empty space, as Box Select empties a selection.
    expect(applyPinPick([1, 2], [], 'replace')).toEqual(EMPTY_PIN_SET);
  });

  it('adds without repeats, and keeps the very same set when nothing was found', () => {
    expect(applyPinPick([1, 5], [5, 2], 'add')).toEqual([1, 2, 5]);
    const current = [1, 5];
    expect(applyPinPick(current, [], 'add')).toBe(current);
  });

  it('toggles each picked face once', () => {
    expect(applyPinPick([1, 5], [5, 2], 'toggle')).toEqual([1, 2]);
    expect(applyPinPick([1], [4, 4], 'toggle')).toEqual([1, 4]);
    const current = [3];
    expect(applyPinPick(current, [], 'toggle')).toBe(current);
  });
});

describe('pinPickOutcome', () => {
  it('reads a pick that found nothing as empty, whatever it did to the set', () => {
    expect(pinPickOutcome([1], [], [])).toBe('empty');
    expect(pinPickOutcome([1], [1], [])).toBe('empty');
  });

  it('tells a change from a pick that found only what was pinned', () => {
    expect(pinPickOutcome([1], [1, 2], [2])).toBe('changed');
    expect(pinPickOutcome([1, 2], [1, 2], [2])).toBe('unchanged');
  });
});

describe('pinSetsEqual', () => {
  it('compares element by element', () => {
    expect(pinSetsEqual([1, 2], [1, 2])).toBe(true);
    expect(pinSetsEqual([1, 2], [1, 3])).toBe(false);
    expect(pinSetsEqual([1], [1, 2])).toBe(false);
  });
});
