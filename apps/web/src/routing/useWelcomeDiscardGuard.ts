import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { requestConfirmation } from '../store/commandDialogStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { DEFAULT_LOCALE } from '../i18n/locales';
import { LANDING_PAGE, sitePageForPath } from '../site/sitePages';
import { WELCOME_PATH } from './paths';

/**
 * The paths that render {@link WelcomeRoute}, and so clear the dirty flag on arrival:
 * `/welcome`, and each localized landing (`/zh-CN/`). Not `/` — its loader redirects
 * before anything renders, and it was never guarded.
 */
function rendersStartScreen(pathname: string): boolean {
  if (pathname === WELCOME_PATH) return true;
  const match = sitePageForPath(pathname);
  return match !== null && match.page === LANDING_PAGE && match.locale !== DEFAULT_LOCALE;
}

/**
 * Guard against abandoning unsaved changes when returning to the start screen.
 * Blocks navigation to `/welcome` while the project is dirty and prompts to
 * discard; proceeding lets {@link WelcomeRoute} clear the dirty flag on arrival.
 * Workspace↔workspace navigation is never blocked — those documents persist in
 * the store, so nothing is lost.
 */
export function useWelcomeDiscardGuard(): void {
  const dirty = useWorkspaceStore((state) => state.dirty);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      rendersStartScreen(nextLocation.pathname) &&
      currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let cancelled = false;
    void requestConfirmation({
      title: 'Discard unsaved changes?',
      message:
        'Your current project has unsaved changes. Return to the start screen and discard them?',
      confirmLabel: 'Discard',
      tone: 'danger',
    }).then((confirmed) => {
      if (cancelled) return;
      if (confirmed) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      cancelled = true;
    };
  }, [blocker]);
}
