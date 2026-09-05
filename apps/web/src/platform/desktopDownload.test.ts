import { describe, expect, it } from 'vitest';
import {
  detectDownloadOs,
  formatDownloadSize,
  matchReleaseAssets,
  parseRelease,
  recommendedBuild,
  type ReleaseAssetLike,
} from './desktopDownload';

/**
 * The asset list of `v0.4.0`, read from the GitHub API.
 *
 * Verbatim, including the two things a hand-written fixture would have got
 * wrong and that this module exists to survive: the dots GitHub substitutes for
 * the spaces in "Ori Studio", and the fact that this release carries **no**
 * `linux-arm64` files even though that leg is in the release matrix.
 */
const V040_ASSETS: ReleaseAssetLike[] = [
  { name: 'latest.json', browser_download_url: 'https://example.test/latest.json', size: 2443 },
  { name: 'Ori.Studio_0.4.0_aarch64.app.tar.gz', browser_download_url: 'https://example.test/arm.tar.gz', size: 34432000 },
  { name: 'Ori.Studio_0.4.0_aarch64.app.tar.gz.sig', browser_download_url: 'https://example.test/arm.tar.gz.sig', size: 408 },
  { name: 'Ori.Studio_0.4.0_aarch64.dmg', browser_download_url: 'https://example.test/arm.dmg', size: 36432845 },
  { name: 'Ori.Studio_0.4.0_amd64.AppImage', browser_download_url: 'https://example.test/x64.AppImage', size: 103229944 },
  { name: 'Ori.Studio_0.4.0_amd64.AppImage.sig', browser_download_url: 'https://example.test/x64.AppImage.sig', size: 424 },
  { name: 'Ori.Studio_0.4.0_amd64.deb', browser_download_url: 'https://example.test/x64.deb', size: 26400824 },
  { name: 'Ori.Studio_0.4.0_amd64.deb.sig', browser_download_url: 'https://example.test/x64.deb.sig', size: 416 },
  { name: 'Ori.Studio_0.4.0_x64-setup.exe', browser_download_url: 'https://example.test/setup.exe', size: 26522343 },
  { name: 'Ori.Studio_0.4.0_x64-setup.exe.sig', browser_download_url: 'https://example.test/setup.exe.sig', size: 420 },
  { name: 'Ori.Studio_0.4.0_x64.app.tar.gz', browser_download_url: 'https://example.test/x64.tar.gz', size: 26344419 },
  { name: 'Ori.Studio_0.4.0_x64.app.tar.gz.sig', browser_download_url: 'https://example.test/x64.tar.gz.sig', size: 408 },
  { name: 'Ori.Studio_0.4.0_x64.dmg', browser_download_url: 'https://example.test/x64.dmg', size: 28710658 },
];

describe('matchReleaseAssets', () => {
  it('picks the five installers out of a real release', () => {
    const builds = matchReleaseAssets(V040_ASSETS);

    expect(builds.map((build) => build.id)).toEqual([
      'macos-arm64',
      'macos-intel',
      'windows-x64',
      'linux-appimage',
      'linux-deb',
    ]);
  });

  it('leaves the updater payloads, signatures and manifest out', () => {
    const urls = matchReleaseAssets(V040_ASSETS).map((build) => build.url);

    // Handing someone `Ori.Studio_0.4.0_aarch64.app.tar.gz` would be handing
    // them the updater's payload instead of something they can install.
    expect(urls.some((url) => url.includes('tar.gz'))).toBe(false);
    expect(urls.some((url) => url.endsWith('.sig'))).toBe(false);
    expect(urls).not.toContain('https://example.test/latest.json');
  });

  it('does not let the Intel Mac pattern claim the Apple Silicon file', () => {
    const builds = matchReleaseAssets(V040_ASSETS);

    expect(builds.find((build) => build.id === 'macos-arm64')?.url).toBe('https://example.test/arm.dmg');
    expect(builds.find((build) => build.id === 'macos-intel')?.url).toBe('https://example.test/x64.dmg');
  });

  it('omits a platform the release did not build rather than inventing a URL', () => {
    // The whole reason asset names are read instead of derived from a version:
    // `linux-arm64` is in the release matrix and produced nothing for 0.4.0.
    const ids = matchReleaseAssets(V040_ASSETS).map((build) => build.id);

    expect(ids).not.toContain('linux-deb-arm64');
    expect(ids).not.toContain('linux-appimage-arm64');
  });

  it('includes the arm64 Linux packages once a release ships them', () => {
    const builds = matchReleaseAssets([
      ...V040_ASSETS,
      { name: 'Ori.Studio_0.5.0_arm64.deb', browser_download_url: 'https://example.test/arm.deb', size: 1 },
      { name: 'Ori.Studio_0.5.0_aarch64.AppImage', browser_download_url: 'https://example.test/arm.AppImage', size: 2 },
    ]);

    expect(builds.map((build) => build.id)).toContain('linux-deb-arm64');
    expect(builds.map((build) => build.id)).toContain('linux-appimage-arm64');
  });

  it('skips an asset with no download URL', () => {
    expect(matchReleaseAssets([{ name: 'Ori.Studio_0.4.0_aarch64.dmg', size: 1 }])).toEqual([]);
  });
});

describe('parseRelease', () => {
  it('reads the version without its tag prefix', () => {
    expect(parseRelease({ tag_name: 'v0.4.0', assets: V040_ASSETS })?.version).toBe('0.4.0');
  });

  it('refuses a release with a tag but no installable assets', () => {
    // A draft mid-upload looks exactly like this, and a version label over
    // files that are not there yet is worse than no label.
    expect(parseRelease({ tag_name: 'v0.5.0', assets: [] })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.5.0', assets: [{ name: 'latest.json', browser_download_url: 'x' }] })).toBeNull();
  });

  it('refuses anything that is not a release payload', () => {
    expect(parseRelease(null)).toBeNull();
    expect(parseRelease('rate limit exceeded')).toBeNull();
    expect(parseRelease({ message: 'Not Found' })).toBeNull();
    expect(parseRelease({ tag_name: 'v0.4.0' })).toBeNull();
  });
});

describe('detectDownloadOs', () => {
  it('reads a Mac as macOS', () => {
    expect(detectDownloadOs({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 })).toBe('macos');
  });

  it('reads Windows', () => {
    expect(detectDownloadOs({ platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe('windows');
  });

  it('reads desktop Linux', () => {
    expect(detectDownloadOs({ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux');
  });

  it('recommends nothing on an iPad, which reports itself as a Mac', () => {
    // Same `platform` and UA prefix as a real Mac; `maxTouchPoints` is the only
    // field that separates them. Getting this wrong offers a DMG to a tablet.
    expect(
      detectDownloadOs({
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/26.2 Safari/605.1.15',
        maxTouchPoints: 5,
      })
    ).toBeNull();
  });

  it('recommends nothing on Android, whose UA also says Linux', () => {
    expect(detectDownloadOs({ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36' })).toBeNull();
  });

  it('recommends nothing for an unknown host or no probe at all', () => {
    expect(detectDownloadOs({ platform: '', userAgent: '' })).toBeNull();
    expect(detectDownloadOs(undefined)).toBeNull();
  });

  it('reads nothing off Node, whose navigator answers this question wrongly', () => {
    // Node reports `platform: 'MacIntel'` under macOS. The prerender runs there,
    // so a probe taken from it would bake the *build machine's* platform into
    // the one copy of the page every crawler and every first paint reads.
    const realWindow = globalThis.window;
    // @ts-expect-error -- deleting the DOM is the whole scenario under test.
    delete globalThis.window;
    try {
      expect(detectDownloadOs()).toBeNull();
    } finally {
      globalThis.window = realWindow;
    }
  });
});

describe('recommendedBuild', () => {
  const builds = matchReleaseAssets(V040_ASSETS);

  it('leads the Mac pair with Apple Silicon, which cannot be detected', () => {
    expect(recommendedBuild(builds, 'macos')?.id).toBe('macos-arm64');
  });

  it('offers the AppImage on Linux, the package that needs no package manager', () => {
    expect(recommendedBuild(builds, 'linux')?.id).toBe('linux-appimage');
  });

  it('has nothing to recommend without an OS', () => {
    expect(recommendedBuild(builds, null)).toBeNull();
  });

  it('has nothing to recommend when the release shipped no build for that OS', () => {
    expect(recommendedBuild([], 'windows')).toBeNull();
  });
});

describe('formatDownloadSize', () => {
  it('rounds to whole megabytes', () => {
    expect(formatDownloadSize(36432845)).toBe('35 MB');
  });

  it('says nothing rather than "0 MB" when the size is missing', () => {
    expect(formatDownloadSize(0)).toBeNull();
    expect(formatDownloadSize(Number.NaN)).toBeNull();
  });
});
