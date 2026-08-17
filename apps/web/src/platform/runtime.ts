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
};

function defaultProbe(): PlatformProbe | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

const APPLE_PATTERN = /\b(mac|iphone|ipad|ipod)/i;

/**
 * Whether the webview is running on an Apple platform.
 *
 * Read from the user agent rather than a Tauri plugin because the answer is
 * needed synchronously during the first render, before any IPC could resolve —
 * `WorkspaceShell` uses it to decide whether to mount the in-app menu bar, and a
 * frame without menus is a visible flash.
 *
 * `navigator.userAgentData` is deliberately not consulted: it exists on WebView2
 * (Chromium) and on neither WKWebView nor WebKitGTK, so it would answer for
 * exactly the one platform that is not Apple and be undefined for the other two.
 * `platform`/`userAgent` are present on all three.
 *
 * **Unknown answers false.** The one caller uses this to decide whether the
 * native menu can carry the app's commands, so guessing "Apple" on an
 * unrecognized host would hide every menu command with no way to reach them.
 * Guessing "not Apple" costs a redundant in-app menu bar.
 */
export function isApplePlatform(probe: PlatformProbe | undefined = defaultProbe()): boolean {
  if (!probe) return false;
  return APPLE_PATTERN.test(probe.platform ?? '') || APPLE_PATTERN.test(probe.userAgent ?? '');
}

/**
 * Whether the OS menu bar can host this app's commands.
 *
 * True only on desktop macOS. Windows and Linux fall back to the in-app
 * {@link MenuBar}: Tauri's app-menu primitives (`Services`, `HideOthers`,
 * `ShowAll`) are macOS-only, and `setAsAppMenu` does not attach the same way
 * off macOS — so the menu that renders on those platforms has to be ours.
 */
export function usesNativeAppMenu(host?: RuntimeHost, probe?: PlatformProbe): boolean {
  return isDesktopRuntime(host) && isApplePlatform(probe);
}
