import { createBrowserRouter, createMemoryRouter, redirect } from 'react-router-dom';
import App from '../App';
import { RouteErrorElement } from '../components/errors/RouteErrorElement';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { readBoolean, storageKey, STORAGE_KEYS } from '../lib/storage';
import { isWorkspaceBlocked } from '../platform/mobileSurface';
import { getRuntimeSurface } from '../platform/runtime';
import { DESIGN_PATH, EDIT_PATH, LEGACY_DESIGN_PATHS, WELCOME_PATH } from './paths';
import { ShareRoute } from './ShareRoute';
import { WelcomeRoute } from './WelcomeRoute';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * The configured startup home for a bare `/` or an unknown path. The "Show
 * welcome on startup" preference is a synchronously-readable routing choice — the
 * welcome screen (the default) or straight into Edit.
 *
 * A blocked phone ignores the preference: `/welcome` is the only page it has, so
 * "start in Edit" would strand it somewhere it cannot be.
 */
export function startupHomePath(): string {
  if (isWorkspaceBlocked()) return WELCOME_PATH;
  const showWelcome = readBoolean(storageKey(STORAGE_KEYS.showWelcomeOnStartup), true);
  return showWelcome ? WELCOME_PATH : EDIT_PATH;
}

/** Where a cold start (`/`) or an unmatched path lands. */
function startupRedirect() {
  return redirect(startupHomePath());
}

/**
 * Keep a phone out of the workspaces, however it got pointed at one — a deep
 * link, a bookmark, a shared URL.
 *
 * This is a *device-capability* gate, and it is the only guard the workspace
 * routes have. There is deliberately no provisioning guard: every surface stands
 * on its own (Edit and Design/box-pleat self-provision their documents, the
 * Design chooser establishes itself, TreeMaker opens an empty tree, Simulate
 * shows its own empty state), so on a device that can run them a cold reload or
 * deep link into any workspace is always honored rather than bounced.
 */
function blockedDeviceRedirect() {
  return isWorkspaceBlocked() ? redirect(WELCOME_PATH) : null;
}

type AppRouter = ReturnType<typeof createBrowserRouter>;

let appRouter: AppRouter | null = null;

/** Register the live router so non-React code (menus, shortcuts) can navigate. */
export function setAppRouter(router: AppRouter): void {
  appRouter = router;
}

/** Navigate from outside a React component (menu actions, keyboard shortcuts). */
export function navigateTo(path: string, options?: { replace?: boolean }): void {
  void appRouter?.navigate(path, options);
}

/** Current router pathname, or null before the router is registered. */
export function currentPath(): string | null {
  return appRouter?.state.location.pathname ?? null;
}

/**
 * Build the app router. Web uses a browser history (clean, shareable URLs); the
 * Tauri desktop shell has no address bar and serves from a custom protocol with
 * no server rewrite, so it uses an in-memory history to avoid deep-link 404s.
 */
export function createAppRouter(): AppRouter {
  const routes = [
    {
      path: '/',
      element: <App />,
      // Router-caught errors (loaders, and render throws inside route elements)
      // never reach a React error boundary, so the route tree needs its own.
      errorElement: <RouteErrorElement />,
      children: [
        { index: true, loader: startupRedirect },
        { path: 'welcome', element: <WelcomeRoute /> },
        // Share links land here, stash their intent, and redirect to Edit. A real
        // route (rather than a fragment on `/edit`) so the share leaves the URL on
        // arrival and this handling never runs on a normal start.
        //
        // Both shapes: `/s/<id>` for server-stored links, and bare `/s` for the
        // original `#<payload>` fragment scheme, which must keep working.
        //
        // The device gate is a loader here for the same reason it is one on the
        // workspace shell, and it matters more: a share captured during render
        // would be stashed in the store and left waiting to import itself the
        // next time this browser reached a workspace. A loader runs first, so
        // `ShareRoute` never mounts and nothing is captured.
        { path: 's', element: <ShareRoute />, loader: blockedDeviceRedirect },
        { path: 's/:shareId', element: <ShareRoute />, loader: blockedDeviceRedirect },
        {
          element: <WorkspaceShell />,
          // On the shell rather than on each workspace: one gate covers all
          // three plus the legacy Design sub-paths, and a parent loader's
          // redirect short-circuits before any of their loaders run.
          loader: blockedDeviceRedirect,
          children: [
            { path: 'design', element: <WorkspaceRoute workspace="design" /> },
            // The retired method sub-routes. A bookmark or a link from an older
            // build still resolves — to the one Design workspace, which now shows
            // whichever designs the project has open rather than a single method.
            ...LEGACY_DESIGN_PATHS.map((path) => ({
              path: path.slice(1),
              loader: () => redirect(DESIGN_PATH),
            })),
            { path: 'edit', element: <WorkspaceRoute workspace="edit" /> },
            { path: 'simulate', element: <WorkspaceRoute workspace="simulate" /> },
          ],
        },
        { path: '*', loader: startupRedirect },
      ],
    },
  ];

  if (getRuntimeSurface() === 'desktop') {
    // Start at the index so `startupRedirect` applies the welcome/Edit preference
    // on desktop too (there's no address bar to deep-link from).
    return createMemoryRouter(routes, { initialEntries: ['/'] });
  }

  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return createBrowserRouter(routes, { basename });
}
