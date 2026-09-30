import { useCallback, useMemo } from 'react';
import { useReferencesWaysExploredEvent, type ReferencesWaysVisitCard } from '../../analytics';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { PrecreaseStep } from './precreaseSequence';
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
  /**
   * Step the card at `index` of the strip one way on (1) or back (-1) — any
   * card, not only the active one: a swipe switches the card it lands on.
   */
  shiftWay: (index: number, delta: -1 | 1) => void;
}

/** A card of the strip that offers ways: its view, the step it reads, and its ways. */
interface WayCard {
  view: Extract<ReferencesViewStep, { kind: 'fold' }>;
  step: PrecreaseStep;
  ways: ReferencesCardWays;
}

function wayCard(
  variants: readonly ReferencesPlanVariant[],
  view: ReferencesViewStep | undefined
): WayCard | null {
  if (view?.kind !== 'fold') return null;
  const step = variants[view.component]?.sequence.steps[view.step];
  const ways = cardWays(step);
  return step && ways ? { view, step, ways } : null;
}

/** A card as `references ways explored` reads it. */
function visitCard({ view, step, ways }: WayCard): ReferencesWaysVisitCard {
  return {
    key: wayKey(view.component, step),
    index: ways.index,
    ways: stepWays(step).map((way) => ({ kind: way.kind, decidedBy: way.decided_by ?? null })),
    stepKind: step.kind === 'aux' || step.kind === 'press' ? step.kind : 'cp',
    twin: view.twin !== undefined,
  };
}

/**
 * The cards' other ways to fold them and the verbs that switch them, bound to
 * the store (`ReferencesView.planWays`), for the strip's switcher and swipe,
 * the keymap and the context menu alike — and the analytics that read which
 * picks readers overrule.
 *
 * `variants` are the plan as presented (`useReferencesBreakdown`), so each
 * card already shows its chosen way; `plan` is the record they came from,
 * whose identity is the plan's. `reading` is false outside the sequence,
 * where no card offers ways.
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
  const current = reading ? wayCard(variants, viewSteps[activeStep]) : null;
  const view = current?.view;
  const step = current?.step;
  const count = current?.ways.count ?? 0;
  const index = current?.ways.index ?? 0;
  const active = useMemo(() => (count > 0 ? { count, index } : null), [count, index]);

  const card = useMemo(
    () => (view && step && active ? visitCard({ view, step, ways: active }) : null),
    [view, step, active]
  );
  const arrive = useReferencesWaysExploredEvent({ plan, card });

  const shiftWay = useCallback(
    (at: number, delta: -1 | 1) => {
      const target = reading ? wayCard(variants, viewSteps[at]) : null;
      if (!target) return;
      const next = withWayChoice(choices, target.view.component, target.step, target.ways.index + delta);
      if (next === choices) return;
      // A card switched from elsewhere is selected and switched in one render,
      // which never shows it as it stood: the visit starts from here instead.
      if (at !== activeStep) arrive(visitCard(target));
      setReferencesView({ planWays: next });
    },
    [reading, variants, viewSteps, choices, activeStep, arrive, setReferencesView]
  );
  const previousWay = useCallback(() => shiftWay(activeStep, -1), [shiftWay, activeStep]);
  const nextWay = useCallback(() => shiftWay(activeStep, 1), [shiftWay, activeStep]);

  return { active, previousWay, nextWay, shiftWay };
}
