import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPendingEdits, registerPendingEditFlush, resetPendingEditsForTests } from './pendingEdits';

afterEach(resetPendingEditsForTests);

describe('pending edits', () => {
  it('flushes every registered field, and none once unregistered', () => {
    const first = vi.fn();
    const second = vi.fn();
    const off = registerPendingEditFlush(first);
    registerPendingEditFlush(second);
    flushPendingEdits();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    off();
    flushPendingEdits();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('lets a flush unregister itself while flushing', () => {
    const calls: string[] = [];
    const off = registerPendingEditFlush(() => {
      calls.push('a');
      off();
    });
    registerPendingEditFlush(() => calls.push('b'));
    flushPendingEdits();
    expect(calls).toEqual(['a', 'b']);
  });
});
