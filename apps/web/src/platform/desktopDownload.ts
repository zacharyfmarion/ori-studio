import { REPOSITORY_URL } from '../constants/release';
import { isApplePlatform, isAppleMobilePlatform, isWindowsPlatform, type PlatformProbe } from './runtime';

/**
 * The releases page, and the href every download control carries before — or
 * instead of — a resolved asset.
 *
 * It is a real answer, not a placeholder: it lists every file of every recent
 * release, so a visitor whose fetch never resolves still reaches a download in
 * one more click. That is what lets {@link resolveDesktopBuilds} fail without
 * anything on the page going dead, and it is what the prerendered landing markup
 * ships with, since the prerender runs with no network at all.
 */
export const RELEASES_LATEST_URL = `${REPOSITORY_URL}/releases/latest`;

/** The GitHub API endpoint naming the newest armed release. */
export const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/zacharyfmarion/ori-studio/releases/latest';

/**
 * The operating systems a desktop build exists for.
 *
 * `null` is a fourth answer, and the interesting one: a phone, or a host whose
 * user agent says nothing recognizable. See {@link detectDownloadOs}.
 */
export type DownloadOs = 'macos' | 'windows' | 'linux';

/**
 * A build a visitor can download. These strings are analytics property values —
 * a closed enum, never a filename — so they must stay stable once shipped.
 */
export type DesktopBuildId =
  | 'macos-arm64'
  | 'macos-intel'
  | 'windows-x64'
  | 'linux-deb'
  | 'linux-appimage'
  | 'linux-deb-arm64'
  | 'linux-appimage-arm64';

export interface DesktopBuildSpec {
  id: DesktopBuildId;
  os: DownloadOs;
  /**
   * Matches the release asset's **name**.
   *
   * Anchored at the end, because that is the part Tauri's bundler decides from
   * the target rather than from the product name or version — `_aarch64.dmg`
   * survives a rename of "Ori Studio", where a whole-name pattern would not.
   *
   * Order matters within an OS: the first spec whose pattern matches an asset
   * wins that asset, and `_x64.dmg` must not be allowed to claim the arm64 file.
   * The patterns are disjoint, so this is a property of the list rather than a
   * rule the caller has to keep.
   */
  pattern: RegExp;
}

/**
 * Every build the release workflow can produce, in the order a chooser should
 * list them.
 *
 * Apple Silicon leads the Mac pair deliberately. The architecture cannot be
 * detected — a WKWebView on an M-series Mac reports `Intel Mac OS X 10_15_7`,
 * identical to a real Intel Mac, and there is no synchronous signal that
 * separates the two — so this is a default, not a guess dressed up as one, and
 * the Intel build sits immediately beside it rather than behind a second menu.
 *
 * The Linux arm64 entries have no assets in `v0.4.0`: that leg is in the release
 * matrix but did not produce files for it. Nothing here needs to know that —
 * {@link matchReleaseAssets} returns what the release actually contains, so a
 * missing leg is an absent menu item rather than a link to a 404. That is the
 * whole reason the asset list is read instead of names being derived from a
 * version number.
 */
export const DESKTOP_BUILDS: readonly DesktopBuildSpec[] = [
  { id: 'macos-arm64', os: 'macos', pattern: /_aarch64\.dmg$/ },
  { id: 'macos-intel', os: 'macos', pattern: /_x64\.dmg$/ },
  { id: 'windows-x64', os: 'windows', pattern: /_x64-setup\.exe$/ },
  { id: 'linux-appimage', os: 'linux', pattern: /_amd64\.AppImage$/ },
  { id: 'linux-deb', os: 'linux', pattern: /_amd64\.deb$/ },
  { id: 'linux-appimage-arm64', os: 'linux', pattern: /_aarch64\.AppImage$/ },
  { id: 'linux-deb-arm64', os: 'linux', pattern: /_arm64\.deb$/ },
];

/** One resolved, downloadable build. */
export interface DesktopBuild {
  id: DesktopBuildId;
  os: DownloadOs;
  /** Direct link to the asset on GitHub Releases. */
  url: string;
  /** Bytes, for the size shown beside the item. `0` when the release omits it. */
  size: number;
}

/** The shape this module reads out of a GitHub release. Nothing else is used. */
export interface ReleaseAssetLike {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
}

export interface ReleaseLike {
  tag_name?: unknown;
  assets?: unknown;
}

/**
 * The resolved release: its version and the builds it actually shipped.
 *
 * `builds` may be empty. A release whose assets are still uploading has a tag
 * and no files, and the callers already render fine without any — they keep the
 * {@link RELEASES_LATEST_URL} fallback — so this is a normal state rather than a
 * failure to signal.
 */
export interface DesktopRelease {
  /** The tag with its `v` stripped, e.g. `0.4.0`. */
  version: string;
  builds: readonly DesktopBuild[];
}

/**
 * Pick out the installable assets, dropping everything else a release carries.
 *
 * A release holds 13 files for 5 installers: an updater tarball and a `.sig` per
 * platform, plus `latest.json`. Matching by pattern rather than filtering by
 * extension is what keeps `Ori.Studio_0.4.0_aarch64.app.tar.gz` — an updater
 * payload no human should be handed — out of a menu of things to install.
 */
export function matchReleaseAssets(assets: readonly ReleaseAssetLike[]): DesktopBuild[] {
  const builds: DesktopBuild[] = [];
  for (const spec of DESKTOP_BUILDS) {
    const asset = assets.find(
      (candidate) =>
        typeof candidate.name === 'string' &&
        typeof candidate.browser_download_url === 'string' &&
        spec.pattern.test(candidate.name)
    );
    if (!asset) continue;
    builds.push({
      id: spec.id,
      os: spec.os,
      url: asset.browser_download_url as string,
      size: typeof asset.size === 'number' && Number.isFinite(asset.size) ? asset.size : 0,
    });
  }
  return builds;
}

/**
 * Read a GitHub release payload into a {@link DesktopRelease}.
 *
 * Returns `null` for anything it cannot use, rather than a half-filled release:
 * every caller's fallback is the releases page, and a release with a version but
 * no usable assets would relabel the button with a version whose files it cannot
 * offer.
 */
export function parseRelease(payload: unknown): DesktopRelease | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const release = payload as ReleaseLike;
  if (typeof release.tag_name !== 'string' || release.tag_name === '') return null;
  if (!Array.isArray(release.assets)) return null;
  const builds = matchReleaseAssets(release.assets as ReleaseAssetLike[]);
  if (builds.length === 0) return null;
  return { version: release.tag_name.replace(/^v/, ''), builds };
}

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

/**
 * The build to put on the primary button for `os`, or `null`.
 *
 * The first build of that OS in {@link DESKTOP_BUILDS} order, which is why that
 * order is the chooser's order too — the recommendation and the top of the menu
 * are the same item, and nothing has to keep two orderings agreeing.
 */
export function recommendedBuild(
  builds: readonly DesktopBuild[],
  os: DownloadOs | null
): DesktopBuild | null {
  if (!os) return null;
  return builds.find((build) => build.os === os) ?? null;
}

/** `31457280` → `30 MB`. Sizes are approximate by nature; one decimal is noise. */
export function formatDownloadSize(bytes: number): string | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return null;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
