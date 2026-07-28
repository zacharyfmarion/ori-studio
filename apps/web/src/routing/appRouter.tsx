import { createBrowserRouter, createMemoryRouter, redirect } from 'react-router-dom';
import App from '../App';
import { RouteErrorElement } from '../components/errors/RouteErrorElement';
import { WorkspaceShell } from '../components/WorkspaceShell';
import { readBoolean, storageKey, STORAGE_KEYS } from '../lib/storage';
import { getRuntimeSurface } from '../platform/runtime';
import { EDIT_PATH, WELCOME_PATH } from './paths';
import { WelcomeRoute } from './WelcomeRoute';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * The configured startup home for a bare `/` or an unknown path. The "Show
 * welcome on startup" preference is a synchronously-readable routing choice — the
 * welcome screen (the default) or straight into Edit.
 *
 * Note there is deliberately **no** guard on the workspace routes: every surface
 * stands on its own (Edit and Design/box-pleat self-provision their documents,
 * the Design chooser establishes itself, TreeMaker opens an empty tree, Simulate
 * shows its own empty state), so a cold reload / deep link into any workspace is
 * always honored rather than bounced.
 */
export function startupHomePath(): string {
  const showWelcome = readBoolean(storageKey(STORAGE_KEYS.showWelcomeOnStartup), true);
  return showWelcome ? WELCOME_PATH : EDIT_PATH;
}

/** Where a cold start (`/`) or an unmatched path lands. */
function startupRedirect() {
  return redirect(startupHomePath());
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
        {
          element: <WorkspaceShell />,
          children: [
            { path: 'design', element: <WorkspaceRoute workspace="design" variant="nux" /> },
            {
              path: 'design/treemaker',
              element: <WorkspaceRoute workspace="design" variant="treemaker" />,
            },
            { path: 'design/bp', element: <WorkspaceRoute workspace="design" variant="box-pleat" /> },
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
