import { useSitePageViewedEvent } from '../analytics';
import { SITE_PAGE_CONTENT } from './sitePageContent';
import type { ContentPageId, SitePage } from './sitePages';

/**
 * The route element for a content page: the page's component, and the event that says it
 * was seen.
 *
 * Takes a content page, never the landing (see `sitePageContent.tsx`). `page.id` has to
 * be assignable to the analytics enum at the hook call, so a page the enum lacks is a
 * compile error here rather than an unrecognized property value in the dashboard.
 */
export function SitePageRoute({ page }: { page: SitePage<ContentPageId> }) {
  useSitePageViewedEvent(page.id);
  const Content = SITE_PAGE_CONTENT[page.id];
  return <Content />;
}
