import type { TFunction } from 'i18next';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { APP_VERSION } from '../../constants/release';
import { runUpdateCheck } from '../../lib/updateController';
import { announceUpdateCheck } from '../../lib/updateFeedback';
import { surfaceSupports } from '../../platform/capabilities';
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
 * What the last check came to, in one line under the version.
 *
 * Pure and exported so every branch is reachable from a test. The failing branch
 * is the point: a check that could not reach the server used to leave this
 * reading "Not checked yet" forever, so the one press that most needed an answer
 * was the one that looked like nothing had happened.
 */
export function updateCheckSummary(
  t: TFunction,
  state: {
    lastCheck: { readonly at: number; readonly ok: boolean } | null;
    version: string | null;
  }
): string {
  if (!state.lastCheck) {
    return t('dialogs:settings.updates.neverChecked', 'Not checked yet');
  }

  const when = new Date(state.lastCheck.at).toLocaleString();

  if (!state.lastCheck.ok) {
    return t(
      'dialogs:settings.updates.checkFailed',
      "Couldn't check for updates — last tried {{when}}",
      { when }
    );
  }

  // `setNoUpdate` clears it, so a version surviving a successful check is an
  // offer standing right now.
  if (state.version) {
    return t('dialogs:settings.updates.offered', 'Version {{version}} is available', {
      version: state.version,
    });
  }

  return t('dialogs:settings.updates.upToDate', 'Up to date — checked {{when}}', {
    when,
  });
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
  const lastCheck = useUpdateStore((state) => state.lastCheck);
  const status = useUpdateStore((state) => state.status);
  const version = useUpdateStore((state) => state.version);
  const checking = status === 'checking';

  const onCheckNow = useCallback(() => {
    // `runUpdateCheck` resolves even when the check fails, so the outcome is
    // always here to report.
    void runUpdateCheck('manual').then((outcome) => announceUpdateCheck(outcome, t));
  }, [t]);

  if (!surfaceSupports('selfUpdate')) return null;

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
          <p className="settings-toggle-row__desc">{updateCheckSummary(t, { lastCheck, version })}</p>
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
