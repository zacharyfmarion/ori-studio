import { ANALYTICS_EVENTS, type CommunityLinkSurface } from './events';
import { track } from './runtime';

/**
 * Record that a link out to the community Discord was followed.
 *
 * A wrapper rather than a bare `track` at the call site so the surface has to be
 * a {@link CommunityLinkSurface}: the enum is the whole taxonomy this event has,
 * and a free-form string in a component is how one becomes decorative.
 */
export function trackCommunityLink(surface: CommunityLinkSurface): void {
  track(ANALYTICS_EVENTS.communityLinkOpened, { surface });
}
