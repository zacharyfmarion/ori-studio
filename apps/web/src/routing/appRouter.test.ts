import { afterEach, describe, expect, it } from 'vitest';
import { storageKey, STORAGE_KEYS } from '../lib/storage';
import { startupHomePath } from './appRouter';

const WELCOME_KEY = storageKey(STORAGE_KEYS.showWelcomeOnStartup);

afterEach(() => localStorage.clear());

describe('startupHomePath', () => {
  it('defaults to the welcome screen', () => {
    expect(startupHomePath()).toBe('/welcome');
  });

  it('is the welcome screen when the preference is on', () => {
    localStorage.setItem(WELCOME_KEY, 'true');
    expect(startupHomePath()).toBe('/welcome');
  });

  it('is the Edit workspace when the preference is off', () => {
    localStorage.setItem(WELCOME_KEY, 'false');
    expect(startupHomePath()).toBe('/edit');
  });
});
