import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COARSE_POINTER_QUERY } from '../../platform/pointerSurface';
import { isShiftLatched, resetShiftLatch, setShiftLatched, withShiftLatch } from './shiftLatch';

/**
 * Say what the pointer is, rather than letting jsdom's missing `matchMedia`
 * decide. The latch means one thing on a fingertip and nothing on a mouse, so a
 * test that does not state which is asserting against a default.
 */
function mockPointer(kind: 'coarse' | 'fine') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === COARSE_POINTER_QUERY && kind === 'coarse',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  mockPointer('coarse');
});

afterEach(() => {
  resetShiftLatch();
  Reflect.deleteProperty(window, 'matchMedia');
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

/**
 * The bug this file did not catch the first time.
 *
 * The flip used to be handled by an effect inside `CpShiftLatchToggle`, which
 * could never run: both of that component's mount sites are coarse-gated, so
 * React removed it in the same commit that would have told it the pointer
 * changed. These tests are here rather than in the component's file because the
 * lesson was that no component can be trusted to hold this — the invariant
 * belongs to the latch, so it is asserted against the latch.
 */
describe('the latch against the pointer', () => {
  it('is inert on a device that has the key it stands in for', () => {
    setShiftLatched(true);
    expect(isShiftLatched()).toBe(true);

    // A convertible folded back into laptop mode. Nothing calls the latch to
    // tell it so — that is the point.
    mockPointer('fine');
    expect(isShiftLatched()).toBe(false);
    expect(withShiftLatch(false)).toBe(false);
    expect(withShiftLatch(undefined)).toBe(false);
  });

  it('still lets a real Shift key through on that device', () => {
    mockPointer('fine');
    setShiftLatched(true);
    // The latch is ignored, the hardware is not. Otherwise the guard would cost
    // additive selection to every mouse user with a stale bit set.
    expect(withShiftLatch(true)).toBe(true);
  });

  it('is not destroyed by the flip, only ignored', () => {
    setShiftLatched(true);
    mockPointer('fine');
    expect(isShiftLatched()).toBe(false);

    // Flipped back to tablet mode. The user turned this on and never turned it
    // off, and the button is on screen reading pressed — so it is theirs again.
    // There is no state here that is effective while invisible, which is the
    // property that actually matters.
    mockPointer('coarse');
    expect(isShiftLatched()).toBe(true);
  });

  it('answers a host that cannot say what the pointer is with "not latched"', () => {
    setShiftLatched(true);
    Reflect.deleteProperty(window, 'matchMedia');
    // Headless, SSR, a jsdom test that forgot to stub. `isCoarsePointerSurface`
    // reports fine there, so the latch stays out of the way rather than making
    // an unattended render additive.
    expect(isShiftLatched()).toBe(false);
  });
});
