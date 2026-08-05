import { beforeEach, describe, expect, it } from 'vitest';
import { clearStableId, getOrCreateStableId, peekStableId } from '../stableId';

beforeEach(() => {
  localStorage.clear();
});

describe('stable id', () => {
  it('creates once and returns the same id thereafter', () => {
    const a = getOrCreateStableId();
    const b = getOrCreateStableId();
    expect(a).toBe(b);
    expect(peekStableId()).toBe(a);
  });

  it('peek does not create an id', () => {
    expect(peekStableId()).toBeNull();
  });

  it('clears the id', () => {
    getOrCreateStableId();
    clearStableId();
    expect(peekStableId()).toBeNull();
  });

  it('mints a different id after clearing, so sessions are not linkable', () => {
    const a = getOrCreateStableId();
    clearStableId();
    const b = getOrCreateStableId();
    expect(b).not.toBe(a);
  });
});
