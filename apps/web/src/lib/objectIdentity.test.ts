import { describe, expect, it } from 'vitest';
import { identityOf } from './objectIdentity';

describe('identityOf', () => {
  it('gives the same object the same number every time', () => {
    const object = { a: 1 };
    expect(identityOf(object)).toBe(identityOf(object));
  });

  it('gives different objects different numbers, however alike they look', () => {
    expect(identityOf({ a: 1 })).not.toBe(identityOf({ a: 1 }));
  });

  it('does not care what the object is', () => {
    const array: number[] = [];
    const fn = () => undefined;
    expect(identityOf(array)).not.toBe(identityOf(fn));
    expect(identityOf(array)).toBe(identityOf(array));
  });
});
