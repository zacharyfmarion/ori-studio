import { describe, expect, it } from 'vitest';
import { isFeatureVisible } from './features';

describe('platform feature visibility', () => {
  it('shows browser downloads only on web', () => {
    expect(isFeatureVisible('browserDownloads', 'web')).toBe(true);
    expect(isFeatureVisible('browserDownloads', 'desktop')).toBe(false);
  });

  it('shows native shell features only on desktop', () => {
    expect(isFeatureVisible('nativeFileDialogs', 'desktop')).toBe(true);
    expect(isFeatureVisible('nativeMenus', 'desktop')).toBe(true);
    expect(isFeatureVisible('nativeWindowTitle', 'desktop')).toBe(true);
    expect(isFeatureVisible('nativeFileDialogs', 'web')).toBe(false);
  });
});
