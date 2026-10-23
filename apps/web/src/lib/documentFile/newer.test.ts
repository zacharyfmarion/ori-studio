import { describe, expect, it } from 'vitest';

import { NEWER, hasNewerKey } from './newer';

const KNOWN: ReadonlySet<string> = new Set(['id', 'kind', 'axis']);

describe('hasNewerKey', () => {
  it('is false when every key is known, all of them or some', () => {
    expect(hasNewerKey({ id: 't-1', kind: 'turn-over', axis: 'vertical' }, KNOWN)).toBe(false);
    expect(hasNewerKey({ id: 't-1' }, KNOWN)).toBe(false);
    expect(hasNewerKey({}, KNOWN)).toBe(false);
  });

  it('is true for a key outside the known set, whatever its value', () => {
    expect(hasNewerKey({ id: 't-1', kind: 'turn-over', tilt: 2 }, KNOWN)).toBe(true);
    expect(hasNewerKey({ id: 't-1', extra: undefined }, KNOWN)).toBe(true);
  });

  it('asks only of the keys a file can hold: its own', () => {
    expect(hasNewerKey(Object.create({ inherited: true }) as Record<string, unknown>, KNOWN)).toBe(false);
    // JSON.parse makes `__proto__` an own key, as any other.
    expect(hasNewerKey(JSON.parse('{"id":"t-1","__proto__":{}}') as Record<string, unknown>, KNOWN)).toBe(true);
  });
});

describe('NEWER', () => {
  it('is no value a file can hold', () => {
    expect(typeof NEWER).toBe('symbol');
    expect(JSON.parse(JSON.stringify({ value: NEWER }))).toEqual({});
  });
});
