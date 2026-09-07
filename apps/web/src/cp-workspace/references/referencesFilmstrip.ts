/**
 * The step strip's rows, from either source.
 *
 * The workspace has two kinds of sequence — ReferenceFinder's answer for one
 * picked vertex or crease, and the planner's breakdown of a whole sheet — and
 * they arrive in different shapes: RF ships a diagram per step and its own
 * labelled sentence, the planner ships witnesses that we draw and describe
 * ourselves, and the planner's list also carries the turn-overs and the
 * finished pattern (`referencesSequenceView.ts`). The strip should not know any
 * of that.
 * This flattens it all into one list of numbered cards.
 */
import type { TFunction } from 'i18next';
import {
  plannerFinishedDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerStepToPrimitives';
import type { Diagram } from './referenceFinder/solution';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { stepDiagram } from './referenceFinderDiagramToPrimitives';
import type { ReferencesCandidateResult, ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import { describePlannerStep, describeStep, plannerRefIndex } from './referencesStepSentences';

/** One card: a picture and the sentence under the strip when it is active. */
export interface ReferencesFilmstripStep {
  key: string;
  /**
   * What the card is numbered.
   *
   * Null for a step that is not a fold — turning the paper over is part of the
   * sequence but it is not a crease, and numbering it would inflate the count
   * the summary states.
   */
  number: number | null;
  /** ReferenceFinder's own diagram, when this step came from one. */
  diagram: Diagram | null;
  /** Primitives we built, when it came from the planner. */
  primitives: StepDiagramModel | null;
  /** The card draws the paper's back, as the view does on that side. */
  mirrored: boolean;
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
    mirrored: false,
    sentence: describeStep(t, step),
  }));
}

/**
 * The planner's steps for the sheet being read, plus the turn-overs between
 * them and the finished pattern at the end.
 *
 * The ref index is built once per variant rather than per step: it is a scan of
 * the whole sequence, and doing it inside the map would make the strip
 * quadratic.
 */
export function planFilmstrip(
  t: TFunction,
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[]
): ReferencesFilmstripStep[] {
  const indexes = variants.map((variant) => plannerRefIndex(variant.sequence));
  let folds = 0;
  return viewSteps.flatMap((view, viewIndex): ReferencesFilmstripStep[] => {
    const variant = variants[view.component];
    if (!variant) return [];
    const sequence = variant.sequence;
    switch (view.kind) {
      case 'fold': {
        const index = indexes[view.component];
        if (!index) return [];
        folds += 1;
        return [
          {
            key: `plan-${view.component}-${view.step}`,
            number: folds,
            diagram: null,
            primitives: plannerStepDiagram(sequence, view.step),
            mirrored: view.side === 'back',
            sentence: describePlannerStep(t, sequence, index, view.step),
          },
        ];
      }
      case 'turn-over':
        return [
          {
            // A sequence turns the paper over a handful of times, so the key
            // has to name the card and not just the sheet.
            key: `turn-over-${view.component}-${viewIndex}`,
            number: null,
            diagram: null,
            primitives: plannerTurnOverDiagram(sequence, view.after),
            mirrored: view.side === 'back',
            sentence: t('panels:references.flip.turnOver', 'Turn the paper over, left to right.'),
          },
        ];
      case 'done':
        return [
          {
            key: `done-${view.component}`,
            number: null,
            diagram: null,
            primitives: plannerFinishedDiagram(sequence),
            mirrored: false,
            sentence: t(
              'panels:references.flip.finished',
              'Every crease is made. The pattern collapses from here, and the creases it wants the other way reverse as it does.'
            ),
          },
        ];
    }
  });
}
