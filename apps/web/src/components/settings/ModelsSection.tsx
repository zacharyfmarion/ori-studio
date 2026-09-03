import { useTranslation } from 'react-i18next';
import { formatModelSize } from '../../lib/cpDetectModels';
import { isCpDetectBuildEnabled } from '../../platform/features';
import { Button } from '../ui/Button';
import { useDetectorModels, type DetectorModelsDeps, type DetectorModelRow } from './useDetectorModels';

/**
 * Settings ▸ Models: what the detector's models are, which this device holds,
 * and the three verbs on them — download, update, remove — the way Affinity
 * manages its machine-learning models. Every row says its size before a
 * download is offered, and removing frees the bytes at once; the detect
 * dialog then offers the download again on its next open.
 */
export function ModelsSection({ deps }: { deps?: DetectorModelsDeps } = {}) {
  const { t } = useTranslation();
  const models = useDetectorModels(deps);
  if (!isCpDetectBuildEnabled()) return null;

  const newestInstalled = models.rows.find((row) => row.installed);
  const updateFor = (row: DetectorModelRow) =>
    row.current && !row.installed && newestInstalled !== undefined && newestInstalled.version.version < row.version.version;

  return (
    <section className="settings-section" data-testid="settings-models">
      <h3 className="settings-section__title">{t('dialogs:settings.models.title', 'Models')}</h3>
      <p className="settings-toggle-row__desc">
        {t(
          'dialogs:settings.models.description',
          'The crease-pattern detector downloads its model once and keeps it on this device. A newer model is offered here and in the Detect dialog; nothing downloads without its size shown first.'
        )}
      </p>
      {models.status === 'loading' && (
        <p className="settings-toggle-row__desc">{t('dialogs:settings.models.loading', 'Reading the model registry…')}</p>
      )}
      {models.status === 'unavailable' && (
        <p className="settings-toggle-row__desc" role="status">
          {t('dialogs:settings.models.unavailable', 'The model registry could not be read: {{reason}}', {
            reason: models.reason ?? '',
          })}
        </p>
      )}
      {models.rows.map((row) => {
        const busy = models.downloading?.id === row.version.id;
        const progress = busy ? models.downloading?.progress : null;
        return (
          <div className="settings-toggle-row" key={row.version.id} data-testid={`settings-model-${row.version.id}`}>
            <div>
              <div>
                {t('dialogs:settings.models.row', 'Detector v{{version}} · {{size}}', {
                  version: row.version.version,
                  size: formatModelSize(row.version.size_bytes),
                })}
                {row.current && (
                  <span className="settings-models__tag">
                    {' '}
                    {t('dialogs:settings.models.current', 'current')}
                  </span>
                )}
              </div>
              <p className="settings-toggle-row__desc">
                {busy
                  ? progress && progress.total > 0
                    ? t('dialogs:settings.models.downloading', 'Downloading — {{loaded}} of {{total}}', {
                        loaded: formatModelSize(progress.loaded),
                        total: formatModelSize(progress.total),
                      })
                    : t('dialogs:settings.models.downloadingStart', 'Downloading…')
                  : row.installed
                    ? t('dialogs:settings.models.installed', 'Installed')
                    : updateFor(row)
                      ? t('dialogs:settings.models.updateAvailable', 'Newer than what is installed')
                      : t('dialogs:settings.models.notInstalled', 'Not downloaded')}
                {row.version.note ? ` · ${row.version.note}` : ''}
              </p>
            </div>
            {row.installed ? (
              <Button size="sm" variant="secondary" onClick={() => void models.remove(row.version.id)} disabled={models.downloading !== null}>
                {t('dialogs:settings.models.remove', 'Remove')}
              </Button>
            ) : (
              <Button size="sm" variant={row.current ? 'primary' : 'secondary'} onClick={() => void models.download(row.version)} disabled={models.downloading !== null}>
                {updateFor(row)
                  ? t('dialogs:settings.models.update', 'Update')
                  : t('dialogs:settings.models.download', 'Download')}
              </Button>
            )}
          </div>
        );
      })}
      {models.orphaned.map((model) => (
        <div className="settings-toggle-row" key={model.id} data-testid={`settings-model-${model.id}`}>
          <div>
            <div>{formatModelSize(model.size_bytes)}</div>
            <p className="settings-toggle-row__desc">
              {t('dialogs:settings.models.orphaned', 'No longer published; never used.')}
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => void models.remove(model.id)}>
            {t('dialogs:settings.models.remove', 'Remove')}
          </Button>
        </div>
      ))}
      {models.error && (
        <p className="settings-toggle-row__desc" role="alert">
          {models.error}
        </p>
      )}
    </section>
  );
}
