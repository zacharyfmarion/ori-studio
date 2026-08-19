import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { requestConfirmation } from '../store/commandDialogStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { WELCOME_PATH } from './paths';

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
      nextLocation.pathname === WELCOME_PATH &&
      currentLocation.pathname !== nextLocation.pathname,
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
