import { describe, expect, it, vi } from 'vitest';
import { CP_DETECT_MODEL_ORIGIN, cpDetectModelBaseUrl, cpDetectModelOriginOverride } from './features';
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

describe('cpDetectModelBaseUrl', () => {
  it('reads the site from a deployed desktop shell and its own origin on the web', () => {
    expect(cpDetectModelBaseUrl('desktop', undefined, false)).toBe(CP_DETECT_MODEL_ORIGIN);
    expect(cpDetectModelBaseUrl('web', undefined, false)).toBeUndefined();
  });

  it('reads the dev server from a dev desktop shell, the way a dev browser does', () => {
    expect(cpDetectModelBaseUrl('desktop', undefined, true)).toBeUndefined();
  });

  it('lets a build-time origin win on both surfaces', () => {
    expect(cpDetectModelBaseUrl('web', 'https://pr-7.oristudio.pages.dev/', false)).toBe('https://pr-7.oristudio.pages.dev/');
    expect(cpDetectModelBaseUrl('desktop', 'https://pr-7.oristudio.pages.dev/', true)).toBe('https://pr-7.oristudio.pages.dev/');
  });

  it('accepts an origin only, normalised to a trailing slash, and refuses a path', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(cpDetectModelOriginOverride('https://pr-7.oristudio.pages.dev')).toBe('https://pr-7.oristudio.pages.dev/');
    expect(cpDetectModelOriginOverride('https://pr-7.oristudio.pages.dev/models/')).toBeUndefined();
    expect(cpDetectModelOriginOverride('not a url')).toBeUndefined();
    expect(cpDetectModelOriginOverride(undefined)).toBeUndefined();
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
