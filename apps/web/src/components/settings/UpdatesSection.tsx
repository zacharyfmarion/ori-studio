import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../../constants/release';
import { runUpdateCheck } from '../../lib/updateController';
import { isDesktopRuntime } from '../../platform/runtime';
import { useUpdateStore, type UpdateDelivery } from '../../store/updateStore';
import { Button } from '../ui/Button';

const DELIVERY_OPTIONS: readonly UpdateDelivery[] = ['automatic', 'notify', 'off'];

/**
 * Localized delivery labels. Literal `t()` calls per option keep the keys
 * extractable — the extractor only sees literals.
 */
function deliveryLabel(t: ReturnType<typeof useTranslation>['t'], value: UpdateDelivery): string {
  switch (value) {
    case 'automatic':
      return t('dialogs:settings.updates.automatic', 'Download updates automatically');
    case 'notify':
      return t('dialogs:settings.updates.notify', 'Tell me, but let me start the download');
    case 'off':
      return t('dialogs:settings.updates.off', "Don't check for updates");
  }
}

/**
 * Update preferences, and the only place the running version is visible.
 *
 * Desktop-only: the browser build updates by reloading. `off` is a real option
 * because Tauri has no delta updates — every release is a full download — and
 * this app is otherwise entirely usable offline.
 */
export function UpdatesSection() {
  const { t } = useTranslation();
  const delivery = useUpdateStore((state) => state.delivery);
  const setDelivery = useUpdateStore((state) => state.setDelivery);
  const lastCheckedAt = useUpdateStore((state) => state.lastCheckedAt);
  const status = useUpdateStore((state) => state.status);
  const [checking, setChecking] = useState(false);

  const onCheckNow = useCallback(() => {
    setChecking(true);
    void runUpdateCheck('manual')
      .catch(() => {
        // Surfaced by status below; a manual check that fails must not throw
        // out of a click handler.
      })
      .finally(() => setChecking(false));
  }, []);

  if (!isDesktopRuntime()) return null;

  return (
    <section className="settings-section">
      <h3 className="settings-section__title">
        {t('dialogs:settings.updates.title', 'Updates')}
      </h3>
      {DELIVERY_OPTIONS.map((option) => (
        <label className="settings-checkbox" key={option}>
          <input
            type="radio"
            name="update-delivery"
            value={option}
            checked={delivery === option}
            onChange={() => setDelivery(option)}
          />
          {deliveryLabel(t, option)}
        </label>
      ))}
      <p className="settings-toggle-row__desc">
        {t(
          'dialogs:settings.updates.description',
          'Updates are downloaded in full — Ori Studio has no partial updates. Nothing installs until you choose to relaunch.'
        )}
      </p>
      <div className="settings-toggle-row">
        <div>
          <div>{t('dialogs:settings.updates.currentVersion', 'Version {{version}}', {
            version: APP_VERSION,
          })}</div>
          <p className="settings-toggle-row__desc">
            {lastCheckedAt
              ? t('dialogs:settings.updates.lastChecked', 'Last checked {{when}}', {
                  when: new Date(lastCheckedAt).toLocaleString(),
                })
              : t('dialogs:settings.updates.neverChecked', 'Not checked yet')}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onCheckNow}
          disabled={checking || status === 'downloading' || status === 'installing'}
        >
          {checking
            ? t('dialogs:settings.updates.checking', 'Checking…')
            : t('dialogs:settings.updates.checkNow', 'Check now')}
        </Button>
      </div>
    </section>
  );
}
