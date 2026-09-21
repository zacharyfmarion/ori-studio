import { useEffect } from 'react';
import { ANALYTICS_EVENTS, type SitePageViewedId } from './events';
import { track } from './runtime';

/**
 * Emit `site page viewed` when a content page mounts.
 *
 * Lives in the route component that renders the page, the idiomatic home for a "viewed"
 * event, and keys on the id so a client-side move between two pages — the same route
 * component with a different page — fires for the second one.
 *
 * The parameter is the analytics enum rather than `SitePageId`, which is what keeps the
 * two in step: a page added to the registry has to be added here before its route
 * compiles, rather than shipping a property value the dashboard has never seen.
 */
export function useSitePageViewedEvent(page: SitePageViewedId): void {
  useEffect(() => {
    track(ANALYTICS_EVENTS.sitePageViewed, { page });
  }, [page]);
}
