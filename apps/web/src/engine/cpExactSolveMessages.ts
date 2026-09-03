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
import type {
  CpExactSolveCandidateFindings,
  CpExactSolveReason,
  CpExactSolveStage,
} from './cpExactSolveTypes';

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

/**
 * `candidate` is what a refused answer would have broken, for the one token
 * that does not say — `candidate_status_failed` — and is ignored for the rest.
 */
export function cpExactSolveReasonLabel(
  t: TFunction,
  reason: CpExactSolveReason,
  candidate: CpExactSolveCandidateFindings | null = null
): string {
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
      return candidateStatusFailedLabel(t, candidate);
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

    // --- The three endings the solver writes no token for. ------------------
    // `above_fold_precision` is the odd one out: the solve was *accepted*, so
    // this sentence must not say "it was not applied" the way the gate reasons
    // above do. What it says instead is the fact the user cannot see — the
    // pattern moved and still fails the same checks — and the one action that
    // changes that.
    case 'above_fold_precision':
      return t(
        'panels:cpExactSolve.reason.aboveFoldPrecision',
        'The solve moved the creases much closer to foldable, but not close enough for the pattern to pass the foldability check. Repair the remaining markers — a vertex with an odd number of creases can never be solved, only fixed — and solve again.'
      );
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

/**
 * `candidate_status_failed` is the solver's verdict on its own answer: the
 * geometry it computed would break one of four conditions, or bring the angles
 * no closer, so it handed back the coordinates it was given. None of the four
 * is drawn as a marker — they are true of an answer that was never applied,
 * not of the pattern on screen — so the sentence names the one it was. It used
 * to send the user to "the remaining markers", over a region the editor was
 * showing as clean.
 */
function candidateStatusFailedLabel(
  t: TFunction,
  candidate: CpExactSolveCandidateFindings | null
): string {
  if (candidate && candidate.unmodeledCrossings > 0) {
    return t('panels:cpExactSolve.reason.answerCrossings', {
      count: candidate.unmodeledCrossings,
      defaultValue_one:
        'In the solver’s answer 1 pair of creases would cross with no vertex where they meet, so it was not applied and nothing moved. Add a vertex at that crossing, or move the creases apart, and solve again.',
      defaultValue_other:
        'In the solver’s answer {{count}} pairs of creases would cross with no vertex where they meet, so it was not applied and nothing moved. Add a vertex at each crossing, or move the creases apart, and solve again.',
    });
  }
  if (candidate && candidate.degenerateEdges > 0) {
    return t('panels:cpExactSolve.reason.answerCollapsed', {
      count: candidate.degenerateEdges,
      defaultValue_one:
        'The solver’s answer would collapse 1 crease to zero length, so it was not applied and nothing moved. Its two ends are probably one vertex; merge them and solve again.',
      defaultValue_other:
        'The solver’s answer would collapse {{count}} creases to zero length, so it was not applied and nothing moved. Their ends are probably single vertices; merge them and solve again.',
    });
  }
  if (candidate && candidate.boundaryFailures > 0) {
    return t('panels:cpExactSolve.reason.answerOffPaper', {
      count: candidate.boundaryFailures,
      defaultValue_one:
        'The solver’s answer would push 1 vertex off the edge of the paper, so it was not applied and nothing moved.',
      defaultValue_other:
        'The solver’s answer would push {{count}} vertices off the edge of the paper, so it was not applied and nothing moved.',
    });
  }
  if (candidate?.movedOverBudget) {
    return t(
      'panels:cpExactSolve.reason.answerMovedTooFar',
      'The solver’s answer would move a vertex further than it is allowed to, so it was not applied and nothing moved. An edit is probably far from where the crease actually lies.'
    );
  }
  if (candidate?.improvedAngles === false) {
    return t(
      'panels:cpExactSolve.reason.answerNoCloser',
      'The solver’s answer brought the angles no closer to foldable, so it was not applied and nothing moved. The topology most likely still needs repair.'
    );
  }
  return t(
    'panels:cpExactSolve.reason.stillNotFoldable',
    'The solver’s answer would still break a foldability condition, so it was not applied and nothing moved. That is a property of the answer rather than of the pattern as drawn, so there may be no marker for it; adjust the creases near the last edit and solve again.'
  );
}
