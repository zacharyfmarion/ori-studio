import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { reportError } from '../../monitoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { chooseReferencesWay } from './referencesPulledSteps';
import { referencesStepWays, type ReferencesStepWay } from './referencesStepWays';
import { useDecodedPlan, useReferencesSheets } from './useReferencesSheets';

/** A References step's ways to fold, as Pose and the Step pane offer them (D23). */
export type ReferencesStepWayChoice =
  /** Its plan is being found or read. */
  | { status: 'loading' }
  /** Its plan is not to be had any more: planned again, edited since, another file, or no crease pattern open. */
  | { status: 'unavailable' }
  | { status: 'ready'; ways: readonly ReferencesStepWay[]; current: number; choose: (index: number) => void };

/**
 * The ways a References step's card can be folded, drawn from its plan, and
 * the verb that folds it another way — or null for a step with nothing to
 * choose: not a References step, a newer build's, or a card that offered one
 * way when it was pulled (it recorded none). Asks the worker for nothing then.
 */
export function useReferencesStepWays(step: DiagramStep | null): ReferencesStepWayChoice | null {
  const { t } = useTranslation();
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const source = step && !step.unknown && step.source?.kind === 'references-step' ? step.source : null;
  const picture = step?.picture?.kind === 'step-diagram' ? step.picture : null;
  // Only a card that had ways when it was pulled recorded one; only its own plan has them.
  const wanted = source !== null && picture !== null && source.way !== undefined && source.plan !== undefined;
  const { geometry, revision, patterns } = useReferencesSheets(wanted);
  const pattern =
    wanted && patterns.status === 'ready' ? (patterns.patterns.find((entry) => entry.id === source!.plan) ?? null) : null;
  const decoded = useDecodedPlan(pattern);
  const stepId = step?.id ?? null;

  const drawn = useMemo(() => {
    if (!wanted || !pattern || !decoded?.plan || !geometry) return null;
    try {
      return referencesStepWays(t, decoded.plan, pattern, geometry, revision, source!, picture!);
    } catch (error) {
      reportError(error, { surface: 'diagram:references-ways' });
      return { status: 'none' as const };
    }
    // The step's own picture and way are what the reading is of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, pattern, decoded, geometry, revision, t, source?.line, source?.way, picture?.key, picture?.mirrored]);

  const choose = useCallback(
    (index: number) => {
      if (stepId === null || readOnly || drawn?.status !== 'ready') return;
      const way = drawn.ways[index];
      if (way) chooseReferencesWay(stepId, way);
    },
    [stepId, readOnly, drawn]
  );

  if (!wanted) return null;
  if (patterns.status === 'no-pattern' || patterns.status === 'failed') return { status: 'unavailable' };
  if (patterns.status === 'finding') return { status: 'loading' };
  if (!pattern || decoded?.plan === null) return { status: 'unavailable' };
  if (!drawn) return { status: 'loading' };
  if (drawn.status === 'none') return { status: 'unavailable' };
  return { status: 'ready', ways: drawn.ways, current: drawn.current, choose };
}
