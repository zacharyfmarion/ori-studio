import { describe, expect, it } from 'vitest';

import { finiteNumber, isRecord } from './values';

describe('isRecord', () => {
  it('is a plain object, as JSON.parse makes one', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord(JSON.parse('{"id":"step-1"}'))).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
  });

  it('is not null, an array or a primitive', () => {
    for (const value of [null, undefined, [], [1], 'step', 3, true]) expect(isRecord(value), String(value)).toBe(false);
  });
});

describe('finiteNumber', () => {
  it('keeps a finite number', () => {
    expect(finiteNumber(0)).toBe(0);
    expect(finiteNumber(-1.5)).toBe(-1.5);
  });

  it('is null for NaN, either infinity, and anything that is not a number', () => {
    for (const value of [Number.NaN, Infinity, -Infinity, '1', null, undefined, [1]]) {
      expect(finiteNumber(value), String(value)).toBeNull();
    }
  });
});
