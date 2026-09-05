import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
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
      <DropdownMenu.Item asChild className="context-menu__item">
        <a
          href={fallbackUrl}
          target="_blank"
          rel="noreferrer noopener"
          onClick={() => trackDesktopDownload({ build: 'releases-page', surface })}
        >
          <span className="context-menu__label">
            {t('common:download.allReleases', 'All downloads on GitHub')}
          </span>
        </a>
      </DropdownMenu.Item>
    );
  }

  return (
    <>
      {OS_ORDER.map((os) => {
        const group = builds.filter((build) => build.os === os);
        if (group.length === 0) return null;
        return (
          <DropdownMenu.Group key={os}>
            <DropdownMenu.Label className="context-menu__group-label">
              {downloadOsLabel(t, os)}
            </DropdownMenu.Label>
            {group.map((build) => {
              const size = formatDownloadSize(build.size);
              return (
                <DropdownMenu.Item key={build.id} asChild className="context-menu__item">
                  <a
                    href={build.url}
                    onClick={() => trackDesktopDownload({ build: build.id, surface })}
                  >
                    <span className="context-menu__label">{desktopBuildLabel(t, build.id)}</span>
                    {size && <span className="context-menu__shortcut">{size}</span>}
                  </a>
                </DropdownMenu.Item>
              );
            })}
          </DropdownMenu.Group>
        );
      })}
    </>
  );
}
