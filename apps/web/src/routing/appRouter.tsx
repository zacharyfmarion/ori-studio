import { createBrowserRouter, createMemoryRouter, redirect } from 'react-router-dom';
import { RouteErrorElement } from '../components/errors/RouteErrorElement';
import { readBoolean, storageKey, STORAGE_KEYS } from '../lib/storage';
import { getRuntimeSurface } from '../platform/runtime';
import { SiteLocaleRoute } from '../site/SiteLocaleRoute';
import { SitePageRoute } from '../site/SitePageRoute';
import { CONTENT_PAGES, routeSegment, SITE_LOCALES } from '../site/sitePages';
import { DESIGN_PATH, EDIT_PATH, LEGACY_DESIGN_PATHS, WELCOME_PATH } from './paths';
import { RootLayout } from './RootLayout';
import { WelcomeRoute } from './WelcomeRoute';
import { loadWorkspace } from './workspaceGateway';
import { WorkspaceRoute } from './WorkspaceRoute';

/**
 * The configured startup home for a bare `/` or an unknown path. The "Show
 * welcome on startup" preference is a synchronously-readable routing choice — the
 * welcome screen (the default) or straight into Edit.
 *
 * Every device answers it the same way. A phone used to be forced to `/welcome`
 * whatever the preference said, because the workspaces were closed to it; they
 * are not any more.
 */
export function startupHomePath(): string {
  const showWelcome = readBoolean(storageKey(STORAGE_KEYS.showWelcomeOnStartup), true);
  return showWelcome ? WELCOME_PATH : EDIT_PATH;
}

/** Where a cold start (`/`) or an unmatched path lands. */
function startupRedirect() {
  return redirect(startupHomePath());
}

/*
 * The workspace routes have **no guard at all**, and that is deliberate twice
 * over.
 *
 * There is no provisioning guard because every surface stands on its own — Edit
 * and Design/box-pleat self-provision their documents, the Design chooser
 * establishes itself, TreeMaker opens an empty tree, Simulate shows its own
 * empty state — so a cold reload or a deep link into any workspace is honored
 * rather than bounced.
 *
 * And there is no longer a device gate. A phone was redirected to `/welcome`
 * however it got pointed at a workspace: a deep link, a bookmark, a shared URL.
 * The touch work removed the reason, so a shared link now opens what it names.
 */

type AppRouter = ReturnType<typeof createBrowserRouter>;

// The routes that need the workspace load it through the gateway, which makes the
// workspace one chunk no matter which of them asks first.
async function shareRoute() {
  return { Component: (await loadWorkspace()).ShareRoute };
}

async function workspaceShellRoute() {
  return { Component: (await loadWorkspace()).WorkspaceShellRoute };
}

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
  const desktop = getRuntimeSurface() === 'desktop';
  const routes = [
    {
      path: '/',
      element: <RootLayout />,
      // Router-caught errors (loaders, and render throws inside route elements)
      // never reach a React error boundary, so the route tree needs its own.
      errorElement: <RouteErrorElement />,
      children: [
        { index: true, loader: startupRedirect },
        { path: 'welcome', element: <WelcomeRoute /> },
        // The site's content pages — `/download/` and its siblings — built from the
        // registry, so a page the prerender writes a file for is a page the router
        // knows. Without a route the crawler is fine (Pages serves the file) and a
        // reader is not: React boots, nothing matches, and the catch-all below
        // bounces them to the start screen. Web only: the same `dist` ships inside
        // Tauri, where a download page is nonsense and the footer that would link
        // to it renders nothing.
        ...(desktop
          ? []
          : [
              ...CONTENT_PAGES.map((page) => ({
                path: routeSegment(page),
                element: <SitePageRoute page={page} />,
              })),
              // The same pages under a locale prefix — `/zh-CN/`, `/zh-CN/download/` —
              // each locale a literal segment rather than one `:locale` param, so an
              // unknown prefix falls through to the catch-all instead of needing a
              // guard. The prefixed landing is the start screen too, as `/welcome` is;
              // the URL sync and the discard guard know a site page when they see one.
              ...SITE_LOCALES.map((locale) => ({
                path: locale,
                element: <SiteLocaleRoute locale={locale} />,
                children: [
                  { index: true, element: <WelcomeRoute /> },
                  ...CONTENT_PAGES.map((page) => ({
                    path: routeSegment(page),
                    element: <SitePageRoute page={page} />,
                  })),
                ],
              })),
            ]),
        // Share links land here, stash their intent, and redirect to Edit. A real
        // route (rather than a fragment on `/edit`) so the share leaves the URL on
        // arrival and this handling never runs on a normal start.
        //
        // Both shapes: `/s/<id>` for server-stored links, and bare `/s` for the
        // original `#<payload>` fragment scheme, which must keep working.
        { path: 's', lazy: shareRoute },
        { path: 's/:shareId', lazy: shareRoute },
        {
          lazy: workspaceShellRoute,
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
            { path: 'references', element: <WorkspaceRoute workspace="references" /> },
          ],
        },
        { path: '*', loader: startupRedirect },
      ],
    },
  ];

  if (desktop) {
    // Start at the index so `startupRedirect` applies the welcome/Edit preference
    // on desktop too (there's no address bar to deep-link from).
    return createMemoryRouter(routes, { initialEntries: ['/'] });
  }

  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';
  return createBrowserRouter(routes, { basename });
}
