import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { RELEASES_URL } from '../constants/release';
import { relaunchIntoUpdate, startUpdateDownload } from '../lib/updateController';
import { confirmDiscardUnsavedWork } from '../lib/unsavedWork';
import { shouldShowUpdateChip, useUpdateStore } from '../store/updateStore';

/**
 * The update affordance in the toolbar.
 *
 * The whole design turns on one sentence: **the chip says "Relaunch to update",
 * so it may only appear when relaunching will work right now** — no further
 * download, no password prompt, no trip to a browser. That is why the states
 * below are not interchangeable labels on one button:
 *
 * - a silent automatic download renders nothing, because progress for something
 *   nobody asked for is a nag;
 * - a download the user started shows progress, because they are owed feedback;
 * - a Linux package install says "Download" and opens the releases page,
 *   because it genuinely cannot update in place.
 */
export function UpdateChip() {
  const { t } = useTranslation();
  const status = useUpdateStore((state) => state.status);
  const version = useUpdateStore((state) => state.version);
  const skippedVersion = useUpdateStore((state) => state.skippedVersion);
  const snoozed = useUpdateStore((state) => state.snoozed);
  const downloadWasRequested = useUpdateStore((state) => state.downloadWasRequested);
  const skipCurrentVersion = useUpdateStore((state) => state.skipCurrentVersion);
  const snoozeForSession = useUpdateStore((state) => state.snoozeForSession);

  const onRelaunch = useCallback(() => {
    void (async () => {
      // The guard runs here, not in a close handler: on Windows `install()`
      // exits the process, so `onCloseRequested` never fires and anything
      // waiting there would be skipped silently.
      const proceed = await confirmDiscardUnsavedWork({
        title: t('dialogs:updateGuard.title', 'Discard unsaved changes?'),
        message: t(
          'dialogs:updateGuard.message',
          'Your current project has unsaved changes. Restart Ori Studio to update and discard them?'
        ),
        confirmLabel: t('dialogs:updateGuard.discard', 'Discard and restart'),
      });
      if (!proceed) return;
      await relaunchIntoUpdate();
    })();
  }, [t]);

  const onDownload = useCallback(() => {
    void startUpdateDownload('manual');
  }, []);

  const onOpenReleases = useCallback(() => {
    window.open(RELEASES_URL, '_blank', 'noopener,noreferrer');
  }, []);

  const onSkip = useCallback(() => {
    skipCurrentVersion();
    track(ANALYTICS_EVENTS.appUpdateDismissed, { scope: 'skipped' });
  }, [skipCurrentVersion]);

  const onRemindLater = useCallback(() => {
    snoozeForSession();
    track(ANALYTICS_EVENTS.appUpdateDismissed, { scope: 'session' });
  }, [snoozeForSession]);

  const visible = shouldShowUpdateChip({
    status,
    version,
    skippedVersion,
    snoozed,
    downloadWasRequested,
  });
  if (!visible || !version) return null;

  const installing = status === 'installing';
  let label: string;
  let action: () => void;

  if (status === 'ready' || installing) {
    label = t('common:update.relaunch', 'Relaunch to update');
    action = onRelaunch;
  } else if (status === 'unsupported') {
    label = t('common:update.download', 'Download update');
    action = onOpenReleases;
  } else if (status === 'downloading') {
    label = t('common:update.downloading', 'Downloading update…');
    action = () => {};
  } else {
    label = t('common:update.available', 'Update available');
    action = onDownload;
  }

  return (
    <div className="update-chip" data-status={status}>
      <button
        type="button"
        className="update-chip__action"
        onClick={action}
        disabled={installing || status === 'downloading'}
        title={t('common:update.version', 'Version {{version}}', { version })}
      >
        <span className="update-chip__dot" aria-hidden="true" />
        <span className="update-chip__label">{label}</span>
        <span className="update-chip__version">{`v${version}`}</span>
      </button>
      {/* Skipping is offered only for an update the user could act on now.
          Someone two hours into a crease pattern should be able to silence one
          release without opening Settings — and without losing the download
          that is already on disk. */}
      {(status === 'ready' || status === 'available') && (
        <span className="update-chip__dismiss">
          <button type="button" onClick={onSkip} className="update-chip__dismiss-button">
            {t('common:update.skip', 'Skip {{version}}', { version })}
          </button>
          <button type="button" onClick={onRemindLater} className="update-chip__dismiss-button">
            {t('common:update.remindLater', 'Later')}
          </button>
        </span>
      )}
    </div>
  );
}
