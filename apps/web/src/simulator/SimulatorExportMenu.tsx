import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Download } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import type { SimulatorViewExportFormat } from './simulatorViewExport';

/**
 * "Export this view", for wherever a simulation is shown.
 *
 * One component mounted by both surfaces — the Simulate workspace's toolbar and
 * an inline simulation window's floating toolbar — rather than each growing its
 * own control. With two verbs and no context-menu or menu-bar surface to keep in
 * step, a React-free action catalog (as `foldedFigureActions` uses) would be more
 * interface than the thing it describes; if those surfaces ever want these verbs,
 * that is the moment to promote it.
 *
 * Deliberately not in the File > Export menu: that exports the *document*, while
 * this is the camera view one viewport is currently showing.
 */

// Literal keys so the i18n extractor can see them (see apps/web/CLAUDE.md).
function formatLabel(format: SimulatorViewExportFormat, t: TFunction): string {
  return format === 'svg'
    ? t('panels:simulatorExport.svg', 'SVG image')
    : t('panels:simulatorExport.png', 'PNG image');
}

const FORMATS: readonly SimulatorViewExportFormat[] = ['svg', 'png'];

export function SimulatorExportMenu({
  onExport,
  disabled = false,
  variant = 'toolbar',
}: {
  onExport: (format: SimulatorViewExportFormat) => void;
  disabled?: boolean;
  /**
   * `toolbar` matches the floating bar over an inline window; the default
   * IconButton look suits a panel's own toolbar.
   */
  variant?: 'toolbar' | 'default';
}) {
  const { t } = useTranslation();
  const label = t('panels:simulatorExport.trigger', 'Export view');

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {/* No `title`: an IconButton with one wraps itself in a Tooltip trigger,
            which cannot also be a Radix `asChild` trigger. */}
        <IconButton size="sm" variant={variant} aria-label={label} disabled={disabled}>
          <Download size={14} />
        </IconButton>
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
          {FORMATS.map((format) => (
            <DropdownMenu.Item
              key={format}
              className="context-menu__item"
              onSelect={() => onExport(format)}
            >
              <span className="context-menu__label">{formatLabel(format, t)}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
