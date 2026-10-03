import { describe, expect, it } from 'vitest';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import type { PrecreasePlanResult } from './precreasePlan';
import type { PrecreaseStep, PrecreaseWitness } from './precreaseSequence';
import {
  cachedPlanOf,
  comparePlanCacheKeys,
  decodeCachedPlan,
  encodeCachedPlan,
  REFERENCES_PLAN_VERSION,
  REFERENCES_PLANNER_BUILD,
  referencesPlanCacheKey,
  referencesPlanCacheKeyId,
  samePlanSettings,
  sheetFingerprint,
  trimSequenceForCache,
  type ReferencesCachedPlan,
} from './referencesPlanCache';
import { REFERENCES_PLAN_SETTING_KEYS } from './referencesSettingsFields';
import type { PrecreaseFrame, PrecreaseInput } from './sheetFrames';

/** The planner's input for `segments` (`[ax, ay, bx, by, colour]`). */
function inputOf(segments: readonly number[][]): PrecreaseInput {
  const input = { segments: new Float64Array(segments.length * 4), colors: new Int32Array(segments.length) };
  segments.forEach(([ax, ay, bx, by, colour], index) => {
    input.segments.set([ax, ay, bx, by], index * 4);
    input.colors[index] = colour;
  });
  return input;
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

const FRAME: PrecreaseFrame = { origin: [0, 10], x_axis: [1, 0], y_axis: [0, -1], width: 10, height: 10 };
/** The diamond on the square's edge midpoints: the same box, another frame. */
const DIAMOND: PrecreaseFrame = {
  origin: [5, 10],
  x_axis: [Math.SQRT1_2, -Math.SQRT1_2],
  y_axis: [-Math.SQRT1_2, -Math.SQRT1_2],
  width: 5 * Math.SQRT2,
  height: 5 * Math.SQRT2,
};

const SETTINGS = {
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};

describe('sheetFingerprint', () => {
  it('is the same for the same creases, and ignores another sheet’s edits that renumber nothing', () => {
    const before = sheetFingerprint(inputOf(TWO_SHEETS), LEFT);
    expect(sheetFingerprint(inputOf(TWO_SHEETS), LEFT)).toBe(before);
    // The right sheet's diagonal recoloured: same indices on the left.
    const recoloured = TWO_SHEETS.map((segment, index) =>
      index === 1 ? [...segment.slice(0, 4), 1] : segment
    );
    expect(sheetFingerprint(inputOf(recoloured), LEFT)).toBe(before);
    expect(sheetFingerprint(inputOf(recoloured), RIGHT)).not.toBe(
      sheetFingerprint(inputOf(TWO_SHEETS), RIGHT)
    );
  });

  // A plan names creases by document index: deleting one crease in another
  // sheet shifts every id the left sheet's plan holds, and a fingerprint blind
  // to that would keep a plan that highlights the wrong creases.
  it('changes when an edit elsewhere renumbers the sheet’s creases', () => {
    const before = sheetFingerprint(inputOf(TWO_SHEETS), LEFT);
    expect(sheetFingerprint(inputOf(TWO_SHEETS.slice(1)), LEFT)).not.toBe(before);
  });

  it('changes when a crease of the sheet moves or changes colour', () => {
    const before = sheetFingerprint(inputOf(TWO_SHEETS), LEFT);
    const moved = TWO_SHEETS.map((segment, index) => (index === 4 ? [5.000001, 0, 5, 10, 2] : segment));
    const flipped = TWO_SHEETS.map((segment, index) => (index === 4 ? [5, 0, 5, 10, 1] : segment));
    expect(sheetFingerprint(inputOf(moved), LEFT)).not.toBe(before);
    expect(sheetFingerprint(inputOf(flipped), LEFT)).not.toBe(before);
  });

  // The planner takes a crease that overshoots a nearly rectangular border by
  // up to its SNAP_RADIUS (2e-3 of the side) as the sheet's, and names it in
  // the plan. At a millionth of slack the fingerprint did not see it, and a
  // recoloured overshoot kept the old plan, drawn the old way.
  it('sees a crease the planner counts as the sheet’s though it overshoots the border', () => {
    const overshoot = [...TWO_SHEETS, [10.015, 2, 10.015, 8, 2]];
    const before = sheetFingerprint(inputOf(overshoot), LEFT);
    const recoloured = overshoot.map((segment, index) => (index === 5 ? [10.015, 2, 10.015, 8, 1] : segment));
    expect(sheetFingerprint(inputOf(recoloured), LEFT)).not.toBe(before);
    // And nothing as far off as the next sheet.
    const far = [...TWO_SHEETS, [15, 2, 15, 8, 2]];
    const farRecoloured = [...TWO_SHEETS, [15, 2, 15, 8, 1]];
    expect(sheetFingerprint(inputOf(far), LEFT)).toBe(sheetFingerprint(inputOf(farRecoloured), LEFT));
  });

  it('names its algorithm, and goes through the shared digest', () => {
    expect(sheetFingerprint(inputOf(TWO_SHEETS), LEFT)).toMatch(/^ps1:[0-9a-f]{16}$/);
  });
});

describe('the cache key', () => {
  const input = inputOf(TWO_SHEETS);
  const left = { bounds: LEFT, frame: FRAME };

  it('names the version of plans it holds, and nothing that moves with every build', () => {
    expect(REFERENCES_PLANNER_BUILD).toBe(`oristudio-precrease/plan${REFERENCES_PLAN_VERSION}`);
  });

  it('says which part of it no longer matches', () => {
    const key = referencesPlanCacheKey(input, left, SETTINGS);
    expect(comparePlanCacheKeys(key, referencesPlanCacheKey(input, left, SETTINGS))).toBe('hit');
    expect(comparePlanCacheKeys({ ...key, planner: 'older' }, key)).toBe('planner_changed');
    expect(
      comparePlanCacheKeys(key, referencesPlanCacheKey(input, left, { ...SETTINGS, mergeSymmetricSteps: false }))
    ).toBe('settings_changed');
    expect(
      comparePlanCacheKeys(key, referencesPlanCacheKey(inputOf(TWO_SHEETS.slice(1)), left, SETTINGS))
    ).toBe('sheet_changed');
  });

  // Two sheets can share a box. The plan's coordinates are mapped through the
  // frame, so the diamond's plan shown on the square would be drawn turned.
  it('tells apart two sheets with one box by their frames', () => {
    const square = referencesPlanCacheKey(input, left, SETTINGS);
    const diamond = referencesPlanCacheKey(input, { bounds: LEFT, frame: DIAMOND }, SETTINGS);
    expect(square.sheet.fingerprint).toBe(diamond.sheet.fingerprint);
    expect(comparePlanCacheKeys(square, diamond)).toBe('sheet_changed');
    expect(referencesPlanCacheKeyId(square)).not.toBe(referencesPlanCacheKeyId(diamond));
  });

  it('keys on every setting that changes a plan, and on no other', () => {
    expect([...REFERENCES_PLAN_SETTING_KEYS].sort()).toEqual(
      ['allowDanglingFolds', 'gridWhereNeeded', 'mergeSymmetricSteps', 'precreaseGrid']
    );
    const key = referencesPlanCacheKey(input, left, {
      ...SETTINGS,
      candidateCount: 3,
      includeApproximate: true,
    } as typeof SETTINGS);
    expect(Object.keys(key.settings).sort()).toEqual([...REFERENCES_PLAN_SETTING_KEYS].sort());
  });

  it('ignores "only where needed" without a grid, which says nothing then', () => {
    const off = { ...SETTINGS, precreaseGrid: false };
    expect(samePlanSettings(off, { ...off, gridWhereNeeded: false })).toBe(true);
    expect(samePlanSettings(SETTINGS, { ...SETTINGS, gridWhereNeeded: false })).toBe(false);
    expect(referencesPlanCacheKeyId(referencesPlanCacheKey(input, left, off))).toBe(
      referencesPlanCacheKeyId(referencesPlanCacheKey(input, left, { ...off, gridWhereNeeded: false }))
    );
  });

  it('is one string per plan', () => {
    const key = referencesPlanCacheKey(input, left, SETTINGS);
    expect(referencesPlanCacheKeyId(key)).toBe(
      referencesPlanCacheKeyId(referencesPlanCacheKey(input, left, SETTINGS))
    );
    expect(referencesPlanCacheKeyId(key)).not.toBe(
      referencesPlanCacheKeyId(referencesPlanCacheKey(input, { bounds: RIGHT, frame: FRAME }, SETTINGS))
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

  // The safety net under the plan version: a shape changed without a bump, or
  // a payload damaged or edited by hand. Each field below is read by something
  // with no fallback, so a payload without it must not reach a render.
  it('reads a plan missing a field the panel relies on as no plan', async () => {
    const required: (keyof PrecreaseStep)[] = [
      'id', 'card', 'line_id', 'kind', 'line', 'segment', 'extent', 'witnesses', 'chosen', 'side',
      'direction', 'exact', 'marks_exist', 'cp_line_ids', 'cp_spans', 'pressed_on', 'made',
    ];
    const plan = cachedPlanOf(result(), plannerSequenceFixture(), 900);
    expect(await decodeCachedPlan(await encodeCachedPlan(plan))).not.toBeNull();
    for (const field of required) {
      const broken = structuredClone(plan) as ReferencesCachedPlan;
      delete (broken.plain.steps[1] as unknown as Record<string, unknown>)[field];
      expect(await decodeCachedPlan(await encodeCachedPlan(broken)), field).toBeNull();
    }
    const badLine = structuredClone(plan);
    (badLine.hoisted.steps[0].line as unknown as Record<string, unknown>).n = [1];
    expect(await decodeCachedPlan(await encodeCachedPlan(badLine))).toBeNull();
    const badWay = structuredClone(plan);
    badWay.plain.steps[1] = {
      ...badWay.plain.steps[1],
      ways: [{ witness: { ...extraWitness(), inputs: undefined } as unknown as PrecreaseWitness, kind: 'O3:ll' }],
    };
    expect(await decodeCachedPlan(await encodeCachedPlan(badWay))).toBeNull();
  });

  it('reads anything else as no plan, never an error', async () => {
    expect(await decodeCachedPlan('not base64 at all!')).toBeNull();
    expect(await decodeCachedPlan(btoa('plain text'))).toBeNull();
    const { gzipSync, strToU8 } = await import('fflate');
    const wrongShape = gzipSync(strToU8(JSON.stringify({ result: {}, plain: [], hoisted: [] })));
    expect(await decodeCachedPlan(btoa(String.fromCharCode(...wrongShape)))).toBeNull();
  });
});
