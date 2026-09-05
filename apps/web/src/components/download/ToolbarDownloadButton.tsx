import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
 * Renders nothing in the desktop app, which is already the thing this offers.
 */
export function ToolbarDownloadButton() {
  const { t } = useTranslation();
  const { available, builds, fallbackUrl, version } = useDesktopDownloads();

  if (!available) return null;

  const label = version
    ? t('common:toolbar.downloadDesktopVersion', 'Get the desktop app ({{version}})', { version })
    : t('common:toolbar.downloadDesktop', 'Get the desktop app');

  return (
    <DropdownMenu.Root>
      <MenuIconButton
        label={label}
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
