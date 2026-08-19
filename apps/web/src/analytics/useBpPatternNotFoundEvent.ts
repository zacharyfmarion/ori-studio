import { useEffect, useRef } from 'react';
import type { OristudioBpStretch } from '../engine/oristudioBpTypes';
import { BP_PATTERNLESS_STRETCH_BUCKETS, COUNT_BUCKETS, bucketCount } from './events';
import { track } from './runtime';

/** Whether the failing stretches got as far as a layout configuration. */
type ConfigurationReach = 'none' | 'partial' | 'all';

function configurationReach(stretches: OristudioBpStretch[]): ConfigurationReach {
  const withConfig = stretches.filter((stretch) => (stretch.configCount ?? 0) > 0).length;
  if (withConfig === 0) return 'none';
  return withConfig === stretches.length ? 'all' : 'partial';
}

/**
 * Emit `bp pattern not found` when a packing first shows a stretch with no
 * crease pattern, and again whenever *which* stretches those are changes.
 *
 * Fired from the view that renders the warning rather than from a store
 * subscription, so it tracks what the user was actually shown.
 *
 * The stretch ids are used only as a local change key. They are flap ids joined
 * with commas — design structure — so they are never sent; the event carries
 * bucketed counts and one enum, per the privacy contract in `docs/analytics.md`.
 */
export function useBpPatternNotFoundEvent(stretches: OristudioBpStretch[]): void {
  const lastKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const patternless = stretches.filter((stretch) => stretch.patternFound === false);
    const key = patternless.map((stretch) => stretch.id).join('|');
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (patternless.length === 0) return;
    track('bp pattern not found', {
      stretch_count_bucket: bucketCount(patternless.length, BP_PATTERNLESS_STRETCH_BUCKETS),
      max_flap_count_bucket: bucketCount(
        Math.max(...patternless.map((stretch) => stretch.flapIds.length)),
        COUNT_BUCKETS,
      ),
      configuration_reach: configurationReach(patternless),
    });
  }, [stretches]);
}
