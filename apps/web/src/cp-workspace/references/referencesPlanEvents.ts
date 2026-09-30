import { ANALYTICS_EVENTS, bucketCount, COUNT_BUCKETS, DURATION_MS_BUCKETS, track } from '../../analytics';
import type { ReferencesPlanSummary } from '../../store/workspaceStore/types';
import type { ReferencesPlanRecord } from './referencesResults';
import { cardsWithWays } from './referencesWays';

/**
 * The analytics event a breakdown ends in — one of `folding steps completed`,
 * `refused` or `cancelled` — with bucketed counts only, never a fold count or
 * a coordinate (`docs/analytics.md`). A run that produced no plan at all is
 * `refused`, which is the fact worth knowing: it means the workspace had
 * nothing to offer for this pattern; `refusal_reason` says why, and a plan
 * that stopped rather than approximate more lines than a sequence can carry
 * is a refusal too (`too_many_approximations`), because its reader got no
 * sequence either.
 *
 * React-free so the mapping from outcome to event can be tested on its own.
 */
export function trackPlan(
  record: ReferencesPlanRecord,
  summary: ReferencesPlanSummary | null,
  aborted: boolean
): void {
  const duration_bucket = bucketCount(Math.round(record.durationMs), DURATION_MS_BUCKETS);
  if (!summary) {
    track(ANALYTICS_EVENTS.foldingStepsRefused, {
      target_kind: 'whole_cp',
      refusal_reason: 'non_rectangular',
      duration_bucket,
    });
    return;
  }
  const properties = {
    target_kind: 'whole_cp' as const,
    lines_bucket: bucketCount(summary.cpLines, COUNT_BUCKETS),
    aux_bucket: bucketCount(summary.aux, COUNT_BUCKETS),
    visible_aux_bucket: bucketCount(summary.visibleAux, COUNT_BUCKETS),
    duration_bucket,
    exactness_class: summary.exactnessClass ?? 'exact',
    // The whole architecture of the schedule was chosen on this number, so it
    // is the one to watch: a median of 4 was what the corpus predicted.
    turn_overs_bucket: bucketCount(summary.turnOvers, COUNT_BUCKETS),
    mixed_steps_bucket: bucketCount(summary.mixedSteps, COUNT_BUCKETS),
    // Whether the design was pleated on a grid at all, and how big the grid
    // was — the share of real designs the grid-first opening applies to.
    grid_kind: summary.gridKind ?? 'none',
    grid_lines_bucket: bucketCount(summary.gridLines, COUNT_BUCKETS),
    // How the grid was made — one pleat per family, or pleats plus bands —
    // and how much crease it put where the pattern has none, in tenths of a
    // sheet-length: the number "only where needed" exists to lower.
    grid_steps_bucket: bucketCount(summary.gridSteps, COUNT_BUCKETS),
    grid_unwanted_bucket: bucketCount(
      Math.round(summary.gridUnwantedLength * 10),
      COUNT_BUCKETS
    ),
    // How much crease the steps made past the pattern's own to end at
    // references, in tenths of a sheet-length: the cost of the reach rule,
    // and of "Allow dangling folds" being off on top of it — which is why
    // the setting the plan was made under goes with it.
    reach_bucket: bucketCount(Math.round(summary.reachLength * 10), COUNT_BUCKETS),
    dangling_folds: record.allowDanglingFolds ? ('allowed' as const) : ('disallowed' as const),
    // Whether mirrored folds were shown as one card, and how many cards that
    // saved — bucketed, like every count here.
    symmetric_steps: record.mergeSymmetricSteps ? ('merged' as const) : ('separate' as const),
    // How many cards offer another way to fold them: against `references ways
    // explored`, how often readers take up a choice they were given.
    cards_with_ways_bucket: bucketCount(
      record.components.reduce((n, entry) => n + cardsWithWays(entry.plain.sequence), 0),
      COUNT_BUCKETS
    ),
  };
  if (aborted) {
    track(ANALYTICS_EVENTS.foldingStepsCancelled, properties);
    return;
  }
  const refusal = REFUSAL_REASONS[summary.stopReason];
  if (refusal) {
    track(ANALYTICS_EVENTS.foldingStepsRefused, { ...properties, refusal_reason: refusal });
    return;
  }
  track(ANALYTICS_EVENTS.foldingStepsCompleted, properties);
}

/** Which stop reasons are refusals, and what to call them. */
const REFUSAL_REASONS: Readonly<
  Record<string, 'non_rectangular' | 'point_cap' | 'budget' | 'too_many_approximations'>
> = {
  refused_sheet: 'non_rectangular',
  point_cap: 'point_cap',
  budget: 'budget',
  too_many_approximations: 'too_many_approximations',
};
