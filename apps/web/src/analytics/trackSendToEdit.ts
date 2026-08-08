import { ANALYTICS_EVENTS, bucketCount, PACKING_CIRCLE_COUNT_BUCKETS } from './events';
import type { DesignMethod } from './events';
import { track } from './runtime';

/**
 * A design's crease pattern reached the Edit canvas.
 *
 * Neither toolbar Send to Edit was instrumented before: both call a store action
 * directly rather than dispatching a `MENU_ACTION_ID`, so the `handleMenuAction`
 * chokepoint never saw them. Adding the with-circles variant is the moment to
 * fix that, because the question the variant raises — does anyone use it — is
 * unanswerable without the plain baseline beside it.
 *
 * One helper rather than two hand-rolled `track` calls so both kinds report the
 * same property shape; each slice knows its own kind and count.
 *
 * `circle_count_bucket` is bucketed and everything else is an enum, per the
 * privacy contract: no coordinates, no radii, no titles.
 */
export function trackDesignSentToEdit(input: {
  designKind: DesignMethod;
  includeCircles: boolean;
  /** How many circles actually travelled — 0 when asked for but none qualified. */
  circleCount: number;
}): void {
  track(ANALYTICS_EVENTS.designSentToEdit, {
    design_kind: input.designKind,
    include_circles: input.includeCircles,
    circle_count_bucket: bucketCount(input.circleCount, PACKING_CIRCLE_COUNT_BUCKETS),
  });
}
