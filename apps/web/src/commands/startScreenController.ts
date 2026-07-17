import { navigateTo } from '../routing/appRouter';
import { WELCOME_PATH } from '../routing/paths';

/**
 * Return to the start screen. The unsaved-changes prompt is handled by the
 * navigation blocker ({@link useWelcomeDiscardGuard}); landing on `/welcome`
 * resets transient project state ({@link WelcomeRoute}).
 */
export async function requestStartScreen(): Promise<boolean> {
  navigateTo(WELCOME_PATH);
  return true;
}
