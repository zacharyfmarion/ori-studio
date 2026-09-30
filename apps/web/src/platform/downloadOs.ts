import { isApplePlatform, isAppleMobilePlatform, isWindowsPlatform, type PlatformProbe } from './runtime';

/**
 * Which desktop platform a visitor is on, for the download button. A leaf — no release URLs,
 * no `package.json` — so the landing page's inline body script (`seo/staticPaintBody.ts`)
 * names the platform exactly as the button will. `desktopDownload.ts` re-exports it.
 */

/**
 * The operating systems a desktop build exists for.
 *
 * `null` is a fourth answer, and the interesting one: a phone, or a host whose
 * user agent says nothing recognizable. See {@link detectDownloadOs}.
 */
export type DownloadOs = 'macos' | 'windows' | 'linux';

/**
 * Which OS to recommend a build for, or `null` for "cannot say".
 *
 * **Mobile answers `null` on purpose.** An iPad reports itself as a Mac (see
 * {@link isAppleMobilePlatform}), and an Android phone matches no pattern here
 * at all — so without the mobile test the recommendation on an iPad would be a
 * DMG it cannot open, and the honest answer on a phone is that there is nothing
 * here to install. Callers render the full list without a primary action.
 *
 * Linux is what is left over rather than something matched, which is why it is
 * last: the desktop Linux user agents worth naming (`X11`, `Linux x86_64`) also
 * appear on Android, so a positive Linux test would have to exclude Android
 * anyway — and every case this returns `null` for has already been excluded by
 * the time it is reached.
 */
export function detectDownloadOs(probe: PlatformProbe | undefined = defaultProbe()): DownloadOs | null {
  if (!probe) return null;
  if (isAppleMobilePlatform(probe)) return null;
  if (isApplePlatform(probe)) return 'macos';
  if (isWindowsPlatform(probe)) return 'windows';
  if (/\bandroid/i.test(probe.userAgent ?? '')) return null;
  if (/\b(linux|x11|cros)/i.test(probe.platform ?? '') || /\b(linux|x11|cros)/i.test(probe.userAgent ?? '')) {
    return 'linux';
  }
  return null;
}

/**
 * The browser's `navigator`, and **only** a browser's.
 *
 * Keyed on `window`, not on `navigator`, because Node has a `navigator` too and
 * it answers this question wrongly rather than not at all: `navigator.platform`
 * is `MacIntel` on Node under macOS. The prerender runs in exactly that host, so
 * without this the crawlable copy of the landing page — baked once, at build
 * time, and served to everybody — would read "Download for macOS" off the build
 * machine, and "Download for Linux" once CI built it.
 *
 * No probe means no recommendation, which is the neutral label and the releases
 * page. That is the right prerendered answer for a page every platform reads.
 */
function defaultProbe(): PlatformProbe | undefined {
  if (typeof window === 'undefined') return undefined;
  return typeof navigator === 'undefined' ? undefined : navigator;
}
