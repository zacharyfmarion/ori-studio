import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortSignalTimeout, arrayAt, installPolyfills } from './polyfills';

describe('arrayAt', () => {
  const list = ['a', 'b', 'c'];

  it('indexes from the front and from the end', () => {
    expect(arrayAt.call(list, 0)).toBe('a');
    expect(arrayAt.call(list, 2)).toBe('c');
    expect(arrayAt.call(list, -1)).toBe('c');
    expect(arrayAt.call(list, -3)).toBe('a');
  });

  it('is undefined outside the bounds in either direction', () => {
    expect(arrayAt.call(list, 3)).toBeUndefined();
    expect(arrayAt.call(list, -4)).toBeUndefined();
    expect(arrayAt.call([], -1)).toBeUndefined();
  });

  it('truncates a fractional index and treats NaN as zero, as the built-in does', () => {
    expect(arrayAt.call(list, 1.9)).toBe(list.at(1.9));
    expect(arrayAt.call(list, -1.5)).toBe(list.at(-1.5));
    expect(arrayAt.call(list, Number.NaN)).toBe(list.at(Number.NaN));
  });

  it('agrees with the built-in across a sweep of indices', () => {
    for (let index = -5; index <= 5; index += 1) {
      expect(arrayAt.call(list, index)).toBe(list.at(index));
    }
  });
});

describe('abortSignalTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is not aborted until the time is up, then is, with a TimeoutError', () => {
    vi.useFakeTimers();
    const signal = abortSignalTimeout(1000);
    vi.advanceTimersByTime(999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(signal.aborted).toBe(true);
    expect((signal.reason as DOMException).name).toBe('TimeoutError');
  });
});

describe('installPolyfills', () => {
  it('leaves an engine that has the built-ins alone', () => {
    const nativeAt = Array.prototype.at;
    const nativeTimeout = AbortSignal.timeout;
    installPolyfills();
    expect(Array.prototype.at).toBe(nativeAt);
    expect(AbortSignal.timeout).toBe(nativeTimeout);
  });

  it('installs a non-enumerable `AbortSignal.timeout` where there is none', () => {
    // Catalina's WebKit (Safari 15.6) has `AbortSignal` and not `timeout`; the
    // ExplOri client calls it before every request.
    const realm = { Array: { prototype: {} }, AbortSignal: {} as { timeout?: unknown } };
    installPolyfills(realm);
    expect(realm.AbortSignal.timeout).toBe(abortSignalTimeout);
    expect(Object.keys(realm.AbortSignal)).not.toContain('timeout');
  });

  it('installs a non-enumerable `at` where there is none', () => {
    class Missing {
      length = 2;
      0 = 'x';
      1 = 'y';
    }
    const realm = { Array: { prototype: Missing.prototype } };
    installPolyfills(realm);

    const list = new Missing() as unknown as { at: (index: number) => string | undefined };
    expect(list.at(-1)).toBe('y');
    expect(Object.keys(Missing.prototype)).not.toContain('at');
    expect(Object.getOwnPropertyDescriptor(Missing.prototype, 'at')).toMatchObject({
      enumerable: false,
      writable: true,
      configurable: true,
    });
  });
});
