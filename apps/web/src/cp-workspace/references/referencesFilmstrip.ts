/**
 * The step strip's rows, from either source.
 *
 * The workspace has two kinds of sequence — ReferenceFinder's answer for one
 * picked vertex or crease, and the planner's breakdown of a whole sheet — and
 * they arrive in different shapes: RF ships a diagram per step and its own
 * labelled sentence, the planner ships witnesses that we draw and describe
 * ourselves, and the planner's list also carries the two flips and the finished
 * pattern (`referencesSequenceView.ts`). The strip should not know any of that.
 * This flattens it all into one list of numbered cards.
 */
import type { TFunction } from 'i18next';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import {
  plannerFinishedDiagram,
  plannerReverseDiagram,
  plannerStepDiagram,
  plannerTurnOverDiagram,
} from './plannerStepToPrimitives';
import type { Diagram } from './referenceFinder/solution';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { stepDiagram } from './referenceFinderDiagramToPrimitives';
import { creaseDirection, sequenceDirections } from './referencesFoldDirection';
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
 * The planner's steps for the sheet being read, plus the closing flips.
 *
 * The ref index and the direction list are built once per variant rather than
 * per step: each is a scan of the whole sequence, and doing either inside the
 * map would make the strip quadratic.
 */
export function planFilmstrip(
  t: TFunction,
  geometry: CpGeometryTransport | null,
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[]
): ReferencesFilmstripStep[] {
  const indexes = variants.map((variant) => plannerRefIndex(variant.sequence));
  const directions = variants.map((variant) =>
    geometry ? sequenceDirections(geometry, variant.sequence) : []
  );
  let folds = 0;
  return viewSteps.flatMap((view): ReferencesFilmstripStep[] => {
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
            primitives: plannerStepDiagram(sequence, view.step, {
              directions: directions[view.component],
            }),
            sentence: describePlannerStep(t, sequence, index, view.step),
          },
        ];
      }
      case 'turn-over':
        return [
          {
            key: `turn-over-${view.component}`,
            number: null,
            diagram: null,
            primitives: plannerTurnOverDiagram(sequence),
            sentence: t(
              'panels:references.flip.turnOver',
              'Turn the paper over, left to right.'
            ),
          },
        ];
      case 'reverse': {
        const reversed = new Set<number>();
        sequence.steps.forEach((step, index) => {
          if (!geometry) return;
          if (step.cp_line_ids.some((id) => creaseDirection(geometry, id) === 'mountain')) {
            reversed.add(index);
          }
        });
        return [
          {
            key: `reverse-${view.component}`,
            number: null,
            diagram: null,
            primitives: plannerReverseDiagram(sequence, reversed),
            sentence: t('panels:references.flip.reverse', {
              defaultValue_one:
                'Reverse {{count}} crease so it becomes a mountain from the front. From this side it folds towards you, like every other crease here.',
              defaultValue_other:
                'Reverse {{count}} creases so they become mountains from the front. From this side they fold towards you, like every other crease here.',
              count: view.lineIds.length,
            }),
          },
        ];
      }
      case 'done':
        return [
          {
            key: `done-${view.component}`,
            number: null,
            diagram: null,
            primitives: plannerFinishedDiagram(sequence, directions[view.component] ?? []),
            sentence: t(
              'panels:references.flip.finished',
              'Turn the paper back over. The crease pattern is complete, mountains and valleys as drawn.'
            ),
          },
        ];
    }
  });
}
