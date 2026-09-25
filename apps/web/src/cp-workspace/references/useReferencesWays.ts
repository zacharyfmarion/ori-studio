import { useCallback, useMemo } from 'react';
import { useReferencesWaysExploredEvent, type ReferencesWaysVisitCard } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import {
  cardWays,
  stepWays,
  wayKey,
  withWayChoice,
  type ReferencesCardWays,
} from './referencesWays';

export interface ReferencesWaysController {
  /** How many ways the active card offers and which it shows; null for a card with one. */
  active: ReferencesCardWays | null;
  previousWay: () => void;
  nextWay: () => void;
}

/**
 * The active card's other ways to fold it and the verbs that switch them,
 * bound to the store (`ReferencesView.planWays`), for the strip's switcher,
 * the keymap and the context menu alike — and the analytics that read which
 * picks readers overrule.
 *
 * `variants` are the plan as presented (`useReferencesBreakdown`), so the
 * active step already shows the chosen way; `plan` is the record they came
 * from, whose identity is the plan's. `reading` is false outside the
 * sequence, where no card offers ways.
 */
export function useReferencesWays(
  plan: object | null,
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  activeStep: number,
  reading: boolean
): ReferencesWaysController {
  const choices = useWorkspaceStore((state) => state.referencesView.planWays);
  const setReferencesView = useWorkspaceStore((state) => state.setReferencesView);
  const view = reading ? viewSteps[activeStep] : undefined;
  const fold = view?.kind === 'fold' ? view : null;
  const step = fold ? variants[fold.component]?.sequence.steps[fold.step] : undefined;
  const ways = cardWays(step);
  const count = ways?.count ?? 0;
  const index = ways?.index ?? 0;
  const active = useMemo(() => (count > 0 ? { count, index } : null), [count, index]);

  const choose = useCallback(
    (index: number) => {
      if (!fold || !step) return;
      const next = withWayChoice(choices, fold.component, step, index);
      if (next !== choices) setReferencesView({ planWays: next });
    },
    [fold, step, choices, setReferencesView]
  );
  const previousWay = useCallback(() => {
    if (active && active.index > 0) choose(active.index - 1);
  }, [active, choose]);
  const nextWay = useCallback(() => {
    if (active && active.index < active.count - 1) choose(active.index + 1);
  }, [active, choose]);

  const card = useMemo<ReferencesWaysVisitCard | null>(() => {
    if (!fold || !step || !active) return null;
    return {
      key: wayKey(fold.component, step),
      index: active.index,
      ways: stepWays(step).map((way) => ({ kind: way.kind, decidedBy: way.decided_by ?? null })),
      stepKind: step.kind === 'aux' || step.kind === 'press' ? step.kind : 'cp',
      twin: fold.twin !== undefined,
    };
  }, [fold, step, active]);
  useReferencesWaysExploredEvent({ plan, card });

  return { active, previousWay, nextWay };
}
