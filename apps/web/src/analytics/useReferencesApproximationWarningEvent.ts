import { useEffect, useRef } from 'react';
import { ANALYTICS_EVENTS, COUNT_BUCKETS, bucketCount } from './events';
import { track } from './runtime';

export interface ReferencesApproximationWarningEventInput {
  /** The warning is on screen. */
  open: boolean;
  /** Steps of the plan that are approximate or sighted from an approximation. */
  inexactSteps: number;
  exactnessClass: 'exact' | 'snappable' | 'off_lattice' | null;
}

/**
 * Emit `references approximation warning shown` each time the warning opens.
 *
 * Fired from the dialog that shows it, so the event counts what the reader was
 * actually shown, and only on the opening: the hook that decides to open it
 * already does so once per plan, and the count and class belong to that plan.
 * The count is bucketed and the class is an enum — nothing about the folds
 * themselves (`docs/analytics.md`).
 */
export function useReferencesApproximationWarningEvent({
  open,
  inexactSteps,
  exactnessClass,
}: ReferencesApproximationWarningEventInput): void {
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      track(ANALYTICS_EVENTS.referencesApproximationWarningShown, {
        inexact_steps_bucket: bucketCount(inexactSteps, COUNT_BUCKETS),
        exactness_class: exactnessClass ?? 'exact',
      });
    }
    wasOpenRef.current = open;
  }, [open, inexactSteps, exactnessClass]);
}
