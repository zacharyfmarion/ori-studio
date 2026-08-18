import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, X } from 'lucide-react';
import { ANALYTICS_EVENTS, track } from '../analytics';
import { RELEASES_URL } from '../constants/release';
import { relaunchIntoUpdate, startUpdateDownload } from '../lib/updateController';
import { confirmDiscardUnsavedWork } from '../lib/unsavedWork';
import { shouldShowUpdateCard, useUpdateStore } from '../store/updateStore';

/**
 * The update affordance: a card floating over the bottom-left of whatever is on
 * screen.
 *
 * Mounted at the app root rather than in the workspace toolbar, because the
 * welcome screen is where the app opens and is where someone is most likely to
 * be when an update lands — an affordance that only exists once you have a
 * document open would miss the moment it is most useful.
 *
 * The design still turns on one sentence: **it says "Relaunch to update", so it
 * may only appear when relaunching will work right now** — no further download,
 * no password prompt, no browser trip. Hence the states below are not
 * interchangeable labels:
 *
 * - a silent automatic download renders nothing, because progress for something
 *   nobody asked for is a nag;
 * - a download the user started shows progress, because they are owed feedback;
 * - a Linux package install says "Download" and opens the releases page,
 *   because it genuinely cannot update in place.
 */
export function UpdateCard() {
  const { t } = useTranslation();
  const status = useUpdateStore((state) => state.status);
  const version = useUpdateStore((state) => state.version);
  const skippedVersion = useUpdateStore((state) => state.skippedVersion);
  const snoozed = useUpdateStore((state) => state.snoozed);
  const downloadWasRequested = useUpdateStore((state) => state.downloadWasRequested);
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

  const onDismiss = useCallback(() => {
    // Dismissing hides the card for this run; it does not discard the staged
    // download, and a relaunch brings it back. Turning updates off entirely
    // lives in Settings, where a standing decision belongs.
    snoozeForSession();
    track(ANALYTICS_EVENTS.appUpdateDismissed, { scope: 'session' });
  }, [snoozeForSession]);

  const visible = shouldShowUpdateCard({
    status,
    version,
    skippedVersion,
    snoozed,
    downloadWasRequested,
  });
  if (!visible || !version) return null;

  const busy = status === 'installing' || status === 'downloading';
  let label: string;
  let action: () => void;

  if (status === 'ready' || status === 'installing') {
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
    <div className="update-card" data-status={status} role="status">
      <button type="button" className="update-card__main" onClick={action} disabled={busy}>
        <span className="update-card__text">
          <span className="update-card__label">{label}</span>
          <span className="update-card__version">{`v${version}`}</span>
        </span>
        <span className="update-card__chevron" aria-hidden="true">
          <ArrowRight size={16} />
        </span>
      </button>
      {/* Its own button, not nested inside the one above — nested buttons are
          invalid and the inner click would never arrive. Revealed on hover or
          keyboard focus, so it is reachable without a pointer. */}
      <button
        type="button"
        className="update-card__dismiss"
        onClick={onDismiss}
        aria-label={t('common:update.dismiss', 'Dismiss')}
        title={t('common:update.dismiss', 'Dismiss')}
      >
        <X size={12} />
      </button>
    </div>
  );
}
