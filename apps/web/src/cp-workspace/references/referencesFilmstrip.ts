/**
 * The step strip's rows, from either source.
 *
 * The workspace has two kinds of sequence — ReferenceFinder's answer for one
 * picked vertex or crease, and the planner's breakdown of a whole sheet — and
 * they arrive in different shapes: RF ships a diagram per step and its own
 * labelled sentence, the planner ships witnesses that we draw and describe
 * ourselves. The strip should not know that. This flattens both into one list
 * of numbered cards, so the branch lives here (React-free, testable) instead of
 * inside the component that lays them out.
 */
import type { TFunction } from 'i18next';
import { plannerStepDiagram } from './plannerStepToPrimitives';
import type { Diagram } from './referenceFinder/solution';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { stepDiagram } from './referenceFinderDiagramToPrimitives';
import type { ReferencesFlatStep } from './referencesBreakdown';
import type { ReferencesCandidateResult, ReferencesPlanVariant } from './referencesResults';
import { describePlannerStep, describeStep, plannerRefIndex } from './referencesStepSentences';

/** One card: a picture and the sentence under the strip when it is active. */
export interface ReferencesFilmstripStep {
  key: string;
  /** 1-based, as shown on the card. */
  number: number;
  /** ReferenceFinder's own diagram, when this step came from one. */
  diagram: Diagram | null;
  /** Primitives we built, when it came from the planner. */
  primitives: StepDiagramModel | null;
  sentence: string;
}

/** ReferenceFinder's steps for the active candidate. */
export function candidateFilmstrip(
  t: TFunction,
  candidate: ReferencesCandidateResult | null
): ReferencesFilmstripStep[] {
  if (!candidate) return [];
  return candidate.solution.steps.map((step, index) => ({
    key: `rf-${index}`,
    number: index + 1,
    diagram: stepDiagram(candidate.raw, candidate.solution, index),
    primitives: null,
    sentence: describeStep(t, step),
  }));
}

/**
 * The planner's steps for the sheet being read.
 *
 * `flatSteps` is the list the scrubber and the chords walk, so the strip is
 * built from it rather than from a sequence directly — the two must agree about
 * what "step 4" is, and one list is how that is guaranteed. The ref index is
 * built once per variant rather than per step: it is a scan of every witness of
 * every step, and doing it inside the map would make the strip quadratic.
 */
export function planFilmstrip(
  t: TFunction,
  variants: readonly ReferencesPlanVariant[],
  flatSteps: readonly ReferencesFlatStep[]
): ReferencesFilmstripStep[] {
  const indexes = variants.map((variant) => plannerRefIndex(variant.sequence));
  return flatSteps.flatMap((flat, position) => {
    const variant = variants[flat.component];
    const index = indexes[flat.component];
    if (!variant || !index) return [];
    return [
      {
        key: `plan-${flat.component}-${flat.step}`,
        number: position + 1,
        diagram: null,
        primitives: plannerStepDiagram(variant.sequence, flat.step),
        sentence: describePlannerStep(t, variant.sequence, index, flat.step),
      },
    ];
  });
}
