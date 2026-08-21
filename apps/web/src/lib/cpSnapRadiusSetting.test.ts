import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clampCpSnapRadius,
  CP_COARSE_POINTER_QUERY,
  CP_COARSE_POINTER_SNAP_RADIUS,
  CP_DEFAULT_SNAP_RADIUS,
  CP_MAX_SNAP_RADIUS,
  CP_MIN_SNAP_RADIUS,
  defaultCpSnapRadius,
  hasCoarsePointer,
  resolveCpSnapRadius,
  subscribeCoarsePointer,
} from './cpSnapRadiusSetting';

/**
 * Stub `matchMedia` — jsdom has none — so that {@link CP_COARSE_POINTER_QUERY}
 * answers as the given pointer would. Returns the listener registry so a test can
 * fire a change the way a Magic Keyboard being attached does.
 */
function mockPointer(pointer: 'coarse' | 'fine') {
  const listeners = new Set<() => void>();
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: query === CP_COARSE_POINTER_QUERY && pointer === 'coarse',
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  return listeners;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('clampCpSnapRadius', () => {
  it('keeps a value inside Oriedita’s slider bounds', () => {
    expect(clampCpSnapRadius(CP_MIN_SNAP_RADIUS)).toBe(2);
    expect(clampCpSnapRadius(CP_DEFAULT_SNAP_RADIUS)).toBe(10);
    expect(clampCpSnapRadius(CP_MAX_SNAP_RADIUS)).toBe(100);
  });

  it('clamps out-of-range values to the nearest bound', () => {
    expect(clampCpSnapRadius(0)).toBe(CP_MIN_SNAP_RADIUS);
    expect(clampCpSnapRadius(-40)).toBe(CP_MIN_SNAP_RADIUS);
    expect(clampCpSnapRadius(1000)).toBe(CP_MAX_SNAP_RADIUS);
  });

  it('rounds to the integer step upstream’s slider uses', () => {
    expect(clampCpSnapRadius(10.4)).toBe(10);
    expect(clampCpSnapRadius(10.5)).toBe(11);
  });

  it('degrades unreadable input to the default, not to the minimum', () => {
    // The minimum would be the tightest radius there is, which is the setting
    // most likely to look broken to whoever hit the bad value.
    expect(clampCpSnapRadius(Number.NaN)).toBe(CP_DEFAULT_SNAP_RADIUS);
    expect(clampCpSnapRadius(Number.POSITIVE_INFINITY)).toBe(CP_DEFAULT_SNAP_RADIUS);
  });
});

describe('defaultCpSnapRadius', () => {
  it('widens for a fingertip and keeps upstream’s number for a cursor', () => {
    expect(defaultCpSnapRadius(true)).toBe(CP_COARSE_POINTER_SNAP_RADIUS);
    expect(defaultCpSnapRadius(false)).toBe(CP_DEFAULT_SNAP_RADIUS);
  });

  it('offers the coarse default as a value the slider can also express', () => {
    // A default the settings field could not represent would show a number the
    // user cannot get back to after moving it.
    expect(clampCpSnapRadius(CP_COARSE_POINTER_SNAP_RADIUS)).toBe(CP_COARSE_POINTER_SNAP_RADIUS);
    expect(CP_COARSE_POINTER_SNAP_RADIUS).toBeGreaterThan(CP_DEFAULT_SNAP_RADIUS);
  });
});

describe('resolveCpSnapRadius', () => {
  it('answers an unset preference with the default for the pointer', () => {
    expect(resolveCpSnapRadius(null, true)).toBe(CP_COARSE_POINTER_SNAP_RADIUS);
    expect(resolveCpSnapRadius(null, false)).toBe(CP_DEFAULT_SNAP_RADIUS);
  });

  it('lets an explicit choice win on either pointer', () => {
    // The case the null/number split exists for: someone who set the slider to
    // upstream's own default on a desktop keeps 10 on an iPad, rather than being
    // read as never having chosen and handed the coarse default.
    expect(resolveCpSnapRadius(CP_DEFAULT_SNAP_RADIUS, true)).toBe(CP_DEFAULT_SNAP_RADIUS);
    expect(resolveCpSnapRadius(CP_COARSE_POINTER_SNAP_RADIUS, false)).toBe(
      CP_COARSE_POINTER_SNAP_RADIUS
    );
    expect(resolveCpSnapRadius(3, true)).toBe(3);
    expect(resolveCpSnapRadius(40, false)).toBe(40);
  });

  it('still enforces the slider’s bounds and step on a stored value', () => {
    expect(resolveCpSnapRadius(1000, true)).toBe(CP_MAX_SNAP_RADIUS);
    expect(resolveCpSnapRadius(1000, false)).toBe(CP_MAX_SNAP_RADIUS);
    expect(resolveCpSnapRadius(0, true)).toBe(CP_MIN_SNAP_RADIUS);
    expect(resolveCpSnapRadius(-40, false)).toBe(CP_MIN_SNAP_RADIUS);
    expect(resolveCpSnapRadius(10.5, true)).toBe(11);
  });

  it('treats an unreadable value as no choice, so the pointer decides', () => {
    expect(resolveCpSnapRadius(Number.NaN, true)).toBe(CP_COARSE_POINTER_SNAP_RADIUS);
    expect(resolveCpSnapRadius(Number.POSITIVE_INFINITY, true)).toBe(
      CP_COARSE_POINTER_SNAP_RADIUS
    );
    expect(resolveCpSnapRadius(Number.NaN, false)).toBe(CP_DEFAULT_SNAP_RADIUS);
  });
});

describe('hasCoarsePointer', () => {
  it('reads the primary pointer', () => {
    mockPointer('coarse');
    expect(hasCoarsePointer()).toBe(true);

    mockPointer('fine');
    expect(hasCoarsePointer()).toBe(false);
  });

  it('reads as precise on a host that cannot answer media queries', () => {
    // SSR and jsdom without the stub. Answering "coarse" there would move the
    // default for everyone whose environment merely fails to say.
    expect(hasCoarsePointer()).toBe(false);
  });
});

describe('subscribeCoarsePointer', () => {
  it('fires when the pointer type changes under a live session', () => {
    const listeners = mockPointer('fine');
    const onChange = vi.fn();

    const unsubscribe = subscribeCoarsePointer(onChange);
    for (const listener of listeners) listener();
    expect(onChange).toHaveBeenCalledTimes(1);

    unsubscribe();
    for (const listener of listeners) listener();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('returns a usable unsubscribe on a host with no matchMedia', () => {
    expect(() => subscribeCoarsePointer(vi.fn())()).not.toThrow();
  });
});
