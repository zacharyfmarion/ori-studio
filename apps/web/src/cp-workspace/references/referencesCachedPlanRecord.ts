/**
 * A plan out of the plan cache (`referencesPlanCache.ts`) as the record a
 * freshly planned sheet becomes: what References puts on screen when it
 * restores a sheet, and what the Diagram's References browser draws its
 * cards from (D20). One body for both, so a card pulled into a diagram is the
 * card References shows.
 *
 * Pure: no store, no worker.
 */
import { rfToModel } from './referenceFinderStepInModel';
import type { ReferencesCachedPlan, ReferencesPlanCacheKey } from './referencesPlanCache';
import { decodePlanModel, planModelPoints } from './referencesPlanGeometry';
import type { ReferencesPlanComponent, ReferencesPlanRecord, ReferencesPlanVariant } from './referencesResults';
import type { PrecreaseSequence } from './precreaseSequence';
import type { PrecreaseFrame } from './sheetFrames';

/**
 * A sequence with its geometry mapped into model space, in this thread:
 * `rfToModel` is the arithmetic of the frame's `rf_to_model`
 * (`crates/oristudio-precrease/src/frame.rs`), which the worker's
 * `rfToModelMany` runs in Rust.
 */
export function planVariantInModel(sequence: PrecreaseSequence, frame: PrecreaseFrame): ReferencesPlanVariant {
  const points = planModelPoints(sequence);
  const mapped = new Float64Array(points.length);
  for (let index = 0; index < points.length; index += 2) {
    const [x, y] = rfToModel(frame, [points[index]!, points[index + 1]!]);
    mapped[index] = x;
    mapped[index + 1] = y;
  }
  return { sequence, model: decodePlanModel(sequence, mapped) };
}

/**
 * The one-sheet record of a cached plan: its sheet's component id and the
 * revision it is shown at are the reader's, the rest is the plan's. The
 * variants are given, mapped into model space by whoever has the means —
 * References through its worker, anyone else by {@link planVariantInModel}.
 */
export function cachedPlanRecord(
  plan: ReferencesCachedPlan,
  key: ReferencesPlanCacheKey,
  sheet: number,
  revision: string,
  variants: { plain: ReferencesPlanVariant; hoisted: ReferencesPlanVariant }
): ReferencesPlanRecord {
  const component: ReferencesPlanComponent = {
    component: sheet,
    result: {
      ...plan.result,
      computedAtRevision: revision,
      component: sheet,
      info: { ...plan.result.info, component: sheet },
      sequence: variants.plain.sequence,
    },
    frame: key.sheet.frame,
    plain: variants.plain,
    hoisted: variants.hoisted,
    cacheKey: key,
  };
  return {
    revision,
    components: [component],
    refused: [],
    durationMs: plan.durationMs,
    ...key.settings,
  };
}
