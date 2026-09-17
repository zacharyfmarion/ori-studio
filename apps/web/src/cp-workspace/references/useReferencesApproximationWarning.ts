import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReferencesPlanSummary } from '../../store/workspaceStore/types';

/**
 * Whether the approximation warning is up, and for which plan.
 *
 * A precreasing sequence with an inexact step — a line folded by the closest
 * construction there was rather than an exact one, or a step sighted from
 * such a line — says so on the card and in the summary strip, which is easy
 * to read past. A pattern that came out of Detect CP from Image can be a hair
 * off its lattice everywhere, and then every reference the sequence builds is
 * approximate; the reader should hear that once, up front, and have to dismiss
 * it.
 *
 * Once per plan: the summary object is replaced on every run, so its identity
 * is the key. A plan with no inexact steps, a dismissed warning, or the same
 * plan re-rendered never re-opens it; a new plan with inexact steps does. No
 * plan (the document changed, the plan was cleared) closes it.
 */
export interface ReferencesApproximationWarning {
  open: boolean;
  /** Steps of the plan that are not exact — what the warning is about. */
  inexactSteps: number;
  exactnessClass: ReferencesPlanSummary['exactnessClass'];
  dismiss: () => void;
}

export function useReferencesApproximationWarning(
  summary: ReferencesPlanSummary | null
): ReferencesApproximationWarning {
  const [shownFor, setShownFor] = useState<ReferencesPlanSummary | null>(null);
  const warnedRef = useRef<ReferencesPlanSummary | null>(null);

  useEffect(() => {
    if (summary === warnedRef.current) return;
    warnedRef.current = summary;
    setShownFor(summary !== null && summary.inexactSteps > 0 ? summary : null);
  }, [summary]);

  const dismiss = useCallback(() => setShownFor(null), []);

  return {
    open: shownFor !== null,
    inexactSteps: shownFor?.inexactSteps ?? 0,
    exactnessClass: shownFor?.exactnessClass ?? null,
    dismiss,
  };
}
