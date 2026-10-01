import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';

/**
 * "Export view…" on an inline simulation window's floating toolbar. The
 * Simulate workspace offers the same verb as a button on its rail
 * (`simulator.exportView`), where there is room to say it in words.
 *
 * One button, where there was a menu of two formats: the export dialog it
 * opens chooses the format, with the page in view.
 *
 * Deliberately not in the File > Export menu: that exports the *document*,
 * while this is the camera view one viewport is currently showing.
 */
export function SimulatorExportButton({
  onExport,
  disabled = false,
}: {
  onExport: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <IconButton
      size="sm"
      variant="toolbar"
      title={t('panels:simulatorExport.trigger', 'Export view…')}
      disabled={disabled}
      onClick={() => onExport()}
    >
      <Download size={14} />
    </IconButton>
  );
}
