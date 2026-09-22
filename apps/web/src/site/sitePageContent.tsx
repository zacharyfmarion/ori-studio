import type { ComponentType } from 'react';
import { StaticLanding } from '../seo/StaticLanding';
import { DownloadPage } from './pages/DownloadPage';
import { FaqPage } from './pages/FaqPage';
import { GettingStartedPage } from './pages/GettingStartedPage';
import { OrieditaPage } from './pages/OrieditaPage';
import type { SitePageId } from './sitePages';

/**
 * What each site page renders — the same component for the crawler copy and the live
 * route, so the two cannot describe the page differently.
 *
 * The `Record` is the guard: a page added to `SITE_PAGES` with no entry here fails to
 * compile, which is the whole reason the components are keyed by id rather than listed
 * beside the metadata (that, and keeping `sitePages.ts` free of markup for the modules
 * that only need the paths).
 *
 * The landing is the one entry the router does not use. Its live route is `WelcomeRoute`
 * — the start screen and the drop target, with the landing below — and `StaticLanding`
 * is only the part of that a crawler should see.
 */
export const SITE_PAGE_CONTENT: Record<SitePageId, ComponentType> = {
  landing: StaticLanding,
  'getting-started': GettingStartedPage,
  download: DownloadPage,
  oriedita: OrieditaPage,
  faq: FaqPage,
};
