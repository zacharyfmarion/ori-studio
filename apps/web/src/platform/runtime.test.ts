import { describe, expect, it } from 'vitest';
import {
  getRuntimeSurface,
  isApplePlatform,
  isDesktopRuntime,
  isWebRuntime,
  usesNativeAppMenu,
} from './runtime';

describe('runtime detection', () => {
  it('defaults to web without Tauri globals', () => {
    expect(getRuntimeSurface({})).toBe('web');
    expect(isWebRuntime({})).toBe(true);
  });

  it('detects Tauri internals as desktop', () => {
    const host = { __TAURI_INTERNALS__: {} };
    expect(getRuntimeSurface(host)).toBe('desktop');
    expect(isDesktopRuntime(host)).toBe(true);
  });

  it('detects explicit Tauri flags as desktop', () => {
    expect(getRuntimeSurface({ isTauri: true })).toBe('desktop');
    expect(getRuntimeSurface({ __TAURI__: {} })).toBe('desktop');
  });
});

describe('isApplePlatform', () => {
  it('detects macOS from either navigator field', () => {
    expect(isApplePlatform({ platform: 'MacIntel' })).toBe(true);
    expect(
      isApplePlatform({
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      })
    ).toBe(true);
  });

  it('rejects the two webviews that are not WKWebView', () => {
    // WebView2 on Windows.
    expect(
      isApplePlatform({
        platform: 'Win32',
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      })
    ).toBe(false);
    // WebKitGTK on Linux. Note its UA contains "AppleWebKit" — matching on that
    // substring instead of a word-boundary "Mac" would answer true here and hide
    // every menu command on Linux.
    expect(
      isApplePlatform({
        platform: 'Linux x86_64',
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      })
    ).toBe(false);
  });

  it('answers false when the platform cannot be determined', () => {
    expect(isApplePlatform(undefined)).toBe(false);
    expect(isApplePlatform({})).toBe(false);
  });
});

describe('usesNativeAppMenu', () => {
  const mac = { platform: 'MacIntel' };
  const windows = { platform: 'Win32' };
  const desktop = { __TAURI_INTERNALS__: {} };

  it('is true only for desktop macOS', () => {
    expect(usesNativeAppMenu(desktop, mac)).toBe(true);
  });

  it('is false on desktop Windows and Linux, so the in-app menu bar renders', () => {
    expect(usesNativeAppMenu(desktop, windows)).toBe(false);
    expect(usesNativeAppMenu(desktop, { platform: 'Linux x86_64' })).toBe(false);
  });

  it('is false in the browser even on a Mac', () => {
    expect(usesNativeAppMenu({}, mac)).toBe(false);
  });
});
