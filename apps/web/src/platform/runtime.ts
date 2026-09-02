export type RuntimeSurface = 'web' | 'desktop';

type RuntimeHost = Record<string, unknown>;

const TAURI_INTERNALS_KEY = '__TAURI_INTERNALS__';
const TAURI_V1_KEY = '__TAURI__';
const TAURI_FLAG_KEY = 'isTauri';

function defaultHost(): RuntimeHost | undefined {
  if (typeof window !== 'undefined') return window as unknown as RuntimeHost;
  if (typeof globalThis !== 'undefined') return globalThis as RuntimeHost;
  return undefined;
}

export function getRuntimeSurface(host: RuntimeHost | undefined = defaultHost()): RuntimeSurface {
  if (!host) return 'web';
  return TAURI_INTERNALS_KEY in host || TAURI_V1_KEY in host || host[TAURI_FLAG_KEY] === true
    ? 'desktop'
    : 'web';
}

export function isDesktopRuntime(host?: RuntimeHost): boolean {
  return getRuntimeSurface(host) === 'desktop';
}

export function isWebRuntime(host?: RuntimeHost): boolean {
  return getRuntimeSurface(host) === 'web';
}

/** The subset of `navigator` this module reads, so callers can pass a stub. */
export type PlatformProbe = {
  platform?: string;
  userAgent?: string;
  maxTouchPoints?: number;
};

function defaultProbe(): PlatformProbe | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

const APPLE_PATTERN = /\b(mac|iphone|ipad|ipod)/i;
const APPLE_MOBILE_PATTERN = /\b(iphone|ipad|ipod)/i;

/**
 * Whether the webview is running on an Apple platform.
 *
 * This is the single implementation for the whole app — the accel modifier in
 * `lib/platform` re-exports it rather than keeping a second one.
 *
 * Read from the user agent rather than a Tauri plugin because both callers need
 * the answer synchronously during the first render, before any IPC could
 * resolve.
 *
 * `navigator.userAgentData` is deliberately not consulted: it exists on WebView2
 * (Chromium) and on neither WKWebView nor WebKitGTK, so it would answer for
 * exactly the one platform that is not Apple and be undefined for the other two.
 * `platform`/`userAgent` are present on all three.
 *
 * **Unknown answers false.** Callers use this to decide whether an Apple-only
 * affordance exists, so guessing "Apple" on an unrecognized host would reach for
 * something that is not there. Guessing "not Apple" costs a fallback.
 *
 * This stays true on iPhone and iPad — they *are* Apple platforms, and the
 * keyboard accel is Cmd there as much as on a Mac. What they do not have is a
 * system menu bar; that narrower question is {@link isAppleMobilePlatform}.
 */
export function isApplePlatform(probe: PlatformProbe | undefined = defaultProbe()): boolean {
  if (!probe) return false;
  return APPLE_PATTERN.test(probe.platform ?? '') || APPLE_PATTERN.test(probe.userAgent ?? '');
}

/**
 * Whether this is an Apple platform *without* a system menu bar — iPadOS or iOS.
 *
 * **The user agent cannot answer this.** A WKWebView on iPadOS identifies itself
 * as a Mac: measured on an iPad (A16) simulator, `navigator.platform` is
 * `MacIntel` and the UA opens `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)
 * AppleWebKit/605.1.15 …`. Those are the same values macOS WKWebView reports —
 * the strings differ only past the point that names the OS, so no Mac-or-not test
 * over either field can separate the two. UA sniffing here answers "macOS".
 *
 * `maxTouchPoints` is the signal that does separate them, and it is synchronous,
 * which the Tauri OS plugin is not. Measured on the same pair: iPadOS reports
 * `5`, macOS WKWebView (the engine the desktop build actually runs) reports `0`.
 *
 * A missing `maxTouchPoints` counts as no touch, which keeps the macOS answer on
 * an exotic host. That is the safe direction — a Mac wrongly called "mobile"
 * gets a redundant in-app menu bar, where an iPad wrongly called "macOS" gets no
 * menu at all — and the explicit-UA arm below still catches an iPad that
 * identifies itself honestly.
 */
export function isAppleMobilePlatform(probe: PlatformProbe | undefined = defaultProbe()): boolean {
  if (!probe) return false;
  if (
    APPLE_MOBILE_PATTERN.test(probe.platform ?? '') ||
    APPLE_MOBILE_PATTERN.test(probe.userAgent ?? '')
  ) {
    return true;
  }
  return isApplePlatform(probe) && (probe.maxTouchPoints ?? 0) > 0;
}

const WINDOWS_PATTERN = /\bwin(dows|32|64)/i;

/**
 * Whether the webview is running on Windows.
 *
 * Read the same way as {@link isApplePlatform}, and for the same reason: the one
 * caller needs the answer synchronously, and `navigator.userAgentData` exists on
 * WebView2 but on neither of the other two engines, so relying on it would
 * answer for one platform and be undefined for the rest.
 *
 * **Unknown answers false**, which matches {@link isApplePlatform}. The caller
 * is {@link classifyReservedKey}, where a false negative costs a missing warning
 * and a false positive warns every Linux user about keys their engine does not
 * take.
 */
export function isWindowsPlatform(probe: PlatformProbe | undefined = defaultProbe()): boolean {
  if (!probe) return false;
  return WINDOWS_PATTERN.test(probe.platform ?? '') || WINDOWS_PATTERN.test(probe.userAgent ?? '');
}

/**
 * Whether the OS menu bar can host this app's commands.
 *
 * True only on desktop macOS. Windows and Linux fall back to the in-app
 * {@link MenuBar}: Tauri's app-menu primitives (`Services`, `HideOthers`,
 * `ShowAll`) are macOS-only, and `setAsAppMenu` does not attach the same way
 * off macOS — so the menu that renders on those platforms has to be ours.
 *
 * iPadOS and iOS are Apple platforms that fall back the same way. A Tauri iOS
 * build sets `__TAURI_INTERNALS__`, so the runtime half of this reads "desktop"
 * there; without the mobile test an iPad would suppress {@link MenuBar} in favour
 * of a menu bar the OS does not have, and no menu command would be reachable.
 *
 * Read synchronously during the first render — `WorkspaceShell` mounts the menu
 * bar off this answer, and a frame without menus is a visible flash, so no part
 * of it may wait on IPC.
 */
export function usesNativeAppMenu(host?: RuntimeHost, probe?: PlatformProbe): boolean {
  return isDesktopRuntime(host) && isApplePlatform(probe) && !isAppleMobilePlatform(probe);
}
