import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { MenuGroupLabel, MenuItem, MenuItemLabel, MenuItemShortcut } from '../ui/Menu';
import { useTranslation } from 'react-i18next';
import { trackDesktopDownload, type DesktopDownloadSurface } from '../../analytics';
import {
  formatDownloadSize,
  type DesktopBuild,
  type DownloadOs,
} from '../../platform/desktopDownload';
import { desktopBuildLabel, downloadOsLabel } from './desktopBuildLabels';

const OS_ORDER: readonly DownloadOs[] = ['macos', 'windows', 'linux'];

/**
 * The body of every "other platforms" menu: one anchor per shipped build,
 * grouped under its operating system.
 *
 * `DropdownMenu.Item asChild` over an anchor rather than an item that navigates
 * on select. These are files, and a link is what makes them behave like files —
 * middle-click, "Save link as", and a visible destination in the status bar all
 * come from it actually being one. It also means the menu still works in the
 * prerendered markup, where nothing has run.
 *
 * `builds` empty renders one item pointing at the releases page. That is the
 * state when the release could not be read at all, and an empty menu would be a
 * dead end where this is still a way through.
 */
export function DesktopDownloadMenuItems({
  builds,
  fallbackUrl,
  surface,
}: {
  builds: readonly DesktopBuild[];
  fallbackUrl: string;
  surface: DesktopDownloadSurface;
}) {
  const { t } = useTranslation();

  if (builds.length === 0) {
    return (
      <MenuItem asChild>
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() =>
            trackDesktopDownload({
              build: 'releases-page',
              surface,
              fallbackReason: 'release_unresolved',
            })
          }
        >
          <MenuItemLabel>
            {t('common:download.allReleases', 'All downloads on GitHub')}
          </MenuItemLabel>
        </a>
      </MenuItem>
    );
  }

  return (
    <>
      {OS_ORDER.map((os) => {
        const group = builds.filter((build) => build.os === os);
        if (group.length === 0) return null;
        return (
          <DropdownMenu.Group key={os}>
            <MenuGroupLabel>{downloadOsLabel(t, os)}</MenuGroupLabel>
            {group.map((build) => {
              const size = formatDownloadSize(build.size);
              return (
                <MenuItem key={build.id} asChild>
                  <a
                    href={build.url}
                    onClick={() => trackDesktopDownload({ build: build.id, surface })}
                  >
                    <MenuItemLabel>{desktopBuildLabel(t, build.id)}</MenuItemLabel>
                    {size && <MenuItemShortcut>{size}</MenuItemShortcut>}
                  </a>
                </MenuItem>
              );
            })}
          </DropdownMenu.Group>
        );
      })}
    </>
  );
}
