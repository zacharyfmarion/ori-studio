/**
 * Every step the strip shows, as pages to export at once.
 *
 * The same per-step reading the big view makes — `planHighlights` for a card of
 * the precreasing sequence, `candidateStepDiagram` for a step of a Find
 * candidate — asked of each card in turn, so the ZIP holds exactly the pages
 * the reader could have exported one by one. A card with no picture of its own
 * (the finished pattern) has no page.
 */
import type { ReferencesSheetAux } from './referencesAuxCreases';
import { candidateViewSteps, clampCandidateStep } from './referencesCandidateSteps';
import type { ReferencesPlanVariant, ReferencesResults } from './referencesResults';
import { sideAt, type ReferencesViewStep } from './referencesSequenceView';
import { referencesSequenceSubject, type ReferencesStepExportSubject } from './referencesStepExport';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { candidateStepDiagram, planHighlights } from './useReferencesView';

/** One step's page, captured: the diagram, the face it is read on, and the card it is. */
export interface ReferencesExportStep {
  diagram: StepDiagramModel;
  mirrored: boolean;
  subject: ReferencesStepExportSubject;
  /** The card's place in the strip, which counts the cards with no page too. */
  card: number;
}

/** What the strip is showing: the precreasing sequence, or one Find candidate's steps. */
export type ReferencesStepsSource =
  | {
      kind: 'sequence';
      variants: readonly ReferencesPlanVariant[];
      viewSteps: readonly ReferencesViewStep[];
      sheetAux: ReferencesSheetAux | null;
      activeStep: number;
    }
  | { kind: 'find'; results: ReferencesResults | null; candidate: number; activeStep: number }
  | { kind: 'none' };

/** The strip's pages, and which of them is the card on show — or the nearest before it with a page. */
export interface ReferencesExportSteps {
  steps: ReferencesExportStep[];
  current: number;
}

/** Every card of the precreasing sequence that has a picture, in the strip's order. */
export function planExportSteps(
  variants: readonly ReferencesPlanVariant[],
  viewSteps: readonly ReferencesViewStep[],
  sheetAux: ReferencesSheetAux | null
): ReferencesExportStep[] {
  const steps: ReferencesExportStep[] = [];
  for (let card = 0; card < viewSteps.length; card += 1) {
    const { pageDiagram } = planHighlights(variants, viewSteps, card, null, sheetAux);
    if (!pageDiagram) continue;
    steps.push({
      diagram: pageDiagram,
      mirrored: sideAt(viewSteps, card) === 'back',
      subject: referencesSequenceSubject(viewSteps, card),
      card,
    });
  }
  return steps;
}

/** Every step of one Find candidate, in the strip's order. */
export function candidateExportSteps(
  results: ReferencesResults,
  candidateIndex: number
): ReferencesExportStep[] {
  const candidate = results.candidates[candidateIndex];
  if (!candidate) return [];
  const steps: ReferencesExportStep[] = [];
  candidateViewSteps(candidate.solution).forEach((step, card) => {
    const diagram = candidateStepDiagram(candidate, results, step);
    if (!diagram) return;
    steps.push({
      diagram,
      mirrored: false,
      subject: { kind: 'reference', candidate: candidateIndex, step: card },
      card,
    });
  });
  return steps;
}

/** The strip's pages for whatever it is showing. */
export function referencesExportSteps(source: ReferencesStepsSource): ReferencesExportSteps {
  if (source.kind === 'none') return { steps: [], current: 0 };
  let steps: ReferencesExportStep[];
  let card: number;
  if (source.kind === 'sequence') {
    steps = planExportSteps(source.variants, source.viewSteps, source.sheetAux);
    card = source.activeStep;
  } else {
    const { results } = source;
    // The candidate the view falls back to when the index is out of range.
    const index = results?.candidates[source.candidate] ? source.candidate : 0;
    const candidate = results?.candidates[index];
    steps = results && candidate ? candidateExportSteps(results, index) : [];
    card = clampCandidateStep(candidate?.solution ?? null, source.activeStep);
  }
  let current = 0;
  steps.forEach((step, index) => {
    if (step.card <= card) current = index;
  });
  return { steps, current };
}
