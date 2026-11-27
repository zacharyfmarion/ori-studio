/**
 * When a References failure is the browser failing to load the precrease
 * planner, not the planner failing (ORI-STUDIO-1B).
 *
 * The planner's wasm is fetched inside its worker the first time References
 * asks it anything, which is listing the sheets as the workspace opens. When
 * the network refuses that download or cuts it off, the call rejects with the
 * bridge's own `precrease_unavailable` and the browser's words for it
 * (`lib/networkFailure.ts`). That is the connection, not a defect: the
 * workspace says so plainly, with what to do, and counts it; it never goes to
 * Sentry. The worker forgets a start that failed, so the next call — Try
 * again, a pick, a plan — fetches it again.
 *
 * A start that failed for any other reason (a compile that ran out of memory),
 * and every failure of the planner itself, is reported as before.
 */
import type { TFunction } from 'i18next';
import { track } from '../../analytics';
import { ANALYTICS_EVENTS, type ReferencesLoadFailureSurface } from '../../analytics/events';
import { isNetworkFailure, offlineFlag } from '../../lib/networkFailure';
import { humanizeError } from '../../lib/toastMessages';
import { reportError } from '../../monitoring';
import { isPrecreaseUnavailable } from './precreaseFailures';

/** Whether `error` is the precrease planner not loading (see the module docs). */
export function isReferencesLoadFailure(error: unknown): boolean {
  return isPrecreaseUnavailable(error) && isNetworkFailure(error);
}

/**
 * Handle a failure References met at `surface`, and say what the workspace
 * shows for it: a planner that did not load is counted (`references load
 * failed`) and said plainly; anything else is reported to Sentry, as
 * `references:<surface>`, and said in its own terms.
 */
export function handleReferencesFailure(
  error: unknown,
  surface: ReferencesLoadFailureSurface,
  t: TFunction
): string {
  if (isReferencesLoadFailure(error)) {
    track(ANALYTICS_EVENTS.referencesLoadFailed, { surface, offline: offlineFlag() });
    return t('panels:references.didNotLoad', 'References couldn’t load. Check your connection, then try again.');
  }
  reportError(error, { surface: `references:${surface}` });
  return humanizeError(error, t);
}
