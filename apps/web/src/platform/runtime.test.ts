import { describe, expect, it } from 'vitest';
import {
  getRuntimeSurface,
  isAppleMobilePlatform,
  isApplePlatform,
  isWebRuntime,
  usesNativeAppMenu,
} from './runtime';

/**
 * Probes copied from real hosts rather than composed by hand, because the whole
 * difficulty here is that two of them are identical in the fields UA sniffing
 * reads. `platform` and `userAgent` below were read from `navigator` on a macOS
 * WKWebView (via a WKWebView harness, the engine the Tauri desktop build runs)
 * and on an iPad (A16) simulator; `maxTouchPoints` came from the same reads.
 */
const MACOS = {
  platform: 'MacIntel',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  maxTouchPoints: 0,
};

const IPADOS = {
  platform: 'MacIntel',
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Safari/605.1.15',
  maxTouchPoints: 5,
};

describe('runtime detection', () => {
  it('defaults to web without Tauri globals', () => {
    expect(getRuntimeSurface({})).toBe('web');
    expect(isWebRuntime({})).toBe(true);
  });

  it('detects Tauri internals as desktop', () => {
    expect(getRuntimeSurface({ __TAURI_INTERNALS__: {} }, MACOS)).toBe('desktop');
  });

  it('detects explicit Tauri flags as desktop', () => {
    expect(getRuntimeSurface({ isTauri: true }, MACOS)).toBe('desktop');
    expect(getRuntimeSurface({ __TAURI__: {} }, MACOS)).toBe('desktop');
  });

  it('separates a Tauri iPad build from a Tauri Mac build', () => {
    // The whole reason `'ios'` exists. The iOS shell sets the same
    // `__TAURI_INTERNALS__` the desktop one does, so without the platform probe
    // both answer `'desktop'` and an iPad silently takes every desktop branch:
    // the self-updater, the window title, the close guard.
    expect(getRuntimeSurface({ __TAURI_INTERNALS__: {} }, IPADOS)).toBe('ios');
    expect(getRuntimeSurface({ __TAURI_INTERNALS__: {} }, MACOS)).toBe('desktop');
  });

  it('calls an iPad running the *web* build web, not ios', () => {
    // Same device, same probe — the difference is the shell. Answering `'ios'`
    // here would send Safari down the Tauri IPC paths, which do not exist.
    expect(getRuntimeSurface({}, IPADOS)).toBe('web');
    expect(isWebRuntime({})).toBe(true);
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

  it('stays true on iPadOS, which is what the accel modifier wants', () => {
    // An iPad with a Magic Keyboard sends Cmd, not Ctrl. `lib/platform`
    // re-exports this predicate for exactly that question.
    expect(isApplePlatform(IPADOS)).toBe(true);
  });
});

describe('isAppleMobilePlatform', () => {
  it('cannot be answered from the user agent, which is the reason it exists', () => {
    // Guard the premise: the two agree on `platform` and on the stretch of UA
    // that names the OS, so a future "just check the UA" simplification has to
    // fail here first.
    expect(IPADOS.platform).toBe(MACOS.platform);
    const macIdentity = /Macintosh; Intel Mac OS X [\d_]+/;
    expect(macIdentity.test(IPADOS.userAgent)).toBe(true);
    expect(macIdentity.test(MACOS.userAgent)).toBe(true);
  });

  it('separates iPadOS from macOS on touch points', () => {
    expect(isAppleMobilePlatform(IPADOS)).toBe(true);
    expect(isAppleMobilePlatform(MACOS)).toBe(false);
  });

  it('catches an iPhone and an iPad that identify themselves plainly', () => {
    // An iPhone always does, and an iPad does outside desktop-mode Safari.
    const iPhone = { platform: 'iPhone', maxTouchPoints: 5 };
    const iPadHonest = { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X)' };
    expect(isAppleMobilePlatform(iPhone)).toBe(true);
    expect(isAppleMobilePlatform(iPadHonest)).toBe(true);
  });

  it('is false off Apple platforms, touch screen or not', () => {
    // A Windows touch laptop is not an iPad; it keeps whatever menu it had.
    expect(isAppleMobilePlatform({ platform: 'Win32', maxTouchPoints: 10 })).toBe(false);
    expect(isAppleMobilePlatform(undefined)).toBe(false);
  });

  it('treats a missing touch count as no touch', () => {
    // The safe direction: a Mac read as "mobile" costs a redundant menu bar, an
    // iPad read as "macOS" costs every menu command.
    expect(isAppleMobilePlatform({ platform: 'MacIntel' })).toBe(false);
  });
});

describe('usesNativeAppMenu', () => {
  const windows = { platform: 'Win32' };
  const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';
  const desktop = { [TAURI_INTERNALS_KEY]: {} };

  it('is true only for desktop macOS', () => {
    expect(usesNativeAppMenu(desktop, MACOS)).toBe(true);
  });

  it('is false on desktop Windows and Linux, so the in-app menu bar renders', () => {
    expect(usesNativeAppMenu(desktop, windows)).toBe(false);
    expect(usesNativeAppMenu(desktop, { platform: 'Linux x86_64' })).toBe(false);
  });

  it('is false in the browser even on a Mac', () => {
    expect(usesNativeAppMenu({}, MACOS)).toBe(false);
  });

  it('is false on a Tauri iPad build, which has no menu bar to attach to', () => {
    // The iOS shell sets `__TAURI_INTERNALS__` like the desktop one, and the UA
    // says Mac — so both halves of the old predicate answered "desktop macOS"
    // and `WorkspaceShell` rendered a spacer where <MenuBar /> belongs. Nothing
    // else in the app can reach File ▸ Open or Settings.
    //
    // The surface now carries that distinction, so guard both links in the
    // chain: the host alone still looks like Tauri, and the UA still looks like
    // a Mac. Only the two read together answer correctly.
    expect(TAURI_INTERNALS_KEY in desktop).toBe(true);
    expect(isApplePlatform(IPADOS)).toBe(true);
    expect(usesNativeAppMenu(desktop, IPADOS)).toBe(false);
  });
});
