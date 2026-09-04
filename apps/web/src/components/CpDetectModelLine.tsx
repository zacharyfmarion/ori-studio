import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { detectorDeviceClass, type DetectorModelState } from './cpDetectModelState';
import { formatModelSize, type CpDetectModelDownloadProgress } from '../lib/cpDetectModels';
import { Button } from './ui/Button';

interface CpDetectModelLineProps {
  model: DetectorModelState | null;
  progress: CpDetectModelDownloadProgress | null;
  updating: boolean;
  onUpdate: () => void;
}

/**
 * One line about the detector before the first image: what will download and
 * how big, what is installed, whether something newer is on offer, and what
 * this device brings to it. The dialog never downloads without this having
 * said the size first.
 */
export function CpDetectModelLine({ model, progress, updating, onUpdate }: CpDetectModelLineProps) {
  const { t } = useTranslation();
  if (!model) return null;
  const device = detectorDeviceClass();
  const expectation =
    device === 'gpu'
      ? t('dialogs:cpDetectImport.model.deviceGpu', 'This device has a GPU, so detection takes seconds.')
      : device === 'threads'
        ? t('dialogs:cpDetectImport.model.deviceThreads', 'No GPU here; detection runs on the CPU and can take a while.')
        : t('dialogs:cpDetectImport.model.deviceSingle', 'No GPU and a single thread here; expect about a minute.');
  // A published version has a number; a dev checkout's local model (version 0)
  // has none worth showing.
  const installedLine = model.installed
    ? model.active.version > 0
      ? t('dialogs:cpDetectImport.model.installed', 'Detector v{{version}} installed ({{size}}).', {
          version: model.active.version,
          size: formatModelSize(model.active.size_bytes),
        })
      : t('dialogs:cpDetectImport.model.installedLocal', 'Detector installed ({{size}}).', {
          size: formatModelSize(model.active.size_bytes),
        })
    : t('dialogs:cpDetectImport.model.download', 'The detector is a {{size}} download, once.', {
        size: formatModelSize(model.active.size_bytes),
      });
  return (
    <div className="cp-detect-modal__model-line" data-testid="cp-detect-model-line">
      <span>
        {installedLine} {expectation}
      </span>
      {model.update && !updating && (
        <span className="cp-detect-modal__model-update">
          {t('dialogs:cpDetectImport.model.updateAvailable', 'A newer detector is available (v{{version}}, {{size}}).', {
            version: model.update.version,
            size: formatModelSize(model.update.size_bytes),
          })}
          <Button size="sm" variant="secondary" onClick={onUpdate}>
            <Download size={13} />
            {t('dialogs:cpDetectImport.model.update', 'Download')}
          </Button>
        </span>
      )}
      {updating && (
        <span>
          {progress && progress.total > 0
            ? t('dialogs:cpDetectImport.model.updating', 'Downloading the newer detector — {{loaded}} of {{total}}', {
                loaded: formatModelSize(progress.loaded),
                total: formatModelSize(progress.total),
              })
            : t('dialogs:cpDetectImport.model.updatingStart', 'Downloading the newer detector…')}
        </span>
      )}
    </div>
  );
}
