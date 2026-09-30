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
} from './diagram/plannerDiagram';
import { unitFrame } from './diagram/diagramFrames';
import type { Diagram } from './referenceFinder/solution';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import {
  candidateStepDiagram,
  candidateViewSteps,
  describeCandidateStep,
  diagonalStepDiagram,
  type RfSheet,
} from './referencesCandidateSteps';
import type { PrecreasePlanStopReason } from './precreasePlan';
import type { PrecreaseSequence, PrecreaseStep } from './precreaseSequence';
import type { ReferencesCandidateResult, ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import { describePlannerStep } from './referencesStepSentences';
import { cardWays, type ReferencesCardWays } from './referencesWays';

/** One card: a picture and the sentence under the strip when it is active. */
export interface ReferencesFilmstripStep {
  key: string;
  /**
   * What the card is. `fold` is numbered; the other two are steps the folder
   * performs but does not crease, and they carry a badge instead so the strip
   * does not read as a numbered run with unexplained gaps in it.
   */
  kind: 'fold' | 'turn-over' | 'done';
  /**
   * The badge on a card: what a card that is not a fold is, or what a fold
   * needs the reader to know before the sentence (approximate, a grid pleat).
   * Empty for an ordinary exact fold.
   */
  badge: string;
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
  /**
   * How many ways the card can be folded and which one it shows, when it
   * offers more than one (`referencesWays`); null otherwise.
   */
  ways: ReferencesCardWays | null;
}

/**
 * The active candidate's steps, from the empty square: the sheet's diagonals
 * it leans on first — folded corner onto corner, drawn from primitives of our
 * own — then one card per diagram of ReferenceFinder's, the core's own
 * picture with a sentence for everything it introduces
 * (`referencesCandidateSteps`). `sheet` is the paper in ReferenceFinder's
 * units, for the diagonal cards.
 */
export function candidateFilmstrip(
  t: TFunction,
  candidate: ReferencesCandidateResult | null,
  sheet: RfSheet
): ReferencesFilmstripStep[] {
  if (!candidate) return [];
  return candidateViewSteps(candidate.solution).map((step, number) =>
    step.kind === 'diagonal'
      ? {
          key: `diagonal-${step.diagonal}`,
          kind: 'fold' as const,
          badge: '',
          number: number + 1,
          diagram: null,
          primitives: diagonalStepDiagram(step.diagonal, sheet),
          mirrored: false,
          sentence: describeCandidateStep(t, candidate.solution, step, sheet),
          ways: null,
        }
      : {
          key: `rf-${step.steps[0] ?? 'final'}`,
          kind: 'fold' as const,
          badge: '',
          number: number + 1,
          diagram: candidateStepDiagram(candidate.raw, step),
          primitives: null,
          mirrored: false,
          sentence: describeCandidateStep(t, candidate.solution, step, sheet),
          ways: null,
        }
  );
}

/**
 * The last card's badge and sentence: what the plan reached, and why it ended
 * there. A plan that stopped short used to end on "Finished — every crease is
 * made" whatever had happened, which read as the planner's verdict on a
 * pattern it had barely started; the reader has to be told the run was
 * stopped, ran out of ideas, or hit a cap, and how much of the pattern that
 * left. `made` and `total` are the sheet's CP lines folded and the distinct
 * lines it has off the outline (`totals.lower_bound`).
 */
export function planEndingCard(
  t: TFunction,
  stopReason: PrecreasePlanStopReason,
  totals: PrecreaseSequence['totals']
): { badge: string; sentence: string } {
  const counts = { made: totals.cp_lines, total: totals.lower_bound };
  switch (stopReason) {
    case 'complete':
      return {
        badge: t('panels:references.flip.doneBadge', 'Finished'),
        sentence: t(
          'panels:references.flip.finished',
          'Every crease is made. The pattern collapses from here, and the creases it wants the other way reverse as it does.'
        ),
      };
    case 'aborted':
      return {
        badge: t('panels:references.flip.stoppedBadge', 'Stopped'),
        sentence: t(
          'panels:references.flip.stopped',
          'Stopped here at your request, with {{made}} of {{total}} creases made. Recompute starts the plan over.',
          counts
        ),
      };
    case 'unsolved':
      return {
        badge: t('panels:references.flip.incompleteBadge', 'Incomplete'),
        sentence: t(
          'panels:references.flip.unsolved',
          '{{made}} of {{total}} creases are made. The rest have no construction the planner could find; they are listed under the cards.',
          counts
        ),
      };
    case 'point_cap':
      return {
        badge: t('panels:references.flip.stoppedBadge', 'Stopped'),
        sentence: t(
          'panels:references.flip.pointCap',
          'The plan stopped at the planner\'s point cap, with {{made}} of {{total}} creases made.',
          counts
        ),
      };
    case 'budget':
      return {
        badge: t('panels:references.flip.stoppedBadge', 'Stopped'),
        sentence: t(
          'panels:references.flip.outOfTime',
          'The plan ran out of time, with {{made}} of {{total}} creases made.',
          counts
        ),
      };
    case 'refused_sheet':
      return {
        badge: t('panels:references.flip.stoppedBadge', 'Stopped'),
        sentence: t(
          'panels:references.flip.refused',
          'This sheet could not be planned; the notes under the cards say why.'
        ),
      };
    case 'too_many_approximations':
      return {
        badge: t('panels:references.flip.stoppedBadge', 'Stopped'),
        sentence: t(
          'panels:references.flip.tooManyApproximations',
          'Planning stopped with {{made}} of {{total}} creases made: the rest have no exact construction, and folding them by references would take more reference creases than a sequence can carry.',
          counts
        ),
      };
  }
}

/**
 * A fold card's picture, drawn once per step object. A card draws its own
 * step (and twin) over the creases made before it, and a way the reader
 * chooses changes only what its own step presents — the steps it leaves
 * alone keep their identity (`presentedSequence`) — so a switch redraws one
 * card, not the strip.
 */
const cardPictures = new WeakMap<
  PrecreaseStep,
  { twin: PrecreaseStep | undefined; model: StepDiagramModel | null }
>();

function cardPicture(
  sequence: PrecreaseSequence,
  index: number,
  twin: number | undefined
): StepDiagramModel | null {
  const step = sequence.steps[index];
  const twinStep = twin === undefined ? undefined : sequence.steps[twin];
  const cached = step ? cardPictures.get(step) : undefined;
  if (cached && cached.twin === twinStep) return cached.model;
  const model = plannerStepDiagram(sequence, unitFrame(sequence), index, { twin });
  if (step) cardPictures.set(step, { twin: twinStep, model });
  return model;
}

/**
 * The planner's steps for the sheet being read, plus the turn-overs between
 * them and the pattern as the plan left it at the end.
 *
 * `stopReasons` is why each sheet's run ended, in `variants` order — the last
 * card is worded by it (`planEndingCard`).
 *
 * The ref index is built once per variant rather than per step: it is a scan of
 * the whole sequence, and doing it inside the map would make the strip
 * quadratic.
 */
export function planFilmstrip(
  t: TFunction,
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  stopReasons: readonly PrecreasePlanStopReason[]
): ReferencesFilmstripStep[] {
  let folds = 0;
  return viewSteps.flatMap((view, viewIndex): ReferencesFilmstripStep[] => {
    const variant = variants[view.component];
    if (!variant) return [];
    const sequence = variant.sequence;
    switch (view.kind) {
      case 'fold': {
        folds += 1;
        // A step that is not exact — folded by the closest construction there
        // was, or sighted from one — wears it on the card, not only in the
        // sentence: the folder reads the strip before the sentence. A grid
        // step is exact by construction (a pleat sights nothing), so the two
        // badges never compete.
        const step = sequence.steps[view.step];
        const badge =
          step?.kind === 'grid'
            ? t('panels:references.planStep.gridBadge', 'Grid')
            : (step?.exact ?? true)
              ? ''
              : t('panels:references.planStep.approximateBadge', 'Approximate');
        return [
          {
            key: `plan-${view.component}-${view.step}`,
            kind: 'fold',
            badge,
            number: folds,
            diagram: null,
            primitives: cardPicture(sequence, view.step, view.twin),
            mirrored: view.side === 'back',
            sentence: describePlannerStep(t, sequence, view.step, view.twin),
            ways: cardWays(step),
          },
        ];
      }
      case 'turn-over':
        return [
          {
            // A sequence turns the paper over a handful of times, so the key
            // has to name the card and not just the sheet.
            key: `turn-over-${view.component}-${viewIndex}`,
            kind: 'turn-over',
            badge: t('panels:references.flip.turnOverBadge', 'Turn over'),
            number: null,
            diagram: null,
            primitives: plannerTurnOverDiagram(sequence, unitFrame(sequence), view.after),
            mirrored: view.side === 'back',
            sentence: t('panels:references.flip.turnOver', 'Turn the paper over, left to right.'),
            ways: null,
          },
        ];
      case 'done': {
        const ending = planEndingCard(t, stopReasons[view.component] ?? 'complete', sequence.totals);
        return [
          {
            key: `done-${view.component}`,
            kind: 'done',
            badge: ending.badge,
            number: null,
            diagram: null,
            primitives: plannerFinishedDiagram(sequence, unitFrame(sequence)),
            mirrored: false,
            sentence: ending.sentence,
            ways: null,
          },
        ];
      }
    }
  });
}
