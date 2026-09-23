import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useAppOpenedEvent } from '../analytics';
import { useSitePageTitle } from '../hooks/useSitePageTitle';
import { isDesktopRuntime } from '../platform/runtime';
import { loadWorkspace, useLoadedWorkspace } from './workspaceGateway';

/**
 * The root of every route.
 *
 * The landing and the site pages render here with nothing else loaded. The workspace
 * runtime (`App`: engine, keyboard, overlays, URL sync) joins once `workspaceGateway` has
 * loaded it — beside the route rather than around it, so no route waits on it and the
 * landing's first paint never pays for it.
 */
export function RootLayout() {
  const workspace = useLoadedWorkspace();

  // Once per launch (super properties ride along), on every route including the landing.
  useAppOpenedEvent();
  useSitePageTitle();

  // The desktop app has no first paint to protect — its code is on disk — and its native
  // menu, updater and open-with handling all live in the runtime.
  useEffect(() => {
    if (isDesktopRuntime()) void loadWorkspace();
  }, []);

  const Runtime = workspace?.App;
  return (
    <>
      <Outlet />
      {Runtime ? <Runtime /> : null}
    </>
  );
}
