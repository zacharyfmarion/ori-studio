import { useEffect, useMemo, useState } from 'react';
import {
  detectDownloadOs,
  recommendedBuild,
  RELEASES_LATEST_URL,
  type DesktopBuild,
  type DesktopRelease,
  type DownloadOs,
} from './desktopDownload';
import { fetchDesktopRelease } from './desktopRelease';
import { isWebRuntime } from './runtime';

export interface DesktopDownloads {
  /**
   * Whether a download should be offered here at all.
   *
   * False inside the desktop app, which must not advertise itself to itself.
   * Every control reads this rather than calling `isWebRuntime` again, so the
   * one place that decides is this hook.
   */
  available: boolean;
  /** The visitor's OS, or `null` on a phone or an unrecognized host. */
  os: DownloadOs | null;
  /** The released version, once known. `null` until the fetch resolves. */
  version: string | null;
  /** Every build the newest release shipped, in chooser order. Possibly empty. */
  builds: readonly DesktopBuild[];
  /** The build to feature, or `null` when there is nothing to single out. */
  recommended: DesktopBuild | null;
  /**
   * The href a control uses when it has no resolved asset: the releases page.
   *
   * Present from the first render, which is the point — the anchor is never
   * hrefless, so the markup the prerender emits and the frame before the fetch
   * resolves both hold a link that works.
   */
  fallbackUrl: string;
}

/**
 * What the download controls need, resolved once per page and shared.
 *
 * The fetch is deliberately not awaited before anything renders. Controls draw
 * immediately against {@link DesktopDownloads.fallbackUrl} and sharpen when the
 * release arrives — so a slow, rate-limited or blocked GitHub costs a version
 * label, never a button that does nothing.
 */
export function useDesktopDownloads(): DesktopDownloads {
  const available = useMemo(() => isWebRuntime(), []);
  const os = useMemo(() => (available ? detectDownloadOs() : null), [available]);
  const [release, setRelease] = useState<DesktopRelease | null>(null);

  useEffect(() => {
    if (!available) return;
    let live = true;
    void fetchDesktopRelease().then((result) => {
      if (live && result) setRelease(result);
    });
    return () => {
      live = false;
    };
  }, [available]);

  const builds = release?.builds ?? [];
  return {
    available,
    os,
    version: release?.version ?? null,
    builds,
    recommended: recommendedBuild(builds, os),
    fallbackUrl: RELEASES_LATEST_URL,
  };
}
