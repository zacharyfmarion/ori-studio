import { act, createElement, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { SEG_ATTR_STRIDE } from '../../engine/oristudioCpGeometry';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { plannerSequenceFixture } from './__fixtures__/plannerSequence';
import type { PrecreasePlanResult } from './precreasePlan';
import {
  cachedPlanOf,
  encodeCachedPlan,
  referencesPlanCacheKey,
  type ReferencesPlanCacheKey,
} from './referencesPlanCache';
import {
  installReferencesPlanCache,
  lookupReferencesPlan,
  resetReferencesPlanCacheForTests,
} from './referencesPlanCacheStore';
import { planFilmstrip } from './referencesFilmstrip';
import { cardLocatorAt, planStrip } from './referencesReaderState';
import { clearReferencesResults } from './referencesResults';
import {
  precreaseInputFromTransport,
  type PrecreaseComponent,
  type PrecreaseFrame,
  type SheetAnalysis,
} from './sheetFrames';
import { useReferencesBreakdown, type ReferencesBreakdownController } from './useReferencesBreakdown';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The planner worker, faked: a restore maps the plan's points into model space
// through it and must never create a planner; a run creates one, and is
// refused here so it ends at once.
const client = vi.hoisted(() => ({
  rfToModelMany: vi.fn(async (_frame: unknown, points: Float64Array) => points),
  plannerCreate: vi.fn(async () => {
    throw new Error('planner refused for the test');
  }),
  plannerDispose: vi.fn(async () => undefined),
}));
// Reference-counted like the real runtime: once the last holder releases it,
// asking for the client throws.
const retained = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../store/workspaceStore/precreaseRuntime', () => ({
  getPrecreaseClient: () => {
    if (retained.count === 0) throw new Error('retain the precrease client before using it');
    return client;
  },
  peekPrecreaseClient: () => (retained.count > 0 ? client : null),
  retainPrecreaseClient: () => {
    retained.count += 1;
    return client;
  },
  releasePrecreaseClient: () => {
    retained.count = Math.max(0, retained.count - 1);
  },
  whilePrecreaseClientAlive: <T,>(pending: Promise<T>) => pending,
}));
vi.mock('../../store/workspaceStore/referenceFinderRuntime', () => ({
  releaseReferenceFinderClient: () => undefined,
}));
// The strip the panel draws on arrival, made to fail on demand: a cached plan
// that reads but cannot be shown.
vi.mock('./referencesFilmstrip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./referencesFilmstrip')>();
  return { ...actual, planFilmstrip: vi.fn(actual.planFilmstrip) };
});

const SEGMENTS = [
  [-200, -200, 200, -200, 0],
  [200, -200, 200, 200, 0],
  [200, 200, -200, 200, 0],
  [-200, 200, -200, -200, 0],
  [-200, -200, 200, 200, 2],
];
const geometry: CpGeometryTransport = (() => {
  const segEndpoints = new Float64Array(SEGMENTS.length * 4);
  const segAttr = new Int32Array(SEGMENTS.length * SEG_ATTR_STRIDE);
  SEGMENTS.forEach(([ax, ay, bx, by, colour], index) => {
    segEndpoints.set([ax, ay, bx, by], index * 4);
    segAttr[index * SEG_ATTR_STRIDE] = colour;
  });
  return { segEndpoints, segAttr } as CpGeometryTransport;
})();
const BOUNDS = { minX: -200, minY: -200, maxX: 200, maxY: 200 };
const FRAME: PrecreaseFrame = { origin: [-200, -200], x_axis: [1, 0], y_axis: [0, 1], width: 400, height: 400 };
const SHEET = { bounds: BOUNDS, frame: FRAME };
const input = precreaseInputFromTransport(geometry);
const frames = {
  warnings: [],
  components: [
    {
      id: 4,
      frame: FRAME,
      rf_rect: { width: 1, height: 1 },
      outline: [
        [-200, -200],
        [200, -200],
        [200, 200],
        [-200, 200],
      ],
      segment_indices: [4],
      border_segment_indices: [0, 1, 2, 3],
    } as unknown as PrecreaseComponent,
  ],
} as unknown as SheetAnalysis;
const SETTINGS = {
  precreaseGrid: true,
  gridWhereNeeded: true,
  allowDanglingFolds: true,
  mergeSymmetricSteps: true,
};
const LOAD = 9;
const REVISION = `${LOAD}:abc`;

function result(): PrecreasePlanResult {
  return {
    computedAtRevision: 'an older session',
    component: 0,
    info: {
      component: 0,
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
    sequence: plannerSequenceFixture(),
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

async function cacheWith(key: ReferencesPlanCacheKey, ways: Record<string, string> = {}) {
  const payload = await encodeCachedPlan(cachedPlanOf(result(), plannerSequenceFixture(), 900));
  installReferencesPlanCache({ v: 1, entries: [{ key, ways, payload }] }, LOAD);
}

let controller: ReferencesBreakdownController | null = null;
let root: Root | null = null;
let container: HTMLDivElement | null = null;

let shownFrames: SheetAnalysis = frames;

function Probe() {
  const value = useReferencesBreakdown(geometry, REVISION, shownFrames, 4);
  useEffect(() => {
    controller = value;
  });
  return null;
}

async function settle() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({ oristudioCpDocument: { loadSerial: LOAD } as OristudioCpDocumentState });
  resetReferencesPlanCacheForTests();
  clearReferencesResults();
  client.rfToModelMany.mockClear();
  client.plannerCreate.mockClear();
  shownFrames = frames;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  controller = null;
});

describe('opening the sequence on a reopened project', () => {
  it('shows the cached plan without planning, with the reader’s ways and card', async () => {
    const key = referencesPlanCacheKey(input, SHEET, SETTINGS);
    const line = plannerSequenceFixture().steps[2];
    await cacheWith(key, { [String(line.line_id)]: 'O1:p4,p5:0' });
    const record = { revision: REVISION, components: [], refused: [], durationMs: 0, ...SETTINGS };
    const strip = planStrip(
      {
        ...record,
        components: [
          {
            component: 4,
            result: result(),
            frame: FRAME as never,
            plain: { sequence: plannerSequenceFixture(), model: {} as never },
            hoisted: { sequence: plannerSequenceFixture(), model: {} as never },
            cacheKey: key,
          },
        ],
      },
      { landmarksFirst: false, planWays: {} }
    );
    const card = cardLocatorAt(strip.variants, strip.viewSteps, 3);
    useWorkspaceStore.setState({ referencesRestore: { loadSerial: LOAD, sheet: null, card } });

    act(() => controller?.open());
    await settle();

    expect(client.plannerCreate).not.toHaveBeenCalled();
    expect(client.rfToModelMany).toHaveBeenCalledTimes(2);
    const shown = controller?.record?.components[0];
    expect(shown?.component).toBe(4);
    expect(shown?.result.computedAtRevision).toBe(REVISION);
    expect(shown?.cacheKey).toEqual(key);
    expect(shown?.plain.sequence.steps).toHaveLength(plannerSequenceFixture().steps.length);
    expect(controller?.activeStep).toBe(3);
    expect(useWorkspaceStore.getState().referencesView.planWays).toEqual({
      [`0:${line.line_id}`]: 'O1:p4,p5:0',
    });
    expect(useWorkspaceStore.getState().referencesPlan?.durationMs).toBe(900);
  });

  it('plans when the cached plan was made under other settings', async () => {
    await cacheWith(referencesPlanCacheKey(input, SHEET, { ...SETTINGS, precreaseGrid: false }));
    act(() => controller?.open());
    await settle();
    expect(client.plannerCreate).toHaveBeenCalledTimes(1);
    expect(controller?.record).toBeNull();
  });

  // A plan that unpacks but cannot be drawn — damaged, or a shape this build
  // does not read — becomes a replan, and is not written back into the file.
  // Shown, it would have sent the panel to its error boundary on every visit.
  it('plans, and forgets the cached plan, when it reads but cannot be shown', async () => {
    const key = referencesPlanCacheKey(input, SHEET, SETTINGS);
    await cacheWith(key);
    vi.mocked(planFilmstrip).mockImplementationOnce(() => {
      throw new Error('unreadable');
    });
    act(() => controller?.open());
    await settle();
    expect(client.plannerCreate).toHaveBeenCalledTimes(1);
    expect(controller?.record).toBeNull();
    expect(lookupReferencesPlan(LOAD, key)).toBeNull();
  });

  // Leaving the workspace while the plan unpacks is not the plan's fault: it is
  // kept for the next visit, and nothing is planned for a panel that is gone.
  it('keeps the cached plan, and plans nothing, when the reader leaves while it unpacks', async () => {
    const key = referencesPlanCacheKey(input, SHEET, SETTINGS);
    await cacheWith(key);
    act(() => controller?.open());
    act(() => root?.unmount());
    root = null;
    await settle();
    expect(client.plannerCreate).not.toHaveBeenCalled();
    expect(lookupReferencesPlan(LOAD, key)?.outcome).toBe('hit');
  });

  // Where sheets overlap, which owns a crease in the overlap follows numbering
  // outside any one sheet, so no sheet's fingerprint can vouch for its plan.
  it('never serves a document whose sheets overlap from the cache', async () => {
    await cacheWith(referencesPlanCacheKey(input, SHEET, SETTINGS));
    shownFrames = { ...frames, warnings: [{ kind: 'overlapping_sheets', segments: 2 }] };
    act(() => root?.render(createElement(Probe)));
    act(() => controller?.open());
    await settle();
    expect(client.plannerCreate).toHaveBeenCalledTimes(1);
  });

  it('plans when there is nothing cached', async () => {
    act(() => controller?.open());
    await settle();
    expect(client.plannerCreate).toHaveBeenCalledTimes(1);
  });
});
