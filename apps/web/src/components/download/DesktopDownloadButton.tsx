import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trackDesktopDownload, type DesktopDownloadSurface } from '../../analytics';
import { useDesktopDownloads } from '../../platform/useDesktopDownloads';
import { Button, ButtonLink, type ButtonProps } from '../ui/Button';
import { DesktopDownloadMenuItems } from './DesktopDownloadMenuItems';
import { desktopDownloadCtaLabel } from './desktopBuildLabels';

/**
 * The download call to action: a primary link for the visitor's own platform,
 * and a caret opening every build for every platform.
 *
 * It wears {@link SplitButton}'s classes without being one, because the primary
 * half has to be an anchor — a `.dmg` reached by `window.location` is a link the
 * browser cannot show you, copy, or open in a new tab, and the whole point of
 * this control is handing someone a file.
 *
 * **The anchor always has an href.** Before the release resolves — and on a load
 * where it never does — that href is the releases page, so the first paint, the
 * prerendered markup a crawler sees, and a rate-limited session all carry a link
 * that works. What the resolved release adds is precision, not function.
 *
 * Renders nothing in the desktop app.
 */
export function DesktopDownloadButton({
  surface,
  size = 'lg',
  variant = 'primary',
  className = '',
}: {
  surface: DesktopDownloadSurface;
  size?: ButtonProps['size'];
  variant?: ButtonProps['variant'];
  /**
   * Placement, applied to the root.
   *
   * So a caller can position this without wrapping it: a wrapper would still be
   * in the layout on desktop, where this renders nothing, and would leave its
   * own margin behind as a gap with nothing in it.
   */
  className?: string;
}) {
  const { t } = useTranslation();
  const { available, os, builds, recommended, fallbackUrl } = useDesktopDownloads();

  if (!available) return null;

  const href = recommended?.url ?? fallbackUrl;
  // A resolved build is a file; the fallback is the releases page, which is a
  // page and should not replace what the visitor was reading.
  const isFallback = !recommended;

  return (
    <div className={`ui-split-button ${className}`.trim()}>
      <ButtonLink
        variant={variant}
        size={size}
        className="ui-split-button__primary"
        href={href}
        target={isFallback ? '_blank' : undefined}
        rel="noreferrer noopener"
        onClick={() =>
          trackDesktopDownload({ build: recommended?.id ?? 'releases-page', surface })
        }
      >
        <Download size={15} aria-hidden="true" />
        {desktopDownloadCtaLabel(t, os)}
      </ButtonLink>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            variant={variant}
            size={size}
            className="ui-split-button__caret"
            aria-label={t('common:download.otherPlatforms', 'Other platforms')}
          >
            <ChevronDown size={14} />
          </Button>
        </DropdownMenu.Trigger>
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
              surface={surface}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
