import { afterEach, describe, expect, it } from 'vitest';
import { isApplePlatform as runtimeIsApplePlatform } from '../platform/runtime';
import { isApplePlatform, isPrimaryModifier, primaryModifierLabel } from './platform';

/**
 * Override the fields `platform/runtime` reads. jsdom defines them on
 * `Navigator.prototype`, so shadowing on the instance is what a test can do; the
 * keys are deleted again afterwards.
 */
function mockNavigator(fields: { platform?: string; userAgent?: string; maxTouchPoints?: number }) {
  for (const [key, value] of Object.entries(fields)) {
    Object.defineProperty(navigator, key, { configurable: true, value });
  }
}

afterEach(() => {
  for (const key of ['platform', 'userAgent', 'maxTouchPoints']) {
    Reflect.deleteProperty(navigator, key);
  }
});

describe('isApplePlatform', () => {
  it('is the same function as the one in platform/runtime', () => {
    // Not "agrees with" — is. Two implementations is what this module used to
    // have, and they drifted: this one tested only the deprecated
    // `navigator.platform`. Identity is the only assertion a second copy fails.
    expect(isApplePlatform).toBe(runtimeIsApplePlatform);
  });
});

describe('isPrimaryModifier', () => {
  const cmd = { metaKey: true, ctrlKey: false };
  const ctrl = { metaKey: false, ctrlKey: true };

  it('is Cmd on macOS', () => {
    mockNavigator({ platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isPrimaryModifier(cmd)).toBe(true);
    expect(isPrimaryModifier(ctrl)).toBe(false);
    expect(primaryModifierLabel()).toBe('Cmd');
  });

  it('is Cmd on an iPad, where a Magic Keyboard sends Cmd', () => {
    // The menu bar treats iPadOS as "not macOS"; the accel must not. Both read
    // the same predicate, so this is the case that pins the difference.
    mockNavigator({
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      maxTouchPoints: 5,
    });
    expect(isPrimaryModifier(cmd)).toBe(true);
    expect(primaryModifierLabel()).toBe('Cmd');
  });

  it('is Ctrl on Windows and Linux', () => {
    mockNavigator({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    expect(isPrimaryModifier(ctrl)).toBe(true);
    expect(isPrimaryModifier(cmd)).toBe(false);
    expect(primaryModifierLabel()).toBe('Ctrl');

    mockNavigator({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
    expect(isPrimaryModifier(ctrl)).toBe(true);
    expect(primaryModifierLabel()).toBe('Ctrl');
  });
});
