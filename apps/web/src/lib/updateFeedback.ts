import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { shouldShowUpdateCard, useUpdateStore } from '../store/updateStore';
import type { UpdateCheckOutcome } from './updateController';

/** One id, so checking repeatedly replaces the notice rather than stacking it. */
const UPDATE_CHECK_TOAST_ID = 'oristudio-update-check';

/**
 * Say what a check the user asked for came back with.
 *
 * Needed because the overwhelmingly common answer is *nothing* — no update, no
 * card, no state change anyone can see. Without this, "Check now" and the Help
 * menu's "Check for Updates" are dead buttons on every press but the rare one,
 * and a press that fails outright is indistinguishable from one that succeeded.
 *
 * Shared by both surfaces that offer the verb, rather than each toasting for
 * itself, because that is how the menu ends up silent while the settings button
 * talks — which is exactly the state this replaced.
 *
 * Only for `trigger === 'manual'`. An automatic check stays silent by design:
 * this app works offline and a toast every four hours on a train is worse than
 * no updater at all.
 */
export function announceUpdateCheck(outcome: UpdateCheckOutcome, t: TFunction): void {
  // The check never ran, so there is nothing to report and no basis for
  // claiming the app is up to date.
  if (outcome === 'skipped') return;

  if (outcome === 'failed') {
    toast.error(t('toasts:update.checkFailed', "Couldn't check for updates"), {
      id: UPDATE_CHECK_TOAST_ID,
      description: t(
        'toasts:update.checkFailedHint',
        'Ori Studio could not reach the update server. Check your connection and try again.'
      ),
    });
    return;
  }

  if (outcome === 'none') {
    toast.success(t('toasts:update.upToDate', 'Ori Studio is up to date'), {
      id: UPDATE_CHECK_TOAST_ID,
    });
    return;
  }

  // An update was found, and the card says so far better than a toast could.
  // Unless it is suppressed — a skipped or snoozed version still answers the
  // question the user just asked, and silence here would read as a dead button.
  const state = useUpdateStore.getState();
  if (!state.version || shouldShowUpdateCard(state)) return;

  toast.success(
    t('toasts:update.available', 'Version {{version}} is available', {
      version: state.version,
    }),
    { id: UPDATE_CHECK_TOAST_ID }
  );
}
