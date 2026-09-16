import type { DesktopBuildId } from '../platform/desktopDownload';
import {
  ANALYTICS_EVENTS,
  type DesktopDownloadBuild,
  type DesktopDownloadSurface,
} from './events';
import { track } from './runtime';

/**
 * Record that a desktop installer link was followed.
 *
 * The `build` parameter is the domain's own {@link DesktopBuildId}, widened only
 * by the fallback. Assigning it to a {@link DesktopDownloadBuild} is what keeps
 * the taxonomy and the build list from drifting apart: adding a platform to
 * `DESKTOP_BUILDS` without adding it to the enum fails to compile here, rather
 * than shipping an unrecognized property value into the dashboard.
 */
export function trackDesktopDownload(input: {
  build: DesktopBuildId | 'releases-page';
  surface: DesktopDownloadSurface;
}): void {
  const build: DesktopDownloadBuild = input.build;
  track(ANALYTICS_EVENTS.desktopDownloadStarted, { build, surface: input.surface });
}
