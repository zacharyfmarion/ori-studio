import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReferencesPlanSummary } from '../../store/workspaceStore/types';

/**
 * Why the warning is up.
 *
 * `inexact`: the plan has steps that are not exact — a line folded by the
 * closest construction there was, or sighted from one. `too_many`: the plan
 * stopped before folding any of them, because more lines would have needed
 * approximating than a sequence can carry as reference creases
 * (`too_many_approximations`); the sequence is whatever exact folds came
 * first, and may be nothing at all.
 */
export type ReferencesApproximationWarningReason = 'inexact' | 'too_many';

/**
 * Whether the approximation warning is up, and for which plan.
 *
 * A precreasing sequence with an inexact step says so on the card and in the
 * summary strip, which is easy to read past; a plan that stopped rather than
 * approximate a whole pattern has nothing on the strip to say it with. A
 * pattern that came out of Detect CP from Image can be a hair off its lattice
 * everywhere, and then every reference the sequence builds is approximate;
 * the reader should hear that once, up front, and have to dismiss it.
 *
 * Once per plan: the summary object is replaced on every run, so its identity
 * is the key. A plan with nothing to warn about, a dismissed warning, or the
 * same plan re-rendered never re-opens it; a new plan with something to warn
 * about does. No plan (the document changed, the plan was cleared) closes it.
 */
export interface ReferencesApproximationWarning {
  open: boolean;
  reason: ReferencesApproximationWarningReason;
  /** Steps of the plan that are not exact — what an `inexact` warning is about. */
  inexactSteps: number;
  exactnessClass: ReferencesPlanSummary['exactnessClass'];
  dismiss: () => void;
}

function reasonFor(summary: ReferencesPlanSummary): ReferencesApproximationWarningReason | null {
  if (summary.stopReason === 'too_many_approximations') return 'too_many';
  if (summary.inexactSteps > 0) return 'inexact';
  return null;
}

export function useReferencesApproximationWarning(
  summary: ReferencesPlanSummary | null
): ReferencesApproximationWarning {
  const [shownFor, setShownFor] = useState<ReferencesPlanSummary | null>(null);
  const warnedRef = useRef<ReferencesPlanSummary | null>(null);

  useEffect(() => {
    if (summary === warnedRef.current) return;
    warnedRef.current = summary;
    setShownFor(summary !== null && reasonFor(summary) !== null ? summary : null);
  }, [summary]);

  const dismiss = useCallback(() => setShownFor(null), []);

  return {
    open: shownFor !== null,
    reason: (shownFor && reasonFor(shownFor)) ?? 'inexact',
    inexactSteps: shownFor?.inexactSteps ?? 0,
    exactnessClass: shownFor?.exactnessClass ?? null,
    dismiss,
  };
}
