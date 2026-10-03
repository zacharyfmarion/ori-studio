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
  resetReferencesPlanCacheForTests,
} from './referencesPlanCacheStore';
import { cardLocatorAt, planStrip } from './referencesReaderState';
import { clearReferencesResults } from './referencesResults';
import type { PrecreaseComponent, SheetAnalysis } from './sheetFrames';
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
vi.mock('../../store/workspaceStore/precreaseRuntime', () => ({
  getPrecreaseClient: () => client,
  peekPrecreaseClient: () => client,
  retainPrecreaseClient: () => client,
  releasePrecreaseClient: () => undefined,
}));
vi.mock('../../store/workspaceStore/referenceFinderRuntime', () => ({
  releaseReferenceFinderClient: () => undefined,
}));

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
const FRAME = { origin: [-200, -200], x_axis: [1, 0], y_axis: [0, 1], width: 400, height: 400 };
const frames = {
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
} as SheetAnalysis;
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

function Probe() {
  const value = useReferencesBreakdown(geometry, REVISION, frames, 4);
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
    const key = referencesPlanCacheKey(geometry, BOUNDS, SETTINGS);
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
    await cacheWith(referencesPlanCacheKey(geometry, BOUNDS, { ...SETTINGS, precreaseGrid: false }));
    act(() => controller?.open());
    await settle();
    expect(client.plannerCreate).toHaveBeenCalledTimes(1);
    expect(controller?.record).toBeNull();
  });

  it('plans when there is nothing cached', async () => {
    act(() => controller?.open());
    await settle();
    expect(client.plannerCreate).toHaveBeenCalledTimes(1);
  });
});
