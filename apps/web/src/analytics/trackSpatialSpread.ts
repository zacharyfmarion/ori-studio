import { ANALYTICS_EVENTS } from './events';
import { track } from './runtime';

/** Edit's property toggle bypasses menu dispatch. No geometry or raw amount. */
export function trackSpatialSpreadChanged(enabled: boolean): void {
  track(ANALYTICS_EVENTS.spatialSpreadChanged, {
    state: enabled ? 'on' : 'off',
    via: 'properties',
  });
}
