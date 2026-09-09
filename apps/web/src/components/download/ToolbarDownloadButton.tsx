import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIsPhoneLayout } from '../../platform/phoneLayout';
import { useDesktopDownloads } from '../../platform/useDesktopDownloads';
import { MenuIconButton } from '../ui/MenuIconButton';
import { DesktopDownloadMenuItems } from './DesktopDownloadMenuItems';

/**
 * The workspace toolbar's download affordance: one small icon, opening the same
 * list of builds the landing page's caret does.
 *
 * A menu rather than a direct link, unlike {@link DesktopDownloadButton}. An icon
 * has no room to say which platform it would download for, and a 36 MB transfer
 * starting from an unlabelled click is not a thing to do to somebody mid-edit —
 * so every path from here goes through a list that names the file first.
 *
 * Renders nothing in the desktop app, which is already the thing this offers,
 * and nothing on a phone, which cannot run any of the builds it lists. Both
 * refusals happen before {@link DownloadMenu} mounts, which is the reason this
 * is split in two: a phone that never mounts the body never calls
 * `useDesktopDownloads`, so it never spends a request asking GitHub about
 * installers it has no way to use. `display: none` would have hidden the icon
 * and paid for the fetch anyway.
 */
export function ToolbarDownloadButton() {
  const phone = useIsPhoneLayout();
  if (phone) return null;
  return <DownloadMenu />;
}

function DownloadMenu() {
  const { t } = useTranslation();
  const { available, builds, fallbackUrl, version } = useDesktopDownloads();

  if (!available) return null;

  const label = version
    ? t('common:toolbar.downloadDesktopVersion', 'Get the desktop app ({{version}})', { version })
    : t('common:toolbar.downloadDesktop', 'Get the desktop app');

  return (
    <DropdownMenu.Root>
      {/*
        `default`, not `MenuIconButton`'s own `toolbar` default, which draws a
        filled box. The header's icons are Discord, this, and Settings, and the
        other two are plain `IconButton`s — a raised one in the middle reads as
        pressed or as the primary action rather than as a peer, which none of the
        three is. The `toolbar` variant is for the canvas toolbars, where an icon
        sits over the drawing surface and needs a box to be legible against it.
      */}
      <MenuIconButton
        label={label}
        variant="default"
        tooltipSide="bottom"
        icon={<Download size={15} />}
      />
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="context-menu"
          side="bottom"
          align="end"
          sideOffset={6}
          collisionPadding={8}
          loop
        >
          <DesktopDownloadMenuItems
            builds={builds}
            fallbackUrl={fallbackUrl}
            surface="toolbar"
          />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
