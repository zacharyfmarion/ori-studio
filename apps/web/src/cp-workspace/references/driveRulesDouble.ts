/**
 * A stand-in for the crate's `drive::next_action`, for unit tests that have no
 * wasm.
 *
 * **This is a second copy of the rules, and a second copy of rules is the exact
 * defect the shared `next_action` exists to remove.** It is here only because
 * `precreasePlan.test.ts` drives the planning loop against a hand-built fake
 * with no WebAssembly in the process, and a loop cannot be exercised without
 * something telling it what to do next.
 *
 * What makes it safe is that it is checked, not trusted:
 * `precreasePlan.wasm.test.ts` runs every combination of inputs through this
 * and through the real planner and asserts they agree. If the crate's rules
 * change and this does not, that test goes red — which is the whole point, and
 * is why nothing outside a test may import this.
 */
import type {
  PrecreaseDriverState,
  PrecreasePlanAction,
  PrecreaseStopReason,
} from './precreaseSequence';

/** What the plan itself says — the crate's `drive::PlanState`. */
export interface DoublePlanState {
  refused: boolean;
  complete: boolean;
  point_cap_hit: boolean;
  /** More lines remain than the plan may fold as approximations. */
  approximations_exceed_cap: boolean;
}

const stop = (reason: PrecreaseStopReason): PrecreasePlanAction => ({ kind: 'stop', reason });

/** Approximate the next line, unless more are left than a sequence can carry that way. */
const approximateOrStop = (plan: DoublePlanState): PrecreasePlanAction =>
  plan.approximations_exceed_cap ? stop('too_many_approximations') : { kind: 'approximate' };

export function nextActionDouble(
  plan: DoublePlanState,
  driver: PrecreaseDriverState
): PrecreasePlanAction {
  if (plan.refused) return stop('refused_sheet');
  if (driver.aborted) return stop('aborted');
  if (plan.point_cap_hit) return stop('point_cap');

  switch (driver.last.kind) {
    case 'nothing':
      return { kind: 'close' };
    case 'closed':
      if (plan.complete) return stop('complete');
      if (driver.last.stalled || driver.out_of_time) return stop('budget');
      return { kind: 'stuck_search' };
    case 'searched':
      if (driver.last.found) return { kind: 'close' };
      if (!driver.reference_finder) return stop('unsolved');
      if (driver.out_of_time) return stop('budget');
      if (driver.rf_events >= driver.max_rf_events) {
        return driver.approximate ? approximateOrStop(plan) : stop('budget');
      }
      return { kind: 'ask_reference_finder' };
    case 'asked_reference_finder':
      if (driver.last.folded) return { kind: 'close' };
      if (!driver.approximate) return stop('unsolved');
      if (driver.out_of_time) return stop('budget');
      return approximateOrStop(plan);
    case 'approximated':
      if (!driver.last.folded) return stop('unsolved');
      if (!driver.approximate) return stop('unsolved');
      if (driver.out_of_time) return stop('budget');
      return { kind: 'close' };
  }
}
