import { afterEach, describe, expect, it } from 'vitest';
import { isShiftLatched, resetShiftLatch, setShiftLatched, withShiftLatch } from './shiftLatch';

afterEach(() => {
  resetShiftLatch();
});

describe('withShiftLatch', () => {
  it('is the key, or the latch, and nothing else', () => {
    expect(withShiftLatch(false)).toBe(false);
    expect(withShiftLatch(true)).toBe(true);

    setShiftLatched(true);
    expect(withShiftLatch(false)).toBe(true);
    expect(withShiftLatch(true)).toBe(true);
  });

  /*
   * `commit.additive` is optional on the tool-commit payload, and an absent
   * modifier is a modifier that is not held. Reading it as anything else would
   * change what a plain region-select commits — the exact behaviour the latch
   * has to leave alone.
   */
  it('reads an absent modifier as not held', () => {
    expect(withShiftLatch(undefined)).toBe(false);
    setShiftLatched(true);
    expect(withShiftLatch(undefined)).toBe(true);
  });
});

describe('the latch itself', () => {
  it('starts off', () => {
    expect(isShiftLatched()).toBe(false);
  });

  it('is a plain toggle, and resets', () => {
    setShiftLatched(true);
    expect(isShiftLatched()).toBe(true);
    resetShiftLatch();
    expect(isShiftLatched()).toBe(false);
  });
});
