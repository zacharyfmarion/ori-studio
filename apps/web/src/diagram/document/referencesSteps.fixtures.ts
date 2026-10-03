import type { TFunction } from 'i18next';
import { plannerSequenceWithGridFixture } from '../../cp-workspace/references/__fixtures__/plannerSequence';
import { flatPlanSteps } from '../../cp-workspace/references/referencesBreakdown';
import { planFilmstrip, type ReferencesFilmstripStep } from '../../cp-workspace/references/referencesFilmstrip';
import type { ReferencesPlanVariant } from '../../cp-workspace/references/referencesResults';
import {
  referencesViewSteps,
  type ReferencesViewStep,
} from '../../cp-workspace/references/referencesSequenceView';

/** English, as the inline defaults have it. */
export const englishT = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  options
    ? fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options[name] ?? ''))
    : fallback) as unknown as TFunction;

/**
 * A real plan, as the strip reads it: its variants, its view steps and its
 * cards. `backFrom` turns the paper over before that step, so the strip has a
 * turn-over and cards of the back.
 */
export function referencesPlan({ backFrom }: { backFrom?: number } = {}): {
  variants: ReferencesPlanVariant[];
  viewSteps: ReferencesViewStep[];
  strip: ReferencesFilmstripStep[];
} {
  const planned = plannerSequenceWithGridFixture();
  const sequence =
    backFrom === undefined
      ? planned
      : {
          ...planned,
          steps: planned.steps.map((step, index) =>
            index >= backFrom ? { ...step, side: 'back' as const } : step
          ),
        };
  const variants = [{ sequence } as ReferencesPlanVariant];
  const viewSteps = referencesViewSteps(
    variants,
    flatPlanSteps(variants.map((variant) => variant.sequence))
  );
  return { variants, viewSteps, strip: planFilmstrip(englishT, variants, viewSteps, ['complete']) };
}

/** The cards of {@link referencesPlan}. */
export function referencesStrip(): ReferencesFilmstripStep[] {
  return referencesPlan().strip;
}
