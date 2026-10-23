import { describe, expect, it } from 'vitest';
import { sequenceOf, step, valleyAt } from '../document/foldSequence.fixtures';
import type { FoldLockedStep } from '../document/foldSequenceDocument';
import { FOLD_PENDING_NODE, type FoldSessionNode } from '../session/foldSessionState';
import {
  cursorIndex,
  cycledBranch,
  foldedStepCount,
  foldPathEntries,
  foldPathMoves,
  foldPathTip,
  followerCount,
} from './foldSequencePath';

const node = (status: FoldSessionNode['status'], refusalAt?: string | null): FoldSessionNode => ({
  ...FOLD_PENDING_NODE,
  status,
  refusal: refusalAt === undefined ? null : { at: refusalAt, code: 'crease_not_found' },
});

/** sheet → a → (turn t) → b, with c a branch beside b, and d after c. */
const document = sequenceOf([
  step('a', null, valleyAt(0.5)),
  step('t', 'a', { kind: 'turn', axis: 'vertical' }),
  step('b', 't', valleyAt(0.25)),
  step('c', 't', valleyAt(0.75)),
  step('d', 'c', valleyAt(0.6)),
]);

const OK = node('ok');

function entriesOf(path: readonly string[], nodes: Record<string, FoldSessionNode> = {}) {
  return foldPathEntries(document, path, OK, new Map(Object.entries(nodes)), FOLD_PENDING_NODE);
}

describe('foldPathEntries', () => {
  it('numbers the sheet 0 and each step that folds the next, a turn none', () => {
    const entries = entriesOf(['a', 't', 'b'], { a: OK, t: OK, b: OK });
    expect(entries.map((entry) => [entry.key, entry.kind, entry.number])).toEqual([
      ['', 'sheet', 0],
      ['a', 'fold', 1],
      ['t', 'turn', null],
      ['b', 'fold', 2],
    ]);
    expect(foldedStepCount(entries)).toBe(2);
    expect(foldPathTip(entries)).toBe('b');
  });

  it('gives a step its branches: its siblings, in the order they were made', () => {
    const entries = entriesOf(['a', 't', 'c', 'd']);
    expect(entries[3]?.branches).toEqual({ ids: ['b', 'c'], index: 1 });
    expect(entries[1]?.branches).toBeNull();
    expect(entries[0]?.branches).toBeNull();
  });

  it('tells a broken step from one a broken step keeps from being reached, and keeps the rest as replayed', () => {
    const entries = entriesOf(['a', 't', 'c', 'd'], {
      a: OK,
      t: node('changed'),
      c: node('broken', 'c'),
      d: node('broken', 'c'),
    });
    expect(entries.map((entry) => entry.status)).toEqual(['ok', 'ok', 'changed', 'broken', 'brokenAbove']);
    // A step the replay has not reached is pending.
    expect(entriesOf(['a'])[1]?.status).toBe('pending');
  });

  it('keeps a locked step numbered and in place', () => {
    const locked: FoldLockedStep = { id: 'l', parent: 'a', unknown: { op: { kind: 'sink' } } };
    const withLocked = sequenceOf([step('a', null), locked]);
    const entries = foldPathEntries(withLocked, ['a', 'l'], OK, new Map([['l', node('locked')]]), FOLD_PENDING_NODE);
    expect(entries.map((entry) => [entry.key, entry.number, entry.status])).toEqual([
      ['', 0, 'ok'],
      ['a', 1, 'pending'],
      ['l', 2, 'locked'],
    ]);
  });
});

describe('the moves from the cursor', () => {
  const entries = entriesOf(['a', 't', 'c', 'd']);

  it('steps along the path, to the sheet at most and the tip at the end', () => {
    expect(foldPathMoves(entries, 0)).toMatchObject({ previous: undefined, next: 'a' });
    expect(foldPathMoves(entries, 1)).toMatchObject({ previous: null, next: 't' });
    expect(foldPathMoves(entries, 4)).toMatchObject({ previous: 'c', next: undefined });
  });

  it('moves between the branches at the step, without wrapping', () => {
    expect(foldPathMoves(entries, 3)).toMatchObject({ previousBranch: 'b', nextBranch: undefined });
    expect(foldPathMoves(entriesOf(['a', 't', 'b']), 3)).toMatchObject({ previousBranch: undefined, nextBranch: 'c' });
    expect(foldPathMoves(entries, 1)).toMatchObject({ previousBranch: undefined, nextBranch: undefined });
  });

  it('cycles a phone’s readout through the branches, the first after the last', () => {
    expect(cycledBranch(entriesOf(['a', 't', 'b']), 3)).toBe('c');
    expect(cycledBranch(entries, 3)).toBe('b');
    expect(cycledBranch(entries, 1)).toBeUndefined();
  });

  it('finds the cursor in the path, and the sheet for a cursor on none', () => {
    expect(cursorIndex(entries, 'c')).toBe(3);
    expect(cursorIndex(entries, null)).toBe(0);
    expect(cursorIndex(entries, 'b')).toBe(0);
  });
});

describe('followerCount', () => {
  it('counts every step that folds from one, on every branch', () => {
    expect(followerCount(document, 'a')).toBe(4);
    expect(followerCount(document, 'c')).toBe(1);
    expect(followerCount(document, 'd')).toBe(0);
    expect(followerCount(document, 'missing')).toBe(0);
  });
});
