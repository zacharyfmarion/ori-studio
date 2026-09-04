import type { TFunction } from 'i18next';
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
        const state = busy
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
              : t('dialogs:settings.models.notInstalled', 'Not downloaded');
        return (
          <div
            className="settings-toggle-row settings-toggle-row--action"
            key={row.version.id}
            data-testid={`settings-model-${row.version.id}`}
          >
            <div className="settings-toggle-row__copy">
              <span className="settings-toggle-row__label">{rowLabel(t, row)}</span>
              <span className="settings-toggle-row__desc">
                {[formatModelSize(row.version.size_bytes), state, ...rowNotes(t, row)].join(' · ')}
              </span>
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
        <div
          className="settings-toggle-row settings-toggle-row--action"
          key={model.id}
          data-testid={`settings-model-${model.id}`}
        >
          <div className="settings-toggle-row__copy">
            <span className="settings-toggle-row__label">
              {t('dialogs:settings.models.orphanedLabel', 'Retired detector')}
            </span>
            <span className="settings-toggle-row__desc">
              {formatModelSize(model.size_bytes)}
              {' · '}
              {t('dialogs:settings.models.orphaned', 'No longer published; never used.')}
            </span>
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

/**
 * The row's name. A published version is named by its number; the dev
 * server's local manifest, which the registry client reports as version 0
 * with the note `local`, is named for what it is rather than as "v0".
 */
function rowLabel(t: TFunction, row: DetectorModelRow): string {
  if (isLocalDevModel(row)) {
    return t('dialogs:settings.models.localRow', 'Development detector');
  }
  return t('dialogs:settings.models.row', 'Detector v{{version}}', { version: row.version.version });
}

/** What follows the state: "Current" on the version the detector offers, and the publisher's note. */
function rowNotes(t: TFunction, row: DetectorModelRow): string[] {
  const notes: string[] = [];
  if (row.current) notes.push(t('dialogs:settings.models.current', 'Current'));
  if (row.version.note && !isLocalDevModel(row)) notes.push(row.version.note);
  return notes;
}

function isLocalDevModel(row: DetectorModelRow): boolean {
  return row.version.version === 0 && row.version.note === 'local';
}
