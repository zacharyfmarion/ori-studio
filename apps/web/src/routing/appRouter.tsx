import { createBrowserRouter, createMemoryRouter, redirect } from 'react-router-dom';
import App from '../App';
import { getRuntimeSurface } from '../platform/runtime';
import { WELCOME_PATH } from './paths';

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
      children: [
        { index: true, loader: () => redirect(WELCOME_PATH) },
        { path: 'welcome', element: null },
        { path: 'design', element: null },
        { path: 'design/treemaker', element: null },
        { path: 'design/bp', element: null },
        { path: 'edit', element: null },
        { path: 'simulate', element: null },
        { path: '*', loader: () => redirect(WELCOME_PATH) },
      ],
    },
  ];

  if (getRuntimeSurface() === 'desktop') {
    return createMemoryRouter(routes, { initialEntries: [WELCOME_PATH] });
  }

  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return createBrowserRouter(routes, { basename });
}
