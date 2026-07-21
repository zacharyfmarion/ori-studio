import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readBoolean,
  readJson,
  readString,
  removeKey,
  storageKey,
  STORAGE_KEYS,
  STORAGE_NAMESPACE,
  writeBoolean,
  writeJson,
  writeString,
} from './storage';

describe('storageKey', () => {
  it('prefixes the namespace and joins parts with colons', () => {
    expect(storageKey(STORAGE_KEYS.theme)).toBe(`${STORAGE_NAMESPACE}:theme`);
    expect(storageKey(STORAGE_KEYS.layout, 'design')).toBe(`${STORAGE_NAMESPACE}:layout:design`);
    expect(storageKey('layout', 'design', 'box-pleat')).toBe(
      `${STORAGE_NAMESPACE}:layout:design:box-pleat`
    );
  });
});

describe('string primitives', () => {
  afterEach(() => localStorage.clear());

  it('round-trips and removes a value', () => {
    const key = storageKey('test-string');
    expect(readString(key)).toBeNull();
    writeString(key, 'hello');
    expect(readString(key)).toBe('hello');
    removeKey(key);
    expect(readString(key)).toBeNull();
  });
});

describe('readJson / writeJson', () => {
  afterEach(() => localStorage.clear());

  it('round-trips an object', () => {
    const key = storageKey('test-json');
    writeJson(key, { a: 1, b: ['x'] });
    expect(readJson(key, null)).toEqual({ a: 1, b: ['x'] });
  });

  it('returns the fallback when the key is absent', () => {
    expect(readJson(storageKey('missing'), { fallback: true })).toEqual({ fallback: true });
  });

  it('returns the fallback when the stored value is malformed', () => {
    const key = storageKey('test-bad-json');
    writeString(key, '{not valid');
    expect(readJson(key, 'default')).toBe('default');
  });
});

describe('readBoolean / writeBoolean', () => {
  afterEach(() => localStorage.clear());

  it('round-trips both values', () => {
    const key = storageKey('test-bool');
    writeBoolean(key, false);
    expect(readBoolean(key, true)).toBe(false);
    writeBoolean(key, true);
    expect(readBoolean(key, false)).toBe(true);
  });

  it('returns the fallback when absent', () => {
    expect(readBoolean(storageKey('missing-bool'), true)).toBe(true);
    expect(readBoolean(storageKey('missing-bool'), false)).toBe(false);
  });
});

describe('unavailable storage', () => {
  it('falls back without throwing when access throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readString(storageKey('anything'))).toBeNull();
    expect(readBoolean(storageKey('anything'), true)).toBe(true);
    spy.mockRestore();
  });

  it('swallows write failures', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => writeString(storageKey('anything'), 'x')).not.toThrow();
    spy.mockRestore();
  });
});
