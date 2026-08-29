/**
 * What an *accepted* exact solve actually achieved, in the sentence a user can
 * act on.
 *
 * # Why "accepted" is not "solved"
 *
 * Three different bars decide what the user sees, and they are ~1,000x apart:
 *
 * | bar | value | who holds it |
 * | --- | --- | --- |
 * | acceptance gate | movement / degeneracy / crossings | keep the answer at all |
 * | `solved_kawasaki_epsilon_degrees` | **1e-3°** | the solver calls it `Solved` |
 * | `Epsilon::FLAT` | **1e-6°** | the editor's foldability check |
 *
 * So an accepted solve can be a genuine 1,900x improvement and still leave every
 * foldability marker standing. That is not hypothetical: on the file this module
 * was written for, Kawasaki went 14.367° -> 0.00747°, the solver returned
 * `Ambiguous`, and all 70 "Incorrect angles" markers survived — while the UI said
 * "Solved". {@link classifyCpExactSolve} now separates acceptance from exactness;
 * this separates exactness from *passing the check the user is looking at*.
 *
 * # The four endings, and why the odd-degree one comes first
 *
 * `analyze_graph` computes a Kawasaki residual only for even fans of degree >= 4,
 * so an odd-degree vertex contributes **nothing** to `max_kawasaki_residual_degrees`.
 * A pattern can therefore report a beautiful angle residual while carrying
 * vertices that can never fold flat at any coordinates. Ordering the sentences by
 * angle would then congratulate the user on a pattern that is structurally
 * unfoldable, which is why {@link cpSolveCompletion} tests the topology first and
 * why the detail sentence leads with it.
 *
 * # Two questions, two predicates
 *
 * Surfaces need both and they are not the same question:
 *
 * - {@link cpSolveMeetsFoldabilityCheck} — will the editor's markers clear? This
 *   is what the *wording and the tone* follow, because it is what the user is
 *   about to see with their own eyes.
 * - {@link cpSolveIsExactVerdict} — did the solver call the answer exact? This is
 *   what *button emphasis* follows, because accepting or re-running is a decision
 *   about the solver's answer, and second-guessing its own verdict here would be
 *   a second acceptance policy living in the UI.
 */
import type { TFunction } from 'i18next';

import { cpExactSolveReasonLabel } from '../../engine/cpExactSolveMessages';
import type {
  CpExactSolveAcceptedOutcome,
  CpExactSolveResiduals,
} from '../../engine/cpExactSolveTypes';

/**
 * The bar the editor's own flat-foldability check holds a vertex fan to, in
 * degrees.
 *
 * Oriedita's `Epsilon::FLAT` — `FACTOR * 1E-4`, i.e. `0.01 * 1e-4` — which
 * `checks.rs` compares an angle difference in degrees against. Spelled here
 * because it is the number the *user's* verdict depends on, and it is three
 * orders of magnitude below the solver's own `solved_kawasaki_epsilon_degrees`
 * of 1e-3. Reusing the solver's epsilon instead is precisely the conflation this
 * module exists to undo.
 */
export const CP_FOLDABILITY_CHECK_EPSILON_DEGREES = 1e-6;

/**
 * How far an accepted solve got, in the four endings that need different
 * sentences.
 *
 * - `exact` — the solver called it solved and the residual is at or below the
 *   check's own bar. The only ending that may claim the pattern is done.
 * - `approximate` — the solver called it solved, but the measured residual is
 *   above the check's bar, so markers can survive. Rare, and the honest reading
 *   of the 1e-3 / 1e-6 gap rather than a failure.
 * - `improved` — accepted and better, not exact; the topology is clean, so the
 *   remaining error is angles alone.
 * - `unfoldable` — accepted and better, and vertices with an odd number of
 *   creases remain. No amount of solving clears those.
 */
export type CpSolveCompletion = 'exact' | 'approximate' | 'improved' | 'unfoldable';

/** The completion plus the numbers behind it, which every sentence needs. */
export interface CpSolveCompletionFacts {
  completion: CpSolveCompletion;
  /** The solver's own before/after figures, or null when it reported none. */
  residuals: CpExactSolveResiduals | null;
}

/**
 * Read an accepted outcome into one of the four endings.
 *
 * With no residuals there is nothing to qualify the solver's verdict with, so
 * this falls back to that verdict alone — `exact` for `solved`, `improved` for
 * `ambiguous`. It never invents a tier the numbers would not support, and it
 * never fills the missing figures with zeroes: `0` is what a *perfect* solve
 * reports, so a zeroed-in blank reads as the best possible outcome.
 */
export function cpSolveCompletion(outcome: CpExactSolveAcceptedOutcome): CpSolveCompletion {
  const residuals = outcome.residuals;
  if (!residuals) return outcome.kind === 'solved' ? 'exact' : 'improved';
  // Topology first: an odd fan is skipped by the Kawasaki pass entirely, so the
  // angle number below says nothing about it.
  if (residuals.oddDegreeVerticesAfter > 0) return 'unfoldable';
  if (outcome.kind !== 'solved') return 'improved';
  return residuals.maxKawasakiDegreesAfter <= CP_FOLDABILITY_CHECK_EPSILON_DEGREES
    ? 'exact'
    : 'approximate';
}

/** Facts in the shape the surfaces hold them, from one accepted outcome. */
export function cpSolveCompletionFacts(
  outcome: CpExactSolveAcceptedOutcome
): CpSolveCompletionFacts {
  return { completion: cpSolveCompletion(outcome), residuals: outcome.residuals };
}

/**
 * Whether the pattern will now pass the editor's foldability check.
 *
 * The predicate the **wording and the tone** follow. Only `exact` may be shown
 * as success; the other three all leave markers on screen, and a green "Solved"
 * over them tells the user the checker is broken.
 */
export function cpSolveMeetsFoldabilityCheck(completion: CpSolveCompletion): boolean {
  return completion === 'exact';
}

/**
 * Whether the **solver** called its answer exact.
 *
 * The predicate **button emphasis** follows. `approximate` is on this side of
 * the line on purpose: the solver accepted it as solved and found no topology to
 * repair, so pushing the user back into the repair flow would be inventing work
 * that does not exist. What it must not do is claim the check passed — that is
 * {@link cpSolveMeetsFoldabilityCheck}'s answer, and it is no.
 */
export function cpSolveIsExactVerdict(completion: CpSolveCompletion): boolean {
  return completion === 'exact' || completion === 'approximate';
}

/**
 * An angle in degrees, at a precision that neither lies nor prints noise.
 *
 * The values span eight orders of magnitude in one sentence — 14.367° before and
 * 0.00747° after — so a fixed decimal count is either "14.4° to 0.0°" or
 * "14.36700° to 0.00747°". This keeps roughly two significant figures by scaling
 * the decimals to the magnitude, and never falls into exponent notation, which
 * reads as an error message in a sentence about geometry.
 */
export function formatSolveAngleDegrees(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  // Below the last decimal this prints, "0" is the honest rendering rather than a
  // row of zeroes that reads as a bug.
  if (value < 1e-9) return '0';
  const decimals = Math.min(9, Math.max(1, -Math.floor(Math.log10(value))));
  return value.toFixed(decimals);
}

/** The one-line result, for a toast title or a heading. */
export function cpSolveCompletionHeadline(t: TFunction, completion: CpSolveCompletion): string {
  switch (completion) {
    case 'exact':
      return t('panels:cpRegion.completion.exact', 'Solved');
    case 'approximate':
      return t(
        'panels:cpRegion.completion.approximate',
        'Solved, though not to foldability-check precision'
      );
    case 'improved':
      return t('panels:cpRegion.completion.improved', 'Improved, but not foldable yet');
    case 'unfoldable':
      return t(
        'panels:cpRegion.completion.unfoldable',
        'Improved, but this pattern cannot fold flat'
      );
  }
}

/**
 * What changed, in numbers.
 *
 * With no figures to quote this defers to `above_fold_precision` in
 * `cpExactSolveMessages` — the one shared table of solver sentences — rather
 * than writing a second wordless version of the same idea here. So the rule is
 * simply: **numbers when the solver reported them, the shared sentence when it
 * did not.**
 */
export function cpSolveCompletionDetail(t: TFunction, facts: CpSolveCompletionFacts): string {
  const { completion, residuals } = facts;
  if (completion === 'exact') {
    return t(
      'panels:cpRegion.completion.exactDetail',
      'The pattern now meets the foldability check.'
    );
  }
  if (!residuals) return cpExactSolveReasonLabel(t, 'above_fold_precision');

  const angles = t('panels:cpRegion.completion.angleDetail', {
    before: formatSolveAngleDegrees(residuals.maxKawasakiDegreesBefore),
    after: formatSolveAngleDegrees(residuals.maxKawasakiDegreesAfter),
    bar: formatSolveAngleDegrees(CP_FOLDABILITY_CHECK_EPSILON_DEGREES),
    defaultValue:
      'The worst angle error went from {{before}}° to {{after}}°, and the check needs it below {{bar}}°.',
  });
  if (completion !== 'unfoldable') return angles;

  // Leading, not appended: this is the cause the user can act on, and it is true
  // of the graph rather than of where its vertices happen to sit — so it survives
  // any re-solve, which the angle number does not.
  const odd = t('panels:cpRegion.completion.oddDegreeDetail', {
    count: residuals.oddDegreeVerticesAfter,
    defaultValue_one:
      '1 vertex still has an odd number of creases, so this pattern cannot fold flat no matter where the vertices sit.',
    defaultValue_other:
      '{{count}} vertices still have an odd number of creases, so this pattern cannot fold flat no matter where the vertices sit.',
  });
  return `${odd} ${angles}`;
}

/** How many vertices the solve moved, and how far, for the surfaces that show it. */
export interface CpSolveMovement {
  movedVertices: number;
  maxMovementPx: number;
}

/**
 * The compact status line, for a chip that cannot wrap.
 *
 * Each ending leads with the fact that decides what to do next, and the full
 * {@link cpSolveCompletionDetail} goes in the element's `title`. The moved-vertex
 * count is only shown for `exact`: everywhere else "45 vertices moved" is the
 * least useful true thing available, because the question is no longer how much
 * moved but whether it was enough.
 */
export function cpSolveCompletionChipLine(
  t: TFunction,
  state: CpSolveCompletionFacts & CpSolveMovement
): string {
  const { completion, residuals } = state;
  if (completion === 'exact') {
    return t('panels:cpRegion.solved', {
      count: state.movedVertices,
      // Rounded **up**, so the sentence stays true: a 0.42 px worst case reads
      // "< 1 px", never "< 0.4 px" that a later measurement could contradict.
      max: Math.max(1, Math.ceil(state.maxMovementPx)),
      defaultValue_one: 'Solved · 1 vertex moved < {{max}} px',
      defaultValue_other: 'Solved · {{count}} vertices moved < {{max}} px',
    });
  }
  if (completion === 'unfoldable' && residuals) {
    return t('panels:cpRegion.solvedUnfoldable', {
      count: residuals.oddDegreeVerticesAfter,
      defaultValue_one: 'Not foldable · 1 vertex to repair',
      defaultValue_other: 'Not foldable · {{count}} vertices to repair',
    });
  }
  if (residuals) {
    return t('panels:cpRegion.solvedImproved', {
      before: formatSolveAngleDegrees(residuals.maxKawasakiDegreesBefore),
      after: formatSolveAngleDegrees(residuals.maxKawasakiDegreesAfter),
      defaultValue: 'Improved · worst angle {{before}}° → {{after}}°',
    });
  }
  return t('panels:cpRegion.solvedNotExact', 'Improved · not foldable yet');
}
