import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { applyWindowTitle, formatWindowTitle } from '../platform/windowTitle';
import { sitePageTitle } from '../site/sitePageLabels';
import { sitePageForPath } from '../site/sitePages';

/**
 * Title a site page — the landing, `/download/` and their siblings — from the registry.
 *
 * Split from {@link useWindowTitle}, which names documents and so reads the workspace
 * store: these pages render without the workspace, so this runs from `RootLayout`, and
 * `useWindowTitle` leaves them to it. The title is the page's `t()` title, in the language
 * the route put the app in — the same string the prerender wrote into that file's
 * `<title>`, so the render pass Google indexes agrees with the bytes it crawled.
 */
export function useSitePageTitle(): void {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const match = sitePageForPath(pathname);
  const pageTitle = match ? sitePageTitle(t, match.page.id) : undefined;

  useEffect(() => {
    if (pageTitle === undefined) return;
    void applyWindowTitle(formatWindowTitle({ projectTitle: '', dirty: false, pageTitle }));
  }, [pageTitle]);
}
