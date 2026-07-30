/**
 * Watching for a lesson's *action* step to be satisfied.
 *
 * Some lessons ask the user to do something rather than draw something — fold
 * the pattern, or repair it until the diagnostics come back clean. Those steps
 * name a predicate over app state instead of a target pattern.
 *
 * Kept separate from `useLessonCheck` because the two answer different
 * questions: one compares geometry, this one observes that a thing happened.
 */
import { useEffect } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useTutorialStore } from '../../store/tutorialStore';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import type { LessonActionStep, LessonStatePredicate } from '../types';

/** Whether the app state satisfies a predicate. Pure, so it is unit-testable. */
export function evaluateLessonPredicate(
  predicate: LessonStatePredicate,
  state: Pick<WorkspaceState, 'oristudioCpFoldedFigures' | 'oristudioCpCamvResult'>
): boolean {
  switch (predicate) {
    case 'folded-figure-exists':
      return state.oristudioCpFoldedFigures.length > 0;
    case 'camv-clean': {
      const result = state.oristudioCpCamvResult;
      // No result yet means the check has not run — "not yet known" rather than
      // "clean", so an unchecked pattern never satisfies the step by default.
      if (!result) return false;
      // Only `diagnostic_entries` are violations. `diagnostics` is a summary
      // that is populated either way — a clean pattern still reports
      // "Check CAMV found 0 issue(s)" — so requiring it to be empty made this
      // predicate impossible to satisfy and the lesson impossible to finish.
      return (result.diagnostic_entries ?? []).length === 0;
    }
  }
}

/** Report whether `step`'s predicate currently holds. */
export function useLessonAction(step: LessonActionStep | null): boolean {
  const foldedFigures = useWorkspaceStore((state) => state.oristudioCpFoldedFigures);
  const camvResult = useWorkspaceStore((state) => state.oristudioCpCamvResult);
  const reportStepResult = useTutorialStore((state) => state.reportStepResult);

  const expect = step?.expect;
  const satisfied = expect
    ? evaluateLessonPredicate(expect, {
        oristudioCpFoldedFigures: foldedFigures,
        oristudioCpCamvResult: camvResult,
      })
    : false;

  useEffect(() => {
    if (!expect) return;
    reportStepResult(satisfied, null);
  }, [expect, reportStepResult, satisfied]);

  return satisfied;
}
