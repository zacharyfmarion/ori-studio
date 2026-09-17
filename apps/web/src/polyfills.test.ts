import { describe, expect, it } from 'vitest';
import { arrayAt, installPolyfills } from './polyfills';

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

describe('installPolyfills', () => {
  it('leaves an engine that has the built-in alone', () => {
    const native = Array.prototype.at;
    installPolyfills();
    expect(Array.prototype.at).toBe(native);
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
