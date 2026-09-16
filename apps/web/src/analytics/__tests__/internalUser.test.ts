import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../../lib/storage';
import {
  consumeInternalUserFlag,
  getInternalUserProperties,
  isInternalUser,
  type InternalUserFlagSource,
} from '../internalUser';

const KEY = storageKey(STORAGE_KEYS.analyticsInternalUser);

function source(search: string, pathname = '/edit', hash = ''): InternalUserFlagSource {
  return {
    location: { pathname, search, hash },
    history: { state: { idx: 3 }, replaceState: vi.fn() },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('internal user flag', () => {
  it('is off by default and sends no property', () => {
    expect(isInternalUser()).toBe(false);
    expect(getInternalUserProperties()).toEqual({});
  });

  it('leaves the URL alone when the parameter is absent', () => {
    const src = source('?tab=fold');
    expect(consumeInternalUserFlag(src)).toBe(false);
    expect(src.history.replaceState).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('?internal=1 persists the flag and strips only that parameter', () => {
    const src = source('?tab=fold&internal=1', '/edit', '#top');
    expect(consumeInternalUserFlag(src)).toBe(true);
    expect(isInternalUser()).toBe(true);
    expect(getInternalUserProperties()).toEqual({ internal_user: true });
    expect(src.history.replaceState).toHaveBeenCalledWith({ idx: 3 }, '', '/edit?tab=fold#top');
  });

  it('survives a reload without the parameter', () => {
    consumeInternalUserFlag(source('?internal=1'));
    expect(consumeInternalUserFlag(source(''))).toBe(true);
  });

  it('?internal=0 clears the flag', () => {
    consumeInternalUserFlag(source('?internal=1'));
    const src = source('?internal=0');
    expect(consumeInternalUserFlag(src)).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(getInternalUserProperties()).toEqual({});
    expect(src.history.replaceState).toHaveBeenCalledWith({ idx: 3 }, '', '/edit');
  });

  it('ignores an unrecognised value but still strips it', () => {
    const src = source('?internal=maybe');
    expect(consumeInternalUserFlag(src)).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(src.history.replaceState).toHaveBeenCalledWith({ idx: 3 }, '', '/edit');
  });

  it('keeps the flag when the history rewrite throws', () => {
    const src = source('?internal=1');
    src.history.replaceState = vi.fn(() => {
      throw new Error('sandboxed');
    });
    expect(consumeInternalUserFlag(src)).toBe(true);
  });

  it('reads the persisted flag when there is no window', () => {
    localStorage.setItem(KEY, 'true');
    expect(consumeInternalUserFlag(null)).toBe(true);
  });
});
