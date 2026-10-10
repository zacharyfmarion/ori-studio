import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import { cachedPlanRecord, planVariantInModel } from './referencesCachedPlanRecord';
import type { ReferencesCachedPlan, ReferencesPlanCacheKey } from './referencesPlanCache';
import type { PrecreaseFrame } from './sheetFrames';

/** A sheet 20 wide and 10 tall, its unit frame flipped and moved, as a pattern's sheet is. */
const FRAME: PrecreaseFrame = { origin: [100, 50], x_axis: [1, 0], y_axis: [0, -1], width: 20, height: 10 };
const KEY: ReferencesPlanCacheKey = {
  planner: 'oristudio-precrease/plan1',
  settings: { precreaseGrid: true, gridWhereNeeded: false, allowDanglingFolds: true, mergeSymmetricSteps: true },
  sheet: { bounds: { minX: 100, minY: 40, maxX: 120, maxY: 50 }, frame: FRAME, fingerprint: 'ps1:x' },
};

describe('planVariantInModel', () => {
  it('lays the plan’s unit sheet over the frame in model space, as the worker maps it', () => {
    const sequence = plannerSequenceFixture();
    const { model } = planVariantInModel(sequence, FRAME);
    const [x, y] = sequence.steps[0]!.segment[0];
    // Scaled by the longer side, from the origin, along the axes.
    expect(model.steps[0]!.segment.a).toEqual({ x: 100 + x * 20, y: 50 - y * 20 });
    expect(model.steps).toHaveLength(sequence.steps.length);
  });
});

describe('cachedPlanRecord', () => {
  it('is the one-sheet record a planned sheet becomes: the reader’s sheet and revision, the plan’s settings', () => {
    const sequence = plannerSequenceFixture();
    const plan = {
      result: { info: { component: 0 }, stopReason: 'complete' },
      plain: sequence,
      hoisted: sequence,
      durationMs: 42,
    } as unknown as ReferencesCachedPlan;
    const plain = planVariantInModel(sequence, FRAME);
    const record = cachedPlanRecord(plan, KEY, 3, 'rev-7', { plain, hoisted: plain });
    expect(record).toMatchObject({ revision: 'rev-7', refused: [], durationMs: 42, ...KEY.settings });
    expect(record.components).toHaveLength(1);
    expect(record.components[0]).toMatchObject({
      component: 3,
      frame: FRAME,
      cacheKey: KEY,
      result: { component: 3, computedAtRevision: 'rev-7', info: { component: 3 }, sequence },
    });
  });
});
