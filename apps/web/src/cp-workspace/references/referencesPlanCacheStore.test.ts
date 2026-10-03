import { beforeEach, describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import {
  decodeCachedPlan,
  REFERENCES_PLAN_CACHE_MAX_CHARS,
  referencesPlanCacheKey,
  type ReferencesCachedPlan,
  type ReferencesPlanCacheEntryV1,
} from './referencesPlanCache';
import {
  forgetReferencesPlan,
  installReferencesPlanCache,
  lookupReferencesPlan,
  referencesPlanCacheForSave,
  rememberReferencesPlan,
  resetReferencesPlanCacheForTests,
  setReferencesPlanWays,
} from './referencesPlanCacheStore';

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
const SEGMENTS = [
  [20, 0, 30, 0, 0],
  [20, 0, 30, 10, 2],
  [0, 0, 10, 0, 0],
  [0, 0, 10, 10, 1],
];
const geometry = transportOf(SEGMENTS);
const SETTINGS = {
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};
const leftKey = referencesPlanCacheKey(geometry, LEFT, SETTINGS);
const rightKey = referencesPlanCacheKey(geometry, RIGHT, SETTINGS);

function plan(durationMs = 10): ReferencesCachedPlan {
  return {
    result: {
      info: {
        component: 0,
        status: 'complete',
        sheet: null,
        exactness: null,
        refused: false,
        off_lattice: false,
        targets: 0,
        free_targets: 0,
        remaining: 0,
        point_cap: 0,
      },
      stopReason: 'complete',
      partial: false,
      approximate: [],
      rfAuxFolded: 0,
      approximated: 0,
      rfQueries: 0,
      stuckEvents: 0,
      durationMs,
      landmarksFirst: false,
    },
    plain: plannerSequenceFixture(),
    hoisted: plannerSequenceFixture(),
    durationMs,
  };
}

function entry(key: typeof leftKey, payload: string): ReferencesPlanCacheEntryV1 {
  return { key, ways: {}, payload };
}

beforeEach(() => {
  resetReferencesPlanCacheForTests();
});

describe('the plan cache side table', () => {
  it('keeps a landed plan, packed, as its sheet’s entry', async () => {
    rememberReferencesPlan(1, leftKey, plan());
    const saved = await referencesPlanCacheForSave(1, geometry);
    expect(saved?.entries.map((saved) => saved.key)).toEqual([leftKey]);
    const found = lookupReferencesPlan(1, leftKey);
    expect(found?.outcome).toBe('hit');
    expect(found?.outcome === 'hit' && (await decodeCachedPlan(found.payload))).toEqual(plan());
  });

  it('answers only to the document it was filled for', async () => {
    installReferencesPlanCache({ v: 1, entries: [entry(leftKey, 'a')] }, 1);
    expect(lookupReferencesPlan(2, leftKey)).toBeNull();
    // And the other document's look started the table afresh.
    expect(lookupReferencesPlan(1, leftKey)).toBeNull();
    expect(await referencesPlanCacheForSave(1, geometry)).toBeNull();
  });

  it('replaces a sheet’s plan rather than keeping two', async () => {
    rememberReferencesPlan(1, leftKey, plan(1));
    rememberReferencesPlan(1, rightKey, plan(2));
    rememberReferencesPlan(1, leftKey, plan(3));
    const saved = await referencesPlanCacheForSave(1, geometry);
    expect(saved?.entries.map((saved) => saved.key)).toEqual([leftKey, rightKey]);
    const found = lookupReferencesPlan(1, leftKey);
    const decoded = found?.outcome === 'hit' ? await decodeCachedPlan(found.payload) : null;
    expect(decoded?.durationMs).toBe(3);
  });

  it('says why an entry is not the plan wanted, and forgets it', () => {
    installReferencesPlanCache({ v: 1, entries: [entry(leftKey, 'a')] }, 1);
    const wanted = referencesPlanCacheKey(geometry, LEFT, { ...SETTINGS, precreaseGrid: false });
    expect(lookupReferencesPlan(1, wanted)).toEqual({ outcome: 'settings_changed' });
    expect(lookupReferencesPlan(1, leftKey)).toBeNull();
  });

  it('moves a hit to the front, as the most recently viewed', async () => {
    installReferencesPlanCache({ v: 1, entries: [entry(leftKey, 'a'), entry(rightKey, 'b')] }, 1);
    lookupReferencesPlan(1, rightKey);
    const saved = await referencesPlanCacheForSave(1, geometry);
    expect(saved?.entries.map((saved) => saved.payload)).toEqual(['b', 'a']);
  });

  it('keeps the reader’s ways with the plan they name', () => {
    installReferencesPlanCache({ v: 1, entries: [entry(leftKey, 'a')] }, 1);
    setReferencesPlanWays(1, leftKey, { '17': 'O2:c0,p4:0' });
    expect(lookupReferencesPlan(1, leftKey)).toEqual({
      outcome: 'hit',
      payload: 'a',
      ways: { '17': 'O2:c0,p4:0' },
    });
  });

  it('forgets a plan that could not be read', () => {
    installReferencesPlanCache({ v: 1, entries: [entry(leftKey, 'a')] }, 1);
    forgetReferencesPlan(1, leftKey);
    expect(lookupReferencesPlan(1, leftKey)).toBeNull();
  });
});

describe('referencesPlanCacheForSave', () => {
  it('drops what the creases being saved can never match again, and other planners’ plans', async () => {
    installReferencesPlanCache(
      {
        v: 1,
        entries: [entry(leftKey, 'a'), entry(rightKey, 'b'), entry({ ...leftKey, planner: 'old' }, 'c')],
      },
      1
    );
    // The right sheet's diagonal recoloured since its plan was made.
    const edited = transportOf(SEGMENTS.map((segment, index) => (index === 1 ? [20, 0, 30, 10, 1] : segment)));
    const saved = await referencesPlanCacheForSave(1, edited);
    expect(saved?.entries.map((saved) => saved.payload)).toEqual(['a']);
  });

  it('keeps the most recently viewed plans that fit under the cap', async () => {
    const half = 'x'.repeat(REFERENCES_PLAN_CACHE_MAX_CHARS / 2 + 1);
    const third = 'y'.repeat(REFERENCES_PLAN_CACHE_MAX_CHARS / 3);
    installReferencesPlanCache(
      { v: 1, entries: [entry(leftKey, half), entry(rightKey, half)] },
      1
    );
    expect((await referencesPlanCacheForSave(1, geometry))?.entries.map((e) => e.payload)).toEqual([half]);
    installReferencesPlanCache(
      { v: 1, entries: [entry(leftKey, third), entry(rightKey, third)] },
      1
    );
    expect((await referencesPlanCacheForSave(1, geometry))?.entries).toHaveLength(2);
  });

  it('writes nothing without creases to check against', async () => {
    installReferencesPlanCache({ v: 1, entries: [entry(leftKey, 'a')] }, 1);
    expect(await referencesPlanCacheForSave(1, null)).toBeNull();
  });
});
