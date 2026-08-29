/**
 * A sentence for every way an exact solve can end.
 *
 * The solver's `rejection_reasons` are nine snake_case tokens written for a
 * replay harness — `unmodeled_crossings_worsened` is precise and tells a user
 * nothing. Each one here gets a sentence that says what happened *and*, where
 * there is one, what to do about it, because a refusal the user cannot act on is
 * the same as no refusal at all.
 *
 * The table is exhaustive over {@link CpExactSolveReason} by type — a tenth
 * token added to the union without a sentence here is a compile error, not a
 * blank chip.
 *
 * Kept beside the solve rather than in `i18n/enumLabels.ts` for the same reason
 * `cpCheckClassLabel` is kept beside the check filter: these words only mean
 * anything next to this one flow, and one table shared by the chip and any
 * future dialog beats two that drift. Move it if a third, unrelated surface
 * needs it.
 */
import type { TFunction } from 'i18next';
import type { CpExactSolveReason, CpExactSolveStage } from './cpExactSolveTypes';

/** The progress line for a stage. Two, because the solver has exactly two. */
export function cpExactSolveStageLabel(t: TFunction, stage: CpExactSolveStage): string {
  return stage === 'geometry'
    ? t('panels:cpExactSolve.stage.geometry', 'Solving geometry')
    : t('panels:cpExactSolve.stage.refinement', 'Refining to fold precision');
}

/**
 * What a stage is expected to cost, as a hint under the progress line.
 *
 * Worth saying because the two waits are an order of magnitude apart and neither
 * is what the other's spinner implies: geometry is sub-second to a couple of
 * seconds, refinement is seconds to tens of seconds and is where nearly all the
 * time goes.
 */
export function cpExactSolveStageHint(t: TFunction, stage: CpExactSolveStage): string {
  return stage === 'geometry'
    ? t('panels:cpExactSolve.hint.geometry', 'Usually under a second.')
    : t('panels:cpExactSolve.hint.refinement', 'This is most of the wait — up to about 25 seconds.');
}

export function cpExactSolveReasonLabel(t: TFunction, reason: CpExactSolveReason): string {
  switch (reason) {
    // --- Preflight: the input was refused before any solve ran. -------------
    case 'preflight_degenerate_edges':
      return t(
        'panels:cpExactSolve.reason.degenerateEdges',
        'A crease has both ends at the same point, so the solve could not start. Delete it, or move one end away, and try again.'
      );
    case 'preflight_boundary_failures':
      return t(
        'panels:cpExactSolve.reason.boundaryBroken',
        'The edge of the paper is not a closed square, so the solve could not start. Repair the boundary and try again.'
      );

    // --- Acceptance gate: a solve ran and its answer was not kept. ----------
    // Every one of these ends "so it was not applied", because that is the fact
    // the user most needs and the one the document silently hides: on any
    // non-acceptance the solver returns the coordinates it was given, so nothing
    // moved and there is nothing to undo.
    case 'candidate_status_failed':
      return t(
        'panels:cpExactSolve.reason.stillNotFoldable',
        'The answer still breaks a foldability condition, so it was not applied. Work through the remaining markers and solve again.'
      );
    case 'movement_budget_exceeded':
      return t(
        'panels:cpExactSolve.reason.movedTooFar',
        'Making the pattern exact would move a vertex further than the solver is allowed to, so it was not applied. An edit is probably far from where the crease actually lies.'
      );
    case 'odd_degree_vertices_worsened':
      return t(
        'panels:cpExactSolve.reason.oddDegreeWorse',
        'The answer left more vertices with an odd number of creases than it started with, so it was not applied.'
      );
    case 'degenerate_edges_worsened':
      return t(
        'panels:cpExactSolve.reason.degenerateWorse',
        'The answer collapsed a crease to zero length, so it was not applied.'
      );
    case 'unmodeled_crossings_worsened':
      return t(
        'panels:cpExactSolve.reason.crossingsWorse',
        'The answer left creases crossing with no vertex where they meet, so it was not applied. Add the missing vertices and solve again.'
      );
    case 'boundary_failures_worsened':
      return t(
        'panels:cpExactSolve.reason.boundaryWorse',
        'The answer pushed a vertex off the edge of the paper, so it was not applied.'
      );
    case 'objective_not_improved':
      return t(
        'panels:cpExactSolve.reason.noImprovement',
        'The solver could not improve on the pattern it was given, so nothing was applied. The topology most likely still needs repair.'
      );

    // --- The two endings the solver writes no token for. --------------------
    case 'timeout':
      return t(
        'panels:cpExactSolve.reason.timeout',
        'The solve ran out of time. You can take how far it got, or repair more of the pattern and try again.'
      );
    case 'malformed_input':
      return t(
        'panels:cpExactSolve.reason.malformedInput',
        'The saved solver data does not match this crease pattern, so the solve could not run.'
      );
  }
}
