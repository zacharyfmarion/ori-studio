import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';

/**
 * "Export view…", for wherever a simulation is shown: the Simulate
 * workspace's toolbar and an inline simulation window's floating toolbar.
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
