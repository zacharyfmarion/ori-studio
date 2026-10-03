import { describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseWitness } from './precreaseSequence';
import {
  cachedPlanOf,
  comparePlanCacheKeys,
  decodeCachedPlan,
  encodeCachedPlan,
  REFERENCES_PLANNER_BUILD,
  referencesPlanCacheKey,
  referencesPlanCacheKeyId,
  samePlanSettings,
  sheetFingerprint,
  trimSequenceForCache,
} from './referencesPlanCache';

/** A transport holding `segments` (`[ax, ay, bx, by, colour]`), nothing else. */
function transportOf(segments: readonly number[][]): CpGeometryTransport {
  const segEndpoints = new Float64Array(segments.length * 4);
  const segAttr = new Int32Array(segments.length * SEG_ATTR_STRIDE);
  segments.forEach(([ax, ay, bx, by, colour], index) => {
    segEndpoints.set([ax, ay, bx, by], index * 4);
    segAttr[index * SEG_ATTR_STRIDE] = colour;
  });
  return { segEndpoints, segAttr } as CpGeometryTransport;
}

const LEFT = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const RIGHT = { minX: 20, minY: 0, maxX: 30, maxY: 10 };
/** Two sheets side by side: the right one's segments come first. */
const TWO_SHEETS = [
  [20, 0, 30, 0, 0],
  [20, 0, 30, 10, 2],
  [0, 0, 10, 0, 0],
  [0, 0, 10, 10, 1],
  [5, 0, 5, 10, 2],
];

const SETTINGS = {
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};

describe('sheetFingerprint', () => {
  it('is the same for the same creases, and ignores another sheet’s edits that renumber nothing', () => {
    const before = sheetFingerprint(transportOf(TWO_SHEETS), LEFT);
    expect(sheetFingerprint(transportOf(TWO_SHEETS), LEFT)).toBe(before);
    // The right sheet's diagonal recoloured: same indices on the left.
    const recoloured = TWO_SHEETS.map((segment, index) =>
      index === 1 ? [...segment.slice(0, 4), 1] : segment
    );
    expect(sheetFingerprint(transportOf(recoloured), LEFT)).toBe(before);
    expect(sheetFingerprint(transportOf(recoloured), RIGHT)).not.toBe(
      sheetFingerprint(transportOf(TWO_SHEETS), RIGHT)
    );
  });

  // A plan names creases by document index: deleting one crease in another
  // sheet shifts every id the left sheet's plan holds, and a fingerprint blind
  // to that would keep a plan that highlights the wrong creases.
  it('changes when an edit elsewhere renumbers the sheet’s creases', () => {
    const before = sheetFingerprint(transportOf(TWO_SHEETS), LEFT);
    expect(sheetFingerprint(transportOf(TWO_SHEETS.slice(1)), LEFT)).not.toBe(before);
  });

  it('changes when a crease of the sheet moves or changes colour', () => {
    const before = sheetFingerprint(transportOf(TWO_SHEETS), LEFT);
    const moved = TWO_SHEETS.map((segment, index) => (index === 4 ? [5.000001, 0, 5, 10, 2] : segment));
    const flipped = TWO_SHEETS.map((segment, index) => (index === 4 ? [5, 0, 5, 10, 1] : segment));
    expect(sheetFingerprint(transportOf(moved), LEFT)).not.toBe(before);
    expect(sheetFingerprint(transportOf(flipped), LEFT)).not.toBe(before);
  });

  it('counts the border creases whose ends sit on the box', () => {
    expect(sheetFingerprint(transportOf(TWO_SHEETS), LEFT)).toMatch(/^3:/);
  });
});

describe('the cache key', () => {
  const geometry = transportOf(TWO_SHEETS);

  it('says which part of it no longer matches', () => {
    const key = referencesPlanCacheKey(geometry, LEFT, SETTINGS);
    expect(comparePlanCacheKeys(key, referencesPlanCacheKey(geometry, LEFT, SETTINGS))).toBe('hit');
    expect(comparePlanCacheKeys({ ...key, planner: 'older' }, key)).toBe('planner_changed');
    expect(
      comparePlanCacheKeys(
        key,
        referencesPlanCacheKey(geometry, LEFT, { ...SETTINGS, mergeSymmetricSteps: false })
      )
    ).toBe('settings_changed');
    expect(
      comparePlanCacheKeys(key, referencesPlanCacheKey(transportOf(TWO_SHEETS.slice(1)), LEFT, SETTINGS))
    ).toBe('sheet_changed');
    expect(key.planner).toBe(REFERENCES_PLANNER_BUILD);
  });

  it('ignores "only where needed" without a grid, which says nothing then', () => {
    const off = { ...SETTINGS, precreaseGrid: false };
    expect(samePlanSettings(off, { ...off, gridWhereNeeded: false })).toBe(true);
    expect(samePlanSettings(SETTINGS, { ...SETTINGS, gridWhereNeeded: false })).toBe(false);
    expect(referencesPlanCacheKeyId(referencesPlanCacheKey(geometry, LEFT, off))).toBe(
      referencesPlanCacheKeyId(referencesPlanCacheKey(geometry, LEFT, { ...off, gridWhereNeeded: false }))
    );
  });

  it('is one string per plan', () => {
    const key = referencesPlanCacheKey(geometry, LEFT, SETTINGS);
    expect(referencesPlanCacheKeyId(key)).toBe(
      referencesPlanCacheKeyId(referencesPlanCacheKey(geometry, LEFT, SETTINGS))
    );
    expect(referencesPlanCacheKeyId(key)).not.toBe(
      referencesPlanCacheKeyId(referencesPlanCacheKey(geometry, RIGHT, SETTINGS))
    );
  });
});

function extraWitness(): PrecreaseWitness {
  return {
    axiom: 3,
    inputs: [{ kind: 'line', id: 1 }],
    root: 1,
    who_moves: [1],
    hard: true,
    visible: false,
    skinny: false,
    ease: 2,
    err: 0,
  };
}

describe('trimSequenceForCache', () => {
  it('keeps the chosen witness alone, and zeroes the clock', () => {
    const sequence = plannerSequenceFixture();
    const step = sequence.steps[1];
    const chosen = step.witnesses[0];
    sequence.steps[1] = { ...step, witnesses: [extraWitness(), chosen, extraWitness()], chosen: 1 };
    sequence.diagnostics.elapsed_ms = 1234;

    const trimmed = trimSequenceForCache(sequence);
    expect(trimmed.steps[1].witnesses).toEqual([chosen]);
    expect(trimmed.steps[1].chosen).toBe(0);
    expect(trimmed.diagnostics.elapsed_ms).toBe(0);
    // Everything else as it was, and the input untouched.
    expect(trimmed.steps[0]).toBe(sequence.steps[0]);
    expect(sequence.steps[1].witnesses).toHaveLength(3);
  });

  it('keeps a step’s other ways, which carry their own witnesses', () => {
    const sequence = plannerSequenceFixture();
    const way = { witness: extraWitness(), kind: 'O3:ll' };
    sequence.steps[1] = { ...sequence.steps[1], ways: [way, way] };
    expect(trimSequenceForCache(sequence).steps[1].ways).toEqual([way, way]);
  });
});

function result(): PrecreasePlanResult {
  const sequence = plannerSequenceFixture();
  return {
    computedAtRevision: '1:abc',
    component: 3,
    info: {
      component: 3,
      status: 'complete',
      sheet: { width: 1, height: 1 },
      exactness: null,
      refused: false,
      off_lattice: false,
      targets: 5,
      free_targets: 0,
      remaining: 0,
      point_cap: 600_000,
    },
    sequence,
    stopReason: 'complete',
    partial: false,
    approximate: [],
    rfAuxFolded: 0,
    approximated: 0,
    rfQueries: 0,
    stuckEvents: 0,
    durationMs: 812,
    landmarksFirst: false,
  };
}

describe('the payload', () => {
  it('packs a plan and reads it back as it was, trimmed', async () => {
    const plan = cachedPlanOf(result(), plannerSequenceFixture(), 900);
    expect(plan.result).not.toHaveProperty('sequence');
    expect(plan.result).not.toHaveProperty('computedAtRevision');
    const packed = await encodeCachedPlan(plan);
    expect(packed).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(await decodeCachedPlan(packed)).toEqual(plan);
  });

  // Re-saving a file must not change it: the same plan packs to the same text.
  it('packs the same plan to the same text', async () => {
    const plan = cachedPlanOf(result(), plannerSequenceFixture(), 900);
    expect(await encodeCachedPlan(plan)).toBe(await encodeCachedPlan(plan));
  });

  it('reads anything else as no plan, never an error', async () => {
    expect(await decodeCachedPlan('not base64 at all!')).toBeNull();
    expect(await decodeCachedPlan(btoa('plain text'))).toBeNull();
    const { gzipSync, strToU8 } = await import('fflate');
    const wrongShape = gzipSync(strToU8(JSON.stringify({ result: {}, plain: [], hoisted: [] })));
    expect(await decodeCachedPlan(btoa(String.fromCharCode(...wrongShape)))).toBeNull();
  });
});
