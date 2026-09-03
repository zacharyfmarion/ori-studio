import { describe, expect, it } from 'vitest';
import { isCpDetectBuildEnabled, isCpDetectSurfaceAvailable, isFeatureVisible } from './features';

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

describe('CP detection availability', () => {
  it('is on in dev, and in a deployed build only when the flag was set', () => {
    expect(isCpDetectBuildEnabled({ DEV: true })).toBe(true);
    expect(isCpDetectBuildEnabled({ DEV: false, VITE_CP_DETECT: '1' })).toBe(true);
    expect(isCpDetectBuildEnabled({ DEV: false, VITE_CP_DETECT: '0' })).toBe(false);
    expect(isCpDetectBuildEnabled({ DEV: false })).toBe(false);
  });

  it('is hidden on a phone even when the build carries it', () => {
    expect(isCpDetectSurfaceAvailable({ buildEnabled: true, phone: false })).toBe(true);
    expect(isCpDetectSurfaceAvailable({ buildEnabled: true, phone: true })).toBe(false);
    expect(isCpDetectSurfaceAvailable({ buildEnabled: false, phone: false })).toBe(false);
  });
});
