/**
 * Watching the user's pattern and reporting whether it matches the step's target.
 *
 * The comparison is entirely local: the store already holds the decoded
 * crease-pattern snapshot (`oristudioCpDocument.document.crease_pattern`), which
 * the compact-geometry transport keeps current on every edit. So this costs a
 * set difference over a few dozen creases and never touches the worker — nothing
 * is added to the edit critical path.
 *
 * A short debounce still applies, because a drag can commit several revisions in
 * quick succession and re-running per revision is pointless work.
 */
import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useTutorialStore } from '../../store/tutorialStore';
import { compareCreasePatterns, type ComparisonResult } from '../check/compare';
import { targetGeometry } from './targetGeometry';
import type { LessonDrawStep } from '../types';
import type { OristudioCpModel } from '../../engine/oristudioCpTypes';

const DEBOUNCE_MS = 150;

/**
 * Run `step`'s check against the live document, reporting into the tutorial
 * store and returning the detailed result for the panel to render.
 *
 * Returns null while the target is still loading.
 */
export function useLessonCheck(step: LessonDrawStep | null): ComparisonResult | null {
  const [target, setTarget] = useState<OristudioCpModel | null>(null);
  const [result, setResult] = useState<ComparisonResult | null>(null);
  const reportStepResult = useTutorialStore((state) => state.reportStepResult);

  const document = useWorkspaceStore((state) => state.oristudioCpDocument);
  const revision = useWorkspaceStore((state) => state.oristudioCpRevision);

  const targetId = step?.targetId ?? null;
  const check = step?.check;

  // Target geometry is fixed content, so it loads once per step.
  useEffect(() => {
    if (!targetId) {
      setTarget(null);
      return;
    }
    let cancelled = false;
    setTarget(null);
    void targetGeometry(targetId)
      .then((geometry) => {
        if (!cancelled) setTarget(geometry);
      })
      .catch(() => {
        // A missing or malformed target is a content bug, caught by
        // `lessons.test.ts` long before a user sees it. Leave the panel in its
        // loading state rather than showing a broken check.
      });
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const drawn = document?.document.crease_pattern ?? null;

  useEffect(() => {
    if (!check || !target || !drawn) {
      setResult(null);
      return;
    }
    const timer = setTimeout(() => {
      const comparison = compareCreasePatterns(drawn, target, check);
      setResult(comparison);
      reportStepResult(comparison.satisfied, {
        missing: comparison.missing.length,
        extra: comparison.extra.length,
        wrongAssignment: comparison.wrongAssignment.length,
        matched: comparison.matched.length,
        expected: comparison.expected,
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `revision` is the edit signal; `drawn` alone would miss an in-place
    // restore that reuses the same snapshot object.
  }, [check, target, drawn, revision, reportStepResult]);

  return result;
}
